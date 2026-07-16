/**
 * manifestDraft.ts — GET /admin/manifest-draft.
 * ============================================================================
 * WHY THIS EXISTS: publishing the trust manifest used to mean hand-editing
 * a JSON file to match whatever's actually in the database — genuinely
 * error-prone (miss an active issuer, forget a revocation, or just let
 * `valid_until` quietly expire because nobody remembered to refresh it —
 * exactly what happened the first time this was tried for real). This
 * endpoint builds the CORRECT unsigned manifest payload directly from the
 * live IssuerAccount and RevocationRequest tables, so there's nothing left
 * to hand-craft — only to review, sign offline, and publish.
 *
 * This does NOT sign anything (see offline-signer/src/signManifest.ts for
 * why that step must stay offline) — it only assembles the payload an
 * admin then runs `offline-signer sign-manifest` against.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';

export const adminManifestDraftRouter = Router();

const DEFAULT_VALIDITY_DAYS = 30;

/**
 * GET /admin/manifest-draft?validityDays=30
 * Returns an unsigned ManifestPayload: every ACTIVE (or KEY_ROTATION_PENDING
 * — a pending rotation doesn't revoke the issuer's current key, see the
 * workflow report's §3.2) issuer account's real issuerId/publicKeyHex, plus
 * every APPROVED revocation request's doc_id, plus a fresh valid_until
 * window starting now.
 */
adminManifestDraftRouter.get(
  '/admin/manifest-draft',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const validityDays = Math.max(1, parseInt((req.query.validityDays as string) ?? String(DEFAULT_VALIDITY_DAYS), 10) || DEFAULT_VALIDITY_DAYS);

    const [activeIssuers, approvedRevocations, currentManifestRow] = await Promise.all([
      prisma.issuerAccount.findMany({
        where: { status: { in: ['ACTIVE', 'KEY_ROTATION_PENDING'] }, issuerId: { not: null }, publicKeyHex: { not: null } },
      }),
      prisma.revocationRequest.findMany({ where: { status: 'APPROVED' } }),
      prisma.currentManifest.findUnique({ where: { id: 1 } }),
    ]);

    const currentVersion = currentManifestRow ? ((currentManifestRow.manifestBlob as any)?.payload?.version ?? 0) : 0;

    const now = new Date();
    const validUntil = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

    const draft = {
      version: currentVersion + 1,
      generated_at: now.toISOString(),
      valid_until: validUntil.toISOString(),
      issuers: activeIssuers.map((a: { issuerId: string | null; institutionName: string; publicKeyHex: string | null }) => ({
        issuer_id: a.issuerId,
        issuer_name: a.institutionName,
        status: 'active',
        keys: [
          {
            public_key: a.publicKeyHex,
            valid_from: '2025-01-01T00:00:00Z', // conservative default — nothing tracks the actual key-activation moment yet
            valid_until: null,
          },
        ],
      })),
      revoked_docs: approvedRevocations.map((r: { docId: string }) => r.docId),
    };

    res.json({
      draft,
      notes: [
        `${activeIssuers.length} active issuer(s) included.`,
        `${approvedRevocations.length} revoked document(s) included.`,
        `Version ${draft.version} (previous published version: ${currentVersion}).`,
        `Valid for ${validityDays} day(s) from now — republish before it expires, or verifiers will refuse to trust it (exactly the "stale trust data" failure this endpoint exists to prevent recurring).`,
      ],
    });
  })
);
