/**
 * verify.integration.test.ts — exercises POST /v2/verify/:docId through the
 * real Express app via supertest, with Prisma mocked (fakePrisma.ts) AND
 * the HTTP call to engine2-service mocked (jest.mock on engine2Client).
 *
 * THIS IS THE MOST IMPORTANT TEST FILE IN THE ENGINE 2 CODEBASE, alongside
 * combiner.test.ts. It proves the actual ROUTE — not just the pure
 * combineVerdicts() function in isolation — never calls engine2-service at
 * all when the client-supplied Engine 1 status isn't AUTHENTIC.
 */
import request from 'supertest';
import { createFakePrisma } from './fakePrisma';

const fakePrisma = createFakePrisma();
jest.mock('../../src/db/prisma', () => ({ prisma: fakePrisma }));

const mockRunEngine2Pipeline = jest.fn();
jest.mock('../../src/routes/v2/engine2Client', () => {
  const actual = jest.requireActual('../../src/routes/v2/engine2Client');
  return {
    ...actual,
    runEngine2Pipeline: (...args: unknown[]) => mockRunEngine2Pipeline(...args),
  };
});

import { createApp } from '../../src/app';
const app = createApp();

beforeEach(() => {
  fakePrisma.__reset();
  mockRunEngine2Pipeline.mockReset();
});

const VALID_DOC_ID = '11111111-1111-1111-1111-111111111111';
const VALID_ISSUER_ID = '22222222-2222-2222-2222-222222222222';
const VALID_TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';

function seedDocument() {
  fakePrisma.__seedDocument({
    docId: VALID_DOC_ID,
    issuerId: VALID_ISSUER_ID,
    templateId: VALID_TEMPLATE_ID,
    templateVersion: 1,
    issuedAt: '2026-05-20T00:00:00Z',
    expiresAt: null,
    fields: { student_name: 'Simran Kaur' },
    assetHashes: {},
    templateHash: 'abc123',
  });
}

function seedTemplate() {
  fakePrisma.__seedTemplate(
    {
      templateId: VALID_TEMPLATE_ID,
      version: 1,
      issuerId: VALID_ISSUER_ID,
      name: 'BE Degree Template',
      layoutJson: { page_width: 842, page_height: 595, qr_position: [[60, 60], [140, 60], [140, 140], [60, 140]] },
      templateHash: 'abc123',
    },
    [],
    [{ fieldName: 'student_name', boundingBox: { x: 300, y: 180, width: 400, height: 40 }, languages: ['en'], isMandatory: true }]
  );
}

describe('POST /v2/verify/:docId — THE SECURITY GATE', () => {
  it('rejects with 400 and NEVER calls engine2-service when Engine 1 status is not AUTHENTIC', async () => {
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'HASH_MISMATCH' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENGINE1_NOT_AUTHENTIC');
    expect(res.body.overallVerdict).toBe('REJECTED');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it.each([
    'INVALID_QR', 'BAD_MANIFEST_SIGNATURE', 'MANIFEST_ROLLBACK', 'MANIFEST_STALE',
    'UNKNOWN_ISSUER', 'ISSUER_SUSPENDED', 'HASH_MISMATCH', 'IDENTITY_MISMATCH',
    'BAD_SIGNATURE', 'REVOKED', 'EXPIRED', 'NETWORK_ERROR',
  ])('never calls engine2-service for Engine 1 status = %s', async (status) => {
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.overallVerdict).not.toBe('VERIFIED');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('rejects a request with no engine1Result field at all', async () => {
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_ENGINE1_RESULT');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON in engine1Result', async () => {
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', '{not valid json')
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ENGINE1_RESULT');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('requires a photo even when Engine 1 status is AUTHENTIC', async () => {
    seedDocument();
    seedTemplate();
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_PHOTO');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('rejects if the document does not exist, even with AUTHENTIC status claimed', async () => {
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CREDENTIAL_NOT_FOUND');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('rejects if the document has been revoked, even with AUTHENTIC status claimed', async () => {
    seedDocument();
    fakePrisma.__seedManifest({
      payload: { version: 1, generated_at: '2026-01-01T00:00:00Z', valid_until: '2099-01-01T00:00:00Z', issuers: [], revoked_docs: [VALID_DOC_ID] },
      signature: 'a'.repeat(128),
    });

    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCUMENT_REVOKED');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('rejects if no Engine 2 template is configured for this credential', async () => {
    seedDocument();
    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEMPLATE_NOT_CONFIGURED');
    expect(mockRunEngine2Pipeline).not.toHaveBeenCalled();
  });

  it('calls engine2-service and returns VERIFIED when both engines say AUTHENTIC', async () => {
    seedDocument();
    seedTemplate();
    mockRunEngine2Pipeline.mockResolvedValue({
      engine2_verdict: 'AUTHENTIC', reason: 'All mandatory fields matched.', alignment_quality: 0.9,
      tiers_completed: ['tier1_qr_seeded', 'tier2_border_refined'], screenshot_likelihood: 0.1,
      preprocessing_warnings: [], ocr_results: [], field_verdicts: [],
    });

    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(200);
    expect(res.body.overallVerdict).toBe('VERIFIED');
    expect(mockRunEngine2Pipeline).toHaveBeenCalledTimes(1);
  });

  it('returns NEEDS_REVIEW (never VERIFIED) when Engine 1 is AUTHENTIC but Engine 2 needs review', async () => {
    seedDocument();
    seedTemplate();
    mockRunEngine2Pipeline.mockResolvedValue({
      engine2_verdict: 'NEEDS_REVIEW', reason: 'Alignment quality too low.', alignment_quality: 0.3,
      tiers_completed: ['tier1_qr_seeded'], screenshot_likelihood: 0.1,
      preprocessing_warnings: [], ocr_results: [], field_verdicts: [],
    });

    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(200);
    expect(res.body.overallVerdict).toBe('NEEDS_REVIEW');
  });

  it('returns REJECTED (never VERIFIED) when Engine 1 is AUTHENTIC but Engine 2 rejects', async () => {
    seedDocument();
    seedTemplate();
    mockRunEngine2Pipeline.mockResolvedValue({
      engine2_verdict: 'REJECTED', reason: 'Mandatory field failed comparison.', alignment_quality: 0.9,
      tiers_completed: ['tier1_qr_seeded', 'tier2_border_refined'], screenshot_likelihood: 0.1,
      preprocessing_warnings: [], ocr_results: [],
      field_verdicts: [{ field_name: 'student_name', similarity: 0.1, is_mandatory: true, tier: 'reject' }],
    });

    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(200);
    expect(res.body.overallVerdict).toBe('REJECTED');
  });

  it('persists an Engine2Verification row retrievable via GET /v2/verifications/:docId', async () => {
    seedDocument();
    seedTemplate();
    mockRunEngine2Pipeline.mockResolvedValue({
      engine2_verdict: 'AUTHENTIC', reason: 'ok', alignment_quality: 0.9,
      tiers_completed: [], screenshot_likelihood: 0.1, preprocessing_warnings: [], ocr_results: [], field_verdicts: [],
    });

    await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    const historyRes = await request(app).get(`/v2/verifications/${VALID_DOC_ID}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body).toHaveLength(1);
    expect(historyRes.body[0].overallVerdict).toBe('VERIFIED');
  });

  it('surfaces an engine2-service failure as a 502, never as a false VERIFIED', async () => {
    seedDocument();
    seedTemplate();
    const { Engine2ServiceError } = jest.requireActual('../../src/routes/v2/engine2Client');
    mockRunEngine2Pipeline.mockRejectedValue(new Engine2ServiceError('connection refused'));

    const res = await request(app)
      .post(`/v2/verify/${VALID_DOC_ID}`)
      .field('engine1Result', JSON.stringify({ status: 'AUTHENTIC' }))
      .attach('photo', Buffer.from('fake-photo-bytes'), 'photo.jpg');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('ENGINE2_SERVICE_ERROR');
  });
});
