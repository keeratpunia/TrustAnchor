/**
 * AdminManifest.tsx — generate a correct manifest draft, sign it offline,
 * publish it. This is the fix for "CANNOT VERIFY — STALE TRUST DATA":
 * that error means exactly what it says — the currently-published
 * manifest's valid_until has passed, and nobody has republished a fresher
 * one since. This screen makes republishing a five-minute, low-error task
 * instead of hand-editing JSON.
 */
import React, { useState } from 'react';
import { fetchManifestDraft, publishSignedManifest } from '../lib/adminApi';
import { downloadJson } from '../lib/download';
import { Button, Card, Field, Input } from '../components/ui';
import { useToast } from '../components/Toast';

export function AdminManifest() {
  const [validityDays, setValidityDays] = useState('30');
  const [draftNotes, setDraftNotes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { showSuccess, showError } = useToast();

  const handleDownloadDraft = async () => {
    setLoading(true);
    try {
      const { draft, notes } = await fetchManifestDraft(parseInt(validityDays, 10) || 30);
      downloadJson(draft, 'manifest_payload.json');
      setDraftNotes(notes);
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignedManifestChosen = async (file: File) => {
    setPublishing(true);
    try {
      const text = await file.text();
      const signedManifest = JSON.parse(text);
      const res = await publishSignedManifest(signedManifest);
      showSuccess(res.message ?? 'Manifest published.');
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-eyebrow">Engine 1 · Trust Manifest</div>
      <h1 className="page-title">Publish Trust Manifest</h1>
      <p className="page-subtitle" style={{ marginBottom: 28 }}>
        Every verifier checks this manifest's freshness before trusting anything. Republish it before it
        expires — an expired manifest is exactly what "CANNOT VERIFY — STALE TRUST DATA" means, even for a
        completely genuine document.
      </p>

      <Card style={{ marginBottom: 20 }}>
        <div className="summary-label">Step 1 — Generate a fresh draft</div>
        <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 16, lineHeight: 1.6 }}>
          Built directly from the live database — every active issuer's real key, every approved revocation —
          so there's nothing to hand-edit.
        </p>
        <Field label="Valid for (days)">
          <Input type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Button variant="primary" onClick={handleDownloadDraft} disabled={loading}>
          {loading ? 'Generating…' : 'Download Manifest Draft'}
        </Button>
        {draftNotes && (
          <ul style={{ marginTop: 14, fontSize: 12.5, color: 'var(--slate-500)', paddingLeft: 18 }}>
            {draftNotes.map((n, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <div className="summary-label">Step 2 — Sign it offline</div>
        <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 14 }}>
          Run this on your offline signing machine, with the platform's key:
        </p>
        <pre className="mono" style={{ background: 'var(--ink-900)', color: '#e2e8f0', padding: '14px 16px', borderRadius: 10, fontSize: 12, overflowX: 'auto' }}>
          {`npx ts-node src/cli.ts sign-manifest \\\n  --manifest manifest_payload.json \\\n  --key platform-key.json \\\n  --out signed_manifest.json`}
        </pre>
      </Card>

      <Card>
        <div className="summary-label">Step 3 — Publish it</div>
        <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 16 }}>
          Upload the signed_manifest.json that command just produced.
        </p>
        <label className="drop-zone" style={{ display: 'block' }}>
          <div className="drop-zone-title">Upload signed_manifest.json</div>
          <div className="drop-zone-hint">Every verifier will pick this up on their next scan.</div>
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleSignedManifestChosen(e.target.files[0])}
          />
        </label>
        {publishing && <p style={{ color: 'var(--slate-500)', marginTop: 14 }}>Publishing…</p>}
      </Card>
    </div>
  );
}
