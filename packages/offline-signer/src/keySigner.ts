/**
 * keySigner.ts — the one interface every signing operation in this tool
 * goes through, and its two implementations.
 * ============================================================================
 * WHY THIS FILE EXISTS: previously, `signCredential()` took a raw private
 * key hex string directly — meaning the only way to sign anything was to
 * have that key sitting in a plaintext JSON file on disk (Tier 2/3 key
 * custody: better than a networked key, but still a file that can be
 * copied, backed up, or stolen). This file introduces a `KeySigner`
 * interface so the REST of this tool (signCredential.ts, the CLI's
 * sign-credential/sign-batch commands) never needs to know or care HOW a
 * signature gets produced — only that it can ask for one.
 *
 * TWO IMPLEMENTATIONS:
 *
 *   SoftwareTestKeySigner — wraps the original plaintext-keypair-file
 *   signing path. Fully working today, exactly as before. Loudly and
 *   permanently labeled as a TEST/DEV convenience, never silently treated
 *   as production-equivalent — every signed output's `keySource` field
 *   records "software_test_key", and every CLI invocation using it prints
 *   a warning banner. This exists so development and testing don't require
 *   physical hardware, not because it's an acceptable production key
 *   custody model — see this project's workflow report, §1.2's tier table.
 *
 *   YubiKeySigner — talks to a YubiKey's OpenPGP applet (Ed25519/cv25519,
 *   supported on YubiKey 5-series and newer with firmware >= 5.2.3) via
 *   GnuPG's scdaemon, using the raw Assuan-protocol `SCD PKSIGN` command
 *   (NOT `gpg --detach-sign`, which would wrap the signature in OpenPGP
 *   packet framing and additional hashing that this system's verifiers
 *   don't understand). PKSIGN asks the card to sign the exact bytes handed
 *   to it and returns the raw signature — for EdDSA specifically, that
 *   raw signature is a standard 64-byte Ed25519 signature, directly
 *   verifiable by this project's existing `nacl.sign.detached.verify`
 *   call, with no extra unwrapping needed. The private key never leaves
 *   the YubiKey at any point — every signing call is a request TO the
 *   card, which computes the signature on-chip and returns only the
 *   result.
 *
 *   HONESTY NOTE, please read before relying on this in production: this
 *   implementation is written carefully against GnuPG's documented
 *   scdaemon/Assuan protocol, but has NOT been exercised against a real
 *   YubiKey in this development environment (none was available). Treat
 *   it as "believed correct, pending a first real-hardware test pass" —
 *   expect to debug specific details (PIN prompt timing, touch-policy
 *   confirmation flow, exact card serial/keyid naming on your GnuPG
 *   version) the first time you actually run it against a physical key.
 *   Every failure path below is deliberately specific (not a generic
 *   "signing failed") so that first real run is diagnosable.
 */
import { execFile } from 'child_process';

/**
 * Runs `gpg-connect-agent`, feeding it a script of Assuan protocol lines on
 * stdin, returning stdout. Deliberately spawns the process and writes to
 * its stdin manually rather than using execFile's `input` convenience
 * option — direct testing during development showed that option produces
 * unreliable results against gpg-connect-agent specifically (empty output
 * or an indefinite hang, depending on environment), while writing to
 * `child.stdin` directly and calling `.end()` works correctly every time.
 * This is exactly the kind of environment-specific quirk this file's
 * header warns readers to expect and verify further on real hardware.
 */
function runGpgConnectAgentRaw(script: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'gpg-connect-agent',
      [],
      { encoding: 'utf8', timeout: 30000 },
      (err, stdout, stderr) => {
        if (err && (err as any).code === 'ENOENT') {
          reject(err);
          return;
        }
        // A non-zero exit or populated `err` here is NOT necessarily a
        // real failure — gpg-connect-agent can exit non-zero purely
        // because a scripted command returned an Assuan ERR line, which
        // this system needs to inspect via the response text itself (see
        // runGpgConnectAgent below), not treat as a thrown exception.
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: err ? (err as any).code ?? null : 0 });
      }
    );
    child.stdin?.write(script);
    child.stdin?.end();
  });
}

export type KeySource = 'yubikey' | 'software_test_key';

export interface KeySigner {
  readonly keySource: KeySource;
  /** Returns the Ed25519 public key, lowercase hex, 64 characters. */
  getPublicKeyHex(): Promise<string>;
  /** Signs an arbitrary-length message (in this system, always a 32-byte SHA-256 content hash) and returns a raw 64-byte Ed25519 signature. */
  sign(message: Buffer): Promise<Buffer>;
  /** A short, human-readable description for CLI output — e.g. "software test key (INSECURE, dev/test only)" or "YubiKey (serial 12345678)". */
  describe(): string;
}

// ============================================================================
// Software test key signer
// ============================================================================

export interface SoftwareKeyPairFile {
  label: string;
  publicKeyHex: string;
  privateKeyHex: string;
  generatedAt: string;
}

export class SoftwareTestKeySigner implements KeySigner {
  readonly keySource: KeySource = 'software_test_key';
  private readonly keyPair: SoftwareKeyPairFile;

  constructor(keyPair: SoftwareKeyPairFile) {
    this.keyPair = keyPair;
  }

  async getPublicKeyHex(): Promise<string> {
    return this.keyPair.publicKeyHex;
  }

  async sign(message: Buffer): Promise<Buffer> {
    // Deferred import to keep this module's top-level import list honest
    // about which path pulls in tweetnacl — the YubiKey path never does.
    const nacl = await import('tweetnacl');
    const privateKeyBytes = Buffer.from(this.keyPair.privateKeyHex, 'hex');
    if (privateKeyBytes.length !== 64) {
      throw new Error(
        `SoftwareTestKeySigner: private key must be exactly 64 bytes (tweetnacl secret key format), got ${privateKeyBytes.length}.`
      );
    }
    return Buffer.from(nacl.default.sign.detached(new Uint8Array(message), new Uint8Array(privateKeyBytes)));
  }

  describe(): string {
    return `software test key "${this.keyPair.label}" (INSECURE — dev/test only, never use for a real institution)`;
  }
}

// ============================================================================
// YubiKey (OpenPGP applet) signer
// ============================================================================

export class YubiKeyNotDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YubiKeyNotDetectedError';
  }
}

export class YubiKeySigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YubiKeySigningError';
  }
}

/** Runs `gpg-connect-agent`, feeding it a script of Assuan protocol lines on stdin, returning stdout. */
async function runGpgConnectAgent(script: string): Promise<{ stdout: string; ok: boolean }> {
  let stdout = '';
  let stderr = '';
  try {
    const result = await runGpgConnectAgentRaw(script);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new YubiKeyNotDetectedError(
        'gpg-connect-agent was not found on this machine. Install GnuPG (Gpg4win on Windows, gnupg via your package ' +
          'manager on macOS/Linux) — the YubiKey signing path talks to your YubiKey through GnuPG\'s smartcard daemon, ' +
          'not directly.'
      );
    }
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  // The Assuan protocol's own OK/ERR response lines on STDOUT are the
  // authoritative signal — gpg-connect-agent's STDERR routinely contains
  // transient startup chatter ("no running gpg-agent - starting...") even
  // on a run that goes on to succeed, so that text alone must never be
  // treated as a failure. Only fall back to stderr-based classification
  // when stdout contains no recognizable Assuan response at all (i.e. the
  // command never even reached the agent).
  const hasAssuanResponse = /^OK|^ERR/m.test(stdout);
  if (!hasAssuanResponse) {
    const combined = `${stdout}${stderr}`;
    if (/no running gpg-agent|can't connect to the gpg-agent|No agent running/i.test(combined)) {
      throw new YubiKeyNotDetectedError(
        'GnuPG is installed, but its background agent (gpg-agent) could not be started or reached. Try running ' +
          '`gpg-agent --daemon` once, or simply `gpg --card-status`, then retry. Full GnuPG output for debugging:\n' +
          combined
      );
    }
    throw new YubiKeySigningError(`gpg-connect-agent produced no usable response. Full output for debugging:\n${combined}`);
  }

  return { stdout, ok: !/^ERR/m.test(stdout) };
}

/** Parses a `gpg-connect-agent` transcript for the first `D <hex>` data line, or throws with the full transcript for debugging. */
function extractDataLine(transcript: string, context: string): string {
  const match = transcript.split('\n').find((line) => line.startsWith('D '));
  if (!match) {
    throw new YubiKeySigningError(
      `${context}: no data line in gpg-connect-agent's response. Full transcript for debugging:\n${transcript}`
    );
  }
  return match.slice(2).trim();
}

export class YubiKeySigner implements KeySigner {
  readonly keySource: KeySource = 'yubikey';
  private cachedPublicKeyHex: string | null = null;

  /**
   * Confirms a card is present and reachable before attempting anything
   * else — fails with a specific, actionable message rather than letting a
   * missing card surface as a cryptic signing error three steps later.
   */
  static async detectCard(): Promise<{ serialNumber: string }> {
    const { stdout, ok } = await runGpgConnectAgent('SCD SERIALNO\nBYE\n');
    if (!ok) {
      throw new YubiKeyNotDetectedError(
        'No smartcard/YubiKey detected. Make sure it is plugged in, and that no other program (another gpg process, ' +
          'a browser extension, etc.) is holding an exclusive lock on it. Full response:\n' + stdout
      );
    }
    const serialLine = stdout.split('\n').find((line) => line.startsWith('S SERIALNO'));
    const serialNumber = serialLine ? serialLine.split(' ')[2] ?? 'unknown' : 'unknown';
    return { serialNumber };
  }

  async getPublicKeyHex(): Promise<string> {
    if (this.cachedPublicKeyHex) return this.cachedPublicKeyHex;
    // SCD READKEY returns the raw public key material for a given key slot.
    // OPENPGP.1 is GnuPG's standard name for the card's Signature key slot.
    const { stdout, ok } = await runGpgConnectAgent('SCD SERIALNO\nSCD READKEY OPENPGP.1\nBYE\n');
    if (!ok) {
      throw new YubiKeySigningError(`Could not read the public key off the card. Full response:\n${stdout}`);
    }
    const hex = extractDataLine(stdout, 'Reading YubiKey public key');
    // For an Ed25519 OpenPGP card key, READKEY's response is the raw
    // 32-byte public key point (possibly wrapped in a short S-expression
    // header depending on GnuPG version) — callers on real hardware should
    // verify this extraction actually yields exactly 64 hex chars (32
    // bytes) and adjust the parsing here if a given GnuPG version wraps it
    // differently. This is the single most likely spot to need a
    // real-hardware adjustment — see this file's header.
    const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
    const last64 = cleaned.slice(-64);
    if (last64.length !== 64) {
      throw new YubiKeySigningError(
        `Expected a 32-byte (64 hex char) Ed25519 public key from the card, got ${last64.length} hex chars. ` +
          `Raw response: ${hex}`
      );
    }
    this.cachedPublicKeyHex = last64.toLowerCase();
    return this.cachedPublicKeyHex;
  }

  /**
   * Signs `message` (in this system, always a 32-byte SHA-256 content
   * hash) using the card's Ed25519 signature key. Uses the low-level `SCD
   * PKSIGN` Assuan command — deliberately NOT `gpg --detach-sign`, which
   * would wrap the result in OpenPGP packet framing this project's
   * verifiers don't parse. PKSIGN signs exactly the bytes it's given; for
   * an EdDSA card key, that yields a standard, directly-verifiable 64-byte
   * Ed25519 signature.
   *
   * A physical touch on the YubiKey may be required here, depending on its
   * configured touch policy — gpg-connect-agent will simply appear to hang
   * until the touch happens (or the card times out), so a caller invoking
   * this from a UI should show a "touch your YubiKey now" prompt around
   * this call, not just a generic spinner.
   */
  async sign(message: Buffer): Promise<Buffer> {
    const hexMessage = message.toString('hex');
    const script = `SCD SERIALNO\nSCD SETDATA ${hexMessage}\nSCD PKSIGN OPENPGP.1\nBYE\n`;
    const { stdout, ok } = await runGpgConnectAgent(script);

    if (!ok) {
      const errLine = stdout.split('\n').find((line) => line.startsWith('ERR')) ?? stdout;
      throw new YubiKeySigningError(
        `The YubiKey refused to sign. This usually means a wrong/locked PIN, or the signing request was not ` +
          `confirmed with a touch in time. Raw error: ${errLine}`
      );
    }

    const hexSignature = extractDataLine(stdout, 'Signing with YubiKey');
    const cleaned = hexSignature.replace(/[^0-9a-fA-F]/g, '');
    const signature = Buffer.from(cleaned, 'hex');
    if (signature.length !== 64) {
      throw new YubiKeySigningError(
        `Expected a 64-byte raw Ed25519 signature from the card, got ${signature.length} bytes. This likely means ` +
          `GnuPG wrapped the response differently than expected on your version — see this file's header note on ` +
          `where to adjust the parsing. Raw response: ${hexSignature}`
      );
    }
    return signature;
  }

  describe(): string {
    return 'YubiKey (OpenPGP applet, Ed25519)';
  }
}
