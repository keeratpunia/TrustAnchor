"""
test_confidence.py — unit tests for app/pipeline/confidence.py (Stages
7 and 8: confidence scoring and final verdict).
"""
from app.pipeline import confidence as conf_module


def _asset(similarity, is_mandatory=True, tier=None, asset_name="logo"):
    return {
        "asset_name": asset_name,
        "similarity": similarity,
        "is_mandatory": is_mandatory,
        "tier": tier or ("accept" if similarity >= 0.9 else "review" if similarity >= 0.6 else "reject"),
    }


def _field(similarity, is_mandatory=True, tier=None, field_name="student_name"):
    return {
        "field_name": field_name,
        "similarity": similarity,
        "is_mandatory": is_mandatory,
        "tier": tier or ("accept" if similarity >= 0.9 else "review" if similarity >= 0.6 else "reject"),
    }


class TestComputeConfidence:
    def test_perfect_evidence_everywhere_yields_confidence_near_one(self):
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0,
            screenshot_likelihood=0.0,
            template_match_score=1.0,
            asset_results=[_asset(1.0), _asset(1.0, is_mandatory=False)],
            field_results=[_field(1.0), _field(1.0)],
        )
        assert breakdown.overall_confidence >= 0.99

    def test_missing_assets_redistributes_weight_instead_of_penalizing(self):
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0,
            screenshot_likelihood=0.0,
            template_match_score=1.0,
            asset_results=[],
            field_results=[_field(1.0)],
        )
        assert breakdown.asset_score is None
        assert breakdown.asset_weight == 0.0
        assert breakdown.overall_confidence >= 0.99
        assert any("assets" in note.lower() for note in breakdown.notes)

    def test_mandatory_items_weighted_more_than_optional(self):
        # Same items either way, but a bad MANDATORY item should drag the
        # score down further than the same badness on an OPTIONAL item.
        breakdown_mandatory_bad = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=[_asset(0.3, is_mandatory=True), _asset(1.0, is_mandatory=False)],
            field_results=[_field(1.0)],
        )
        breakdown_optional_bad = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=[_asset(1.0, is_mandatory=True), _asset(0.3, is_mandatory=False)],
            field_results=[_field(1.0)],
        )
        assert breakdown_mandatory_bad.overall_confidence < breakdown_optional_bad.overall_confidence

    def test_high_screenshot_likelihood_lowers_confidence(self):
        low_screenshot = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=[_asset(1.0)], field_results=[_field(1.0)],
        )
        high_screenshot = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.9, template_match_score=1.0,
            asset_results=[_asset(1.0)], field_results=[_field(1.0)],
        )
        assert high_screenshot.overall_confidence < low_screenshot.overall_confidence

    def test_all_categories_missing_does_not_crash(self):
        breakdown = conf_module.compute_confidence(
            alignment_quality=0.0, screenshot_likelihood=1.0, template_match_score=0.0,
            asset_results=[], field_results=[],
        )
        assert 0.0 <= breakdown.overall_confidence <= 1.0


class TestDetermineVerdict:
    def test_mandatory_asset_reject_is_absolute_veto_even_with_high_confidence(self):
        asset_results = [_asset(0.1, is_mandatory=True, tier="reject")]
        field_results = [_field(1.0)]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="accept",
            asset_results=asset_results, field_results=field_results,
        )
        assert result.verdict == "REJECTED"
        assert "mandatory asset" in result.reason.lower()

    def test_mandatory_field_reject_is_absolute_veto(self):
        field_results = [_field(0.1, tier="reject")]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=[], field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="accept", asset_results=[],
            field_results=field_results,
        )
        assert result.verdict == "REJECTED"
        assert "mandatory field" in result.reason.lower()

    def test_template_match_reject_is_absolute_veto(self):
        field_results = [_field(1.0)]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=0.1,
            asset_results=[], field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="reject", asset_results=[], field_results=field_results,
        )
        assert result.verdict == "REJECTED"
        assert "template match" in result.reason.lower()

    def test_optional_item_reject_does_not_trigger_hard_veto(self):
        # A non-mandatory asset failing should not trigger the hard veto —
        # it just drags down the aggregate confidence score.
        asset_results = [_asset(0.1, is_mandatory=False, tier="reject")]
        field_results = [_field(1.0)]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="accept",
            asset_results=asset_results, field_results=field_results,
        )
        assert "hard-reject" not in result.reason.lower()

    def test_everything_perfect_yields_authentic(self):
        asset_results = [_asset(1.0)]
        field_results = [_field(1.0), _field(0.95, field_name="degree_name")]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="accept",
            asset_results=asset_results, field_results=field_results,
        )
        assert result.verdict == "AUTHENTIC"

    def test_single_review_tier_item_holds_back_authentic_even_with_high_confidence(self):
        # One borderline field among otherwise-excellent evidence should
        # still prevent AUTHENTIC — confidence reflects the weakest link,
        # not just the average.
        asset_results = [_asset(1.0)]
        field_results = [_field(1.0), _field(0.7, field_name="degree_name", tier="review")]
        breakdown = conf_module.compute_confidence(
            alignment_quality=1.0, screenshot_likelihood=0.0, template_match_score=1.0,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="accept",
            asset_results=asset_results, field_results=field_results,
        )
        assert result.verdict == "NEEDS_REVIEW"

    def test_moderate_confidence_with_no_hard_rejects_is_needs_review(self):
        asset_results = [_asset(0.7, tier="review")]
        field_results = [_field(0.75, tier="review")]
        breakdown = conf_module.compute_confidence(
            alignment_quality=0.8, screenshot_likelihood=0.2, template_match_score=0.75,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="review",
            asset_results=asset_results, field_results=field_results,
        )
        assert result.verdict == "NEEDS_REVIEW"

    def test_very_low_confidence_with_no_single_mandatory_reject_still_rejects(self):
        # Nothing individually crosses its own reject threshold as
        # "mandatory reject", but uniformly weak evidence everywhere
        # should still be able to reject on aggregate confidence alone.
        asset_results = [_asset(0.62, tier="review")]
        field_results = [_field(0.61, tier="review")]
        breakdown = conf_module.compute_confidence(
            alignment_quality=0.3, screenshot_likelihood=0.8, template_match_score=0.4,
            asset_results=asset_results, field_results=field_results,
        )
        result = conf_module.determine_verdict(
            breakdown, template_match_tier="review",
            asset_results=asset_results, field_results=field_results,
        )
        assert breakdown.overall_confidence < conf_module.NEEDS_REVIEW_CONFIDENCE_FLOOR
        assert result.verdict == "REJECTED"
        assert "hard-reject" not in result.reason.lower()


class TestScoreAndDecideConvenienceWrapper:
    def test_runs_both_stages_and_returns_consistent_result(self):
        asset_results = [_asset(1.0)]
        field_results = [_field(1.0)]
        result = conf_module.score_and_decide(
            alignment_quality=1.0,
            screenshot_likelihood=0.0,
            template_match_score=1.0,
            template_match_tier="accept",
            asset_results=asset_results,
            field_results=field_results,
        )
        assert result.verdict == "AUTHENTIC"
        assert result.confidence.overall_confidence >= conf_module.AUTHENTIC_CONFIDENCE_THRESHOLD
