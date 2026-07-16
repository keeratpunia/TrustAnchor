/**
 * assetStorage.ts — stores one per-document asset (e.g. a student photo),
 * content-hash-addressed, exactly like the original POST /asset route.
 * ============================================================================
 * Extracted so routes/asset.ts's single-file endpoint and the batch
 * ingestion path (routes/v2/credentialBatch.ts) run through IDENTICAL
 * validation/storage logic — the same discipline as
 * services/credentialIngestion.ts for the credential itself.
 *
 * SCOPE REMINDER: this is storage only. Nothing here verifies WHO is
 * pictured in a photo — see schema.prisma's PhotoZone model header for why
 * that's a deliberately separate, unsolved problem. This function's only
 * job is "does this file's hash match what was already signed, and if so,
 * remember its bytes."
 */
import { createHash } from 'crypto';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export interface StoreAssetParams {
  docId: string;
  assetName: string;
  mimeType: string;
  buffer: Buffer;
  expectedContentHash: string;
}

/**
 * Verifies the uploaded bytes hash to what the ALREADY-SIGNED credential
 * claimed (in its asset_hashes map) before storing anything — refusing a
 * mismatch here is what prevents someone swapping in a different photo
 * after the fact, since the credential's signature covers asset_hashes.
 */
export async function storeCredentialAsset(params: StoreAssetParams): Promise<{ contentHash: string }> {
  const { docId, assetName, mimeType, buffer, expectedContentHash } = params;

  if (!/^[0-9a-f]{64}$/i.test(expectedContentHash)) {
    throw new ApiError(400, `expectedContentHash for asset "${assetName}" must be a 64-character hex SHA-256 digest.`, 'INVALID_BODY');
  }

  const computedHash = createHash('sha256').update(buffer).digest('hex');
  if (computedHash !== expectedContentHash.toLowerCase()) {
    throw new ApiError(
      400,
      `Asset "${assetName}" for doc ${docId}: uploaded file's SHA-256 (${computedHash}) does not match the hash already signed into the credential (${expectedContentHash}). Refusing to store a mismatched asset.`,
      'HASH_MISMATCH'
    );
  }

  await prisma.credentialAsset.upsert({
    where: { contentHash: computedHash },
    create: {
      contentHash: computedHash,
      docId,
      assetName,
      mimeType: mimeType || 'application/octet-stream',
      bytes: buffer,
    },
    update: {}, // content-addressed: if the hash already exists, the bytes are already identical
  });

  logger.info('Stored per-document asset', { docId, assetName, contentHash: computedHash });
  return { contentHash: computedHash };
}
