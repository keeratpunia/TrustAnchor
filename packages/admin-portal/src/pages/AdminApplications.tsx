import React, { useEffect, useState } from 'react';
import {
  listIssuerAccounts,
  approveIssuerAccount,
  rejectIssuerAccount,
  publishIssuerKey,
  suspendIssuerAccount,
} from '../lib/adminApi';
import { ApiError } from '../lib/api';
import { IssuerAccount, IssuerAccountStatus } from '../lib/types';
import { Badge, Button, Card, Field, Textarea } from '../components/ui';
import { PublishKeyForm } from '../components/PublishKeyForm';
import { useToast } from '../components/Toast';

const STATUS_META: Record<IssuerAccountStatus, { tier: 'accept' | 'review' | 'reject' | 'neutral'; label: string }> = {
  PENDING: { tier: 'neutral', label: 'Pending' },
  APPROVED_NO_KEY: { tier: 'review', label: 'Awaiting Key' },
  ACTIVE: { tier: 'accept', label: 'Active' },
  KEY_ROTATION_PENDING: { tier: 'review', label: 'Key Rotation Pending' },
  SUSPENDED: { tier: 'reject', label: 'Suspended' },
  REJECTED: { tier: 'reject', label: 'Rejected' },
};

const FILTERS: Array<{ label: string; status?: IssuerAccountStatus }> = [
  { label: 'Pending', status: 'PENDING' },
  { label: 'Awaiting Key', status: 'APPROVED_NO_KEY' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Suspended / Rejected' }, // handled specially below
  { label: 'All' },
];

export function AdminApplications() {
  const [accounts, setAccounts] = useState<IssuerAccount[]>([]);
  const [filter, setFilter] = useState('Pending');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const { showSuccess, showError } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const all = await listIssuerAccounts();
      setAccounts(all);
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

  const visible = accounts.filter((a) => {
    if (filter === 'All') return true;
    if (filter === 'Suspended / Rejected') return a.status === 'SUSPENDED' || a.status === 'REJECTED';
    const match = FILTERS.find((f) => f.label === filter);
    return match?.status ? a.status === match.status : true;
  });

  const handleApprove = async (id: string) => {
    try {
      const res = await approveIssuerAccount(id);
      showSuccess(res.message);
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    try {
      const res = await rejectIssuerAccount(id, rejectReason.trim());
      showSuccess(res.message);
      setExpandedId(null);
      setRejectReason('');
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handleSuspend = async (id: string) => {
    if (!suspendReason.trim()) return;
    try {
      const res = await suspendIssuerAccount(id, suspendReason.trim());
      showSuccess(res.message);
      setExpandedId(null);
      setSuspendReason('');
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const handlePublishKey = async (id: string, value: { publicKeyHex: string; keySource: 'yubikey' | 'software_test_key' }) => {
    try {
      const res = await publishIssuerKey(id, value);
      showSuccess(res.message);
      setExpandedId(null);
      load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const keylessTooLong = accounts.filter(
    (a) => a.status === 'APPROVED_NO_KEY' && a.approvedAt && Date.now() - new Date(a.approvedAt).getTime() > 3 * 24 * 60 * 60 * 1000
  );

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Issuer Applications</h1>
      <p className="page-subtitle" style={{ marginBottom: 20 }}>
        Approve or reject new issuer applications, and record a public key once an issuer has generated one.
      </p>

      {keylessTooLong.length > 0 && (
        <Card style={{ marginBottom: 20, borderColor: 'var(--review-600)', background: 'var(--review-100)' }}>
          <strong style={{ color: 'var(--review-600)', fontSize: 13 }}>
            {keylessTooLong.length} issuer{keylessTooLong.length > 1 ? 's have' : ' has'} been approved for over 3 days with no key recorded yet
          </strong>
          <p style={{ fontSize: 12.5, color: 'var(--ink-900)', marginTop: 6 }}>
            {keylessTooLong.map((a) => a.institutionName).join(', ')} — worth following up on their keygen ceremony.
          </p>
        </Card>
      )}

      <div className="chip-row" style={{ marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <div key={f.label} className={`chip ${filter === f.label ? 'active' : ''}`} onClick={() => setFilter(f.label)}>
            {f.label}
          </div>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--slate-500)' }}>Loading…</p>}

      {!loading && visible.length === 0 && <p style={{ color: 'var(--slate-500)' }}>Nothing here.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((a) => {
          const meta = STATUS_META[a.status];
          const expanded = expandedId === a.id;
          return (
            <Card key={a.id} style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.institutionName}</div>
                  <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 2 }}>{a.email}</div>
                </div>
                <Badge tier={meta.tier}>{meta.label}</Badge>
              </div>

              {a.status === 'PENDING' && (
                <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={() => handleApprove(a.id)}>
                    Approve
                  </Button>
                  <Button variant="danger" onClick={() => setExpandedId(expanded ? null : a.id)}>
                    Reject
                  </Button>
                </div>
              )}

              {a.status === 'PENDING' && expanded && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Rejection reason">
                    <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2} autoFocus />
                  </Field>
                  <Button variant="danger" onClick={() => handleReject(a.id)} disabled={!rejectReason.trim()}>
                    Confirm Rejection
                  </Button>
                </div>
              )}

              {a.status === 'APPROVED_NO_KEY' && (
                <div style={{ marginTop: 14 }}>
                  {!expanded ? (
                    <Button variant="primary" onClick={() => setExpandedId(a.id)}>
                      Record Public Key
                    </Button>
                  ) : (
                    <PublishKeyForm submitLabel="Publish Key & Activate" onSubmit={(v) => handlePublishKey(a.id, v)} />
                  )}
                </div>
              )}

              {(a.status === 'ACTIVE' || a.status === 'KEY_ROTATION_PENDING') && (
                <div style={{ marginTop: 14 }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)', marginBottom: 10 }}>
                    issuerId: {a.issuerId} · key source: {a.keySource}
                  </div>
                  {!expanded ? (
                    <Button variant="danger" onClick={() => setExpandedId(a.id)}>
                      Suspend
                    </Button>
                  ) : (
                    <div>
                      <Field label="Suspension reason">
                        <Textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={2} autoFocus />
                      </Field>
                      <Button variant="danger" onClick={() => handleSuspend(a.id)} disabled={!suspendReason.trim()}>
                        Confirm Suspension
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {a.status === 'REJECTED' && a.rejectionReason && (
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 10 }}>Reason: {a.rejectionReason}</p>
              )}
              {a.status === 'SUSPENDED' && a.suspensionReason && (
                <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 10 }}>Reason: {a.suspensionReason}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
