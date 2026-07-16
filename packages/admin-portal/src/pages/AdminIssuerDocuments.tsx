import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listIssuerDocuments } from '../lib/adminApi';
import { Card, EmptyState, Input } from '../components/ui';
import { useToast } from '../components/Toast';

interface DocumentRow {
  docId: string;
  templateId: string;
  templateVersion: number;
  issuedAt: string;
  expiresAt: string | null;
  fields: Record<string, string>;
  createdAt: string;
  contentHashHex: string | null;
}

/**
 * The platform's own independent record of what an issuer has issued —
 * so if a discrepancy ever comes up later (a disputed credential, a
 * compromised-key investigation), there's a source of truth here that
 * doesn't depend on trusting the issuer's own local files.
 */
export function AdminIssuerDocuments() {
  const { issuerAccountId } = useParams<{ issuerAccountId: string }>();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const { showError } = useToast();

  useEffect(() => {
    let mounted = true;
    listIssuerDocuments(issuerAccountId!)
      .then((d) => mounted && setDocs(d))
      .catch((err) => showError(err.message))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuerAccountId]);

  const filtered = q
    ? docs.filter((d) => d.docId.toLowerCase().includes(q.toLowerCase()) || Object.values(d.fields).some((v) => String(v).toLowerCase().includes(q.toLowerCase())))
    : docs;

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Issued Documents</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        Every credential this issuer has ever ingested through the platform — the platform's own record,
        independent of what the issuer's own files say. Each one includes an <strong>Info Hash</strong> —
        computed the same way a verifier's phone app computes it, from these exact stored fields — so you can
        compare it against a physical document's own QR code if a dispute or investigation ever comes up.
      </p>

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by doc ID or field value…" mono style={{ marginBottom: 20 }} />

      {loading && <p style={{ color: 'var(--slate-500)' }}>Loading…</p>}
      {!loading && filtered.length === 0 && <EmptyState title="No documents" body="Nothing has been issued yet, or nothing matches your search." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((d) => (
          <Card key={d.docId} style={{ padding: '14px 18px' }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)' }}>
              {d.docId}
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {Object.entries(d.fields)
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${v}`)
                .join('  ·  ')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 4 }}>
              Issued {new Date(d.issuedAt).toLocaleDateString()} · Template {d.templateId} v{d.templateVersion}
            </div>
            {d.contentHashHex && (
              <div
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: 'var(--brass-700)',
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--hairline)',
                  wordBreak: 'break-all',
                }}
              >
                Info Hash: {d.contentHashHex}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
