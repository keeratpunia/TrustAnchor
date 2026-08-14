"""
test_template_matching.py — unit tests for app/pipeline/template_matching.py.
Reuses the real generated test fixtures (test_data/), the same ones
test_homography.py already proves alignment against, so these tests are
checking template-match behavior on a genuinely correctly-aligned image,
not a synthetic best-case.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.pipeline import homography, preprocessing, template_matching

TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"


@pytest.fixture(scope="module")
def ground_truth():
    with open(TEST_DATA_DIR / "ground_truth.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def aligned_image(ground_truth):
    """Runs the real Stage 1 + 2 pipeline to get a genuinely aligned image,
    exactly what Stage 4 receives in production."""
    with open(TEST_DATA_DIR / "captured_photo.jpg", "rb") as f:
        photo_bytes = f.read()
    pre = preprocessing.preprocess(photo_bytes)
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    result = homography.align_document(
        pre.image, qr_position, ground_truth["template_width"], ground_truth["template_height"]
    )
    return result.aligned_image


def test_qr_drift_is_small_on_a_correctly_aligned_real_image(aligned_image, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    drift = template_matching.redetect_qr_and_measure_drift(aligned_image, qr_position)
    assert drift is not None
    # The alignment machinery is specifically built to land the QR back on
    # its declared position - a genuinely correct match should be tight.
    assert drift < 20.0


def test_compute_template_match_scores_high_for_correct_template(aligned_image, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    result = template_matching.compute_template_match(aligned_image, qr_position)
    assert result.used_skeleton is False
    assert result.skeleton_correlation is None
    assert result.template_match_score >= 0.6
    assert result.tier in ("accept", "review")


def test_compute_template_match_scores_low_for_wrong_qr_position(aligned_image, ground_truth):
    # Simulate claiming the WRONG template by using a QR position far from
    # where this document's QR actually is.
    wrong_qr_position = np.array(
        [[600, 400], [700, 400], [700, 500], [600, 500]], dtype=np.float32
    )
    result = template_matching.compute_template_match(aligned_image, wrong_qr_position)
    assert result.template_match_score < 0.6
    # Without a skeleton, drift-only evidence is capped at "review" —
    # never hard-reject — because it's explicitly weaker evidence.
    assert result.tier == "review"


def test_redetect_qr_returns_none_when_no_qr_present():
    blank = np.full((595, 842, 3), 255, dtype=np.uint8)
    qr_position = np.array([[60, 60], [200, 60], [200, 200], [60, 200]], dtype=np.float32)
    drift = template_matching.redetect_qr_and_measure_drift(blank, qr_position)
    assert drift is None


def test_compute_template_match_rejects_when_no_qr_detectable():
    blank = np.full((595, 842, 3), 255, dtype=np.uint8)
    qr_position = np.array([[60, 60], [200, 60], [200, 200], [60, 200]], dtype=np.float32)
    result = template_matching.compute_template_match(blank, qr_position)
    assert result.qr_drift_px is None
    assert result.template_match_score == 0.0
    # Without a skeleton, even a total QR-detection failure caps at
    # "review" — the hard-veto path is reserved for skeleton-corroborated
    # evidence.
    assert result.tier == "review"


def test_skeleton_correlation_is_near_perfect_for_identical_image(aligned_image):
    skeleton_gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)
    correlation = template_matching.skeleton_correlation(aligned_image, skeleton_gray)
    assert correlation > 0.99


def test_skeleton_correlation_is_low_for_unrelated_noise_image(aligned_image):
    rng = np.random.default_rng(42)
    noise = rng.integers(0, 256, size=aligned_image.shape[:2], dtype=np.uint8)
    correlation = template_matching.skeleton_correlation(aligned_image, noise)
    assert abs(correlation) < 0.3


def test_compute_template_match_uses_skeleton_when_supplied(aligned_image, ground_truth):
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    skeleton_gray = cv2.cvtColor(aligned_image, cv2.COLOR_BGR2GRAY)
    result = template_matching.compute_template_match(aligned_image, qr_position, skeleton_gray=skeleton_gray)
    assert result.used_skeleton is True
    assert result.skeleton_correlation is not None
    assert result.skeleton_correlation > 0.99