/**
 * BatchIssuance.tsx — CSV -> unsigned batch -> (offline sign) -> ingest -> PDFs.
 * ============================================================================
 * Implements the workflow report's §3.4 step by step. The one thing this
 * screen can NEVER do is sign anything — every signature comes from a file
 * the issuer generates themselves with `offline-signer sign-batch`, on
 * their own machine. This screen's job is everything around that: turning
 * a CSV into the exact unsigned JSON that command expects, and turning its
 * signed output into ingested documents + printable PDFs.
 *
 * PER-DOCUMENT PHOTOS (e.g. student_photo): matched by a UNIQUE ID field
 * (e.g. roll_no), never by name — two students can share a name. Each
 * template's PhotoZone declares which OCR zone is the match key; the
 * issuer's photo files just need to be named "<that value>.jpg" (or any
 * extension). A visual confirm grid — thumbnail next to each row — lets
 * the issuer catch a wrong/missing match before anything gets signed,
 * without needing to trust a typed filename string blindly.
 */
import React, { useState } from 'react';
import { getTemplate } from '../lib/api';
import { ingestBatch, renderPdfBatch } from '../lib/issuerApi';
import { loadIssuerSession } from '../lib/auth';
import { parseAndValidateCsv, matchPhotosToRows, buildUnsignedBatch, CsvValidationError, PhotoMatch } from '../lib/csv';
import { downloadJson, downloadBlob } from '../lib/download';
import { TemplateDetail, SignedCredentialEntry } from '../lib/types';
import { Button, Card, Field, Input, Stepper } from '../components/ui';
import { useToast } from '../components/Toast';

const STEPS = ['Choose Template', 'Upload CSV', 'Confirm Photos', 'Download Unsigned Batch', 'Upload Signed Batch', 'Done'];

export function BatchIssuance() {
  const [step, setStep] = useState(0);
  const { showSuccess, showError } = useToast();
  const session = loadIssuerSession();

  const [templateId, setTemplateId] = useState('');
  const [templateVersion, setTemplateVersion] = useState('1');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<CsvValidationError[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<CsvValidationError[]>([]);
  const [photoMatches, setPhotoMatches] = useState<PhotoMatch[]>([]);
  const [photoThumbUrls, setPhotoThumbUrls] = useState<Map<File, string>>(new Map());
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState('');

  const [ingestSummary, setIngestSummary] = useState<{ ingested: string[]; failed: Array<{ docId?: string; error: string }> } | null>(null);
  const [renderSummary, setRenderSummary] = useState<{ renderedCount: number; failedCount: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedEntries, setSignedEntries] = useState<SignedCredentialEntry[] | null>(null);
  // docId -> fieldName -> File, computed when the unsigned batch is built,
  // kept in state to re-attach the SAME photo files once the signed batch
  // comes back — offline-signer never touches or renames these files.
  const [photosByDocId, setPhotosByDocId] = useState<Map<string, Map<string, File>>>(new Map());

  const hasPhotoZones = (template?.photoZones.length ?? 0) > 0;
  const unmatchedMandatoryCount = photoMatches.filter((m) => !m.file && template?.photoZones.find((p) => p.fieldName === m.fieldName)?.isMandatory).length;

  const handleFetchTemplate = async () => {
    setLoadingTemplate(true);
    try {
      const t = await getTemplate(templateId.trim(), parseInt(templateVersion, 10));
      setTemplate(t);
      setStep(1);
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleCsvChosen = async (file: File) => {
    const text = await file.text();
    const result = parseAndValidateCsv(text, template!.ocrZones, template!.photoZones);
    setCsvErrors(result.errors);
    setCsvWarnings(result.warnings);
    setCsvRows(result.rows);
    if (result.errors.length === 0) {
      // Templates with no photo zones skip straight past the photo-confirm step.
      setStep(template!.photoZones.length > 0 ? 2 : 3);
    }
  };

  const handlePhotosChosen = (files: FileList) => {
    const selected = Array.from(files);
    const matches = matchPhotosToRows(csvRows, template!.photoZones, selected);
    setPhotoMatches(matches);
    const thumbs = new Map<File, string>();
    for (const m of matches) {
      if (m.file && !thumbs.has(m.file)) thumbs.set(m.file, URL.createObjectURL(m.file));
    }
    setPhotoThumbUrls(thumbs);
  };

  const handleDownloadUnsigned = async () => {
    const { payloads, photosByDocId: builtPhotos } = await buildUnsignedBatch({
      rows: csvRows,
      issuerId: session!.account.issuerId!,
      templateId: template!.templateId,
      templateVersion: template!.version,
      templateHash: template!.templateHash,
      ocrZoneFieldNames: template!.ocrZones.map((z) => z.fieldName),
      photoZones: template!.photoZones,
      photoMatches,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    setPhotosByDocId(builtPhotos);
    downloadJson(payloads, 'unsigned_batch.json');
    setStep(4);
  };

  const handleSignedBatchChosen = async (file: File) => {
    try {
      const text = await file.text();
      const entries: SignedCredentialEntry[] = JSON.parse(text);
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('That file does not look like a signed batch — expected a non-empty JSON array.');
      }
      setSignedEntries(entries);
      setSubmitting(true);
      const result = await ingestBatch(entries, photosByDocId);
      setIngestSummary(result);
      showSuccess(result.message);
      // Ingestion succeeding is real progress regardless of what happens
      // next — move to the Done step now, not after the PDF attempt below,
      // so a PDF-rendering failure can never hide the fact that the
      // documents are already safely ingested.
      setStep(5);

      if (result.ingested.length > 0) {
        try {
          const { zip, summary } = await renderPdfBatch(entries, photosByDocId);
          downloadBlob(zip, `${template!.name.replace(/\s+/g, '_')}_credentials.zip`);
          if (summary) setRenderSummary(summary);
        } catch (renderErr) {
          setRenderError((renderErr as Error).message);
          showError(`Documents were ingested, but PDF rendering failed: ${(renderErr as Error).message}`);
        }
      }
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryPdf = async () => {
    if (!signedEntries) return;
    setSubmitting(true);
    setRenderError(null);
    try {
      const { zip, summary } = await renderPdfBatch(signedEntries, photosByDocId);
      downloadBlob(zip, `${template!.name.replace(/\s+/g, '_')}_credentials.zip`);
      if (summary) setRenderSummary(summary);
      showSuccess('PDF zip downloaded.');
    } catch (err) {
      setRenderError((err as Error).message);
      showError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Batch Issuance</h1>
      <p className="page-subtitle" style={{ marginBottom: 28 }}>
        Turn a spreadsheet of students into signed, printable credentials. Signing itself always happens offline
        on your own machine — this screen prepares the file to sign, and turns the signed result into documents.
      </p>

      <Stepper steps={STEPS} currentIndex={step} />

      {step === 0 && (
        <Card style={{ maxWidth: 480 }}>
          <Field label="Template ID">
            <Input value={templateId} onChange={(e) => setTemplateId(e.target.value)} mono placeholder="UUID" />
          </Field>
          <Field label="Version">
            <Input type="number" min={1} value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={handleFetchTemplate} disabled={!templateId.trim() || loadingTemplate}>
            {loadingTemplate ? 'Loading…' : 'Continue'}
          </Button>
        </Card>
      )}

      {step === 1 && template && (
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{template.name}</div>
          <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 6 }}>
            Required columns: {template.ocrZones.filter((z) => z.isMandatory).map((z) => z.fieldName).join(', ') || 'none declared'}
          </p>
          {hasPhotoZones && (
            <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 18 }}>
              {template.photoZones.map((p) => (
                <span key={p.fieldName}>
                  Photos for "{p.fieldName}" will be matched by <strong>{p.matchByField}</strong> — name each photo
                  file exactly that value (e.g. "2023001002.jpg"), not the student's name.
                </span>
              ))}
            </p>
          )}
          <label className="drop-zone" style={{ display: 'block' }}>
            <div className="drop-zone-title">Upload CSV</div>
            <div className="drop-zone-hint">One row per credential — column headers must match the field names above.</div>
            <input type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleCsvChosen(e.target.files[0])} />
          </label>
          {csvErrors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {csvErrors.map((e, i) => (
                <div key={i} className="field-error">
                  {e.message}
                </div>
              ))}
            </div>
          )}
          {csvErrors.length === 0 && csvWarnings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--review-600)', marginBottom: 6 }}>
                {csvWarnings.length} thing(s) worth double-checking (not blocking):
              </div>
              {csvWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--review-600)', marginBottom: 4 }}>
                  {w.message}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {step === 2 && template && (
        <Card>
          <p style={{ fontSize: 13.5, marginBottom: 16 }}>
            Select every photo referenced by {template.photoZones.map((p) => `"${p.matchByField}"`).join(', ')} — you
            can select them all at once. Each one is matched to a row automatically by its unique ID filename.
          </p>
          <label className="drop-zone" style={{ display: 'block', marginBottom: 20 }}>
            <div className="drop-zone-title">Upload Photos</div>
            <div className="drop-zone-hint">Select all the image files at once — matched by filename, not order.</div>
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => e.target.files && e.target.files.length > 0 && handlePhotosChosen(e.target.files)}
            />
          </label>

          {photoMatches.length > 0 && (
            <>
              <div className="summary-label" style={{ marginBottom: 10 }}>
                Confirm every match before continuing
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {photoMatches.map((m, i) => (
                  <div
                    key={i}
                    className="list-item"
                    style={{ borderColor: m.file ? 'var(--hairline)' : 'var(--alert-600)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {m.file ? (
                        <img
                          src={photoThumbUrls.get(m.file)}
                          alt=""
                          style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--hairline)' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 6,
                            border: '1.5px dashed var(--alert-600)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            color: 'var(--alert-600)',
                            textAlign: 'center',
                          }}
                        >
                          none
                        </div>
                      )}
                      <div>
                        <div className="list-item-title">
                          Row {m.row} — {m.fieldName}
                        </div>
                        <div className="list-item-meta mono">
                          expecting: {m.matchKey || '(empty)'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {unmatchedMandatoryCount > 0 ? (
                <p className="field-error" style={{ marginBottom: 16 }}>
                  {unmatchedMandatoryCount} mandatory photo(s) unmatched — add the missing file(s) or rename them to
                  match, then re-select all photos above.
                </p>
              ) : (
                <Button variant="primary" onClick={() => setStep(3)}>
                  Confirmed — Continue
                </Button>
              )}
            </>
          )}
        </Card>
      )}

      {step === 3 && template && (
        <Card style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13.5, marginBottom: 16 }}>
            <strong>{csvRows.length}</strong> row(s) validated successfully against <strong>{template.name}</strong>.
          </p>
          <Field label="Issued At">
            <Input type="datetime-local" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </Field>
          <Field label="Expires At" hint="Optional">
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={handleDownloadUnsigned}>
            Download Unsigned Batch
          </Button>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <p style={{ fontSize: 13.5, marginBottom: 16, lineHeight: 1.7 }}>
            Run this on your own machine, with your YubiKey plugged in:
          </p>
          <pre className="mono" style={{ background: 'var(--ink-900)', color: '#e2e8f0', padding: '14px 16px', borderRadius: 10, fontSize: 12, overflowX: 'auto', marginBottom: 20 }}>
            {`npx ts-node src/cli.ts sign-batch \\\n  --payloads unsigned_batch.json \\\n  --key my-issuer-key.json \\\n  --out signed_batch.json \\\n  --qr-dir ./qr-codes/`}
          </pre>
          <label className="drop-zone" style={{ display: 'block' }}>
            <div className="drop-zone-title">Upload signed_batch.json</div>
            <div className="drop-zone-hint">The file that command just produced.</div>
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleSignedBatchChosen(e.target.files[0])} />
          </label>
          {submitting && <p style={{ color: 'var(--slate-500)', marginTop: 14 }}>Ingesting and rendering PDFs…</p>}
        </Card>
      )}

      {step === 5 && ingestSummary && (
        <Card>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--verified-600)', marginBottom: 10 }}>
            Ingested {ingestSummary.ingested.length} credential(s).
          </p>
          {ingestSummary.failed.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--alert-600)', marginBottom: 6 }}>
                {ingestSummary.failed.length} failed:
              </div>
              {ingestSummary.failed.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  {f.docId ?? '(unknown)'}: {f.error}
                </div>
              ))}
            </div>
          )}
          {renderSummary && (
            <p style={{ fontSize: 13, color: 'var(--slate-500)' }}>
              PDF zip downloaded — {renderSummary.renderedCount} rendered, {renderSummary.failedCount} failed.
            </p>
          )}
          {renderError && (
            <div style={{ marginTop: 10, marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--alert-600)', fontWeight: 600, marginBottom: 8 }}>
                Your documents were ingested successfully, but generating the PDF zip failed: {renderError}
              </p>
              <Button variant="secondary" onClick={handleRetryPdf} disabled={submitting}>
                {submitting ? 'Retrying…' : 'Retry PDF Generation'}
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>
            Issue Another Batch
          </Button>
        </Card>
      )}
    </div>
  );
}
