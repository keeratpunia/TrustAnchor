/**
 * auditLog.ts — append-only, HASH-CHAINED record of sensitive portal
 * actions.
 * ============================================================================
 * Not a security boundary by itself — a compromised backend could still
 * write false entries as they happen. What the hash chain adds is
 * TAMPER-EVIDENCE for the historical record: once written, if anyone
 * edits a row directly in the database later (not through this service),
 * recomputing the chain from the start will no longer match the stored
 * hashes from that point forward — see schema.prisma's AuditLogEntry
 * model header for the full mechanics. This is exactly the property a
 * real institution eventually needs: "prove to us nothing in this log was
 * quietly altered after the fact."
 *
 * KNOWN LIMITATION, stated plainly rather than glossed over: computing
 * "the previous entry's hash" and writing the new one are not wrapped in
 * a database-level lock here, so two writes landing at EXACTLY the same
 * instant could theoretically read the same "latest" entry and produce
 * two entries chained to the same predecessor. Low-risk at this
 * application's actual write volume (occasional admin/issuer actions, not
 * high-frequency concurrent writes), but worth knowing before assuming
 * this chain is airtight under heavy concurrency.
 */
import { createHash } from 'crypto';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

export interface AuditLogParams {
  eventType: string;
  actorType: 'ISSUER' | 'ADMIN';
  actorId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * The one hashing rule both writing and verifying must agree on exactly —
 * kept in this single function so there's no way for the two to drift
 * apart from each other.
 */
function computeEntryHash(params: {
  previousHash: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: unknown;
  createdAt: Date;
}): string {
  const material = [
    params.previousHash ?? '',
    params.eventType,
    params.actorType,
    params.actorId ?? '',
    JSON.stringify(params.payload ?? null),
    params.createdAt.toISOString(),
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const latest = await prisma.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' } });
    const createdAt = new Date();
    const payload = params.payload ?? null;
    const entryHash = computeEntryHash({
      previousHash: latest?.entryHash ?? null,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      payload,
      createdAt,
    });

    await prisma.auditLogEntry.create({
      data: {
        eventType: params.eventType,
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        payload: payload ?? undefined,
        ip: params.ip ?? null,
        createdAt,
        previousHash: latest?.entryHash ?? null,
        entryHash,
      },
    });
  } catch (err) {
    // An audit-log write failing must never break the actual request it's
    // describing — log the failure loudly and move on, rather than
    // throwing and turning a successful login/approval into a 500.
    logger.error('Failed to write audit log entry', { eventType: params.eventType, error: (err as Error).message });
  }
}

export interface AuditChainVerification {
  intact: boolean;
  totalEntries: number;
  /** The first entry (in chronological order) whose stored hash didn't match what recomputation produced, if any. */
  brokenAt?: { id: string; eventType: string; createdAt: Date };
}

/**
 * Recomputes the entire hash chain from the first entry ever written and
 * compares it against what's actually stored — the operation an admin
 * runs to prove (or disprove) that nothing in the log has been quietly
 * altered since it was written.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const entries = await prisma.auditLogEntry.findMany({ orderBy: { createdAt: 'asc' } });

  let expectedPreviousHash: string | null = null;
  for (const entry of entries) {
    const recomputed = computeEntryHash({
      previousHash: expectedPreviousHash,
      eventType: entry.eventType,
      actorType: entry.actorType,
      actorId: entry.actorId,
      payload: entry.payload,
      createdAt: entry.createdAt,
    });

    if (entry.previousHash !== expectedPreviousHash || entry.entryHash !== recomputed) {
      return {
        intact: false,
        totalEntries: entries.length,
        brokenAt: { id: entry.id, eventType: entry.eventType, createdAt: entry.createdAt },
      };
    }

    expectedPreviousHash = entry.entryHash;
  }

  return { intact: true, totalEntries: entries.length };
}
