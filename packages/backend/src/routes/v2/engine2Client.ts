/**
 * engine2Client.ts — thin HTTP client for the Engine 2 Python microservice
 * (packages/engine2-service).
 * ============================================================================
 * This is the ONLY file in the Node backend that talks to engine2-service.
 * It contains zero pipeline logic of its own — it just marshals a request
 * and unmarshals a response, matching the exact shape
 * packages/engine2-service/app/main.py's POST /pipeline/run expects and
 * returns. Uses Node's native `fetch`/`FormData`/`Blob` (Node 18+) — no new
 * HTTP client dependency, consistent with how the verifier-app's own
 * src/api/client.ts already uses native fetch.
 */
import { config } from '../../config/env';

export interface Engine2OcrZoneInput {
  field_name: string;
  bounding_box: { x: number; y: number; width: number; height: number };
  languages: string[];
  is_mandatory: boolean;
}

/**
 * One declared TemplateAsset (schema.prisma) to send to Stage 5 (asset
 * verification). `bytes` travels as its own multipart file part named
 * f"asset_bytes__{assetName}" — see main.py's TemplateAssetIn docstring
 * for why (an unknown-in-advance number of dynamically-named files can't
 * be declared as static FastAPI parameters).
 */
export interface Engine2TemplateAssetInput {
  assetName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  isMandatory: boolean;
  mimeType: string;
  bytes: Buffer;
}

export interface Engine2FieldVerdict {
  field_name: string;
  similarity: number;
  is_mandatory: boolean;
  tier: 'accept' | 'review' | 'reject';
  exact_match: boolean;
  field_type: 'numeric' | 'text' | 'unknown';
  reason: string;
}

export interface Engine2TemplateMatch {
  template_match_score: number;
  tier: 'accept' | 'review' | 'reject';
  qr_drift_px: number | null;
  used_skeleton: boolean;
  skeleton_correlation: number | null;
  reason: string;
}

export interface Engine2AssetVerdict {
  asset_name: string;
  similarity: number;
  is_mandatory: boolean;
  tier: 'accept' | 'review' | 'reject';
  reason: string;
}

/**
 * Stage 7's full confidence breakdown (app/pipeline/confidence.py) — every
 * number that went into `overall_confidence`, useful for surfacing "why"
 * in an admin/review UI rather than just the bare verdict.
 */
export interface Engine2Confidence {
  overall_confidence: number;
  alignment_score: number;
  alignment_weight: number;
  screenshot_score: number;
  screenshot_weight: number;
  template_score: number;
  template_weight: number;
  asset_score: number | null;
  asset_weight: number;
  field_score: number | null;
  field_weight: number;
  notes: string[];
}

export interface Engine2PipelineResponse {
  engine2_verdict: 'AUTHENTIC' | 'NEEDS_REVIEW' | 'REJECTED';
  reason: string;
  alignment_quality: number;
  tiers_completed: string[];
  screenshot_likelihood: number;
  preprocessing_warnings: string[];
  ocr_results: Array<{
    field_name: string;
    extracted_text: string;
    ocr_confidence: number;
    language_used: string;
    extraction_failed: boolean;
  }>;
  field_verdicts: Engine2FieldVerdict[];
  template_match: Engine2TemplateMatch;
  asset_verdicts: Engine2AssetVerdict[];
  confidence: Engine2Confidence;
}

export class Engine2ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Engine2ServiceError';
  }
}

/**
 * Calls engine2-service's POST /pipeline/run with the captured photo plus
 * the template/zone configuration and Engine-1-authenticated field values.
 *
 * @param photoBuffer Raw bytes of the captured document photo.
 * @param photoMimeType MIME type of the photo (e.g. "image/jpeg").
 * @param templateWidth/templateHeight The template's declared page dimensions.
 * @param qrPositionInTemplate The QR's 4 corners in template coordinate space.
 * @param ocrZones The template's declared OCR zones (from the `ocr_zones` table).
 * @param authenticatedFields The credential's Engine-1-AUTHENTICATED field
 *   values — MUST come from a `documents` row already confirmed to belong
 *   to a document Engine 1 verified (see verify.ts's gate), NEVER passed
 *   through from unverified client input.
 * @param templateAssets The template's declared static reference assets
 *   (from the `template_assets` table) — optional; omit or pass an empty
 *   array for a template with none declared yet.
 */
export async function runEngine2Pipeline(params: {
  photoBuffer: Buffer;
  photoMimeType: string;
  templateWidth: number;
  templateHeight: number;
  qrPositionInTemplate: number[][];
  ocrZones: Engine2OcrZoneInput[];
  authenticatedFields: Record<string, string>;
  templateAssets?: Engine2TemplateAssetInput[];
}): Promise<Engine2PipelineResponse> {
  const templateAssets = params.templateAssets ?? [];

  const form = new FormData();
  form.append('photo', new Blob([params.photoBuffer], { type: params.photoMimeType }), 'photo');
  form.append('template_width', String(params.templateWidth));
  form.append('template_height', String(params.templateHeight));
  form.append('qr_position', JSON.stringify(params.qrPositionInTemplate));
  form.append('ocr_zones', JSON.stringify(params.ocrZones));
  form.append('authenticated_fields', JSON.stringify(params.authenticatedFields));
  form.append(
    'template_assets',
    JSON.stringify(
      templateAssets.map((a) => ({
        asset_name: a.assetName,
        bounding_box: a.boundingBox,
        is_mandatory: a.isMandatory,
      }))
    )
  );
  for (const asset of templateAssets) {
    // Field name MUST match main.py's ASSET_FILE_PREFIX + asset_name exactly.
    form.append(`asset_bytes__${asset.assetName}`, new Blob([asset.bytes], { type: asset.mimeType }), asset.assetName);
  }

  let response: Response;
  try {
    response = await fetch(`${config.engine2ServiceUrl}/pipeline/run`, {
      method: 'POST',
      body: form,
    });
  } catch (err) {
    throw new Engine2ServiceError(
      `Could not reach engine2-service at ${config.engine2ServiceUrl}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Engine2ServiceError(
      `engine2-service returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`
    );
  }

  return (await response.json()) as Engine2PipelineResponse;
}