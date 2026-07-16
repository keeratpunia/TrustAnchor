/**
 * keyRotation.ts — admin review of issuer key rotation requests.
 * ============================================================================
 * Approving a rotation does NOT generate anything server-side — it records
 * that the admin received a NEW public key from the issuer (generated
 * offline, exactly like the original keygen ceremony) and is publishing it.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';
import { isEd25519PublicKeyHex, validateUuidParam } from '../../middleware/validation';
import { writeAuditLog } from '../../services/auditLog';

export const adminKeyRotationRouter = Router();

/** GET /admin/key-rotation-requests?status=PENDING */
adminKeyRotationRouter.get(
  '/admin/key-rotation-requests',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const requests = await prisma.keyRotationRequest.findMany({
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
        reason: r.reason,
        status: r.status,
        newPublicKeyHex: r.newPublicKeyHex,
        reviewNote: r.reviewNote,
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt,
      }))
    );
  })
);

/**
 * POST /admin/key-rotation-requests/:id/approve
 * Body: { newPublicKeyHex, newKeySource, note? }
 */
adminKeyRotationRouter.post(
  '/admin/key-rotation-requests/:id/approve',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { newPublicKeyHex, newKeySource, note } = req.body as {
      newPublicKeyHex?: string;
      newKeySource?: string;
      note?: string;
    };

    if (!isEd25519PublicKeyHex(newPublicKeyHex)) {
      throw new ApiError(400, 'newPublicKeyHex must be a 64-character hex Ed25519 public key.', 'INVALID_BODY');
    }
    if (newKeySource !== 'yubikey' && newKeySource !== 'software_test_key') {
      throw new ApiError(400, 'newKeySource must be exactly "yubikey" or "software_test_key".', 'INVALID_BODY');
    }

    const request = await prisma.keyRotationRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new ApiError(404, 'Key rotation request not found.', 'NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw new ApiError(400, `This request has already been ${request.status.toLowerCase()}.`, 'INVALID_STATE');
    }

    await prisma.$transaction([
      prisma.keyRotationRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          newPublicKeyHex,
          newKeySource,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        },
      }),
      prisma.issuerAccount.update({
        where: { id: request.issuerAccountId },
        data: { publicKeyHex: newPublicKeyHex, keySource: newKeySource },
      }),
    ]);

    await writeAuditLog({
      eventType: 'KEY_ROTATION_APPROVED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { requestId: request.id, issuerAccountId: request.issuerAccountId, newKeySource },
      ip: req.ip,
    });

    res.json({
      message:
        'Rotation approved and the new key recorded. Remember: publish a new signed Trust Manifest with this key ' +
        'before any verifier will actually trust credentials issued under it.',
    });
  })
);

/** POST /admin/key-rotation-requests/:id/reject — Body: { note? } */
adminKeyRotationRouter.post(
  '/admin/key-rotation-requests/:id/reject',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = req.body as { note?: string };
    const request = await prisma.keyRotationRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new ApiError(404, 'Key rotation request not found.', 'NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw new ApiError(400, `This request has already been ${request.status.toLowerCase()}.`, 'INVALID_STATE');
    }

    await prisma.keyRotationRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', reviewNote: note ?? null, reviewedAt: new Date() },
    });

    await writeAuditLog({
      eventType: 'KEY_ROTATION_REJECTED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { requestId: request.id },
      ip: req.ip,
    });

    res.json({ message: 'Rotation request rejected.' });
  })
);
