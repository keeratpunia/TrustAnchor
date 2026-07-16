const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Test 1: minimal insert, no JSON fields, no null...');
  try {
    await prisma.document.create({
      data: {
        docId: 'test-minimal-1',
        issuerId: 'test-issuer',
        templateId: 'test-template',
        templateVersion: 1,
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
        fields: {},
        assetHashes: {},
        templateHash: 'abc123',
      },
    });
    console.log('  PASS');
  } catch (e) {
    console.log('  FAILED:', e.message);
  }

  console.log('Test 2: with real field data (hardcoded, not from file)...');
  try {
    await prisma.document.create({
      data: {
        docId: 'test-minimal-2',
        issuerId: 'test-issuer',
        templateId: 'test-template',
        templateVersion: 1,
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
        fields: { student_name: 'Simran Kaur', cgpa: '9.37' },
        assetHashes: { student_photo: '1'.repeat(64) },
        templateHash: 'abc123',
      },
    });
    console.log('  PASS');
  } catch (e) {
    console.log('  FAILED:', e.message);
  }

  await prisma.$disconnect();
}

main();