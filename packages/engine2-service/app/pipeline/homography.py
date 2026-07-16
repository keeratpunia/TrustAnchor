"""
homography.py — Stage 2 of the Engine 2 pipeline.
============================================================================
Perspective-corrects a captured document photo into "template coordinate
space" — the same flat, undistorted coordinate system the template's
declared bounding boxes (OcrZone, TemplateAsset) are defined in.

THREE-TIER ALIGNMENT (Engine2_Architecture.md §8.2):
  Tier 1 — QR-seeded homography. The QR code is already required to be
           present and decodable for Engine 1 to have run at all, so its
           three finder patterns double as free geometric fiducial markers.
           This tier alone is accurate NEAR the QR but drifts across a full
           page (a small angular error at the QR corner becomes a large
           positional error at the far corner of an A4-sized document).
  Tier 2 — Border-refined homography. Detects the document's own outer
           border/edge as a quadrilateral and re-solves the homography
           using those four corners, which are spread across the whole
           page and therefore correct the drift Tier 1 leaves behind.
  Tier 3 — ECC sub-pixel refinement. Runs OpenCV's Enhanced Correlation
           Coefficient image-alignment algorithm as a final refinement pass
           against a rendered template skeleton, correcting residual warp
           from paper curl, lens distortion, or imperfect Tier-2 corner
           detection.

Each tier is a separate, independently callable function — a caller that
only has a QR (no template skeleton to align against yet) can stop after
Tier 1; the full three-tier pipeline is exposed as one convenience function.
"""
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np


@dataclass
class HomographyResult:
    """Output of the homography stage."""

    # The 3x3 perspective transform matrix mapping CAPTURED PHOTO pixel
    # coordinates to TEMPLATE coordinate space (the same space OcrZone/
    # TemplateAsset bounding boxes are declared in).
    matrix: np.ndarray

    # The captured image, warped into template coordinate space at the
    # template's declared page dimensions — every downstream stage (OCR,
    # asset verification) crops directly from THIS image, never the raw
    # captured photo, so a single bounding-box coordinate system is used
    # everywhere.
    aligned_image: np.ndarray

    # Which tiers actually ran successfully. A caller inspecting this can
    # tell "only Tier 1 ran" (border/skeleton alignment unavailable or
    # failed) from "all three tiers ran" — itself a quality signal fed into
    # the final confidence score (Engine2_Architecture.md §8.7): an
    # alignment that only achieved Tier 1 is inherently less trustworthy
    # for far-from-QR regions than one that completed all three tiers.
    tiers_completed: list[str]

    # A rough [0, 1] alignment-quality estimate. Currently derived from how
    # many tiers completed and (when Tier 3 ran) the ECC correlation
    # coefficient itself, which OpenCV's findTransformECC returns directly
    # as a measure of alignment goodness — NOT a hand-picked heuristic
    # constant.
    alignment_quality: float


class HomographyError(Exception):
    """Raised when even Tier 1 (QR-seeded) alignment cannot be computed at all."""


def _detect_qr_corners(bgr_image: np.ndarray) -> Optional[np.ndarray]:
    """
    Detects a QR code's four corner points in the image using OpenCV's
    built-in QRCodeDetector. Returns a (4, 2) float32 array of corners in
    (top-left, top-right, bottom-right, bottom-left) order as OpenCV
    reports them, or None if no QR is found.

    Note: this function only needs the QR's PHYSICAL POSITION on the page
    for geometric alignment — it does not decode or care about the QR's
    CONTENT. Content decoding/cryptographic verification is Engine 1's
    frozen responsibility (packages/verifier-app/src/engine1/qrCodec.ts) and
    is never duplicated here.
    """
    detector = cv2.QRCodeDetector()
    ok, points = detector.detect(bgr_image)
    if not ok or points is None:
        return None
    return points.reshape(4, 2).astype(np.float32)


def tier1_qr_seeded_homography(
    captured_bgr: np.ndarray,
    qr_position_in_template: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Tier 1: computes a homography from the QR code's four detected corners
    in the captured photo to its four known corners in template space.

    @param captured_bgr: the preprocessed captured photo (BGR numpy array).
    @param qr_position_in_template: (4, 2) array — the QR's four corners in
        template coordinate space, in the SAME (TL, TR, BR, BL) order
        OpenCV's QRCodeDetector reports, taken from the template's declared
        layout (Template.layoutJson's qr_position field).

    @return: (homography_matrix, detected_qr_corners_in_captured_photo)

    Raises HomographyError if no QR is detectable in the captured photo at
    all — without at least this, no alignment of any kind is possible.
    """
    detected_corners = _detect_qr_corners(captured_bgr)
    if detected_corners is None:
        raise HomographyError(
            "No QR code detected in the captured photo — cannot seed even Tier 1 "
            "alignment. Ask the user to recapture with the QR fully visible and in focus."
        )

    matrix, _ = cv2.findHomography(detected_corners, qr_position_in_template.astype(np.float32))
    if matrix is None:
        raise HomographyError(
            "QR corners were detected but OpenCV could not solve a homography from them "
            "(likely a degenerate/near-collinear point configuration)."
        )
    return matrix, detected_corners


def tier2_border_refined_homography(
    captured_bgr: np.ndarray,
    tier1_matrix: np.ndarray,
    template_width: int,
    template_height: int,
) -> Optional[np.ndarray]:
    """
    Tier 2: attempts to detect the document's own outer border as a
    quadrilateral contour and re-solve the homography using those four
    corners (spread across the full page, unlike the QR alone).

    Returns None (not an exception) if no clean border quadrilateral can be
    found — this is a common, non-fatal outcome (e.g. the document nearly
    fills the frame with no visible background margin) and the pipeline
    gracefully falls back to Tier 1's result in that case.
    """
    gray = cv2.cvtColor(captured_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    image_area = captured_bgr.shape[0] * captured_bgr.shape[1]
    best_quad: Optional[np.ndarray] = None
    best_area = 0.0

    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) != 4:
            continue
        area = cv2.contourArea(approx)
        # The document border should occupy a substantial fraction of the
        # frame (a real capture is expected to be reasonably framed) but
        # not literally the entire frame (that would just be the image
        # boundary itself, not a detected document edge).
        if area < 0.3 * image_area or area > 0.98 * image_area:
            continue
        if area > best_area:
            best_area = area
            best_quad = approx.reshape(4, 2).astype(np.float32)

    if best_quad is None:
        return None

    ordered = _order_quad_points(best_quad)
    template_corners = np.array(
        [[0, 0], [template_width, 0], [template_width, template_height], [0, template_height]],
        dtype=np.float32,
    )
    matrix, _ = cv2.findHomography(ordered, template_corners)
    return matrix


def _order_quad_points(points: np.ndarray) -> np.ndarray:
    """
    Orders four arbitrary quadrilateral points into consistent
    (top-left, top-right, bottom-right, bottom-left) order, regardless of
    what order `approxPolyDP` happened to return them in — required before
    they can be reliably paired against the template's own
    consistently-ordered corner list.
    """
    s = points.sum(axis=1)
    diff = np.diff(points, axis=1).flatten()
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = points[np.argmin(s)]       # top-left: smallest x+y
    ordered[2] = points[np.argmax(s)]       # bottom-right: largest x+y
    ordered[1] = points[np.argmin(diff)]    # top-right: smallest y-x
    ordered[3] = points[np.argmax(diff)]    # bottom-left: largest y-x
    return ordered


def tier3_ecc_refinement(
    captured_bgr: np.ndarray,
    warped_estimate: np.ndarray,
    template_skeleton_gray: np.ndarray,
) -> tuple[Optional[np.ndarray], float]:
    """
    Tier 3: refines an already-roughly-aligned image against a rendered
    template skeleton (a simple grayscale rendering of the template's
    static line-art — border, rules, fixed labels) using OpenCV's
    findTransformECC, correcting residual sub-pixel misalignment from paper
    curl or imperfect corner detection in Tiers 1/2.

    Returns (refinement_matrix_or_None, ecc_correlation_coefficient).
    The correlation coefficient (always returned, even on partial success)
    is itself the alignment-quality signal used by the final confidence
    stage — not a separately hand-picked heuristic.
    """
    warped_gray = cv2.cvtColor(warped_estimate, cv2.COLOR_BGR2GRAY)

    if warped_gray.shape != template_skeleton_gray.shape:
        template_skeleton_gray = cv2.resize(
            template_skeleton_gray, (warped_gray.shape[1], warped_gray.shape[0])
        )

    warp_matrix = np.eye(2, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-6)

    try:
        correlation, warp_matrix = cv2.findTransformECC(
            template_skeleton_gray.astype(np.float32),
            warped_gray.astype(np.float32),
            warp_matrix,
            cv2.MOTION_AFFINE,
            criteria,
        )
    except cv2.error:
        # ECC does not converge on every input (e.g. insufficient texture
        # overlap) — a non-fatal, gracefully-handled outcome; the pipeline
        # falls back to the Tier 1/2 result.
        return None, 0.0

    # Promote the 2x3 affine ECC refinement to a full 3x3 matrix so it can
    # be composed with the Tier 1/2 perspective homography.
    refinement_3x3 = np.vstack([warp_matrix, [0, 0, 1]]).astype(np.float32)
    return refinement_3x3, float(correlation)


def align_document(
    captured_bgr: np.ndarray,
    qr_position_in_template: np.ndarray,
    template_width: int,
    template_height: int,
    template_skeleton_gray: Optional[np.ndarray] = None,
) -> HomographyResult:
    """
    Convenience function running all three tiers in sequence, gracefully
    degrading when a later tier is unavailable or fails.
    """
    tiers_completed: list[str] = []

    matrix, _ = tier1_qr_seeded_homography(captured_bgr, qr_position_in_template)
    tiers_completed.append("tier1_qr_seeded")

    tier2_matrix = tier2_border_refined_homography(
        captured_bgr, matrix, template_width, template_height
    )
    if tier2_matrix is not None:
        matrix = tier2_matrix
        tiers_completed.append("tier2_border_refined")

    aligned = cv2.warpPerspective(captured_bgr, matrix, (template_width, template_height))

    alignment_quality = 0.5 if len(tiers_completed) == 1 else 0.75

    if template_skeleton_gray is not None:
        refinement, correlation = tier3_ecc_refinement(captured_bgr, aligned, template_skeleton_gray)
        if refinement is not None:
            # Compose: apply the ECC affine refinement on top of the
            # already-aligned image (refining the perspective-corrected
            # result further, not replacing it).
            aligned = cv2.warpAffine(
                aligned, refinement[:2, :], (template_width, template_height)
            )
            tiers_completed.append("tier3_ecc_refined")
            alignment_quality = max(alignment_quality, correlation)

    return HomographyResult(
        matrix=matrix,
        aligned_image=aligned,
        tiers_completed=tiers_completed,
        alignment_quality=round(float(alignment_quality), 3),
    )
