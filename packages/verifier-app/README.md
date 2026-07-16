# TrustAnchor Verifier App

Scans a document's QR code and runs the complete Engine 1 cryptographic verification algorithm
entirely on-device, against self-authenticating server data.

## Run it

```bash
npm install --legacy-peer-deps
npm start
```

Then scan the QR with Expo Go (physical device) or a simulator/emulator camera pointed at
`../../samples/sample-qr.png`.

## Before running against your own backend

`src/config.ts`'s `API_BASE_URL` is **auto-detected** — no manual IP configuration needed for
normal development. It reads the address the phone already used to download the JS bundle from
Metro (`Constants.expoConfig.hostUri`) and reuses that same reachable IP with the backend's port
(4000). This is what fixes the classic "`localhost` doesn't work on a physical phone" problem: on
a real device, `localhost` refers to the phone itself, not your computer.

If you need to point at a different backend (e.g. a deployed server, or the backend isn't on port
4000), edit `BACKEND_PORT` or `PRODUCTION_API_BASE_URL` in `src/config.ts` directly.

Also edit:

- `PLATFORM_PUBLIC_KEY_HEX` — must match the platform trust key your backend's manifest was signed
  with. The bundled value matches `samples/platform-key.json`.

## Architecture

All cryptographic logic lives under `src/engine1/` and is a **from-scratch, dependency-minimal
reimplementation** of the same algorithms in `packages/shared` — not a cross-package import. React
Native (Expo/Metro) and the Node.js backend are different JavaScript runtimes; keeping the
cryptographic core self-contained in each avoids any bundler-specific resolution risk for the part
of the codebase where a subtle bug would be most costly.

This is not just an assertion — the two implementations are proven byte-identical by a
cross-implementation test suite performed during development: the backend generates and signs real
sample data, and this app's own hashing/CBOR code is checked to reproduce the exact same bytes and
successfully verify the exact same Ed25519 signature. See the project root's development history
for the specific test commands; the key files to inspect are:

- `src/engine1/canonicalCbor.ts` — byte-identical to `packages/shared/src/canonicalCbor.ts`
- `src/engine1/qrCodec.ts` — decodes the exact QR format `packages/shared/src/qrCodec.ts` encodes
- `src/engine1/engine1.ts` — the complete 11-step verification algorithm

## Screens

- `src/screens/ScanScreen.tsx` — camera view, QR detection, hands raw bytes to Engine 1
- `src/screens/ResultScreen.tsx` — shows the verdict, the full step-by-step verification trace, and
  (only when AUTHENTIC) the cryptographically-verified field values
