/**
 * csv.ts — parses an issuer's CSV and validates it against a template's
 * declared OCR zones, then matches per-document photos to rows.
 * ============================================================================
 * Validation happens ENTIRELY client-side, before any network call — a
 * missing/malformed column shows up immediately, with the exact row
 * number, rather than after a wasted round trip (see the workflow
 * report's §3.4 step 2).
 *
 * PHOTO MATCHING — BY UNIQUE ID, NOT BY NAME: each PhotoZone declares a
 * `matchByField` (e.g. "roll_no") naming an ALREADY-DECLARED OCR zone.
 * Batch issuance looks up that field's value for each CSV row, then finds
 * an uploaded image file named exactly "<that value>.<extension>" — no
 * separate "photo filename" CSV column needed at all. This is
 * deliberately NOT matched by student name: two students can share a
 * name (or initials), but a roll number/registration ID is designed to be
 * unique, so it's the only trustworthy join key here.
 */
import Papa from 'papaparse';
import { generateUuid } from './uuid';
import { OcrZoneSummary, PhotoZoneSummary, UnsignedCredentialPayload } from './types';

export interface CsvValidationError {
  row: number; // 1-indexed, matching a spreadsheet's row numbers (header = row 1)
  message: string;
}

export interface CsvValidationResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: CsvValidationError[];
  /** Non-blocking — surfaced to the issuer, but don't prevent continuing. */
  warnings: CsvValidationError[];
}

/**
 * Parses raw CSV text and checks every mandatory OCR zone's fieldName has
 * a matching, non-empty column in every row. Also runs two non-blocking
 * sanity checks that have caught real mistakes in practice:
 *   - duplicate values in any field used as a photo-zone matchByField key
 *     (a duplicate there means two students would silently get the SAME
 *     photo, since matching is by that value — this is the single most
 *     consequential thing to catch before signing, so it's checked even
 *     though nothing else here assumes fields must be unique)
 *   - a column that's almost entirely numeric (e.g. a CGPA/roll number)
 *     but has a few non-numeric values, which usually means a typo, not a
 *     deliberate exception
 */
export function parseAndValidateCsv(csvText: string, ocrZones: OcrZoneSummary[], photoZones: PhotoZoneSummary[] = []): CsvValidationResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const rows = parsed.data;
  const errors: CsvValidationError[] = [];
  const warnings: CsvValidationError[] = [];

  if (rows.length === 0) {
    errors.push({ row: 1, message: 'CSV has no data rows — only a header, or nothing at all.' });
    return { headers, rows, errors, warnings };
  }

  const mandatoryFields = ocrZones.filter((z) => z.isMandatory).map((z) => z.fieldName);
  const missingColumns = mandatoryFields.filter((f) => !headers.includes(f));
  if (missingColumns.length > 0) {
    errors.push({ row: 1, message: `CSV is missing required column(s): ${missingColumns.join(', ')}` });
    return { headers, rows, errors, warnings };
  }

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 for 1-indexing, +1 for the header row itself
    for (const field of mandatoryFields) {
      if (!row[field] || row[field].trim() === '') {
        errors.push({ row: rowNum, message: `Row ${rowNum}: "${field}" is empty.` });
      }
    }
  });

  // Duplicate-key check — only for fields a photo zone actually matches
  // by, since that's the one place a duplicate silently causes a real,
  // hard-to-notice mistake (the wrong student's photo on a document).
  const matchFields = Array.from(new Set(photoZones.map((p) => p.matchByField).filter((f): f is string => !!f)));
  for (const field of matchFields) {
    const seen = new Map<string, number>(); // value -> first row number seen
    rows.forEach((row, i) => {
      const value = row[field]?.trim();
      if (!value) return;
      const rowNum = i + 2;
      if (seen.has(value)) {
        warnings.push({
          row: rowNum,
          message: `Row ${rowNum}: "${field}" value "${value}" is a duplicate of row ${seen.get(value)} — both would be matched to the SAME photo file.`,
        });
      } else {
        seen.set(value, rowNum);
      }
    });
  }

  // Numeric-consistency check — only for columns that are ALREADY mostly
  // numeric, so this never flags a genuinely text-only field like a name.
  for (const field of headers) {
    const values = rows.map((r) => r[field]?.trim()).filter((v): v is string => !!v);
    if (values.length < 3) continue; // too few rows to tell "mostly numeric" from coincidence
    const numericCount = values.filter((v) => /^-?\d+(\.\d+)?$/.test(v)).length;
    const ratio = numericCount / values.length;
    if (ratio >= 0.8 && ratio < 1) {
      rows.forEach((row, i) => {
        const value = row[field]?.trim();
        if (value && !/^-?\d+(\.\d+)?$/.test(value)) {
          warnings.push({ row: i + 2, message: `Row ${i + 2}: "${field}" value "${value}" isn't numeric, unlike almost every other row in this column — check for a typo.` });
        }
      });
    }
  }

  return { headers, rows, errors, warnings };
}

export interface PhotoMatch {
  row: number;
  matchKey: string;
  fieldName: string;
  file: File | null; // null if no matching file was found
}

/**
 * For every row and every declared photo zone, looks up the row's
 * matchByField value and finds an uploaded file named "<value>.<ext>"
 * (case-insensitive, trimmed, extension-agnostic). Returns one entry per
 * row-per-zone, matched or not — the caller (a visual confirm grid) shows
 * every one of these, matched or missing, rather than silently guessing.
 */
export function matchPhotosToRows(
  rows: Record<string, string>[],
  photoZones: PhotoZoneSummary[],
  selectedFiles: File[]
): PhotoMatch[] {
  // Index files by their name MINUS extension, lowercased — "2023001002.jpg" -> "2023001002".
  const filesByStem = new Map<string, File>();
  for (const file of selectedFiles) {
    const stem = file.name.replace(/\.[^./\\]+$/, '').trim().toLowerCase();
    filesByStem.set(stem, file);
  }

  const matches: PhotoMatch[] = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    for (const zone of photoZones) {
      const matchKey = (row[zone.matchByField ?? ''] ?? '').trim();
      const file = matchKey ? filesByStem.get(matchKey.toLowerCase()) ?? null : null;
      matches.push({ row: rowNum, matchKey, fieldName: zone.fieldName, file });
    }
  });
  return matches;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface BuiltBatch {
  payloads: UnsignedCredentialPayload[];
  /** docId -> fieldName -> the actual photo File, for uploading alongside ingestion/rendering later. */
  photosByDocId: Map<string, Map<string, File>>;
}

/**
 * Builds one unsigned CredentialPayload per CSV row — the exact shape
 * offline-signer's `sign-batch` command expects as input. `docId` is
 * generated fresh per row; everything else comes from the row's own
 * columns plus the template/issuer context. Every matched photo is hashed
 * here (SHA-256) and written into `asset_hashes`, so the hash becomes
 * part of what gets signed — the actual image bytes travel separately,
 * later, alongside the signed batch (see BatchIssuance.tsx).
 */
export async function buildUnsignedBatch(params: {
  rows: Record<string, string>[];
  issuerId: string;
  templateId: string;
  templateVersion: number;
  templateHash: string;
  ocrZoneFieldNames: string[];
  photoZones: PhotoZoneSummary[];
  photoMatches: PhotoMatch[];
  issuedAt: string;
  expiresAt: string | null;
}): Promise<BuiltBatch> {
  const photosByDocId = new Map<string, Map<string, File>>();

  // Index resolved matches by (row, fieldName) for quick lookup per row below.
  const matchIndex = new Map<string, File>();
  for (const m of params.photoMatches) {
    if (m.file) matchIndex.set(`${m.row}:${m.fieldName}`, m.file);
  }

  const payloads = await Promise.all(
    params.rows.map(async (row, i) => {
      const rowNum = i + 2;
      const fields: Record<string, string> = {};
      for (const fieldName of params.ocrZoneFieldNames) {
        if (row[fieldName] !== undefined) fields[fieldName] = row[fieldName];
      }

      const docId = generateUuid();
      const asset_hashes: Record<string, string> = {};
      const docPhotos = new Map<string, File>();

      for (const zone of params.photoZones) {
        const file = matchIndex.get(`${rowNum}:${zone.fieldName}`);
        if (!file) continue; // unmatched — already surfaced by the confirm grid; don't crash the whole batch here
        asset_hashes[zone.fieldName] = await sha256Hex(file);
        docPhotos.set(zone.fieldName, file);
      }
      if (docPhotos.size > 0) photosByDocId.set(docId, docPhotos);

      return {
        v: 1 as const,
        issuer_id: params.issuerId,
        doc_id: docId,
        template_id: params.templateId,
        template_version: params.templateVersion,
        issued_at: params.issuedAt,
        expires_at: params.expiresAt,
        fields,
        asset_hashes,
        template_hash: params.templateHash,
      };
    })
  );

  return { payloads, photosByDocId };
}
