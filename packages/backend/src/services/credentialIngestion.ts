/**
 * credentialIngestion.ts — the one place a signed credential gets
 * validated and stored.
 * ============================================================================
 * Extracted from credential.ts's original POST /credential handler so that
 * POST /credential (one at a time) and POST /v2/credential/batch (many at
 * once) run through IDENTICAL validation and storage logic — a batch
 * ingestion is not a second, subtly-different code path that could drift
 * from the single-credential one over time.
 *
 * Stores ONLY `payload` (Frozen Spec §7: no signature is stored
 * server-side — the QR carries the authoritative one). `contentHashHex`/
 * `signatureHex` are used purely for a pre-storage SANITY CHECK, exactly as
 * credential.ts's header already explains.
 */
import nacl from 'tweetnacl';
import { CredentialPayload, credentialContentHash } from '@trustanchor/shared';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { isUuid, isIsoDateTime } from '../middleware/validation';
import { logger } from '../utils/logger';

export interface SignedCredentialEntry {
  payload: CredentialPayload;
  contentHashHex?: string;
  signatureHex?: string;
}

/** Validates one signed-credential entry's shape. Throws ApiError on the first problem found. */
export function validateSignedCredentialEntry(body: unknown): SignedCredentialEntry {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Each entry must be a signed-credential object.', 'INVALID_BODY');
  }
  const { payload, contentHashHex, signatureHex } = body as any;

  if (!payload || typeof payload !== 'object') {
    throw new ApiError(400, 'Each entry must include a "payload" object.', 'INVALID_CREDENTIAL');
  }
  if (!isUuid(payload.issuer_id)) throw new ApiError(400, 'payload.issuer_id must be a UUID.', 'INVALID_CREDENTIAL');
  if (!isUuid(payload.doc_id)) throw new ApiError(400, 'payload.doc_id must be a UUID.', 'INVALID_CREDENTIAL');
  if (!isUuid(payload.template_id)) throw new ApiError(400, 'payload.template_id must be a UUID.', 'INVALID_CREDENTIAL');
  if (typeof payload.template_version !== 'number' || payload.template_version < 1) {
    throw new ApiError(400, 'payload.template_version must be a positive integer.', 'INVALID_CREDENTIAL');
  }
  if (!isIsoDateTime(payload.issued_at)) {
    throw new ApiError(400, 'payload.issued_at must be a valid ISO-8601 timestamp.', 'INVALID_CREDENTIAL');
  }
  if (payload.expires_at !== null && !isIsoDateTime(payload.expires_at)) {
    throw new ApiError(400, 'payload.expires_at must be null or a valid ISO-8601 timestamp.', 'INVALID_CREDENTIAL');
  }
  if (!payload.fields || typeof payload.fields !== 'object') {
    throw new ApiError(400, 'payload.fields must be an object.', 'INVALID_CREDENTIAL');
  }
  if (!payload.asset_hashes || typeof payload.asset_hashes !== 'object') {
    throw new ApiError(400, 'payload.asset_hashes must be an object.', 'INVALID_CREDENTIAL');
  }
  if (typeof payload.template_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.template_hash)) {
    throw new ApiError(400, 'payload.template_hash must be a 64-character hex SHA-256 digest.', 'INVALID_CREDENTIAL');
  }

  return { payload, contentHashHex, signatureHex };
}

/**
 * Ingests one already-validated signed credential entry: runs the
 * signature sanity check (if the issuer is already in the current
 * manifest) and upserts the document row. Throws ApiError on failure —
 * callers doing a batch should catch per-entry, not let one bad entry
 * abort the whole batch.
 */
export async function ingestSignedCredential(entry: SignedCredentialEntry): Promise<{ docId: string }> {
  const { payload, contentHashHex, signatureHex } = entry;

  if (contentHashHex && signatureHex) {
    const manifestRow = await prisma.currentManifest.findUnique({ where: { id: 1 } });
    if (manifestRow) {
      const manifest = manifestRow.manifestBlob as any;
      const issuerEntry = manifest.payload.issuers.find((i: any) => i.issuer_id === payload.issuer_id);
      if (issuerEntry) {
        const issuedAtMs = new Date(payload.issued_at).getTime();
        const matchingKey = issuerEntry.keys.find((k: any) => {
          const from = new Date(k.valid_from).getTime();
          const until = k.valid_until ? new Date(k.valid_until).getTime() : Infinity;
          return issuedAtMs >= from && issuedAtMs <= until;
        });

        if (matchingKey) {
          const recomputedHash = credentialContentHash(payload);
          if (recomputedHash.toString('hex') !== contentHashHex.toLowerCase()) {
            throw new ApiError(
              400,
              'Provided contentHashHex does not match the recomputed hash of payload. Refusing to ingest.',
              'HASH_MISMATCH'
            );
          }
          const verifyOk = nacl.sign.detached.verify(
            new Uint8Array(recomputedHash),
            new Uint8Array(Buffer.from(signatureHex, 'hex')),
            new Uint8Array(Buffer.from(matchingKey.public_key, 'hex'))
          );
          if (!verifyOk) {
            throw new ApiError(
              400,
              "Signature does not verify against the issuer's current public key. Refusing to ingest.",
              'SIGNATURE_INVALID'
            );
          }
          logger.info('Credential ingestion signature sanity check passed', { docId: payload.doc_id });
        } else {
          logger.warn(
            'No matching issuer key found for signature sanity check — issuer may not yet be in the manifest. Storing payload without verification (verifiers will still check this independently).',
            { docId: payload.doc_id }
          );
        }
      }
    }
  }

  await prisma.document.upsert({
    where: { docId: payload.doc_id },
    create: {
      docId: payload.doc_id,
      issuerId: payload.issuer_id,
      templateId: payload.template_id,
      templateVersion: payload.template_version,
      issuedAt: payload.issued_at,
      expiresAt: payload.expires_at,
      fields: payload.fields,
      assetHashes: payload.asset_hashes,
      templateHash: payload.template_hash,
    },
    update: {
      issuerId: payload.issuer_id,
      templateId: payload.template_id,
      templateVersion: payload.template_version,
      issuedAt: payload.issued_at,
      expiresAt: payload.expires_at,
      fields: payload.fields,
      assetHashes: payload.asset_hashes,
      templateHash: payload.template_hash,
    },
  });

  logger.info('Ingested credential', { docId: payload.doc_id, issuerId: payload.issuer_id });
  return { docId: payload.doc_id };
}
