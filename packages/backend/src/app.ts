/**
 * app.ts — Express application assembly.
 *
 * Wires together CORS, JSON body parsing, the four required route groups,
 * and the centralized error handler. Kept separate from index.ts so that
 * integration tests (tests/integration/*.test.ts) can import the Express
 * app directly and drive it with supertest, without needing to actually
 * bind a TCP port.
 */
import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { manifestRouter } from './routes/manifest';
import { credentialRouter } from './routes/credential';
import { assetRouter } from './routes/asset';
import { revocationRouter } from './routes/revocation';
import { verifyRouter } from './routes/v2/verify';
import { templatesRouter } from './routes/v2/templates';
import { credentialBatchRouter } from './routes/v2/credentialBatch';
import { issuerDocumentsRouter } from './routes/v2/issuerDocuments';
import { issuerAuthRouter } from './routes/auth/issuerAuth';
import { adminAuthRouter } from './routes/auth/adminAuth';
import { adminApplicationsRouter } from './routes/admin/applications';
import { adminKeyRotationRouter } from './routes/admin/keyRotation';
import { adminAuditLogRouter } from './routes/admin/auditLog';
import { adminRevocationRequestsRouter } from './routes/admin/revocationRequests';
import { adminManifestDraftRouter } from './routes/admin/manifestDraft';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  // Bumped from the original 2mb: POST /v2/credential/batch and
  // /v2/render-pdf-batch accept up to 2000 credential entries in one
  // request (see credentialBatch.ts) — a large CSV-driven batch can
  // reasonably exceed 2mb of JSON.
  app.use(express.json({ limit: '20mb' }));

  // Lightweight request logging.
  app.use((req, res, next) => {
    logger.debug('Incoming request', { method: req.method, path: req.path });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'trustanchor-backend', timestamp: new Date().toISOString() });
  });

  // The four required API groups (Frozen Spec §21, project requirements).
  app.use(manifestRouter);
  app.use(credentialRouter);
  app.use(assetRouter);
  app.use(revocationRouter);

  // Engine 2 — purely additive, new paths under /v2/*. Zero changes to
  // any route above (Engine 1 Freeze Specification §20).
  app.use(verifyRouter);
  app.use(templatesRouter);
  app.use(credentialBatchRouter);
  app.use(issuerDocumentsRouter);

  // Portal auth & admin — purely additive, new paths under /auth/* and
  // /admin/*. No signing key of any kind is reachable from any route in
  // these routers — see routes/auth/issuerAuth.ts's header.
  app.use(issuerAuthRouter);
  app.use(adminAuthRouter);
  app.use(adminApplicationsRouter);
  app.use(adminKeyRotationRouter);
  app.use(adminAuditLogRouter);
  app.use(adminRevocationRequestsRouter);
  app.use(adminManifestDraftRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
