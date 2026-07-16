/**
 * auth.ts — real login sessions for both admin and issuer roles.
 * ============================================================================
 * Replaces the old model (a shared ingestion API key pasted into Settings)
 * with actual accounts: POST /auth/admin/login and POST /auth/issuer/login
 * each return a JWT, stored here and attached to every subsequent request.
 * The backend's `requireAdminOrIngestionAuth` (templatesAuth.ts) still
 * accepts the legacy key as a fallback, but this app never sends it anymore
 * — it always sends a real session token now.
 */
import { AdminAccount, IssuerAccount } from './types';

const ADMIN_SESSION_KEY = 'trustanchor_admin_session';
const ISSUER_SESSION_KEY = 'trustanchor_issuer_session';

export interface AdminSession {
  token: string;
  account: AdminAccount;
}

export interface IssuerSession {
  token: string;
  account: IssuerAccount;
}

// ---- Admin session ----

export function loadAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

// ---- Issuer session ----

export function loadIssuerSession(): IssuerSession | null {
  try {
    const raw = localStorage.getItem(ISSUER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveIssuerSession(session: IssuerSession): void {
  localStorage.setItem(ISSUER_SESSION_KEY, JSON.stringify(session));
}

export function clearIssuerSession(): void {
  localStorage.removeItem(ISSUER_SESSION_KEY);
}
