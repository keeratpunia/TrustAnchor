"""
test_ocr.py — unit tests for app/pipeline/ocr.py.
Uses the real generated test fixtures, run through the actual homography
stage first, so these tests exercise OCR on a genuinely realigned image.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.pipeline import homography, ocr

TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"


@pytest.fixture(scope="module")
def ground_truth():
    with open(TEST_DATA_DIR / "ground_truth.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def aligned_image(ground_truth):
    captured = cv2.imread(str(TEST_DATA_DIR / "captured_photo.jpg"))
    qr_position = np.array(ground_truth["qr_position_in_template"], dtype=np.float32)
    result = homography.align_document(
        captured_bgr=captured,
        qr_position_in_template=qr_position,
        template_width=ground_truth["template_width"],
        template_height=ground_truth["template_height"],
    )
    return result.aligned_image


def _normalize(text):
    return text.replace(" ", "").strip()


def test_english_zone_extracted_correctly(aligned_image, ground_truth):
    zone = ground_truth["zones"]["student_name_en"]
    box = ocr.BoundingBox(**zone["bounding_box"])
    result = ocr.extract_zone(aligned_image, "student_name_en", box, zone["languages"])
    assert not result.extraction_failed
    assert _normalize(zone["expected_text"]) == _normalize(result.extracted_text)
    assert result.language_used == "en"
    assert result.ocr_confidence > 0.5


def test_hindi_zone_extracted_correctly(aligned_image, ground_truth):
    zone = ground_truth["zones"]["degree_name_hi"]
    box = ocr.BoundingBox(**zone["bounding_box"])
    result = ocr.extract_zone(aligned_image, "degree_name_hi", box, zone["languages"])
    assert not result.extraction_failed
    assert _normalize(zone["expected_text"]) == _normalize(result.extracted_text)
    assert result.language_used == "hi"


def test_punjabi_zone_extracted_correctly(aligned_image, ground_truth):
    zone = ground_truth["zones"]["university_pa"]
    box = ocr.BoundingBox(**zone["bounding_box"])
    result = ocr.extract_zone(aligned_image, "university_pa", box, zone["languages"])
    assert not result.extraction_failed
    assert _normalize(zone["expected_text"]) == _normalize(result.extracted_text)
    assert result.language_used == "pa"


def test_extract_all_zones_processes_every_declared_zone(aligned_image, ground_truth):
    zones_list = list(ground_truth["zones"].values())
    results = ocr.extract_all_zones(aligned_image, zones_list)
    assert len(results) == len(zones_list)
    assert all(not r.extraction_failed for r in results)


def test_empty_crop_reports_extraction_failed_not_a_crash():
    blank = np.full((100, 100, 3), 255, dtype=np.uint8)
    box = ocr.BoundingBox(x=500, y=500, width=50, height=50)
    result = ocr.extract_zone(blank, "nonexistent_zone", box, ["en"])
    assert result.extraction_failed
    assert result.extracted_text == ""


def test_mixed_language_zone_still_succeeds():
    from pathlib import Path
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (300, 60), color="white")
    draw = ImageDraw.Draw(img)
    # Uses the SAME bundled font as tests/generate_test_document.py
    # (tests/fonts/DejaVuSans-Bold.ttf) rather than a hardcoded Linux path
    # — this was a second instance of the exact same cross-platform bug
    # already fixed in generate_test_document.py, just missed in this file
    # during that pass.
    font_path = Path(__file__).parent / "fonts" / "DejaVuSans-Bold.ttf"
    font = ImageFont.truetype(str(font_path), 28)
    draw.text((10, 10), "Test Field", fill="black", font=font)
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    box = ocr.BoundingBox(x=0, y=0, width=300, height=60)
    result = ocr.extract_zone(bgr, "mixed_test", box, ["en", "hi"])

    assert not result.extraction_failed
    assert _normalize("Test Field") == _normalize(result.extracted_text)
