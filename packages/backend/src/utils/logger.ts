/**
 * logger.ts — minimal structured logger.
 *
 * A small, dependency-free logger rather than pulling in a logging
 * framework (Winston, Pino, etc.). This server's logging needs are simple
 * (timestamped, leveled, structured console output) and a hand-written
 * implementation keeps the dependency surface — and therefore the
 * supply-chain risk — smaller, which matters more than usual for a system
 * whose entire value proposition is being auditable end-to-end.
 */
import { config } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.logLevel];
}

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) console.debug(format('debug', message, meta));
  },
  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) console.info(format('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) console.warn(format('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) console.error(format('error', message, meta));
  },
};
