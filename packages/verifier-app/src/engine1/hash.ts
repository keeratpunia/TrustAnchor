/**
 * hash.ts (Verifier App) — SHA-256 helper using js-sha256.
 *
 * Uses the `js-sha256` package (pure JavaScript, zero native dependencies)
 * rather than `expo-crypto` (which requires a custom development build and
 * does not work in Expo Go) or Node's built-in `crypto` (which does not
 * exist in the React Native runtime). This keeps the app runnable via
 * `expo start` with no native build step, which matters for this project's
 * "must be directly runnable" requirement.
 */
import { sha256 } from 'js-sha256';

/** Computes SHA-256 over a byte array, returning the digest as a plain number[] (32 bytes). */
export function sha256Bytes(data: number[]): number[] {
  return sha256.array(data);
}

/** Computes SHA-256 and returns the digest as lowercase hex (64 characters). */
export function sha256Hex(data: number[]): string {
  return sha256(new Uint8Array(data));
}
