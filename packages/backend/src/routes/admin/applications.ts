/**
 * applications.ts — admin review of issuer applications and key publishing.
 * ============================================================================
 * GET  /admin/issuer-accounts                       — list all, any status
 * POST /admin/issuer-accounts/:id/approve            — PENDING -> APPROVED_NO_KEY
 * POST /admin/issuer-accounts/:id/reject              — PENDING -> REJECTED
 * POST /admin/issuer-accounts/:id/publish-key         — APPROVED_NO_KEY -> ACTIVE
 * POST /admin/issuer-accounts/:id/suspend             — (any) -> SUSPENDED
 *
 * WHAT "publish-key" DOES AND DOES NOT DO — read this before touching it:
 * This endpoint records a public key hex the issuer generated themselves
 * (offline, on a YubiKey or the software test-key path — see
 * offline-signer/src/keySigner.ts) and flips the account to ACTIVE so the
 * PORTAL's own UI shows the issuer as ready to issue. It does NOT, by
 * itself, make any verifier trust that key — that only happens once an
 * admin separately runs the existing offline manifest-signing ceremony
 * (offline-signer sign-manifest) and uploads the result via the existing
 * POST /manifest. This endpoint is bookkeeping for the portal's UI, not a
 * new trust boundary — see this section's header comment in schema.prisma.
 */
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { CredentialPayload, credentialContentHash } from '@trustanchor/shared';
import { prisma } from '../../db/prisma';
import { ApiError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';
import { isNonEmptyString, isEd25519PublicKeyHex, validateUuidParam } from '../../middleware/validation';
import { writeAuditLog } from '../../services/auditLog';

export const adminApplicationsRouter = Router();

/** GET /admin/issuer-accounts?status=PENDING — list issuer accounts, optionally filtered. */
adminApplicationsRouter.get(
  '/admin/issuer-accounts',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const accounts = await prisma.issuerAccount.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      accounts.map((a: { id: string; institutionName: string; email: string; status: string; issuerId: string | null; publicKeyHex: string | null; pendingPublicKeyHex: string | null; keySource: string | null; createdAt: Date; approvedAt: Date | null; rejectionReason: string | null; suspensionReason: string | null }) => ({
        id: a.id,
        institutionName: a.institutionName,
        email: a.email,
        status: a.status,
        issuerId: a.issuerId,
        publicKeyHex: a.publicKeyHex,
        pendingPublicKeyHex: a.pendingPublicKeyHex,
        keySource: a.keySource,
        createdAt: a.createdAt,
        approvedAt: a.approvedAt,
        rejectionReason: a.rejectionReason,
        suspensionReason: a.suspensionReason,
      }))
    );
  })
);

async function findAccountOr404(id: string) {
  const account = await prisma.issuerAccount.findUnique({ where: { id } });
  if (!account) throw new ApiError(404, `No issuer account found for id ${id}.`, 'ISSUER_ACCOUNT_NOT_FOUND');
  return account;
}

/** POST /admin/issuer-accounts/:id/approve */
adminApplicationsRouter.post(
  '/admin/issuer-accounts/:id/approve',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const account = await findAccountOr404(req.params.id);
    if (account.status !== 'PENDING') {
      throw new ApiError(400, `Only a PENDING application can be approved (current status: ${account.status}).`, 'INVALID_STATE');
    }

    const updated = await prisma.issuerAccount.update({
      where: { id: account.id },
      data: { status: 'APPROVED_NO_KEY', approvedAt: new Date() },
    });

    await writeAuditLog({
      eventType: 'ISSUER_APPLICATION_APPROVED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { issuerAccountId: account.id, institutionName: account.institutionName },
      ip: req.ip,
    });

    res.json({
      message: `"${account.institutionName}" approved. They'll be prompted to generate a signing key next.`,
      id: updated.id,
      status: updated.status,
    });
  })
);

/** POST /admin/issuer-accounts/:id/reject — Body: { reason } */
adminApplicationsRouter.post(
  '/admin/issuer-accounts/:id/reject',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason?: string };
    if (!isNonEmptyString(reason)) {
      throw new ApiError(400, 'A rejection reason is required.', 'INVALID_BODY');
    }

    const account = await findAccountOr404(req.params.id);
    if (account.status !== 'PENDING') {
      throw new ApiError(400, `Only a PENDING application can be rejected (current status: ${account.status}).`, 'INVALID_STATE');
    }

    const updated = await prisma.issuerAccount.update({
      where: { id: account.id },
      data: { status: 'REJECTED', rejectionReason: reason.trim() },
    });

    await writeAuditLog({
      eventType: 'ISSUER_APPLICATION_REJECTED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { issuerAccountId: account.id, reason: reason.trim() },
      ip: req.ip,
    });

    res.json({ message: 'Application rejected.', id: updated.id, status: updated.status });
  })
);

/**
 * POST /admin/issuer-accounts/:id/publish-key
 * Body: { publicKeyHex, keySource, issuerId? }
 * See this file's header for exactly what this does and does not mean.
 * `issuerId` lets the admin link this to a specific manifest issuer_id —
 * if omitted, one is generated, matching what will be used the next time
 * this issuer is included in a signed manifest.
 */
adminApplicationsRouter.post(
  '/admin/issuer-accounts/:id/publish-key',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { publicKeyHex, keySource, issuerId } = req.body as {
      publicKeyHex?: string;
      keySource?: string;
      issuerId?: string;
    };

    if (!isEd25519PublicKeyHex(publicKeyHex)) {
      throw new ApiError(400, 'publicKeyHex must be a 64-character hex Ed25519 public key.', 'INVALID_BODY');
    }
    if (keySource !== 'yubikey' && keySource !== 'software_test_key') {
      throw new ApiError(400, 'keySource must be exactly "yubikey" or "software_test_key".', 'INVALID_BODY');
    }

    const account = await findAccountOr404(req.params.id);
    if (account.status !== 'APPROVED_NO_KEY' && account.status !== 'KEY_ROTATION_PENDING') {
      throw new ApiError(
        400,
        `A key can only be published for an account that is APPROVED_NO_KEY or has a pending rotation (current status: ${account.status}).`,
        'INVALID_STATE'
      );
    }

    const resolvedIssuerId = account.issuerId ?? issuerId ?? crypto.randomUUID();

    const updated = await prisma.issuerAccount.update({
      where: { id: account.id },
      data: { status: 'ACTIVE', issuerId: resolvedIssuerId, publicKeyHex, keySource },
    });

    // Administrative/display-only mirror table — same one Engine 1's own
    // schema comment describes as "never trusted by a verifier." Kept in
    // sync here purely so the rest of the portal has a consistent place to
    // look up "issuers that exist," matching the pre-existing convention.
    await prisma.issuer.upsert({
      where: { issuerId: resolvedIssuerId },
      create: { issuerId: resolvedIssuerId, issuerName: account.institutionName, status: 'active' },
      update: { issuerName: account.institutionName, status: 'active' },
    });

    await writeAuditLog({
      eventType: 'ISSUER_KEY_PUBLISHED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { issuerAccountId: account.id, issuerId: resolvedIssuerId, keySource, publicKeyPrefix: publicKeyHex.slice(0, 12) },
      ip: req.ip,
    });

    res.json({
      message:
        'Key recorded and account marked ACTIVE. Remember: this issuer is not yet trusted by any verifier until you also ' +
        'publish a new signed Trust Manifest that includes this public key (offline-signer sign-manifest -> POST /manifest).',
      id: updated.id,
      status: updated.status,
      issuerId: updated.issuerId,
    });
  })
);

/** POST /admin/issuer-accounts/:id/suspend — Body: { reason } */
adminApplicationsRouter.post(
  '/admin/issuer-accounts/:id/suspend',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason?: string };
    if (!isNonEmptyString(reason)) {
      throw new ApiError(400, 'A suspension reason is required.', 'INVALID_BODY');
    }

    const account = await findAccountOr404(req.params.id);
    const updated = await prisma.issuerAccount.update({
      where: { id: account.id },
      data: { status: 'SUSPENDED', suspensionReason: reason.trim() },
    });

    if (account.issuerId) {
      await prisma.issuer.updateMany({ where: { issuerId: account.issuerId }, data: { status: 'suspended' } });
    }

    await writeAuditLog({
      eventType: 'ISSUER_SUSPENDED',
      actorType: 'ADMIN',
      actorId: req.adminAccount!.id,
      payload: { issuerAccountId: account.id, reason: reason.trim() },
      ip: req.ip,
    });

    res.json({
      message:
        'Issuer account suspended in the portal. Remember: to actually stop a verifier from trusting this issuer, you ' +
        'must also publish an updated signed Trust Manifest marking them suspended.',
      id: updated.id,
      status: updated.status,
    });
  })
);

/**
 * GET /admin/issuer-accounts/:id/documents
 * Everything a given issuer has ever issued — so if a discrepancy ever
 * comes up later (a disputed credential, a compromised-key investigation),
 * the platform has its own independent record of what was actually
 * issued, not just whatever the issuer's own local files say.
 *
 * `contentHashHex` on each row is NOT stored anywhere (Frozen Spec §7 —
 * this server never stores a credential's signature or hash, only its raw
 * fields) — it's recomputed here, on demand, by reconstructing the exact
 * CredentialPayload shape and running it through the SAME canonical-CBOR
 * hashing function a verifier's Engine 1 uses (`@trustanchor/shared`'s
 * credentialContentHash). This gives an admin a genuine "info hash" per
 * document to compare against, without adding a stored hash/signature
 * column this project's architecture deliberately avoids.
 */
adminApplicationsRouter.get(
  '/admin/issuer-accounts/:id/documents',
  validateUuidParam('id'),
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const account = await findAccountOr404(req.params.id);
    if (!account.issuerId) {
      res.json([]);
      return;
    }

    const docs = await prisma.document.findMany({
      where: { issuerId: account.issuerId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    res.json(
      docs.map((d: { docId: string; issuerId: string; templateId: string; templateVersion: number; issuedAt: string; expiresAt: string | null; fields: unknown; assetHashes: unknown; templateHash: string; createdAt: Date }) => {
        const payload: CredentialPayload = {
          v: 1,
          issuer_id: d.issuerId,
          doc_id: d.docId,
          template_id: d.templateId,
          template_version: d.templateVersion,
          issued_at: d.issuedAt,
          expires_at: d.expiresAt,
          fields: d.fields as Record<string, string>,
          asset_hashes: d.assetHashes as Record<string, string>,
          template_hash: d.templateHash,
        };
        let contentHashHex: string | null = null;
        try {
          contentHashHex = credentialContentHash(payload).toString('hex');
        } catch {
          // A row with a shape too malformed to hash still shows up in the
          // list — just without a hash — rather than failing the whole request.
        }
        return {
          docId: d.docId,
          templateId: d.templateId,
          templateVersion: d.templateVersion,
          issuedAt: d.issuedAt,
          expiresAt: d.expiresAt,
          fields: d.fields,
          createdAt: d.createdAt,
          contentHashHex,
        };
      })
    );
  })
);