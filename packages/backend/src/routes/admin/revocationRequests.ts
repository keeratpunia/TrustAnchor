/**
 * revocationRequests.ts — admin review of issuer revocation requests.
 * ============================================================================
 * Approving here does NOT revoke anything by itself — see
 * routes/v2/issuerDocuments.ts's header. It records the admin's decision;
 * actually revoking still requires the separate offline manifest
 * re-signing ceremony (offline-signer sign-manifest, with this doc_id
 * added to revoked_docs, then POST /manifest) — exactly the same shape as
 * key rotation approval.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';
import { validateUuidParam } from '../../middleware/validation';
import { writeAuditLog } from '../../services/auditLog';

export const adminRevocationRequestsRouter = Router();

/** GET /admin/revocation-requests?status= */
adminRevocationRequestsRouter.get(
  '/admin/revocation-requests',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const requests = await prisma.revocationRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { requestedAt: 'desc' },
      include: { issuerAccount: { select: { institutionName: true, email: true } } },
    });
    res.json(
      requests.map((r: any) => ({
        id: r.id,
        issuerAccountId: r.issuerAccountId,
        institutionName: r.issuerAccount.institutionName,
        email: r.issuerAccount.email,
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

/** POST /admin/revocation-requests/:id/approve — Body: { note? } */
adminRevocationRequestsRouter.post(
  '/admin/revocation-requests/:id/approve',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = req.body as { note?: string };
    const request = await prisma.revocationRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new ApiError(404, 'Revocation request not found.', 'NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw new ApiError(400, `This request has already been ${request.status.toLowerCase()}.`, 'INVALID_STATE');
    }

    await prisma.revocationRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', reviewNote: note ?? null, reviewedAt: new Date() },
    });

    await writeAuditLog({
      eventType: 'REVOCATION_APPROVED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { requestId: request.id, docId: request.docId },
      ip: req.ip,
    });

    res.json({
      message:
        `Approved. Remember: "${request.docId}" is NOT actually revoked yet — add it to revoked_docs and run ` +
        `offline-signer sign-manifest, then POST the result to /manifest, before any verifier will treat it as revoked.`,
    });
  })
);

/** POST /admin/revocation-requests/:id/reject — Body: { note? } */
adminRevocationRequestsRouter.post(
  '/admin/revocation-requests/:id/reject',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = req.body as { note?: string };
    const request = await prisma.revocationRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new ApiError(404, 'Revocation request not found.', 'NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw new ApiError(400, `This request has already been ${request.status.toLowerCase()}.`, 'INVALID_STATE');
    }

    await prisma.revocationRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', reviewNote: note ?? null, reviewedAt: new Date() },
    });

    await writeAuditLog({
      eventType: 'REVOCATION_REJECTED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { requestId: request.id, docId: request.docId },
      ip: req.ip,
    });

    res.json({ message: 'Revocation request rejected.' });
  })
);
