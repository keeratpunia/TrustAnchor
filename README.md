# TrustAnchor

**A tamper-evident credential issuance and verification platform.**

TrustAnchor lets an institution (a university, a certifying body, etc.) issue physical or
printed documents — degrees, certificates, ID cards — that carry a QR code an offline-signed
Ed25519 signature. Anyone can then scan that QR with the verifier app and get a
cryptographically-grounded answer to "is this document genuine, unaltered, and not revoked?" —
without trusting the network, the server, or anything else in between.

The platform is built around a hard architectural rule: **the online server never holds a
private signing key, in any environment, at any time.** Every signature is produced offline,
ahead of time, by a dedicated CLI tool running on an air-gapped machine. The server's job is
reduced to pure storage and serving; a compromised server can, at worst, cause denial of service
or serve stale data — it can never forge a valid credential.

On top of that cryptographic core (**Engine 1**), TrustAnchor adds a second, independent layer
(**Engine 2**): visual/OCR document forensics that checks whether the *physical* document in
someone's hand actually matches the data Engine 1 already authenticated — catching photocopies,
edited scans, and mismatched printouts that a pure signature check can't.

## How it works, in one diagram

```
                    ┌──────────────────────┐
                    │   offline-signer      │   air-gapped machine
                    │   (CLI, holds keys)   │   — the ONLY place private
                    └──────────┬───────────┘     keys ever exist
                               │ signed credential / manifest
                               ▼
   ┌────────────────┐   ┌─────────────────┐   ┌──────────────────────┐
   │  admin-portal   │──▶│     backend      │◀──│   engine2-service     │
   │ (issuer/admin   │   │ (Express + Prisma │   │ (FastAPI + OpenCV +   │
   │  web console)   │   │  + PostgreSQL)    │   │  Tesseract OCR)       │
   └────────────────┘   │  storage & serving│   └──────────────────────┘
                         │  — holds NO keys  │
                         └────────┬─────────┘
                                  │ public REST APIs
                                  ▼
                         ┌──────────────────┐
                         │   verifier-app     │   scans the QR, runs the
                         │ (Expo / React      │   full verification algorithm
                         │  Native, on-device)│   on-device, trusts nothing
                         └──────────────────┘   it can't verify itself
```

## Packages

This is an npm-workspaces monorepo. Each package has its own detailed README — start here for
the big picture, then drill into the one you're touching.

| Package | Stack | Purpose |
|---|---|---|
| [`packages/shared`](packages/shared) | TypeScript | Canonical CBOR encoding, SHA-256 helpers, and the wire-format types shared byte-for-byte between the offline signer and the backend. |
| [`packages/offline-signer`](packages/offline-signer) | TypeScript / Node CLI | Generates Ed25519 keypairs and signs credentials & trust manifests. Designed to run on an air-gapped machine; can also be packaged as a standalone `.exe`/binary via `pkg`. |
| [`packages/backend`](packages/backend) | Express, TypeScript, Prisma, PostgreSQL | The Verification Server: stores credentials, assets, and the signed trust manifest; exposes REST APIs for verification, issuance, and the admin/issuer portal. Holds no signing key. |
| [`packages/engine2-service`](packages/engine2-service) | Python, FastAPI, OpenCV, Tesseract OCR | Document forensics microservice — perspective correction, multilingual OCR, template matching, asset verification, and confidence scoring for the physical document itself. |
| [`packages/admin-portal`](packages/admin-portal) | React, TypeScript, Vite | Web console for issuers and admins: document templates, OCR zone/asset configuration, batch issuance, key rotation, audit log, revocation requests. |
| [`packages/verifier-app`](packages/verifier-app) | Expo, React Native, TypeScript | Mobile app that scans a document's QR code and independently re-runs the full Engine 1 cryptographic verification on-device. |

`samples/` at the repo root ships real, already-generated demo data (an issuer keypair, a signed
credential, a signed manifest, and a scannable QR PNG) so you can try end-to-end verification
without generating your own keys first.

## Getting started

### Prerequisites

- Node.js ≥ 18
- Docker (for local PostgreSQL), or a PostgreSQL 16 instance of your own
- Python 3.10+ with `pip` (only if you're running `engine2-service`)
- Tesseract OCR with Hindi + Punjabi language packs (only for `engine2-service` — see its
  [README](packages/engine2-service/README.md) for OS-specific install steps)

### 1. Install JS/TS dependencies

```bash
npm install
```

This installs the `shared`, `offline-signer`, and `backend` workspaces from the root. The Expo
and Vite apps are installed separately since they don't play well with npm workspaces:

```bash
cd packages/verifier-app && npm install --legacy-peer-deps
cd ../admin-portal && npm install
```

### 2. Start PostgreSQL

```bash
npm run db:up
```

### 3. Configure the backend

```bash
cd packages/backend
cp .env.example .env
```

The defaults match `docker-compose.yml`'s Postgres instance. See [Environment
variables](#environment-variables) below for what each setting does.

### 4. Generate the Prisma client and run migrations

```bash
npm run generate --workspace=packages/backend
npm run backend:migrate
```

### 5. Seed sample data and start the backend

```bash
npm run backend:seed     # loads the bundled /samples data
npm run backend:dev      # starts on http://localhost:4000
```

Verify it's up: `curl http://localhost:4000/health`

### 6. (Optional) Start Engine 2

```bash
cd packages/engine2-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 7. Start the apps

```bash
# Verifier (mobile)
cd packages/verifier-app && npm start

# Admin / issuer portal (web)
cd packages/admin-portal && npm run dev
```

Scan `samples/sample-qr.png` with the verifier app (Expo Go or an emulator camera pointed at the
image on a second screen) to see a full AUTHENTIC verdict against the bundled sample data.

## Environment variables

Set in `packages/backend/.env` (see `.env.example` for the authoritative, commented version):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma-format PostgreSQL connection string |
| `PORT` | HTTP port the backend listens on (default `4000`) |
| `CORS_ORIGIN` | Allowed CORS origin(s); `*` for local dev only |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `PLATFORM_PUBLIC_KEY_HEX` | The platform trust key's **public** half — used for an optional sanity check on manifest ingestion. Public keys are safe to share. |
| `INGESTION_API_KEY` | Shared secret gating `POST /manifest`, `/credential`, `/asset` — ordinary operational access control, not a cryptographic boundary |
| `ENGINE2_SERVICE_URL` | Base URL of the Python `engine2-service`, used only by the Engine 2 verify route |
| `JWT_SECRET` | Signs ordinary portal login sessions for issuers/admins — **not** a credential-signing key |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Bootstrap admin account created by `npm run backend:seed` |

**By design, there is no private signing key anywhere in this file.** Every private key lives
exclusively on an offline machine running `@trustanchor/offline-signer`.

## Testing

```bash
# Backend: crypto core + full HTTP route behavior (mocked Prisma layer, no live DB needed)
npm run test --workspace=packages/backend

# Shared crypto primitives
npm run test --workspace=packages/shared

# Engine 2 pipeline (regenerates synthetic test fixtures first)
cd packages/engine2-service
python tests/generate_test_document.py
python -m pytest tests/ -v
```

## API surface

The backend exposes two API generations:

- **Engine 1 core** (`GET /manifest`, `GET /credential/:docId`, `GET /asset/:hash`,
  `GET /revocation`) — the minimal, frozen set of endpoints the verifier app needs for
  cryptographic verification. Full schemas in
  [`packages/backend/openapi.yaml`](packages/backend/openapi.yaml).
- **v2 / platform APIs** (`/v2/templates`, `/v2/verify`, `/v2/issuer-documents`,
  `/v2/credential-batch`, plus `/auth/*` and `/admin/*`) — issuer/admin authentication, document
  template management, batch issuance, Engine 2 verification, key rotation, revocation requests,
  and audit logging that power the admin portal. These are purely additive and never touched by
  the verifier app's core verification path.

## Security model

Every trusted object in the system — the Trust Manifest and every issued credential — is either
independently signed by an offline-held Ed25519 key (the manifest) or self-authenticating via a
content hash embedded in a QR code that only an offline key could have signed (credentials). The
verifier app trusts nothing it receives from the network without independently checking a
signature against a hardcoded public key on-device.

A compromised runtime server, database, or network grants an attacker **zero forgery
capability** — at absolute worst, denial of service or stale data. See the inline documentation
in `packages/verifier-app/src/engine1/engine1.ts` for exactly which attack each verification
step defeats.

> ⚠️ **Key hygiene:** files matching `*.key.json` are gitignored because they hold
> `privateKeyHex`. If you generate your own keys with `offline-signer`, keep the output **outside**
> this repo (or under a path that matches that pattern) — the only private keys that belong in
> version control are the clearly-labeled, public demo keys under `samples/`.

## License

`UNLICENSED` — private/internal project (see `package.json`). Update this section if you decide
to open-source the project.
