/**
 * verify.ts - POST /v2/verify/:docId - the Engine 2 orchestration route.
 *
 * This route NEVER re-implements any Engine 1 cryptography. It reads the
 * SAME `documents` and `current_manifest` tables Engine 1's own
 * GET /credential/:docId and GET /manifest endpoints already serve - it
 * does not recompute a hash, does not verify an Ed25519 signature, and
 * does not touch anything under packages/verifier-app/src/engine1/ or
 * packages/shared's crypto modules.
 *
 * THE GATE: Engine 2 is NEVER called unless the client-supplied
 * engine1Result.status is exactly 'AUTHENTIC'. This is enforced by an
 * early return - the fetch to engine2-service physically does not happen
 * in the code path for any other status. This is checked BEFORE any
 * database query runs.
 *
 * WHY THE CLIENT'S SELF-REPORTED engine1Result IS ACCEPTABLE INPUT HERE:
 * Engine 2's output is never itself a cryptographic fact; a client lying
 * about its own Engine 1 run only ever defrauds that same client. The one
 * thing this route DOES independently confirm is that the document exists
 * and is not currently revoked - a purely operational check, not a
 * re-verification of Engine 1's cryptography.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateUuidParam } from '../../middleware/validation';
import { logger } from '../../utils/logger';
import { combineVerdicts, Engine2Verdict as Engine2VerdictType } from './combiner';
import { runEngine2Pipeline, Engine2ServiceError, Engine2OcrZoneInput, Engine2TemplateAssetInput } from './engine2Client';

export const verifyRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * The shape of a Template row's `layoutJson` field this route expects.
 * layoutJson is opaque JSON as far as the database/Prisma is concerned -
 * this route is the first and only place that gives it structural meaning.
 */
interface TemplateLayout {
  page_width: number;
  page_height: number;
  qr_position: number[][];
}

/**
 * POST /v2/verify/:docId
 *
 * multipart/form-data:
 *   photo          - the captured document photograph (required)
 *   engine1Result  - JSON string of the client's Engine1Result (required)
 *
 * Response - 200: { engine1Status, engine2Verdict, overallVerdict, ... }
 * Response - 400: engine1Result missing/malformed, or status !== AUTHENTIC
 *                  (Engine 2 is NOT invoked in this case)
 * Response - 404: document not found, or no Engine 2 template configured
 * Response - 409: document has been revoked
 */
verifyRouter.post(
  '/v2/verify/:docId',
  validateUuidParam('docId'),
  upload.single('photo'),
  asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;

    // THE GATE (checked first, before any database query).
    const engine1ResultRaw = req.body.engine1Result;
    if (!engine1ResultRaw || typeof engine1ResultRaw !== 'string') {
      throw new ApiError(400, 'Form field "engine1Result" (a JSON string) is required.', 'MISSING_ENGINE1_RESULT');
    }

    let engine1Result: { status?: string; fields?: Record<string, string> };
    try {
      engine1Result = JSON.parse(engine1ResultRaw);
    } catch {
      throw new ApiError(400, 'Form field "engine1Result" is not valid JSON.', 'INVALID_ENGINE1_RESULT');
    }

    if (engine1Result.status !== 'AUTHENTIC') {
      // Engine 2 is NEVER called here. Nothing below this line executes
      // for a non-AUTHENTIC Engine 1 result.
      logger.info('Engine 2 verify request rejected at the gate - Engine 1 was not AUTHENTIC', {
        docId,
        engine1Status: engine1Result.status,
      });
      const overallVerdict = combineVerdicts(engine1Result.status ?? 'UNKNOWN', 'REJECTED');
      res.status(400).json({
        error: 'Engine 2 only runs after a successful Engine 1 verification.',
        code: 'ENGINE1_NOT_AUTHENTIC',
        engine1Status: engine1Result.status,
        overallVerdict,
      });
      return;
    }

    if (!req.file) {
      throw new ApiError(400, 'Multipart field "photo" is required.', 'MISSING_PHOTO');
    }

    // Operational check (NOT a crypto re-verification): document exists,
    // reading the SAME table Engine 1's GET /credential/:docId already serves.
    const doc = await prisma.document.findUnique({ where: { docId } });
    if (!doc) {
      throw new ApiError(404, `No credential found for doc_id ${docId}.`, 'CREDENTIAL_NOT_FOUND');
    }

    // Operational check: not revoked, reading the SAME manifest table
    // Engine 1's GET /manifest already serves.
    const manifestRow = await prisma.currentManifest.findUnique({ where: { id: 1 } });
    if (manifestRow) {
      const manifest = manifestRow.manifestBlob as any;
      if (manifest.payload.revoked_docs.includes(docId)) {
        throw new ApiError(409, 'This document has been revoked.', 'DOCUMENT_REVOKED');
      }
    }

    // Template + OCR zone lookup (Engine 2's own tables, purely additive).
    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId: doc.templateId, version: doc.templateVersion } },
      include: { ocrZones: true, assets: true },
    });
    if (!template) {
      throw new ApiError(
        404,
        `No Engine 2 template configuration found for template ${doc.templateId} v${doc.templateVersion}. ` +
          `An administrator must upload one via POST /v2/templates before this credential can be forensically verified.`,
        'TEMPLATE_NOT_CONFIGURED'
      );
    }

    const layout = template.layoutJson as unknown as TemplateLayout;

    const ocrZonesInput: Engine2OcrZoneInput[] = template.ocrZones.map((z: { fieldName: string; boundingBox: unknown; languages: string[]; isMandatory: boolean }) => ({
      field_name: z.fieldName,
      bounding_box: z.boundingBox as any,
      languages: z.languages,
      is_mandatory: z.isMandatory,
    }));

    // Static reference assets (logo/seal/signature) for Stage 5 — the
    // reference bytes travel alongside the zone metadata so engine2Client
    // can send each one as its own multipart file part.
    const templateAssetsInput: Engine2TemplateAssetInput[] = template.assets.map(
      (a: { assetName: string; boundingBox: unknown; isMandatory: boolean; mimeType: string; bytes: Buffer }) => ({
        assetName: a.assetName,
        boundingBox: a.boundingBox as any,
        isMandatory: a.isMandatory,
        mimeType: a.mimeType,
        bytes: a.bytes,
      })
    );

    // Call engine2-service. authenticatedFields comes from doc.fields - the
    // SAME data GET /credential/:docId already serves as the credential's
    // payload. This is Engine-1-authenticated data (the client's own
    // Engine 1 run already verified this exact payload's hash before ever
    // reaching this point) - not a fresh, independently-trusted value this
    // route invents.
    let pipelineResult;
    try {
      pipelineResult = await runEngine2Pipeline({
        photoBuffer: req.file.buffer,
        photoMimeType: req.file.mimetype || 'image/jpeg',
        templateWidth: layout.page_width,
        templateHeight: layout.page_height,
        qrPositionInTemplate: layout.qr_position,
        ocrZones: ocrZonesInput,
        authenticatedFields: doc.fields as Record<string, string>,
        templateAssets: templateAssetsInput,
      });
    } catch (err) {
      if (err instanceof Engine2ServiceError) {
        throw new ApiError(502, `Engine 2 service error: ${err.message}`, 'ENGINE2_SERVICE_ERROR');
      }
      throw err;
    }

    // Combine (Engine 1 is guaranteed AUTHENTIC here - checked at the gate above).
    const overallVerdict = combineVerdicts(engine1Result.status, pipelineResult.engine2_verdict as Engine2VerdictType);

    // Persist for audit/history.
    const verification = await prisma.engine2Verification.create({
      data: {
        docId,
        templateId: doc.templateId,
        templateVersion: doc.templateVersion,
        engine1Status: engine1Result.status,
        engine2Verdict: pipelineResult.engine2_verdict,
        overallVerdict,
        reportJson: pipelineResult as any,
      },
    });

    logger.info('Engine 2 verification complete', {
      docId,
      engine2Verdict: pipelineResult.engine2_verdict,
      overallVerdict,
      verificationId: verification.id,
    });

    res.status(200).json({
      verificationId: verification.id,
      engine1Status: engine1Result.status,
      engine2Verdict: pipelineResult.engine2_verdict,
      overallVerdict,
      reason: pipelineResult.reason,
      alignmentQuality: pipelineResult.alignment_quality,
      tiersCompleted: pipelineResult.tiers_completed,
      screenshotLikelihood: pipelineResult.screenshot_likelihood,
      ocrResults: pipelineResult.ocr_results,
      fieldVerdicts: pipelineResult.field_verdicts,
      templateMatch: pipelineResult.template_match,
      assetVerdicts: pipelineResult.asset_verdicts,
      confidence: pipelineResult.confidence,
    });
  })
);