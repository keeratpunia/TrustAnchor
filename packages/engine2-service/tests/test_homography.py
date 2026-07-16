"""
test_homography.py — unit tests for app/pipeline/homography.py.
Uses the real generated test fixtures (test_data/) produced by
tests/generate_test_document.py, which must be regenerated if this test
file is run in a fresh environment — see conftest.py.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.pipeline import homography

TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"


@pytest.fixture(scope="module")
def ground_truth():
    with open(TEST_DATA_DIR / "ground_truth.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def captured_photo_bgr():
    return cv2.imread(str(TEST_DATA_DIR / "captured_photo.jpg"))


def test_tier1_qr_seeded_homography_succeeds_on_real_photo(captured_photo_bgr, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    matrix, detected_corners = homography.tier1_qr_seeded_homography(
        captured_photo_bgr, qr_position
    )
    assert matrix.shape == (3, 3)
    assert detected_corners.shape == (4, 2)


def test_tier1_raises_when_no_qr_present():
    blank = np.full((500, 500, 3), 255, dtype=np.uint8)
    qr_position = np.array([[0, 0], [100, 0], [100, 100], [0, 100]], dtype=np.float32)
    with pytest.raises(homography.HomographyError):
        homography.tier1_qr_seeded_homography(blank, qr_position)


def test_tier2_border_refinement_finds_a_quadrilateral(captured_photo_bgr, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    tier1_matrix, _ = homography.tier1_qr_seeded_homography(captured_photo_bgr, qr_position)

    tier2_matrix = homography.tier2_border_refined_homography(
        captured_photo_bgr,
        tier1_matrix,
        ground_truth["template_width"],
        ground_truth["template_height"],
    )
    # On this fixture (a clearly bordered document against a plain
    # background), Tier 2 should successfully find the border.
    assert tier2_matrix is not None
    assert tier2_matrix.shape == (3, 3)


def test_align_document_full_pipeline_recovers_template_dimensions(captured_photo_bgr, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    result = homography.align_document(
        captured_bgr=captured_photo_bgr,
        qr_position_in_template=qr_position,
        template_width=ground_truth["template_width"],
        template_height=ground_truth["template_height"],
    )
    assert result.aligned_image.shape[:2] == (
        ground_truth["template_height"],
        ground_truth["template_width"],
    )
    assert "tier1_qr_seeded" in result.tiers_completed
    assert 0.0 <= result.alignment_quality <= 1.0


def test_align_document_qr_region_lands_near_expected_position(captured_photo_bgr, ground_truth):
    """
    The strongest possible test of correctness: after alignment, does a
    freshly-run QR detector find the QR in APPROXIMATELY the same place the
    template declared it should be? This directly validates the homography
    is not just "some transform" but the CORRECT one.
    """
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    result = homography.align_document(
        captured_bgr=captured_photo_bgr,
        qr_position_in_template=qr_position,
        template_width=ground_truth["template_width"],
        template_height=ground_truth["template_height"],
    )

    detector = cv2.QRCodeDetector()
    ok, points = detector.detect(result.aligned_image)
    assert ok, "QR should still be detectable after alignment"

    detected_center = points.reshape(4, 2).mean(axis=0)
    expected_center = qr_position.mean(axis=0)
    distance = np.linalg.norm(detected_center - expected_center)

    # Allow a modest pixel tolerance (this fixture's QR box is 80x80px in
    # an 842x595 template) — well within "close enough for template-space
    # cropping of nearby zones to work correctly."
    assert distance < 15, f"QR landed {distance:.1f}px from expected position after alignment"


def test_order_quad_points_produces_consistent_tl_tr_br_bl_order():
    # Deliberately shuffled input order.
    shuffled = np.array([[100, 100], [0, 0], [100, 0], [0, 100]], dtype=np.float32)
    ordered = homography._order_quad_points(shuffled)
    top_left, top_right, bottom_right, bottom_left = ordered
    assert top_left[0] < top_right[0]  # TL is left of TR
    assert top_left[1] < bottom_left[1]  # TL is above BL
    assert bottom_right[0] > bottom_left[0]  # BR is right of BL
