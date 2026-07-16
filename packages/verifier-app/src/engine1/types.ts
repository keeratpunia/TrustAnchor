/**
 * types.ts (Verifier App) — mirrors packages/shared/src/types.ts exactly.
 * Kept as a separate copy (rather than a cross-package import) because this
 * app runs in a different JavaScript runtime (React Native/Expo, via
 * Metro), and this project's cryptographic core is deliberately kept
 * dependency-free across runtime boundaries — see engine1/canonicalCbor.ts's
 * header for the full rationale.
 */

export interface IssuerKeyEntry {
  public_key: string;
  valid_from: string;
  valid_until: string | null;
}

export interface ManifestIssuerEntry {
  issuer_id: string;
  issuer_name: string;
  status: 'active' | 'suspended';
  keys: IssuerKeyEntry[];
}

export interface ManifestPayload {
  version: number;
  generated_at: string;
  valid_until: string;
  issuers: ManifestIssuerEntry[];
  revoked_docs: string[];
}

export interface SignedManifest {
  payload: ManifestPayload;
  signature: string;
}

export interface CredentialPayload {
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

/** Decoded QR payload — fields read directly, never re-hashed as a whole (see qrCodec.ts). */
export interface QrPayload {
  v: 1;
  iss: number[]; // 16 bytes
  doc: number[]; // 16 bytes
  h: number[]; // 32 bytes
  sig: number[]; // 64 bytes
}

export type Engine1Status =
  | 'AUTHENTIC'
  | 'INVALID_QR'
  | 'BAD_MANIFEST_SIGNATURE'
  | 'MANIFEST_ROLLBACK'
  | 'MANIFEST_STALE'
  | 'UNKNOWN_ISSUER'
  | 'ISSUER_SUSPENDED'
  | 'HASH_MISMATCH'
  | 'IDENTITY_MISMATCH'
  | 'BAD_SIGNATURE'
  | 'REVOKED'
  | 'EXPIRED'
  | 'NETWORK_ERROR';

export interface Engine1Check {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Engine1Result {
  status: Engine1Status;
  checks: Engine1Check[];
  issuerName: string | null;
  fields: Record<string, string> | null;
  assetHashes: Record<string, string> | null;
  templateHash: string | null;
  docId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}
