-- ============================================================================
-- Migration: 20260103000000_engine2_tables
-- Adds Engine 2's four tables: templates, template_assets, ocr_zones,
-- engine2_verifications.
-- ============================================================================
--
-- ZERO CHANGES to any Engine 1 table (documents, credential_assets,
-- current_manifest, issuers) in this migration. This is intentional and
-- required per the Engine 1 Freeze Specification §20 — Engine 2 is purely
-- additive. If a future edit to this file ever touches an ALTER TABLE
-- statement against one of the four frozen tables, that is a violation of
-- the freeze and should be rejected in review.
--
-- See packages/backend/prisma/schema.prisma's comments on each Engine 2
-- model, and Engine2_Architecture.md §6, for why each table is shaped this
-- way.

-- CreateTable: templates
-- Composite primary key (template_id, version) — a template is versioned,
-- and a credential's template_version field (already present in Engine 1's
-- CredentialPayload, previously unused) selects exactly one row here.
CREATE TABLE "templates" (
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "issuer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout_json" JSONB NOT NULL,
    "template_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("template_id", "version")
);

CREATE INDEX "templates_issuer_id_idx" ON "templates"("issuer_id");

-- CreateTable: template_assets
-- Per-template static reference assets (logo, seal, signature) — distinct
-- from Engine 1's credential_assets, which is per-CREDENTIAL (schema.prisma
-- comment on TemplateAsset explains the distinction in full).
CREATE TABLE "template_assets" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "asset_name" TEXT NOT NULL,
    "bounding_box" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_assets_template_id_template_version_idx"
    ON "template_assets"("template_id", "template_version");

-- CreateTable: ocr_zones
-- Declared field regions + expected language(s) per template. Multilingual
-- support (English/Hindi/Punjabi/mixed) is driven entirely by this table's
-- `languages` array — no hardcoded language logic anywhere in the schema.
CREATE TABLE "ocr_zones" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "field_name" TEXT NOT NULL,
    "bounding_box" JSONB NOT NULL,
    "languages" TEXT[] NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ocr_zones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ocr_zones_template_id_template_version_idx"
    ON "ocr_zones"("template_id", "template_version");

-- CreateTable: engine2_verifications
-- One row per Engine 2 verification attempt, for audit/history.
-- `engine1_status` is a SNAPSHOT for the audit trail only — never re-read
-- as a trust decision (schema.prisma's comment on Engine2Verification).
CREATE TABLE "engine2_verifications" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "engine1_status" TEXT NOT NULL,
    "engine2_verdict" TEXT NOT NULL,
    "overall_verdict" TEXT NOT NULL,
    "report_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine2_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "engine2_verifications_doc_id_idx" ON "engine2_verifications"("doc_id");

-- AddForeignKey: template_assets -> templates
ALTER TABLE "template_assets" ADD CONSTRAINT "template_assets_template_id_template_version_fkey"
    FOREIGN KEY ("template_id", "template_version") REFERENCES "templates"("template_id", "version")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ocr_zones -> templates
ALTER TABLE "ocr_zones" ADD CONSTRAINT "ocr_zones_template_id_template_version_fkey"
    FOREIGN KEY ("template_id", "template_version") REFERENCES "templates"("template_id", "version")
    ON DELETE RESTRICT ON UPDATE CASCADE;
