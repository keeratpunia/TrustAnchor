/**
 * signManifest.ts
 * ============================================================================
 * OFFLINE TRUST MANIFEST SIGNING — Frozen Spec §4.2, §8, §9, §14.
 * ============================================================================
 * WHY THIS RUNS OFFLINE, EXACTLY LIKE CREDENTIAL SIGNING:
 *
 * The Trust Manifest is the single artifact that tells every verifier which
 * issuer public keys are legitimate, and which documents are revoked. If a
 * compromised runtime could sign this artifact itself, it could bind an
 * ATTACKER-CONTROLLED public key to a real issuer's name — the exact
 * "confused deputy" failure this whole design exists to prevent (Frozen
 * Spec §17: "Offline Platform Trust Key ... prevents a compromised runtime
 * from forging the issuer→public-key binding").
 *
 * This tool is run during a deliberate administrative ceremony: approving a
 * new issuer, rotating a key, revoking a document, or simply on the
 * periodic renewal schedule required to keep `valid_until` fresh (Frozen
 * Spec §9). Its output — the signed manifest JSON — is manually uploaded to
 * the Verification Server, which serves it verbatim without ever being able
 * to produce one itself.
 */
import nacl from 'tweetnacl';
import { ManifestPayload, SignedManifest, manifestContentHash } from '@trustanchor/shared';

/**
 * Signs a Trust Manifest payload offline, producing the complete
 * {payload, signature} object that gets uploaded to the Verification Server
 * and served verbatim at GET /manifest.
 *
 * @param payload The complete manifest payload (all issuers, their key
 *   validity windows, and the current revocation list).
 * @param platformPrivateKeyHex The platform's Ed25519 private key. This
 *   value must only ever exist on the offline signing machine used for
 *   manifest ceremonies — a physically separate device from any issuer's
 *   own signing machine (Frozen Spec §4.2).
 */
export function signManifest(
  payload: ManifestPayload,
  platformPrivateKeyHex: string
): SignedManifest {
  const contentHash = manifestContentHash(payload);

  const privateKeyBytes = Buffer.from(platformPrivateKeyHex, 'hex');
  if (privateKeyBytes.length !== 64) {
    throw new Error(
      `signManifest: platform private key must be exactly 64 bytes, got ${privateKeyBytes.length}.`
    );
  }

  const signature = nacl.sign.detached(
    new Uint8Array(contentHash),
    new Uint8Array(privateKeyBytes)
  );

  return {
    payload,
    signature: Buffer.from(signature).toString('hex'),
  };
}

/**
 * Verifies a signed manifest against the platform public key. Used by the
 * offline signer operator to self-check the ceremony's output before
 * uploading it, and duplicated (independently) by the verifier app when it
 * actually consumes the manifest — see verifier-app/src/engine1/verifyManifest.ts.
 */
export function verifyManifestSignatureOffline(
  signedManifest: SignedManifest,
  platformPublicKeyHex: string
): boolean {
  const contentHash = manifestContentHash(signedManifest.payload);
  const publicKeyBytes = Buffer.from(platformPublicKeyHex, 'hex');
  const signatureBytes = Buffer.from(signedManifest.signature, 'hex');

  if (publicKeyBytes.length !== 32) {
    throw new Error(
      `verifyManifestSignatureOffline: public key must be exactly 32 bytes, got ${publicKeyBytes.length}.`
    );
  }

  return nacl.sign.detached.verify(
    new Uint8Array(contentHash),
    new Uint8Array(signatureBytes),
    new Uint8Array(publicKeyBytes)
  );
}
