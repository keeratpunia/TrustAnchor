/**
 * types.ts — mirrors packages/backend/src/routes/v2/templates.ts's actual
 * request/response shapes exactly. This app never invents its own
 * template data model; it only ever assembles what the existing API
 * already expects.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateLayout {
  page_width: number;
  page_height: number;
  /** Exactly 4 [x, y] points, in the same coordinate space as page_width/page_height. */
  qr_position: number[][];
}

export interface OcrZoneDraft {
  /** Client-only identifier for React keys/editing — never sent to the server. */
  localId: string;
  fieldName: string;
  box: BoundingBox;
  languages: string[];
  isMandatory: boolean;
  color: string;
}

/**
 * A declared per-document dynamic image zone (e.g. "student_photo") — see
 * backend's schema.prisma PhotoZone model header for why this is a
 * separate concept from both OCR zones (text) and template assets
 * (static, one image shared by every document).
 */
export interface PhotoZoneDraft {
  localId: string;
  fieldName: string;
  box: BoundingBox;
  isMandatory: boolean;
  /** Which already-declared OCR zone's fieldName (e.g. "roll_no") batch issuance uses to find this photo's file, by filename. Never the student's name — see lib/csv.ts's header. */
  matchByField: string;
  color: string;
}

export interface AssetDraft {
  localId: string;
  assetName: string;
  box: BoundingBox;
  isMandatory: boolean;
  color: string;
}

export interface TemplateAssetSummary {
  assetName: string;
  boundingBox: BoundingBox;
  contentHash: string;
  mimeType: string;
  isMandatory: boolean;
}

export interface OcrZoneSummary {
  fieldName: string;
  boundingBox: BoundingBox;
  languages: string[];
  isMandatory: boolean;
}

export interface PhotoZoneSummary {
  fieldName: string;
  boundingBox: BoundingBox;
  isMandatory: boolean;
  matchByField: string | null;
}

export interface TemplateDetail {
  templateId: string;
  version: number;
  issuerId: string;
  name: string;
  layoutJson: TemplateLayout;
  templateHash: string;
  hasBackgroundImage: boolean;
  assets: TemplateAssetSummary[];
  ocrZones: OcrZoneSummary[];
  photoZones: PhotoZoneSummary[];
}

/** A locally-remembered template — see lib/recentTemplates.ts's header for why this exists. */
export interface RecentTemplateEntry {
  templateId: string;
  version: number;
  name: string;
  templateHash: string;
  createdAt: string;
}

// ============================================================================
// Auth / account types — mirror packages/backend's IssuerAccount/AdminAccount
// exactly (see schema.prisma and routes/auth/*, routes/admin/*).
// ============================================================================

export type IssuerAccountStatus =
  | 'PENDING'
  | 'APPROVED_NO_KEY'
  | 'ACTIVE'
  | 'KEY_ROTATION_PENDING'
  | 'SUSPENDED'
  | 'REJECTED';

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
}

export interface IssuerAccount {
  id: string;
  institutionName: string;
  email: string;
  status: IssuerAccountStatus;
  issuerId: string | null;
  publicKeyHex: string | null;
  keySource: 'yubikey' | 'software_test_key' | null;
  rejectionReason?: string | null;
  suspensionReason?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
}

export interface KeyRotationRequest {
  id: string;
  issuerAccountId: string;
  institutionName?: string;
  email?: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  newPublicKeyHex: string | null;
  reviewNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actorType: 'ISSUER' | 'ADMIN';
  actorId: string | null;
  payload: unknown;
  ip: string | null;
  createdAt: string;
}

export interface DocumentSummary {
  docId: string;
  templateId: string;
  templateVersion: number;
  issuedAt: string;
  expiresAt: string | null;
  fields: Record<string, string>;
  createdAt: string;
}

export interface RevocationRequest {
  id: string;
  issuerAccountId: string;
  institutionName?: string;
  email?: string;
  docId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
}

/** One row of an unsigned credential batch — matches offline-signer's CredentialPayload shape exactly. */
export interface UnsignedCredentialPayload {
  v: 1;
  issuer_id: string;
  doc_id: string;
  template_id: string;
  template_version: number;
  issued_at: string;
  expires_at: string | null;
  fields: Record<string, string>;
  asset_hashes: Record<string, string>;
  template_hash: string;
}

/** A signed batch entry — the exact shape offline-signer's sign-batch CLI command writes. */
export interface SignedCredentialEntry {
  payload: UnsignedCredentialPayload;
  issuerId: string;
  docId: string;
  contentHashHex: string;
  signatureHex: string;
  keySource: 'yubikey' | 'software_test_key';
}
