/**
 * validation.test.ts — unit tests for src/middleware/validation.ts.
 * Pure functions, no database or network dependency.
 */
import {
  isUuid,
  isSha256Hex,
  isEd25519SignatureHex,
  isEd25519PublicKeyHex,
  isIsoDateTime,
  isNonEmptyString,
} from '../../src/middleware/validation';

describe('isUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuid('a1b2c3d4-e5f6-4789-a012-3456789abcde')).toBe(true);
  });

  it('accepts uppercase UUIDs', () => {
    expect(isUuid('A1B2C3D4-E5F6-4789-A012-3456789ABCDE')).toBe(true);
  });

  it('rejects a UUID missing hyphens', () => {
    expect(isUuid('a1b2c3d4e5f64789a0123456789abcde')).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isUuid(12345)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isUuid('')).toBe(false);
  });

  it('rejects a UUID with wrong segment lengths', () => {
    expect(isUuid('a1b2c3d4-e5f6-478-a012-3456789abcde')).toBe(false);
  });
});

describe('isSha256Hex', () => {
  it('accepts a 64-character lowercase hex string', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
  });

  it('accepts a 64-character mixed-case hex string', () => {
    expect(isSha256Hex('aA'.repeat(32))).toBe(true);
  });

  it('rejects a string shorter than 64 characters', () => {
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
  });

  it('rejects a string longer than 64 characters', () => {
    expect(isSha256Hex('a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isSha256Hex('g'.repeat(64))).toBe(false);
  });
});

describe('isEd25519SignatureHex', () => {
  it('accepts a 128-character hex string', () => {
    expect(isEd25519SignatureHex('a'.repeat(128))).toBe(true);
  });

  it('rejects a 64-character hex string (too short for a signature)', () => {
    expect(isEd25519SignatureHex('a'.repeat(64))).toBe(false);
  });
});

describe('isEd25519PublicKeyHex', () => {
  it('accepts a 64-character hex string', () => {
    expect(isEd25519PublicKeyHex('a'.repeat(64))).toBe(true);
  });

  it('rejects a 128-character hex string (too long for a public key)', () => {
    expect(isEd25519PublicKeyHex('a'.repeat(128))).toBe(false);
  });
});

describe('isIsoDateTime', () => {
  it('accepts a valid ISO-8601 timestamp', () => {
    expect(isIsoDateTime('2026-05-20T00:00:00Z')).toBe(true);
  });

  it('rejects an unparseable string', () => {
    expect(isIsoDateTime('not-a-date')).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isIsoDateTime(1234567890)).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('accepts a non-empty string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isNonEmptyString(null)).toBe(false);
  });
});
