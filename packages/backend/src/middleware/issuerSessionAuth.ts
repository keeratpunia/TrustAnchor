/**
 * issuerSessionAuth.ts — requires a valid issuer portal session.
 * ============================================================================
 * Two middlewares:
 *   - requireIssuerSession: any logged-in issuer account, any status. Used
 *     for routes that make sense even while PENDING/APPROVED_NO_KEY/
 *     SUSPENDED (e.g. "check my own application status").
 *   - requireActiveIssuer: additionally requires status === 'ACTIVE'. Used
 *     for routes that need a real signing key to make sense at all (e.g.
 *     issuing credentials) — see the workflow report's §3.2 state table.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { ApiError } from './errorHandler';
import { asyncHandler } from './asyncHandler';
import { extractBearerToken, verifyIssuerSession } from '../services/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      issuerAccount?: {
        id: string;
        institutionName: string;
        email: string;
        status: string;
        issuerId: string | null;
      };
    }
  }
}

export const requireIssuerSession = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new ApiError(401, 'Missing issuer session token.', 'UNAUTHENTICATED');
  }
  const claims = verifyIssuerSession(token);
  if (!claims) {
    throw new ApiError(401, 'Invalid or expired issuer session.', 'UNAUTHENTICATED');
  }

  // Re-fetch current status from the database on every request rather than
  // trusting the JWT's snapshot of it — a suspension/approval that happened
  // after this token was issued must take effect immediately, not only
  // after the token naturally expires.
  const account = await prisma.issuerAccount.findUnique({ where: { id: claims.issuerAccountId } });
  if (!account) {
    throw new ApiError(401, 'This issuer account no longer exists.', 'UNAUTHENTICATED');
  }

  req.issuerAccount = {
    id: account.id,
    institutionName: account.institutionName,
    email: account.email,
    status: account.status,
    issuerId: account.issuerId,
  };
  next();
});

export function requireActiveIssuer(req: Request, res: Response, next: NextFunction): void {
  if (!req.issuerAccount) {
    // requireIssuerSession must run first; this is a defensive guard, not
    // the primary check — see the route definitions, which always chain
    // requireIssuerSession before requireActiveIssuer.
    throw new ApiError(401, 'Missing issuer session token.', 'UNAUTHENTICATED');
  }
  if (req.issuerAccount.status !== 'ACTIVE') {
    throw new ApiError(
      403,
      `This action requires an ACTIVE signing key. Your account's current status is ${req.issuerAccount.status}.`,
      'ISSUER_NOT_ACTIVE'
    );
  }
  next();
}
