/**
 * templates.ts — Engine 2's template management API.
 * ============================================================================
 * Lets a university upload a document template, its static reference assets
 * (logo/seal/signature), and declare OCR zones — WITHOUT writing code
 * (Engine2_Architecture.md §10). This is the administrative surface that
 * populates the three Engine 2 tables (`templates`, `template_assets`,
 * `ocr_zones`) that verify.ts (POST /v2/verify/:docId) reads from.
 *
 * REUSES Engine 1's EXISTING canonical-CBOR + SHA-256 primitives from
 * @trustanchor/shared to compute `templateHash` — the one explicit,
 * documented exception to "Engine 2 never touches Engine 1 code"
 * (Engine2_Architecture.md §10.1, schema.prisma's comment on the Template
 * model). Nothing else in this file — and nothing in any other Engine 2
 * file — imports from packages/verifier-app/src/engine1 or reimplements
 * hashing, QR handling, or signature verification.
 *
 * ZERO changes to any Engine 1 route, table, or endpoint. This file only
 * adds new paths under /v2/*.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { encodeCanonical, cborMap, cborText, cborUint, cborNullableText, CborValue } from '@trustanchor/shared';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireTemplateWriteAuth } from '../../middleware/templatesAuth';
import { requireIssuerSession } from '../../middleware/issuerSessionAuth';
import { isNonEmptyString, isUuid } from '../../middleware/validation';
import { logger } from '../../utils/logger';

export const templatesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Builds the canonical CborValue tree for a template's layoutJson, then
 * hashes it — the SAME canonicalization discipline Engine 1 uses for
 * credential/manifest payloads (packages/shared/src/payloadCodec.ts),
 * applied here to a NEW data shape Engine 1 never defined. This is written
 * explicitly, field by field (mirroring payloadCodec.ts's own stated
 * philosophy), not as a generic "walk the object" function, so that the
 * exact hashed byte layout is always visible in one place.
 */
function templateLayoutToCborValue(layout: {
  page_width: number;
  page_height: number;
  qr_position: number[][];
}): CborValue {
  return cborMap({
    page_width: cborUint(layout.page_width),
    page_height: cborUint(layout.page_height),
    qr_position: {
      kind: 'array',
      value: layout.qr_position.map((point) =>
        cborMap({ x: cborUint(point[0]), y: cborUint(point[1]) })
      ),
    },
  });
}

function computeTemplateHash(layout: { page_width: number; page_height: number; qr_position: number[][] }): string {
  return createHash('sha256').update(encodeCanonical(templateLayoutToCborValue(layout))).digest('hex');
}

/**
 * POST /v2/templates
 * Creates or updates a template. Multipart form-data:
 *   templateId, version, issuerId, name, layoutJson (JSON string)
 *   backgroundImage (OPTIONAL file) — the reference photo, stored as the
 *   template's actual printed background (see schema.prisma's comment on
 *   Template.backgroundImageBytes for why this matters for PDF rendering).
 */
templatesRouter.post(
  '/v2/templates',
  requireTemplateWriteAuth,
  upload.single('backgroundImage'),
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version: versionRaw, issuerId: bodyIssuerId, name, layoutJson: layoutJsonRaw } = req.body as {
      templateId?: string;
      version?: string;
      issuerId?: string;
      name?: string;
      layoutJson?: string;
    };
    const version = versionRaw !== undefined ? parseInt(versionRaw, 10) : undefined;
    let layoutJson: { page_width: number; page_height: number; qr_position: number[][] } | undefined;
    if (typeof layoutJsonRaw === 'string') {
      try {
        layoutJson = JSON.parse(layoutJsonRaw);
      } catch {
        throw new ApiError(400, 'layoutJson must be a valid JSON string.', 'INVALID_TEMPLATE');
      }
    }

    // If a real issuer is logged in, the template belongs to THEM —
    // issuerId comes from the session, never a client-supplied field, so
    // an issuer can never create (or silently take over) a template under
    // someone else's issuerId. Only the admin/legacy path takes issuerId
    // from the request body, since an admin isn't acting as any one issuer.
    const issuerId = req.issuerAccount ? req.issuerAccount.issuerId : bodyIssuerId;
    if (req.issuerAccount && !req.issuerAccount.issuerId) {
      // Should be unreachable in practice (requireTemplateWriteAuth already
      // requires ACTIVE/KEY_ROTATION_PENDING, both of which imply issuerId
      // is set) — defensive guard kept in case that invariant ever changes.
      throw new ApiError(500, 'Logged-in issuer account has no issuerId recorded yet.', 'ISSUER_MISSING_ID');
    }

    if (!isUuid(templateId)) {
      throw new ApiError(400, 'templateId must be a UUID.', 'INVALID_TEMPLATE');
    }
    if (typeof version !== 'number' || version < 1) {
      throw new ApiError(400, 'version must be a positive integer.', 'INVALID_TEMPLATE');
    }
    if (!isUuid(issuerId)) {
      throw new ApiError(400, 'issuerId must be a UUID.', 'INVALID_TEMPLATE');
    }
    if (!isNonEmptyString(name)) {
      throw new ApiError(400, 'name is required.', 'INVALID_TEMPLATE');
    }
    if (
      !layoutJson ||
      typeof layoutJson.page_width !== 'number' ||
      typeof layoutJson.page_height !== 'number' ||
      !Array.isArray(layoutJson.qr_position) ||
      layoutJson.qr_position.length !== 4
    ) {
      throw new ApiError(
        400,
        'layoutJson must include page_width, page_height, and qr_position (an array of exactly 4 [x,y] points).',
        'INVALID_TEMPLATE'
      );
    }

    const templateHash = computeTemplateHash(layoutJson);

    const backgroundFields = req.file
      ? { backgroundImageBytes: req.file.buffer, backgroundImageMimeType: req.file.mimetype || 'image/jpeg' }
      : {};

    const template = await prisma.template.upsert({
      where: { templateId_version: { templateId: templateId!, version: version! } },
      create: { templateId: templateId!, version: version!, issuerId: issuerId!, name: name!, layoutJson: layoutJson as any, templateHash, ...backgroundFields },
      update: { issuerId: issuerId!, name: name!, layoutJson: layoutJson as any, templateHash, ...backgroundFields },
    });

    logger.info('Template upserted', { templateId, version, templateHash, hasBackgroundImage: !!req.file });
    res.status(201).json({
      message: 'Template saved successfully.',
      templateId: template.templateId,
      version: template.version,
      templateHash: template.templateHash,
    });
  })
);

/**
 * GET /v2/templates/:templateId/:version/background
 * Serves the stored reference/background image, if one was uploaded.
 */
templatesRouter.get(
  '/v2/templates/:templateId/:version/background',
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version } = req.params;
    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId, version: parseInt(version, 10) } },
    });
    if (!template || !template.backgroundImageBytes) {
      throw new ApiError(404, 'No background image stored for this template.', 'BACKGROUND_NOT_FOUND');
    }
    res.setHeader('Content-Type', template.backgroundImageMimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(template.backgroundImageBytes));
  })
);


/**
 * GET /v2/templates/my
 * Lists all templates belonging to the currently logged-in issuer.
 * Used by the admin-portal's template picker so issuers never need to
 * type a UUID — they just see their templates by name and click one.
 *
 * MUST be registered BEFORE GET /v2/templates/:templateId/:version,
 * otherwise Express matches "my" as a templateId parameter.
 */
templatesRouter.get(
  '/v2/templates/my',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const issuerId = req.issuerAccount!.issuerId;
    if (!issuerId) {
      res.json([]);
      return;
    }

    const templates = await prisma.template.findMany({
      where: { issuerId },
      include: { ocrZones: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(
      templates.map((t: any) => ({
        templateId: t.templateId,
        version: t.version,
        name: t.name,
        templateHash: t.templateHash,
        hasBackgroundImage: !!t.backgroundImageBytes,
        ocrZoneCount: t.ocrZones?.length ?? 0,
      }))
    );
  })
);

/**
 * GET /v2/templates/:templateId/:version
 * Fetches a template's full configuration: layout, static assets (without
 * their raw bytes — use GET /v2/templates/:id/:version/assets/:assetName
 * for that), and declared OCR zones.
 */
templatesRouter.get(
  '/v2/templates/:templateId/:version',
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version } = req.params;
    const versionNum = parseInt(version, 10);

    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId, version: versionNum } },
      include: { assets: true, ocrZones: true, photoZones: true },
    });

    if (!template) {
      throw new ApiError(404, `No template found for ${templateId} v${version}.`, 'TEMPLATE_NOT_FOUND');
    }

    res.json({
      templateId: template.templateId,
      version: template.version,
      issuerId: template.issuerId,
      name: template.name,
      layoutJson: template.layoutJson,
      templateHash: template.templateHash,
      hasBackgroundImage: !!template.backgroundImageBytes,
      assets: template.assets.map((a: { assetName: string; boundingBox: unknown; contentHash: string; mimeType: string; isMandatory: boolean }) => ({
        assetName: a.assetName,
        boundingBox: a.boundingBox,
        contentHash: a.contentHash,
        mimeType: a.mimeType,
        isMandatory: a.isMandatory,
      })),
      ocrZones: template.ocrZones.map((z: { fieldName: string; boundingBox: unknown; languages: string[]; isMandatory: boolean }) => ({
        fieldName: z.fieldName,
        boundingBox: z.boundingBox,
        languages: z.languages,
        isMandatory: z.isMandatory,
      })),
      photoZones: template.photoZones.map((p: { fieldName: string; boundingBox: unknown; isMandatory: boolean; matchByField: string | null }) => ({
        fieldName: p.fieldName,
        boundingBox: p.boundingBox,
        isMandatory: p.isMandatory,
        matchByField: p.matchByField,
      })),
    });
  })
);

/**
 * POST /v2/templates/:templateId/:version/assets
 * Uploads one static reference asset (logo, seal, signature). multipart:
 *   file, assetName, boundingBox (JSON string {x,y,width,height}), isMandatory
 */
templatesRouter.post(
  '/v2/templates/:templateId/:version/assets',
  requireTemplateWriteAuth,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (!req.file) {
      throw new ApiError(400, 'Multipart field "file" is required.', 'INVALID_BODY');
    }

    const { assetName, boundingBox, isMandatory } = req.body as {
      assetName?: string;
      boundingBox?: string;
      isMandatory?: string;
    };

    if (!isNonEmptyString(assetName)) {
      throw new ApiError(400, 'assetName is required.', 'INVALID_BODY');
    }

    let parsedBox: { x: number; y: number; width: number; height: number };
    try {
      parsedBox = JSON.parse(boundingBox ?? '');
    } catch {
      throw new ApiError(400, 'boundingBox must be a JSON string: {x,y,width,height}.', 'INVALID_BODY');
    }

    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId, version: versionNum } },
    });
    if (!template) {
      throw new ApiError(404, `No template found for ${templateId} v${version}. Create it first via POST /v2/templates.`, 'TEMPLATE_NOT_FOUND');
    }
    if (req.issuerAccount && template.issuerId !== req.issuerAccount.issuerId) {
      throw new ApiError(403, 'This template belongs to a different issuer.', 'FORBIDDEN');
    }

    const contentHash = createHash('sha256').update(req.file.buffer).digest('hex');

    const asset = await prisma.templateAsset.create({
      data: {
        templateId,
        templateVersion: versionNum,
        assetName: assetName!,
        boundingBox: parsedBox as any,
        contentHash,
        mimeType: req.file.mimetype || 'application/octet-stream',
        bytes: req.file.buffer,
        isMandatory: isMandatory !== 'false',
      },
    });

    logger.info('Template asset uploaded', { templateId, version, assetName, contentHash });
    res.status(201).json({ message: 'Asset uploaded successfully.', assetName: asset.assetName, contentHash: asset.contentHash });
  })
);

/**
 * POST /v2/templates/:templateId/:version/ocr-zones
 * Declares one OCR zone. Body: { fieldName, boundingBox, languages, isMandatory }
 */
templatesRouter.post(
  '/v2/templates/:templateId/:version/ocr-zones',
  requireTemplateWriteAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version } = req.params;
    const versionNum = parseInt(version, 10);

    const { fieldName, boundingBox, languages, isMandatory } = req.body as {
      fieldName?: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
      languages?: string[];
      isMandatory?: boolean;
    };

    if (!isNonEmptyString(fieldName)) {
      throw new ApiError(400, 'fieldName is required.', 'INVALID_BODY');
    }
    if (
      !boundingBox ||
      typeof boundingBox.x !== 'number' ||
      typeof boundingBox.y !== 'number' ||
      typeof boundingBox.width !== 'number' ||
      typeof boundingBox.height !== 'number'
    ) {
      throw new ApiError(400, 'boundingBox must be { x, y, width, height } (numbers).', 'INVALID_BODY');
    }
    if (!Array.isArray(languages) || languages.length === 0) {
      throw new ApiError(400, 'languages must be a non-empty array of ISO 639-1 codes (e.g. ["en","hi"]).', 'INVALID_BODY');
    }

    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId, version: versionNum } },
    });
    if (!template) {
      throw new ApiError(404, `No template found for ${templateId} v${version}. Create it first via POST /v2/templates.`, 'TEMPLATE_NOT_FOUND');
    }
    if (req.issuerAccount && template.issuerId !== req.issuerAccount.issuerId) {
      throw new ApiError(403, 'This template belongs to a different issuer.', 'FORBIDDEN');
    }

    const zone = await prisma.ocrZone.create({
      data: {
        templateId,
        templateVersion: versionNum,
        fieldName: fieldName!,
        boundingBox: boundingBox as any,
        languages: languages!,
        isMandatory: isMandatory !== false,
      },
    });

    logger.info('OCR zone declared', { templateId, version, fieldName });
    res.status(201).json({ message: 'OCR zone declared successfully.', fieldName: zone.fieldName });
  })
);

/**
 * POST /v2/templates/:templateId/:version/photo-zones
 * Declares where a PER-DOCUMENT dynamic image (e.g. a student's own photo)
 * goes on the page. Body: { fieldName, boundingBox, isMandatory, matchByField }.
 * `matchByField` must name an already-declared OCR zone (e.g. "roll_no") —
 * batch issuance matches photo FILES to CSV ROWS by that field's value,
 * never by name/initials (two students can share a name; a roll number is
 * designed to be unique). See schema.prisma's PhotoZone model for the full
 * rationale, and why this is separate from ocr-zones/template assets.
 */
templatesRouter.post(
  '/v2/templates/:templateId/:version/photo-zones',
  requireTemplateWriteAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { templateId, version } = req.params;
    const versionNum = parseInt(version, 10);

    const { fieldName, boundingBox, isMandatory, matchByField } = req.body as {
      fieldName?: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
      isMandatory?: boolean;
      matchByField?: string;
    };

    if (!isNonEmptyString(fieldName)) {
      throw new ApiError(400, 'fieldName is required.', 'INVALID_BODY');
    }
    if (
      !boundingBox ||
      typeof boundingBox.x !== 'number' ||
      typeof boundingBox.y !== 'number' ||
      typeof boundingBox.width !== 'number' ||
      typeof boundingBox.height !== 'number'
    ) {
      throw new ApiError(400, 'boundingBox must be { x, y, width, height } (numbers).', 'INVALID_BODY');
    }
    if (!isNonEmptyString(matchByField)) {
      throw new ApiError(400, 'matchByField is required — name an already-declared OCR zone (e.g. "roll_no") to match photo files by.', 'INVALID_BODY');
    }

    const template = await prisma.template.findUnique({
      where: { templateId_version: { templateId, version: versionNum } },
      include: { ocrZones: true },
    });
    if (!template) {
      throw new ApiError(404, `No template found for ${templateId} v${version}. Create it first via POST /v2/templates.`, 'TEMPLATE_NOT_FOUND');
    }
    if (req.issuerAccount && template.issuerId !== req.issuerAccount.issuerId) {
      throw new ApiError(403, 'This template belongs to a different issuer.', 'FORBIDDEN');
    }
    if (!template.ocrZones.some((z: { fieldName: string }) => z.fieldName === matchByField)) {
      throw new ApiError(400, `matchByField "${matchByField}" is not a declared OCR zone on this template. Declare it first.`, 'INVALID_MATCH_FIELD');
    }

    const zone = await prisma.photoZone.create({
      data: {
        templateId,
        templateVersion: versionNum,
        fieldName: fieldName!,
        boundingBox: boundingBox as any,
        isMandatory: isMandatory !== false,
        matchByField: matchByField!,
      },
    });

    logger.info('Photo zone declared', { templateId, version, fieldName, matchByField });
    res.status(201).json({ message: 'Photo zone declared successfully.', fieldName: zone.fieldName });
  })
);

/**
 * GET /v2/verifications/:docId
 * Fetches Engine 2 verification history for a document — audit/history
 * only, not part of any trust decision.
 */
templatesRouter.get(
  '/v2/verifications/:docId',
  asyncHandler(async (req: Request, res: Response) => {
    const { docId } = req.params;
    const verifications = await prisma.engine2Verification.findMany({
      where: { docId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      verifications.map((v: { id: string; docId: string; templateId: string; templateVersion: number; engine1Status: string; engine2Verdict: string; overallVerdict: string; createdAt: Date }) => ({
        id: v.id,
        docId: v.docId,
        templateId: v.templateId,
        templateVersion: v.templateVersion,
        engine1Status: v.engine1Status,
        engine2Verdict: v.engine2Verdict,
        overallVerdict: v.overallVerdict,
        createdAt: v.createdAt,
      }))
    );
  })
);
