/**
 * adminSessionAuth.ts — requires a valid admin portal session.
 * ============================================================================
 * Admin accounts are never self-registered (see schema.prisma's comment on
 * AdminAccount) — reaching this middleware successfully means someone with
 * an already-provisioned admin account logged in with the right password.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { ApiError } from './errorHandler';
import { asyncHandler } from './asyncHandler';
import { extractBearerToken, verifyAdminSession } from '../services/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminAccount?: {
        id: string;
        name: string;
        email: string;
      };
    }
  }
}

export const requireAdminSession = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new ApiError(401, 'Missing admin session token.', 'UNAUTHENTICATED');
  }
  const claims = verifyAdminSession(token);
  if (!claims) {
    throw new ApiError(401, 'Invalid or expired admin session.', 'UNAUTHENTICATED');
  }

  const account = await prisma.adminAccount.findUnique({ where: { id: claims.adminAccountId } });
  if (!account) {
    throw new ApiError(401, 'This admin account no longer exists.', 'UNAUTHENTICATED');
  }

  req.adminAccount = { id: account.id, name: account.name, email: account.email };
  next();
});
