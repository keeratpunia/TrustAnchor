import React, { useEffect, useState } from 'react';
import { listRevocationRequests, approveRevocation, rejectRevocation } from '../lib/adminApi';
import { RevocationRequest } from '../lib/types';
import { Badge, Button, Card, EmptyState, Field, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

export function AdminRevocationRequests() {
  const [requests, setRequests] = useState<RevocationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { showSuccess, showError } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setRequests(await listRevocationRequests());
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

  const pending = requests.filter((r) => r.status === 'PENDING');
  const resolved = requests.filter((r) => r.status !== 'PENDING');

  const handleApprove = async (id: string) => {
    try {
      const res = await approveRevocation(id, note.trim() || undefined);
      showSuccess(res.message);
      setExpandedId(null);
      setNote('');
      load();
    } catch (err) {
      showError((err as Error).message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await rejectRevocation(id, note.trim() || undefined);
      showSuccess(res.message);
      setExpandedId(null);
      setNote('');
      load();
    } catch (err) {
      showError((err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Revocation Requests</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        Approving here records your decision only — it does NOT revoke anything by itself. Actually revoking
        still requires re-signing and republishing the trust manifest with this doc_id added to revoked_docs.
      </p>

      {loading && <p style={{ color: 'var(--slate-500)' }}>Loading…</p>}
      {!loading && pending.length === 0 && (
        <EmptyState title="No pending requests" body="You'll see a request here as soon as an issuer submits one." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        {pending.map((r) => {
          const expanded = expandedId === r.id;
          return (
            <Card key={r.id} style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.institutionName ?? r.issuerAccountId}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4 }}>
                    doc_id: {r.docId}
                  </div>
                  <p style={{ fontSize: 13, marginTop: 8 }}>
                    <strong>Reason:</strong> {r.reason}
                  </p>
                  <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4 }}>
                    Requested {new Date(r.requestedAt).toLocaleString()}
                  </div>
                </div>
                <Badge tier="review">Pending</Badge>
              </div>

              {!expanded ? (
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={() => handleApprove(r.id)}>
                    Approve
                  </Button>
                  <Button variant="danger" onClick={() => setExpandedId(r.id)}>
                    Reject
                  </Button>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <Field label="Note (optional)">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus />
                  </Field>
                  <Button variant="danger" onClick={() => handleReject(r.id)}>
                    Confirm Rejection
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Previously Reviewed
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resolved.map((r) => (
              <Card key={r.id} style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.institutionName ?? r.issuerAccountId}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 2 }}>
                      {r.docId}
                    </div>
                  </div>
                  <Badge tier={r.status === 'APPROVED' ? 'accept' : 'reject'}>{r.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
