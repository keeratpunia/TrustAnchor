/**
 * payloadCodec.ts (Verifier App) — mirrors packages/shared/src/payloadCodec.ts
 * exactly. Builds the CborValue tree for a CredentialPayload and computes
 * its content hash — the SAME function shape used offline at issuance time
 * (see offline-signer/src/signCredential.ts), so that the hash the verifier
 * independently recomputes here can be compared against the hash the
 * issuer signed (Frozen Spec §14 step 6).
 */
import { encodeCanonical, cborUint, cborText, cborNullableText, cborMap, CborValue } from './canonicalCbor';
import { sha256Hex } from './hash';
import { CredentialPayload } from './types';

function stringRecordToCborMap(record: Record<string, string>): CborValue {
  const out: Record<string, CborValue> = {};
  for (const key of Object.keys(record)) {
    out[key] = cborText(record[key]);
  }
  return cborMap(out);
}

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
 * Recomputes the content hash of a fetched credential payload. This value
 * MUST be compared against the `h` field decoded from the scanned QR
 * (Frozen Spec §14 step 6) — a mismatch means the payload the server
 * returned is not the one the issuer signed, for any reason (tampering,
 * substitution, corruption).
 */
export function credentialContentHashHex(payload: CredentialPayload): string {
  return sha256Hex(encodeCanonical(credentialPayloadToCborValue(payload)));
}
