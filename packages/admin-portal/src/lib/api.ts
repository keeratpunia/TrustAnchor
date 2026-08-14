/**
 * api.ts — thin client for packages/backend/src/routes/v2/templates.ts.
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
    // A non-JSON body still needs to produce a useful error.
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'UNKNOWN_ERROR', body?.error ?? body?.message ?? `Request failed with HTTP ${res.status}.`);
  }
  return body;
}

/** POST /v2/templates */
export async function createTemplate(params: {
  templateId: string;
  version: number;
  issuerId: string;
  name: string;
  layoutJson: TemplateLayout;
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
    headers: authHeaders(),
    body: form,
  });
  return parseJsonOrThrow(res);
}

/** POST /v2/templates/:templateId/:version/ocr-zones */
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

/** POST /v2/templates/:templateId/:version/photo-zones */
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

/** POST /v2/templates/:templateId/:version/assets */
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

/** GET /v2/templates/:templateId/:version */
export async function getTemplate(templateId: string, version: number): Promise<TemplateDetail> {
  const res = await fetch(`${baseUrl()}/v2/templates/${templateId}/${version}`);
  return parseJsonOrThrow(res);
}

/**
 * GET /v2/templates/my — lists all templates belonging to the currently
 * logged-in issuer. Used by the template picker on the batch/single
 * issuance page so issuers never need to know or type a UUID.
 */
export interface TemplateSummary {
  templateId: string;
  version: number;
  name: string;
  templateHash: string;
  hasBackgroundImage: boolean;
  ocrZoneCount: number;
}
export async function listMyTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch(`${baseUrl()}/v2/templates/my`, { headers: authHeaders() });
  return parseJsonOrThrow(res);
}

/** GET /health */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
