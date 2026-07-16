/**
 * settings.ts — where this app finds the backend.
 * ============================================================================
 * This is a standalone static web app (a separate origin from the
 * backend), so unlike the mobile verifier app it can't derive the
 * backend's address from a bundler dev-server connection. Instead it asks
 * once, in Settings, and remembers the answer in localStorage.
 *
 * WHO you are is handled entirely by real login now (lib/auth.ts,
 * lib/adminApi.ts, lib/issuerApi.ts) — this file used to also store a
 * shared ingestion API key pasted into Settings; that's gone. The backend
 * still accepts that legacy key as a fallback for other tooling (see
 * templatesAuth.ts), but this app never sends it anymore.
 */

const STORAGE_KEY = 'trustanchor_admin_settings';

export interface AdminSettings {
  backendUrl: string;
}

const DEFAULTS: AdminSettings = {
  backendUrl: 'http://localhost:4000',
};

export function loadSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: AdminSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isConfigured(settings: AdminSettings): boolean {
  return settings.backendUrl.trim().length > 0;
}
