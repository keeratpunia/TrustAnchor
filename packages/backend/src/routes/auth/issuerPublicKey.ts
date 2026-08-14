/**
 * issuerPublicKey.ts — endpoint for an approved issuer to submit their
 * public key hex, so the admin can verify and activate them.
 *
 *   POST /auth/issuer/submit-public-key
 *     Body: { publicKeyHex: string }
 *     Auth: issuer session (must be in APPROVED_NO_KEY status)
 *
 * Stores the key as `pendingPublicKeyHex` — does NOT activate the account.
 * The admin must still verify and confirm via the Applications page.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireIssuerSession } from '../../middleware/issuerSessionAuth';
import { writeAuditLog } from '../../services/auditLog';

export const issuerPublicKeyRouter = Router();

issuerPublicKeyRouter.post(
  '/auth/issuer/submit-public-key',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const issuerAccount = req.issuerAccount!;

    if (issuerAccount.status !== 'APPROVED_NO_KEY') {
      throw new ApiError(
        400,
        `Public key can only be submitted when your account is in APPROVED_NO_KEY status (current: ${issuerAccount.status}).`,
        'INVALID_STATUS'
      );
    }

    const { publicKeyHex } = req.body as { publicKeyHex?: string };
    if (!publicKeyHex || typeof publicKeyHex !== 'string') {
      throw new ApiError(400, 'publicKeyHex (string) is required.', 'INVALID_BODY');
    }

    const trimmed = publicKeyHex.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(trimmed)) {
      throw new ApiError(400, 'publicKeyHex must be a valid hexadecimal string.', 'INVALID_HEX');
    }
    if (trimmed.length < 32 || trimmed.length > 256) {
      throw new ApiError(400, 'publicKeyHex length seems off (expected 32-256 hex chars).', 'INVALID_KEY_LENGTH');
    }

    await prisma.issuerAccount.update({
      where: { id: issuerAccount.id },
      data: { pendingPublicKeyHex: trimmed },
    });

    await writeAuditLog({
      eventType: 'ISSUER_PUBLIC_KEY_SUBMITTED',
      actorType: 'ISSUER',
      actorId: issuerAccount.id,
      payload: {
        publicKeyHexPrefix: trimmed.slice(0, 16) + '...',
        publicKeyHexLength: trimmed.length,
      },
      ip: req.ip,
    });

    res.status(200).json({
      message: 'Public key submitted. Your administrator will verify it and activate your account.',
    });
  })
);
