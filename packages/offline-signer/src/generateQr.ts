/**
 * generateQr.ts
 * ============================================================================
 * QR CODE GENERATION — Frozen Spec §6.
 * ============================================================================
 * Takes the five fields that make up the QR payload (protocol version,
 * issuer_id, doc_id, content hash, and signature) and produces both the raw
 * CBOR bytes (for embedding in test fixtures / the backend's credential
 * ingestion request) and a scannable PNG image (for actually printing on a
 * physical document).
 *
 * This file depends on the `qrcode` npm package purely for PNG RENDERING —
 * turning already-final bytes into a scannable image is a presentation
 * concern, not a cryptographic one. It has no influence over what data ends
 * up inside the QR; that is entirely determined by qrCodec.ts's
 * `encodeQrPayload`, which is hand-rolled and lives in the shared package
 * (see that file's header for why).
 *
 * WHY THE QR ENCODES BASE64 TEXT, NOT RAW BINARY BYTES:
 * The QR payload (CBOR-encoded) is raw binary — it contains an Ed25519
 * signature and a SHA-256 hash, both of which are effectively random byte
 * sequences with no text structure. Earlier revisions of this tool rendered
 * that binary data directly into the QR using "byte mode", and reconstructed
 * it on the scanning side by reading each character's code point out of the
 * scanner library's `data` string. This is NOT reliable: camera/barcode
 * scanning libraries across iOS, Android, and web often decode a QR's byte
 * payload internally as if it were UTF-8 text (since QR byte-mode has no
 * universally agreed-upon charset), and raw binary bytes are almost never
 * valid UTF-8 — bytes ≥ 0x80 get silently replaced, merged, or dropped,
 * corrupting the payload before it ever reaches the app's code. This
 * produces exactly the failure this fix addresses: "not a CBOR map" on
 * a perfectly genuine, unmodified QR code.
 *
 * The fix is to never put raw binary into the QR's transported text at all.
 * Instead, the CBOR bytes are base64-encoded (an ASCII-only, 7-bit-clean
 * text representation) before being rendered into the QR. Base64 text
 * survives any UTF-8/text-mode reinterpretation a scanner performs, because
 * every character in a base64 string IS valid, single-byte-per-character
 * ASCII/UTF-8 — there is nothing for a scanner to "reinterpret." The
 * verifier app then reverses this with a plain base64 decode before running
 * Engine 1. This costs a predictable ~33% size increase (152 raw bytes →
 * ~204 base64 characters) and remains comfortably within a small, reliably
 * scannable QR code.
 */
import QRCode from 'qrcode';
import { encodeQrPayload, uuidToBytes, QrPayload } from '@trustanchor/shared';

export interface GenerateQrInput {
  issuerId: string;
  docId: string;
  /** Hex string, 64 characters (32 bytes) — the credential's content hash. */
  contentHashHex: string;
  /** Hex string, 128 characters (64 bytes) — the Ed25519 signature over the content hash. */
  signatureHex: string;
}

/** Builds the QrPayload struct and encodes it to raw CBOR bytes. */
export function buildQrBytes(input: GenerateQrInput): Buffer {
  const h = Buffer.from(input.contentHashHex, 'hex');
  const sig = Buffer.from(input.signatureHex, 'hex');

  if (h.length !== 32) {
    throw new Error(`generateQr: contentHashHex must decode to 32 bytes, got ${h.length}.`);
  }
  if (sig.length !== 64) {
    throw new Error(`generateQr: signatureHex must decode to 64 bytes, got ${sig.length}.`);
  }

  const payload: QrPayload = {
    v: 1,
    iss: uuidToBytes(input.issuerId),
    doc: uuidToBytes(input.docId),
    h,
    sig,
  };

  return encodeQrPayload(payload);
}

/**
 * Renders the QR bytes to a PNG file on disk. The QR's actual transported
 * content is the BASE64 TEXT ENCODING of `qrBytes` (see file header for
 * why) — this is what a scanner will read back as `scanResult.data`, and
 * exactly what the verifier app's ScanScreen base64-decodes before handing
 * bytes to Engine 1.
 *
 * Uses error-correction level 'M' (~15% error correction) — a practical
 * balance between physical print robustness (surviving folds, minor
 * smudges) and keeping the QR's pixel density low enough to remain
 * scannable at a small printed size.
 */
export async function renderQrPng(qrBytes: Buffer, outputPath: string): Promise<void> {
  const base64Text = qrBytes.toString('base64');
  await QRCode.toFile(outputPath, base64Text, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
}

/** Renders the QR bytes as a terminal-printable ASCII QR code, for quick CLI sanity-checking. Encodes the same base64 text as renderQrPng — see that function's comment. */
export async function renderQrTerminal(qrBytes: Buffer): Promise<string> {
  const base64Text = qrBytes.toString('base64');
  return QRCode.toString(base64Text, { type: 'terminal', small: true });
}
