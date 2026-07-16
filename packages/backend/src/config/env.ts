/**
 * env.ts — environment configuration loader.
 *
 * Loads and validates the environment variables the server needs at
 * startup, failing fast with a clear error message if anything required is
 * missing, rather than allowing the server to start into a broken state.
 *
 * Deliberately absent from this file: any signing key. See .env.example for
 * why — this runtime holds no signing key of any kind, in any environment
 * (Frozen Spec §5).
 */
import * as dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill in real values.`
    );
  }
  return value;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  port: parseInt(process.env.PORT ?? '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  nodeEnv: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
  /**
   * The PLATFORM TRUST KEY's PUBLIC half (safe to have here — this is not a
   * secret; the whole point of a public key is that it can be shared
   * freely). Used ONLY for an optional server-side sanity check on manifest
   * ingestion (see routes/manifest.ts) — a convenience that catches
   * operator mistakes early. It is NOT part of Engine 1's security
   * boundary: every verifier independently re-checks this signature using
   * its own hardcoded copy of this same public key.
   */
  platformPublicKeyHex: process.env.PLATFORM_PUBLIC_KEY_HEX ?? null,
  /**
   * A shared secret required on ingestion endpoints (POST /manifest,
   * POST /credential, POST /asset). This is ordinary operational access
   * control — e.g. keeping a public demo deployment from being spammed —
   * NOT a cryptographic security boundary. See middleware/ingestionAuth.ts.
   */
  ingestionApiKey: process.env.INGESTION_API_KEY ?? null,
  /**
   * Base URL of the Python engine2-service (packages/engine2-service).
   * Only read by routes/v2/engine2Client.ts — never touched by any
   * Engine 1 route. Documented in .env.example; defaults to the local
   * dev port (main.py runs uvicorn on 8000) so a missing .env entry
   * doesn't silently produce "undefined/pipeline/run".
   */
  engine2ServiceUrl: process.env.ENGINE2_SERVICE_URL ?? 'http://localhost:8000',
  /**
   * Signing secret for issuer/admin PORTAL SESSION tokens (JWTs) —
   * completely unrelated to any credential-signing key. This secret proves
   * "this person already logged in with a password," nothing more; it
   * never appears in a credential, a manifest, or anything a verifier
   * checks. Falls back to an obviously-fake value in non-production so
   * local dev never fails to start over a missing .env entry, but logs a
   * loud warning so this can never silently ship that way.
   */
  jwtSecret: (() => {
    const fromEnv = process.env.JWT_SECRET;
    if (fromEnv && fromEnv.trim() !== '') return fromEnv;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required environment variable "JWT_SECRET" in production. Set a long random value.');
    }
    // eslint-disable-next-line no-console
    console.warn(
      'WARNING: JWT_SECRET is not set — using an insecure development-only default. ' +
        'Set JWT_SECRET in .env before deploying anywhere real.'
    );
    return 'insecure-development-only-jwt-secret-do-not-use-in-production';
  })(),
};

