/**
 * signCredential.ts
 * ============================================================================
 * OFFLINE CREDENTIAL SIGNING — Frozen Spec §4.1, §7, §12, §14.
 * ============================================================================
 * WHY THIS RUNS OFFLINE, NOT ON THE ISSUER PORTAL'S BACKEND:
 *
 * If the Issuer Portal's networked backend could invoke this signing
 * operation directly (e.g. an in-process function call reachable from an
 * API route), then compromising that backend would let an attacker sign
 * ARBITRARY, attacker-chosen credential content — a "signing oracle." This
 * is the exact failure mode the Frozen Spec's offline-key requirement
 * exists to prevent (§4.1: "The Issuer Portal backend itself never invokes
 * the signing key").
 *
 * The correct operational flow is:
 *   1. The (networked) Issuer Portal composes a candidate credential
 *      payload and exports it as a plain JSON file (no signature yet).
 *   2. That file is transferred, out-of-band (e.g. USB drive), to an
 *      offline machine running THIS tool.
 *   3. This tool computes the canonical content hash and signs it via a
 *      KeySigner (see keySigner.ts — either a YubiKey, key material never
 *      leaving the device, or a software test key for development).
 *   4. The resulting (hash, signature) pair — and only that pair — is
 *      transferred back to the networked side, where it gets embedded in
 *      the printable QR code.
 *
 * This file implements step 3.
 */
import { CredentialPayload, credentialContentHash } from '@trustanchor/shared';
import { KeySigner, KeySource } from './keySigner';
import nacl from 'tweetnacl';

/** The result of signing one credential payload offline. */
export interface SignedCredentialResult {
  /** SHA-256 content hash of the canonical CBOR encoding of the payload — 32 bytes. */
  contentHash: Buffer;
  contentHashHex: string;
  /** Ed25519 signature over `contentHash`, produced by the issuer's key — 64 bytes. */
  signature: Buffer;
  signatureHex: string;
  /** Which kind of key actually produced this signature — carried alongside the result so nothing downstream has to guess. */
  keySource: KeySource;
}

/**
 * Signs a credential payload offline, via the given KeySigner.
 *
 * @param payload The complete, final credential payload (all fields, asset
 *   hashes, and the template hash already filled in — nothing about the
 *   payload should change after this point, since any change would produce
 *   a different hash and invalidate this signature).
 * @param signer A KeySigner — SoftwareTestKeySigner or YubiKeySigner (see
 *   keySigner.ts). This function has no idea which one it received, by
 *   design: it only ever asks for a signature, never handles key material
 *   directly.
 */
export async function signCredential(
  payload: CredentialPayload,
  signer: KeySigner
): Promise<SignedCredentialResult> {
  // Step 1: compute the canonical content hash. This is the SAME function
  // the backend/verifier will later call on the payload they fetch — using
  // any other hashing path here would produce a signature that no verifier
  // could ever successfully check.
  const contentHash = credentialContentHash(payload);

  // Step 2: sign the hash (never the raw payload) with Ed25519, via
  // whichever signer was provided. Signing a fixed-size 32-byte hash,
  // rather than variable-length data, keeps the signing operation's cost
  // constant regardless of how many fields or assets a given template has
  // (Frozen Spec §12).
  const signature = await signer.sign(contentHash);

  return {
    contentHash,
    contentHashHex: contentHash.toString('hex'),
    signature,
    signatureHex: signature.toString('hex'),
    keySource: signer.keySource,
  };
}

/**
 * Verifies a credential signature. This function exists in the offline
 * signer for the signer operator's own sanity-checking immediately after
 * signing (a "did I actually sign this correctly" self-check before
 * transferring the result back to the networked side) — it duplicates logic
 * the verifier app will independently run, which is intentional: the
 * offline signer should never simply trust its own signing call succeeded
 * without confirming the signature actually verifies against the public key.
 *
 * Deliberately synchronous and independent of KeySigner: verification only
 * ever needs the PUBLIC key, never a signer, regardless of whether the
 * signature came from a software test key or a YubiKey.
 */
export function verifyCredentialSignatureOffline(
  contentHash: Buffer,
  signature: Buffer,
  issuerPublicKeyHex: string
): boolean {
  const publicKeyBytes = Buffer.from(issuerPublicKeyHex, 'hex');
  if (publicKeyBytes.length !== 32) {
    throw new Error(
      `verifyCredentialSignatureOffline: public key must be exactly 32 bytes, got ${publicKeyBytes.length}.`
    );
  }
  return nacl.sign.detached.verify(
    new Uint8Array(contentHash),
    new Uint8Array(signature),
    new Uint8Array(publicKeyBytes)
  );
}
