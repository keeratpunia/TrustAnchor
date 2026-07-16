/**
 * templates.integration.test.ts — exercises the Engine 2 template
 * management API through the real Express app via supertest, with Prisma
 * mocked (see fakePrisma.ts).
 */
import request from 'supertest';
import { createFakePrisma } from './fakePrisma';

const fakePrisma = createFakePrisma();
jest.mock('../../src/db/prisma', () => ({ prisma: fakePrisma }));

import { createApp } from '../../src/app';
const app = createApp();

beforeEach(() => {
  fakePrisma.__reset();
});

const VALID_TEMPLATE_ID = '11111111-1111-1111-1111-111111111111';
const VALID_ISSUER_ID = '22222222-2222-2222-2222-222222222222';

const validLayout = {
  page_width: 842,
  page_height: 595,
  qr_position: [[60, 60], [140, 60], [140, 140], [60, 140]],
};

describe('POST /v2/templates', () => {
  it('creates a new template and computes a template hash', async () => {
    const res = await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID,
      version: 1,
      issuerId: VALID_ISSUER_ID,
      name: 'BE Degree Template',
      layoutJson: validLayout,
    });
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe(VALID_TEMPLATE_ID);
    expect(res.body.templateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes the same hash for identical layouts regardless of template ID/name', async () => {
    const res1 = await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'Template A', layoutJson: validLayout,
    });
    const res2 = await request(app).post('/v2/templates').send({
      templateId: '33333333-3333-3333-3333-333333333333', version: 1, issuerId: VALID_ISSUER_ID, name: 'Template B', layoutJson: validLayout,
    });
    expect(res1.body.templateHash).toBe(res2.body.templateHash);
  });

  it('rejects an invalid templateId', async () => {
    const res = await request(app).post('/v2/templates').send({
      templateId: 'not-a-uuid', version: 1, issuerId: VALID_ISSUER_ID, name: 'X', layoutJson: validLayout,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a layoutJson missing qr_position', async () => {
    const res = await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'X',
      layoutJson: { page_width: 842, page_height: 595 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects qr_position with the wrong number of points', async () => {
    const res = await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'X',
      layoutJson: { ...validLayout, qr_position: [[0, 0], [1, 1]] },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v2/templates/:templateId/:version', () => {
  it('returns 404 for an unknown template', async () => {
    const res = await request(app).get(`/v2/templates/${VALID_TEMPLATE_ID}/1`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('returns the full template configuration including zones', async () => {
    await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'BE Degree Template', layoutJson: validLayout,
    });
    await request(app).post(`/v2/templates/${VALID_TEMPLATE_ID}/1/ocr-zones`).send({
      fieldName: 'student_name', boundingBox: { x: 300, y: 180, width: 400, height: 40 }, languages: ['en'], isMandatory: true,
    });

    const res = await request(app).get(`/v2/templates/${VALID_TEMPLATE_ID}/1`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('BE Degree Template');
    expect(res.body.ocrZones).toHaveLength(1);
    expect(res.body.ocrZones[0].fieldName).toBe('student_name');
  });
});

describe('POST /v2/templates/:templateId/:version/assets', () => {
  it('rejects an upload when the template does not exist yet', async () => {
    const res = await request(app)
      .post(`/v2/templates/${VALID_TEMPLATE_ID}/1/assets`)
      .field('assetName', 'university_logo')
      .field('boundingBox', JSON.stringify({ x: 10, y: 10, width: 100, height: 100 }))
      .attach('file', Buffer.from('fake-logo-bytes'), 'logo.png');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('accepts an upload once the template exists, computing a content hash', async () => {
    await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'BE Degree Template', layoutJson: validLayout,
    });
    const res = await request(app)
      .post(`/v2/templates/${VALID_TEMPLATE_ID}/1/assets`)
      .field('assetName', 'university_logo')
      .field('boundingBox', JSON.stringify({ x: 10, y: 10, width: 100, height: 100 }))
      .attach('file', Buffer.from('fake-logo-bytes'), 'logo.png');
    expect(res.status).toBe(201);
    expect(res.body.assetName).toBe('university_logo');
    expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /v2/templates/:templateId/:version/ocr-zones', () => {
  it('rejects a zone with no declared languages', async () => {
    await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'X', layoutJson: validLayout,
    });
    const res = await request(app).post(`/v2/templates/${VALID_TEMPLATE_ID}/1/ocr-zones`).send({
      fieldName: 'student_name', boundingBox: { x: 0, y: 0, width: 100, height: 20 }, languages: [],
    });
    expect(res.status).toBe(400);
  });

  it('accepts a mixed-language zone declaration', async () => {
    await request(app).post('/v2/templates').send({
      templateId: VALID_TEMPLATE_ID, version: 1, issuerId: VALID_ISSUER_ID, name: 'X', layoutJson: validLayout,
    });
    const res = await request(app).post(`/v2/templates/${VALID_TEMPLATE_ID}/1/ocr-zones`).send({
      fieldName: 'degree_name', boundingBox: { x: 300, y: 240, width: 450, height: 45 }, languages: ['hi', 'pa'], isMandatory: true,
    });
    expect(res.status).toBe(201);
  });
});
