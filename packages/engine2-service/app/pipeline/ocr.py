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
from pathlib import Path
from datetime import datetime

import os
import logging

import cv2
import numpy as np
import pytesseract

logger = logging.getLogger("engine2.ocr")

# ── Debug instrumentation ──────────────────────────────────────────────
# Set ENGINE2_DEBUG_DIR to a writable folder path to enable saving every
# cropped zone image + a comparison report.  Unset or empty = disabled.
#   export ENGINE2_DEBUG_DIR=/home/you/engine2_debug
_DEBUG_DIR = os.environ.get("ENGINE2_DEBUG_DIR", "")


def _get_debug_run_dir() -> Path | None:
    """Create a timestamped subfolder for this pipeline run, or None if
    debug is disabled."""
    if not _DEBUG_DIR:
        return None
    run_dir = Path(_DEBUG_DIR) / datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir

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


# Residual alignment drift after Tier 1/2 (no Tier 3 skeleton refinement
# wired in yet) is commonly a handful of pixels — small enough to look
# "aligned" by eye but large enough to clip the leading edge of a tightly
# -declared OCR zone, systematically truncating the FIRST character(s) of
# a field (this was observed directly: "fatima sheikh" -> "ma sheikh",
# "hyderabad" -> "yderabad", i.e. always losing the left edge, never the
# right — the signature of a crop box sitting a few pixels too far
# right/down relative to the true text position). A fixed-percentage
# margin absorbs that drift without meaningfully changing what's being
# read, since it only ever ADDS a thin strip of surrounding background —
# it never removes anything the un-padded crop would have kept.
_CROP_MARGIN_FRACTION = 0.20
_CROP_MARGIN_MIN_PX = 10


def _crop_zone(aligned_bgr: np.ndarray, box: BoundingBox) -> np.ndarray:
    height, width = aligned_bgr.shape[:2]
    margin_x = max(_CROP_MARGIN_MIN_PX, int(box.width * _CROP_MARGIN_FRACTION))
    margin_y = max(_CROP_MARGIN_MIN_PX, int(box.height * _CROP_MARGIN_FRACTION))
    x0 = max(0, box.x - margin_x)
    y0 = max(0, box.y - margin_y)
    x1 = min(width, box.x + box.width + margin_x)
    y1 = min(height, box.y + box.height + margin_y)
    return aligned_bgr[y0:y1, x0:x1]


def _binarize_for_ocr(crop_bgr: np.ndarray) -> list[np.ndarray]:
    """
    Produces MULTIPLE binarized versions of the crop, each tuned for a
    different failure mode. The caller runs Tesseract on each and keeps
    the best result — the same multi-attempt philosophy applied to QR
    detection in qr_detection.py, applied here to text recognition.

    Returns a list of grayscale binarized images (not a single one),
    because no single threshold strategy works for all field types under
    all lighting conditions.
    """
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

    # Upscale small crops — Tesseract needs ~30px+ character height.
    h, w = gray.shape[:2]
    if h < 80:
        scale = 80.0 / max(h, 1)
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

    # CLAHE to normalize lighting before thresholding — handles uneven
    # illumination across the crop (a common phone-photo artifact).
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    clahe_gray = clahe.apply(gray)

    variants = []

    # Variant 1: Otsu on CLAHE-normalized gray (best for evenly-lit crops)
    _, otsu = cv2.threshold(clahe_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(otsu)

    # Variant 2: adaptive threshold on raw gray (best for uneven lighting)
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )
    variants.append(adaptive)

    # Variant 3: Otsu on raw gray (sometimes better than CLAHE for high-contrast prints)
    _, otsu_raw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(otsu_raw)

    return variants


def _run_tesseract(binary_crop: np.ndarray, tesseract_lang: str) -> tuple[str, float]:
    """
    Runs Tesseract on the given binarized crop with BOTH PSM 6 (assumes a
    uniform block of text) and PSM 7 (assumes a single text line), keeping
    whichever produces a higher-confidence result. Most template zones are
    single-line fields (a name, a roll number, a date) where PSM 7 is more
    accurate — but some zones span multiple lines, where PSM 6 is better.
    Trying both and picking the winner covers both cases without the caller
    needing to declare which type each zone is.
    """
    best_text = ""
    best_confidence = 0.0

    for psm in ("6", "7"):
        data = pytesseract.image_to_data(
            binary_crop,
            lang=tesseract_lang,
            output_type=pytesseract.Output.DICT,
            config=f"--psm {psm}",
        )
        words = [w.strip() for w in data["text"] if w.strip()]
        confidences = [
            int(c) for c, w in zip(data["conf"], data["text"]) if w.strip() and int(c) >= 0
        ]
        text = " ".join(words)
        avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

        if avg_confidence > best_confidence or (avg_confidence == best_confidence and len(text) > len(best_text)):
            best_text = text
            best_confidence = avg_confidence

    return best_text, best_confidence


def extract_zone(
    aligned_bgr: np.ndarray,
    field_name: str,
    box: BoundingBox,
    languages: list,
    _debug_dir: Path | None = None,
) -> OcrZoneResult:
    crop = _crop_zone(aligned_bgr, box)
    if crop.size == 0:
        return OcrZoneResult(field_name, "", 0.0, "none", True)

    # ── Debug: save the raw BGR crop ──
    if _debug_dir:
        safe_name = field_name.replace("/", "_").replace(" ", "_")
        cv2.imwrite(str(_debug_dir / f"{safe_name}_crop.png"), crop)

    binary_variants = _binarize_for_ocr(crop)

    # ── Debug: save each binarized variant ──
    if _debug_dir:
        variant_labels = ["otsu_clahe", "adaptive", "otsu_raw"]
        for i, binary in enumerate(binary_variants):
            label = variant_labels[i] if i < len(variant_labels) else f"variant{i}"
            cv2.imwrite(str(_debug_dir / f"{safe_name}_bin_{label}.png"), binary)

    tesseract_langs = [ISO_TO_TESSERACT_LANG.get(lang, lang) for lang in languages]

    attempts = []
    for binary in binary_variants:
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

    # ── Debug: log what Tesseract picked ──
    if _debug_dir:
        logger.info(
            "DEBUG OCR [%s] best='%s' conf=%.3f lang=%s  (all attempts: %s)",
            field_name, best_text, best_confidence, best_lang,
            "; ".join(f"[{l}] '{t}' ({c:.3f})" for l, t, c in attempts),
        )

    return OcrZoneResult(field_name, best_text, round(best_confidence, 3), best_lang, best_text == "")


def extract_all_zones(aligned_bgr: np.ndarray, zones: list) -> list:
    debug_dir = _get_debug_run_dir()
    if debug_dir:
        # Also save the full aligned image so you can visually check alignment
        cv2.imwrite(str(debug_dir / "_full_aligned.png"), aligned_bgr)
        logger.info("ENGINE2 DEBUG: saving crops + aligned image to %s", debug_dir)

    results = []
    for zone in zones:
        box = BoundingBox(**zone["bounding_box"])
        result = extract_zone(aligned_bgr, zone["field_name"], box, zone["languages"], _debug_dir=debug_dir)
        results.append(result)
    return results, debug_dir