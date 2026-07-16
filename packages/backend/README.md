# @trustanchor/backend

The Verification Server — storage and serving ONLY. Holds no signing key of any kind, in any
environment, at any time.

## Setup

```bash
cp .env.example .env
# edit .env — defaults match docker-compose.yml's Postgres instance

npm run generate    # generates the Prisma client (needs internet, one-time)
npm run migrate      # applies prisma/migrations/20260101000000_init/migration.sql
npm run seed          # loads /samples into the database
npm run dev            # starts the dev server on PORT (default 4000)
```

## Tests

```bash
npm test                    # everything (66 tests)
npm run test:unit           # pure crypto/logic tests, no Express/DB involved
npm run test:integration    # full HTTP route behavior via supertest
```

See `tests/integration/fakePrisma.ts` for why integration tests mock the Prisma layer (short
version: it lets route logic — validation, status codes, hash/signature sanity checks — be tested
without a live database connection during CI, while the underlying SQL schema was separately
validated by hand against a real running PostgreSQL 16 instance).

## A real bug this test suite caught

`src/middleware/asyncHandler.ts` documents a genuine bug found during development: Express 4 does
not automatically forward errors thrown inside `async` route handlers to the error-handling
middleware. Several integration tests that expected a 400/404 response instead **timed out**,
because the thrown `ApiError` never reached `errorHandler.ts` — the request just hung. Every async
route handler in this codebase is wrapped with `asyncHandler(...)` to fix this; removing that
wrapper from any handler will silently reintroduce hanging requests on error paths.

## File map

```
src/
├── index.ts              # entry point — binds the Express app to a port
├── app.ts                # Express app assembly (CORS, JSON parsing, routes, error handler)
├── config/env.ts         # environment variable loading + validation
├── db/prisma.ts          # PrismaClient singleton
├── routes/
│   ├── manifest.ts       # GET/POST /manifest
│   ├── credential.ts     # GET/POST /credential/:docId
│   ├── asset.ts          # GET/POST /asset/:hash
│   └── revocation.ts     # GET /revocation — READ THE FILE HEADER before using this endpoint
├── middleware/
│   ├── errorHandler.ts   # centralized, secure error responses
│   ├── asyncHandler.ts   # the Express-4-async-errors fix (see above)
│   ├── ingestionAuth.ts  # shared-secret gate on POST endpoints (operational, not cryptographic)
│   └── validation.ts     # UUID/hex/ISO-date validators
└── utils/logger.ts       # minimal structured logger
```

## openapi.yaml

Full request/response schemas for all four required endpoints, including the critical scope note
on `GET /revocation` (it is a derived, unsigned convenience view — not part of the actual
cryptographic verification path). View it with any OpenAPI viewer, or import into Postman/Insomnia.
