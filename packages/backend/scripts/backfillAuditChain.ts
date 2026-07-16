/**
 * backfillAuditChain.ts — ONE-OFF script.
 * ============================================================================
 * Run this exactly once, after adding entryHash/previousHash to the
 * AuditLogEntry model on a database that already had rows in audit_log
 * before those columns existed. It computes a genuine hash chain for
 * every existing row, in chronological order, using the EXACT SAME
 * hashing rule as services/auditLog.ts's computeEntryHash — so the chain
 * this produces is real, not a placeholder, and every write from this
 * point forward (via writeAuditLog) continues it correctly.
 *
 * Usage (from packages/backend):
 *   npx ts-node scripts/backfillAuditChain.ts
 *
 * Safe to run more than once — it always recomputes the whole chain from
 * scratch and overwrites previousHash/entryHash, never touches any other
 * column.
 */
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  const entries = await prisma.auditLogEntry.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`Found ${entries.length} existing audit log entries. Backfilling hash chain...`);

  let previousHash: string | null = null;
  for (const entry of entries) {
    const entryHash = computeEntryHash({
      previousHash,
      eventType: entry.eventType,
      actorType: entry.actorType,
      actorId: entry.actorId,
      payload: entry.payload,
      createdAt: entry.createdAt,
    });

    await prisma.auditLogEntry.update({
      where: { id: entry.id },
      data: { previousHash, entryHash },
    });

    console.log(`  ✔ ${entry.eventType} (${entry.createdAt.toISOString()}) -> ${entryHash.slice(0, 12)}...`);
    previousHash = entryHash;
  }

  console.log(`\nDone. All ${entries.length} entries now have a real, verifiable hash chain.`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());