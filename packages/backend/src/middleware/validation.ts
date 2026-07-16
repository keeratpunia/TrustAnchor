/**
 * validation.ts — request input validation helpers.
 *
 * Small, explicit validation functions rather than a schema-validation
 * library (Zod, Joi, etc.) — the inputs this API accepts are simple enough
 * (a UUID in a path parameter, a hex string, a JSON body with a fixed
 * shape) that hand-written checks are easier to fully audit than a
 * dependency whose validation semantics live in someone else's code.
 */
import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errorHandler';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_PATTERN = /^[0-9a-f]{64}$/i; // SHA-256 hex digest, exactly 64 hex chars

/** Express middleware factory: validates that `req.params[paramName]` is a well-formed UUID. */
export function validateUuidParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    if (!UUID_PATTERN.test(value)) {
      throw new ApiError(400, `Invalid ${paramName}: must be a UUID (e.g. 123e4567-e89b-12d3-a456-426614174000).`, 'INVALID_UUID');
    }
    next();
  };
}

/** Express middleware factory: validates that `req.params[paramName]` is a 64-character hex SHA-256 digest. */
export function validateSha256HexParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    if (!HEX64_PATTERN.test(value)) {
      throw new ApiError(
        400,
        `Invalid ${paramName}: must be a 64-character lowercase hex SHA-256 digest.`,
        'INVALID_HASH'
      );
    }
    next();
  };
}

/** Validates that a value is a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validates that a value is a valid UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Validates that a value is a 64-character hex SHA-256 digest string. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && HEX64_PATTERN.test(value);
}

/** Validates that a value is a 128-character hex Ed25519 signature string. */
export function isEd25519SignatureHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{128}$/i.test(value);
}

/** Validates that a value is a 64-character hex Ed25519 public key string. */
export function isEd25519PublicKeyHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Validates that a value is a valid ISO-8601 date-time string. */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !isNaN(parsed.getTime());
}
