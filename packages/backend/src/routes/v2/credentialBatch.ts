/**
 * credentialBatch.ts — batch credential ingestion and batch PDF rendering.
 * ============================================================================
 * Two endpoints, deliberately separate (see pdfRender.ts's header for why
 * PDF rendering can never read a stored signature back out of the
 * database — Frozen Spec §7 means one was never stored):
 *
 *   POST /v2/credential/batch    — ingest many signed credentials at once,
 *     plus store any per-document photos (e.g. student_photo) alongside
 *     them as ordinary content-hash-addressed CredentialAssets.
 *
 *   POST /v2/render-pdf-batch    — render one PDF per credential and zip
 *     them, embedding each document's own photo (if supplied) at the
 *     position its template's PhotoZone declares. Does not require prior
 *     ingestion, and doesn't touch the documents table — it renders
 *     directly from the (payload, contentHashHex, signatureHex) the
 *     issuer already has locally, which is the only place that signature
 *     ever exists once ingestion has thrown it away.
 *
 * BOTH ARE NOW MULTIPART/FORM-DATA, not plain JSON — this is the one
 * breaking change from the original JSON-body version, made necessary by
 * per-document photos needing to travel as real binary files, not base64
 * bloating a JSON payload. The contract:
 *   - form field "entries": a JSON string, exactly offline-signer's
 *     signed_batch.json content (an array of {payload, contentHashHex,
 *     signatureHex, ...}).
 *   - zero or more file fields named "photo__<docId>__<fieldName>", e.g.
 *     "photo__11111111-.../student_photo" — one per per-document image.
 *
 * A PREVIOUS VERSION OF /v2/render-pdf-batch HAD A REAL BUG, FIXED HERE:
 * it used to set res.setHeader('X-Render-Summary', ...) AFTER already
 * piping the zip archive to `res` — but archiver can start flushing bytes
 * to the response as soon as the first entry is appended, and Node cannot
 * set a header once any part of the response body has gone out. That
 * produced a raw connection failure mid-stream (a bare "Failed to fetch"
 * client-side, not a normal error response). The fix: every PDF is now
 * rendered into memory FIRST, all headers are set exactly once before any
 * streaming begins, and only then does the zip get built and sent.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireTemplateWriteAuth } from '../../middleware/templatesAuth';
import { validateSignedCredentialEntry, ingestSignedCredential, SignedCredentialEntry } from '../../services/credentialIngestion';
import { storeCredentialAsset } from '../../services/assetStorage';
import { renderCredentialPdf, TemplateForRender } from '../../services/pdfRender';
import { logger } from '../../utils/logger';

export const credentialBatchRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const PHOTO_FIELD_PREFIX = 'photo__';

function checkIssuerOwnership(req: Request, entry: SignedCredentialEntry): void {
  if (req.issuerAccount && entry.payload.issuer_id !== req.issuerAccount.issuerId) {
    throw new ApiError(
      403,
      `payload.issuer_id (${entry.payload.issuer_id}) does not match your own issuerId (${req.issuerAccount.issuerId}).`,
      'FORBIDDEN'
    );
  }
}

/**
 * Parses the shared multipart contract both routes below use. Returns the
 * decoded `entries` array (still raw/unvalidated — each route validates
 * per-entry itself, same as before) plus a lookup of
 * docId -> fieldName -> {buffer, mimeType} built from any
 * "photo__<docId>__<fieldName>" file fields present.
 */
function parseBatchMultipart(req: Request): {
  rawEntries: unknown[];
  photosByDocId: Map<string, Map<string, { buffer: Buffer; mimeType: string }>>;
} {
  const entriesRaw = (req.body as Record<string, string>)?.entries;
  if (typeof entriesRaw !== 'string') {
    throw new ApiError(400, 'Multipart form field "entries" (a JSON string) is required.', 'INVALID_BODY');
  }
  let rawEntries: unknown[];
  try {
    rawEntries = JSON.parse(entriesRaw);
  } catch {
    throw new ApiError(400, 'Form field "entries" must be valid JSON.', 'INVALID_BODY');
  }
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new ApiError(400, '"entries" must be a non-empty array of signed-credential entries.', 'INVALID_BODY');
  }
  if (rawEntries.length > 2000) {
    throw new ApiError(400, `Batch too large (${rawEntries.length} entries) — split into batches of 2000 or fewer.`, 'BATCH_TOO_LARGE');
  }

  const photosByDocId = new Map<string, Map<string, { buffer: Buffer; mimeType: string }>>();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const file of files) {
    if (!file.fieldname.startsWith(PHOTO_FIELD_PREFIX)) continue;
    const rest = file.fieldname.slice(PHOTO_FIELD_PREFIX.length);
    const separatorIndex = rest.indexOf('__');
    if (separatorIndex === -1) continue; // malformed field name — silently ignored, not fatal to the whole batch
    const docId = rest.slice(0, separatorIndex);
    const fieldName = rest.slice(separatorIndex + 2);
    if (!photosByDocId.has(docId)) photosByDocId.set(docId, new Map());
    photosByDocId.get(docId)!.set(fieldName, { buffer: file.buffer, mimeType: file.mimetype });
  }

  return { rawEntries, photosByDocId };
}

/**
 * POST /v2/credential/batch
 * Multipart: "entries" (JSON string array) + optional "photo__<docId>__<fieldName>" files.
 */
credentialBatchRouter.post(
  '/v2/credential/batch',
  requireTemplateWriteAuth,
  upload.any(),
  asyncHandler(async (req: Request, res: Response) => {
    const { rawEntries, photosByDocId } = parseBatchMultipart(req);

    const ingested: string[] = [];
    const failed: Array<{ docId?: string; error: string }> = [];

    for (const raw of rawEntries) {
      let docId: string | undefined;
      try {
        const entry = validateSignedCredentialEntry(raw);
        docId = entry.payload.doc_id;
        checkIssuerOwnership(req, entry);
        const result = await ingestSignedCredential(entry);
        ingested.push(result.docId);

        // Store any photos supplied for this doc — hash-checked against
        // the ALREADY-SIGNED asset_hashes map, exactly like the original
        // single-file POST /asset route (see assetStorage.ts).
        const photos = photosByDocId.get(entry.payload.doc_id);
        if (photos) {
          for (const [fieldName, { buffer, mimeType }] of photos) {
            const expectedHash = entry.payload.asset_hashes?.[fieldName];
            if (!expectedHash) {
              failed.push({
                docId,
                error: `Photo "${fieldName}" was uploaded but the credential's asset_hashes has no entry for it — was it included before signing?`,
              });
              continue;
            }
            await storeCredentialAsset({
              docId: entry.payload.doc_id,
              assetName: fieldName,
              mimeType,
              buffer,
              expectedContentHash: expectedHash,
            });
          }
        }
      } catch (err) {
        failed.push({ docId, error: err instanceof ApiError ? err.message : (err as Error).message });
      }
    }

    logger.info('Batch credential ingestion completed', { ingestedCount: ingested.length, failedCount: failed.length });
    res.status(failed.length === 0 ? 201 : 207).json({
      message: `Ingested ${ingested.length}/${rawEntries.length} credential(s).`,
      ingested,
      failed,
    });
  })
);

/**
 * POST /v2/render-pdf-batch
 * Same multipart contract as above. Returns a ZIP stream, one PDF per
 * successfully-rendered credential.
 */
credentialBatchRouter.post(
  '/v2/render-pdf-batch',
  requireTemplateWriteAuth,
  upload.any(),
  asyncHandler(async (req: Request, res: Response) => {
    const { rawEntries, photosByDocId } = parseBatchMultipart(req);

    const rendered: Array<{ docId: string; pdfBuffer: Buffer }> = [];
    const failed: Array<{ docId?: string; error: string }> = [];

    // Cache templates by "templateId:version" within this one request —
    // a batch is almost always issued under a single template, so this
    // avoids refetching it once per credential.
    const templateCache = new Map<string, TemplateForRender | null>();

    // Every PDF is rendered into memory FIRST, before a single response
    // header is set — see this file's header for exactly why.
    for (const raw of rawEntries) {
      let docId: string | undefined;
      try {
        const entry = validateSignedCredentialEntry(raw);
        docId = entry.payload.doc_id;
        checkIssuerOwnership(req, entry);

        if (!entry.contentHashHex || !entry.signatureHex) {
          throw new Error('Entry is missing contentHashHex/signatureHex — cannot render a QR without them.');
        }

        const cacheKey = `${entry.payload.template_id}:${entry.payload.template_version}`;
        let template = templateCache.get(cacheKey);
        if (template === undefined) {
          const row = await prisma.template.findUnique({
            where: { templateId_version: { templateId: entry.payload.template_id, version: entry.payload.template_version } },
            include: { ocrZones: true, photoZones: true },
          });
          template = row
            ? {
                name: row.name,
                layoutJson: row.layoutJson as TemplateForRender['layoutJson'],
                ocrZones: row.ocrZones.map((z: { fieldName: string; boundingBox: unknown; isMandatory: boolean }) => ({
                  fieldName: z.fieldName,
                  boundingBox: z.boundingBox as TemplateForRender['ocrZones'][number]['boundingBox'],
                  isMandatory: z.isMandatory,
                })),
                photoZones: row.photoZones.map((p: { fieldName: string; boundingBox: unknown; isMandatory: boolean }) => ({
                  fieldName: p.fieldName,
                  boundingBox: p.boundingBox as TemplateForRender['photoZones'][number]['boundingBox'],
                  isMandatory: p.isMandatory,
                })),
                backgroundImage: row.backgroundImageBytes ? Buffer.from(row.backgroundImageBytes) : null,
              }
            : null;
          templateCache.set(cacheKey, template);
        }
        if (!template) {
          throw new Error(`No template found for ${entry.payload.template_id} v${entry.payload.template_version}.`);
        }

        const photos = photosByDocId.get(entry.payload.doc_id);
        const photoBuffers: Record<string, Buffer> = {};
        if (photos) {
          for (const [fieldName, { buffer }] of photos) photoBuffers[fieldName] = buffer;
        }

        const pdfBuffer = await renderCredentialPdf({
          payload: entry.payload,
          contentHashHex: entry.contentHashHex,
          signatureHex: entry.signatureHex,
          template,
          photos: photoBuffers,
        });
        rendered.push({ docId: entry.payload.doc_id, pdfBuffer });
      } catch (err) {
        failed.push({ docId, error: (err as Error).message });
      }
    }

    logger.info('Batch PDF rendering completed', { renderedCount: rendered.length, failedCount: failed.length });

    if (rendered.length === 0) {
      throw new ApiError(422, `None of the entries could be rendered: ${JSON.stringify(failed).slice(0, 500)}`, 'RENDER_FAILED');
    }

    // Every header is set exactly once, all together, before any streaming starts.
    const summary = JSON.stringify({ renderedCount: rendered.length, failedCount: failed.length, failed }).slice(0, 4000);
    res.setHeader('X-Render-Summary', encodeURIComponent(summary));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="credentials.zip"');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      logger.error('Archiver error while streaming PDF batch zip', { error: err.message });
      res.destroy();
    });
    archive.pipe(res);

    for (const { docId, pdfBuffer } of rendered) {
      archive.append(pdfBuffer, { name: `${docId}.pdf` });
    }

    await archive.finalize();
  })
);
