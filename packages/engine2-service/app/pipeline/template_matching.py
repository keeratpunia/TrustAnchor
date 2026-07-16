"""
template_matching.py — Stage 4 of the Engine 2 pipeline.
============================================================================
Answers a narrower question than homography.py already answers. Homography
answers "can we compute SOME transform between this photo and this
template's declared coordinate space" — and it can very often find one, as
long as A QR code is visible somewhere in the photo, regardless of whether
it's actually the RIGHT template's document. A university's templates
typically share broadly similar page geometry (similar page size, QR in a
similar corner), so a photo of Template B's document can still
homography-"align successfully" against Template A's declared qr_position
and page dimensions — the result would just be systematically wrong.

Stage 4 is the layer that catches "this homography-aligned without error,
but does not actually look like a genuine instance of the CLAIMED
template."

TWO INDEPENDENT SIGNALS, combined into one template_match_score:

  1. QR REDETECTION DRIFT (always available). The QR is already required
     to be present and decodable for Engine 1 to have run at all
     (schema.prisma / homography.py's own Tier 1 requires it). After
     homography has produced the aligned image, this stage re-detects the
     QR IN THAT ALIGNED IMAGE and measures how far it landed from the
     template's declared qr_position. A genuine match of the claimed
     template should land the QR almost exactly on its declared position —
     that is precisely what the alignment transform was built to
     accomplish. Drift here means either: the wrong template was claimed,
     the alignment only achieved a weak Tier-1-only fit, or something is
     structurally off about this specific capture.

  2. SKELETON CORRELATION (optional). If the caller supplies a rendered
     template skeleton image (e.g. a flat, undistorted render of the
     template's fixed line art — border, rule lines, fixed labels — the
     same kind of image homography.py's own Tier 3 already knows how to
     consume), this stage computes a whole-page normalized cross-
     correlation between the aligned image and that skeleton. This is the
     stronger signal when available, but no template is required to have
     one — see this module's NOTE below on why that storage doesn't exist
     yet in the current schema.

NOTE — persisted template skeletons don't exist yet: schema.prisma's
Template/TemplateAsset tables have nowhere-in-particular to store "a flat
render of this template" today. The cleanest path when this is needed is
almost certainly NOT a new table — it's uploading it as an ordinary
TemplateAsset row with a reserved assetName (e.g. "template_skeleton") via
the existing POST /v2/templates/:id/:version/assets endpoint, then passing
its bytes into `compute_template_match` below as `skeleton_gray`. This
module is written to work correctly today WITHOUT one (QR drift alone),
and to immediately benefit the moment one is wired in — no signature
change needed on the calling side beyond passing a non-None skeleton.

Neither signal is a hard reject on its own — like preprocessing's
screenshot_likelihood and homography's alignment_quality, both are
evidence for the eventual confidence-scoring stage (Stage 7) to weigh.
Stage 4 packages them into one score + tier, not a standalone gate.
"""
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np


@dataclass
class TemplateMatchResult:
    """Output of the template-matching stage."""

    # Combined [0, 1] score — higher means more confidently "this really is
    # the claimed template," not just "some transform was computable."
    template_match_score: float

    # "accept" | "review" | "reject" — same three-tier vocabulary as
    # main.py's field verdicts and the eventual asset verdicts, so a
    # consumer of Engine2PipelineResponse doesn't have to learn a second
    # scale.
    tier: str

    # Pixel distance between the QR's declared template position and where
    # it was actually redetected in the aligned image, or None if the QR
    # could not be redetected in the aligned image at all (itself a strong
    # negative signal, reflected in a low score/tier rather than raising).
    qr_drift_px: Optional[float]

    # Whether a skeleton image was supplied and used. False does not mean
    # failure — it means the score rests on QR drift alone, which is
    # weaker evidence than having both signals; a consumer can use this
    # flag to weigh the score's reliability accordingly.
    used_skeleton: bool

    # Present only when used_skeleton is True. Normalized cross-correlation
    # in [-1, 1] between the aligned image and the supplied skeleton.
    skeleton_correlation: Optional[float]

    reason: str


def _tier_from_score(score: float) -> str:
    """Same 0.9/0.6 thresholds used for field verdicts in main.py, kept
    consistent across the codebase rather than inventing a second scale."""
    if score >= 0.9:
        return "accept"
    if score >= 0.6:
        return "review"
    return "reject"


def redetect_qr_and_measure_drift(
    aligned_bgr: np.ndarray,
    qr_position_in_template: np.ndarray,
) -> Optional[float]:
    """
    Redetects the QR code in the ALREADY-ALIGNED image and returns the mean
    pixel distance between its four detected corners and the four corners
    the template declares (qr_position_in_template, the same (4, 2) array
    homography.py's Tier 1 consumes). Returns None if no QR is detectable
    in the aligned image at all.

    Deliberately does not decode/verify the QR's content — exactly like
    homography.py's own `_detect_qr_corners`, this only cares about
    physical position, never content or cryptography (Engine 1's frozen
    responsibility).
    """
    detector = cv2.QRCodeDetector()
    ok, points = detector.detect(aligned_bgr)
    if not ok or points is None:
        return None

    detected = points.reshape(4, 2).astype(np.float32)
    declared = np.asarray(qr_position_in_template, dtype=np.float32)

    # The detector doesn't guarantee the same corner ORDER homography.py's
    # Tier 1 used when it originally solved for this alignment, so pair
    # each declared corner with its NEAREST detected corner rather than
    # assuming matching indices line up — an ordering mismatch would
    # otherwise show up as spurious "drift" that isn't really there.
    total_distance = 0.0
    remaining = detected.copy()
    for declared_pt in declared:
        distances = np.linalg.norm(remaining - declared_pt, axis=1)
        nearest_idx = int(np.argmin(distances))
        total_distance += float(distances[nearest_idx])
        remaining = np.delete(remaining, nearest_idx, axis=0)

    return total_distance / 4.0


def skeleton_correlation(aligned_bgr: np.ndarray, skeleton_gray: np.ndarray) -> float:
    """
    Whole-page normalized cross-correlation between the aligned image and a
    reference template skeleton, both resized to the same shape first (they
    should already match — both are template-coordinate-space images at the
    template's declared page dimensions — resizing here is only a defensive
    guard against a caller passing a mismatched skeleton).

    Returns a value in [-1, 1]; 1.0 means a perfect linear match.
    """
    aligned_gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY).astype(np.float64)
    skeleton = skeleton_gray.astype(np.float64)

    if aligned_gray.shape != skeleton.shape:
        skeleton = cv2.resize(skeleton, (aligned_gray.shape[1], aligned_gray.shape[0]))

    a = aligned_gray - aligned_gray.mean()
    b = skeleton - skeleton.mean()
    denom = np.sqrt(np.sum(a * a) * np.sum(b * b))
    if denom == 0:
        return 0.0
    return float(np.sum(a * b) / denom)


def compute_template_match(
    aligned_bgr: np.ndarray,
    qr_position_in_template: np.ndarray,
    skeleton_gray: Optional[np.ndarray] = None,
    drift_tolerance_px: float = 15.0,
) -> TemplateMatchResult:
    """
    Runs the full Stage 4 check and returns one combined result.

    @param drift_tolerance_px: the drift (in pixels) at which the QR-drift
        component of the score has fallen to roughly 2/3 — chosen from this
        project's own observed real-fixture behavior (README.md's homography
        section reports a freshly-redetected QR landing within ~15px of its
        declared position on a genuinely correct, well-aligned match).
    """
    qr_drift_px = redetect_qr_and_measure_drift(aligned_bgr, qr_position_in_template)

    if qr_drift_px is None:
        qr_score = 0.0
    else:
        # Smooth falloff: 0px drift -> 1.0, drift_tolerance_px -> ~0.67,
        # 3x tolerance -> 0.0. Never negative.
        qr_score = max(0.0, 1.0 - (qr_drift_px / (3.0 * drift_tolerance_px)))

    used_skeleton = skeleton_gray is not None
    skel_corr: Optional[float] = None

    if used_skeleton:
        skel_corr = skeleton_correlation(aligned_bgr, skeleton_gray)  # type: ignore[arg-type]
        # Map correlation from [-1, 1] to a [0, 1] score.
        skel_score = max(0.0, (skel_corr + 1.0) / 2.0)
        combined = 0.5 * qr_score + 0.5 * skel_score
    else:
        combined = qr_score

    combined = round(float(min(1.0, max(0.0, combined))), 3)
    tier = _tier_from_score(combined)

    if qr_drift_px is None:
        reason = (
            "Could not redetect the QR code in the aligned image at all — "
            "this is a strong signal the alignment or the claimed template "
            "is wrong, not just imprecise."
        )
    elif not used_skeleton:
        reason = (
            f"QR redetected {qr_drift_px:.1f}px from its declared template "
            f"position (no reference skeleton was supplied, so this score "
            f"rests on QR drift alone — see this module's NOTE on skeleton "
            f"storage)."
        )
    else:
        reason = (
            f"QR redetected {qr_drift_px:.1f}px from its declared position; "
            f"skeleton correlation {skel_corr:.3f}."
        )

    return TemplateMatchResult(
        template_match_score=combined,
        tier=tier,
        qr_drift_px=qr_drift_px,
        used_skeleton=used_skeleton,
        skeleton_correlation=skel_corr,
        reason=reason,
    )