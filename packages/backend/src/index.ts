/**
 * index.ts — server entry point. Binds the Express app (app.ts) to a TCP
 * port. This is the only file that actually starts a listening server;
 * everything else is composable and independently testable.
 */
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`TrustAnchor backend listening on port ${config.port}`, {
    nodeEnv: config.nodeEnv,
    port: config.port,
  });
  logger.info('Reminder: this server holds no signing key of any kind (Frozen Spec §5). All signing happens offline via @trustanchor/offline-signer.');
});
