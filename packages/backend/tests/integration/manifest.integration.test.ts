/**
 * manifest.integration.test.ts — exercises GET/POST /manifest through the
 * real Express app via supertest, with the Prisma layer replaced by
 * tests/integration/fakePrisma.ts (see that file for why).
 */
import nacl from 'tweetnacl';

// IMPORTANT: config.ts reads process.env once, at module-load time. It must
// be set BEFORE anything imports (even transitively) src/config/env.ts —
// which app.ts does via the route modules. So we generate the sanity-check
// keypair and set the env var here, at the very top of the file, before any
// such import happens below.
const platformKeyPair = nacl.sign.keyPair();
process.env.PLATFORM_PUBLIC_KEY_HEX = Buffer.from(platformKeyPair.publicKey).toString('hex');

import request from 'supertest';
import { manifestContentHash, ManifestPayload } from '@trustanchor/shared';
import { createFakePrisma } from './fakePrisma';

const fakePrisma = createFakePrisma();

jest.mock('../../src/db/prisma', () => ({ prisma: fakePrisma }));

// Import createApp AFTER the mock (and the env var above) is registered, so
// the route modules pick up both the mocked prisma singleton and the
// correctly-configured platform public key.
import { createApp } from '../../src/app';

const app = createApp();

beforeEach(() => {
  fakePrisma.__reset();
});

function makeManifestPayload(overrides: Partial<ManifestPayload> = {}): ManifestPayload {
  return {
    version: 1,
    generated_at: '2026-07-08T00:00:00Z',
    valid_until: '2099-01-01T00:00:00Z', // far future, so tests aren't time-bombed
    issuers: [],
    revoked_docs: [],
    ...overrides,
  };
}

describe('GET /manifest', () => {
  it('returns 404 when no manifest has been published', async () => {
    const res = await request(app).get('/manifest');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no trust manifest/i);
  });

  it('returns the stored manifest verbatim', async () => {
    const payload = makeManifestPayload({ version: 5 });
    const blob = { payload, signature: 'a'.repeat(128) };
    fakePrisma.__seedManifest(blob);

    const res = await request(app).get('/manifest');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(blob);
  });
});

describe('POST /manifest', () => {
  it('rejects a body missing payload/signature', async () => {
    const res = await request(app).post('/manifest').send({ foo: 'bar' });
    expect(res.status).toBe(400);
  });

  it('rejects a payload with an invalid version', async () => {
    const res = await request(app)
      .post('/manifest')
      .send({ payload: makeManifestPayload({ version: 0 }), signature: 'a'.repeat(128) });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed signature', async () => {
    const res = await request(app)
      .post('/manifest')
      .send({ payload: makeManifestPayload(), signature: 'not-hex' });
    expect(res.status).toBe(400);
  });

  it('accepts a well-formed manifest correctly signed with the configured platform key', async () => {
    const payload = makeManifestPayload({ version: 1 });
    const hash = manifestContentHash(payload);
    const signature = Buffer.from(
      nacl.sign.detached(new Uint8Array(hash), platformKeyPair.secretKey)
    ).toString('hex');

    const res = await request(app).post('/manifest').send({ payload, signature });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
  });

  it('rejects a manifest signed with the WRONG key when a platform public key is configured', async () => {
    const wrongKeyPair = nacl.sign.keyPair();
    const payload = makeManifestPayload({ version: 1 });
    const hash = manifestContentHash(payload);
    const signature = Buffer.from(
      nacl.sign.detached(new Uint8Array(hash), wrongKeyPair.secretKey)
    ).toString('hex');

    const res = await request(app).post('/manifest').send({ payload, signature });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects a manifest version that does not move forward', async () => {
    const payload1 = makeManifestPayload({ version: 10 });
    fakePrisma.__seedManifest({ payload: payload1, signature: 'a'.repeat(128) });

    const payload2 = makeManifestPayload({ version: 10 }); // same version, not strictly greater
    const hash2 = manifestContentHash(payload2);
    const validSignature = Buffer.from(
      nacl.sign.detached(new Uint8Array(hash2), platformKeyPair.secretKey)
    ).toString('hex');

    const res = await request(app).post('/manifest').send({ payload: payload2, signature: validSignature });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERSION_ROLLBACK');
  });
});
