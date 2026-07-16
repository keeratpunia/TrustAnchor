"""
test_preprocessing.py — unit tests for app/pipeline/preprocessing.py.
Uses synthetic in-memory images — no dependency on the test_data/ fixtures
(those are for the end-to-end proof; these are for the isolated stage).
"""
import io

import numpy as np
import pytest
from PIL import Image

from app.pipeline import preprocessing


def _make_test_image_bytes(width=1000, height=700, color=(255, 255, 255)) -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_preprocess_returns_bgr_array_of_expected_shape():
    result = preprocessing.preprocess(_make_test_image_bytes(1000, 700))
    assert result.image.shape == (700, 1000, 3)
    assert result.original_width == 1000
    assert result.original_height == 700


def test_preprocess_downscales_oversized_images():
    result = preprocessing.preprocess(_make_test_image_bytes(4000, 3000))
    longer_side = max(result.normalized_width, result.normalized_height)
    assert longer_side == preprocessing.MAX_DIMENSION_PX
    # Aspect ratio must be preserved.
    assert abs((4000 / 3000) - (result.normalized_width / result.normalized_height)) < 0.01


def test_preprocess_does_not_upscale_small_images():
    result = preprocessing.preprocess(_make_test_image_bytes(400, 300))
    assert result.normalized_width == 400
    assert result.normalized_height == 300
    assert any("quite small" in w for w in result.warnings)


def test_preprocess_raises_on_invalid_bytes():
    with pytest.raises(ValueError):
        preprocessing.preprocess(b"not an image at all")


def test_screenshot_likelihood_is_bounded():
    result = preprocessing.preprocess(_make_test_image_bytes(1000, 700))
    assert 0.0 <= result.screenshot_likelihood <= 1.0


def test_screenshot_likelihood_higher_for_common_screen_aspect_ratio():
    # A 16:9 image (a very common device screen ratio) should score at
    # least as suspicious as an arbitrary, non-screen-like ratio like a
    # typical A4-ish document photo aspect (842:595 ~= 1.415).
    screen_like = preprocessing.preprocess(_make_test_image_bytes(1920, 1080))  # exactly 16:9
    document_like = preprocessing.preprocess(_make_test_image_bytes(842, 595))
    assert screen_like.screenshot_likelihood >= document_like.screenshot_likelihood


def test_exif_orientation_correction_applied():
    # Build an image with an EXIF orientation tag indicating it should be
    # rotated 180 degrees, and confirm the pixel content ends up corrected
    # (i.e. the function does not simply ignore the tag). Uses a 15x15
    # solid marker BLOCK, not a single pixel — JPEG's 8x8-block lossy
    # compression can otherwise destroy a single-pixel marker entirely
    # before the orientation-correction code ever sees it, which would
    # make this a test-fixture bug, not a real assertion about the code.
    img = Image.new("RGB", (100, 50), color=(255, 0, 0))
    for x in range(15):
        for y in range(15):
            img.putpixel((x, y), (0, 255, 0))  # solid green marker block, top-left

    exif = img.getexif()
    exif[0x0112] = 3  # Orientation tag: 3 = rotate 180
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, exif=exif)

    result = preprocessing.preprocess(buf.getvalue())
    # After a 180-degree correction, the marker block (originally top-left)
    # should now be near the bottom-right.
    height, width = result.image.shape[:2]
    corrected_region = result.image[height - 15 : height, width - 15 : width]
    # BGR order: a green marker means high G, low B and low R.
    assert corrected_region[:, :, 1].mean() > corrected_region[:, :, 2].mean()
    assert corrected_region[:, :, 1].mean() > corrected_region[:, :, 0].mean()
