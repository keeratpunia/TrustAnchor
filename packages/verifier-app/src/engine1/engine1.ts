/**
 * engine1.ts — THE Engine 1 verification algorithm.
 * ============================================================================
 * Implements Frozen Architecture Specification §14 EXACTLY, step for step.
 * Do not reorder, skip, or "optimize" any step — each one exists to close a
 * specific attack described in §28 ("Attack Analysis"). This function is
 * the single most important piece of code in the entire app: everything
 * else exists to support it.
 * ============================================================================
 */
import nacl from 'tweetnacl';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PLATFORM_PUBLIC_KEY_HEX, MANIFEST_VERSION_STORAGE_KEY } from '../config';
import { fetchManifest, fetchCredential, NetworkError } from '../api/client';
import { decodeQrPayload, bytesToUuid, bytesToHex, hexToBytes } from './qrCodec';
import { credentialContentHashHex } from './payloadCodec';
import { encodeCanonical, cborUint, cborText, cborArray, cborMap, cborNullableText } from './canonicalCbor';
import { sha256Hex } from './hash';
import {
  Engine1Result,
  Engine1Check,
  Engine1Status,
  SignedManifest,
  ManifestIssuerEntry,
  CredentialPayload,
} from './types';

function emptyResult(): Engine1Result {
  return {
    status: 'INVALID_QR',
    checks: [],
    issuerName: null,
    fields: null,
    assetHashes: null,
    templateHash: null,
    docId: null,
    issuedAt: null,
    expiresAt: null,
  };
}

function fail(result: Engine1Result, status: Engine1Status, checkName: string, detail: string): Engine1Result {
  result.status = status;
  result.checks.push({ name: checkName, passed: false, detail });
  return result;
}

function pass(result: Engine1Result, checkName: string, detail: string): void {
  result.checks.push({ name: checkName, passed: true, detail });
}

/**
 * Selects the issuer key whose validity window contains `issuedAtIso`. This
 * function does NOT itself verify a signature — see step 8 in
 * verifyEngine1 for why signature verification is tried against candidate
 * keys directly, with the window check applied only as a secondary,
 * non-security-critical correctness gate (Frozen Spec §14 step 8 comment,
 * §16 assumption 5).
 */
function findCandidateKeys(issuer: ManifestIssuerEntry, issuedAtIso: string): string[] {
  const issuedAtMs = new Date(issuedAtIso).getTime();
  return issuer.keys
    .filter((k) => {
      const from = new Date(k.valid_from).getTime();
      const until = k.valid_until ? new Date(k.valid_until).getTime() : Infinity;
      return issuedAtMs >= from && issuedAtMs <= until;
    })
    .map((k) => k.public_key);
}

/**
 * Runs the complete Engine 1 verification algorithm on a scanned QR code's
 * raw bytes.
 *
 * @param qrBytes The raw bytes decoded from the scanned QR code (before any
 *   CBOR parsing — this function does that itself, step 1).
 * @returns The complete Engine1Result — a status plus a step-by-step trace
 *   for display to the user.
 */
export async function verifyEngine1(qrBytes: number[]): Promise<Engine1Result> {
  const result = emptyResult();

  // ── STEP 1: Decode the scanned QR as CBOR (Frozen Spec §14 step 1) ──
  let qr;
  try {
    qr = decodeQrPayload(qrBytes);
  } catch (err) {
    return fail(result, 'INVALID_QR', 'QR Decode', `Not a TrustAnchor QR code: ${(err as Error).message}`);
  }
  const issuerId = bytesToUuid(qr.iss);
  const docId = bytesToUuid(qr.doc);
  const qrHashHex = bytesToHex(qr.h);
  result.docId = docId;
  pass(result, 'QR Decode', `Protocol v${qr.v}, document ${docId.slice(0, 8)}...`);

  // ── STEP 2: Fetch Trust Manifest, verify its signature (Frozen Spec §14 step 2) ──
  let signedManifest: SignedManifest;
  try {
    signedManifest = (await fetchManifest()) as SignedManifest;
  } catch (err) {
    if (err instanceof NetworkError) {
      return fail(result, 'NETWORK_ERROR', 'Trust Manifest', `Could not reach the verification server: ${err.message}`);
    }
    return fail(result, 'NETWORK_ERROR', 'Trust Manifest', `Unexpected error fetching manifest: ${(err as Error).message}`);
  }

  const manifestSigBytes = hexToBytes(signedManifest.signature);
  const platformKeyBytes = hexToBytes(PLATFORM_PUBLIC_KEY_HEX);
  // The manifest's signature is computed over SHA-256(canonical CBOR(payload)).
  // We reuse the credential payload's canonicalization primitives via a
  // small inline builder here, mirroring packages/shared's
  // manifestContentHash exactly (see that file for the authoritative
  // definition this must stay in sync with).

  function issuerKeyToCbor(k: { public_key: string; valid_from: string; valid_until: string | null }) {
    return cborMap({
      public_key: cborText(k.public_key),
      valid_from: cborText(k.valid_from),
      valid_until: cborNullableText(k.valid_until),
    });
  }
  function issuerToCbor(i: ManifestIssuerEntry) {
    return cborMap({
      issuer_id: cborText(i.issuer_id),
      issuer_name: cborText(i.issuer_name),
      status: cborText(i.status),
      keys: cborArray(i.keys.map(issuerKeyToCbor)),
    });
  }
  const manifestPayloadCbor = cborMap({
    version: cborUint(signedManifest.payload.version),
    generated_at: cborText(signedManifest.payload.generated_at),
    valid_until: cborText(signedManifest.payload.valid_until),
    issuers: cborArray(signedManifest.payload.issuers.map(issuerToCbor)),
    revoked_docs: cborArray(signedManifest.payload.revoked_docs.map(cborText)),
  });
  const manifestHashHex = sha256Hex(encodeCanonical(manifestPayloadCbor));
  const manifestHashBytes = hexToBytes(manifestHashHex);

  const manifestSigOk = nacl.sign.detached.verify(
    new Uint8Array(manifestHashBytes),
    new Uint8Array(manifestSigBytes),
    new Uint8Array(platformKeyBytes)
  );

  if (!manifestSigOk) {
    return fail(result, 'BAD_MANIFEST_SIGNATURE', 'Trust Manifest Signature', 'Manifest signature does not verify against the hardcoded platform public key.');
  }
  pass(result, 'Trust Manifest Signature', `Verified against platform key (version ${signedManifest.payload.version})`);

  // ── STEP 3: Monotonic version / rollback check (Frozen Spec §14 step 3) ──
  let highestSeenVersion = 0;
  try {
    const stored = await AsyncStorage.getItem(MANIFEST_VERSION_STORAGE_KEY);
    highestSeenVersion = stored ? parseInt(stored, 10) : 0;
  } catch {
    // Storage read failure: proceed conservatively without persisting a
    // downgrade — this only affects rollback DETECTION across app restarts,
    // not the current verification's core cryptographic guarantees.
  }
  if (signedManifest.payload.version < highestSeenVersion) {
    return fail(
      result,
      'MANIFEST_ROLLBACK',
      'Manifest Freshness',
      `Manifest version ${signedManifest.payload.version} is older than a previously seen version ${highestSeenVersion} — possible replay attack.`
    );
  }
  if (signedManifest.payload.version > highestSeenVersion) {
    try {
      await AsyncStorage.setItem(MANIFEST_VERSION_STORAGE_KEY, String(signedManifest.payload.version));
    } catch {
      // Non-fatal — see comment above.
    }
  }

  // ── STEP 4: Staleness check (Frozen Spec §14 step 4) ──
  const validUntilMs = new Date(signedManifest.payload.valid_until).getTime();
  if (Date.now() > validUntilMs) {
    return fail(
      result,
      'MANIFEST_STALE',
      'Manifest Freshness',
      `Manifest expired at ${signedManifest.payload.valid_until}. A fresh manifest is required — this may indicate a network-blocking attack hiding a revocation, or simply that the device has been offline too long.`
    );
  }
  pass(result, 'Manifest Freshness', `Valid until ${signedManifest.payload.valid_until}`);

  // ── STEP 5: Issuer lookup + status check (Frozen Spec §14 step 5) ──
  const issuer = signedManifest.payload.issuers.find((i) => i.issuer_id === issuerId);
  if (!issuer) {
    return fail(result, 'UNKNOWN_ISSUER', 'Issuer Trust', `Issuer ${issuerId} is not present in the trust manifest.`);
  }
  if (issuer.status !== 'active') {
    return fail(result, 'ISSUER_SUSPENDED', 'Issuer Trust', `Issuer "${issuer.issuer_name}" has status "${issuer.status}", not "active".`);
  }
  result.issuerName = issuer.issuer_name;
  pass(result, 'Issuer Trust', issuer.issuer_name);

  // ── STEP 6: Fetch credential payload, recompute hash, compare to qr.h (Frozen Spec §14 step 6) ──
  let payload: CredentialPayload;
  try {
    payload = (await fetchCredential(docId)) as CredentialPayload;
  } catch (err) {
    if (err instanceof NetworkError) {
      return fail(result, 'NETWORK_ERROR', 'Credential Fetch', `Could not reach the verification server: ${err.message}`);
    }
    return fail(result, 'NETWORK_ERROR', 'Credential Fetch', `Unexpected error fetching credential: ${(err as Error).message}`);
  }

  const recomputedHashHex = credentialContentHashHex(payload);
  if (recomputedHashHex !== qrHashHex) {
    return fail(
      result,
      'HASH_MISMATCH',
      'Content Integrity',
      'The recomputed hash of the fetched credential does not match the hash signed in the QR code. The credential\'s data has been tampered with, substituted, or corrupted.'
    );
  }
  pass(result, 'Content Integrity', 'Recomputed SHA-256 matches the signed hash from the QR');

  // ── STEP 7: Identity binding check (Frozen Spec §14 step 7) ──
  if (payload.doc_id !== docId || payload.issuer_id !== issuerId) {
    return fail(
      result,
      'IDENTITY_MISMATCH',
      'Identity Binding',
      'The fetched credential\'s doc_id/issuer_id do not match the scanned QR — possible credential substitution.'
    );
  }
  pass(result, 'Identity Binding', 'Credential identity matches the scanned QR');

  // ── STEP 8: Signature verification against a candidate issuer key (Frozen Spec §14 step 8) ──
  const candidateKeys = findCandidateKeys(issuer, payload.issued_at);
  if (candidateKeys.length === 0) {
    return fail(
      result,
      'BAD_SIGNATURE',
      'Signature',
      `No key for issuer "${issuer.issuer_name}" has a validity window covering the issuance time ${payload.issued_at}.`
    );
  }
  const qrHashBytes = qr.h;
  const qrSigBytes = qr.sig;
  const signatureOk = candidateKeys.some((keyHex) =>
    nacl.sign.detached.verify(new Uint8Array(qrHashBytes), new Uint8Array(qrSigBytes), new Uint8Array(hexToBytes(keyHex)))
  );
  if (!signatureOk) {
    return fail(result, 'BAD_SIGNATURE', 'Signature', 'Ed25519 signature does not verify against any valid key for this issuer. This credential was not genuinely signed.');
  }
  pass(result, 'Signature', 'Ed25519 signature verified against the issuer\'s key');

  // ── STEP 9: Revocation check (Frozen Spec §14 step 9) ──
  if (signedManifest.payload.revoked_docs.includes(docId)) {
    return fail(result, 'REVOKED', 'Revocation', 'This document has been revoked by the issuer.');
  }
  pass(result, 'Revocation', 'Not present in the revoked documents list');

  // ── STEP 10: Expiry check (Frozen Spec §14 step 10) ──
  if (payload.expires_at !== null) {
    const expiresAtMs = new Date(payload.expires_at).getTime();
    if (Date.now() > expiresAtMs) {
      return fail(result, 'EXPIRED', 'Expiry', `This credential expired at ${payload.expires_at}.`);
    }
    pass(result, 'Expiry', `Valid until ${payload.expires_at}`);
  } else {
    pass(result, 'Expiry', 'This credential has no expiry (Frozen Spec §5 — no global MAX_AGE)');
  }

  // ── STEP 11: AUTHENTIC (Frozen Spec §14 step 11) ──
  result.status = 'AUTHENTIC';
  result.fields = payload.fields;
  result.assetHashes = payload.asset_hashes;
  result.templateHash = payload.template_hash;
  result.issuedAt = payload.issued_at;
  result.expiresAt = payload.expires_at;
  return result;
}
