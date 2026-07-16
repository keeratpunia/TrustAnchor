/**
 * fakePrisma.ts — an in-memory stand-in for PrismaClient, used only in
 * integration tests.
 *
 * WHY THIS EXISTS: these tests exercise the actual Express route handlers
 * (validation, status codes, hash/signature sanity checks, error handling)
 * end-to-end through supertest, without requiring a live PostgreSQL
 * connection during automated test runs. It implements the exact subset of
 * the Prisma Client API surface routes/*.ts actually calls, backed by plain
 * in-memory Maps.
 *
 * This is a standard "mock the ORM" testing pattern — it does not replace
 * the need to run `npm run migrate:dev` against a real PostgreSQL database
 * before actually operating this server; see README.md.
 *
 * ENGINE 2 ADDITIONS (template, templateAsset, ocrZone, engine2Verification)
 * are purely additive below — the four Engine 1 fakes above are completely
 * unchanged, matching the Freeze Specification's "zero modification to
 * Engine 1" requirement applied to test infrastructure as well as
 * production code.
 */

interface FakeTable<T> {
  data: Map<string, T>;
}

/** Builds the composite key fakePrisma uses for Template's (templateId, version) primary key. */
function templateKey(templateId: string, version: number): string {
  return `${templateId}::${version}`;
}

export function createFakePrisma() {
  const documents: FakeTable<any> = { data: new Map() };
  const credentialAssets: FakeTable<any> = { data: new Map() };
  const currentManifest: FakeTable<any> = { data: new Map() };
  const templates: FakeTable<any> = { data: new Map() };
  const templateAssets: FakeTable<any> = { data: new Map() };
  const ocrZones: FakeTable<any> = { data: new Map() };
  const engine2Verifications: FakeTable<any> = { data: new Map() };

  return {
    document: {
      findUnique: async ({ where }: { where: { docId: string } }) => documents.data.get(where.docId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = documents.data.get(where.docId);
        const value = existing ? { ...existing, ...update } : { ...create };
        documents.data.set(where.docId, value);
        return value;
      },
    },
    credentialAsset: {
      findUnique: async ({ where }: { where: { contentHash: string } }) =>
        credentialAssets.data.get(where.contentHash) ?? null,
      upsert: async ({ where, create }: any) => {
        if (!credentialAssets.data.has(where.contentHash)) {
          credentialAssets.data.set(where.contentHash, { ...create });
        }
        return credentialAssets.data.get(where.contentHash);
      },
    },
    currentManifest: {
      findUnique: async ({ where }: { where: { id: number } }) => currentManifest.data.get(String(where.id)) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = currentManifest.data.get(String(where.id));
        const value = existing ? { ...existing, ...update } : { ...create };
        currentManifest.data.set(String(where.id), value);
        return value;
      },
    },

    // ── Engine 2 models (purely additive) ──

    template: {
      findUnique: async ({ where, include }: any) => {
        const key = templateKey(where.templateId_version.templateId, where.templateId_version.version);
        const row = templates.data.get(key);
        if (!row) return null;
        const result = { ...row };
        if (include?.assets) {
          result.assets = Array.from(templateAssets.data.values()).filter(
            (a: any) => a.templateId === row.templateId && a.templateVersion === row.version
          );
        }
        if (include?.ocrZones) {
          result.ocrZones = Array.from(ocrZones.data.values()).filter(
            (z: any) => z.templateId === row.templateId && z.templateVersion === row.version
          );
        }
        return result;
      },
      upsert: async ({ where, create, update }: any) => {
        const key = templateKey(where.templateId_version.templateId, where.templateId_version.version);
        const existing = templates.data.get(key);
        const value = existing ? { ...existing, ...update } : { ...create };
        templates.data.set(key, value);
        return value;
      },
    },
    templateAsset: {
      create: async ({ data }: any) => {
        const id = data.id ?? `asset-${templateAssets.data.size + 1}`;
        const row = { ...data, id };
        templateAssets.data.set(id, row);
        return row;
      },
    },
    ocrZone: {
      create: async ({ data }: any) => {
        const id = data.id ?? `zone-${ocrZones.data.size + 1}`;
        const row = { ...data, id };
        ocrZones.data.set(id, row);
        return row;
      },
    },
    engine2Verification: {
      create: async ({ data }: any) => {
        const id = `verification-${engine2Verifications.data.size + 1}`;
        const row = { ...data, id, createdAt: new Date() };
        engine2Verifications.data.set(id, row);
        return row;
      },
      findMany: async ({ where }: any) => {
        return Array.from(engine2Verifications.data.values())
          .filter((v: any) => v.docId === where.docId)
          .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
      },
    },

    /** Test helper: directly seed the fake manifest table, bypassing HTTP. */
    __seedManifest(manifestBlob: any) {
      currentManifest.data.set('1', { id: 1, manifestBlob, receivedAt: new Date() });
    },
    /** Test helper: directly seed a document, bypassing HTTP. */
    __seedDocument(doc: any) {
      documents.data.set(doc.docId, doc);
    },
    /** Test helper: directly seed a template (with optional assets/zones), bypassing HTTP. */
    __seedTemplate(template: any, assets: any[] = [], zones: any[] = []) {
      const key = templateKey(template.templateId, template.version);
      templates.data.set(key, template);
      for (const asset of assets) {
        templateAssets.data.set(asset.id ?? `${asset.assetName}-${templateAssets.data.size}`, {
          ...asset,
          templateId: template.templateId,
          templateVersion: template.version,
        });
      }
      for (const zone of zones) {
        ocrZones.data.set(zone.id ?? `${zone.fieldName}-${ocrZones.data.size}`, {
          ...zone,
          templateId: template.templateId,
          templateVersion: template.version,
        });
      }
    },
    /** Test helper: clear all in-memory tables between tests, for isolation. */
    __reset() {
      documents.data.clear();
      credentialAssets.data.clear();
      currentManifest.data.clear();
      templates.data.clear();
      templateAssets.data.clear();
      ocrZones.data.clear();
      engine2Verifications.data.clear();
    },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
