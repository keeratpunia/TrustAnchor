/**
 * asset.ts — GET /asset/:hash and POST /asset.
 *
 * IMPORTANT SCOPE NOTE (Frozen Spec §13, §21): Engine 1 does NOT call
 * GET /asset/:hash at all. Engine 1's job is fully answered by checking
 * that a credential's `asset_hashes` map is part of its signed payload —
 * it never needs to fetch or examine the actual image bytes. This endpoint
 * exists because it is part of the required API surface and because a
 * future Engine 2 (explicitly out of scope for this implementation) would
 * need it to download a trustworthy reference image for visual comparison.
 * It is included here, fully functional, for that future consumer.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireIngestionAuth } from '../middleware/ingestionAuth';
import { validateSha256HexParam, isUuid, isNonEmptyString } from '../middleware/validation';
import { storeCredentialAsset } from '../services/assetStorage';
import { logger } from '../utils/logger';

export const assetRouter = Router();

// In-memory storage: files are small (photos/logos/signatures), and we
// immediately persist the bytes to Postgres — no need for temp disk files.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * GET /asset/:contentHash
 * Returns the raw bytes of an asset, addressed by its own SHA-256 content
 * hash. Not called by Engine 1 (see file header) — reserved for a future
 * Engine 2 to fetch a reference image for visual comparison.
 */
assetRouter.get(
  '/asset/:contentHash',
  validateSha256HexParam('contentHash'),
  asyncHandler(async (req: Request, res: Response) => {
    const contentHash = req.params.contentHash.toLowerCase();

    const asset = await prisma.credentialAsset.findUnique({ where: { contentHash } });
    if (!asset) {
      throw new ApiError(404, `No asset found for content hash ${contentHash}.`, 'ASSET_NOT_FOUND');
    }

    logger.debug('Served asset bytes', { contentHash, docId: asset.docId });
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-addressed, safe to cache forever
    res.send(Buffer.from(asset.bytes));
  })
);

/**
 * POST /asset
 * Ingests one raw asset file (multipart/form-data), computing its SHA-256
 * server-side and storing it addressed by that hash. The uploader (Issuer
 * Portal) is expected to have already recorded this same hash inside the
 * credential's `asset_hashes` map at signing time — this endpoint verifies
 * the two agree, as a data-integrity sanity check at write time.
 *
 * Form fields expected:
 *   file       — the binary asset (multipart file)
 *   docId      — UUID of the document this asset belongs to
 *   assetName  — e.g. "student_photo", "university_seal"
 *   expectedContentHash — the SHA-256 hex hash the uploader expects (from
 *                          the already-signed credential payload)
 */
assetRouter.post(
  '/asset',
  requireIngestionAuth,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ApiError(400, 'Multipart field "file" is required.', 'INVALID_BODY');
    }

    const { docId, assetName, expectedContentHash } = req.body as Record<string, string>;

    if (!isUuid(docId)) {
      throw new ApiError(400, 'Form field "docId" must be a UUID.', 'INVALID_BODY');
    }
    if (!isNonEmptyString(assetName)) {
      throw new ApiError(400, 'Form field "assetName" is required.', 'INVALID_BODY');
    }

    const { contentHash } = await storeCredentialAsset({
      docId,
      assetName,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      expectedContentHash: expectedContentHash ?? '',
    });

    res.status(201).json({ message: 'Asset ingested successfully.', contentHash });
  })
);
