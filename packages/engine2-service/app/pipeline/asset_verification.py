"""
asset_verification.py — Stage 5 of the Engine 2 pipeline.
============================================================================
Verifies that declared template assets (logos, seals, signatures) appear on
the captured document in the right place and resemble the reference.

TWO VERIFICATION STRATEGIES, chosen per-asset by analysing the reference:

  1. STRUCTURAL MATCH (logos, seals, printed crests) — SSIM, ORB feature
     matching, histogram correlation. Works well when both the reference
     and the capture contain a reproducible, printed graphic with stable
     features across different prints of the same template.

  2. PRESENCE CHECK (handwritten signatures) — verifies that significant
     ink/marks exist in the expected region, with a similar spatial
     distribution and stroke density to the reference. Does NOT attempt
     pixel-identity matching, because a handwritten signature photographed
     by a phone camera will NEVER pixel-match a clean digital reference,
     even from the same person on the same document. The right question
     for a signature is "is there a signature here?" not "is this the
     exact same pixel pattern?"

     How it distinguishes a real signature from a blank region: it
     measures ink-pixel density, stroke count via contour analysis, and
     spatial distribution of the marks. A blank or nearly-blank region
     (someone erased or removed the signature) will have near-zero ink
     density and contour count. A completely different kind of mark
     (e.g. a stamped text block pasted over where a signature should be)
     will have a very different stroke-density profile.

The strategy is chosen AUTOMATICALLY by analysing the reference image:
a reference with thin, sparse strokes on a mostly-blank background
(high background ratio, low contour fill) is classified as a signature;
everything else uses structural match. The asset_name is also checked
as a hint (names containing "signature" or "sign" are strong priors).

TEMPLATE-DRIVEN, NOT HARDCODED — same discipline as ocr.py: zero
hardcoded asset names or positions.
"""
from dataclasses import dataclass
from typing import Optional
from pathlib import Path

import logging

import cv2
import numpy as np

from app.pipeline.ocr import BoundingBox

logger = logging.getLogger("engine2.assets")


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


# ============================================================================
# Tier thresholds — calibrated for PHONE-CAMERA captures of printed
# documents, not flatbed scans. A phone photo of a genuine document
# inherently has lighting variation, slight blur, perspective residuals,
# and paper texture noise that depress pixel-level metrics well below
# what a scan-vs-scan comparison would produce. The previous 0.9/0.6
# thresholds were calibrated for ideal conditions and caused systematic
# false rejections on genuine documents.
# ============================================================================
_ACCEPT_THRESHOLD = 0.75
_REVIEW_THRESHOLD = 0.50


def _tier_from_score(score: float) -> str:
    if score >= _ACCEPT_THRESHOLD:
        return "accept"
    if score >= _REVIEW_THRESHOLD:
        return "review"
    return "reject"


_ASSET_SEARCH_MARGIN_FRACTION = 0.20
_ASSET_SEARCH_MARGIN_MIN_PX = 10


def _crop_zone(aligned_bgr: np.ndarray, box: BoundingBox) -> np.ndarray:
    height, width = aligned_bgr.shape[:2]
    x0 = max(0, box.x)
    y0 = max(0, box.y)
    x1 = min(width, box.x + box.width)
    y1 = min(height, box.y + box.height)
    return aligned_bgr[y0:y1, x0:x1]


def _crop_zone_with_margin(aligned_bgr: np.ndarray, box: BoundingBox) -> np.ndarray:
    height, width = aligned_bgr.shape[:2]
    margin_x = max(_ASSET_SEARCH_MARGIN_MIN_PX, int(box.width * _ASSET_SEARCH_MARGIN_FRACTION))
    margin_y = max(_ASSET_SEARCH_MARGIN_MIN_PX, int(box.height * _ASSET_SEARCH_MARGIN_FRACTION))
    x0 = max(0, box.x - margin_x)
    y0 = max(0, box.y - margin_y)
    x1 = min(width, box.x + box.width + margin_x)
    y1 = min(height, box.y + box.height + margin_y)
    return aligned_bgr[y0:y1, x0:x1]


def _best_aligned_crop(padded_bgr: np.ndarray, reference_bgr: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    region_h, region_w = padded_bgr.shape[:2]
    if region_h < target_h or region_w < target_w:
        return padded_bgr
    ref_resized = cv2.resize(reference_bgr, (target_w, target_h))
    region_gray = cv2.cvtColor(padded_bgr, cv2.COLOR_BGR2GRAY)
    ref_gray = cv2.cvtColor(ref_resized, cv2.COLOR_BGR2GRAY)
    result = cv2.matchTemplate(region_gray, ref_gray, cv2.TM_CCOEFF_NORMED)
    _, _, _, max_loc = cv2.minMaxLoc(result)
    bx, by = max_loc
    return padded_bgr[by:by + target_h, bx:bx + target_w]


# ============================================================================
# SIGNATURE DETECTION — determines whether a reference image looks like
# a handwritten signature (thin strokes on mostly-blank background) vs.
# a printed graphic (logo, seal, crest).
# ============================================================================

def _is_signature_like(reference_gray: np.ndarray, asset_name: str) -> bool:
    """
    Heuristically classifies whether a reference asset image is a
    handwritten signature vs. a printed graphic. Used to select the
    right verification strategy (presence-check vs. structural-match).
    """
    # Name-based hint — strongest signal when available.
    name_lower = asset_name.lower()
    if any(kw in name_lower for kw in ("signature", "sign", "autograph", "hast")):
        return True
    if any(kw in name_lower for kw in ("logo", "seal", "crest", "emblem", "stamp", "badge")):
        return False

    # Image-based analysis: signatures have high background ratio (mostly
    # white/blank) with sparse, thin strokes.
    _, binary = cv2.threshold(reference_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink_fraction = float(np.mean(binary > 0))

    # A signature typically has 1-15% ink coverage; a logo/seal with
    # filled shapes has much more.
    if ink_fraction < 0.02:
        return True  # nearly blank — treat as signature (presence check)
    if ink_fraction > 0.25:
        return False  # too much ink for handwriting — likely a graphic

    # Check stroke thinness: if the "ink" pixels are mostly thin contours
    # rather than filled regions, it's signature-like.
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return True
    total_contour_area = sum(cv2.contourArea(c) for c in contours)
    total_ink_area = float(np.sum(binary > 0))
    # Thin strokes: contour area (interior) is a small fraction of the
    # bounding perimeter's enclosed area; filled shapes: contour area is
    # close to the ink area.
    fill_ratio = total_contour_area / max(total_ink_area, 1.0)
    return fill_ratio < 0.7


# ============================================================================
# PRESENCE CHECK — for signatures. Answers "is there a signature-like
# mark here?" not "does this pixel-match the reference?"
# ============================================================================

def _signature_presence_score(crop_gray: np.ndarray, reference_gray: np.ndarray) -> tuple[float, str]:
    """
    Scores how likely the crop contains a genuine signature-like mark,
    compared against the reference's general characteristics (ink density,
    stroke count, spatial distribution). Returns (score, reason).
    """
    # Binarize both
    _, crop_bin = cv2.threshold(crop_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    _, ref_bin = cv2.threshold(reference_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    crop_ink = float(np.mean(crop_bin > 0))
    ref_ink = float(np.mean(ref_bin > 0))

    # Signal 1: ink presence — is there meaningful ink in the crop?
    if crop_ink < 0.005:
        return 0.1, "Signature region appears blank — almost no ink detected."
    presence_score = min(1.0, crop_ink / max(ref_ink, 0.01))
    presence_score = min(presence_score, 1.0)  # cap at 1.0, don't reward excess ink

    # Signal 2: stroke count — does the crop have a similar number of
    # distinct strokes to the reference?
    crop_contours, _ = cv2.findContours(crop_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    ref_contours, _ = cv2.findContours(ref_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Filter out noise (tiny contours < 1% of image area)
    min_area = crop_gray.shape[0] * crop_gray.shape[1] * 0.001
    crop_strokes = [c for c in crop_contours if cv2.contourArea(c) > min_area]
    ref_strokes = [c for c in ref_contours if cv2.contourArea(c) > min_area]

    if len(ref_strokes) == 0:
        stroke_score = 1.0 if len(crop_strokes) > 0 else 0.3
    else:
        ratio = len(crop_strokes) / max(len(ref_strokes), 1)
        stroke_score = max(0.0, 1.0 - abs(1.0 - ratio) * 0.5)

    # Signal 3: spatial distribution — where is the ink concentrated?
    # Compare the center of mass of ink pixels (a signature that's been
    # moved or replaced will have a very different spatial distribution).
    crop_moments = cv2.moments(crop_bin)
    ref_moments = cv2.moments(ref_bin)
    if crop_moments["m00"] > 0 and ref_moments["m00"] > 0:
        crop_cx = crop_moments["m10"] / crop_moments["m00"] / max(crop_gray.shape[1], 1)
        crop_cy = crop_moments["m01"] / crop_moments["m00"] / max(crop_gray.shape[0], 1)
        ref_cx = ref_moments["m10"] / ref_moments["m00"] / max(reference_gray.shape[1], 1)
        ref_cy = ref_moments["m01"] / ref_moments["m00"] / max(reference_gray.shape[0], 1)
        spatial_dist = ((crop_cx - ref_cx) ** 2 + (crop_cy - ref_cy) ** 2) ** 0.5
        spatial_score = max(0.0, 1.0 - spatial_dist * 3.0)
    else:
        spatial_score = 0.3

    combined = 0.40 * presence_score + 0.30 * stroke_score + 0.30 * spatial_score
    combined = round(float(min(1.0, max(0.0, combined))), 3)

    reason = (
        f"Signature presence check: ink density {crop_ink:.1%} "
        f"(ref {ref_ink:.1%}), {len(crop_strokes)} strokes "
        f"(ref {len(ref_strokes)}), spatial similarity {spatial_score:.2f}."
    )
    return combined, reason


# ============================================================================
# STRUCTURAL MATCH — for logos, seals, printed graphics.
# ============================================================================

def _normalize_contrast(gray: np.ndarray) -> np.ndarray:
    """
    CLAHE contrast normalization for ORB keypoint detection.  Helps ORB
    detect consistent keypoints across different exposure levels.
    NOT used for SSIM — CLAHE amplifies paper texture noise which tanks
    SSIM even further on phone photos.
    """
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _prepare_for_ssim(gray: np.ndarray) -> np.ndarray:
    """
    Prepares a grayscale asset image for SSIM comparison.  Phone photos
    of printed graphics have paper texture, compression artifacts, and
    uneven micro-lighting that destroy pixel-level SSIM against a clean
    digital reference.  The fix:
      1. Gaussian blur to suppress high-frequency texture/noise — lets
         SSIM compare macro shape, not paper grain.
      2. Downscale to a moderate resolution — further averages out noise
         and makes SSIM focus on overall pattern similarity.
    """
    blurred = cv2.GaussianBlur(gray, (5, 5), 1.5)
    # Downscale to ~200px on the long edge — enough to preserve the
    # logo's shape/details while averaging out texture noise.
    h, w = blurred.shape[:2]
    target = 200
    if max(h, w) > target:
        scale = target / max(h, w)
        blurred = cv2.resize(blurred, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return blurred


def _ssim(gray1: np.ndarray, gray2: np.ndarray) -> float:
    # Prepare: blur + downscale to compare structure, not texture.
    g1 = _prepare_for_ssim(gray1)
    g2 = _prepare_for_ssim(gray2)
    # Ensure same dimensions after downscale rounding.
    if g1.shape != g2.shape:
        g2 = cv2.resize(g2, (g1.shape[1], g1.shape[0]))

    h, w = g1.shape[:2]
    window_size = min(11, h, w)
    if window_size % 2 == 0:
        window_size -= 1
    window_size = max(window_size, 3)
    sigma = 1.5 if window_size >= 7 else 0.8
    kernel = cv2.getGaussianKernel(window_size, sigma)
    window = kernel @ kernel.T
    img1 = g1.astype(np.float64)
    img2 = g2.astype(np.float64)
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
    # CLAHE helps ORB detect consistent keypoints across exposures.
    gray1 = _normalize_contrast(gray1)
    gray2 = _normalize_contrast(gray2)

    orb = cv2.ORB_create(nfeatures=500)
    kp1, des1 = orb.detectAndCompute(gray1, None)
    kp2, des2 = orb.detectAndCompute(gray2, None)
    if des1 is None or des2 is None or len(kp1) < min_keypoints or len(kp2) < min_keypoints:
        return None
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw_matches = bf.knnMatch(des1, des2, k=2)
    good = [m for m, n in raw_matches if m.distance < 0.75 * n.distance]
    smaller_count = min(len(kp1), len(kp2))
    return round(len(good) / smaller_count, 3) if smaller_count else None


def _normalize_background(bgr: np.ndarray) -> np.ndarray:
    """
    Normalizes the background of an asset image to white before histogram
    comparison. Phone photos of printed documents have a grayish/textured
    paper background that tanks histogram correlation against a clean
    digital reference with a white background — even when the actual
    graphic (logo, seal) is identical.

    Strategy: convert to grayscale, Otsu-threshold to find the background
    (the majority class), then set all background pixels to white in the
    BGR output. This makes both the crop and the reference have white
    backgrounds, so the histogram measures only the foreground graphic.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Otsu's threshold separates foreground (ink/graphic) from background.
    # The "background" is whichever class has more pixels.
    white_pixels = np.sum(mask == 255)
    black_pixels = np.sum(mask == 0)
    if black_pixels > white_pixels:
        # Inverted: foreground is white in mask, background is black.
        bg_mask = (mask == 0)
    else:
        # Normal: background is white in mask.
        bg_mask = (mask == 255)

    result = bgr.copy()
    result[bg_mask] = [255, 255, 255]
    return result


def _histogram_correlation(bgr1: np.ndarray, bgr2: np.ndarray) -> float:
    # Normalize backgrounds to white before comparing — this prevents
    # paper texture/gray from tanking the score against a clean reference.
    norm1 = _normalize_background(bgr1)
    norm2 = _normalize_background(bgr2)
    hsv1 = cv2.cvtColor(norm1, cv2.COLOR_BGR2HSV)
    hsv2 = cv2.cvtColor(norm2, cv2.COLOR_BGR2HSV)
    hist1 = cv2.calcHist([hsv1], [0, 1], None, [50, 60], [0, 180, 0, 256])
    hist2 = cv2.calcHist([hsv2], [0, 1], None, [50, 60], [0, 180, 0, 256])
    cv2.normalize(hist1, hist1)
    cv2.normalize(hist2, hist2)
    correlation = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
    return round(max(0.0, (correlation + 1.0) / 2.0), 3)


def _structural_match_score(
    crop_gray: np.ndarray, crop_bgr: np.ndarray,
    reference_gray: np.ndarray, reference_bgr: np.ndarray,
) -> tuple[float, Optional[float], Optional[float], float, str]:
    """Returns (combined, ssim, orb, hist, reason)."""
    ssim_score = _ssim(crop_gray, reference_gray)
    orb_ratio = _orb_match_ratio(crop_gray, reference_gray)
    hist_corr = _histogram_correlation(crop_bgr, reference_bgr)

    ssim_clamped = max(0.0, ssim_score)

    # Weighting strategy: SSIM is the most reliable structural signal
    # for phone-camera captures. ORB adds value when it finds enough
    # feature matches. Histogram is a supporting signal only — it
    # catches gross color differences (wrong logo entirely) but is
    # fragile to background/lighting variation, so it gets the lowest
    # weight and never dominates the score.
    if orb_ratio is not None:
        if orb_ratio < 0.10:
            # ORB found features but very few matched — suspicious,
            # lean heavily on SSIM.
            combined = 0.70 * ssim_clamped + 0.15 * orb_ratio + 0.15 * hist_corr
        else:
            # Good ORB matches — balanced weighting.
            combined = 0.45 * ssim_clamped + 0.40 * orb_ratio + 0.15 * hist_corr
        reason = f"SSIM {ssim_score:.3f}, ORB match ratio {orb_ratio:.3f}, histogram correlation {hist_corr:.3f}."
    else:
        combined = 0.80 * ssim_clamped + 0.20 * hist_corr
        reason = (
            f"SSIM {ssim_score:.3f}, histogram correlation {hist_corr:.3f} "
            f"(ORB found too few keypoints)."
        )

    combined = round(float(min(1.0, max(0.0, combined))), 3)

    # Strong-signal override: when SSIM is high (≥0.70) AND ORB confirms
    # structural similarity (≥0.25), the graphic is almost certainly the
    # same one — phone-camera degradation (lighting, paper texture, slight
    # blur) depresses all three metrics relative to scan-vs-scan, but SSIM
    # ≥0.70 on a phone photo is very strong evidence.  Lift the combined
    # score to at least the accept threshold so histogram weakness alone
    # can't force a genuine logo into "review".
    if ssim_clamped >= 0.70 and orb_ratio is not None and orb_ratio >= 0.25:
        floor = _ACCEPT_THRESHOLD
        if combined < floor:
            reason += f" Strong structural agreement (SSIM+ORB) — score lifted from {combined:.3f} to {floor:.3f}."
            combined = floor

    return combined, round(ssim_score, 3), orb_ratio, hist_corr, reason


# ============================================================================
# Main entry points
# ============================================================================

def verify_asset(
    aligned_bgr: np.ndarray,
    asset_name: str,
    box: BoundingBox,
    reference_bytes: bytes,
    is_mandatory: bool,
    _debug_dir: Path | None = None,
) -> AssetVerificationResult:
    padded_region = _crop_zone_with_margin(aligned_bgr, box)
    reference_arr = np.frombuffer(reference_bytes, dtype=np.uint8)
    reference_bgr = cv2.imdecode(reference_arr, cv2.IMREAD_COLOR)

    if padded_region.size == 0 or reference_bgr is None or reference_bgr.size == 0:
        return AssetVerificationResult(
            asset_name=asset_name, similarity=0.0, is_mandatory=is_mandatory,
            tier="reject", ssim=None, orb_match_ratio=None,
            histogram_correlation=None,
            reason="Asset region was empty or reference image could not be decoded.",
        )

    crop_w, crop_h = box.width, box.height
    crop = _best_aligned_crop(padded_region, reference_bgr, crop_w, crop_h)
    if crop.size == 0:
        crop = _crop_zone(aligned_bgr, box)

    crop_h_actual, crop_w_actual = crop.shape[:2]
    reference_resized = cv2.resize(reference_bgr, (crop_w_actual, crop_h_actual))

    # ── Debug: save asset crops and references side by side ──
    if _debug_dir:
        safe_name = asset_name.replace("/", "_").replace(" ", "_")
        cv2.imwrite(str(_debug_dir / f"asset_{safe_name}_crop.png"), crop)
        cv2.imwrite(str(_debug_dir / f"asset_{safe_name}_reference.png"), reference_resized)
        cv2.imwrite(str(_debug_dir / f"asset_{safe_name}_padded_region.png"), padded_region)

    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    reference_gray = cv2.cvtColor(reference_resized, cv2.COLOR_BGR2GRAY)

    # Choose strategy based on reference image characteristics.
    is_sig = _is_signature_like(reference_gray, asset_name)

    if is_sig:
        combined, reason = _signature_presence_score(crop_gray, reference_gray)
        result = AssetVerificationResult(
            asset_name=asset_name, similarity=combined, is_mandatory=is_mandatory,
            tier=_tier_from_score(combined), ssim=None, orb_match_ratio=None,
            histogram_correlation=None,
            reason=f"[Signature mode] {reason}",
        )
    else:
        combined, ssim_val, orb_val, hist_val, reason = _structural_match_score(
            crop_gray, crop, reference_gray, reference_resized,
        )
        result = AssetVerificationResult(
            asset_name=asset_name, similarity=combined, is_mandatory=is_mandatory,
            tier=_tier_from_score(combined), ssim=ssim_val,
            orb_match_ratio=orb_val, histogram_correlation=hist_val,
            reason=f"[Structural mode] {reason}",
        )

    if _debug_dir:
        logger.info(
            "DEBUG ASSET [%s] strategy=%s  score=%.3f  tier=%s  | %s",
            asset_name, "signature" if is_sig else "structural",
            result.similarity, result.tier, result.reason,
        )

    return result


def verify_all_assets(aligned_bgr: np.ndarray, assets: list, _debug_dir: Path | None = None) -> list:
    results = []
    for asset in assets:
        box = BoundingBox(**asset["bounding_box"])
        result = verify_asset(
            aligned_bgr, asset["asset_name"], box,
            asset["reference_bytes"], asset["is_mandatory"],
            _debug_dir=_debug_dir,
        )
        results.append(result)
    return results