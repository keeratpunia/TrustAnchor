/**
 * asyncHandler.ts
 * ============================================================================
 * WHY THIS FILE EXISTS — a real bug this wrapper fixes:
 * ============================================================================
 * Express 4 (which this project uses) does NOT automatically forward
 * errors thrown inside an `async` route handler to the error-handling
 * middleware. If an `async (req, res) => { ... throw new ApiError(...) }`
 * handler throws, the returned Promise simply rejects — and because
 * nothing calls `next(err)`, Express has no way to know the request failed.
 * The client's HTTP request then hangs until it times out, and
 * errorHandler.ts never runs at all.
 *
 * (Express 5 fixes this natively; this project pins Express 4 for
 * stability, so the fix must be explicit here instead.)
 *
 * This was caught directly by this project's own integration test suite —
 * several tests that expected a 400/404 response instead timed out
 * waiting for a response that was never sent, because the thrown ApiError
 * never reached errorHandler.ts. Every async route handler in this
 * codebase MUST be wrapped with `asyncHandler` for its errors to be
 * handled correctly; an unwrapped async handler that throws will hang the
 * request instead of returning an error response.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wraps an async Express route handler so that any thrown error (or
 * rejected Promise) is forwarded to `next(err)`, letting the centralized
 * errorHandler middleware (middleware/errorHandler.ts) handle it correctly
 * instead of leaving the request hanging forever.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
