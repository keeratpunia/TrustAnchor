/**
 * templatesAuth.ts — gate on the /v2/templates* write endpoints.
 * ============================================================================
 * Accepts, in this order of preference:
 *   1. A valid ACTIVE issuer session JWT — the primary path now that
 *      templates belong to the logged-in issuer's own account. Attaches
 *      `req.issuerAccount`; the route handler takes `issuerId` from
 *      `req.issuerAccount.issuerId`, NEVER from a client-supplied body
 *      field, once this is set (see templates.ts).
 *   2. A valid admin session JWT — lets an admin create/manage a template
 *      on an issuer's behalf (e.g. support/onboarding help). Attaches
 *      `req.adminAccount`; the route handler falls back to a
 *      client-supplied `issuerId` in this case, since an admin isn't
 *      acting as any one issuer.
 *   3. The legacy shared ingestion key — kept working deliberately, so
 *      existing scripts, CI, and this project's own integration test
 *      suite (written against the ingestion-key model) keep working
 *      unchanged. Same body-supplied-issuerId behavior as the admin path.
 *
 * An issuer session that ISN'T yet ACTIVE (PENDING / APPROVED_NO_KEY /
 * SUSPENDED / KEY_ROTATION_PENDING... actually KEY_ROTATION_PENDING IS
 * allowed, see below) is rejected with a specific, actionable message
 * rather than a generic 401 — matching the workflow report's "no actor is
 * ever shown a dead end" principle.
 */
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { ApiError } from './errorHandler';
import { asyncHandler } from './asyncHandler';
import { prisma } from '../db/prisma';
import { extractBearerToken, verifyAdminSession, verifyIssuerSession } from '../services/session';

export const requireTemplateWriteAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      // Preferred path: an issuer acting on their own account.
      const issuerClaims = verifyIssuerSession(token);
      if (issuerClaims) {
        const account = await prisma.issuerAccount.findUnique({ where: { id: issuerClaims.issuerAccountId } });
        if (!account) {
          throw new ApiError(401, 'This issuer account no longer exists.', 'UNAUTHENTICATED');
        }
        // KEY_ROTATION_PENDING is allowed through deliberately — a pending
        // rotation does not freeze existing capability (workflow report
        // §3.2). Every other non-ACTIVE status is a genuine block.
        if (account.status !== 'ACTIVE' && account.status !== 'KEY_ROTATION_PENDING') {
          throw new ApiError(
            403,
            `Creating or editing templates requires an ACTIVE signing key. Your account's current status is ${account.status}.`,
            'ISSUER_NOT_ACTIVE'
          );
        }
        req.issuerAccount = {
          id: account.id,
          institutionName: account.institutionName,
          email: account.email,
          status: account.status,
          issuerId: account.issuerId,
        };
        next();
        return;
      }

      // Fallback: an admin acting on an issuer's behalf.
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

    // Legacy fallback: the shared ingestion key, exactly as before.
    if (!config.ingestionApiKey) {
      next();
      return;
    }
    const expected = `Bearer ${config.ingestionApiKey}`;
    if (req.headers.authorization === expected) {
      next();
      return;
    }

    throw new ApiError(
      401,
      'Missing or invalid credentials. Log in as an issuer or admin, or provide the ingestion API key.',
      'UNAUTHORIZED'
    );
  }
);

/** Retained name for anything still importing the old export — same behavior. */
export const requireAdminOrIngestionAuth = requireTemplateWriteAuth;
