/**
 * recentTemplates.ts — a locally-remembered list of templates created or
 * viewed from this browser.
 * ============================================================================
 * WHY THIS EXISTS: the backend's templates API (templates.ts) has no
 * "list all templates" endpoint — only GET /v2/templates/:id/:version, a
 * lookup by exact key. That's a deliberate, minimal API surface (the
 * roadmap item this app fulfills is "template upload," not "template
 * listing"), not an oversight this app should silently paper over by
 * pretending to be backed by a real server-side list. This is exactly
 * what it looks like: a per-browser convenience so an admin doesn't have
 * to retype a UUID they created five minutes ago, nothing more. The
 * Dashboard's copy says so explicitly, and the Look Up form is the actual
 * source of truth for anything not remembered here.
 */
import { RecentTemplateEntry } from './types';

const STORAGE_KEY = 'trustanchor_admin_recent_templates';
const MAX_ENTRIES = 25;

export function loadRecentTemplates(): RecentTemplateEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberTemplate(entry: RecentTemplateEntry): void {
  const existing = loadRecentTemplates().filter(
    (t) => !(t.templateId === entry.templateId && t.version === entry.version)
  );
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function forgetTemplate(templateId: string, version: number): void {
  const updated = loadRecentTemplates().filter((t) => !(t.templateId === templateId && t.version === version));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
