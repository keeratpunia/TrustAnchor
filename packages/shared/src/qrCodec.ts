/**
 * qrCodec.ts
 * ============================================================================
 * Encodes and decodes the QR payload (Frozen Spec §6, §26.3).
 * ============================================================================
 * This is DELIBERATELY NOT canonical/deterministic CBOR. The QR's bytes are
 * never re-hashed or compared against anything as a whole — its five fields
 * (v, iss, doc, h, sig) are simply read out directly once decoded. Canonical
 * encoding only matters for objects that get hashed-and-signed
 * (CredentialPayload, ManifestPayload — see payloadCodec.ts). Any
 * standards-conformant CBOR producing the same five typed fields works fine
 * here; this file hand-rolls a minimal encoder/decoder for exactly this
 * fixed schema so the whole system has zero third-party CBOR library
 * dependency, keeping the entire cryptographic core auditable in one place.
 *
 * Wire format (fixed, always exactly 5 map entries, in this exact order —
 * order does not need to be canonical since we never hash this container,
 * but a fixed, well-known order keeps the encoder/decoder trivial and fast):
 *
 *   0xa5                      -- map, 5 entries (major type 5, length 5)
 *   0x61 'v'  <uint>           -- key "v" (1-char text string), value: uint
 *   0x63 'iss' <bytes[16]>     -- key "iss", value: 16-byte string
 *   0x63 'doc' <bytes[16]>     -- key "doc", value: 16-byte string
 *   0x61 'h'  <bytes[32]>      -- key "h", value: 32-byte string
 *   0x63 'sig' <bytes[64]>     -- key "sig", value: 64-byte string
 */
import { QrPayload } from './types';

const MAJOR_UINT = 0b000 << 5;
const MAJOR_BYTES = 0b010 << 5;
const MAJOR_TEXT = 0b011 << 5;
const MAJOR_MAP = 0b101 << 5;

function encodeHeaderSimple(majorType: number, n: number): Buffer {
  // Same minimal-length ladder as canonicalCbor.ts's encodeHeader, duplicated
  // here intentionally: this file has zero dependency on canonicalCbor.ts on
  // purpose, since the QR encoding path and the canonical-hashing path are
  // conceptually separate concerns (see file header) and must remain safely
  // independent of one another.
  if (n < 24) return Buffer.from([majorType | n]);
  if (n <= 0xff) return Buffer.from([majorType | 24, n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = majorType | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = majorType | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

function encodeTextKey(key: string): Buffer {
  const utf8 = Buffer.from(key, 'utf8');
  return Buffer.concat([encodeHeaderSimple(MAJOR_TEXT, utf8.length), utf8]);
}

function encodeFixedBytes(value: Buffer, expectedLength: number, fieldName: string): Buffer {
  if (value.length !== expectedLength) {
    throw new Error(
      `qrCodec: field "${fieldName}" must be exactly ${expectedLength} bytes, got ${value.length}.`
    );
  }
  return Buffer.concat([encodeHeaderSimple(MAJOR_BYTES, value.length), value]);
}

/**
 * Encodes a QrPayload into the exact CBOR bytes that get printed as a QR
 * code on the physical document.
 */
export function encodeQrPayload(payload: QrPayload): Buffer {
  if (payload.v !== 1) {
    throw new Error(`qrCodec: unsupported protocol version ${payload.v}, only version 1 is defined.`);
  }
  const header = Buffer.from([MAJOR_MAP | 5]); // map with exactly 5 entries

  const vKey = encodeTextKey('v');
  const vVal = encodeHeaderSimple(MAJOR_UINT, payload.v);

  const issKey = encodeTextKey('iss');
  const issVal = encodeFixedBytes(payload.iss, 16, 'iss');

  const docKey = encodeTextKey('doc');
  const docVal = encodeFixedBytes(payload.doc, 16, 'doc');

  const hKey = encodeTextKey('h');
  const hVal = encodeFixedBytes(payload.h, 32, 'h');

  const sigKey = encodeTextKey('sig');
  const sigVal = encodeFixedBytes(payload.sig, 64, 'sig');

  return Buffer.concat([
    header,
    vKey, vVal,
    issKey, issVal,
    docKey, docVal,
    hKey, hVal,
    sigKey, sigVal,
  ]);
}

/** Reads a minimal-length CBOR unsigned integer header, returning [value, bytesConsumed]. */
function readUintHeader(buf: Buffer, offset: number): [number, number] {
  const first = buf[offset];
  const additionalInfo = first & 0x1f;
  if (additionalInfo < 24) return [additionalInfo, 1];
  if (additionalInfo === 24) return [buf.readUInt8(offset + 1), 2];
  if (additionalInfo === 25) return [buf.readUInt16BE(offset + 1), 3];
  if (additionalInfo === 26) return [buf.readUInt32BE(offset + 1), 5];
  throw new Error('qrCodec: unsupported CBOR length encoding while decoding QR payload.');
}

/**
 * Decodes QR bytes (as scanned by the camera) back into a QrPayload.
 * Throws if the bytes are not a well-formed instance of the fixed 5-field
 * schema this system defines — a malformed or foreign QR code must never be
 * silently accepted (Frozen Spec §14 step 1, INVALID_QR).
 */
export function decodeQrPayload(bytes: Buffer): QrPayload {
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

  const fields: Record<string, Buffer | number> = {};

  for (let i = 0; i < 5; i++) {
    // Read the key (always a short text string).
    const keyHeader = bytes[offset];
    if ((keyHeader & 0xe0) !== MAJOR_TEXT) {
      throw new Error('qrCodec: expected a text-string map key while decoding QR payload.');
    }
    const keyLen = keyHeader & 0x1f;
    offset += 1;
    const key = bytes.subarray(offset, offset + keyLen).toString('utf8');
    offset += keyLen;

    // Read the value: either a uint (for "v") or a byte string (everything else).
    const valueHeader = bytes[offset];
    const valueMajor = valueHeader & 0xe0;

    if (valueMajor === MAJOR_UINT) {
      const [value, consumed] = readUintHeader(bytes, offset);
      offset += consumed;
      fields[key] = value;
    } else if (valueMajor === MAJOR_BYTES) {
      const [len, consumed] = readUintHeader(bytes, offset);
      offset += consumed;
      fields[key] = Buffer.from(bytes.subarray(offset, offset + len));
      offset += len;
    } else {
      throw new Error(`qrCodec: unexpected value type for key "${key}" while decoding QR payload.`);
    }
  }

  const required = ['v', 'iss', 'doc', 'h', 'sig'];
  for (const key of required) {
    if (!(key in fields)) {
      throw new Error(`qrCodec: QR payload is missing required field "${key}".`);
    }
  }

  const v = fields['v'];
  if (typeof v !== 'number' || v !== 1) {
    throw new Error(`qrCodec: unsupported or missing protocol version.`);
  }

  const iss = fields['iss'] as Buffer;
  const doc = fields['doc'] as Buffer;
  const h = fields['h'] as Buffer;
  const sig = fields['sig'] as Buffer;

  if (iss.length !== 16) throw new Error('qrCodec: "iss" must be exactly 16 bytes.');
  if (doc.length !== 16) throw new Error('qrCodec: "doc" must be exactly 16 bytes.');
  if (h.length !== 32) throw new Error('qrCodec: "h" must be exactly 32 bytes.');
  if (sig.length !== 64) throw new Error('qrCodec: "sig" must be exactly 64 bytes.');

  return { v: 1, iss, doc, h, sig };
}

/** Converts a hyphenated UUID string into its raw 16-byte form. */
export function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`qrCodec: "${uuid}" is not a valid UUID.`);
  }
  return Buffer.from(hex, 'hex');
}

/** Converts a raw 16-byte UUID back into its standard hyphenated string form. */
export function bytesToUuid(bytes: Buffer): string {
  if (bytes.length !== 16) {
    throw new Error('qrCodec: UUID bytes must be exactly 16 bytes.');
  }
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
