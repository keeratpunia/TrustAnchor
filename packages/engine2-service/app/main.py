"""
main.py — the Engine 2 FastAPI application. Exposes POST /pipeline/run,
the single endpoint packages/backend/src/routes/v2/engine2Client.ts calls.
============================================================================
WHAT THIS FILE DOES: wires all 8 stages (preprocessing, homography, OCR,
template matching, asset verification, document comparison, confidence
scoring, final verdict — every one independently built and tested in
app/pipeline/) into one real, callable HTTP endpoint. AUTHENTIC is now a
reachable outcome, not just NEEDS_REVIEW/REJECTED — see
app/pipeline/confidence.py's module docstring for exactly how confidence
is computed and what gates AUTHENTIC vs NEEDS_REVIEW vs REJECTED.

Stage 2 (no QR detectable in the photo at all) is the one failure mode
that still short-circuits before Stage 4 even runs — see the early
REJECTED return below — because there's no aligned image for template
matching, asset verification, or field comparison to run against at all;
every other combination of evidence flows through Stage 7/8's real
confidence-and-verdict logic in app/pipeline/confidence.py.
"""
import json
import logging
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.pipeline.preprocessing import preprocess
from app.pipeline.homography import align_document, HomographyError
from app.pipeline.ocr import extract_all_zones
from app.pipeline import template_matching
from app.pipeline.asset_verification import verify_all_assets
from app.pipeline.comparison import compare_all_fields
from app.pipeline.confidence import score_and_decide

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("engine2")

app = FastAPI(
    title="TrustAnchor Engine 2 Service",
    description=(
        "Document forensics microservice. All 8 pipeline stages "
        "(preprocessing, homography, OCR, template matching, asset "
        "verification, document comparison, confidence scoring, final "
        "verdict) are fully implemented — see app/pipeline/confidence.py "
        "for how AUTHENTIC/NEEDS_REVIEW/REJECTED is decided."
    ),
    version="1.0.0",
)

ASSET_FILE_PREFIX = "asset_bytes__"


# ============================================================================
# Request/response schemas — the response shape MUST stay in lockstep with
# packages/backend/src/routes/v2/engine2Client.ts's Engine2PipelineResponse
# interface. If you add/rename a field here, update that TS interface too.
# ============================================================================

class BoundingBoxIn(BaseModel):
    x: int
    y: int
    width: int
    height: int


class OcrZoneIn(BaseModel):
    field_name: str
    bounding_box: BoundingBoxIn
    languages: List[str]
    is_mandatory: bool = True


class TemplateAssetIn(BaseModel):
    """
    Metadata for one declared TemplateAsset (schema.prisma). The actual
    reference image bytes travel as a SEPARATE multipart file part, named
    f"{ASSET_FILE_PREFIX}{asset_name}" — see `_collect_asset_files` below —
    since an unknown-in-advance number of dynamically-named files can't be
    declared as static FastAPI File(...) parameters.
    """
    asset_name: str
    bounding_box: BoundingBoxIn
    is_mandatory: bool = True


class OcrResultOut(BaseModel):
    field_name: str
    extracted_text: str
    ocr_confidence: float
    language_used: str
    extraction_failed: bool


class FieldVerdictOut(BaseModel):
    field_name: str
    similarity: float
    is_mandatory: bool
    tier: str  # "accept" | "review" | "reject"
    exact_match: bool
    field_type: str  # "numeric" | "text" | "unknown"
    reason: str


class TemplateMatchOut(BaseModel):
    template_match_score: float
    tier: str  # "accept" | "review" | "reject"
    qr_drift_px: Optional[float]
    used_skeleton: bool
    skeleton_correlation: Optional[float]
    reason: str


class AssetVerdictOut(BaseModel):
    asset_name: str
    similarity: float
    is_mandatory: bool
    tier: str  # "accept" | "review" | "reject"
    reason: str


class ConfidenceOut(BaseModel):
    """Stage 7's full breakdown — every number that went into
    `overall_confidence`, so a human reviewer (or the mobile app's UI)
    can see exactly why a document scored what it scored."""
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
    notes: List[str]


class PipelineResponse(BaseModel):
    engine2_verdict: str  # "AUTHENTIC" | "NEEDS_REVIEW" | "REJECTED"
    reason: str
    alignment_quality: float
    tiers_completed: List[str]
    screenshot_likelihood: float
    preprocessing_warnings: List[str]
    ocr_results: List[OcrResultOut]
    field_verdicts: List[FieldVerdictOut]
    template_match: TemplateMatchOut
    asset_verdicts: List[AssetVerdictOut]
    confidence: ConfidenceOut


@app.get("/health")
def health() -> dict:
    """Liveness probe — used in local dev / docker-compose healthchecks."""
    return {"status": "ok"}


# ============================================================================
# PLACEHOLDER STAGES 4-8 — naive text-similarity only. Replace this
# function's body when the real comparison/confidence/verdict stages exist.
# ============================================================================

def _no_match_attempted(reason: str) -> TemplateMatchOut:
    """Used when Stage 2 fails before Stage 4 could even run — a real
    'reject', not a placeholder guess, since alignment never succeeded."""
    return TemplateMatchOut(
        template_match_score=0.0,
        tier="reject",
        qr_drift_px=None,
        used_skeleton=False,
        skeleton_correlation=None,
        reason=reason,
    )


def _zero_confidence(note: str) -> ConfidenceOut:
    """Used alongside _no_match_attempted for the same Stage 2
    early-failure case — there is no aligned image for Stage 7 to have
    scored anything against, so every component is honestly reported as
    zero/absent rather than fabricating a score."""
    return ConfidenceOut(
        overall_confidence=0.0,
        alignment_score=0.0,
        alignment_weight=0.0,
        screenshot_score=0.0,
        screenshot_weight=0.0,
        template_score=0.0,
        template_weight=0.0,
        asset_score=None,
        asset_weight=0.0,
        field_score=None,
        field_weight=0.0,
        notes=[note],
    )


async def _collect_asset_files(form) -> Dict[str, bytes]:
    """
    Pulls out every multipart file part named f"{ASSET_FILE_PREFIX}{name}"
    (e.g. "asset_bytes__university_logo") and returns {asset_name: bytes}.
    Takes Starlette's already-parsed FormData (accessed via
    `await request.form()`, which Starlette caches — safe to call
    alongside FastAPI's own declared Form(...)/File(...) parameter parsing
    on the same request) so the dynamic, unknown-in-advance asset file
    parts can be read without declaring each one as its own named
    endpoint parameter.
    """
    asset_files: Dict[str, bytes] = {}
    for key, value in form.multi_items():
        if key.startswith(ASSET_FILE_PREFIX) and hasattr(value, "read"):
            asset_files[key[len(ASSET_FILE_PREFIX):]] = await value.read()
    return asset_files


@app.post("/pipeline/run", response_model=PipelineResponse)
async def run_pipeline(
    request: Request,
    photo: UploadFile = File(...),
    template_width: int = Form(...),
    template_height: int = Form(...),
    qr_position: str = Form(...),
    ocr_zones: str = Form(...),
    authenticated_fields: str = Form(...),
    template_assets: Optional[str] = Form(None),
) -> PipelineResponse:
    """
    Runs stages 1-5 for real against the uploaded photo, then a stage 6
    preview (see module docstring). Matches the multipart fields
    engine2Client.ts's runEngine2Pipeline() sends:
      photo, template_width, template_height, qr_position (JSON string of
      4 [x,y] points), ocr_zones (JSON string), authenticated_fields
      (JSON string), template_assets (JSON string, OPTIONAL — omit or send
      "[]" for a template with no declared static assets), plus one
      multipart file per declared asset named
      f"asset_bytes__{asset_name}".
    """
    # ---- parse the JSON-string form fields ----
    try:
        qr_position_list = json.loads(qr_position)
        qr_position_arr = np.array(qr_position_list, dtype=np.float32)
        if qr_position_arr.shape != (4, 2):
            raise ValueError(f"qr_position must be 4 [x,y] points, got shape {qr_position_arr.shape}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"qr_position is invalid: {exc}")

    try:
        zones_raw = json.loads(ocr_zones)
        zones = [OcrZoneIn(**z) for z in zones_raw]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ocr_zones is invalid: {exc}")

    try:
        authenticated_fields_dict = json.loads(authenticated_fields)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"authenticated_fields is invalid: {exc}")

    try:
        assets_meta = json.loads(template_assets) if template_assets else []
        declared_assets = [TemplateAssetIn(**a) for a in assets_meta]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"template_assets is invalid: {exc}")

    # The asset reference images ride as their own dynamically-named
    # multipart file parts (see TemplateAssetIn's docstring) — read the
    # raw form once (Starlette caches this, so it's safe alongside the
    # File(...)/Form(...) params FastAPI already parsed above).
    form = await request.form()
    asset_files = await _collect_asset_files(form)
    missing_asset_bytes = [a.asset_name for a in declared_assets if a.asset_name not in asset_files]

    photo_bytes = await photo.read()

    # ---- Stage 1: preprocessing ----
    try:
        pre = preprocess(photo_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Could not process photo: {exc}")

    warnings = list(pre.warnings)
    if missing_asset_bytes:
        warnings.append(
            f"No reference image bytes were received for declared asset(s): "
            f"{', '.join(missing_asset_bytes)} — skipped in Stage 5."
        )

    # ---- Stage 2: homography ----
    # A HomographyError here (no QR detectable at all) is a genuine,
    # already-implemented hard failure — not a placeholder judgment call —
    # so it's the one case allowed to return REJECTED at this stage of the
    # build.
    try:
        homography = align_document(
            pre.image,
            qr_position_arr,
            template_width,
            template_height,
        )
    except HomographyError as exc:
        logger.info("Alignment failed, returning REJECTED: %s", exc)
        return PipelineResponse(
            engine2_verdict="REJECTED",
            reason=str(exc),
            alignment_quality=0.0,
            tiers_completed=[],
            screenshot_likelihood=pre.screenshot_likelihood,
            preprocessing_warnings=warnings,
            ocr_results=[],
            field_verdicts=[],
            template_match=_no_match_attempted(
                "Stage 4 did not run — Stage 2 (alignment) failed first."
            ),
            asset_verdicts=[],
            confidence=_zero_confidence(
                "Stage 7 did not run — Stage 2 (alignment) failed first, so there is no aligned image for any later stage to score."
            ),
        )

    # ---- Stage 3: OCR ----
    zone_dicts = [
        {
            "field_name": z.field_name,
            "bounding_box": z.bounding_box.model_dump(),
            "languages": z.languages,
        }
        for z in zones
    ]
    ocr_results = extract_all_zones(homography.aligned_image, zone_dicts)

    ocr_results_out = [
        OcrResultOut(
            field_name=r.field_name,
            extracted_text=r.extracted_text,
            ocr_confidence=r.ocr_confidence,
            language_used=r.language_used,
            extraction_failed=r.extraction_failed,
        )
        for r in ocr_results
    ]

    # ---- Stage 4: template matching ----
    # No skeleton image is wired through yet (see template_matching.py's
    # module NOTE on where one would eventually come from) — QR-drift is
    # the only signal available today, which the function handles
    # gracefully on its own.
    match_result = template_matching.compute_template_match(homography.aligned_image, qr_position_arr)

    # ---- Stage 5: asset verification ----
    asset_verify_inputs = [
        {
            "asset_name": a.asset_name,
            "bounding_box": a.bounding_box.model_dump(),
            "reference_bytes": asset_files[a.asset_name],
            "is_mandatory": a.is_mandatory,
        }
        for a in declared_assets
        if a.asset_name in asset_files
    ]
    asset_results = verify_all_assets(homography.aligned_image, asset_verify_inputs) if asset_verify_inputs else []

    asset_verdicts_out = [
        AssetVerdictOut(
            asset_name=r.asset_name,
            similarity=r.similarity,
            is_mandatory=r.is_mandatory,
            tier=r.tier,
            reason=r.reason,
        )
        for r in asset_results
    ]

    # ---- Stage 6: document comparison (real, not a placeholder) ----
    is_mandatory_by_field = {z.field_name: z.is_mandatory for z in zones}
    field_comparisons = compare_all_fields(ocr_results, authenticated_fields_dict, is_mandatory_by_field)
    field_verdicts_out = [
        FieldVerdictOut(
            field_name=r.field_name,
            similarity=r.similarity,
            is_mandatory=r.is_mandatory,
            tier=r.tier,
            exact_match=r.exact_match,
            field_type=r.field_type,
            reason=r.reason,
        )
        for r in field_comparisons
    ]

    # ---- Stage 7 + 8: confidence scoring and final verdict (real, not a
    # placeholder) — see app/pipeline/confidence.py's module docstring for
    # the full formula, the hard-veto rule, and why AUTHENTIC requires
    # both high confidence AND zero review-tier items anywhere. ----
    verdict_result = score_and_decide(
        alignment_quality=homography.alignment_quality,
        screenshot_likelihood=pre.screenshot_likelihood,
        template_match_score=match_result.template_match_score,
        template_match_tier=match_result.tier,
        asset_results=asset_results,
        field_results=field_comparisons,
    )

    logger.info(
        "Pipeline completed",
        extra={
            "engine2_verdict": verdict_result.verdict,
            "confidence": verdict_result.confidence.overall_confidence,
            "tiers_completed": homography.tiers_completed,
            "template_match_tier": match_result.tier,
        },
    )

    return PipelineResponse(
        engine2_verdict=verdict_result.verdict,
        reason=verdict_result.reason,
        alignment_quality=homography.alignment_quality,
        tiers_completed=homography.tiers_completed,
        screenshot_likelihood=pre.screenshot_likelihood,
        preprocessing_warnings=warnings,
        ocr_results=ocr_results_out,
        field_verdicts=field_verdicts_out,
        template_match=TemplateMatchOut(
            template_match_score=match_result.template_match_score,
            tier=match_result.tier,
            qr_drift_px=match_result.qr_drift_px,
            used_skeleton=match_result.used_skeleton,
            skeleton_correlation=match_result.skeleton_correlation,
            reason=match_result.reason,
        ),
        asset_verdicts=asset_verdicts_out,
        confidence=ConfidenceOut(
            overall_confidence=verdict_result.confidence.overall_confidence,
            alignment_score=verdict_result.confidence.alignment_score,
            alignment_weight=verdict_result.confidence.alignment_weight,
            screenshot_score=verdict_result.confidence.screenshot_score,
            screenshot_weight=verdict_result.confidence.screenshot_weight,
            template_score=verdict_result.confidence.template_score,
            template_weight=verdict_result.confidence.template_weight,
            asset_score=verdict_result.confidence.asset_score,
            asset_weight=verdict_result.confidence.asset_weight,
            field_score=verdict_result.confidence.field_score,
            field_weight=verdict_result.confidence.field_weight,
            notes=verdict_result.confidence.notes,
        ),
    )