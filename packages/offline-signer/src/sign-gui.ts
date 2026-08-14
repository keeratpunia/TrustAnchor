#!/usr/bin/env node
/**
 * sign-gui.ts — the issuer-facing signing experience.
 * ============================================================================
 * Designed to be compiled into a standalone executable via `pkg` so the
 * issuer needs ZERO dev setup. They double-click TrustAnchor-Signer.exe
 * (Windows) or ./TrustAnchor-Signer (Mac/Linux), and this walks them
 * through everything interactively.
 *
 * The issuer needs exactly two things:
 *   1. Their YubiKey plugged in
 *   2. The unsigned_batch.json file the portal gave them
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { CredentialPayload } from '@trustanchor/shared';
import { signCredential, verifyCredentialSignatureOffline } from './signCredential';
import { buildQrBytes, renderQrPng } from './generateQr';
import {
  KeySigner,
  SoftwareTestKeySigner,
  YubiKeySigner,
  YubiKeyNotDetectedError,
} from './keySigner';

// ── Helpers ──────────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function findFile(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    try {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    } catch { /* skip inaccessible dirs */ }
  }
  return null;
}

function searchDirs(): string[] {
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    cwd,
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    home,
  ].filter(Boolean);
}

/** Detect the issuer's YubiKey. Software test keys are only used with --dev flag. */
async function autoDetectSigner(): Promise<KeySigner | null> {
  const isDev = process.argv.includes('--dev') || process.argv.includes('--test');

  // In dev/test mode, also look for software key files
  if (isDev) {
    const keyNames = ['issuer-key.json', 'test-issuer-key.json', 'my-issuer-key.json'];
    for (const name of keyNames) {
      const keyPath = findFile(name, searchDirs());
      if (keyPath) {
        try {
          const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          if ('privateKeyHex' in parsed) {
            console.log(`  ⚠ Using software test key (--dev mode): ${keyPath}`);
            console.log(`    DO NOT use this for real institutional documents.`);
            console.log('');
            return new SoftwareTestKeySigner(parsed);
          }
          if (parsed.keySource === 'yubikey') {
            console.log(`  Found YubiKey record: ${keyPath}`);
            return new YubiKeySigner();
          }
        } catch { /* not a valid key file, skip */ }
      }
    }
  }

  // Production: only detect YubiKey
  try {
    const { serialNumber } = await YubiKeySigner.detectCard();
    console.log(`  YubiKey detected (serial: ${serialNumber})`);
    return new YubiKeySigner();
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║            TrustAnchor Document Signer                  ║');
  console.log('║            Sign credentials with your YubiKey           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Step 1: Find the unsigned batch file ──────────────────────────────
  console.log('STEP 1: Locating your unsigned batch file...');
  console.log('');

  let unsignedPath = findFile('unsigned_batch.json', searchDirs());

  if (unsignedPath) {
    console.log(`  Found: ${unsignedPath}`);
    const useIt = await ask('  Use this file? [Y/n]: ');
    if (useIt.toLowerCase() === 'n') unsignedPath = null;
  }

  if (!unsignedPath) {
    console.log('');
    console.log('  Could not find unsigned_batch.json automatically.');
    console.log('  Drag the file into this window, or type/paste the full path:');
    console.log('');
    let manualPath = await ask('  Path: ');
    // Handle drag-and-drop (some terminals wrap path in quotes)
    manualPath = manualPath.replace(/^["']|["']$/g, '').trim();
    if (!fs.existsSync(manualPath)) {
      console.error(`\n  ✘ File not found: ${manualPath}`);
      console.error('    Make sure you downloaded unsigned_batch.json from the portal.');
      await ask('\n  Press Enter to exit...');
      process.exit(1);
    }
    unsignedPath = manualPath;
  }

  // Parse
  let payloads: CredentialPayload[];
  try {
    const raw = fs.readFileSync(unsignedPath, 'utf8');
    payloads = JSON.parse(raw);
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error('File does not contain a valid array of credential payloads.');
    }
  } catch (err) {
    console.error(`\n  ✘ Could not read the file: ${(err as Error).message}`);
    await ask('\n  Press Enter to exit...');
    process.exit(1);
  }

  console.log(`  ✓ ${payloads.length} document(s) ready to sign.`);
  console.log('');

  // ── Step 2: Detect signing key ────────────────────────────────────────
  console.log('STEP 2: Detecting your signing key...');
  console.log('');

  let signer = await autoDetectSigner();

  if (!signer) {
    console.error('  ✘ No YubiKey or key file detected.');
    console.error('');
    console.error('  Please check:');
    console.error('    • Is your YubiKey plugged in firmly?');
    console.error('    • Try a different USB port');
    console.error('    • On Mac/Linux: is GnuPG installed? (brew install gnupg / sudo apt install gnupg)');
    console.error('    • On Windows: is Gpg4win installed? (gpg4win.org)');
    console.error('    • Make sure no other program is using the YubiKey');
    console.error('');

    console.error('');
    console.error('  Cannot proceed without a YubiKey.');
    console.error('  Contact your administrator if you need help.');
    await ask('\n  Press Enter to exit...');
    process.exit(1);
  }

  const publicKeyHex = await signer!.getPublicKeyHex();
  console.log(`  ✓ Ready to sign with: ${signer!.describe()}`);
  console.log('');

  // ── Step 3: Sign ──────────────────────────────────────────────────────
  console.log(`STEP 3: Signing ${payloads.length} document(s)...`);
  console.log('');

  if (signer!.keySource === 'yubikey') {
    console.log('  ┌──────────────────────────────────────────────────────┐');
    console.log('  │                                                      │');
    console.log('  │   Your YubiKey may start BLINKING.                   │');
    console.log('  │                                                      │');
    console.log('  │   When it does, TOUCH the metal contact on it        │');
    console.log('  │   to authorize the signature.                        │');
    console.log('  │                                                      │');
    console.log('  │   If it asks for a PIN, type the PIN your            │');
    console.log('  │   administrator gave you and press Enter.            │');
    console.log('  │                                                      │');
    console.log('  └──────────────────────────────────────────────────────┘');
    console.log('');
  }

  // Output paths — save next to the unsigned file
  const outputDir = path.dirname(unsignedPath);
  const signedPath = path.join(outputDir, 'signed_batch.json');
  const qrDir = path.join(outputDir, 'qr-codes');
  fs.mkdirSync(qrDir, { recursive: true });

  const results: any[] = [];
  let failures = 0;

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const progress = `[${i + 1}/${payloads.length}]`;
    process.stdout.write(`  ${progress} Signing ${payload.doc_id}... `);

    try {
      const result = await signCredential(payload, signer!);

      // Self-verification — never trust a signature we can't verify ourselves
      const ok = verifyCredentialSignatureOffline(result.contentHash, result.signature, publicKeyHex);
      if (!ok) {
        console.log('FAILED (self-verification)');
        failures++;
        continue;
      }

      results.push({
        payload,
        issuerId: payload.issuer_id,
        docId: payload.doc_id,
        contentHashHex: result.contentHashHex,
        signatureHex: result.signatureHex,
        keySource: result.keySource,
      });

      // Generate QR
      const qrBytes = buildQrBytes({
        issuerId: payload.issuer_id,
        docId: payload.doc_id,
        contentHashHex: result.contentHashHex,
        signatureHex: result.signatureHex,
      });
      await renderQrPng(qrBytes, path.join(qrDir, `${payload.doc_id}.png`));

      console.log('✓');
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message}`);
      failures++;
    }
  }

  // Write output
  fs.writeFileSync(signedPath, JSON.stringify(results, null, 2));

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');

  if (failures === 0) {
    console.log(`  ✓ All ${results.length} document(s) signed successfully!`);
  } else {
    console.log(`  ✓ Signed ${results.length} of ${payloads.length}. ${failures} failed (see above).`);
  }

  console.log('');
  console.log(`  Signed file:  ${signedPath}`);
  console.log(`  QR codes:     ${qrDir}`);
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │                                                      │');
  console.log('  │   NEXT STEP:                                         │');
  console.log('  │                                                      │');
  console.log('  │   Go back to the TrustAnchor portal in your          │');
  console.log('  │   browser and upload signed_batch.json               │');
  console.log('  │                                                      │');
  console.log('  └──────────────────────────────────────────────────────┘');
  console.log('');

  await ask('  Press Enter to exit...');
}

main().catch(async (err) => {
  console.error(`\n  ✘ Unexpected error: ${err.message}`);
  console.error('');
  console.error('  If this keeps happening, contact your administrator and show');
  console.error('  them this error message.');
  await ask('\n  Press Enter to exit...');
  process.exit(1);
});
