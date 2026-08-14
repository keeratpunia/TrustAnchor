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
import React, { useState, useEffect } from 'react';
import { getTemplate, listMyTemplates, TemplateSummary } from '../lib/api';
import { ingestBatch, renderPdfBatch } from '../lib/issuerApi';
import { loadIssuerSession } from '../lib/auth';
import { parseAndValidateCsv, matchPhotosToRows, buildUnsignedBatch, CsvValidationError, PhotoMatch } from '../lib/csv';
import { downloadJson, downloadBlob } from '../lib/download';
import { TemplateDetail, SignedCredentialEntry } from '../lib/types';
import { Button, Card, Field, Input, Stepper } from '../components/ui';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import { useToast } from '../components/Toast';
import './wizard.css';

const STEPS = ['Choose Template', 'Upload CSV', 'Confirm Photos', 'Download Unsigned Batch', 'Upload Signed Batch', 'Done'];

export function BatchIssuance() {
  const [step, setStep] = useState(0);
  const { showSuccess, showError } = useToast();
  const session = loadIssuerSession();

  // Load available templates on mount so the issuer can pick one by name
  React.useEffect(() => {
    listMyTemplates()
      .then(setAvailableTemplates)
      .catch(() => setAvailableTemplates([]));
  }, []);

  const [availableTemplates, setAvailableTemplates] = useState<TemplateSummary[] | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
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

  const [unsignedDocIds, setUnsignedDocIds] = useState<Set<string>>(new Set());
  const [ingestSummary, setIngestSummary] = useState<{ ingested: string[]; failed: Array<{ docId?: string; error: string }> } | null>(null);
  const [renderSummary, setRenderSummary] = useState<{ renderedCount: number; failedCount: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedEntries, setSignedEntries] = useState<SignedCredentialEntry[] | null>(null);
  // docId -> fieldName -> File, computed when the unsigned batch is built,
  // kept in state to re-attach the SAME photo files once the signed batch
  // comes back — offline-signer never touches or renames these files.
  const [photosByDocId, setPhotosByDocId] = useState<Map<string, Map<string, File>>>(new Map());

  // Inline CSV editor state — lets issuers fill in 1-10 rows directly
  // on the portal without needing to create a CSV file externally.
  const [editorMode, setEditorMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [signerDownloaded, setSignerDownloaded] = useState(() => localStorage.getItem('ta_signer_downloaded') === '1');
  const [signerAvailable, setSignerAvailable] = useState<boolean | null>(null);

  React.useEffect(() => {
    // Verify the signer executable actually exists before offering it —
    // avoids handing the issuer a broken/corrupted download if the admin
    // hasn't placed the built .exe in public/signer/ yet.
    fetch('/signer/TrustAnchor-Signer.exe', { method: 'HEAD' })
      .then((res) => {
        const contentType = res.headers.get('content-type') || '';
        // A missing file falls back to index.html (text/html) in a Vite SPA —
        // that's the signal it's NOT actually there.
        setSignerAvailable(res.ok && !contentType.includes('text/html'));
      })
      .catch(() => setSignerAvailable(false));
  }, []);
  const [editorRows, setEditorRows] = useState<Record<string, string>[]>([]);

  const initEditorRows = () => {
    if (!template) return;
    const fieldNames = template.ocrZones.map((z) => z.fieldName);
    const emptyRow: Record<string, string> = {};
    fieldNames.forEach((f) => { emptyRow[f] = ''; });
    setEditorRows([{ ...emptyRow }]);
    setEditorMode(true);
  };

  const addEditorRow = () => {
    if (!template) return;
    const fieldNames = template.ocrZones.map((z) => z.fieldName);
    const emptyRow: Record<string, string> = {};
    fieldNames.forEach((f) => { emptyRow[f] = ''; });
    setEditorRows((rows) => [...rows, { ...emptyRow }]);
  };

  const removeEditorRow = (index: number) => {
    setEditorRows((rows) => rows.filter((_, i) => i !== index));
  };

  const updateEditorCell = (rowIndex: number, field: string, value: string) => {
    setEditorRows((rows) => rows.map((row, i) => i === rowIndex ? { ...row, [field]: value } : row));
  };

  const submitEditorRows = () => {
    if (!template) return;
    // Build a CSV string from the editor rows and feed it through the same validation
    const fieldNames = template.ocrZones.map((z) => z.fieldName);
    const header = fieldNames.join(',');
    const dataLines = editorRows.map((row) =>
      fieldNames.map((f) => {
        const val = row[f] || '';
        // Escape CSV: wrap in quotes if contains comma, newline, or quote
        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
          return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',')
    );
    const csvText = header + '\n' + dataLines.join('\n');
    const result = parseAndValidateCsv(csvText, template.ocrZones, template.photoZones);
    setCsvErrors(result.errors);
    setCsvWarnings(result.warnings);
    setCsvRows(result.rows);
    if (result.errors.length === 0) {
      setStep(template.photoZones.length > 0 ? 2 : 3);
    }
  };

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
    // Remember which doc_ids we generated, so we can verify the signed
    // batch the issuer uploads is actually for THIS batch, not an old one.
    setUnsignedDocIds(new Set(payloads.map((p: any) => p.doc_id)));
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

      // Verify the signed batch matches the unsigned batch we generated
      if (unsignedDocIds.size > 0) {
        const signedIds = new Set(entries.map((e) => e.payload?.doc_id || e.docId));
        const missing = [...unsignedDocIds].filter((id) => !signedIds.has(id));
        const extra = [...signedIds].filter((id) => !unsignedDocIds.has(id));
        if (missing.length > 0 || extra.length > 0) {
          const msg = [
            'This signed batch does not match the unsigned batch from this session.',
            missing.length > 0 ? `Missing ${missing.length} document(s) that were in the unsigned batch.` : '',
            extra.length > 0 ? `Contains ${extra.length} document(s) that were NOT in the unsigned batch.` : '',
            'Make sure you are uploading the signed_batch.json that was produced from the unsigned batch downloaded in the previous step.',
          ].filter(Boolean).join(' ');
          throw new Error(msg);
        }
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
      <div className="page-eyebrow">Template Studio</div>
      <h1 className="page-title">Batch Issuance</h1>
      <p className="page-subtitle" style={{ marginBottom: 28 }}>
        Turn a spreadsheet of students into signed, printable credentials. Signing itself always happens offline
        on your own machine — this screen prepares the file to sign, and turns the signed result into documents.
      </p>

      <Stepper steps={STEPS} currentIndex={step} />

      {step === 0 && (
        <Card>
          {availableTemplates === null ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ color: 'var(--slate-500)' }}>Loading your templates…</p>
            </div>
          ) : availableTemplates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>No templates found</p>
              <p style={{ color: 'var(--slate-500)', fontSize: 13 }}>
                Create a template first via "New Template" in the sidebar, then come back here to issue documents against it.
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13.5, marginBottom: 16 }}>
                Select the template you want to issue documents for:
              </p>
              <div className="template-picker-grid">
                {availableTemplates.map((t) => (
                  <div
                    key={`${t.templateId}-${t.version}`}
                    className={`template-picker-card ${selectedTemplateKey === `${t.templateId}-${t.version}` ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedTemplateKey(`${t.templateId}-${t.version}`);
                      setTemplateId(t.templateId);
                      setTemplateVersion(String(t.version));
                    }}
                  >
                    <div className="tpc-name">{t.name}</div>
                    <div className="tpc-meta">v{t.version} · {t.ocrZoneCount} field(s)</div>
                  </div>
                ))}
              </div>
              <Button variant="primary" onClick={handleFetchTemplate} disabled={!selectedTemplateKey || loadingTemplate}>
                {loadingTemplate ? 'Loading…' : 'Continue with Selected Template'}
              </Button>
            </>
          )}
        </Card>
      )}

      {step === 1 && template && (
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{template.name}</div>
          <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 18 }}>
            Required fields: {template.ocrZones.filter((z) => z.isMandatory).map((z) => z.fieldName).join(', ') || 'none declared'}
          </p>

          {!editorMode ? (
            <>
              {/* Option A: Upload a CSV file */}
              <label className="drop-zone" style={{ display: 'block' }}>
                <div className="drop-zone-title">Upload CSV File</div>
                <div className="drop-zone-hint">One row per credential — column headers must match the field names above.</div>
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleCsvChosen(e.target.files[0])} />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '20px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
              </div>

              {/* Option B: Fill in directly */}
              <div
                onClick={initEditorRows}
                style={{
                  border: '2px dashed var(--brass-500)',
                  borderRadius: 'var(--radius-md)',
                  padding: '20px 24px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'background 0.12s',
                  background: 'rgba(168,130,61,0.04)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,130,61,0.10)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,130,61,0.04)'; }}
              >
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Fill in Directly</div>
                <div style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>
                  Issuing just a few documents? Type the details right here — no spreadsheet needed.
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Inline CSV editor */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Enter Credential Details</span>
                  <span style={{ fontSize: 12, color: 'var(--slate-500)', marginLeft: 8 }}>
                    {editorRows.length} row{editorRows.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditorMode(false); setEditorRows([]); setCsvErrors([]); }}>
                  Switch to CSV Upload
                </button>
              </div>

              {editorRows.length > 10 && (
                <div style={{ fontSize: 12, color: 'var(--review-600)', marginBottom: 12, padding: '8px 12px', background: 'var(--review-100)', borderRadius: 'var(--radius-sm)' }}>
                  For more than 10 rows, we recommend uploading a CSV file instead — it's faster and less error-prone.
                </div>
              )}

              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table className="csv-editor-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36, textAlign: 'center' }}>#</th>
                      {template.ocrZones.map((z) => (
                        <th key={z.fieldName}>
                          {z.fieldName}
                          {z.isMandatory && <span style={{ color: 'var(--alert-600)', marginLeft: 2 }}>*</span>}
                        </th>
                      ))}
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editorRows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        <td style={{ textAlign: 'center', color: 'var(--slate-500)', fontSize: 12 }}>{rowIdx + 1}</td>
                        {template.ocrZones.map((z) => (
                          <td key={z.fieldName}>
                            <input
                              value={row[z.fieldName] || ''}
                              onChange={(e) => updateEditorCell(rowIdx, z.fieldName, e.target.value)}
                              placeholder={z.fieldName}
                            />
                          </td>
                        ))}
                        <td>
                          {editorRows.length > 1 && (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '2px 6px', fontSize: 14, color: 'var(--alert-600)' }}
                              onClick={() => removeEditorRow(rowIdx)}
                              title="Remove row"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Button variant="secondary" onClick={addEditorRow}>
                  + Add Row
                </Button>
                <Button
                  variant="primary"
                  onClick={submitEditorRows}
                  disabled={editorRows.every((r) => template!.ocrZones.filter((z) => z.isMandatory).some((z) => !r[z.fieldName]?.trim()))}
                >
                  Continue with {editorRows.length} Document{editorRows.length !== 1 ? 's' : ''}
                </Button>
              </div>
            </>
          )}

          {csvErrors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {csvErrors.map((e, i) => (
                <div key={i} className="field-error">{e.message}</div>
              ))}
            </div>
          )}
          {csvErrors.length === 0 && csvWarnings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--review-600)', marginBottom: 6 }}>
                {csvWarnings.length} thing(s) worth double-checking (not blocking):
              </div>
              {csvWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--review-600)', marginBottom: 4 }}>{w.message}</div>
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
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Sign Your Documents</div>

          {/* Signer app download/launch prompt */}
          {signerAvailable === false ? (
            <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', borderRadius: 'var(--radius-md)', padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#991b1b' }}>Signer app not available yet</div>
              <p style={{ fontSize: 13, color: '#b91c1c', lineHeight: 1.6, marginBottom: 0 }}>
                The TrustAnchor Signer download isn't set up on this deployment yet. Your administrator needs to
                build it (<code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>npm run build:signer</code> in
                {' '}<code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>packages/offline-signer</code>) and place
                it in <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>packages/admin-portal/public/signer/</code>.
                In the meantime, see the <button onClick={() => document.querySelector<HTMLButtonElement>('[data-signing-guide]')?.click()} style={{ background: 'none', border: 'none', color: '#991b1b', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}>Signing Guide</button> for manual signing instructions.
              </p>
            </div>
          ) : !signerDownloaded ? (
            <div style={{ background: 'linear-gradient(135deg, rgba(168,130,61,0.08) 0%, rgba(168,130,61,0.03) 100%)', border: '2px solid var(--brass-500)', borderRadius: 'var(--radius-md)', padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>First time? Download the signing app</div>
              <p style={{ fontSize: 13, color: 'var(--slate-500)', lineHeight: 1.6, marginBottom: 14 }}>
                You need the <strong>TrustAnchor Signer</strong> — a small app that signs your documents
                using your YubiKey. Download it once, and it works every time.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <a
                  href="/signer/TrustAnchor-Signer.exe"
                  download
                  onClick={() => { setSignerDownloaded(true); localStorage.setItem('ta_signer_downloaded', '1'); }}
                  className="btn btn-primary"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  Download for Windows
                </a>
                <a
                  href="/signer/TrustAnchor-Signer-mac"
                  download
                  onClick={() => { setSignerDownloaded(true); localStorage.setItem('ta_signer_downloaded', '1'); }}
                  className="btn btn-secondary"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  Download for Mac
                </a>
              </div>
              <button
                onClick={() => { setSignerDownloaded(true); localStorage.setItem('ta_signer_downloaded', '1'); }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--slate-500)', cursor: 'pointer', padding: 0, marginTop: 10, textDecoration: 'underline' }}
              >
                I already have it installed
              </button>
            </div>
          ) : (
            <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#166534' }}>Open the TrustAnchor Signer app on your computer now.</div>
                <div style={{ fontSize: 12.5, color: '#15803d', marginTop: 2 }}>It will find the unsigned file automatically and walk you through signing.</div>
              </div>
              <button
                onClick={() => { setSignerDownloaded(false); localStorage.removeItem('ta_signer_downloaded'); }}
                style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--slate-500)', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}
              >
                Need to re-download?
              </button>
            </div>
          )}

          <p style={{ fontSize: 13, color: 'var(--slate-500)', lineHeight: 1.7, marginBottom: 20 }}>
            Once the signer app says "All documents signed!", upload the result below.
            First time? Check the <button onClick={() => document.querySelector<HTMLButtonElement>('[data-signing-guide]')?.click()} style={{ background: 'none', border: 'none', color: 'var(--brass-500)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}>Signing Guide</button>.
          </p>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            <div style={{ display: 'flex', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Plug in your YubiKey</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>Insert it into any USB port on your computer.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Open the TrustAnchor Signer app</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                  <strong>Windows:</strong> Double-click <code style={{ background: 'var(--slate-100)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>TrustAnchor-Signer.exe</code><br />
                  <strong>Mac:</strong> Double-click <code style={{ background: 'var(--slate-100)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>TrustAnchor-Signer</code>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>The app finds your file and detects your YubiKey</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                  It automatically looks for <code style={{ background: 'var(--slate-100)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>unsigned_batch.json</code> in your Downloads folder. Just press Enter to confirm.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>4</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Touch your YubiKey when it blinks</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                  Your YubiKey's light will start blinking — touch the metal contact to authorize each signature.
                  If it asks for a PIN, enter the one your administrator gave you.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, padding: '16px 0' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>5</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Upload the signed file below</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                  When the app says "All documents signed!", come back here and upload <code style={{ background: 'var(--slate-100)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>signed_batch.json</code> — it's in your Downloads folder, right next to the unsigned one.
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <label className="drop-zone" style={{ display: 'block' }}>
              <div className="drop-zone-title">Upload signed_batch.json</div>
              <div className="drop-zone-hint">The file the signer app just created.</div>
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleSignedBatchChosen(e.target.files[0])} />
            </label>
          </div>
          {submitting && <p style={{ color: 'var(--slate-500)', marginTop: 14 }}>Ingesting and rendering PDFs...</p>}
        </Card>
      )}

      {step === 5 && ingestSummary && (
        <Card>
          {/* Success banner */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#166534', marginBottom: 8 }}>
              {ingestSummary.ingested.length} Document{ingestSummary.ingested.length !== 1 ? 's' : ''} Issued Successfully!
            </div>
            <p style={{ fontSize: 13.5, color: '#15803d', lineHeight: 1.7, marginBottom: 0 }}>
              Your signed credentials have been generated and a <strong>.zip file</strong> has been
              downloaded to your computer. Here's what's inside:
            </p>
            <ul style={{ fontSize: 13, color: '#15803d', lineHeight: 1.8, margin: '10px 0 0', paddingLeft: 18 }}>
              <li><strong>One PDF per document</strong> — each has the credential details printed on it with a QR code embedded</li>
              <li>The QR code is what a verifier scans to check the document's authenticity</li>
              <li><strong>Print these PDFs</strong> and distribute them to the document holders (students, employees, etc.)</li>
            </ul>
          </div>

          <div style={{ background: 'var(--parchment-100)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 16, fontSize: 13, color: 'var(--slate-500)' }}>
            <strong style={{ color: 'var(--ink-900)' }}>Where's the zip?</strong> Check your browser's Downloads bar at the bottom of the screen,
            or open your Downloads folder. The file is named something like <code style={{ background: 'var(--slate-100)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>{template?.name?.replace(/\s+/g, '_')}_credentials.zip</code>.
            Extract/unzip it to see the individual PDF files.
          </div>

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
      {/* Bottom navigation — Back / Next */}
      {step < 5 && (
        <div className="wizard-nav">
          <Button
            variant="secondary"
            icon={<IconChevronLeft size={16} />}
            onClick={() => {
              if (step === 1 && editorMode) {
                setEditorMode(false);
                setEditorRows([]);
              }
              setStep((s) => Math.max(0, s - 1));
              setCsvErrors([]);
              setCsvWarnings([]);
            }}
            disabled={step === 0}
          >
            Back
          </Button>
          <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
            Step {step + 1} of {STEPS.length}
          </div>
          {step === 0 && (
            <Button variant="primary" onClick={handleFetchTemplate} disabled={!selectedTemplateKey || loadingTemplate}>
              {loadingTemplate ? 'Loading…' : <>Next <IconChevronRight size={16} /></>}
            </Button>
          )}
          {step > 0 && step < 5 && (
            <div style={{ width: 100 }} />
          )}
        </div>
      )}
    </div>
  );
}
