/**
 * ingestionAuth.ts — shared-secret gate on administrative ingestion endpoints.
 *
 * IMPORTANT: this is ordinary operational access control (keeping a public
 * deployment from being spammed with junk uploads), NOT a cryptographic
 * security boundary. Per Frozen Spec §21: even if an attacker bypassed this
 * check entirely, they could only upload data that must still pass every
 * verifier's independent signature/hash checks to have any effect — and a
 * manifest or credential they didn't have the offline private key for would
 * simply fail to verify anywhere downstream. This middleware exists purely
 * so that in normal operation, only your own Issuer Portal / admin tooling
 * populates the database, not the general public.
 */
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { ApiError } from './errorHandler';

export function requireIngestionAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.ingestionApiKey) {
    // No key configured (e.g. local development) — allow through, but this
    // should always be set in any deployment reachable by the public
    // internet. Documented clearly in .env.example.
    next();
    return;
  }

  const header = req.headers.authorization;
  const expected = `Bearer ${config.ingestionApiKey}`;

  if (header !== expected) {
    throw new ApiError(401, 'Missing or invalid ingestion credentials.', 'UNAUTHORIZED');
  }

  next();
}
