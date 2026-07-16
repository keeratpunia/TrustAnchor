/**
 * types.ts (Verifier App, Engine 2) — mirrors the JSON shape
 * packages/backend/src/routes/v2/verify.ts's POST /v2/verify/:docId
 * actually returns (see that file's res.status(200).json({...}) call).
 * Kept as its own small module, separate from engine1/types.ts, since
 * Engine 2's output is fundamentally different in kind from Engine 1's:
 * Engine 1 produces a cryptographic fact (verified entirely on-device,
 * offline-capable); Engine 2 produces forensic EVIDENCE from a network
 * call to engine2-service, always requires connectivity, and can
 * legitimately disagree with itself between two photos of the same
 * genuine document (a blurry photo scores worse than a sharp one). This
 * app must never blur that distinction in its UI.
 */

export type Tier = 'accept' | 'review' | 'reject';
export type Engine2Verdict = 'AUTHENTIC' | 'NEEDS_REVIEW' | 'REJECTED';
export type OverallVerdict = 'VERIFIED' | 'NEEDS_REVIEW' | 'REJECTED';

export interface OcrResult {
  field_name: string;
  extracted_text: string;
  ocr_confidence: number;
  language_used: string;
  extraction_failed: boolean;
}

export interface FieldVerdict {
  field_name: string;
  similarity: number;
  is_mandatory: boolean;
  tier: Tier;
  exact_match: boolean;
  field_type: 'numeric' | 'text' | 'unknown';
  reason: string;
}

export interface AssetVerdict {
  asset_name: string;
  similarity: number;
  is_mandatory: boolean;
  tier: Tier;
  reason: string;
}

export interface TemplateMatch {
  template_match_score: number;
  tier: Tier;
  qr_drift_px: number | null;
  used_skeleton: boolean;
  skeleton_correlation: number | null;
  reason: string;
}

export interface ConfidenceBreakdown {
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

/** The full JSON body POST /v2/verify/:docId returns on success (HTTP 200). */
export interface Engine2VerifyResponse {
  verificationId: string;
  engine1Status: string;
  engine2Verdict: Engine2Verdict;
  overallVerdict: OverallVerdict;
  reason: string;
  alignmentQuality: number;
  tiersCompleted: string[];
  screenshotLikelihood: number;
  ocrResults: OcrResult[];
  fieldVerdicts: FieldVerdict[];
  templateMatch: TemplateMatch;
  assetVerdicts: AssetVerdict[];
  confidence: ConfidenceBreakdown;
}
