/**
 * revocation.ts — GET /revocation.
 *
 * ============================================================================
 * CRITICAL SCOPE NOTE — READ BEFORE MODIFYING OR CALLING THIS ENDPOINT:
 * ============================================================================
 * Per the Frozen Architecture Specification, revocation is NOT a separate
 * signed artifact (§9: "Revocation is a field inside the Trust Manifest —
 * `revoked_docs`. There is no separate revocation artifact, no separate
 * signing key for it, and no separate freshness pipeline."). Introducing a
 * second independently-versioned signed object here would reintroduce
 * exactly the cross-artifact consistency problem the frozen design
 * eliminated by merging revocation into the one Trust Manifest (§18,
 * "Epoch bundle / multi-artifact consistency protocol" — removed for
 * precisely this reason).
 *
 * This endpoint exists ONLY because the required API surface for this
 * implementation explicitly lists `GET /revocation`. It is a **read-only,
 * derived, convenience view** of the SAME signed manifest's
 * `payload.revoked_docs` array — nothing more. It is useful for:
 *   - a quick human-readable revocation check (e.g. a support dashboard)
 *   - external tooling that only cares about revocation, not the full
 *     issuer/key registry
 *
 * Engine 1's actual verification algorithm (Frozen Spec §14, step 9) does
 * **NOT** call this endpoint. It checks `manifest.revoked_docs` directly
 * from the SAME already-fetched, already-signature-verified manifest object
 * obtained from GET /manifest during steps 2–4 of that same algorithm run.
 * See verifier-app/src/engine1/engine1.ts — there is no second network call
 * to this endpoint anywhere in the verification path.
 *
 * Consequently: this endpoint's response is NOT independently signed, and
 * MUST NOT be treated as an authoritative trust decision by anything that
 * cares about the cryptographic guarantees this system provides. Anything
 * consuming this endpoint for a real trust decision should instead fetch
 * GET /manifest and perform the full verification in Frozen Spec §14.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { ApiError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { logger } from '../utils/logger';

export const revocationRouter = Router();

/**
 * GET /revocation
 * Returns the revoked document list and issuer statuses exactly as they
 * currently appear inside the signed Trust Manifest — a plain, unsigned,
 * convenience JSON view. See file header for the critical scope note before
 * using this for anything security-relevant.
 */
revocationRouter.get('/revocation', asyncHandler(async (req: Request, res: Response) => {
  const row = await prisma.currentManifest.findUnique({ where: { id: 1 } });

  if (!row) {
    throw new ApiError(404, 'No trust manifest has been published yet.', 'NO_MANIFEST');
  }

  const manifest = row.manifestBlob as any;

  logger.debug('Served revocation convenience view');

  res.json({
    // Explicit reminder in the response body itself, so any consumer
    // inspecting the payload (not just the source code) sees the scope note.
    _note:
      'This is a derived, UNSIGNED convenience view of the current Trust Manifest\'s revocation data. It is not an authoritative trust decision. See GET /manifest and the Engine 1 verification algorithm for the actual cryptographic revocation check.',
    manifest_version: manifest.payload.version,
    generated_at: manifest.payload.generated_at,
    valid_until: manifest.payload.valid_until,
    revoked_docs: manifest.payload.revoked_docs,
    issuer_statuses: manifest.payload.issuers.map((i: any) => ({
      issuer_id: i.issuer_id,
      issuer_name: i.issuer_name,
      status: i.status,
    })),
  });
}));
