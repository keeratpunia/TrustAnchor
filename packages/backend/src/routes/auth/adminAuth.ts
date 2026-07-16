/**
 * adminAuth.ts — admin portal login.
 * ============================================================================
 * Deliberately no POST /auth/admin/signup anywhere in this system — see
 * schema.prisma's comment on AdminAccount for why. Provision admin accounts
 * via prisma/seed.ts or a direct database operation, never a public form.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';
import { isNonEmptyString } from '../../middleware/validation';
import { signAdminSession } from '../../services/session';
import { writeAuditLog } from '../../services/auditLog';

export const adminAuthRouter = Router();

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** POST /auth/admin/login — Body: { email, password } */
adminAuthRouter.post(
  '/auth/admin/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!isValidEmail(email) || !isNonEmptyString(password)) {
      throw new ApiError(400, 'email and password are required.', 'INVALID_BODY');
    }

    const account = await prisma.adminAccount.findUnique({ where: { email: email.toLowerCase() } });
    const passwordMatches = account ? await bcrypt.compare(password, account.passwordHash) : false;

    if (!account || !passwordMatches) {
      await writeAuditLog({
        eventType: 'ADMIN_LOGIN_FAILED',
        actorType: 'ADMIN',
        actorId: account?.id ?? null,
        payload: { email: email!.toLowerCase() },
        ip: req.ip,
      });
      throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const token = signAdminSession({ adminAccountId: account.id, email: account.email, name: account.name });

    await writeAuditLog({ eventType: 'ADMIN_LOGIN_SUCCESS', actorType: 'ADMIN', actorId: account.id, ip: req.ip });

    res.json({ token, adminAccount: { id: account.id, name: account.name, email: account.email } });
  })
);

/** GET /auth/admin/me — the logged-in admin's own identity. */
adminAuthRouter.get(
  '/auth/admin/me',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(req.adminAccount);
  })
);
