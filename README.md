# TrustAnchor Engine 1

A production-quality implementation of **Engine 1** — the deterministic cryptographic
verification layer for tamper-evident physical documents — built exactly to the frozen
architecture specification.

> **Scope:** This implements ONLY Engine 1 (cryptographic verification). Engine 2 (visual/OCR
> document forensics) is explicitly out of scope, as specified.

## The one-sentence architecture

A thin QR code (~150 bytes) carries an Ed25519 signature over a document's content hash. The
Verification Server holds **no signing key of any kind, in any environment, at any time** — every
signature was produced offline, ahead of time, by a dedicated CLI tool. The server is pure storage
and serving; the verifier app trusts nothing it receives from the network without independently
checking a signature against a hardcoded public key.

## Why this design — read this before touching the crypto code

The authoritative design rationale for every decision here — what's signed, what's hashed, why the
runtime holds no keys, why revocation lives inside the manifest rather than a separate artifact —
is documented inline as comments in the source, especially:

- `packages/shared/src/canonicalCbor.ts` — why canonical CBOR, rule by rule
- `packages/backend/src/routes/revocation.ts` — why `GET /revocation` is a derived convenience
  view and NOT part of the actual verification algorithm
- `packages/verifier-app/src/engine1/engine1.ts` — the complete verification algorithm, step by
  step, each step referencing the exact attack it defeats
- `packages/backend/src/middleware/asyncHandler.ts` — a real bug this project's own test suite
  caught (Express 4 doesn't auto-forward async errors) and the fix

## Project structure

```
trustanchor-engine1/
├── packages/
│   ├── shared/              # Canonical CBOR encoder, SHA-256, payload codecs, types
│   │                         #   (used by backend AND offline-signer)
│   ├── offline-signer/      # CLI: keygen, sign-credential, sign-manifest, generate-qr
│   │                         #   NEVER run this on a networked machine
│   ├── backend/             # Express + TypeScript + Prisma + PostgreSQL
│   │                         #   Storage & serving ONLY — holds no signing key
│   └── verifier-app/        # Expo + React Native + TypeScript
│                             #   Scans QR, runs Engine 1, shows the verdict
├── samples/                  # Real generated demo data (issuer key, signed
│                              #   credential, signed manifest, QR PNG)
├── docker-compose.yml
└── package.json               # npm workspaces root
```

## Quick start

### 1. Install dependencies

```bash
npm install
```

This installs all workspace packages (`shared`, `offline-signer`, `backend`) from the root. The
`verifier-app` is an Expo project and is installed separately (Expo/Metro doesn't play well with
npm workspaces):

```bash
cd packages/verifier-app && npm install --legacy-peer-deps
```

### 2. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 3. Configure the backend

```bash
cd packages/backend
cp .env.example .env
```

Edit `.env` if needed — the defaults work with the `docker-compose.yml` Postgres instance.

### 4. Run migrations and generate the Prisma client

```bash
npm run generate --workspace=packages/backend
npm run migrate --workspace=packages/backend
```

> **Note:** this requires internet access to download Prisma's query engine binary (a one-time
> download, cached afterward). This is a normal requirement on any real developer machine.

### 5. Try the sample data, or generate your own

This repo ships **real, already-generated** sample data in `/samples` — a genuine issuer keypair,
a signed credential, a signed trust manifest, and a scannable QR PNG, all produced by actually
running the offline-signer CLI. Seed the database with them:

```bash
npm run seed --workspace=packages/backend
```

To generate your **own** fresh demo data instead (recommended once you're past initial testing):

```bash
cd packages/offline-signer

# Generate an issuer key and a platform trust key
npx ts-node src/cli.ts keygen --label "My University" --out ../../samples/issuer-key.json
npx ts-node src/cli.ts keygen --label "My Platform" --out ../../samples/platform-key.json

# Edit samples/sample-credential-unsigned.json and samples/sample-manifest-unsigned.json
# with your own data, then:

npx ts-node src/cli.ts sign-credential \
  --payload ../../samples/sample-credential-unsigned.json \
  --key ../../samples/issuer-key.json \
  --out ../../samples/sample-credential-signed.json

npx ts-node src/cli.ts sign-manifest \
  --manifest ../../samples/sample-manifest-unsigned.json \
  --key ../../samples/platform-key.json \
  --out ../../samples/sample-manifest-signed.json

npx ts-node src/cli.ts generate-qr \
  --signed ../../samples/sample-credential-signed.json \
  --out ../../samples/sample-qr.png \
  --terminal
```

**If you generate your own platform key**, update
`packages/verifier-app/src/config.ts`'s `PLATFORM_PUBLIC_KEY_HEX` to match — the app will reject
every manifest otherwise (correctly — that's the whole point).

### 6. Start the backend

```bash
npm run dev --workspace=packages/backend
```

Verify it's running: `curl http://localhost:4000/health`

### 7. Start the verifier app

```bash
cd packages/verifier-app
npm start
```

Scan `samples/sample-qr.png` (displayed on a second screen, or printed) with the Expo Go app on
your phone, or with an emulator's camera pointed at a monitor showing the PNG.

## Running tests

```bash
# Crypto core + backend route logic (66 tests)
npm run test --workspace=packages/backend

# Just the pure crypto unit tests
npx jest tests/unit --workspace=packages/backend
```

The backend test suite mocks the Prisma data-access layer (see
`packages/backend/tests/integration/fakePrisma.ts` for why — and why this doesn't compromise test
validity) so the full HTTP route behavior, input validation, and cryptographic sanity checks are
exercised without requiring a live database connection during CI runs. The underlying SQL schema
was separately validated by actually running the migration against a real PostgreSQL 16 instance.

## The four required APIs

| Endpoint | Purpose |
|---|---|
| `GET /manifest` | Fetch the current offline-signed Trust Manifest |
| `GET /credential/:docId` | Fetch a credential's raw payload by document ID |
| `GET /asset/:hash` | Fetch a raw asset by content hash (reserved for Engine 2; not called by Engine 1) |
| `GET /revocation` | **Convenience, unsigned, derived view only** — see the loud comment in `routes/revocation.ts` before using this for anything security-relevant |

Full request/response schemas: [`packages/backend/openapi.yaml`](./packages/backend/openapi.yaml)

## Security model, in one paragraph

The runtime server, the database, the network, and even a fully reverse-engineered copy of the
verifier app grant an attacker **zero forgery capability**. Every trusted object — the Trust
Manifest and every credential — is either independently signed by an offline-held Ed25519 key
(manifest) or self-authenticating via a hash embedded in a QR that only an offline key could have
signed (credential). A compromised runtime can, at absolute worst, cause denial of service or serve
stale data — never a false ACCEPT. See the inline comments throughout `packages/verifier-app/src/engine1/engine1.ts`
for exactly which attack each of the eleven verification steps defeats.

## What's NOT included (by design)

- **Engine 2** (visual/OCR document forensics) — explicitly out of scope for this build.
- **A hardware offline signer** — the offline-signer CLI runs as ordinary Node.js/TypeScript for
  this implementation. In a real deployment, run it on an air-gapped machine, ideally with the
  private key material held on a hardware token (e.g. a YubiKey via PKCS#11) rather than a plain
  JSON file — the CLI's key-handling code is structured so that swapping the signing step for a
  hardware call is a small, isolated change (see `offline-signer/src/signCredential.ts` and
  `signManifest.ts`).
- **Stolen-key mass-forgery containment** (an issuance log / `valid_docs` allow-list) — this
  defends against a threat (issuer private key compromise) explicitly excluded from this build's
  threat model. See the frozen specification for why this is a deliberate scope boundary, not an
  oversight.
