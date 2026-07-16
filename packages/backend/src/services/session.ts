/**
 * session.ts — issuer/admin PORTAL SESSION tokens.
 * ============================================================================
 * These JWTs prove exactly one thing: "this browser already presented a
 * correct email+password for this account." They are completely unrelated
 * to credential signing — no credential, manifest, or anything a verifier
 * ever checks is affected by this file in any way. Compromising this
 * secret lets someone use the PORTAL as that account (create templates,
 * view a ledger); it does not let them forge a single valid credential,
 * because no signing key exists anywhere this token touches.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export type PortalRole = 'issuer' | 'admin';

export interface IssuerSessionClaims {
  role: 'issuer';
  issuerAccountId: string;
  email: string;
  status: string;
}

export interface AdminSessionClaims {
  role: 'admin';
  adminAccountId: string;
  email: string;
  name: string;
}

const ISSUER_SESSION_TTL = '24h';
const ADMIN_SESSION_TTL = '12h';

export function signIssuerSession(claims: Omit<IssuerSessionClaims, 'role'>): string {
  return jwt.sign({ role: 'issuer', ...claims }, config.jwtSecret, { expiresIn: ISSUER_SESSION_TTL });
}

export function signAdminSession(claims: Omit<AdminSessionClaims, 'role'>): string {
  return jwt.sign({ role: 'admin', ...claims }, config.jwtSecret, { expiresIn: ADMIN_SESSION_TTL });
}

/** Returns the decoded claims, or null if the token is missing, expired, malformed, or the wrong role. */
export function verifyIssuerSession(token: string): IssuerSessionClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (decoded?.role !== 'issuer') return null;
    return decoded as IssuerSessionClaims;
  } catch {
    return null;
  }
}

export function verifyAdminSession(token: string): AdminSessionClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (decoded?.role !== 'admin') return null;
    return decoded as AdminSessionClaims;
  } catch {
    return null;
  }
}

/** Extracts a Bearer token from an Authorization header, or null if absent/malformed. */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader);
  return match ? match[1] : null;
}
