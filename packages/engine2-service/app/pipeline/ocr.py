"""
ocr.py — Stage 3 of the Engine 2 pipeline.
============================================================================
Extracts text from declared zones of an ALREADY-ALIGNED document image
(the output of homography.py — this stage never sees the raw captured
photo, only template-coordinate-space pixels, so its bounding-box
coordinates always mean the same thing regardless of the original photo's
angle/rotation).

TEMPLATE-DRIVEN, NOT HARDCODED: this module contains zero hardcoded field
names, positions, or languages. Every zone it processes is declared by an
OcrZone database row (Engine2_Architecture.md §6) — a university adds a new
field to check simply by declaring a new zone, with no code change here.

MULTILINGUAL SUPPORT: each OcrZone declares a `languages` list (ISO 639-1
codes — mapped here to Tesseract's language codes: en->eng, hi->hin,
pa->pan). For a zone with multiple declared languages, this module BOTH
tries Tesseract's own combined-language mode (e.g. "hin+eng", letting
Tesseract recognize genuinely mixed-script text within one zone) AND tries
each language individually, keeping whichever attempt produced the
highest-confidence result.
"""
from dataclasses import dataclass

import os

import cv2
import numpy as np
import pytesseract

# Windows does not put Tesseract on PATH after a standard install, and the
# install location isn't standardized across platforms. Rather than
# requiring anyone to hand-edit this file, the path is read from an
# environment variable — set TESSERACT_CMD if pytesseract can't find
# tesseract automatically (see README.md's Windows setup section for the
# exact value to use with the standard UB Mannheim Windows installer).
_tesseract_cmd = os.environ.get("TESSERACT_CMD")
if _tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd

ISO_TO_TESSERACT_LANG = {
    "en": "eng",
    "hi": "hin",
    "pa": "pan",
}


@dataclass
class BoundingBox:
    x: int
    y: int
    width: int
    height: int


@dataclass
class OcrZoneResult:
    field_name: str
    extracted_text: str
    ocr_confidence: float
    language_used: str
    extraction_failed: bool


def _crop_zone(aligned_bgr: np.ndarray, box: BoundingBox) -> np.ndarray:
    height, width = aligned_bgr.shape[:2]
    x0 = max(0, box.x)
    y0 = max(0, box.y)
    x1 = min(width, box.x + box.width)
    y1 = min(height, box.y + box.height)
    return aligned_bgr[y0:y1, x0:x1]


def _binarize_for_ocr(crop_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def _run_tesseract(binary_crop: np.ndarray, tesseract_lang: str) -> tuple[str, float]:
    data = pytesseract.image_to_data(
        binary_crop,
        lang=tesseract_lang,
        output_type=pytesseract.Output.DICT,
        config="--psm 6",
    )
    words = [w.strip() for w in data["text"] if w.strip()]
    confidences = [
        int(c) for c, w in zip(data["conf"], data["text"]) if w.strip() and int(c) >= 0
    ]
    text = " ".join(words)
    avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0
    return text, avg_confidence


def extract_zone(
    aligned_bgr: np.ndarray,
    field_name: str,
    box: BoundingBox,
    languages: list,
) -> OcrZoneResult:
    crop = _crop_zone(aligned_bgr, box)
    if crop.size == 0:
        return OcrZoneResult(field_name, "", 0.0, "none", True)

    binary = _binarize_for_ocr(crop)
    tesseract_langs = [ISO_TO_TESSERACT_LANG.get(lang, lang) for lang in languages]

    attempts = []
    for iso_lang, tess_lang in zip(languages, tesseract_langs):
        text, confidence = _run_tesseract(binary, tess_lang)
        attempts.append((iso_lang, text, confidence))

    if len(tesseract_langs) > 1:
        combined = "+".join(dict.fromkeys(tesseract_langs))
        text, confidence = _run_tesseract(binary, combined)
        attempts.append(("combined", text, confidence))

    if not attempts:
        return OcrZoneResult(field_name, "", 0.0, "none", True)

    best_lang, best_text, best_confidence = max(attempts, key=lambda a: a[2])
    return OcrZoneResult(field_name, best_text, round(best_confidence, 3), best_lang, best_text == "")


def extract_all_zones(aligned_bgr: np.ndarray, zones: list) -> list:
    results = []
    for zone in zones:
        box = BoundingBox(**zone["bounding_box"])
        result = extract_zone(aligned_bgr, zone["field_name"], box, zone["languages"])
        results.append(result)
    return results
