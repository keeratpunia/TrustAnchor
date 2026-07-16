/**
 * qrCodec.ts (Verifier App) — decodes the QR payload scanned by the camera.
 * Mirrors the DECODE half of packages/shared/src/qrCodec.ts exactly (this
 * app never encodes a QR — only the offline signer does that, at issuance
 * time). See that file's header for the full wire-format rationale.
 */
import { QrPayload } from './types';

const MAJOR_MAP = 0b101 << 5;
const MAJOR_UINT = 0b000 << 5;
const MAJOR_BYTES = 0b010 << 5;
const MAJOR_TEXT = 0b011 << 5;

function readUintHeader(bytes: number[], offset: number): [number, number] {
  const first = bytes[offset];
  const additionalInfo = first & 0x1f;
  if (additionalInfo < 24) return [additionalInfo, 1];
  if (additionalInfo === 24) return [bytes[offset + 1], 2];
  if (additionalInfo === 25) return [(bytes[offset + 1] << 8) | bytes[offset + 2], 3];
  if (additionalInfo === 26) {
    return [
      (bytes[offset + 1] * 0x1000000) + (bytes[offset + 2] << 16) + (bytes[offset + 3] << 8) + bytes[offset + 4],
      5,
    ];
  }
  throw new Error('qrCodec: unsupported CBOR length encoding while decoding QR payload.');
}

function bytesToUtf8(bytes: number[], start: number, len: number): string {
  let result = '';
  let i = start;
  const end = start + len;
  while (i < end) {
    const byte1 = bytes[i];
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      const byte2 = bytes[i + 1];
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      result += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      i += 3;
    } else {
      // 4-byte sequences (outside the Basic Multilingual Plane) are not
      // needed for this fixed schema's short ASCII keys ("v","iss","doc",
      // "h","sig") — this decoder only needs to handle map KEYS, which are
      // always short ASCII strings by construction (see qrCodec.ts on the
      // encoding side). Values are always raw byte strings, not text.
      throw new Error('qrCodec: unexpected 4-byte UTF-8 sequence in QR map key.');
    }
  }
  return result;
}

/**
 * Decodes QR bytes (scanned by the camera) into a QrPayload. Throws if the
 * bytes are not a well-formed instance of the fixed 5-field schema — a
 * malformed or foreign QR code must never be silently accepted (Frozen
 * Spec §14 step 1, INVALID_QR).
 */
export function decodeQrPayload(bytes: number[]): QrPayload {
  let offset = 0;

  const mapHeader = bytes[offset];
  if ((mapHeader & 0xe0) !== MAJOR_MAP) {
    throw new Error('qrCodec: not a CBOR map — this is not a TrustAnchor QR code.');
  }
  const entryCount = mapHeader & 0x1f;
  if (entryCount !== 5) {
    throw new Error(`qrCodec: expected exactly 5 map entries, found ${entryCount}.`);
  }
  offset += 1;

  const fields: Record<string, number[] | number> = {};

  for (let i = 0; i < 5; i++) {
    const keyHeader = bytes[offset];
    if ((keyHeader & 0xe0) !== MAJOR_TEXT) {
      throw new Error('qrCodec: expected a text-string map key while decoding QR payload.');
    }
    const keyLen = keyHeader & 0x1f;
    offset += 1;
    const key = bytesToUtf8(bytes, offset, keyLen);
    offset += keyLen;

    const valueHeader = bytes[offset];
    const valueMajor = valueHeader & 0xe0;

    if (valueMajor === MAJOR_UINT) {
      const [value, consumed] = readUintHeader(bytes, offset);
      offset += consumed;
      fields[key] = value;
    } else if (valueMajor === MAJOR_BYTES) {
      const [len, consumed] = readUintHeader(bytes, offset);
      offset += consumed;
      fields[key] = bytes.slice(offset, offset + len);
      offset += len;
    } else {
      throw new Error(`qrCodec: unexpected value type for key "${key}" while decoding QR payload.`);
    }
  }

  for (const key of ['v', 'iss', 'doc', 'h', 'sig']) {
    if (!(key in fields)) {
      throw new Error(`qrCodec: QR payload is missing required field "${key}".`);
    }
  }

  const v = fields['v'];
  if (typeof v !== 'number' || v !== 1) {
    throw new Error('qrCodec: unsupported or missing protocol version.');
  }

  const iss = fields['iss'] as number[];
  const doc = fields['doc'] as number[];
  const h = fields['h'] as number[];
  const sig = fields['sig'] as number[];

  if (iss.length !== 16) throw new Error('qrCodec: "iss" must be exactly 16 bytes.');
  if (doc.length !== 16) throw new Error('qrCodec: "doc" must be exactly 16 bytes.');
  if (h.length !== 32) throw new Error('qrCodec: "h" must be exactly 32 bytes.');
  if (sig.length !== 64) throw new Error('qrCodec: "sig" must be exactly 64 bytes.');

  return { v: 1, iss, doc, h, sig };
}

/** Converts raw 16 bytes into the standard hyphenated UUID string form. */
export function bytesToUuid(bytes: number[]): string {
  if (bytes.length !== 16) throw new Error('qrCodec: UUID bytes must be exactly 16 bytes.');
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/** Converts a byte array into a lowercase hex string. */
export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Converts a hex string into a byte array. */
export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

/**
 * Converts a base64 string into a byte array — a pure, hand-rolled
 * implementation with NO dependency on `atob`/`Buffer`.
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN USING THE RUNTIME'S `atob`:
 * `atob`/`btoa` are NOT guaranteed to exist as globals across every React
 * Native/Hermes version this app might run on — support was only added to
 * Hermes relatively recently, and relying on it silently breaks QR scanning
 * on any older engine with no error until this function is actually called.
 * A small, dependency-free decoder removes that runtime-version risk
 * entirely and keeps this file consistent with the rest of the project's
 * philosophy (see canonicalCbor.ts's header): the cryptographic/decoding
 * core should not depend on ambient platform behavior that can't be
 * verified at build time.
 *
 * This is also the function that fixes the QR SCANNING bug this file's
 * sibling change (generateQr.ts, offline-signer) exists to prevent: the QR
 * now transports base64 TEXT (not raw binary bytes), specifically because
 * raw binary bytes get corrupted when a camera/barcode scanner library
 * reinterprets them as UTF-8 text internally. Base64 is pure ASCII and
 * survives that reinterpretation intact — this function is the other half
 * of that fix, turning the scanned base64 text back into the original CBOR
 * bytes.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(base64: string): number[] {
  // Strip any whitespace/newlines a QR scanner or clipboard might introduce,
  // and the padding characters, which carry no data.
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');

  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (let i = 0; i < clean.length; i++) {
    const charIndex = BASE64_CHARS.indexOf(clean[i]);
    if (charIndex === -1) {
      throw new Error(`base64ToBytes: invalid base64 character "${clean[i]}" at position ${i}.`);
    }
    buffer = (buffer << 6) | charIndex;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return bytes;
}
