/**
 * errorHandler.ts — centralized Express error-handling middleware.
 *
 * WHY ERRORS ARE HANDLED CENTRALLY AND SANITIZED BEFORE LEAVING THE SERVER:
 *
 * This server is explicitly designed to be safe even if fully compromised
 * (Frozen Spec §1) — but "safe if compromised" is a design property of the
 * cryptographic protocol, not an excuse to be careless about what an
 * ordinary, non-compromised deployment leaks in its error responses.
 * Stack traces, raw database error messages, and internal file paths are
 * useful to a developer reading server logs and are not useful — and are a
 * minor information-disclosure risk — to a client on the other end of an
 * HTTP request. This middleware logs the full error detail server-side and
 * returns a minimal, safe JSON error object to the client.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/** A typed application error with an explicit HTTP status code. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 404 handler — placed after all routes, before the error handler. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', path: req.path });
}

/**
 * The final error-handling middleware. Express recognizes this as an error
 * handler specifically because it declares four parameters (err, req, res,
 * next) — this is an Express convention, not optional boilerplate.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (err instanceof ApiError) {
    logger.warn('Handled API error', {
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
    });
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  // Unexpected error: log full detail server-side, return a generic message
  // to the client. Never forward `err.stack` or raw error objects in the
  // HTTP response.
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    message,
    stack,
  });

  res.status(500).json({ error: 'Internal server error' });
}
