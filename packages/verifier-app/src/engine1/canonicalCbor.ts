/**
 * canonicalCbor.ts (Verifier App)
 * ============================================================================
 * MUST PRODUCE BYTE-IDENTICAL OUTPUT TO packages/shared/src/canonicalCbor.ts
 * ============================================================================
 * This is a from-scratch reimplementation, not a shared import — React
 * Native (Expo/Metro) and the Node.js backend are different JavaScript
 * runtimes, and this project deliberately keeps its cryptographic core
 * dependency-free (see the backend file's header for the full rationale).
 * Every rule implemented here is identical to the backend's version; see
 * that file for the detailed "why" behind each one. This file's
 * correctness is additionally verified by a cross-implementation test: the
 * project's test suite generates a payload on the backend, signs it, and
 * confirms THIS file's hash of the same logical payload matches exactly —
 * see tests/crossImplementation.test.ts at the project root testing
 * infrastructure.
 *
 * Uses plain `number[]` (byte arrays) throughout rather than Node's Buffer,
 * which does not exist in the React Native runtime.
 */

export type CborValue =
  | { readonly kind: 'uint'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: number[] }
  | { readonly kind: 'null' }
  | { readonly kind: 'array'; readonly value: readonly CborValue[] }
  | { readonly kind: 'map'; readonly value: Readonly<Record<string, CborValue>> };

export const cborUint = (value: number): CborValue => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`cborUint: value must be a non-negative integer, got ${value}.`);
  }
  return { kind: 'uint', value };
};
export const cborText = (value: string): CborValue => ({ kind: 'text', value });
export const cborBytes = (value: number[]): CborValue => ({ kind: 'bytes', value });
export const cborNull = (): CborValue => ({ kind: 'null' });
export const cborArray = (value: readonly CborValue[]): CborValue => ({ kind: 'array', value });
export const cborMap = (value: Readonly<Record<string, CborValue>>): CborValue => ({ kind: 'map', value });
export const cborNullableText = (value: string | null): CborValue => (value === null ? cborNull() : cborText(value));

const MAJOR_UINT = 0b000 << 5;
const MAJOR_BYTES = 0b010 << 5;
const MAJOR_TEXT = 0b011 << 5;
const MAJOR_ARRAY = 0b100 << 5;
const MAJOR_MAP = 0b101 << 5;
const SIMPLE_NULL = 0xf6;

/** UTF-8 encode a JS string into a plain byte array (no Buffer/TextEncoder dependency assumed). */
function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let codePoint = str.codePointAt(i)!;
    if (codePoint > 0xffff) i++; // surrogate pair consumes two UTF-16 units

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

function encodeHeader(majorType: number, n: number): number[] {
  if (n < 24) return [majorType | n];
  if (n <= 0xff) return [majorType | 24, n];
  if (n <= 0xffff) return [majorType | 25, (n >> 8) & 0xff, n & 0xff];
  return [
    majorType | 26,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ];
}

function encodeValue(v: CborValue): number[] {
  switch (v.kind) {
    case 'uint':
      return encodeHeader(MAJOR_UINT, v.value);

    case 'text': {
      const normalized = v.value.normalize('NFC');
      const utf8 = utf8Encode(normalized);
      return [...encodeHeader(MAJOR_TEXT, utf8.length), ...utf8];
    }

    case 'bytes':
      return [...encodeHeader(MAJOR_BYTES, v.value.length), ...v.value];

    case 'null':
      return [SIMPLE_NULL];

    case 'array': {
      const header = encodeHeader(MAJOR_ARRAY, v.value.length);
      const items = v.value.flatMap(encodeValue);
      return [...header, ...items];
    }

    case 'map': {
      const keys = Object.keys(v.value);
      const seen = new Set<string>();
      for (const k of keys) {
        if (seen.has(k)) throw new Error(`canonicalCbor: duplicate map key "${k}".`);
        seen.add(k);
      }

      const encodedEntries = keys.map((key) => ({
        encodedKey: encodeValue(cborText(key)),
        encodedVal: encodeValue(v.value[key]),
      }));

      encodedEntries.sort((a, b) => compareBytes(a.encodedKey, b.encodedKey));

      const header = encodeHeader(MAJOR_MAP, keys.length);
      const pairs = encodedEntries.flatMap((e) => [...e.encodedKey, ...e.encodedVal]);
      return [...header, ...pairs];
    }

    default: {
      const exhaustiveCheck: never = v;
      throw new Error(`canonicalCbor: unknown CborValue kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function compareBytes(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** Public entry point: encode any CborValue tree into its canonical byte array. */
export function encodeCanonical(value: CborValue): number[] {
  return encodeValue(value);
}
