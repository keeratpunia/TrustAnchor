/**
 * seed.ts — populates the database with the bundled sample issuer,
 * sample credential, and sample manifest (see /samples at the project
 * root), so a fresh checkout has a fully working, scannable demo credential
 * without needing to run the offline signer manually first.
 *
 * Run with: npm run seed
 *
 * This script uses Prisma Client directly (a one-off admin script, not a
 * networked API) — it is NOT part of the running server and does not
 * violate "runtime holds no signing key" (Frozen Spec §5), because it never
 * handles a private key; it only loads already-signed, already-public
 * artifacts produced offline by @trustanchor/offline-signer.
 */
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { CredentialPayload, SignedManifest } from '@trustanchor/shared';

const prisma = new PrismaClient();

const SAMPLES_DIR = path.resolve(__dirname, '../../../samples');

/**
 * Reads a JSON file defensively, guarding against a real-world Windows
 * failure mode: a text file that got saved with UTF-16 encoding (common
 * side effect of some editors' "Save As" defaults, or certain shell
 * redirection operators) instead of UTF-8. Reading such a file as UTF-8
 * produces a NUL (0x00) byte between every ASCII character, which Node's
 * JSON.parse tolerates (JS strings can contain any code point) but
 * PostgreSQL's UTF-8 columns reject outright with
 * "invalid byte sequence for encoding UTF8: 0x00" the moment you try to
 * store the resulting string — exactly the failure this function exists
 * to catch and fix before it ever reaches the database.
 */
function readJsonFileDefensively(filePath: string): any {
  let raw = fs.readFileSync(filePath, 'utf8');

  // Strip a UTF-8 byte-order-mark, if present.
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  // If the file was actually UTF-16 (misread as UTF-8), it will be riddled
  // with NUL characters. Stripping them recovers the original ASCII/UTF-8
  // text losslessly for this project's JSON files (none of the exact
  // field values TrustAnchor's credentials or manifests contain a
  // genuine, intentional NUL character).
  if (raw.indexOf('\u0000') !== -1) {
    console.warn(
      `  (!) ${filePath} contained NUL bytes — this usually means the file was saved with UTF-16 encoding instead of UTF-8. Stripping them automatically. If this warning persists, re-save the file as UTF-8 (no BOM) or re-download it fresh.`
    );
    raw = raw.replace(/\u0000/g, '');
  }

  return JSON.parse(raw);
}

async function main() {
  console.log('Seeding TrustAnchor Engine 1 database from bundled samples...');

  // ── Seed the trust manifest ──
  const manifestPath = path.join(SAMPLES_DIR, 'sample-manifest-signed.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest sample not found at ${manifestPath}. Run the offline-signer to produce it first (see README.md).`);
    process.exit(1);
  }
  const signedManifest: SignedManifest = readJsonFileDefensively(manifestPath);

  await prisma.currentManifest.upsert({
    where: { id: 1 },
    create: { id: 1, manifestBlob: signedManifest as any },
    update: { manifestBlob: signedManifest as any, receivedAt: new Date() },
  });
  console.log(`  Manifest seeded (version ${signedManifest.payload.version}, ${signedManifest.payload.issuers.length} issuer(s)).`);

  // ── Seed issuer admin/display row ──
  for (const issuer of signedManifest.payload.issuers) {
    await prisma.issuer.upsert({
      where: { issuerId: issuer.issuer_id },
      create: { issuerId: issuer.issuer_id, issuerName: issuer.issuer_name, status: issuer.status },
      update: { issuerName: issuer.issuer_name, status: issuer.status },
    });
  }
  console.log(`  ${signedManifest.payload.issuers.length} issuer record(s) seeded.`);

  // ── Seed a default admin account ──
  // There is deliberately no public POST /auth/admin/signup anywhere in
  // this system (see schema.prisma's comment on AdminAccount) — admin
  // accounts are provisioned exactly here, or via a direct database
  // operation, never through a form reachable by the public internet.
  // Reads credentials from env so this isn't the same password in every
  // deployment; falls back to an obviously-labeled dev default locally.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@trustanchor.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-dev-admin-password';
  const adminName = process.env.SEED_ADMIN_NAME ?? 'Platform Admin';

  const existingAdmin = await prisma.adminAccount.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.adminAccount.create({
      data: { name: adminName, email: adminEmail, passwordHash },
    });
    console.log(`  Admin account seeded: ${adminEmail}`);
    if (!process.env.SEED_ADMIN_PASSWORD) {
      console.log(
        `  (!) SEED_ADMIN_PASSWORD was not set — using the dev-only default password. Set SEED_ADMIN_EMAIL/` +
          `SEED_ADMIN_PASSWORD in .env and re-seed before this is anything but a local dev deployment.`
      );
    }
  } else {
    console.log(`  Admin account already exists (${adminEmail}) — left unchanged.`);
  }

  // ── Seed the sample credential ──
  const credentialPath = path.join(SAMPLES_DIR, 'sample-credential-signed.json');
  if (!fs.existsSync(credentialPath)) {
    console.error(`Credential sample not found at ${credentialPath}. Run the offline-signer to produce it first (see README.md).`);
    process.exit(1);
  }
  const signedCredential = readJsonFileDefensively(credentialPath);
  const payload: CredentialPayload = signedCredential.payload;

  await prisma.document.upsert({
    where: { docId: payload.doc_id },
    create: {
      docId: payload.doc_id,
      issuerId: payload.issuer_id,
      templateId: payload.template_id,
      templateVersion: payload.template_version,
      issuedAt: payload.issued_at, // raw string, not a Date — see schema.prisma comment
      expiresAt: payload.expires_at, // raw string or null, not a Date
      fields: payload.fields,
      assetHashes: payload.asset_hashes,
      templateHash: payload.template_hash,
    },
    update: {
      issuerId: payload.issuer_id,
      templateId: payload.template_id,
      templateVersion: payload.template_version,
      issuedAt: payload.issued_at, // raw string, not a Date — see schema.prisma comment
      expiresAt: payload.expires_at, // raw string or null, not a Date
      fields: payload.fields,
      assetHashes: payload.asset_hashes,
      templateHash: payload.template_hash,
    },
  });
  console.log(`  Sample credential seeded (doc_id: ${payload.doc_id}).`);

  console.log('');
  console.log('Seed complete. Scan samples/sample-qr.png with the verifier app to test end-to-end verification.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
