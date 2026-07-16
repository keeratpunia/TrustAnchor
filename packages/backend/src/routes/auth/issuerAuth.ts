/**
 * issuerAuth.ts — issuer portal account routes.
 * ============================================================================
 * POST /auth/issuer/signup     — submit an application (status: PENDING)
 * POST /auth/issuer/login      — log in, get a session token
 * GET  /auth/issuer/me         — current account + status (for the portal's
 *                                 own "what screen do I show" decision)
 * POST /auth/issuer/key-rotation-request  — request rotating the signing key
 * GET  /auth/issuer/key-rotation-status   — this issuer's own recent requests
 *
 * WHAT DOES NOT HAPPEN HERE: no private key of any kind is ever generated,
 * received, or stored by any route in this file. Signup does not call
 * offline-signer's keygen — that happens on the issuer's own machine (see
 * offline-signer/src/keySigner.ts), and only the resulting PUBLIC key hex
 * is ever submitted back to this backend, via the admin's key-publishing
 * endpoint (routes/admin/applications.ts), not by the issuer directly —
 * an admin must confirm the key out-of-band first (see the workflow
 * report's §3.3).
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireIssuerSession } from '../../middleware/issuerSessionAuth';
import { isNonEmptyString } from '../../middleware/validation';
import { signIssuerSession } from '../../services/session';
import { writeAuditLog } from '../../services/auditLog';

export const issuerAuthRouter = Router();

const PASSWORD_MIN_LENGTH = 10;
const BCRYPT_ROUNDS = 12;

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * POST /auth/issuer/signup
 * Body: { institutionName, email, password }
 * Creates an IssuerAccount with status PENDING. No key of any kind exists
 * yet — see this file's header.
 */
issuerAuthRouter.post(
  '/auth/issuer/signup',
  asyncHandler(async (req: Request, res: Response) => {
    const { institutionName, email, password } = req.body as {
      institutionName?: string;
      email?: string;
      password?: string;
    };

    if (!isNonEmptyString(institutionName)) {
      throw new ApiError(400, 'institutionName is required.', 'INVALID_BODY');
    }
    if (!isValidEmail(email)) {
      throw new ApiError(400, 'A valid email address is required.', 'INVALID_BODY');
    }
    if (!isNonEmptyString(password) || password.length < PASSWORD_MIN_LENGTH) {
      throw new ApiError(400, `password must be at least ${PASSWORD_MIN_LENGTH} characters.`, 'INVALID_BODY');
    }

    const existing = await prisma.issuerAccount.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw new ApiError(400, 'An issuer account with this email already exists.', 'EMAIL_TAKEN');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const account = await prisma.issuerAccount.create({
      data: {
        institutionName,
        email: email.toLowerCase(),
        passwordHash,
        status: 'PENDING',
      },
    });

    await writeAuditLog({
      eventType: 'ISSUER_APPLICATION_SUBMITTED',
      actorType: 'ISSUER',
      actorId: account.id,
      payload: { institutionName, email: email.toLowerCase() },
      ip: req.ip,
    });

    res.status(201).json({
      message: 'Application submitted. An administrator will review it before you can log in and use the portal.',
      issuerAccountId: account.id,
      status: account.status,
    });
  })
);

/**
 * POST /auth/issuer/login
 * Body: { email, password }
 * Returns a session token regardless of status (PENDING/SUSPENDED accounts
 * can still log in — they just see a restricted screen; see the workflow
 * report's §3.2) — being unable to even LOG IN to check your own status
 * would be a worse experience than seeing a clear "still pending" screen.
 */
issuerAuthRouter.post(
  '/auth/issuer/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!isValidEmail(email) || !isNonEmptyString(password)) {
      throw new ApiError(400, 'email and password are required.', 'INVALID_BODY');
    }

    const account = await prisma.issuerAccount.findUnique({ where: { email: email.toLowerCase() } });
    const passwordMatches = account ? await bcrypt.compare(password, account.passwordHash) : false;

    if (!account || !passwordMatches) {
      // Identical error for "no such account" and "wrong password" — never
      // reveal which one it was, a basic anti-enumeration measure.
      await writeAuditLog({
        eventType: 'ISSUER_LOGIN_FAILED',
        actorType: 'ISSUER',
        actorId: account?.id ?? null,
        payload: { email: email!.toLowerCase() },
        ip: req.ip,
      });
      throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const token = signIssuerSession({ issuerAccountId: account.id, email: account.email, status: account.status });

    await writeAuditLog({
      eventType: 'ISSUER_LOGIN_SUCCESS',
      actorType: 'ISSUER',
      actorId: account.id,
      ip: req.ip,
    });

    res.json({
      token,
      issuerAccount: {
        id: account.id,
        institutionName: account.institutionName,
        email: account.email,
        status: account.status,
        issuerId: account.issuerId,
        publicKeyHex: account.publicKeyHex,
        keySource: account.keySource,
      },
    });
  })
);

/** GET /auth/issuer/me — the logged-in issuer's own current account state. */
issuerAuthRouter.get(
  '/auth/issuer/me',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const account = await prisma.issuerAccount.findUnique({ where: { id: req.issuerAccount!.id } });
    if (!account) throw new ApiError(404, 'Issuer account not found.', 'NOT_FOUND');
    res.json({
      id: account.id,
      institutionName: account.institutionName,
      email: account.email,
      status: account.status,
      issuerId: account.issuerId,
      publicKeyHex: account.publicKeyHex,
      keySource: account.keySource,
      rejectionReason: account.rejectionReason,
      suspensionReason: account.suspensionReason,
      createdAt: account.createdAt,
      approvedAt: account.approvedAt,
    });
  })
);

/**
 * POST /auth/issuer/key-rotation-request
 * Body: { reason, password }
 * Password re-confirmation before a sensitive action — matching the
 * workflow report's principle that a revocation/rotation should never be
 * one accidental click.
 */
issuerAuthRouter.post(
  '/auth/issuer/key-rotation-request',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, password } = req.body as { reason?: string; password?: string };
    if (!isNonEmptyString(reason)) {
      throw new ApiError(400, 'A reason is required for key rotation.', 'INVALID_BODY');
    }
    if (!isNonEmptyString(password)) {
      throw new ApiError(400, 'Password is required.', 'INVALID_BODY');
    }

    const account = await prisma.issuerAccount.findUnique({ where: { id: req.issuerAccount!.id } });
    if (!account) throw new ApiError(404, 'Issuer account not found.', 'NOT_FOUND');

    const passwordMatches = await bcrypt.compare(password, account.passwordHash);
    if (!passwordMatches) {
      throw new ApiError(403, 'Incorrect password.', 'INCORRECT_PASSWORD');
    }

    const existingPending = await prisma.keyRotationRequest.findFirst({
      where: { issuerAccountId: account.id, status: 'PENDING' },
    });
    if (existingPending) {
      throw new ApiError(400, 'You already have a pending key rotation request.', 'ROTATION_ALREADY_PENDING');
    }

    const request = await prisma.keyRotationRequest.create({
      data: { issuerAccountId: account.id, reason: reason.trim() },
    });

    await writeAuditLog({
      eventType: 'KEY_ROTATION_REQUESTED',
      actorType: 'ISSUER',
      actorId: account.id,
      payload: { reason: reason.trim(), requestId: request.id },
      ip: req.ip,
    });

    res.status(201).json({
      message: 'Key rotation request submitted. Awaiting admin approval — your current key keeps working until then.',
      id: request.id,
      status: request.status,
    });
  })
);

/** GET /auth/issuer/key-rotation-status — this issuer's own recent rotation requests. */
issuerAuthRouter.get(
  '/auth/issuer/key-rotation-status',
  requireIssuerSession,
  asyncHandler(async (req: Request, res: Response) => {
    const requests = await prisma.keyRotationRequest.findMany({
      where: { issuerAccountId: req.issuerAccount!.id },
      orderBy: { requestedAt: 'desc' },
      take: 5,
    });
    res.json(
      requests.map((r: { id: string; reason: string; status: string; reviewNote: string | null; requestedAt: Date; reviewedAt: Date | null }) => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt,
      }))
    );
  })
);
