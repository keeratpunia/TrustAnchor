"""
confidence.py — Stages 7 and 8 of the Engine 2 pipeline: confidence
scoring and the final Engine 2 verdict.
============================================================================
This is the module that finally makes AUTHENTIC a reachable outcome. Every
earlier stage (1-6) only ever produces EVIDENCE — a score, a tier, a
reason — for one narrow question (is this aligned? does this asset match?
does this field match?). Nothing before this module has looked at all of
that evidence TOGETHER and asked "on the whole, does this credential's
physical document match what was issued?"

THE CENTRAL RULE, inherited from combiner.ts and every stage before this
one: "Engine 2 can only ever subtract confidence from Engine 1's
AUTHENTIC baseline, never add trust." Concretely, that means:

  1. Confidence STARTS at 1.0 (full trust — Engine 1 has already
     cryptographically verified this credential; Engine 2's only job is
     to check whether the PHYSICAL document in front of the verifier
     still matches what was issued) and is discounted by shortfalls in
     each stage's evidence, never built up from zero. A document with no
     negative evidence anywhere keeps its full starting trust; a document
     with negative evidence loses trust proportional to how bad and how
     important that evidence is.

  2. A single MANDATORY hard-reject anywhere (template match, a mandatory
     asset, or a mandatory field, each already independently tested in
     their own stage) is an absolute veto — REJECTED regardless of how
     high the aggregate confidence number is. A perfect photo of a
     forged roll number is still a forged roll number; no amount of good
     alignment or a matching logo buys that back. This is a HARD gate,
     applied before the numeric confidence score is even consulted.

  3. Below the veto level, the aggregate confidence number can ALSO push
     a result down (to NEEDS_REVIEW, or even to REJECTED on its own) even
     when no single item crossed its own "reject" threshold — that's the
     entire point of having Stage 7 in addition to Stage 8's hard-veto
     rule: five mediocre signals can be worse evidence in aggregate than
     any one of them looks alone.

  4. AUTHENTIC requires BOTH a high aggregate confidence AND zero
     "review"-tier items anywhere (not just zero "reject"-tier items) —
     a single borderline asset or field is enough to hold a result at
     NEEDS_REVIEW even if the arithmetic mean looks good, because
     confidence is meant to reflect the WEAKEST credible link, not just
     the average one.

CONFIDENCE FORMULA: a weighted average of five per-category scores, each
already in [0, 1] evidence from an earlier stage:

    alignment_quality      (Stage 2, homography)          weight 0.15
    1 - screenshot_likelihood (Stage 1, preprocessing)     weight 0.10
    template_match_score   (Stage 4)                       weight 0.20
    weighted asset similarity (Stage 5, if any declared)   weight 0.25
    weighted field similarity (Stage 6)                    weight 0.30

Weights sum to 1.0. If a category has no data at all (e.g. a template
with zero declared static assets), its weight is proportionally
redistributed among the remaining present categories rather than either
penalizing or rewarding a template for not declaring assets yet — see
`_redistribute_weights`.

Within the asset/field categories, MANDATORY items are weighted twice as
heavily as non-mandatory ones (a non-mandatory item's mismatch is still
real evidence, just weaker) — see `_weighted_average_similarity`.

These weights and thresholds are a documented, tunable POLICY, not a
derived constant — reasonable people (or a supervisor) could argue for
different numbers; what matters architecturally is that they live in one
place, are named, and are easy to find and adjust.
"""
from dataclasses import dataclass, field
from typing import Any, List, Optional

# ============================================================================
# Tunable policy constants — see module docstring for rationale.
# ============================================================================

WEIGHT_ALIGNMENT = 0.15
WEIGHT_SCREENSHOT = 0.10
WEIGHT_TEMPLATE = 0.20
WEIGHT_ASSETS = 0.25
WEIGHT_FIELDS = 0.30

MANDATORY_ITEM_WEIGHT = 2.0
OPTIONAL_ITEM_WEIGHT = 1.0

AUTHENTIC_CONFIDENCE_THRESHOLD = 0.92
NEEDS_REVIEW_CONFIDENCE_FLOOR = 0.55


@dataclass
class ConfidenceBreakdown:
    """Every number that went into the final confidence score, so a human
    (or a debugging session) can see exactly why a document scored what
    it scored — never just a single opaque float."""

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
    """Accepts either a dict or a dataclass/object — same duck-typing
    convenience already used by comparison.py's compare_all_fields."""
    return item[key] if isinstance(item, dict) else getattr(item, key)


def _weighted_average_similarity(items: List[Any]) -> Optional[float]:
    """
    Weighted mean of `.similarity` across a list of asset or field
    results, with mandatory items counted twice as heavily as optional
    ones. Returns None (not 0.0 — an absent category, not a zero score)
    if the list is empty, so the caller can redistribute that category's
    weight rather than silently treating "nothing declared" as "total
    failure."
    """
    if not items:
        return None
    total_weight = 0.0
    weighted_sum = 0.0
    for it in items:
        w = MANDATORY_ITEM_WEIGHT if _get(it, "is_mandatory") else OPTIONAL_ITEM_WEIGHT
        weighted_sum += w * _get(it, "similarity")
        total_weight += w
    return weighted_sum / total_weight if total_weight else None


def _redistribute_weights(categories: dict) -> dict:
    """
    @param categories: {name: (score_or_None, base_weight)}
    Drops any category whose score is None and proportionally scales up
    the remaining categories' weights so they still sum to 1.0 — a
    template with no declared assets isn't penalized OR rewarded for
    that; the other four categories simply account for the whole score.
    """
    present = {name: (score, weight) for name, (score, weight) in categories.items() if score is not None}
    total_present_weight = sum(weight for _, weight in present.values())
    if total_present_weight == 0:
        return {}
    return {name: (score, weight / total_present_weight) for name, (score, weight) in present.items()}


def compute_confidence(
    alignment_quality: float,
    screenshot_likelihood: float,
    template_match_score: float,
    asset_results: List[Any],
    field_results: List[Any],
) -> ConfidenceBreakdown:
    """Runs Stage 7: combines every earlier stage's evidence into one
    confidence score in [0, 1], with a full breakdown of how it was
    computed."""
    asset_score = _weighted_average_similarity(asset_results)
    field_score = _weighted_average_similarity(field_results)

    categories = {
        "alignment": (alignment_quality, WEIGHT_ALIGNMENT),
        "screenshot": (1.0 - screenshot_likelihood, WEIGHT_SCREENSHOT),
        "template": (template_match_score, WEIGHT_TEMPLATE),
        "assets": (asset_score, WEIGHT_ASSETS),
        "fields": (field_score, WEIGHT_FIELDS),
    }

    notes: List[str] = []
    redistributed = _redistribute_weights(categories)
    if asset_score is None:
        notes.append(
            f"No template assets were declared/available — Stage 5's "
            f"weight ({WEIGHT_ASSETS:.0%}) was redistributed among the "
            f"other categories rather than counted as either a pass or a "
            f"failure."
        )
    if field_score is None:
        notes.append(
            f"No OCR zones/field comparisons were available — Stage 6's "
            f"weight ({WEIGHT_FIELDS:.0%}) was redistributed. A credential "
            f"with zero comparable fields is unusual and worth reviewing "
            f"independently of this score."
        )

    overall = sum(score * weight for score, weight in redistributed.values())

    return ConfidenceBreakdown(
        overall_confidence=round(overall, 3),
        alignment_score=round(alignment_quality, 3),
        alignment_weight=round(redistributed.get("alignment", (0, 0.0))[1], 3),
        screenshot_score=round(1.0 - screenshot_likelihood, 3),
        screenshot_weight=round(redistributed.get("screenshot", (0, 0.0))[1], 3),
        template_score=round(template_match_score, 3),
        template_weight=round(redistributed.get("template", (0, 0.0))[1], 3),
        asset_score=round(asset_score, 3) if asset_score is not None else None,
        asset_weight=round(redistributed.get("assets", (0, 0.0))[1], 3),
        field_score=round(field_score, 3) if field_score is not None else None,
        field_weight=round(redistributed.get("fields", (0, 0.0))[1], 3),
        notes=notes,
    )


def determine_verdict(
    confidence: ConfidenceBreakdown,
    template_match_tier: str,
    asset_results: List[Any],
    field_results: List[Any],
) -> VerdictResult:
    """
    Runs Stage 8: applies the hard-veto rule first (any MANDATORY
    reject, from template match, an asset, or a field, is an absolute
    REJECTED regardless of the confidence number), then falls back to
    thresholding the aggregate confidence score — which can still push a
    result to NEEDS_REVIEW or REJECTED on its own, and additionally holds
    AUTHENTIC back if any item anywhere (mandatory or not) is still at
    "review".
    """
    hard_reject_reasons: List[str] = []
    if template_match_tier == "reject":
        hard_reject_reasons.append("Stage 4 template match failed (this document does not structurally match the claimed template).")
    for r in asset_results:
        if _get(r, "is_mandatory") and _get(r, "tier") == "reject":
            hard_reject_reasons.append(f"Mandatory asset '{_get(r, 'asset_name')}' failed verification.")
    for r in field_results:
        if _get(r, "is_mandatory") and _get(r, "tier") == "reject":
            hard_reject_reasons.append(f"Mandatory field '{_get(r, 'field_name')}' failed comparison.")

    if hard_reject_reasons:
        return VerdictResult(
            verdict="REJECTED",
            reason=(
                "Hard-reject: " + " ".join(hard_reject_reasons)
                + f" (aggregate confidence was {confidence.overall_confidence:.3f}, "
                  f"but a mandatory item failing is an absolute veto regardless of "
                  f"the aggregate score)."
            ),
            confidence=confidence,
        )

    any_review_tier = template_match_tier == "review" or any(
        _get(r, "tier") == "review" for r in (*asset_results, *field_results)
    )

    if confidence.overall_confidence >= AUTHENTIC_CONFIDENCE_THRESHOLD and not any_review_tier:
        return VerdictResult(
            verdict="AUTHENTIC",
            reason=(
                f"Aggregate confidence {confidence.overall_confidence:.3f} with no "
                f"reject- or review-tier evidence anywhere across template match, "
                f"assets, or fields."
            ),
            confidence=confidence,
        )

    if confidence.overall_confidence >= NEEDS_REVIEW_CONFIDENCE_FLOOR:
        if any_review_tier:
            reason = (
                f"Aggregate confidence {confidence.overall_confidence:.3f} is high enough "
                f"to avoid rejection, but at least one item is at 'review' tier — "
                f"holding this at NEEDS_REVIEW for a human to confirm rather than "
                f"auto-accepting."
            )
        else:
            reason = (
                f"Aggregate confidence {confidence.overall_confidence:.3f} falls short of "
                f"the {AUTHENTIC_CONFIDENCE_THRESHOLD:.2f} bar required for an automatic "
                f"AUTHENTIC verdict."
            )
        return VerdictResult(verdict="NEEDS_REVIEW", reason=reason, confidence=confidence)

    return VerdictResult(
        verdict="REJECTED",
        reason=(
            f"Aggregate confidence {confidence.overall_confidence:.3f} falls below the "
            f"{NEEDS_REVIEW_CONFIDENCE_FLOOR:.2f} floor — no single mandatory item "
            f"necessarily failed outright, but the combined weight of weak evidence "
            f"across stages is itself grounds for rejection."
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
    """Convenience wrapper running Stage 7 then Stage 8 in one call —
    what main.py actually calls."""
    confidence = compute_confidence(
        alignment_quality, screenshot_likelihood, template_match_score, asset_results, field_results
    )
    return determine_verdict(confidence, template_match_tier, asset_results, field_results)
