/**
 * adminApi.ts — client for /auth/admin/* and /admin/* (packages/backend's
 * routes/auth/adminAuth.ts, routes/admin/applications.ts, keyRotation.ts,
 * auditLog.ts). Zero new backend endpoints — this only calls what already
 * exists.
 */
import { loadSettings } from './settings';
import { loadAdminSession, saveAdminSession, clearAdminSession } from './auth';
import { parseJsonOrThrow, ApiError } from './api';
import { AdminAccount, IssuerAccount, KeyRotationRequest, AuditLogEntry, RevocationRequest } from './types';

function baseUrl(): string {
  return loadSettings().backendUrl.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const session = loadAdminSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

// ---- Auth ----

/** POST /auth/admin/login */
export async function adminLogin(email: string, password: string): Promise<{ token: string; adminAccount: AdminAccount }> {
  const res = await fetch(`${baseUrl()}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJsonOrThrow(res);
  saveAdminSession({ token: body.token, account: body.adminAccount });
  return body;
}

export function adminLogout(): void {
  clearAdminSession();
}

/**
 * Verifies the stored admin session is still valid by calling GET
 * /auth/admin/me. Used on app load so an expired/invalid token bounces
 * back to the login screen instead of showing a broken dashboard.
 */
export async function verifyAdminSession(): Promise<AdminAccount | null> {
  const session = loadAdminSession();
  if (!session) return null;
  try {
    const res = await fetch(`${baseUrl()}/auth/admin/me`, { headers: authHeaders() });
    if (!res.ok) {
      clearAdminSession();
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Issuer application review ----

/** GET /admin/issuer-accounts?status= */
export async function listIssuerAccounts(status?: string): Promise<IssuerAccount[]> {
  const url = new URL(`${baseUrl()}/admin/issuer-accounts`);
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** POST /admin/issuer-accounts/:id/approve */
export async function approveIssuerAccount(id: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/issuer-accounts/${id}/approve`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseJsonOrThrow(res);
}

/** POST /admin/issuer-accounts/:id/reject — Body: { reason } */
export async function rejectIssuerAccount(id: string, reason: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/issuer-accounts/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason }),
  });
  return parseJsonOrThrow(res);
}

/** POST /admin/issuer-accounts/:id/publish-key — Body: { publicKeyHex, keySource, issuerId? } */
export async function publishIssuerKey(
  id: string,
  params: { publicKeyHex: string; keySource: 'yubikey' | 'software_test_key'; issuerId?: string }
): Promise<{ message: string; issuerId: string }> {
  const res = await fetch(`${baseUrl()}/admin/issuer-accounts/${id}/publish-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

/** POST /admin/issuer-accounts/:id/suspend — Body: { reason } */
export async function suspendIssuerAccount(id: string, reason: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/issuer-accounts/${id}/suspend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason }),
  });
  return parseJsonOrThrow(res);
}

// ---- Key rotation review ----

/** GET /admin/key-rotation-requests?status= */
export async function listKeyRotationRequests(status?: string): Promise<KeyRotationRequest[]> {
  const url = new URL(`${baseUrl()}/admin/key-rotation-requests`);
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** POST /admin/key-rotation-requests/:id/approve */
export async function approveKeyRotation(
  id: string,
  params: { newPublicKeyHex: string; newKeySource: 'yubikey' | 'software_test_key'; note?: string }
): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/key-rotation-requests/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

/** POST /admin/key-rotation-requests/:id/reject */
export async function rejectKeyRotation(id: string, note?: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/key-rotation-requests/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ note }),
  });
  return parseJsonOrThrow(res);
}

// ---- Revocation review ----

/** GET /admin/revocation-requests?status= */
export async function listRevocationRequests(status?: string): Promise<RevocationRequest[]> {
  const url = new URL(`${baseUrl()}/admin/revocation-requests`);
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** POST /admin/revocation-requests/:id/approve — Body: { note? } */
export async function approveRevocation(id: string, note?: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/revocation-requests/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ note }),
  });
  return parseJsonOrThrow(res);
}

/** POST /admin/revocation-requests/:id/reject — Body: { note? } */
export async function rejectRevocation(id: string, note?: string): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/admin/revocation-requests/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ note }),
  });
  return parseJsonOrThrow(res);
}

// ---- Documents ----

/** GET /admin/issuer-accounts/:id/documents */
export async function listIssuerDocuments(issuerAccountId: string): Promise<Array<{ docId: string; templateId: string; templateVersion: number; issuedAt: string; expiresAt: string | null; fields: Record<string, string>; createdAt: string; contentHashHex: string | null }>> {
  const res = await fetch(`${baseUrl()}/admin/issuer-accounts/${issuerAccountId}/documents`, { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

// ---- Audit log ----

/** GET /admin/audit-log?eventType=&actorType=&q=&limit= */
export async function listAuditLog(params: { eventType?: string; actorType?: string; q?: string; limit?: number }): Promise<AuditLogEntry[]> {
  const url = new URL(`${baseUrl()}/admin/audit-log`);
  if (params.eventType) url.searchParams.set('eventType', params.eventType);
  if (params.actorType) url.searchParams.set('actorType', params.actorType);
  if (params.q) url.searchParams.set('q', params.q);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

// ---- Trust manifest ----

/** GET /admin/manifest-draft?validityDays= — builds a correct unsigned manifest from the live database. */
export async function fetchManifestDraft(validityDays?: number): Promise<{ draft: unknown; notes: string[] }> {
  const url = new URL(`${baseUrl()}/admin/manifest-draft`);
  if (validityDays) url.searchParams.set('validityDays', String(validityDays));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** POST /manifest — publishes an already offline-signed manifest ({ payload, signature }). */
export async function publishSignedManifest(signedManifest: unknown): Promise<{ message: string }> {
  const res = await fetch(`${baseUrl()}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(signedManifest),
  });
  return parseJsonOrThrow(res);
}

/** GET /admin/audit-log/verify-chain */
export async function verifyAuditChain(): Promise<{ intact: boolean; totalEntries: number; brokenAt?: { id: string; eventType: string; createdAt: string } }> {
  const res = await fetch(`${baseUrl()}/admin/audit-log/verify-chain`, { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

export { ApiError };
