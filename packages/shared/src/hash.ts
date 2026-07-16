/**
 * hash.ts
 * ============================================================================
 * SHA-256 helper (Frozen Spec §24: SHA-256, 32-byte digest, the only hash
 * function used anywhere in Engine 1).
 * ============================================================================
 * This wraps Node's built-in `crypto` module rather than pulling in a
 * third-party hashing library — SHA-256 is a stable, unchanging primitive
 * built into the Node.js runtime, and using the platform's own
 * implementation removes an entire dependency (and its supply-chain risk)
 * for zero functional gain.
 */
import { createHash } from 'crypto';

/** Computes SHA-256 over arbitrary bytes and returns the raw 32-byte digest. */
export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Computes SHA-256 and returns the digest as lowercase hex (64 characters). */
export function sha256Hex(data: Buffer): string {
  return sha256(data).toString('hex');
}
