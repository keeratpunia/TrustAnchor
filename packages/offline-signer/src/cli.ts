#!/usr/bin/env node
/**
 * cli.ts
 * ============================================================================
 * OFFLINE SIGNER CLI — the single entry point for every offline signing
 * operation in TrustAnchor Engine 1.
 * ============================================================================
 * Run this tool on an air-gapped / offline machine only. It never makes a
 * network request — every command reads local JSON files and writes local
 * output files, which are then manually transferred to the networked
 * Issuer Portal / Verification Server.
 *
 * Commands:
 *   keygen               — generate a software test keypair, OR read the
 *                           public key off an already-provisioned YubiKey
 *                           (--card) — see keySigner.ts's header for the
 *                           full software-vs-hardware distinction.
 *   sign-credential       — sign one credential payload's content hash
 *   sign-batch            — sign many credential payloads in one pass
 *                           (for CSV-based issuance — one YubiKey touch
 *                           covers the whole batch if touch-caching is on)
 *   sign-manifest         — sign a trust manifest payload
 *   generate-qr           — render a signed credential's QR code as a PNG
 *
 * Run `ts-node src/cli.ts <command> --help` for per-command usage.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CredentialPayload, ManifestPayload } from '@trustanchor/shared';
import { generateKeyPair, KeyPairFile } from './keygen';
import { signCredential, verifyCredentialSignatureOffline } from './signCredential';
import { signManifest, verifyManifestSignatureOffline } from './signManifest';
import { buildQrBytes, renderQrPng, renderQrTerminal } from './generateQr';
import { KeySigner, SoftwareTestKeySigner, YubiKeySigner, KeySource } from './keySigner';

const program = new Command();

program
  .name('trustanchor-offline-signer')
  .description('Offline signing tool for TrustAnchor Engine 1. Never run this on a networked machine.')
  .version('1.0.0');

/** The on-disk shape written by `keygen --card` — a card-backed key RECORD, deliberately containing no private key material at all (it never leaves the card). */
interface CardKeyRecordFile {
  label: string;
  publicKeyHex: string;
  keySource: 'yubikey';
  cardSerial: string;
  generatedAt: string;
}

type KeyFile = KeyPairFile | CardKeyRecordFile;

/**
 * Loads a key file (either a software KeyPairFile from `keygen`, or a
 * CardKeyRecordFile from `keygen --card`) and constructs the matching
 * KeySigner — the one place in the CLI that has to know both shapes exist;
 * everything past this point just uses the KeySigner interface.
 */
async function loadSigner(keyFilePath: string): Promise<KeySigner> {
  const parsed: KeyFile = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
  if ('privateKeyHex' in parsed) {
    console.warn(
      `⚠ Using a SOFTWARE TEST KEY ("${parsed.label}") — this is fine for development, but this key exists as a ` +
        `plaintext file and must never be used to sign real institutional credentials. See the workflow report's ` +
        `key-custody tier table.`
    );
    return new SoftwareTestKeySigner(parsed);
  }
  if (parsed.keySource === 'yubikey') {
    console.log(`Detecting YubiKey (expecting serial ${parsed.cardSerial})...`);
    const { serialNumber } = await YubiKeySigner.detectCard();
    if (serialNumber !== parsed.cardSerial) {
      console.warn(
        `⚠ The connected card's serial (${serialNumber}) does not match this key record's serial ` +
          `(${parsed.cardSerial}). Proceeding anyway, but double-check you plugged in the right YubiKey.`
      );
    }
    return new YubiKeySigner();
  }
  throw new Error(`Unrecognized key file shape at ${keyFilePath} — expected either a software keypair or a card key record.`);
}

// ── keygen ────────────────────────────────────────────────────────────────
program
  .command('keygen')
  .description('Generate a software test keypair, or read the public key off a YubiKey (--card).')
  .requiredOption('-l, --label <label>', 'Human-readable label, e.g. "XYZ University Issuer Key"')
  .requiredOption('-o, --out <path>', 'Output path for the key file')
  .option('--card', 'Read the key from an already-provisioned YubiKey instead of generating a software key', false)
  .action(async (opts: { label: string; out: string; card: boolean }) => {
    if (opts.card) {
      console.log('Detecting YubiKey...');
      const { serialNumber } = await YubiKeySigner.detectCard();
      const signer = new YubiKeySigner();
      const publicKeyHex = await signer.getPublicKeyHex();

      const record: CardKeyRecordFile = {
        label: opts.label,
        publicKeyHex,
        keySource: 'yubikey',
        cardSerial: serialNumber,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(opts.out, JSON.stringify(record, null, 2));
      console.log(`✔ Read Ed25519 public key from YubiKey (serial ${serialNumber}): "${opts.label}"`);
      console.log(`  Public key (safe to share): ${publicKeyHex}`);
      console.log(`  Key record written to: ${opts.out} (contains NO private key — it never leaves the card)`);
      console.log('');
      console.log(
        '  Note: this command reads a key that ALREADY EXISTS on the card. To generate a new Ed25519 key ON the ' +
          'card itself (a one-time, deliberately manual step this tool does not script), run: ' +
          'gpg --card-edit -> admin -> generate -> select curve "ed25519" / "cv25519".'
      );
      return;
    }

    const keyPair: KeyPairFile = generateKeyPair(opts.label);
    fs.writeFileSync(opts.out, JSON.stringify(keyPair, null, 2));
    console.log(`✔ Generated a SOFTWARE TEST Ed25519 keypair: "${opts.label}"`);
    console.log(`  Public key  (safe to share):  ${keyPair.publicKeyHex}`);
    console.log(`  Private key (OFFLINE ONLY):   [written to ${opts.out} — do not transfer this file to any networked machine]`);
    console.log('');
    console.log(
      '  ⚠ This is a plaintext software key, meant for development and testing. Never use it to sign a real ' +
        'institution\'s credentials — use `keygen --card` with a YubiKey for that. See the workflow report\'s ' +
        'key-custody tier table for why.'
    );
  });

// ── sign-credential ───────────────────────────────────────────────────────
program
  .command('sign-credential')
  .description('Sign a credential payload\'s content hash with a software test key or a YubiKey.')
  .requiredOption('-p, --payload <path>', 'Path to the unsigned CredentialPayload JSON file')
  .requiredOption('-k, --key <path>', 'Path to the key file (from keygen, either software or --card)')
  .requiredOption('-o, --out <path>', 'Output path for the signed-credential result JSON')
  .action(async (opts: { payload: string; key: string; out: string }) => {
    const payload: CredentialPayload = JSON.parse(fs.readFileSync(opts.payload, 'utf8'));
    const signer = await loadSigner(opts.key);
    const publicKeyHex = await signer.getPublicKeyHex();

    if (signer.keySource === 'yubikey') {
      console.log('Touch your YubiKey now if it lights up or blinks...');
    }
    const result = await signCredential(payload, signer);

    // Self-check: immediately verify the signature we just produced, using
    // only the PUBLIC key, exactly as a real verifier later will. If this
    // ever fails, something is deeply wrong with the signer and the output
    // must not be trusted or transferred.
    const selfCheckOk = verifyCredentialSignatureOffline(result.contentHash, result.signature, publicKeyHex);
    if (!selfCheckOk) {
      console.error('✘ FATAL: self-verification of the freshly-produced signature failed. Refusing to write output.');
      process.exit(1);
    }

    const output = {
      payload,
      issuerId: payload.issuer_id,
      docId: payload.doc_id,
      contentHashHex: result.contentHashHex,
      signatureHex: result.signatureHex,
      keySource: result.keySource,
    };
    fs.writeFileSync(opts.out, JSON.stringify(output, null, 2));
    console.log(`✔ Signed credential ${payload.doc_id} using ${signer.describe()}`);
    console.log(`  Content hash: ${result.contentHashHex}`);
    console.log(`  Signature:    ${result.signatureHex}`);
    console.log(`  Self-check:   PASS`);
    console.log(`  Written to:   ${opts.out}`);
  });

// ── sign-batch ────────────────────────────────────────────────────────────
program
  .command('sign-batch')
  .description('Sign every credential payload in a batch file in one pass (for CSV-based issuance).')
  .requiredOption('-p, --payloads <path>', 'Path to a JSON file containing an array of unsigned CredentialPayload objects')
  .requiredOption('-k, --key <path>', 'Path to the key file (from keygen, either software or --card)')
  .requiredOption('-o, --out <path>', 'Output path for the signed-batch result JSON (an array)')
  .option('--qr-dir <path>', 'If set, also render one QR PNG per credential into this directory')
  .action(async (opts: { payloads: string; key: string; out: string; qrDir?: string }) => {
    const payloads: CredentialPayload[] = JSON.parse(fs.readFileSync(opts.payloads, 'utf8'));
    if (!Array.isArray(payloads) || payloads.length === 0) {
      console.error('✘ Error: --payloads must be a JSON array with at least one credential payload.');
      process.exit(1);
    }

    const signer = await loadSigner(opts.key);
    const publicKeyHex = await signer.getPublicKeyHex();

    console.log(`Signing ${payloads.length} credential(s) using ${signer.describe()}...`);
    if (signer.keySource === 'yubikey') {
      console.log(
        'If your YubiKey requires a touch, one touch may cover this entire batch (if touch-caching is enabled) — ' +
          'watch for it to blink and touch it when prompted. If it blinks again partway through, touch it again.'
      );
    }

    if (opts.qrDir) fs.mkdirSync(opts.qrDir, { recursive: true });

    const results: Array<{
      payload: CredentialPayload;
      issuerId: string;
      docId: string;
      contentHashHex: string;
      signatureHex: string;
      keySource: KeySource;
    }> = [];

    let failures = 0;
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      process.stdout.write(`  [${i + 1}/${payloads.length}] ${payload.doc_id}... `);
      try {
        const result = await signCredential(payload, signer);
        const selfCheckOk = verifyCredentialSignatureOffline(result.contentHash, result.signature, publicKeyHex);
        if (!selfCheckOk) {
          console.log('FAILED (self-check)');
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

        if (opts.qrDir) {
          const qrBytes = buildQrBytes({
            issuerId: payload.issuer_id,
            docId: payload.doc_id,
            contentHashHex: result.contentHashHex,
            signatureHex: result.signatureHex,
          });
          await renderQrPng(qrBytes, path.join(opts.qrDir, `${payload.doc_id}.png`));
        }
        console.log('OK');
      } catch (err) {
        console.log(`FAILED (${(err as Error).message})`);
        failures++;
      }
    }

    fs.writeFileSync(opts.out, JSON.stringify(results, null, 2));

    console.log('');
    console.log(`✔ Signed ${results.length}/${payloads.length} credential(s). ${failures > 0 ? `${failures} FAILED — see above.` : ''}`);
    console.log(`  Written to: ${opts.out}`);
    if (opts.qrDir) console.log(`  QR codes written to: ${opts.qrDir}`);
    if (failures > 0) process.exit(1);
  });

// ── sign-manifest ─────────────────────────────────────────────────────────
program
  .command('sign-manifest')
  .description('Sign a trust manifest payload with the platform\'s offline private key.')
  .requiredOption('-m, --manifest <path>', 'Path to the unsigned ManifestPayload JSON file')
  .requiredOption('-k, --key <path>', 'Path to the platform\'s keypair JSON file (from keygen)')
  .requiredOption('-o, --out <path>', 'Output path for the signed manifest JSON')
  .action((opts: { manifest: string; key: string; out: string }) => {
    const payload: ManifestPayload = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
    const keyPair: KeyPairFile = JSON.parse(fs.readFileSync(opts.key, 'utf8'));

    const signed = signManifest(payload, keyPair.privateKeyHex);

    const selfCheckOk = verifyManifestSignatureOffline(signed, keyPair.publicKeyHex);
    if (!selfCheckOk) {
      console.error('✘ FATAL: self-verification of the freshly-produced manifest signature failed. Refusing to write output.');
      process.exit(1);
    }

    fs.writeFileSync(opts.out, JSON.stringify(signed, null, 2));
    console.log(`✔ Signed trust manifest, version ${payload.version}`);
    console.log(`  Issuers:      ${payload.issuers.length}`);
    console.log(`  Revoked docs: ${payload.revoked_docs.length}`);
    console.log(`  Valid until:  ${payload.valid_until}`);
    console.log(`  Self-check:   PASS`);
    console.log(`  Written to:   ${opts.out}`);
  });

// ── generate-qr ───────────────────────────────────────────────────────────
program
  .command('generate-qr')
  .description('Render a signed credential\'s QR code as a PNG (and print raw bytes for test fixtures).')
  .requiredOption('-s, --signed <path>', 'Path to the signed-credential JSON produced by sign-credential')
  .requiredOption('-o, --out <path>', 'Output path for the QR PNG image')
  .option('-t, --terminal', 'Also print an ASCII QR code to the terminal', false)
  .action(async (opts: { signed: string; out: string; terminal: boolean }) => {
    const signed = JSON.parse(fs.readFileSync(opts.signed, 'utf8'));

    const qrBytes = buildQrBytes({
      issuerId: signed.issuerId,
      docId: signed.docId,
      contentHashHex: signed.contentHashHex,
      signatureHex: signed.signatureHex,
    });

    await renderQrPng(qrBytes, opts.out);

    const rawBytesPath = opts.out.replace(/\.png$/i, '.cbor.b64.txt');
    fs.writeFileSync(rawBytesPath, qrBytes.toString('base64'));

    console.log(`✔ Generated QR code for document ${signed.docId}`);
    console.log(`  QR payload size: ${qrBytes.length} bytes`);
    console.log(`  PNG written to:  ${opts.out}`);
    console.log(`  Raw bytes (base64) written to: ${rawBytesPath}`);

    if (opts.terminal) {
      console.log('');
      console.log(await renderQrTerminal(qrBytes));
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('✘ Error:', err.message);
  process.exit(1);
});
