/**
 * keygen.ts
 * ============================================================================
 * Ed25519 KEY GENERATION — Frozen Spec §4.
 * ============================================================================
 * WHY THIS TOOL EXISTS AND WHY IT MUST NEVER RUN ON A NETWORKED MACHINE:
 *
 * Every guarantee in Engine 1 reduces to one fact: an attacker who
 * compromises the runtime server, the database, the network, or reverse
 * engineers the app can still never produce a valid Ed25519 signature,
 * because they never have access to a private key. That fact is only true
 * if private keys are generated and used EXCLUSIVELY on a machine the
 * attacker's threat model does not reach — i.e. an offline, air-gapped
 * machine (see Frozen Spec §2, "Trust Boundaries").
 *
 * This file is used to generate exactly two kinds of keys:
 *   - An Issuer Signing Key (one per institution), used to sign credential
 *     content hashes at issuance time.
 *   - The Platform Trust Key (one per deployment), used to sign the Trust
 *     Manifest.
 *
 * Both key types use the exact same generation function below — the
 * difference between them is purely how they are later used (see
 * signCredential.ts and signManifest.ts), not how they are created.
 *
 * OPERATIONAL REQUIREMENT (not enforceable by this code, only by
 * discipline): run this tool on a machine with no network interface
 * enabled, or a machine physically disconnected from any network, and never
 * copy the resulting private key file to any networked machine. Only the
 * PUBLIC key (openly shareable) should ever reach the Issuer Portal or
 * Verification Server.
 */
import nacl from 'tweetnacl';

/** The on-disk shape of a generated keypair — see cli.ts for how this gets written to a file. */
export interface KeyPairFile {
  /** A human-readable label, e.g. "XYZ University Issuer Key" or "TrustAnchor Platform Trust Key". */
  label: string;
  /** Ed25519 public key, lowercase hex, 64 hex characters (32 bytes). Safe to share openly. */
  publicKeyHex: string;
  /**
   * Ed25519 private key (technically the 64-byte "secret key" tweetnacl
   * uses, which is the 32-byte seed concatenated with the 32-byte public
   * key — this is the standard tweetnacl.sign.keyPair() representation).
   * lowercase hex, 128 hex characters (64 bytes).
   *
   * THIS VALUE MUST NEVER LEAVE THE OFFLINE SIGNING MACHINE.
   */
  privateKeyHex: string;
  /** ISO-8601 timestamp of when this key was generated, for audit/record-keeping. */
  generatedAt: string;
}

/**
 * Generates a fresh Ed25519 keypair.
 *
 * Uses tweetnacl's `nacl.sign.keyPair()`, which internally sources randomness
 * from the platform's cryptographically secure random number generator
 * (Node's `crypto.randomBytes` under the hood, or the equivalent secure
 * source on whatever runtime tweetnacl is executing under). We do not
 * implement our own randomness source — inventing new cryptographic
 * primitives, including randomness generation, is explicitly out of scope
 * (Frozen Spec instruction: "do not try to invent new cryptography").
 */
export function generateKeyPair(label: string): KeyPairFile {
  const keyPair = nacl.sign.keyPair();
  return {
    label,
    publicKeyHex: Buffer.from(keyPair.publicKey).toString('hex'),
    privateKeyHex: Buffer.from(keyPair.secretKey).toString('hex'),
    generatedAt: new Date().toISOString(),
  };
}
