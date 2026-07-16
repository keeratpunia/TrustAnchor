/**
 * canonicalCbor.ts
 * ============================================================================
 * DETERMINISTIC CANONICAL CBOR ENCODER — Engine 1 Frozen Specification §11, §25
 * ============================================================================
 *
 * WHY THIS FILE EXISTS AND WHY IT IS HAND-WRITTEN (not a third-party library):
 *
 * Every trust decision in TrustAnchor Engine 1 ultimately reduces to one
 * operation: "does SHA-256(bytes-I-just-received) equal a hash that an
 * offline Ed25519 key signed?" For that comparison to ever succeed for a
 * genuine credential, the ISSUER (encoding a payload before signing it,
 * offline) and the VERIFIER (encoding the same payload after fetching it
 * from untrusted storage) must produce BYTE-IDENTICAL output from the same
 * logical data. If they diverge by even one byte — a different map key
 * order, a different integer-length encoding, a different Unicode
 * normalization — every genuine credential would fail verification and the
 * whole system would be useless.
 *
 * "Canonical" CBOR (RFC 8949 §4.2, "Core Deterministic Encoding
 * Requirements") exists specifically to remove this class of ambiguity: for
 * any given logical value, there is exactly ONE valid encoding. This file
 * implements exactly the subset of that ruleset TrustAnchor needs — nothing
 * more, nothing exotic — so that its behavior can be fully read, understood,
 * and tested rather than trusted as a black box.
 *
 * THE RULES IMPLEMENTED (and why each one is here):
 *
 *   1. Integers use the fewest possible bytes.
 *      Why: without this rule, the number 5 could be encoded as a single
 *      byte OR padded to 4 bytes — two different byte sequences for the same
 *      logical value would break the hash comparison.
 *
 *   2. Map keys are sorted by the bytewise lexicographic order of each key's
 *      OWN CANONICAL ENCODING (not by the raw JS string).
 *      Why: a signed payload's object-key order is otherwise arbitrary
 *      (JS objects don't guarantee order across two different processes /
 *      languages). Both issuer and verifier must independently arrive at the
 *      identical key order without ever communicating it — sorting by each
 *      key's own encoded bytes gives a single unambiguous rule both sides
 *      can compute alone.
 *
 *   3. Only definite-length items are used — no indefinite-length "streaming"
 *      CBOR. Why: indefinite-length encoding allows the same logical array/
 *      map to be split into chunks in more than one way. Canonical form
 *      forbids this ambiguity entirely.
 *
 *   4. No duplicate map keys.
 *      Why: a payload with a duplicate key is already malformed data; two
 *      different decoders could legally pick the first-seen or last-seen
 *      value, which would let an attacker construct a payload that hashes
 *      one way on the issuer's encoder and is interpreted a different way by
 *      the verifier. We reject the possibility outright at encode time.
 *
 *   5. No floating-point values, anywhere.
 *      Why: floating point has more than one valid bit-pattern for
 *      "the same" value in different contexts (subnormals, NaN payloads,
 *      -0 vs 0), and different runtimes are not guaranteed to serialize
 *      floats identically. Anything that looks numeric but is really a
 *      measured/typed value (a CGPA, a percentage) is represented as an
 *      exact TEXT STRING instead (e.g. "9.37"), which has no such ambiguity.
 *      The only real CBOR integers this system ever signs are protocol
 *      counters (template_version, manifest version) — genuinely discrete,
 *      unambiguous non-negative integers.
 *
 *   6. Text strings are UTF-8, normalized to Unicode Normalization Form C
 *      (NFC) before encoding.
 *      Why: the same visible text can be represented by more than one
 *      underlying sequence of Unicode code points (a classic hazard with
 *      multilingual/accented input — e.g. "é" as one composed code point vs.
 *      "e" + a combining accent). NFC normalization guarantees a single
 *      canonical code-point sequence for visually-identical text, which is
 *      required for a multilingual credential system.
 *
 *   7. Byte strings are used ONLY for fixed-length binary fields (UUIDs,
 *      hashes, signatures), each of a known, fixed length.
 *      Why: fixing the expected length of every binary field removes any
 *      length-encoding ambiguity and makes malformed/truncated data
 *      trivially detectable.
 *
 * WHAT THIS FILE DOES NOT DO (deliberately):
 *   - It is NOT used to encode the QR payload. The QR's own bytes are never
 *     re-hashed or compared against anything — its five fields are read out
 *     directly once decoded. Determinism only matters for objects that get
 *     hashed-and-signed: the credential payload and the trust manifest
 *     payload. See qrCodec.ts for the QR's (much simpler, non-canonical)
 *     encoding.
 */

/**
 * A tagged representation of every value this encoder can accept.
 *
 * Plain JavaScript objects are deliberately NOT accepted directly — a raw JS
 * object cannot tell you whether a given property was intended to be a CBOR
 * text string, a byte string, or something else, and guessing is exactly the
 * kind of ambiguity canonical encoding exists to eliminate. Callers must be
 * explicit about the CBOR type of every value via this tagged union.
 */
export type CborValue =
  | { readonly kind: 'uint'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array }
  | { readonly kind: 'null' }
  | { readonly kind: 'array'; readonly value: readonly CborValue[] }
  | { readonly kind: 'map'; readonly value: Readonly<Record<string, CborValue>> };

// ── Convenience constructors (keep call sites readable) ─────────────────────

export const cborUint = (value: number): CborValue => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `cborUint: value must be a non-negative integer, got ${value}. ` +
        'Canonical CBOR in this system never encodes floating-point numbers (see file header, rule 5).'
    );
  }
  return { kind: 'uint', value };
};

export const cborText = (value: string): CborValue => ({ kind: 'text', value });

export const cborBytes = (value: Uint8Array): CborValue => ({ kind: 'bytes', value });

export const cborNull = (): CborValue => ({ kind: 'null' });

export const cborArray = (value: readonly CborValue[]): CborValue => ({ kind: 'array', value });

export const cborMap = (value: Readonly<Record<string, CborValue>>): CborValue => ({
  kind: 'map',
  value,
});

/** Convenience: encode a "nullable text" field (used for expires_at, valid_until, etc.) */
export const cborNullableText = (value: string | null): CborValue =>
  value === null ? cborNull() : cborText(value);

// ── Major type constants (CBOR spec, RFC 8949 §3) ────────────────────────────

const MAJOR_UINT = 0b000 << 5; // 0x00
const MAJOR_BYTES = 0b010 << 5; // 0x40
const MAJOR_TEXT = 0b011 << 5; // 0x60
const MAJOR_ARRAY = 0b100 << 5; // 0x80
const MAJOR_MAP = 0b101 << 5; // 0xa0
const SIMPLE_NULL = 0xf6; // major type 7, simple value 22

/**
 * Encodes a major-type header plus a length/value using the SHORTEST valid
 * CBOR "additional information" encoding (RFC 8949 §3, Table 1), which is
 * rule #1 from the file header: canonical CBOR always uses the minimal byte
 * count needed to represent the number.
 */
function encodeHeader(majorType: number, n: number): Buffer {
  if (n < 24) {
    // The length/value fits directly in the 5 "additional information" bits.
    return Buffer.from([majorType | n]);
  }
  if (n <= 0xff) {
    return Buffer.from([majorType | 24, n]);
  }
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = majorType | 25;
    buf.writeUInt16BE(n, 1);
    return buf;
  }
  if (n <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf[0] = majorType | 26;
    buf.writeUInt32BE(n, 1);
    return buf;
  }
  // 64-bit length. JavaScript numbers are only safely precise up to 2^53-1;
  // this system never needs values anywhere near this range (version
  // counters, small maps/arrays), but the ladder is completed for
  // correctness rather than silently truncating on unexpectedly large input.
  const buf = Buffer.alloc(9);
  buf[0] = majorType | 27;
  buf.writeBigUInt64BE(BigInt(n), 1);
  return buf;
}

/**
 * Encodes a single CborValue into its canonical byte representation.
 * This is the recursive core of the encoder.
 */
function encodeValue(v: CborValue): Buffer {
  switch (v.kind) {
    case 'uint': {
      // Rule 1: minimal-length integer encoding (handled by encodeHeader).
      return encodeHeader(MAJOR_UINT, v.value);
    }

    case 'text': {
      // Rule 6: normalize to NFC before encoding, so that visually-identical
      // strings with different underlying code-point sequences always
      // produce identical bytes.
      const normalized = v.value.normalize('NFC');
      const utf8 = Buffer.from(normalized, 'utf8');
      return Buffer.concat([encodeHeader(MAJOR_TEXT, utf8.length), utf8]);
    }

    case 'bytes': {
      const bytes = Buffer.from(v.value);
      return Buffer.concat([encodeHeader(MAJOR_BYTES, bytes.length), bytes]);
    }

    case 'null': {
      return Buffer.from([SIMPLE_NULL]);
    }

    case 'array': {
      // Rule 3: definite-length only — the header always carries the exact
      // item count, never an indefinite-length marker.
      // Array ITEM ORDER IS PRESERVED AS GIVEN — only map keys are sorted
      // (arrays are inherently ordered sequences; there is nothing to sort).
      const header = encodeHeader(MAJOR_ARRAY, v.value.length);
      const items = v.value.map(encodeValue);
      return Buffer.concat([header, ...items]);
    }

    case 'map': {
      const keys = Object.keys(v.value);

      // Rule 4: no duplicate keys. Object.keys() on a JS object can never
      // itself contain duplicates (later assignments simply overwrite
      // earlier ones during object construction), but we assert this
      // explicitly so the invariant is documented and would be caught if a
      // future refactor ever builds these maps from something other than a
      // plain object literal (e.g. a Map, or merged sources).
      const seen = new Set<string>();
      for (const k of keys) {
        if (seen.has(k)) {
          throw new Error(
            `canonicalCbor: duplicate map key "${k}" — canonical CBOR forbids duplicate keys (see file header, rule 4).`
          );
        }
        seen.add(k);
      }

      // Rule 2: sort keys by the bytewise lexicographic order of each key's
      // OWN canonical encoding (a CBOR text string), not by the raw JS
      // string. We compute each key's encoded bytes first, then sort by
      // comparing those byte arrays directly.
      const encodedEntries = keys.map((key) => {
        const encodedKey = encodeValue(cborText(key));
        const encodedVal = encodeValue(v.value[key]);
        return { encodedKey, encodedVal };
      });

      encodedEntries.sort((a, b) => compareBytes(a.encodedKey, b.encodedKey));

      const header = encodeHeader(MAJOR_MAP, keys.length);
      const pairs = encodedEntries.flatMap((e) => [e.encodedKey, e.encodedVal]);
      return Buffer.concat([header, ...pairs]);
    }

    /* istanbul ignore next -- exhaustiveness guard; TypeScript's discriminated
       union check above makes this branch unreachable for valid CborValue
       input, but it is kept as a defensive runtime guard against a value
       that bypasses the type system (e.g. arrives via JSON.parse of
       untrusted data cast to CborValue without validation). */
    default: {
      const exhaustiveCheck: never = v;
      throw new Error(`canonicalCbor: unknown CborValue kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Bytewise lexicographic comparison of two buffers (rule 2's sort comparator). */
function compareBytes(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  // If one is a strict prefix of the other, the shorter one sorts first —
  // this falls out naturally from RFC 8949's bytewise comparison rule.
  return a.length - b.length;
}

/**
 * Public entry point: encode any CborValue tree into its canonical byte
 * representation. This is the ONLY function that should be called to
 * produce bytes that will be hashed for a signature — using anything else
 * (e.g. JSON.stringify, or a non-canonical CBOR library) will silently break
 * every signature verification in the system.
 */
export function encodeCanonical(value: CborValue): Buffer {
  return encodeValue(value);
}
