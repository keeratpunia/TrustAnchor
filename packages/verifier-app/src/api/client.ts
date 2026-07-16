/**
 * client.ts — thin fetch wrapper for talking to the Verification Server.
 *
 * Adds a timeout (React Native's fetch has no built-in timeout option) so
 * that a hung network request surfaces as a NETWORK_ERROR verdict (Frozen
 * Spec §15) rather than leaving the user staring at a spinner forever.
 */
import { API_BASE_URL, REQUEST_TIMEOUT_MS, ENGINE2_REQUEST_TIMEOUT_MS } from '../config';
import { Engine1Result } from '../engine1/types';
import { Engine2VerifyResponse } from '../engine2/types';

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * A well-formed error response FROM the backend (e.g. document revoked,
 * template not configured, engine2-service down) — distinct from
 * NetworkError, which means the request never got a response at all.
 * Carries the HTTP status and the backend's own error `code` so the UI
 * can show a specific, accurate message rather than a generic failure.
 */
export class Engine2ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'Engine2ApiError';
    this.status = status;
    this.code = code;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch (err) {
    throw new NetworkError(`Request to ${url} failed or timed out: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches the current Trust Manifest (GET /manifest). Throws NetworkError on failure. */
export async function fetchManifest(): Promise<unknown> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/manifest`, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    throw new NetworkError(`GET /manifest returned HTTP ${res.status}`);
  }
  return res.json();
}

/** Fetches a credential payload by doc_id (GET /credential/:docId). Throws NetworkError on failure. */
export async function fetchCredential(docId: string): Promise<unknown> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/credential/${docId}`, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    throw new NetworkError(`GET /credential/${docId} returned HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Uploads a captured document photo for Engine 2 forensic verification
 * (POST /v2/verify/:docId). `engine1Result` is sent as-is — it's the
 * SAME result this device's own Engine 1 run already produced (see
 * verify.ts's header for why the server accepts a client-self-reported
 * Engine 1 result: a client lying about its own Engine 1 run only ever
 * defrauds that same client, since Engine 1's actual cryptographic
 * guarantee already happened on-device before this call).
 *
 * Uses a longer timeout than fetchWithTimeout's default — Engine 2's
 * pipeline (image alignment, OCR, template/asset matching) genuinely
 * takes a few seconds, unlike the lightweight manifest/credential GETs.
 *
 * @throws NetworkError if the request never completes (no connectivity,
 *   timeout, DNS failure, etc).
 * @throws Engine2ApiError if the backend responds with a non-2xx status
 *   (e.g. 409 DOCUMENT_REVOKED, 404 TEMPLATE_NOT_CONFIGURED, 502
 *   ENGINE2_SERVICE_ERROR) — these are real, well-formed answers from the
 *   server, not connectivity failures, so they're modeled distinctly.
 */
export async function postVerifyEngine2(
  docId: string,
  photoUri: string,
  engine1Result: Engine1Result
): Promise<Engine2VerifyResponse> {
  const form = new FormData();
  // React Native's FormData recognizes this { uri, name, type } shape
  // specially and streams the file from disk — this is NOT a browser
  // File/Blob object, and does not need to be one.
  form.append('photo', {
    uri: photoUri,
    name: 'document.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  form.append('engine1Result', JSON.stringify(engine1Result));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE2_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/v2/verify/${docId}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      // Deliberately NOT setting a Content-Type header — fetch computes
      // the multipart boundary itself from the FormData body; setting one
      // manually strips that boundary and breaks the upload silently.
    });
  } catch (err) {
    throw new NetworkError(`POST /v2/verify/${docId} failed or timed out: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new NetworkError(`POST /v2/verify/${docId} returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Engine2ApiError(res.status, body?.code ?? 'UNKNOWN_ERROR', body?.error ?? `Request failed with HTTP ${res.status}.`);
  }

  return body as Engine2VerifyResponse;
}