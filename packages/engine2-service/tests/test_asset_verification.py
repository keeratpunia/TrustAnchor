"""
test_asset_verification.py — unit tests for app/pipeline/asset_verification.py.
Builds small synthetic "aligned document" images with a distinctive mark
(standing in for a logo/signature/seal) at a known bounding box, since
there's no persisted TemplateAsset reference in test_data/ yet — this
mirrors how test_homography.py/test_preprocessing.py use real generated
fixtures, just generated inline here rather than via a shared script.
"""
import cv2
import numpy as np
import pytest

from app.pipeline import asset_verification
from app.pipeline.ocr import BoundingBox


def _encode_png(bgr_image: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", bgr_image)
    assert ok
    return buf.tobytes()


ASSET_BOX = BoundingBox(x=300, y=200, width=150, height=100)


# All mark-drawing functions below use coordinates LOCAL to a 150x100
# patch (matching ASSET_BOX's size) — the same patch is used both to build
# the standalone reference image AND, pasted at (300, 200), to build the
# full "aligned document" the crop is taken from. Keeping both in the same
# local coordinate space is what makes "identical mark" tests actually
# compare identical pixels.

def _draw_logo(patch: np.ndarray) -> None:
    """A distinctive, texture-rich mark (concentric shapes + a diagonal
    line) — enough structure for both SSIM and ORB to have something to
    work with, standing in for a real university logo."""
    cv2.rectangle(patch, (10, 10), (140, 90), (20, 20, 160), -1)
    cv2.circle(patch, (75, 50), 30, (255, 255, 255), -1)
    cv2.circle(patch, (75, 50), 15, (20, 20, 160), -1)
    cv2.line(patch, (10, 10), (140, 90), (0, 0, 0), 3)


def _draw_different_logo(patch: np.ndarray) -> None:
    """A visibly, strongly different mark in the same region (mostly-white
    background with a few thin lines, versus the reference's large filled
    color block) — simulates a forged/substituted logo, not just a minor
    variation of the same one."""
    for i in range(4):
        cv2.line(patch, (0, 20 + i * 20), (150, 20 + i * 20), (0, 0, 0), 2)


def _draw_plain_seal(patch: np.ndarray) -> None:
    """A textureless, solid-color mark — used to exercise the "too few
    ORB keypoints" fallback path."""
    cv2.circle(patch, (75, 50), 45, (120, 60, 10), -1)


def _make_patch(mark_drawer) -> np.ndarray:
    patch = np.full((ASSET_BOX.height, ASSET_BOX.width, 3), 255, dtype=np.uint8)
    mark_drawer(patch)
    return patch


def _make_document_with_mark(mark_drawer) -> np.ndarray:
    """A plain white 842x595 'aligned document' with the given mark pasted
    into the fixed region ASSET_BOX describes."""
    canvas = np.full((595, 842, 3), 255, dtype=np.uint8)
    patch = _make_patch(mark_drawer)
    canvas[
        ASSET_BOX.y : ASSET_BOX.y + ASSET_BOX.height,
        ASSET_BOX.x : ASSET_BOX.x + ASSET_BOX.width,
    ] = patch
    return canvas


@pytest.fixture(scope="module")
def logo_reference_bytes():
    return _encode_png(_make_patch(_draw_logo))


def test_identical_logo_scores_high(logo_reference_bytes):
    document = _make_document_with_mark(_draw_logo)
    result = asset_verification.verify_asset(
        document, "university_logo", ASSET_BOX, logo_reference_bytes, is_mandatory=True
    )
    # SSIM and histogram correlation are both 1.0 for a truly identical
    # crop; ORB's ratio test is intentionally conservative and doesn't
    # reach 1.0 even here on a symmetric synthetic mark (concentric
    # circles produce ambiguous, self-similar keypoints) — a known,
    # documented characteristic (see asset_verification.py's module
    # docstring), not a bug. "review" is an acceptable outcome for a
    # combined score; a human confirms the borderline case.
    assert result.similarity >= 0.8
    assert result.tier in ("accept", "review")
    assert result.ssim == 1.0


def test_substituted_logo_scores_low(logo_reference_bytes):
    document = _make_document_with_mark(_draw_different_logo)
    result = asset_verification.verify_asset(
        document, "university_logo", ASSET_BOX, logo_reference_bytes, is_mandatory=True
    )
    # SSIM correctly drops sharply (0.231) for a genuinely different mark.
    # Histogram correlation stays moderately high here because BOTH marks
    # sit on a mostly-white background — exactly the documented limitation
    # in asset_verification.py's module docstring ("cannot alone
    # distinguish 'same mark' from 'different mark, similar paper
    # background'"). The combined score should still clearly fail to reach
    # "accept" even though it doesn't collapse to near-zero on this weak
    # signal alone.
    assert result.ssim < 0.4
    assert result.similarity < 0.75
    assert result.tier != "accept"


def test_plain_solid_color_asset_falls_back_when_orb_has_no_keypoints():
    ref_canvas = np.full((100, 150, 3), 255, dtype=np.uint8)
    _draw_plain_seal(ref_canvas)
    reference_bytes = _encode_png(ref_canvas)

    document = _make_document_with_mark(_draw_plain_seal)
    result = asset_verification.verify_asset(
        document, "official_seal", ASSET_BOX, reference_bytes, is_mandatory=True
    )
    # Too little texture for ORB to find enough keypoints -> None, not 0.0,
    # and the combiner should still produce a sensible high score from
    # SSIM + histogram alone since the seal genuinely matches.
    assert result.orb_match_ratio is None
    assert result.similarity >= 0.8
    assert "too few keypoints" in result.reason


def test_empty_crop_region_is_a_hard_reject(logo_reference_bytes):
    document = np.full((595, 842, 3), 255, dtype=np.uint8)
    out_of_bounds_box = BoundingBox(x=2000, y=2000, width=100, height=100)
    result = asset_verification.verify_asset(
        document, "university_logo", out_of_bounds_box, logo_reference_bytes, is_mandatory=True
    )
    assert result.similarity == 0.0
    assert result.tier == "reject"
    assert result.ssim is None


def test_undecodable_reference_bytes_is_a_hard_reject():
    document = _make_document_with_mark(_draw_logo)
    result = asset_verification.verify_asset(
        document, "university_logo", ASSET_BOX, b"not a real image", is_mandatory=True
    )
    assert result.similarity == 0.0
    assert result.tier == "reject"


def test_verify_all_assets_processes_every_declared_asset(logo_reference_bytes):
    document = _make_document_with_mark(_draw_logo)
    assets = [
        {
            "asset_name": "university_logo",
            "bounding_box": {"x": 300, "y": 200, "width": 150, "height": 100},
            "reference_bytes": logo_reference_bytes,
            "is_mandatory": True,
        },
        {
            "asset_name": "registrar_signature",
            "bounding_box": {"x": 300, "y": 200, "width": 150, "height": 100},
            "reference_bytes": logo_reference_bytes,
            "is_mandatory": False,
        },
    ]
    results = asset_verification.verify_all_assets(document, assets)
    assert [r.asset_name for r in results] == ["university_logo", "registrar_signature"]
    assert results[1].is_mandatory is False
