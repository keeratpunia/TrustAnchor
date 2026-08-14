"""
qr_detection.py — shared QR-corner detection used by BOTH homography.py
(Stage 2, aligning the raw captured photo) and template_matching.py
(Stage 4, redetecting the QR in the already-aligned image to measure
drift).

WHY THIS IS ITS OWN MODULE: both call sites need the exact same
robustness — a single `cv2.QRCodeDetector().detect()` call fails often
enough on real phone photos (skew, glare, small QR-to-frame ratio, uneven
lighting) that treating one miss as "no QR present" produces false
REJECTED verdicts on genuine documents. Originally each call site had its
own copy of this logic, which meant fixing one left the other silently
using the weaker version — the exact bug this module exists to prevent
from recurring. There is now exactly one QR-detection implementation in
the whole pipeline.

Deliberately does not decode/verify the QR's content — this only cares
about physical position for geometric alignment/drift measurement, never
content or cryptography (Engine 1's frozen responsibility).

DETECTOR STACK (tried in order):
  1. OpenCV's QRCodeDetector on multiple image variants (original,
     CLAHE, adaptive threshold, upscaled) × single + multi paths.
  2. pyzbar (zbar) fallback — dramatically more robust on real phone
     photos with glare, blur, and small QR-to-frame ratios. Installed
     via `pip install pyzbar` + system zbar library.

pyzbar returns a bounding polygon, not the 4 corners OpenCV's detector
does — `_polygon_to_corners` converts pyzbar's polygon into the same
(TL, TR, BR, BL) ordered corner array the rest of the pipeline expects.
"""
import logging
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("engine2.qr_detection")

# ── pyzbar availability ───────────────────────────────────────────────
# Optional dependency: if pyzbar is installed (pip install pyzbar) and
# the system zbar library is present, we use it as a fallback when
# OpenCV's detector fails. If not installed, the pipeline still works
# with just OpenCV — pyzbar merely adds robustness.
try:
    from pyzbar.pyzbar import decode as _pyzbar_decode, ZBarSymbol
    _HAS_PYZBAR = True
    logger.info("pyzbar available — will use as QR detection fallback")
except ImportError:
    _HAS_PYZBAR = False
    logger.info("pyzbar not installed — using OpenCV QR detector only. "
                "For better detection robustness, install pyzbar: "
                "pip install pyzbar (+ system zbar library)")


def _qr_candidate_images(bgr_image: np.ndarray) -> list[tuple[np.ndarray, float, float]]:
    """
    Builds a set of alternate renderings of the same photo, each tuned
    to help QR detection succeed under different real-world failure modes.
    Returns (image, scale_x, scale_y) tuples so detected coordinates can
    be mapped back to the original image's coordinate system.

    Order: cheapest / most-likely-to-work-and-be-accurate first.
    """
    gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)

    # CLAHE-normalized grayscale — helps with uneven lighting/glare.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    clahe_gray = clahe.apply(gray)

    # Adaptive threshold — helps with low contrast QR.
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 5
    )
    adaptive_bgr = cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)

    # Sharpened version — helps with slightly out-of-focus phone photos.
    sharpening_kernel = np.array([[-1, -1, -1],
                                  [-1,  9, -1],
                                  [-1, -1, -1]], dtype=np.float32)
    sharpened = cv2.filter2D(bgr_image, -1, sharpening_kernel)

    # Aggressive CLAHE — for severely washed-out / high-glare photos.
    clahe_aggressive = cv2.createCLAHE(clipLimit=6.0, tileGridSize=(4, 4))
    aggressive_gray = clahe_aggressive.apply(gray)

    # Upscaled variants — helps when QR is small in frame.
    upscaled_2x = cv2.resize(
        cv2.cvtColor(clahe_gray, cv2.COLOR_GRAY2BGR),
        None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC,
    )
    upscaled_3x = cv2.resize(
        cv2.cvtColor(clahe_gray, cv2.COLOR_GRAY2BGR),
        None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC,
    )

    # Otsu binarization — sometimes works when adaptive threshold doesn't.
    _, otsu = cv2.threshold(clahe_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    otsu_bgr = cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)

    return [
        (bgr_image,                                             1.0, 1.0),
        (cv2.cvtColor(clahe_gray, cv2.COLOR_GRAY2BGR),          1.0, 1.0),
        (sharpened,                                              1.0, 1.0),
        (adaptive_bgr,                                           1.0, 1.0),
        (cv2.cvtColor(aggressive_gray, cv2.COLOR_GRAY2BGR),     1.0, 1.0),
        (otsu_bgr,                                               1.0, 1.0),
        (upscaled_2x,                                            0.5, 0.5),
        (upscaled_3x,                                       1.0/3.0, 1.0/3.0),
    ]


def _try_opencv_detect(bgr_image: np.ndarray) -> Optional[np.ndarray]:
    """
    Tries OpenCV's QRCodeDetector on all candidate image variants.
    Returns (4, 2) float32 corners in ORIGINAL image coordinates, or None.
    """
    detector = cv2.QRCodeDetector()

    for candidate, scale_x, scale_y in _qr_candidate_images(bgr_image):
        # Single-QR path
        ok, points = detector.detect(candidate)
        if ok and points is not None:
            corners = points.reshape(4, 2).astype(np.float32)
            corners[:, 0] *= scale_x
            corners[:, 1] *= scale_y
            return corners

        # Multi-QR path — different internal detection strategy.
        try:
            ok_multi, decoded_info, points_multi, _ = detector.detectAndDecodeMulti(candidate)
        except cv2.error:
            ok_multi, points_multi = False, None
        if ok_multi and points_multi is not None and len(points_multi) > 0:
            corners = points_multi[0].astype(np.float32)
            corners[:, 0] *= scale_x
            corners[:, 1] *= scale_y
            return corners

    return None


def _polygon_to_corners(polygon_points: np.ndarray) -> np.ndarray:
    """
    Converts a polygon (as returned by pyzbar — typically 4 points but
    not guaranteed to be in TL/TR/BR/BL order) into the same ordered
    (TL, TR, BR, BL) corner format OpenCV's QRCodeDetector returns.
    """
    pts = polygon_points.astype(np.float32)
    if len(pts) != 4:
        # If pyzbar returned more or fewer than 4 points, fit a
        # minimum-area rotated rectangle and use its 4 corners.
        rect = cv2.minAreaRect(pts)
        pts = cv2.boxPoints(rect).astype(np.float32)

    # Order: TL = smallest x+y, BR = largest x+y,
    #         TR = smallest y-x, BL = largest y-x
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]       # top-left
    ordered[1] = pts[np.argmin(diff)]    # top-right
    ordered[2] = pts[np.argmax(s)]       # bottom-right
    ordered[3] = pts[np.argmax(diff)]    # bottom-left
    return ordered


def _try_pyzbar_detect(bgr_image: np.ndarray) -> Optional[np.ndarray]:
    """
    Tries pyzbar (zbar) on multiple image variants as a fallback when
    OpenCV's detector fails. Returns (4, 2) float32 corners in ORIGINAL
    image coordinates, or None.
    """
    if not _HAS_PYZBAR:
        return None

    for candidate, scale_x, scale_y in _qr_candidate_images(bgr_image):
        gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY) if len(candidate.shape) == 3 else candidate
        results = _pyzbar_decode(gray, symbols=[ZBarSymbol.QRCODE])
        if results:
            # Take the first (largest / highest-confidence) QR found.
            qr = results[0]
            polygon = np.array([(p.x, p.y) for p in qr.polygon], dtype=np.float32)
            corners = _polygon_to_corners(polygon)
            # Scale back to original image coordinates.
            corners[:, 0] *= scale_x
            corners[:, 1] *= scale_y
            return corners

    return None


def detect_qr_corners(bgr_image: np.ndarray) -> Optional[np.ndarray]:
    """
    Detects a QR code's four corner points in the image using a two-layer
    detector stack (OpenCV primary, pyzbar fallback), each trying multiple
    image preprocessing variants.

    Returns a (4, 2) float32 array of corners in (top-left, top-right,
    bottom-right, bottom-left) order, in ORIGINAL bgr_image pixel
    coordinates — or None if no QR is found by either detector.
    """
    # Layer 1: OpenCV's built-in QRCodeDetector
    corners = _try_opencv_detect(bgr_image)
    if corners is not None:
        logger.debug("QR detected by OpenCV")
        return corners

    # Layer 2: pyzbar (zbar) fallback
    corners = _try_pyzbar_detect(bgr_image)
    if corners is not None:
        logger.debug("QR detected by pyzbar (OpenCV failed)")
        return corners

    logger.debug("QR not detected by any detector")
    return None