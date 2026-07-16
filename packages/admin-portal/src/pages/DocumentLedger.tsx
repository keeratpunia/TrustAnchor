import React, { useEffect, useState } from 'react';
import { listMyDocuments, requestRevocation, listMyRevocationRequests } from '../lib/issuerApi';
import { DocumentSummary, RevocationRequest } from '../lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

export function DocumentLedger() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [revocations, setRevocations] = useState<RevocationRequest[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showSuccess, showError } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [d, r] = await Promise.all([listMyDocuments(q || undefined), listMyRevocationRequests()]);
      setDocs(d);
      setRevocations(r);
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingByDocId = new Map(revocations.filter((r) => r.status === 'PENDING').map((r) => [r.docId, r]));

  const handleRequestRevocation = async (docId: string) => {
    if (!reason.trim() || !password) return;
    setSubmitting(true);
    try {
      const res = await requestRevocation(docId, reason.trim(), password);
      showSuccess(res.message);
      setExpandedDocId(null);
      setReason('');
      setPassword('');
      load();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">My Documents</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        Every credential issued under your account. Requesting a revocation notifies an admin — the document
        keeps verifying normally until they republish the trust manifest with it revoked.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by doc ID or field value…" mono />
        </div>
        <Button variant="secondary" onClick={load}>
          Search
        </Button>
      </div>

      {loading && <p style={{ color: 'var(--slate-500)' }}>Loading…</p>}
      {!loading && docs.length === 0 && (
        <EmptyState title="No documents yet" body="Issue your first batch to see documents appear here." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {docs.map((d) => {
          const pending = pendingByDocId.get(d.docId);
          const expanded = expandedDocId === d.docId;
          return (
            <Card key={d.docId} style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)' }}>
                    {d.docId}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    {Object.entries(d.fields)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('  ·  ')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 4 }}>
                    Issued {new Date(d.issuedAt).toLocaleDateString()}
                  </div>
                </div>
                {pending ? (
                  <Badge tier="review">Revocation Pending</Badge>
                ) : (
                  <Button variant="danger" onClick={() => setExpandedDocId(expanded ? null : d.docId)}>
                    Request Revocation
                  </Button>
                )}
              </div>
              {expanded && !pending && (
                <div style={{ marginTop: 14 }}>
                  <Field label="Reason">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
                  </Field>
                  <Field label="Confirm your password">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <Button
                    variant="danger"
                    onClick={() => handleRequestRevocation(d.docId)}
                    disabled={submitting || !reason.trim() || !password}
                  >
                    {submitting ? 'Submitting…' : 'Confirm Revocation Request'}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
