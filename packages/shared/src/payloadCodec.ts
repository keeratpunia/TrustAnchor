/**
 * payloadCodec.ts
 * ============================================================================
 * Builds the exact CborValue tree for each of the two signed payload types
 * (CredentialPayload, ManifestPayload) and exposes the resulting content
 * hash. This is the ONE place in the entire system where the mapping from
 * "our TypeScript object" to "the bytes that get hashed and signed" is
 * defined — the offline-signer calls these functions before signing, and
 * the backend/verifier call the identical functions before verifying.
 *
 * Every field is deliberately listed EXPLICITLY (never a generic "just walk
 * the object" loop) so that adding a field to CredentialPayload or
 * ManifestPayload in the future requires a conscious, visible edit here —
 * silently hashing a different byte layout than intended is exactly the
 * class of bug this file exists to make impossible.
 */
import { encodeCanonical, cborUint, cborText, cborNullableText, cborArray, cborMap, CborValue } from './canonicalCbor';
import { sha256, sha256Hex } from './hash';
import { CredentialPayload, ManifestPayload, IssuerKeyEntry, ManifestIssuerEntry } from './types';

/**
 * Converts a Record<string, string> (used for `fields` and `asset_hashes`)
 * into a canonical CBOR map of text-string values.
 */
function stringRecordToCborMap(record: Record<string, string>): CborValue {
  const out: Record<string, CborValue> = {};
  for (const key of Object.keys(record)) {
    out[key] = cborText(record[key]);
  }
  return cborMap(out);
}

/** Builds the CborValue tree for one issuer key entry (used inside the manifest). */
function issuerKeyToCborValue(key: IssuerKeyEntry): CborValue {
  return cborMap({
    public_key: cborText(key.public_key),
    valid_from: cborText(key.valid_from),
    valid_until: cborNullableText(key.valid_until),
  });
}

/** Builds the CborValue tree for one issuer entry (used inside the manifest). */
function issuerEntryToCborValue(issuer: ManifestIssuerEntry): CborValue {
  return cborMap({
    issuer_id: cborText(issuer.issuer_id),
    issuer_name: cborText(issuer.issuer_name),
    status: cborText(issuer.status),
    keys: cborArray(issuer.keys.map(issuerKeyToCborValue)),
  });
}

/**
 * Builds the complete CborValue tree for a CredentialPayload (Frozen Spec §7).
 * This is the exact byte layout that gets SHA-256'd and Ed25519-signed at
 * issuance, and re-derived by the verifier to check against the QR's
 * embedded hash.
 */
export function credentialPayloadToCborValue(payload: CredentialPayload): CborValue {
  return cborMap({
    v: cborUint(payload.v),
    issuer_id: cborText(payload.issuer_id),
    doc_id: cborText(payload.doc_id),
    template_id: cborText(payload.template_id),
    template_version: cborUint(payload.template_version),
    issued_at: cborText(payload.issued_at),
    expires_at: cborNullableText(payload.expires_at),
    fields: stringRecordToCborMap(payload.fields),
    asset_hashes: stringRecordToCborMap(payload.asset_hashes),
    template_hash: cborText(payload.template_hash),
  });
}

/**
 * Builds the complete CborValue tree for a ManifestPayload (Frozen Spec §8).
 * This is the exact byte layout that gets SHA-256'd and Ed25519-signed by
 * the platform trust key during a manifest-signing ceremony.
 */
export function manifestPayloadToCborValue(payload: ManifestPayload): CborValue {
  return cborMap({
    version: cborUint(payload.version),
    generated_at: cborText(payload.generated_at),
    valid_until: cborText(payload.valid_until),
    issuers: cborArray(payload.issuers.map(issuerEntryToCborValue)),
    revoked_docs: cborArray(payload.revoked_docs.map(cborText)),
  });
}

/**
 * Computes the content hash of a CredentialPayload: this is exactly the
 * value that gets signed at issuance (embedded as `h` in the QR) and
 * exactly the value the verifier must independently re-derive from the
 * fetched payload before trusting anything inside it (Frozen Spec §14
 * step 6).
 */
export function credentialContentHash(payload: CredentialPayload): Buffer {
  return sha256(encodeCanonical(credentialPayloadToCborValue(payload)));
}

export function credentialContentHashHex(payload: CredentialPayload): string {
  return sha256Hex(encodeCanonical(credentialPayloadToCborValue(payload)));
}

/**
 * Computes the content hash of a ManifestPayload: this is exactly the value
 * signed by the platform trust key during a manifest ceremony, and exactly
 * the value the verifier re-derives before checking the manifest's
 * signature (Frozen Spec §14 step 2).
 */
export function manifestContentHash(payload: ManifestPayload): Buffer {
  return sha256(encodeCanonical(manifestPayloadToCborValue(payload)));
}

export function manifestContentHashHex(payload: ManifestPayload): string {
  return sha256Hex(encodeCanonical(manifestPayloadToCborValue(payload)));
}
