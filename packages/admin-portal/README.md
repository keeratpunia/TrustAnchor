# TrustAnchor Template Studio

The admin/issuer web app for configuring Engine 2 document templates —
layout, OCR zones, and reference assets (logo, seal, signature) — without
writing code or hand-crafting JSON.

This app adds **zero new backend endpoints**. It is a UI on top of the
existing `packages/backend/src/routes/v2/templates.ts` API:

- `POST /v2/templates`
- `POST /v2/templates/:templateId/:version/ocr-zones`
- `POST /v2/templates/:templateId/:version/assets`
- `GET /v2/templates/:templateId/:version`

## Running it

```bash
cd packages/admin-portal
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL, then go to **Settings** and
point it at your running backend (default `http://localhost:4000`). If
your backend has `INGESTION_API_KEY` set, enter the same value here — it's
sent as a `Bearer` token, exactly what
`packages/backend/src/middleware/ingestionAuth.ts` expects.

## The core workflow

**New Template** is a six-step wizard:

1. **Details** — template ID, version, issuer ID, name.
2. **Reference Photo** — upload a real (or sample) photo/scan of the
   document. Its pixel dimensions become the template's coordinate space
   (`layoutJson.page_width`/`page_height`) — the same space
   `app/pipeline/homography.py` aligns every captured phone photo into.
3. **QR Position** — draw a box around the QR code.
4. **OCR Zones** — draw a box around each printed field to compare
   against the issued record; name it, pick its language(s), mark
   mandatory/optional.
5. **Reference Assets** (optional) — draw a box around a logo, seal, or
   signature. The exact pixels are cropped client-side from the reference
   photo and uploaded as that asset's reference image.
6. **Review & Submit** — everything above is sent to the backend in
   sequence: create the template, declare each OCR zone, upload each
   asset.

**Look Up Template** fetches an existing template's full configuration by
its exact ID and version (`GET /v2/templates/:id/:version`).

**Dashboard** shows templates created or viewed *in this browser* —
there's no "list every template" backend endpoint (a deliberate, minimal
API surface), so this is explicitly a local convenience list, not a
server-backed one. Look Up is the real source of truth for anything not
remembered here.

## Design notes

The visual language is drawn from the subject this tool actually serves —
verifying physical academic credentials — rather than a generic admin
dashboard: ink/parchment/brass tones, a serif display face with real
character (Fraunces), and an annotation canvas styled with print-industry
registration marks and evidence-tag-style labels. See
`src/styles/tokens.css` for the full token system.
