/**
 * credential.ts — GET /credential/:docId and POST /credential.
 *
 * GET /credential/:docId is Engine 1's second core verification fetch
 * (Frozen Spec §7, §10). It returns the raw, UNSIGNED payload exactly as
 * stored — this server does not attach a signature to this response and
 * does not need to, because the only signature that matters (the one over
 * this payload's canonical content hash) already lives in the QR code
 * printed on the physical document. The verifier recomputes the hash of
 * what this endpoint returns and compares it against that QR-embedded hash
 * (Frozen Spec §14 step 6) — this server never needs to prove anything
 * about its own response beyond serving the bytes it was given at ingestion
 * time.
 */
import { Router, Request, Response } from 'express';
import nacl from 'tweetnacl';
import { CredentialPayload, credentialContentHash } from '@trustanchor/shared';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireIngestionAuth } from '../middleware/ingestionAuth';
import { validateUuidParam, isUuid, isIsoDateTime } from '../middleware/validation';
import { logger } from '../utils/logger';

export const credentialRouter = Router();

/**
 * GET /credential/:docId
 * Returns the raw credential payload for a document, reconstructed from
 * storage into the exact CredentialPayload shape (Frozen Spec §7, §26.1).
 * No authentication required — this data is meant to be fetched by anyone
 * holding a scanned QR for this document; its integrity is established by
 * the caller's own hash comparison, not by access control here.
 */
credentialRouter.get(
  '/credential/:docId',
  validateUuidParam('docId'),
  asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;

    const doc = await prisma.document.findUnique({ where: { docId } });
    if (!doc) {
      throw new ApiError(404, `No credential found for doc_id ${docId}.`, 'CREDENTIAL_NOT_FOUND');
    }

    const payload: CredentialPayload = {
      v: 1,
      issuer_id: doc.issuerId,
      doc_id: doc.docId,
      template_id: doc.templateId,
      template_version: doc.templateVersion,
      // issuedAt/expiresAt are stored as plain TEXT (see schema.prisma's
      // comment on these columns) — echoed back verbatim, byte-for-byte
      // identical to what the issuer originally signed. Calling
      // .toISOString() here would be the exact bug this fix corrects: a
      // Date object always reformats to include milliseconds, silently
      // changing the string and therefore the recomputed hash of a
      // perfectly genuine credential.
      issued_at: doc.issuedAt,
      expires_at: doc.expiresAt,
      fields: doc.fields as Record<string, string>,
      asset_hashes: doc.assetHashes as Record<string, string>,
      template_hash: doc.templateHash,
    };

    logger.debug('Served credential payload', { docId });
    res.json(payload);
  })
);

/**
 * POST /credential
 * Ingests a newly-signed credential. Expects the exact output shape of
 * `offline-signer sign-credential`:
 *   { payload, issuerId, docId, contentHashHex, signatureHex }
 *
 * This handler stores ONLY `payload` (Frozen Spec §7: no signature is
 * stored server-side — the QR carries the authoritative one). It uses
 * `contentHashHex` and `signatureHex` purely for a pre-storage SANITY CHECK
 * (operational safety net, not a security boundary — see manifest.ts's
 * header comment for the identical reasoning): if the current trust
 * manifest already lists this issuer with a key valid at `issued_at`, we
 * verify the signature before accepting the upload, catching an operator
 * mistake (wrong key, corrupted file, mismatched payload) immediately
 * rather than silently storing bad data that would only be caught much
 * later by an end-user's verifier app.
 */
credentialRouter.post('/credential', requireIngestionAuth, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Request body must be a signed-credential object.', 'INVALID_BODY');
  }

  const payload = body.payload as CredentialPayload | undefined;
  const contentHashHex = body.contentHashHex as string | undefined;
  const signatureHex = body.signatureHex as string | undefined;

  if (!payload || typeof payload !== 'object') {
    throw new ApiError(400, 'Request body must include a "payload" object.', 'INVALID_CREDENTIAL');
  }
  if (!isUuid(payload.issuer_id)) {
    throw new ApiError(400, 'payload.issuer_id must be a UUID.', 'INVALID_CREDENTIAL');
  }
  if (!isUuid(payload.doc_id)) {
    throw new ApiError(400, 'payload.doc_id must be a UUID.', 'INVALID_CREDENTIAL');
  }
  if (!isUuid(payload.template_id)) {
    throw new ApiError(400, 'payload.template_id must be a UUID.', 'INVALID_CREDENTIAL');
  }
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

  // Sanity check: if we can find this issuer's key in the current manifest,
  // verify the provided signature before accepting the upload.
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
              'Signature does not verify against the issuer\'s current public key. Refusing to ingest.',
              'SIGNATURE_INVALID'
            );
          }
          logger.info('Credential ingestion signature sanity check passed', { docId: payload.doc_id });
        } else {
          logger.warn('No matching issuer key found for signature sanity check — issuer may not yet be in the manifest. Storing payload without verification (verifiers will still check this independently).', { docId: payload.doc_id });
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
      // Store the exact strings the issuer signed — no Date parsing. See
      // schema.prisma's comment on these columns for why this matters.
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
  res.status(201).json({ message: 'Credential ingested successfully.', docId: payload.doc_id });
}));
