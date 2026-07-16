import React, { useEffect, useState } from 'react';
import { listKeyRotationRequests, approveKeyRotation, rejectKeyRotation } from '../lib/adminApi';
import { ApiError } from '../lib/api';
import { KeyRotationRequest } from '../lib/types';
import { Badge, Button, Card, EmptyState, Field, Textarea } from '../components/ui';
import { PublishKeyForm } from '../components/PublishKeyForm';
import { useToast } from '../components/Toast';

export function AdminKeyRotation() {
  const [requests, setRequests] = useState<KeyRotationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const { showSuccess, showError } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setRequests(await listKeyRotationRequests());
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
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

  const handleApprove = async (id: string, value: { publicKeyHex: string; keySource: 'yubikey' | 'software_test_key' }) => {
    try {
      const res = await approveKeyRotation(id, { newPublicKeyHex: value.publicKeyHex, newKeySource: value.keySource });
      showSuccess(res.message);
      setExpandedId(null);
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await rejectKeyRotation(id, rejectNote.trim() || undefined);
      showSuccess(res.message);
      setExpandedId(null);
      setRejectNote('');
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Key Rotation Requests</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        An issuer requesting rotation has already confirmed their password and generated a new key offline —
        approving here records that new key and reactivates their account with it.
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
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 2 }}>{r.email}</div>
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
                  <Button variant="primary" onClick={() => setExpandedId(r.id)}>
                    Approve with New Key
                  </Button>
                  <Button variant="danger" onClick={() => setExpandedId(`reject-${r.id}`)}>
                    Reject
                  </Button>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <PublishKeyForm submitLabel="Approve Rotation" onSubmit={(v) => handleApprove(r.id, v)} />
                </div>
              )}

              {expandedId === `reject-${r.id}` && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Note (optional)">
                    <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} autoFocus />
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
                    <div style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 2 }}>{r.reason}</div>
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
