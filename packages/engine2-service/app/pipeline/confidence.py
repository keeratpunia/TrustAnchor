"""
confidence.py — Stages 7 and 8: scoring and verdict.
============================================================================
SIMPLIFIED FOR CURRENT SCOPE: only textual field comparison matters.
Template match, asset verification, screenshot detection, and alignment
quality are all OUT OF SCOPE and carry zero weight. The verdict is driven
entirely by how well OCR-extracted text matches the signed record.
"""
from dataclasses import dataclass, field
from typing import Any, List, Optional


AUTHENTIC_CONFIDENCE_THRESHOLD = 0.90
NEEDS_REVIEW_CONFIDENCE_FLOOR = 0.55

MANDATORY_ITEM_WEIGHT = 2.0
OPTIONAL_ITEM_WEIGHT = 1.0


@dataclass
class ConfidenceBreakdown:
    overall_confidence: float
    alignment_score: float
    alignment_weight: float
    screenshot_score: float
    screenshot_weight: float
    template_score: float
    template_weight: float
    asset_score: Optional[float]
    asset_weight: float
    field_score: Optional[float]
    field_weight: float
    notes: List[str] = field(default_factory=list)


@dataclass
class VerdictResult:
    verdict: str  # "AUTHENTIC" | "NEEDS_REVIEW" | "REJECTED"
    reason: str
    confidence: ConfidenceBreakdown


def _get(item: Any, key: str):
    return item[key] if isinstance(item, dict) else getattr(item, key)


def _weighted_average_similarity(items: List[Any]) -> Optional[float]:
    if not items:
        return None
    total_weight = 0.0
    weighted_sum = 0.0
    for it in items:
        w = MANDATORY_ITEM_WEIGHT if _get(it, "is_mandatory") else OPTIONAL_ITEM_WEIGHT
        weighted_sum += w * _get(it, "similarity")
        total_weight += w
    return weighted_sum / total_weight if total_weight else None


def compute_confidence(
    alignment_quality: float,
    screenshot_likelihood: float,
    template_match_score: float,
    asset_results: List[Any],
    field_results: List[Any],
) -> ConfidenceBreakdown:
    """Stage 7: confidence is driven ENTIRELY by field comparison scores."""
    field_score = _weighted_average_similarity(field_results)

    # Overall confidence = field score only. Everything else is recorded
    # for the breakdown but carries zero weight.
    overall = field_score if field_score is not None else 0.0

    return ConfidenceBreakdown(
        overall_confidence=round(overall, 3),
        alignment_score=round(alignment_quality, 3),
        alignment_weight=0.0,
        screenshot_score=round(1.0 - screenshot_likelihood, 3),
        screenshot_weight=0.0,
        template_score=round(template_match_score, 3),
        template_weight=0.0,
        asset_score=None,
        asset_weight=0.0,
        field_score=round(field_score, 3) if field_score is not None else None,
        field_weight=1.0,
        notes=["Scoring based on textual field comparison only (current scope)."],
    )


def determine_verdict(
    confidence: ConfidenceBreakdown,
    template_match_tier: str,
    asset_results: List[Any],
    field_results: List[Any],
) -> VerdictResult:
    """Stage 8: verdict based ONLY on field comparison results.
    Template match and asset tiers are completely ignored."""

    # Hard-reject ONLY if a mandatory FIELD failed
    hard_reject_reasons: List[str] = []
    for r in field_results:
        if _get(r, "is_mandatory") and _get(r, "tier") == "reject":
            hard_reject_reasons.append(
                f"Mandatory field '{_get(r, 'field_name')}' failed comparison."
            )

    if hard_reject_reasons:
        return VerdictResult(
            verdict="REJECTED",
            reason=" ".join(hard_reject_reasons),
            confidence=confidence,
        )

    # Check for any review-tier fields
    any_review = any(
        _get(r, "tier") == "review" for r in field_results
    )

    if confidence.overall_confidence >= AUTHENTIC_CONFIDENCE_THRESHOLD and not any_review:
        return VerdictResult(
            verdict="AUTHENTIC",
            reason=(
                f"All fields matched with {confidence.overall_confidence:.0%} confidence."
            ),
            confidence=confidence,
        )

    if confidence.overall_confidence >= NEEDS_REVIEW_CONFIDENCE_FLOOR:
        return VerdictResult(
            verdict="NEEDS_REVIEW",
            reason=(
                f"Field confidence is {confidence.overall_confidence:.0%} — "
                f"some fields need manual review."
            ),
            confidence=confidence,
        )

    return VerdictResult(
        verdict="REJECTED",
        reason=(
            f"Field confidence is {confidence.overall_confidence:.0%}, "
            f"below the {NEEDS_REVIEW_CONFIDENCE_FLOOR:.0%} minimum."
        ),
        confidence=confidence,
    )


def score_and_decide(
    alignment_quality: float,
    screenshot_likelihood: float,
    template_match_score: float,
    template_match_tier: str,
    asset_results: List[Any],
    field_results: List[Any],
) -> VerdictResult:
    """Convenience wrapper: Stage 7 then Stage 8."""
    confidence = compute_confidence(
        alignment_quality, screenshot_likelihood, template_match_score,
        asset_results, field_results,
    )
    return determine_verdict(
        confidence, template_match_tier, asset_results, field_results,
    )
