"""
preprocessing.py — Stage 1 of the Engine 2 pipeline.
============================================================================
Normalizes a captured document photo before any downstream stage touches it.
This stage is deliberately "dumb" — it does not know or care about templates,
QR codes, or OCR zones. It only fixes generic photo-capture problems so that
every later stage receives a consistent, well-behaved image.

Independently testable: takes raw image bytes in, returns a normalized image
plus metadata out. No dependency on any other pipeline stage.
"""
from dataclasses import dataclass, field
import io

import cv2
import numpy as np
from PIL import Image, ImageOps

# Downscaling bound: keeps homography/OCR compute cost predictable regardless
# of how large a modern phone camera's original photo is. 2000px on the
# longer side comfortably preserves enough detail for both QR detection and
# OCR of reasonably-sized text zones, while keeping every downstream stage's
# runtime bounded.
MAX_DIMENSION_PX = 2000


@dataclass
class PreprocessResult:
    """Output of the preprocessing stage."""

    # The normalized image, as a BGR numpy array (OpenCV's native format) —
    # every downstream stage (homography, OCR) consumes this array directly,
    # never re-deriving it from the original bytes.
    image: np.ndarray

    original_width: int
    original_height: int
    normalized_width: int
    normalized_height: int

    # A heuristic signal in [0, 1] — HIGHER means MORE LIKELY to be a
    # screenshot rather than a genuine physical-camera photo. This is
    # explicitly a piece of evidence for the final confidence scoring stage
    # (Engine2_Architecture.md §8.7), never a hard reject on its own — see
    # the docstring on `_screenshot_heuristic_score` for exactly what it
    # checks and why it cannot be a certainty.
    screenshot_likelihood: float

    # Non-fatal observations surfaced to the caller (e.g. "image was very
    # small before upscaling would have been needed" — noted, not corrected,
    # since upscaling can't recover detail that was never captured).
    warnings: list[str] = field(default_factory=list)


def _correct_exif_orientation(pil_image: Image.Image) -> Image.Image:
    """
    Applies the EXIF orientation tag (if present) so the image is stored
    right-side-up in pixel data, not just "logically" rotated per metadata.
    Many phone cameras write photos in sensor orientation and rely on the
    EXIF tag for display rotation; OpenCV and most CV operations ignore EXIF
    entirely and must operate on already-corrected pixel data.
    """
    return ImageOps.exif_transpose(pil_image)


def _downscale_if_needed(pil_image: Image.Image, max_dim: int) -> tuple[Image.Image, list[str]]:
    """Downscales so the longer side is at most `max_dim`, preserving aspect ratio."""
    warnings: list[str] = []
    width, height = pil_image.size
    longer_side = max(width, height)

    if longer_side <= max_dim:
        if longer_side < 800:
            warnings.append(
                f"Captured image is quite small ({width}x{height}); OCR and homography "
                "accuracy may be reduced. This is noted, not corrected — upscaling cannot "
                "recover detail that was never captured."
            )
        return pil_image, warnings

    scale = max_dim / longer_side
    new_size = (int(width * scale), int(height * scale))
    return pil_image.resize(new_size, Image.LANCZOS), warnings


def _apply_clahe(bgr_image: np.ndarray) -> np.ndarray:
    """
    Lighting normalization via CLAHE (Contrast Limited Adaptive Histogram
    Equalization) applied to the L channel of LAB color space. This
    corrects for uneven lighting (a common shadow/glare artifact when
    photographing a physical document) without distorting color balance,
    which a naive global histogram equalization would do.
    """
    lab = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel_eq = clahe.apply(l_channel)

    lab_eq = cv2.merge((l_channel_eq, a_channel, b_channel))
    return cv2.cvtColor(lab_eq, cv2.COLOR_LAB2BGR)


def _screenshot_heuristic_score(pil_image: Image.Image, bgr_image: np.ndarray) -> float:
    """
    Produces a HEURISTIC, NOT DEFINITIVE, screenshot-likelihood score.

    WHY THIS CANNOT BE A CERTAINTY (documented explicitly, per
    Engine2_Architecture.md §8.1): there is no single reliable signal that
    definitively distinguishes "a screenshot of a document" from "a photo of
    a printed document," especially once a screenshot itself gets
    re-photographed or re-compressed. This function combines two weak,
    independent signals into a single score, contributing evidence to the
    final confidence stage — it is never used to hard-reject a document on
    its own.

    Signal 1 — aspect ratio proximity to common device screen ratios
    (16:9, 19.5:9, 4:3 tablet, etc.). A genuine photo of an A4/letter
    document, taken at a normal angle, rarely lands exactly on these ratios;
    a screenshot of a document-viewing app frequently does.

    Signal 2 — edge/noise characteristics. A real camera photo of a
    physical, lit document has natural sensor noise and slight blur/lens
    characteristics; a screenshot re-encoded as an image tends to have
    unnaturally sharp, low-noise edges from digital rendering. Approximated
    here via the variance of the Laplacian (a standard blur-detection
    proxy) compared against an expected range for genuine photographs.
    """
    width, height = pil_image.size
    aspect = width / height if height else 1.0

    common_screen_ratios = [16 / 9, 9 / 16, 19.5 / 9, 9 / 19.5, 4 / 3, 3 / 4]
    aspect_signal = min(abs(aspect - r) for r in common_screen_ratios)
    # Closer to zero difference = more suspicious. Normalize to [0, 1].
    aspect_score = max(0.0, 1.0 - (aspect_signal / 0.05))

    gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    # Very high sharpness (low blur) across the WHOLE image is somewhat
    # unusual for a hand-held camera photo of a physical document; this
    # threshold is intentionally conservative (only contributes a partial
    # signal) since a very steady, well-focused photo can also be sharp.
    sharpness_score = 1.0 if laplacian_var > 4000 else 0.0

    # Weighted combination — aspect ratio is a stronger, more specific
    # signal than the noise proxy, hence the higher weight.
    return round(min(1.0, 0.7 * aspect_score + 0.3 * sharpness_score), 3)


def preprocess(image_bytes: bytes) -> PreprocessResult:
    """
    Runs the complete preprocessing stage on raw image bytes.

    Raises ValueError if the bytes cannot be decoded as an image at all —
    this is the ONLY hard failure this stage produces; everything else
    (small size, screenshot likelihood) is surfaced as metadata for later
    stages/the final confidence score to weigh, not an immediate rejection.
    """
    try:
        pil_image = Image.open(io.BytesIO(image_bytes))
        pil_image.load()
    except Exception as exc:
        raise ValueError(f"Could not decode image bytes: {exc}") from exc

    original_width, original_height = pil_image.size

    pil_image = _correct_exif_orientation(pil_image)
    if pil_image.mode != "RGB":
        pil_image = pil_image.convert("RGB")

    pil_image, size_warnings = _downscale_if_needed(pil_image, MAX_DIMENSION_PX)

    # PIL is RGB; OpenCV expects BGR — convert once, here, so every
    # downstream stage can assume BGR without re-checking.
    bgr_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

    screenshot_likelihood = _screenshot_heuristic_score(pil_image, bgr_image)

    normalized_image = _apply_clahe(bgr_image)

    normalized_height, normalized_width = normalized_image.shape[:2]

    return PreprocessResult(
        image=normalized_image,
        original_width=original_width,
        original_height=original_height,
        normalized_width=normalized_width,
        normalized_height=normalized_height,
        screenshot_likelihood=screenshot_likelihood,
        warnings=size_warnings,
    )
