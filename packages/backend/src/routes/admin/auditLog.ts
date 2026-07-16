/**
 * auditLog.ts (route) — GET /admin/audit-log, GET /admin/audit-log/verify-chain
 * Read-only view over the append-only audit_log table, plus tamper-evidence verification.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAdminSession } from '../../middleware/adminSessionAuth';
import { verifyAuditChain } from '../../services/auditLog';

export const adminAuditLogRouter = Router();

/** GET /admin/audit-log?eventType=&actorType=&q=&limit= */
adminAuditLogRouter.get(
  '/admin/audit-log',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const { eventType, actorType, q } = req.query as { eventType?: string; actorType?: string; q?: string };
    const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);

    const entries = await prisma.auditLogEntry.findMany({
      where: {
        ...(eventType ? { eventType } : {}),
        ...(actorType ? { actorType } : {}),
        ...(q
          ? {
              OR: [
                { eventType: { contains: q, mode: 'insensitive' as const } },
                { actorId: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json(entries);
  })
);

/**
 * GET /admin/audit-log/verify-chain
 * Recomputes the entire hash chain from the first entry ever written and
 * reports whether it's intact — see services/auditLog.ts's
 * verifyAuditChain for exactly what this does and doesn't prove.
 */
adminAuditLogRouter.get(
  '/admin/audit-log/verify-chain',
  requireAdminSession,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await verifyAuditChain();
    res.json(result);
  })
);
