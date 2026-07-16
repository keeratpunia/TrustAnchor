/**
 * types.ts
 * ============================================================================
 * Exact wire-format types for Engine 1 — mirrors Frozen Spec §7, §8, §26.
 * ============================================================================
 * These types are used identically by the offline-signer (which builds and
 * signs them) and the backend (which stores and serves them as plain data).
 * The verifier app has its own parallel copies of the equivalent shapes
 * (TypeScript types have no runtime existence to "share" across an Expo/RN
 * bundle boundary) — see packages/verifier-app/src/engine1/types.ts, which
 * is kept in exact structural sync with this file by design and by the
 * cross-implementation tests in this project.
 */

/** One issuer signing key's validity window (Frozen Spec §8, §17). */
export interface IssuerKeyEntry {
  /** Ed25519 public key, lowercase hex, exactly 64 hex characters (32 bytes). */
  public_key: string;
  /** ISO-8601 timestamp: this key becomes valid at this instant. */
  valid_from: string;
  /** ISO-8601 timestamp, or null if the key has no planned expiry. */
  valid_until: string | null;
}

/** One issuer's entry inside the Trust Manifest (Frozen Spec §8). */
export interface ManifestIssuerEntry {
  /** UUID v4 string. */
  issuer_id: string;
  issuer_name: string;
  /** "active" issuers are trusted; "suspended" issuers are not (Frozen Spec §14 step 5). */
  status: 'active' | 'suspended';
  keys: IssuerKeyEntry[];
}

/**
 * The Trust Manifest payload — the ONE signed artifact that replaces what
 * might otherwise be three separate objects (issuer registry, revocation
 * list, freshness/versioning). See Frozen Spec §8, §9, §18.
 */
export interface ManifestPayload {
  /** Monotonically increasing. Verifier rejects any manifest with version < highest seen (rollback defense, §14 step 3). */
  version: number;
  /** ISO-8601 timestamp of when this manifest was produced by the offline signer. */
  generated_at: string;
  /** ISO-8601 timestamp. Verifier rejects the manifest as stale once "now" passes this (§14 step 4). */
  valid_until: string;
  issuers: ManifestIssuerEntry[];
  /** doc_id strings of every revoked document. */
  revoked_docs: string[];
}

/** The complete signed manifest object as served by GET /manifest. */
export interface SignedManifest {
  payload: ManifestPayload;
  /** Ed25519 signature, lowercase hex, exactly 128 hex characters (64 bytes), over SHA-256(canonical CBOR(payload)). */
  signature: string;
}

/**
 * The credential payload — the raw, unsigned data stored server-side and
 * fetched by doc_id (Frozen Spec §7). There is deliberately no signature
 * stored alongside this object; the only signature that matters lives in
 * the QR itself (see qrTypes below), produced once at issuance.
 */
export interface CredentialPayload {
  /** Protocol version. Always 1 for this specification. */
  v: 1;
  /** UUID v4 string. */
  issuer_id: string;
  /** UUID v4 string. */
  doc_id: string;
  /** UUID v4 string. */
  template_id: string;
  /** Non-negative integer. Encoded as a genuine CBOR integer (not a string) — see canonicalCbor.ts rule 5. */
  template_version: number;
  /** ISO-8601 timestamp of issuance. */
  issued_at: string;
  /** ISO-8601 timestamp, or null if this credential never expires (Frozen Spec §5, §27 edge case 5). */
  expires_at: string | null;
  /**
   * Every field value is a TEXT STRING, even values that look numeric
   * (e.g. a CGPA of "9.37"). This is rule 5 of canonicalCbor.ts: no
   * floating-point ambiguity, ever, for signed data.
   */
  fields: Record<string, string>;
  /** asset name -> SHA-256 hex digest (64 hex chars) of that asset's raw bytes. */
  asset_hashes: Record<string, string>;
  /** SHA-256 hex digest of the canonical CBOR encoding of the template's layout definition. */
  template_hash: string;
}

/**
 * The QR payload (Frozen Spec §6). This is the ONLY data physically printed
 * on the document. Deliberately minimal — everything else is fetched from
 * the (untrusted, but self-authenticating) backend by doc_id.
 *
 * NOTE: unlike CredentialPayload and ManifestPayload, this type is never run
 * through the canonical CBOR encoder above — its fields are read out
 * directly once decoded, never re-hashed as a whole. See qrCodec.ts.
 */
export interface QrPayload {
  /** Protocol version. Always 1. */
  v: 1;
  /** issuer_id as a raw 16-byte UUID (not the hyphenated string form). */
  iss: Buffer;
  /** doc_id as a raw 16-byte UUID. */
  doc: Buffer;
  /** SHA-256 content hash of the credential payload — exactly 32 bytes. */
  h: Buffer;
  /** Ed25519 signature over `h`, produced offline by the issuer key — exactly 64 bytes. */
  sig: Buffer;
}

/** The final Engine 1 verdict, returned by the verifier's verification algorithm. */
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

/** One step of the verification trace, shown to the end user for transparency. */
export interface Engine1Check {
  name: string;
  passed: boolean;
  detail: string;
}

/** The complete result of running Engine 1's verification algorithm (Frozen Spec §14). */
export interface Engine1Result {
  status: Engine1Status;
  checks: Engine1Check[];
  /** Populated only when status === 'AUTHENTIC'. */
  issuerName: string | null;
  fields: Record<string, string> | null;
  assetHashes: Record<string, string> | null;
  templateHash: string | null;
  docId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}
