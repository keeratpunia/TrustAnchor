/**
 * NewTemplateWizard.tsx — the core workflow: create a template's metadata,
 * upload a reference photo of the document, then draw the QR position,
 * OCR zones, and reference assets directly on it, and submit everything
 * to the existing /v2/templates* API in sequence.
 * ============================================================================
 * Every box drawn here is captured in the reference image's NATURAL pixel
 * dimensions (see ZoneCanvas.tsx's header) — those same dimensions become
 * layoutJson's page_width/page_height, so there is exactly one coordinate
 * space in play across this entire wizard, matching what
 * app/pipeline/homography.py aligns every captured phone photo into.
 */
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ChipSelect, Field, Input, Stepper, Toggle } from '../components/ui';
import { ZoneCanvas, CanvasBox } from '../components/ZoneCanvas';
import { SealStamp } from '../components/SealStamp';
import { IconChevronLeft, IconChevronRight, IconTrash, IconUpload } from '../components/icons';
import { generateUuid } from '../lib/uuid';
import { loadIssuerSession } from '../lib/auth';
import { createTemplate, declareOcrZone, declarePhotoZone, uploadAsset, ApiError } from '../lib/api';
import { rememberTemplate } from '../lib/recentTemplates';
import { AssetDraft, BoundingBox, OcrZoneDraft, PhotoZoneDraft } from '../lib/types';
import { useToast } from '../components/Toast';
import './wizard.css';

// Photo Zones and Reference Assets steps are commented out — non-textual
// field verification is out of scope for the current submission. The code
// is preserved below (search for "OUT_OF_SCOPE") so it can be re-enabled
// when non-textual verification is brought back in.
const STEP_LABELS = ['Details', 'Reference Photo', 'QR Position', 'OCR Zones', 'Review & Submit'];
const ZONE_COLORS = ['#2f7a78', '#3f4c8c', '#9c4f63', '#a8823d', '#5b7a4f', '#6b4c7a'];
const QR_COLOR = '#a63a34';
/**
 * A QR that looks fine as a PDF preview on a monitor can still be
 * genuinely too small once printed and photographed by a phone at normal
 * scanning distance — this is a real, reported failure mode ("no QR code
 * detected"), not a hypothetical one. 12% of the page's SHORTER side is a
 * conservative floor; an admin can always draw it bigger.
 */
const MIN_QR_SIZE_FRACTION = 0.12;
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pa', label: 'Punjabi' },
];

function colorForIndex(i: number): string {
  return ZONE_COLORS[i % ZONE_COLORS.length];
}

function boxToCorners(box: BoundingBox): number[][] {
  // Top-left, top-right, bottom-right, bottom-left — the same convention
  // this project's own test fixtures (test_data/ground_truth.json) use.
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];
}

function waitForImageReady(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('Reference image failed to load.')), { once: true });
  });
}

function cropToBlob(image: HTMLImageElement, box: BoundingBox): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, box.width);
  canvas.height = Math.max(1, box.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not get a 2D canvas context.'));
  ctx.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not crop the reference image.'))), 'image/png');
  });
}

export function NewTemplateWizard() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { showError } = useToast();

  // ---- Step 1: details ----
  const [templateId, setTemplateId] = useState(generateUuid());
  const [version, setVersion] = useState(1);
  // If a real issuer is logged in, the template belongs to THEM —
  // issuerId comes from their own session, never a manually-typed field
  // (see templatesAuth.ts's identical rule on the backend). Only an admin
  // (no issuer session) still picks/generates one manually.
  const loggedInIssuer = loadIssuerSession();
  const [issuerId, setIssuerId] = useState(loggedInIssuer?.account.issuerId ?? generateUuid());
  const [name, setName] = useState('');

  // ---- Step 2: reference photo ----
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const cropImgRef = useRef<HTMLImageElement>(null);

  // ---- Step 3: QR position ----
  const [qrBox, setQrBox] = useState<BoundingBox | null>(null);
  const [qrSizeError, setQrSizeError] = useState<string | null>(null);

  // ---- Step 4: OCR zones ----
  const [zones, setZones] = useState<OcrZoneDraft[]>([]);
  const [pendingZoneBox, setPendingZoneBox] = useState<BoundingBox | null>(null);
  const [draftFieldName, setDraftFieldName] = useState('');
  const [draftLanguages, setDraftLanguages] = useState<string[]>(['en']);
  const [draftMandatory, setDraftMandatory] = useState(true);

  // ---- Step 4: photo zones (per-document dynamic images, e.g. student photo) ----
  const [photoZones, setPhotoZones] = useState<PhotoZoneDraft[]>([]);
  const [pendingPhotoZoneBox, setPendingPhotoZoneBox] = useState<BoundingBox | null>(null);
  const [draftPhotoFieldName, setDraftPhotoFieldName] = useState('');
  const [draftPhotoMandatory, setDraftPhotoMandatory] = useState(true);
  const [draftPhotoMatchByField, setDraftPhotoMatchByField] = useState('');

  // ---- Step 5: assets ----
  const [assets, setAssets] = useState<AssetDraft[]>([]);
  const [pendingAssetBox, setPendingAssetBox] = useState<BoundingBox | null>(null);
  const [draftAssetName, setDraftAssetName] = useState('');
  const [draftAssetMandatory, setDraftAssetMandatory] = useState(true);

  // ---- Step 6: submission ----
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ templateHash: string } | null>(null);

  const contextBoxes: CanvasBox[] = useMemo(() => {
    const list: CanvasBox[] = [];
    if (qrBox) list.push({ id: 'qr', box: qrBox, color: QR_COLOR, label: 'QR Code' });
    zones.forEach((z, i) => list.push({ id: z.localId, box: z.box, color: z.color, label: z.fieldName || `Zone ${i + 1}` }));
    photoZones.forEach((p, i) => list.push({ id: p.localId, box: p.box, color: p.color, label: p.fieldName || `Photo ${i + 1}` }));
    return list;
  }, [qrBox, zones, photoZones]);

  const handleFileChosen = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setImageUrl(url);
      setImageFile(file);
    };
    img.src = url;
  };

  const handleQrDraw = (box: BoundingBox) => {
    const minSide = Math.min(naturalWidth, naturalHeight) * MIN_QR_SIZE_FRACTION;
    if (box.width < minSide || box.height < minSide) {
      setQrSizeError(
        `That's too small to scan reliably once printed — draw it at least ${Math.round(minSide)}×${Math.round(minSide)}px (currently ${Math.round(box.width)}×${Math.round(box.height)}px). A QR that looks fine on screen can still fail for a phone camera at normal scanning distance.`
      );
      return;
    }
    setQrSizeError(null);
    setQrBox(box);
  };

  const handleAddZone = () => {
    if (!pendingZoneBox || !draftFieldName.trim() || draftLanguages.length === 0) return;
    setZones((z) => [
      ...z,
      {
        localId: generateUuid(),
        fieldName: draftFieldName.trim(),
        box: pendingZoneBox,
        languages: draftLanguages,
        isMandatory: draftMandatory,
        color: colorForIndex(z.length),
      },
    ]);
    setPendingZoneBox(null);
    setDraftFieldName('');
    setDraftLanguages(['en']);
    setDraftMandatory(true);
  };

  const handleAddPhotoZone = () => {
    if (!pendingPhotoZoneBox || !draftPhotoFieldName.trim() || !draftPhotoMatchByField) return;
    setPhotoZones((p) => [
      ...p,
      {
        localId: generateUuid(),
        fieldName: draftPhotoFieldName.trim(),
        box: pendingPhotoZoneBox,
        isMandatory: draftPhotoMandatory,
        matchByField: draftPhotoMatchByField,
        color: colorForIndex(zones.length + p.length),
      },
    ]);
    setPendingPhotoZoneBox(null);
    setDraftPhotoFieldName('');
    setDraftPhotoMandatory(true);
    setDraftPhotoMatchByField('');
  };

  const handleAddAsset = () => {
    if (!pendingAssetBox || !draftAssetName.trim()) return;
    setAssets((a) => [
      ...a,
      {
        localId: generateUuid(),
        assetName: draftAssetName.trim(),
        box: pendingAssetBox,
        isMandatory: draftAssetMandatory,
        color: colorForIndex(zones.length + photoZones.length + a.length),
      },
    ]);
    setPendingAssetBox(null);
    setDraftAssetName('');
    setDraftAssetMandatory(true);
  };

  const handleSubmit = async () => {
    if (!qrBox || !naturalWidth || !naturalHeight) return;
    setSubmitting(true);
    try {
      setSubmitProgress('Creating template…');
      const result = await createTemplate({
        templateId,
        version,
        issuerId,
        name,
        layoutJson: { page_width: naturalWidth, page_height: naturalHeight, qr_position: boxToCorners(qrBox) },
        backgroundImage: imageFile ?? undefined,
      });

      for (const zone of zones) {
        setSubmitProgress(`Declaring OCR zone "${zone.fieldName}"…`);
        await declareOcrZone(templateId, version, {
          fieldName: zone.fieldName,
          boundingBox: zone.box,
          languages: zone.languages,
          isMandatory: zone.isMandatory,
        });
      }

      // OUT_OF_SCOPE: Photo zone and asset declarations are skipped for now.
      // Non-textual field verification is out of scope for this submission.
      // Uncomment these blocks when that functionality is brought back.
      /*
      for (const photoZone of photoZones) {
        setSubmitProgress(\`Declaring photo zone "\${photoZone.fieldName}"…\`);
        await declarePhotoZone(templateId, version, {
          fieldName: photoZone.fieldName,
          boundingBox: photoZone.box,
          isMandatory: photoZone.isMandatory,
          matchByField: photoZone.matchByField,
        });
      }

      for (const asset of assets) {
        setSubmitProgress(\`Uploading reference asset "\${asset.assetName}"…\`);
        await waitForImageReady(cropImgRef.current!);
        const blob = await cropToBlob(cropImgRef.current!, asset.box);
        await uploadAsset(templateId, version, {
          assetName: asset.assetName,
          boundingBox: asset.box,
          isMandatory: asset.isMandatory,
          file: blob,
          fileName: \`\${asset.assetName}.png\`,
        });
      }
      */

      // Automatically upload the FULL reference photo itself as the
      // reserved "template_skeleton" asset (engine2-service/app/main.py's
      // SKELETON_ASSET_NAME) — this is the exact image every OCR zone,
      // asset box, and the QR position were drawn against, so using it
      // as the Tier 3 / Stage 4 alignment reference pulls a captured
      // photo's alignment into agreement with the SAME coordinate space
      // the zones were declared in, correcting drift across the whole
      // page rather than only near the QR. isMandatory is always false —
      // it's never scored as a verifiable asset, only consumed as an
      // alignment reference (see main.py's SKELETON_ASSET_NAME handling).
      // OUT_OF_SCOPE: template_skeleton asset upload (used for asset alignment)
      // Uncomment when non-textual verification is back in scope.
      /*
      if (imageFile) {
        setSubmitProgress('Uploading template alignment reference…');
        await uploadAsset(templateId, version, {
          assetName: 'template_skeleton',
          boundingBox: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
          isMandatory: false,
          file: imageFile,
          fileName: 'template_skeleton.png',
        });
      }
      */

      rememberTemplate({ templateId, version, name, templateHash: result.templateHash, createdAt: new Date().toISOString() });
      setSubmitProgress(null);
      setSubmitted({ templateHash: result.templateHash });
    } catch (err) {
      setSubmitProgress(null);
      showError(err instanceof ApiError ? `${err.message}` : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canProceed = (() => {
    switch (step) {
      case 0:
        return templateId.trim().length > 0 && issuerId.trim().length > 0 && name.trim().length > 0 && version >= 1;
      case 1:
        return !!imageUrl && naturalWidth > 0 && naturalHeight > 0;
      case 2:
        return !!qrBox;
      default:
        return true;
    }
  })();

  if (submitted) {
    return (
      <div className="page">
        <SealStamp title="Template Created" subtitle={`"${name}" is now configured for Engine 2 forensic verification.`} />
        <Card style={{ maxWidth: 480, margin: '0 auto' }}>
          <div className="summary-label">Template Hash</div>
          <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', marginBottom: 20 }}>
            {submitted.templateHash}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={() => navigate(`/templates/${templateId}/${version}`)}>
              View Template
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Create Another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">New Template</h1>
      <p className="page-subtitle" style={{ marginBottom: 32 }}>
        Six short steps: name it, show it a real photo of the document, then mark what to check.
      </p>

      <Stepper steps={STEP_LABELS} currentIndex={step} />

      {step === 0 && (
        <Card>
          <Field label="Template Name" hint="Shown to admins, never to a verifier">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. B.E. Degree Certificate — Panjab University" />
          </Field>
          <Field label="Template ID" hint="UUID — generated for you, editable" action={
            <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={() => setTemplateId(generateUuid())}>Regenerate</button>
          }>
            <Input value={templateId} onChange={(e) => setTemplateId(e.target.value)} mono />
          </Field>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              {loggedInIssuer ? (
                <Field label="Issuer" hint="Your account — not editable">
                  <div className="mono" style={{ fontSize: 12.5, padding: '10px 12px', background: 'var(--parchment-050)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--slate-300)' }}>
                    {loggedInIssuer.account.institutionName} ({issuerId})
                  </div>
                </Field>
              ) : (
                <Field label="Issuer ID" hint="UUID" action={
                  <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={() => setIssuerId(generateUuid())}>Regenerate</button>
                }>
                  <Input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} mono />
                </Field>
              )}
            </div>
            <div style={{ width: 120 }}>
              <Field label="Version">
                <Input type="number" min={1} value={version} onChange={(e) => setVersion(parseInt(e.target.value, 10) || 1)} />
              </Field>
            </div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          {!imageUrl ? (
            <label className="drop-zone" style={{ display: 'block' }}>
              <div className="drop-zone-icon">
                <IconUpload size={30} />
              </div>
              <div className="drop-zone-title">Upload a reference photo</div>
              <div className="drop-zone-hint">
                A clear, flat photo or scan of a real (or sample) instance of this document. Its pixel dimensions
                become the coordinate space every zone below is drawn in.
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleFileChosen(e.target.files[0])}
              />
            </label>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <ZoneCanvas imageUrl={imageUrl} naturalWidth={naturalWidth} naturalHeight={naturalHeight} boxes={[]} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  {naturalWidth} × {naturalHeight}px
                </span>
                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                  Choose a Different Photo
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setQrBox(null);
                        setZones([]);
                        setAssets([]);
                        handleFileChosen(e.target.files[0]);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </Card>
      )}

      {step === 2 && imageUrl && (
        <div className="wizard-canvas-row">
          <ZoneCanvas
            imageUrl={imageUrl}
            naturalWidth={naturalWidth}
            naturalHeight={naturalHeight}
            boxes={qrBox ? [{ id: 'qr', box: qrBox, color: QR_COLOR, label: 'QR Code' }] : []}
            drawColor={QR_COLOR}
            onDraw={handleQrDraw}
          />
          <div className="wizard-side-panel">
            <Card>
              <div className="summary-label">QR Code Position</div>
              <p style={{ fontSize: 13, color: 'var(--slate-500)', lineHeight: 1.6, marginBottom: 16 }}>
                Draw a box around the QR code, exactly as it appears on this document. This anchors every
                photo Engine 2 aligns against this template. Must be at least {Math.round(MIN_QR_SIZE_FRACTION * 100)}%
                of the page's shorter side — too small to draw here means too small to scan once printed.
              </p>
              {qrSizeError && (
                <p style={{ fontSize: 12.5, color: 'var(--alert-600)', marginBottom: 12, lineHeight: 1.6 }}>{qrSizeError}</p>
              )}
              {qrBox ? (
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-900)' }}>
                  x:{qrBox.x} y:{qrBox.y} w:{qrBox.width} h:{qrBox.height}
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>Not drawn yet.</p>
              )}
              {qrBox && (
                <Button variant="ghost" icon={<IconTrash size={14} />} onClick={() => setQrBox(null)} style={{ marginTop: 10 }}>
                  Clear and Redraw
                </Button>
              )}
            </Card>
          </div>
        </div>
      )}

      {step === 3 && imageUrl && (
        <div className="wizard-canvas-row">
          <ZoneCanvas
            imageUrl={imageUrl}
            naturalWidth={naturalWidth}
            naturalHeight={naturalHeight}
            boxes={contextBoxes}
            drawColor={pendingZoneBox ? undefined : colorForIndex(zones.length)}
            onDraw={setPendingZoneBox}
          />
          <div className="wizard-side-panel">
            {pendingZoneBox ? (
              <Card>
                <div className="summary-label">Name This Zone</div>
                <Field label="Field Name" hint="e.g. student_name_en">
                  <Input value={draftFieldName} onChange={(e) => setDraftFieldName(e.target.value)} autoFocus />
                </Field>
                <Field label="Languages">
                  <ChipSelect options={LANGUAGE_OPTIONS} value={draftLanguages} onChange={setDraftLanguages} />
                </Field>
                <Toggle checked={draftMandatory} onChange={setDraftMandatory} label="Mandatory field" />
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <Button variant="primary" onClick={handleAddZone} disabled={!draftFieldName.trim() || draftLanguages.length === 0}>
                    Add Zone
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingZoneBox(null)}>
                    Discard
                  </Button>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="summary-label">OCR Zones ({zones.length})</div>
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 14 }}>
                  Draw a box around each printed field to compare against the issued record.
                </p>
                {zones.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None yet — draw one on the left.</p>}
                {zones.map((z) => (
                  <div key={z.localId} className="list-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div className="list-item-swatch" style={{ background: z.color }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="list-item-title">{z.fieldName}</div>
                        <div className="list-item-meta">{z.languages.join(', ')} · {z.isMandatory ? 'mandatory' : 'optional'}</div>
                      </div>
                    </div>
                    <button className="btn btn-ghost" onClick={() => setZones((zs) => zs.filter((x) => x.localId !== z.localId))}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* OUT_OF_SCOPE: Photo Zones step — uncomment when non-textual verification is back in scope */}
      {false && step === 94 && imageUrl && (
        <div className="wizard-canvas-row">
          <ZoneCanvas
            imageUrl={imageUrl}
            naturalWidth={naturalWidth}
            naturalHeight={naturalHeight}
            boxes={contextBoxes}
            drawColor={pendingPhotoZoneBox ? undefined : colorForIndex(zones.length + photoZones.length)}
            onDraw={setPendingPhotoZoneBox}
          />
          <div className="wizard-side-panel">
            {pendingPhotoZoneBox ? (
              <Card>
                <div className="summary-label">Name This Photo Zone</div>
                <Field label="Field Name" hint="e.g. student_photo">
                  <Input value={draftPhotoFieldName} onChange={(e) => setDraftPhotoFieldName(e.target.value)} autoFocus />
                </Field>
                <Field label="Match Photos By" hint="Photo filenames must equal this field's value, e.g. roll_no.jpg — never a name (two students can share one)">
                  <select
                    className="select"
                    value={draftPhotoMatchByField}
                    onChange={(e) => setDraftPhotoMatchByField(e.target.value)}
                  >
                    <option value="">Select a field…</option>
                    {zones.map((z) => (
                      <option key={z.localId} value={z.fieldName}>
                        {z.fieldName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Toggle checked={draftPhotoMandatory} onChange={setDraftPhotoMandatory} label="Mandatory photo" />
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <Button variant="primary" onClick={handleAddPhotoZone} disabled={!draftPhotoFieldName.trim() || !draftPhotoMatchByField}>
                    Add Photo Zone
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingPhotoZoneBox(null)}>
                    Discard
                  </Button>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="summary-label">Photo Zones ({photoZones.length})</div>
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 14 }}>
                  Optional. Draw a box for a per-document photo — e.g. each student's own photo — that differs on
                  every credential, unlike the fixed reference assets in the next step. This only places the
                  image on the printed PDF; it does not verify whose photo it is.
                </p>
                {photoZones.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None yet — draw one on the left, or skip this step.</p>}
                {photoZones.map((p) => (
                  <div key={p.localId} className="list-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div className="list-item-swatch" style={{ background: p.color }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="list-item-title">{p.fieldName}</div>
                        <div className="list-item-meta">{p.isMandatory ? 'mandatory' : 'optional'}</div>
                      </div>
                    </div>
                    <button className="btn btn-ghost" onClick={() => setPhotoZones((ps) => ps.filter((x) => x.localId !== p.localId))}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* OUT_OF_SCOPE: Reference Assets step — uncomment when non-textual verification is back in scope */}
      {false && step === 95 && imageUrl && (
        <div className="wizard-canvas-row">
          <ZoneCanvas
            imageUrl={imageUrl}
            naturalWidth={naturalWidth}
            naturalHeight={naturalHeight}
            boxes={[
              ...contextBoxes,
              ...assets.map((a) => ({ id: a.localId, box: a.box, color: a.color, label: a.assetName })),
            ]}
            drawColor={pendingAssetBox ? undefined : colorForIndex(zones.length + photoZones.length + assets.length)}
            onDraw={setPendingAssetBox}
          />
          <div className="wizard-side-panel">
            {pendingAssetBox ? (
              <Card>
                <div className="summary-label">Name This Asset</div>
                <Field label="Asset Name" hint="e.g. university_logo, registrar_signature">
                  <Input value={draftAssetName} onChange={(e) => setDraftAssetName(e.target.value)} autoFocus />
                </Field>
                <Toggle checked={draftAssetMandatory} onChange={setDraftAssetMandatory} label="Mandatory asset" />
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <Button variant="primary" onClick={handleAddAsset} disabled={!draftAssetName.trim()}>
                    Add Asset
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingAssetBox(null)}>
                    Discard
                  </Button>
                </div>
              </Card>
            ) : (
              <Card>
                <div className="summary-label">Reference Assets ({assets.length})</div>
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 14 }}>
                  Optional. Draw a box around a logo, seal, or signature to verify it visually matches.
                </p>
                {assets.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None yet — draw one on the left, or skip this step.</p>}
                {assets.map((a) => (
                  <div key={a.localId} className="list-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div className="list-item-swatch" style={{ background: a.color }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="list-item-title">{a.assetName}</div>
                        <div className="list-item-meta">{a.isMandatory ? 'mandatory' : 'optional'}</div>
                      </div>
                    </div>
                    <button className="btn btn-ghost" onClick={() => setAssets((as) => as.filter((x) => x.localId !== a.localId))}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      {step === 4 && (
        <Card>
          <div className="summary-block">
            <div className="summary-label">Template</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{name || '(untitled)'}</div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4 }}>
              {templateId} · v{version} · issuer {issuerId}
            </div>
          </div>
          <div className="summary-block">
            <div className="summary-label">Reference Photo</div>
            <div style={{ fontSize: 13 }}>{naturalWidth} × {naturalHeight}px</div>
          </div>
          <div className="summary-block">
            <div className="summary-label">QR Position</div>
            <div className="mono" style={{ fontSize: 12 }}>
              {qrBox ? `x:${qrBox.x} y:${qrBox.y} w:${qrBox.width} h:${qrBox.height}` : 'Not set'}
            </div>
          </div>
          <div className="summary-block">
            <div className="summary-label">OCR Zones ({zones.length})</div>
            {zones.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None declared.</p>
            ) : (
              zones.map((z) => (
                <div key={z.localId} style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{z.fieldName}</strong> — {z.languages.join(', ')} · {z.isMandatory ? 'mandatory' : 'optional'}
                </div>
              ))
            )}
          </div>
          {/* OUT_OF_SCOPE: Photo Zones and Reference Assets review sections */}
          <div className="summary-block" style={{ opacity: 0.5 }}>
            <div className="summary-label">Photo Zones (skipped — out of scope)</div>
            {photoZones.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None declared.</p>
            ) : (
              photoZones.map((p) => (
                <div key={p.localId} style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{p.fieldName}</strong> · matched by <strong>{p.matchByField}</strong> ·{' '}
                  {p.isMandatory ? 'mandatory' : 'optional'}
                </div>
              ))
            )}
          </div>
          <div className="summary-block" style={{ opacity: 0.5 }}>
            <div className="summary-label">Reference Assets (skipped — out of scope)</div>
            {assets.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--slate-500)' }}>None uploaded.</p>
            ) : (
              assets.map((a) => (
                <div key={a.localId} style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{a.assetName}</strong> · {a.isMandatory ? 'mandatory' : 'optional'}
                </div>
              ))
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting || !qrBox}>
              {submitting ? submitProgress ?? 'Submitting…' : 'Create Template'}
            </Button>
          </div>
        </Card>
      )}

      {imageUrl && <img ref={cropImgRef} src={imageUrl} alt="" style={{ display: 'none' }} />}

      <div className="wizard-nav">
        <Button variant="secondary" icon={<IconChevronLeft size={16} />} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < STEP_LABELS.length - 1 && (
          <Button variant="primary" onClick={() => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1))} disabled={!canProceed}>
            Next <IconChevronRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
