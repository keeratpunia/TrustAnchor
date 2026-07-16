/**
 * prisma.ts — Prisma Client singleton.
 *
 * Exports a single shared PrismaClient instance for the whole server
 * process. Creating more than one PrismaClient per process is a common
 * source of connection-pool exhaustion in Node servers under load; a
 * module-level singleton, imported everywhere a database call is needed,
 * avoids that entirely.
 */
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';

export const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});
