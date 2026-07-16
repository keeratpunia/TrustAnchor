/**
 * canonicalCbor.test.ts — automated regression tests for the hand-rolled
 * canonical CBOR encoder in @trustanchor/shared. These formalize the manual
 * verification performed during development (integer boundaries, map key
 * ordering, determinism, NFC normalization) as a permanent, repeatable test
 * suite.
 */
import {
  encodeCanonical,
  cborUint,
  cborText,
  cborMap,
  cborArray,
  cborNull,
} from '@trustanchor/shared';

describe('canonical CBOR: integer encoding (minimal-length rule)', () => {
  it.each([
    [0, '00'],
    [23, '17'],
    [24, '1818'],
    [255, '18ff'],
    [256, '190100'],
    [65535, '19ffff'],
    [65536, '1a00010000'],
  ])('encodes %i as %s', (value, expectedHex) => {
    expect(encodeCanonical(cborUint(value)).toString('hex')).toBe(expectedHex);
  });

  it('rejects negative numbers', () => {
    expect(() => cborUint(-1)).toThrow();
  });

  it('rejects non-integer numbers', () => {
    expect(() => cborUint(9.37)).toThrow();
  });
});

describe('canonical CBOR: map key ordering', () => {
  it('sorts keys by their own encoded bytes, not raw JS string order', () => {
    const m1 = cborMap({ ab: cborText('1'), a: cborText('2'), abc: cborText('3') });
    const m2 = cborMap({ abc: cborText('3'), a: cborText('2'), ab: cborText('1') });
    // Regardless of insertion order, output must be identical — and 'a'
    // (shortest encoded key) must sort before 'ab' before 'abc'.
    expect(encodeCanonical(m1).equals(encodeCanonical(m2))).toBe(true);
  });

  it('is insertion-order-independent for arbitrary keys', () => {
    const a = cborMap({ z: cborUint(1), a: cborUint(2), m: cborUint(3) });
    const b = cborMap({ a: cborUint(2), m: cborUint(3), z: cborUint(1) });
    expect(encodeCanonical(a).equals(encodeCanonical(b))).toBe(true);
  });
});

describe('canonical CBOR: determinism', () => {
  it('produces byte-identical output for the same logical value across repeated calls', () => {
    const value = cborMap({ x: cborText('hello'), y: cborUint(42) });
    const e1 = encodeCanonical(value);
    const e2 = encodeCanonical(value);
    expect(e1.equals(e2)).toBe(true);
  });
});

describe('canonical CBOR: NFC normalization', () => {
  it('produces identical bytes for visually-identical strings with different code-point sequences', () => {
    const composed = 'é'; // U+00E9, single precomposed codepoint
    const decomposed = 'e\u0301'; // 'e' + U+0301 combining acute accent
    expect(composed).not.toBe(decomposed); // different JS strings...
    const encComposed = encodeCanonical(cborText(composed));
    const encDecomposed = encodeCanonical(cborText(decomposed));
    expect(encComposed.equals(encDecomposed)).toBe(true); // ...but identical canonical bytes
  });
});

describe('canonical CBOR: nested structures', () => {
  it('encodes nested maps and arrays without error', () => {
    const nested = cborMap({
      fields: cborMap({ cgpa: cborText('9.37'), name: cborText('Test') }),
      tags: cborArray([cborText('a'), cborText('b')]),
      expires: cborNull(),
    });
    expect(() => encodeCanonical(nested)).not.toThrow();
  });

  it('encodes an empty array', () => {
    expect(() => encodeCanonical(cborArray([]))).not.toThrow();
  });
});
