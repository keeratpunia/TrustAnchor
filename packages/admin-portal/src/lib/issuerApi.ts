/**
 * issuerApi.ts — client for /auth/issuer/* (packages/backend's
 * routes/auth/issuerAuth.ts). Zero new backend endpoints.
 */
import { loadSettings } from './settings';
import { loadIssuerSession, saveIssuerSession, clearIssuerSession } from './auth';
import { parseJsonOrThrow } from './api';
import { IssuerAccount, KeyRotationRequest, DocumentSummary, RevocationRequest as RevocationRequestType, SignedCredentialEntry } from './types';

function baseUrl(): string {
  return loadSettings().backendUrl.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const session = loadIssuerSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/** POST /auth/issuer/signup */
export async function issuerSignup(params: {
  institutionName: string;
  email: string;
  password: string;
}): Promise<{ message: string; issuerAccountId: string; status: string }> {
  const res = await fetch(`${baseUrl()}/auth/issuer/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

/** POST /auth/issuer/login */
export async function issuerLogin(email: string, password: string): Promise<{ token: string; issuerAccount: IssuerAccount }> {
  const res = await fetch(`${baseUrl()}/auth/issuer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJsonOrThrow(res);
  saveIssuerSession({ token: body.token, account: body.issuerAccount });
  return body;
}

export function issuerLogout(): void {
  clearIssuerSession();
}

/**
 * Re-fetches the issuer's own current status from the server (GET
 * /auth/issuer/me) — never trust the locally-cached session's status alone,
 * since an admin approval/suspension elsewhere should reflect immediately
 * on next load, not only after the JWT naturally expires.
 */
export async function fetchCurrentIssuer(): Promise<IssuerAccount | null> {
  const session = loadIssuerSession();
  if (!session) return null;
  try {
    const res = await fetch(`${baseUrl()}/auth/issuer/me`, { headers: authHeaders() });
    if (!res.ok) {
      clearIssuerSession();
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/** POST /auth/issuer/key-rotation-request — Body: { reason, password } */
export async function requestKeyRotation(reason: string, password: string): Promise<{ message: string; id: string; status: string }> {
  const res = await fetch(`${baseUrl()}/auth/issuer/key-rotation-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason, password }),
  });
  return parseJsonOrThrow(res);
}

/** GET /auth/issuer/key-rotation-status */
export async function fetchKeyRotationStatus(): Promise<KeyRotationRequest[]> {
  const res = await fetch(`${baseUrl()}/auth/issuer/key-rotation-status`, { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

// ---- Document ledger ----

/** GET /v2/issuer/documents?q= */
export async function listMyDocuments(q?: string): Promise<DocumentSummary[]> {
  const url = new URL(`${baseUrl()}/v2/issuer/documents`);
  if (q) url.searchParams.set('q', q);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** POST /v2/issuer/documents/:docId/revoke-request — Body: { reason, password } */
export async function requestRevocation(docId: string, reason: string, password: string): Promise<{ message: string; id: string }> {
  const res = await fetch(`${baseUrl()}/v2/issuer/documents/${docId}/revoke-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason, password }),
  });
  return parseJsonOrThrow(res);
}

/** GET /v2/issuer/revocation-requests */
export async function listMyRevocationRequests(): Promise<RevocationRequestType[]> {
  const res = await fetch(`${baseUrl()}/v2/issuer/revocation-requests`, { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

// ---- Batch issuance ----

/** POST /v2/credential/batch */
/**
 * Builds the shared multipart body both batch endpoints now expect:
 * an "entries" field (JSON string) plus one file per per-document photo,
 * named "photo__<docId>__<fieldName>" — see backend's credentialBatch.ts
 * header for the exact contract.
 */
function buildBatchFormData(entries: SignedCredentialEntry[], photosByDocId?: Map<string, Map<string, File>>): FormData {
  const form = new FormData();
  form.append('entries', JSON.stringify(entries));
  if (photosByDocId) {
    for (const [docId, photos] of photosByDocId) {
      for (const [fieldName, file] of photos) {
        form.append(`photo__${docId}__${fieldName}`, file, file.name);
      }
    }
  }
  return form;
}

/** POST /v2/credential/batch — multipart: entries + optional per-document photos. */
export async function ingestBatch(
  entries: SignedCredentialEntry[],
  photosByDocId?: Map<string, Map<string, File>>
): Promise<{ message: string; ingested: string[]; failed: Array<{ docId?: string; error: string }> }> {
  const res = await fetch(`${baseUrl()}/v2/credential/batch`, {
    method: 'POST',
    headers: authHeaders(), // no Content-Type — fetch sets the multipart boundary itself from the FormData body
    body: buildBatchFormData(entries, photosByDocId),
  });
  // 207 (partial success) is not `res.ok` by the fetch spec's 2xx check —
  // it IS 2xx (200-299), so res.ok is actually true for 207. No special
  // handling needed; parseJsonOrThrow only throws on a genuine non-2xx.
  return parseJsonOrThrow(res);
}

/**
 * POST /v2/render-pdf-batch — multipart, same shape as ingestBatch above.
 * Returns the raw ZIP Blob plus the parsed X-Render-Summary header, so the
 * caller can show "N rendered, N failed" without needing to inspect the
 * zip's contents.
 */
export async function renderPdfBatch(
  entries: SignedCredentialEntry[],
  photosByDocId?: Map<string, Map<string, File>>
): Promise<{ zip: Blob; summary: { renderedCount: number; failedCount: number; failed: Array<{ docId?: string; error: string }> } | null }> {
  const res = await fetch(`${baseUrl()}/v2/render-pdf-batch`, {
    method: 'POST',
    headers: authHeaders(),
    body: buildBatchFormData(entries, photosByDocId),
  });
  if (!res.ok) {
    // Error responses here are JSON, not a zip — reuse the standard path.
    await parseJsonOrThrow(res);
  }
  const summaryHeader = res.headers.get('X-Render-Summary');
  const summary = summaryHeader ? JSON.parse(decodeURIComponent(summaryHeader)) : null;
  const zip = await res.blob();
  return { zip, summary };
}
