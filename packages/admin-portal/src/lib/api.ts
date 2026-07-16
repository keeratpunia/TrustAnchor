/**
 * api.ts — thin client for packages/backend/src/routes/v2/templates.ts.
 * ============================================================================
 * Zero new backend endpoints exist for this app. Every function here maps
 * to exactly one already-existing route; this file adds no server-side
 * behavior, only a typed, ergonomic way to call what's already there.
 *
 * AUTH NOTE: these endpoints are protected by templatesAuth.ts's
 * requireTemplateWriteAuth, which accepts EITHER an ACTIVE issuer's own
 * session OR an admin's — so this file must check for BOTH, preferring
 * the issuer session when both happen to be present (mirroring the
 * backend's own preference order exactly). A previous version of this
 * file only ever checked the admin session, which meant every one of
 * these calls silently sent no Authorization header at all when made by a
 * logged-in issuer — not a config problem, a real bug, now fixed.
 */
import { loadSettings } from './settings';
import { loadAdminSession, loadIssuerSession } from './auth';
import { BoundingBox, TemplateDetail, TemplateLayout } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function authHeaders(): Record<string, string> {
  const issuerSession = loadIssuerSession();
  if (issuerSession) return { Authorization: `Bearer ${issuerSession.token}` };
  const adminSession = loadAdminSession();
  if (adminSession) return { Authorization: `Bearer ${adminSession.token}` };
  return {};
}

function baseUrl(): string {
  return loadSettings().backendUrl.replace(/\/+$/, '');
}

export async function parseJsonOrThrow(res: Response): Promise<any> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body (e.g. a proxy's plain-text 502 page) still needs to
    // produce a useful error below, not a raw parse-failure crash.
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'UNKNOWN_ERROR', body?.error ?? body?.message ?? `Request failed with HTTP ${res.status}.`);
  }
  return body;
}

/** POST /v2/templates — create or update a template's core layout. */
export async function createTemplate(params: {
  templateId: string;
  version: number;
  issuerId: string;
  name: string;
  layoutJson: TemplateLayout;
  /** The uploaded reference photo, stored as the template's actual printed background (see backend's schema.prisma comment on Template.backgroundImageBytes). Optional for backward compatibility. */
  backgroundImage?: Blob;
}): Promise<{ templateId: string; version: number; templateHash: string }> {
  const form = new FormData();
  form.append('templateId', params.templateId);
  form.append('version', String(params.version));
  form.append('issuerId', params.issuerId);
  form.append('name', params.name);
  form.append('layoutJson', JSON.stringify(params.layoutJson));
  if (params.backgroundImage) {
    form.append('backgroundImage', params.backgroundImage, 'reference.jpg');
  }
  const res = await fetch(`${baseUrl()}/v2/templates`, {
    method: 'POST',
    headers: authHeaders(), // no Content-Type — fetch sets the multipart boundary itself
    body: form,
  });
  return parseJsonOrThrow(res);
}

/** POST /v2/templates/:templateId/:version/ocr-zones — declare one OCR zone. */
export async function declareOcrZone(
  templateId: string,
  version: number,
  params: { fieldName: string; boundingBox: BoundingBox; languages: string[]; isMandatory: boolean }
): Promise<{ fieldName: string }> {
  const res = await fetch(`${baseUrl()}/v2/templates/${templateId}/${version}/ocr-zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

/**
 * POST /v2/templates/:templateId/:version/photo-zones — declares where a
 * PER-DOCUMENT dynamic image (e.g. a student's own photo) goes. See
 * lib/types.ts's PhotoZoneDraft for why this is separate from OCR zones.
 */
export async function declarePhotoZone(
  templateId: string,
  version: number,
  params: { fieldName: string; boundingBox: BoundingBox; isMandatory: boolean; matchByField: string }
): Promise<{ fieldName: string }> {
  const res = await fetch(`${baseUrl()}/v2/templates/${templateId}/${version}/photo-zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(res);
}

/** POST /v2/templates/:templateId/:version/assets — upload one reference asset. */
export async function uploadAsset(
  templateId: string,
  version: number,
  params: { assetName: string; boundingBox: BoundingBox; isMandatory: boolean; file: Blob; fileName: string }
): Promise<{ assetName: string; contentHash: string }> {
  const form = new FormData();
  form.append('file', params.file, params.fileName);
  form.append('assetName', params.assetName);
  form.append('boundingBox', JSON.stringify(params.boundingBox));
  form.append('isMandatory', String(params.isMandatory));

  const res = await fetch(`${baseUrl()}/v2/templates/${templateId}/${version}/assets`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return parseJsonOrThrow(res);
}

/** GET /v2/templates/:templateId/:version — fetch a template's full configuration. */
export async function getTemplate(templateId: string, version: number): Promise<TemplateDetail> {
  const res = await fetch(`${baseUrl()}/v2/templates/${templateId}/${version}`);
  return parseJsonOrThrow(res);
}

/** GET /health — used by the connection check in Settings. */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
