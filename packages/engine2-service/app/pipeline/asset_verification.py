"""
asset_verification.py — Stage 5 of the Engine 2 pipeline.
============================================================================
Verifies the STATIC, per-template reference assets — university logo,
registrar signature, official seal, etc: the `TemplateAsset` rows a
university uploads once per template (schema.prisma's TemplateAsset model,
populated via POST /v2/templates/:id/:version/assets) — actually appear,
in the right place, on the aligned captured document, and resemble the
declared reference image closely enough to plausibly be the same mark.

DELIBERATELY OUT OF SCOPE HERE: a credential's PER-DOCUMENT assets (e.g.
one specific student's photograph). Engine 1's `credential_assets` table
holds those, addressed by content hash — comparing one particular
student's face against their captured document is a different (biometric)
problem this module does not attempt. This module only verifies the
STATIC marks that are IDENTICAL across every credential issued under a
template.

TEMPLATE-DRIVEN, NOT HARDCODED — same discipline as ocr.py: this module
has zero hardcoded asset names or positions. Every asset it checks is
declared data (a TemplateAsset row's assetName + boundingBox + reference
bytes), read as plain values.

THREE INDEPENDENT SIGNALS per asset, combined into one similarity score:

  1. STRUCTURAL SIMILARITY (SSIM, Wang et al. 2004) — sensitive to
     structural/layout differences (a logo replaced by a visibly different
     logo, a signature that's a different shape). Implemented locally with
     OpenCV primitives rather than pulling in scikit-image as a new
     dependency just for one formula — see `_ssim` below.

  2. ORB FEATURE-MATCH RATIO — tolerant of the small rotation/scale/crop
     differences a real capture introduces, which pixel-aligned SSIM is
     harsh on. Weak or unavailable on assets with too little texture (a
     plain solid-color seal, for instance) — this is a KNOWN, explicit
     limitation: `orb_match_ratio` is None when too few keypoints exist to
     attempt a meaningful match, and the combiner falls back to the other
     two signals rather than silently treating "no signal" as "no match."

  3. HISTOGRAM CORRELATION — a weak, coarse color/tone signal. Cannot
     alone distinguish "same mark" from "different mark, similar paper
     background," so it is intentionally weighted least.

Like every prior stage, no per-asset result here is a hard reject alone —
each is evidence for Stage 7's eventual confidence scoring, never a
standalone gate. A non-mandatory asset scoring poorly is meant to nudge
NEEDS_REVIEW, never REJECTED, by itself — that combination rule belongs to
Stage 7, not to this module (this module only reports `is_mandatory`
alongside the score; it does not use it to change its own output).
"""
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from app.pipeline.ocr import BoundingBox


@dataclass
class AssetVerificationResult:
    asset_name: str
    similarity: float
    is_mandatory: bool
    tier: str  # "accept" | "review" | "reject"
    ssim: Optional[float]
    orb_match_ratio: Optional[float]
    histogram_correlation: Optional[float]
    reason: str


def _tier_from_score(score: float) -> str:
    """Same 0.9/0.6 thresholds used elsewhere in the pipeline (main.py's
    field verdicts, template_matching.py) — one consistent scale."""
    if score >= 0.9:
        return "accept"
    if score >= 0.6:
        return "review"
    return "reject"


def _crop_zone(aligned_bgr: np.ndarray, box: BoundingBox) -> np.ndarray:
    """Identical cropping logic to ocr.py's `_crop_zone` — same bounding-box
    convention, deliberately not shared as an import across modules that
    otherwise remain independent (matching this codebase's existing
    per-stage-independence philosophy)."""
    height, width = aligned_bgr.shape[:2]
    x0 = max(0, box.x)
    y0 = max(0, box.y)
    x1 = min(width, box.x + box.width)
    y1 = min(height, box.y + box.height)
    return aligned_bgr[y0:y1, x0:x1]


def _ssim(gray1: np.ndarray, gray2: np.ndarray) -> float:
    """
    Windowed SSIM (Wang, Bovik, Sheikh & Simoncelli, 2004), computed with
    plain OpenCV/numpy primitives — a Gaussian-weighted local mean/
    variance/covariance comparison, exactly the standard formula, just
    without pulling in scikit-image as a dependency for it.

    Both inputs must already be same-shape grayscale float-convertible
    arrays. Window size adapts down for small crops (a signature crop can
    easily be smaller than the usual 11x11 window) so this never silently
    breaks on a small asset region.
    """
    h, w = gray1.shape[:2]
    window_size = min(11, h, w)
    if window_size % 2 == 0:
        window_size -= 1
    window_size = max(window_size, 3)

    sigma = 1.5 if window_size >= 7 else 0.8
    kernel = cv2.getGaussianKernel(window_size, sigma)
    window = kernel @ kernel.T

    img1 = gray1.astype(np.float64)
    img2 = gray2.astype(np.float64)

    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    mu1 = cv2.filter2D(img1, -1, window)
    mu2 = cv2.filter2D(img2, -1, window)
    mu1_sq, mu2_sq, mu1_mu2 = mu1 * mu1, mu2 * mu2, mu1 * mu2

    sigma1_sq = cv2.filter2D(img1 * img1, -1, window) - mu1_sq
    sigma2_sq = cv2.filter2D(img2 * img2, -1, window) - mu2_sq
    sigma12 = cv2.filter2D(img1 * img2, -1, window) - mu1_mu2

    numerator = (2 * mu1_mu2 + c1) * (2 * sigma12 + c2)
    denominator = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
    ssim_map = numerator / denominator

    return float(np.clip(ssim_map.mean(), -1.0, 1.0))


def _orb_match_ratio(gray1: np.ndarray, gray2: np.ndarray, min_keypoints: int = 8) -> Optional[float]:
    """
    Ratio of good ORB feature matches to the smaller image's total keypoint
    count. Returns None (not 0.0 — an absent signal, not a negative one) if
    either image doesn't have enough keypoints to attempt a meaningful
    match at all, e.g. a plain solid-color seal with almost no texture.
    """
    orb = cv2.ORB_create(nfeatures=500)
    kp1, des1 = orb.detectAndCompute(gray1, None)
    kp2, des2 = orb.detectAndCompute(gray2, None)

    if des1 is None or des2 is None or len(kp1) < min_keypoints or len(kp2) < min_keypoints:
        return None

    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw_matches = bf.knnMatch(des1, des2, k=2)

    # Lowe's ratio test — keeps a match only if it's meaningfully better
    # than the second-best candidate, filtering out ambiguous matches.
    good = [m for m, n in raw_matches if len(raw_matches) and m.distance < 0.75 * n.distance]

    smaller_count = min(len(kp1), len(kp2))
    return round(len(good) / smaller_count, 3) if smaller_count else None


def _histogram_correlation(bgr1: np.ndarray, bgr2: np.ndarray) -> float:
    """
    Coarse color/tone similarity via HSV histogram correlation, mapped from
    OpenCV's native [-1, 1] range to [0, 1]. Intentionally the
    lowest-weighted signal — matching background paper color is easy,
    matching the actual mark is what matters, which is why SSIM and ORB
    are weighted higher.
    """
    hsv1 = cv2.cvtColor(bgr1, cv2.COLOR_BGR2HSV)
    hsv2 = cv2.cvtColor(bgr2, cv2.COLOR_BGR2HSV)

    hist1 = cv2.calcHist([hsv1], [0, 1], None, [50, 60], [0, 180, 0, 256])
    hist2 = cv2.calcHist([hsv2], [0, 1], None, [50, 60], [0, 180, 0, 256])
    cv2.normalize(hist1, hist1)
    cv2.normalize(hist2, hist2)

    correlation = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
    return round(max(0.0, (correlation + 1.0) / 2.0), 3)


def verify_asset(
    aligned_bgr: np.ndarray,
    asset_name: str,
    box: BoundingBox,
    reference_bytes: bytes,
    is_mandatory: bool,
) -> AssetVerificationResult:
    """
    Verifies one declared TemplateAsset: crops the aligned image at its
    bounding box, decodes the reference asset bytes, resizes the reference
    to the crop's dimensions (the crop's size comes from the template's own
    declared bounding box — the reference is resized TO it, not the other
    way around, so the comparison always happens in the captured photo's
    actual resolution), and combines all three signals.
    """
    crop = _crop_zone(aligned_bgr, box)
    reference_arr = np.frombuffer(reference_bytes, dtype=np.uint8)
    reference_bgr = cv2.imdecode(reference_arr, cv2.IMREAD_COLOR)

    if crop.size == 0 or reference_bgr is None or reference_bgr.size == 0:
        return AssetVerificationResult(
            asset_name=asset_name,
            similarity=0.0,
            is_mandatory=is_mandatory,
            tier="reject",
            ssim=None,
            orb_match_ratio=None,
            histogram_correlation=None,
            reason="Asset region was empty on the captured document, or the reference image could not be decoded.",
        )

    crop_h, crop_w = crop.shape[:2]
    reference_resized = cv2.resize(reference_bgr, (crop_w, crop_h))

    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    reference_gray = cv2.cvtColor(reference_resized, cv2.COLOR_BGR2GRAY)

    ssim_score = _ssim(crop_gray, reference_gray)
    orb_ratio = _orb_match_ratio(crop_gray, reference_gray)
    hist_corr = _histogram_correlation(crop, reference_resized)

    # SSIM is in [-1, 1]; renormalize to [0, 1] before combining with the
    # other two signals, which are already in [0, 1].
    ssim_normalized = max(0.0, (ssim_score + 1.0) / 2.0)

    if orb_ratio is not None:
        combined = 0.5 * ssim_normalized + 0.3 * orb_ratio + 0.2 * hist_corr
        reason = f"SSIM {ssim_score:.3f}, ORB match ratio {orb_ratio:.3f}, histogram correlation {hist_corr:.3f}."
    else:
        # Redistribute ORB's weight to SSIM (the stronger remaining signal)
        # rather than silently treating "no ORB signal" as "ORB score 0" —
        # a textureless seal isn't evidence of mismatch, just evidence ORB
        # has nothing to work with here.
        combined = 0.7 * ssim_normalized + 0.3 * hist_corr
        reason = (
            f"SSIM {ssim_score:.3f}, histogram correlation {hist_corr:.3f} "
            f"(ORB found too few keypoints on this asset to attempt feature matching)."
        )

    combined = round(float(min(1.0, max(0.0, combined))), 3)

    return AssetVerificationResult(
        asset_name=asset_name,
        similarity=combined,
        is_mandatory=is_mandatory,
        tier=_tier_from_score(combined),
        ssim=round(ssim_score, 3),
        orb_match_ratio=orb_ratio,
        histogram_correlation=hist_corr,
        reason=reason,
    )


def verify_all_assets(aligned_bgr: np.ndarray, assets: list) -> list:
    """
    Convenience wrapper running verify_asset() over every declared asset —
    same shape of convenience function as ocr.py's `extract_all_zones`.

    @param assets: list of dicts, each shaped like:
        {"asset_name": str, "bounding_box": {"x","y","width","height"},
         "reference_bytes": bytes, "is_mandatory": bool}
    """
    results = []
    for asset in assets:
        box = BoundingBox(**asset["bounding_box"])
        result = verify_asset(
            aligned_bgr,
            asset["asset_name"],
            box,
            asset["reference_bytes"],
            asset["is_mandatory"],
        )
        results.append(result)
    return results