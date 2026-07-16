/**
 * assetAndRevocation.integration.test.ts — exercises GET/POST /asset and
 * GET /revocation through the real Express app via supertest, with Prisma
 * mocked (see fakePrisma.ts).
 */
import request from 'supertest';
import { createHash } from 'crypto';
import { createFakePrisma } from './fakePrisma';

const fakePrisma = createFakePrisma();
jest.mock('../../src/db/prisma', () => ({ prisma: fakePrisma }));

import { createApp } from '../../src/app';
const app = createApp();

beforeEach(() => {
  fakePrisma.__reset();
});

describe('GET /asset/:contentHash', () => {
  it('rejects a malformed content hash', async () => {
    const res = await request(app).get('/asset/not-a-hash');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_HASH');
  });

  it('returns 404 for an unknown asset', async () => {
    const res = await request(app).get(`/asset/${'a'.repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ASSET_NOT_FOUND');
  });
});

describe('POST /asset', () => {
  it('rejects an upload whose hash does not match expectedContentHash', async () => {
    const fileBytes = Buffer.from('some image bytes');
    const wrongHash = 'a'.repeat(64);

    const res = await request(app)
      .post('/asset')
      .field('docId', '11111111-1111-1111-1111-111111111111')
      .field('assetName', 'student_photo')
      .field('expectedContentHash', wrongHash)
      .attach('file', fileBytes, 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HASH_MISMATCH');
  });

  it('accepts an upload whose hash matches expectedContentHash, and it becomes fetchable', async () => {
    const fileBytes = Buffer.from('some image bytes');
    const correctHash = createHash('sha256').update(fileBytes).digest('hex');

    const res = await request(app)
      .post('/asset')
      .field('docId', '11111111-1111-1111-1111-111111111111')
      .field('assetName', 'student_photo')
      .field('expectedContentHash', correctHash)
      .attach('file', fileBytes, 'photo.jpg');

    expect(res.status).toBe(201);
    expect(res.body.contentHash).toBe(correctHash);

    const fetchRes = await request(app).get(`/asset/${correctHash}`);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body).toEqual(fileBytes);
  });
});

describe('GET /revocation', () => {
  it('returns 404 when no manifest has been published', async () => {
    const res = await request(app).get('/revocation');
    expect(res.status).toBe(404);
  });

  it('returns a derived, unsigned view of the manifest revocation data when a manifest is present', async () => {
    fakePrisma.__seedManifest({
      payload: {
        version: 3,
        generated_at: '2026-07-08T00:00:00Z',
        valid_until: '2099-01-01T00:00:00Z',
        issuers: [{ issuer_id: 'issuer-1', issuer_name: 'Test University', status: 'active', keys: [] }],
        revoked_docs: ['doc-a', 'doc-b'],
      },
      signature: 'a'.repeat(128),
    });

    const res = await request(app).get('/revocation');
    expect(res.status).toBe(200);
    expect(res.body.revoked_docs).toEqual(['doc-a', 'doc-b']);
    expect(res.body.manifest_version).toBe(3);
    expect(res.body._note).toMatch(/not an authoritative trust decision/i);
    expect(res.body.issuer_statuses).toEqual([
      { issuer_id: 'issuer-1', issuer_name: 'Test University', status: 'active' },
    ]);
  });
});
