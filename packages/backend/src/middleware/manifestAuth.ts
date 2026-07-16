/**
 * manifestAuth.ts — gate on POST /manifest.
 * ============================================================================
 * Deliberately admin-only (plus the legacy shared key) — unlike
 * templatesAuth.ts, an issuer session is NEVER accepted here. Publishing
 * the trust manifest is a platform-level trust decision (which issuers are
 * currently active, which documents are revoked), not something any
 * individual issuer should ever be able to do to their own account, let
 * alone anyone else's.
 */
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { ApiError } from './errorHandler';
import { asyncHandler } from './asyncHandler';
import { prisma } from '../db/prisma';
import { extractBearerToken, verifyAdminSession } from '../services/session';

export const requireAdminOrLegacyIngestionAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      const adminClaims = verifyAdminSession(token);
      if (adminClaims) {
        const account = await prisma.adminAccount.findUnique({ where: { id: adminClaims.adminAccountId } });
        if (account) {
          req.adminAccount = { id: account.id, name: account.name, email: account.email };
          next();
          return;
        }
      }
    }

    if (!config.ingestionApiKey) {
      next();
      return;
    }
    if (req.headers.authorization === `Bearer ${config.ingestionApiKey}`) {
      next();
      return;
    }

    throw new ApiError(401, 'Missing or invalid credentials. Log in as an admin, or provide the ingestion API key.', 'UNAUTHORIZED');
  }
);
