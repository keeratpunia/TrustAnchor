/**
 * manifest.ts — GET /manifest and POST /manifest.
 *
 * GET /manifest is one of Engine 1's two core verification fetches (Frozen
 * Spec §10, §21). This server does not — and cannot — produce this
 * artifact itself; it only stores and serves, verbatim, whatever was most
 * recently uploaded by an offline signing ceremony (Frozen Spec §5, §9).
 *
 * POST /manifest is the administrative ingestion endpoint. Per Frozen Spec
 * §21: "this endpoint's access control is an operational convenience, not
 * a security boundary — even if an attacker could call it, they can only
 * upload manifests that already carry a valid platform signature ... every
 * verifier independently checks that signature regardless of how the file
 * arrived at the server." We still require a shared ingestion secret here
 * purely to keep a public demo deployment from being spammed with junk
 * data — this is ordinary operational hygiene, not a cryptographic control.
 */
import { Router, Request, Response } from 'express';
import nacl from 'tweetnacl';
import { manifestContentHash, ManifestPayload, SignedManifest } from '@trustanchor/shared';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireIngestionAuth } from '../middleware/ingestionAuth';
import { requireAdminOrLegacyIngestionAuth } from '../middleware/manifestAuth';
import { requireAdminSession } from '../middleware/adminSessionAuth';
import { isIsoDateTime, isEd25519SignatureHex } from '../middleware/validation';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export const manifestRouter = Router();

/**
 * GET /manifest
 * Returns the current signed Trust Manifest, verbatim, exactly as it was
 * uploaded during the last offline signing ceremony. No authentication
 * required — this object is public by design and self-authenticating (the
 * caller verifies its `signature` field against the platform's public key,
 * which is meant to be public — Frozen Spec §21).
 */
manifestRouter.get('/manifest', asyncHandler(async (req: Request, res: Response) => {
  const row = await prisma.currentManifest.findUnique({ where: { id: 1 } });

  if (!row) {
    throw new ApiError(
      404,
      'No trust manifest has been published yet. An administrator must run an offline signing ceremony and upload the result via POST /manifest.',
      'NO_MANIFEST'
    );
  }

  logger.debug('Served trust manifest', { receivedAt: row.receivedAt });
  res.json(row.manifestBlob);
}));

/**
 * POST /manifest
 * Ingests a freshly offline-signed manifest, replacing whatever manifest is
 * currently being served. The request body must be the complete
 * `{ payload, signature }` object produced by
 * `offline-signer sign-manifest`.
 *
 * This handler performs two SANITY checks before storing the upload (both
 * are operational safety nets, not security boundaries — see file header):
 *   1. Structural validation of the payload shape.
 *   2. If PLATFORM_PUBLIC_KEY_HEX is configured, verify the signature
 *      against it — catching an operator accidentally uploading a
 *      corrupted file or one signed with the wrong key, long before any
 *      verifier ever sees it.
 *   3. Monotonic version check: refuse to move backwards (a verifier would
 *      also reject an old manifest per its own rollback check, but
 *      catching the mistake here saves a wasted ceremony).
 */
manifestRouter.post('/manifest', requireAdminOrLegacyIngestionAuth, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Partial<SignedManifest>;

  if (!body || typeof body !== 'object' || !body.payload || !body.signature) {
    throw new ApiError(400, 'Request body must be a { payload, signature } signed manifest object.', 'INVALID_BODY');
  }

  const payload = body.payload as ManifestPayload;
  const signature = body.signature;

  if (typeof payload.version !== 'number' || payload.version < 1) {
    throw new ApiError(400, 'payload.version must be a positive integer.', 'INVALID_MANIFEST');
  }
  if (!isIsoDateTime(payload.generated_at)) {
    throw new ApiError(400, 'payload.generated_at must be a valid ISO-8601 timestamp.', 'INVALID_MANIFEST');
  }
  if (!isIsoDateTime(payload.valid_until)) {
    throw new ApiError(400, 'payload.valid_until must be a valid ISO-8601 timestamp.', 'INVALID_MANIFEST');
  }
  if (!Array.isArray(payload.issuers)) {
    throw new ApiError(400, 'payload.issuers must be an array.', 'INVALID_MANIFEST');
  }
  if (!Array.isArray(payload.revoked_docs)) {
    throw new ApiError(400, 'payload.revoked_docs must be an array.', 'INVALID_MANIFEST');
  }
  if (!isEd25519SignatureHex(signature)) {
    throw new ApiError(400, 'signature must be a 128-character hex Ed25519 signature.', 'INVALID_MANIFEST');
  }

  // Sanity check 2: verify against the configured platform public key, if any.
  if (config.platformPublicKeyHex) {
    const contentHash = manifestContentHash(payload);
    const verifyOk = nacl.sign.detached.verify(
      new Uint8Array(contentHash),
      new Uint8Array(Buffer.from(signature, 'hex')),
      new Uint8Array(Buffer.from(config.platformPublicKeyHex, 'hex'))
    );
    if (!verifyOk) {
      throw new ApiError(
        400,
        'Manifest signature does not verify against the configured platform public key. Refusing to ingest — check that the correct offline platform key was used.',
        'SIGNATURE_INVALID'
      );
    }
  } else {
    logger.warn('PLATFORM_PUBLIC_KEY_HEX is not configured — skipping server-side signature sanity check on manifest ingestion. This is not a security issue (verifiers check the signature independently), but it means an operator mistake here would not be caught until a verifier scans a document.');
  }

  // Sanity check 3: monotonic version.
  const existing = await prisma.currentManifest.findUnique({ where: { id: 1 } });
  if (existing) {
    const existingPayload = existing.manifestBlob as unknown as SignedManifest;
    if (existingPayload.payload.version >= payload.version) {
      throw new ApiError(
        409,
        `New manifest version (${payload.version}) must be strictly greater than the currently stored version (${existingPayload.payload.version}).`,
        'VERSION_ROLLBACK'
      );
    }
  }

  await prisma.currentManifest.upsert({
    where: { id: 1 },
    create: { id: 1, manifestBlob: body as any },
    update: { manifestBlob: body as any, receivedAt: new Date() },
  });

  logger.info('Ingested new trust manifest', { version: payload.version, issuerCount: payload.issuers.length });
  res.status(201).json({ message: 'Manifest ingested successfully.', version: payload.version });
}));
