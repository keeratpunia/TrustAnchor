# TrustAnchor Engine 1 — Backend Dockerfile
#
# Multi-stage build: compile TypeScript in a build stage, then copy only
# the compiled output + production dependencies into a slim runtime image.
# This keeps the final image small and avoids shipping TypeScript source,
# devDependencies, or build tooling into production.

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

# Copy the whole monorepo (workspaces need the root package.json + all
# packages present to resolve @trustanchor/shared correctly).
COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Install all workspace dependencies (including devDependencies, needed for
# the TypeScript compiler in this stage).
RUN npm install

# Build the shared package first (backend depends on its compiled output).
RUN npm run build --workspace=packages/shared

# Generate the Prisma client (requires network access to fetch the query
# engine — this happens at image-build time, on whatever machine builds the
# image, not inside this sandboxed development environment).
RUN npm run generate --workspace=packages/backend

# Compile the backend TypeScript.
RUN npm run build --workspace=packages/backend

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy compiled output and production node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/prisma ./packages/backend/prisma
COPY --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=build /app/packages/backend/node_modules/.prisma ./packages/backend/node_modules/.prisma

EXPOSE 4000

WORKDIR /app/packages/backend

CMD ["node", "dist/index.js"]
