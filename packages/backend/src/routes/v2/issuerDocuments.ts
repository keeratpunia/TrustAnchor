/**
 * issuerDocuments.ts — an issuer's own document ledger + revocation
 * requests.
 * ============================================================================
 * GET  /v2/issuer/documents                     — search/list own documents
 * POST /v2/issuer/documents/:docId/revoke-request — request a revocation
 * GET  /v2/issuer/revocation-requests             — own request history
 *
 * REVOCATION IS NOT A SIMPLE BUTTON — READ BEFORE MODIFYING:
 * Per the Frozen Architecture Specification §9, revocation only becomes
 * real once an admin re-signs and republishes the Trust Manifest with this
 * doc_id added to `revoked_docs` — the exact same offline dance key
 * rotation requires (see routes/admin/keyRotation.ts). This router only
 * ever creates/lists a REQUEST; it never touches revoked_docs or the
 * manifest itself. See routes/admin/revocationRequests.ts for the other
 * half of this flow.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireIssuerSession } from '../../middleware/issuerSessionAuth';
import { isNonEmptyString, validateUuidParam } from '../../middleware/validation';
import { writeAuditLog } from '../../services/auditLog';

export const issuerDocumentsRouter = Router();

/** GET /v2/issuer/documents?q=&limit= */
issuerDocumentsRouter.get(
  '/v2/issuer/documents',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const issuerId = req.issuerAccount!.issuerId;
    if (!issuerId) {
      // No key published yet -> no possible documents. Not an error, just
      // an honestly empty result, matching "APPROVED_NO_KEY can still see
      // a dashboard, just with nothing to show yet."
      res.json([]);
      return;
    }

    const q = (req.query.q as string | undefined)?.trim().toLowerCase();
    const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10) || 200, 500);

    const docs = await prisma.document.findMany({
      where: { issuerId },
      orderBy: { createdAt: 'desc' },
      take: q ? undefined : limit, // filter first, then cap, when searching
    });

    const filtered = q
      ? docs.filter((d: { docId: string; fields: unknown }) => {
          if (d.docId.toLowerCase().includes(q)) return true;
          const fields = d.fields as Record<string, string>;
          return Object.values(fields ?? {}).some((v) => String(v).toLowerCase().includes(q));
        })
      : docs;

    res.json(
      filtered.slice(0, limit).map((d: { docId: string; templateId: string; templateVersion: number; issuedAt: string; expiresAt: string | null; fields: unknown; createdAt: Date }) => ({
        docId: d.docId,
        templateId: d.templateId,
        templateVersion: d.templateVersion,
        issuedAt: d.issuedAt,
        expiresAt: d.expiresAt,
        fields: d.fields,
        createdAt: d.createdAt,
      }))
    );
  })
);

/**
 * POST /v2/issuer/documents/:docId/revoke-request
 * Body: { reason, password } — password re-confirmed, exactly like key
 * rotation requests, since this is exactly as sensitive an action.
 */
issuerDocumentsRouter.post(
  '/v2/issuer/documents/:docId/revoke-request',
  validateUuidParam('docId'),
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, password } = req.body as { reason?: string; password?: string };
    if (!isNonEmptyString(reason)) throw new ApiError(400, 'A reason is required.', 'INVALID_BODY');
    if (!isNonEmptyString(password)) throw new ApiError(400, 'Password is required.', 'INVALID_BODY');

    const issuerAccount = req.issuerAccount!;
    if (issuerAccount.status !== 'ACTIVE' && issuerAccount.status !== 'KEY_ROTATION_PENDING') {
      throw new ApiError(403, `Requesting a revocation requires an ACTIVE account (current status: ${issuerAccount.status}).`, 'ISSUER_NOT_ACTIVE');
    }

    const account = await prisma.issuerAccount.findUnique({ where: { id: issuerAccount.id } });
    if (!account) throw new ApiError(404, 'Issuer account not found.', 'NOT_FOUND');
    const passwordMatches = await bcrypt.compare(password, account.passwordHash);
    if (!passwordMatches) throw new ApiError(403, 'Incorrect password.', 'INCORRECT_PASSWORD');

    const doc = await prisma.document.findUnique({ where: { docId: req.params.docId } });
    if (!doc) throw new ApiError(404, `No document found for doc_id ${req.params.docId}.`, 'DOCUMENT_NOT_FOUND');
    if (doc.issuerId !== issuerAccount.issuerId) {
      throw new ApiError(403, 'This document belongs to a different issuer.', 'FORBIDDEN');
    }

    const existingPending = await prisma.revocationRequest.findFirst({
      where: { docId: doc.docId, status: 'PENDING' },
    });
    if (existingPending) {
      throw new ApiError(400, 'A revocation request for this document is already pending.', 'REVOCATION_ALREADY_PENDING');
    }

    const request = await prisma.revocationRequest.create({
      data: { issuerAccountId: issuerAccount.id, docId: doc.docId, reason: reason.trim() },
    });

    await writeAuditLog({
      eventType: 'REVOCATION_REQUESTED',
      actorType: 'ISSUER',
      actorId: issuerAccount.id,
      payload: { docId: doc.docId, reason: reason.trim(), requestId: request.id },
      ip: req.ip,
    });

    res.status(201).json({
      message: 'Revocation request submitted. Awaiting admin approval — this document still verifies as normal until the manifest is republished with it revoked.',
      id: request.id,
      status: request.status,
    });
  })
);

/** GET /v2/issuer/revocation-requests — this issuer's own revocation request history. */
issuerDocumentsRouter.get(
  '/v2/issuer/revocation-requests',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const requests = await prisma.revocationRequest.findMany({
      where: { issuerAccountId: req.issuerAccount!.id },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    res.json(
      requests.map((r: { id: string; docId: string; reason: string; status: string; reviewNote: string | null; requestedAt: Date; reviewedAt: Date | null }) => ({
        id: r.id,
        docId: r.docId,
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt,
      }))
    );
  })
);
