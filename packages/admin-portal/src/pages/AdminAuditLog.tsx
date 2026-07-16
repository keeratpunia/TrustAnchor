import React, { useEffect, useState } from 'react';
import { listAuditLog, verifyAuditChain } from '../lib/adminApi';
import { ApiError } from '../lib/api';
import { AuditLogEntry } from '../lib/types';
import { Button, Card, EmptyState, Input } from '../components/ui';
import { useToast } from '../components/Toast';

const ACTOR_TYPES = ['', 'ADMIN', 'ISSUER'];

export function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [q, setQ] = useState('');
  const [actorType, setActorType] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkingChain, setCheckingChain] = useState(false);
  const [chainResult, setChainResult] = useState<{ intact: boolean; totalEntries: number; brokenAt?: { id: string; eventType: string; createdAt: string } } | null>(null);
  const { showError } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await listAuditLog({ q: q || undefined, actorType: actorType || undefined, limit: 200 }));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChain = async () => {
    setCheckingChain(true);
    try {
      setChainResult(await verifyAuditChain());
    } catch (err) {
      showError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCheckingChain(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Audit Log</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        A read-only, append-only record of every sensitive action — logins, approvals, rejections, suspensions,
        key rotations.
      </p>

      <Card style={{ marginBottom: 24 }}>
        <div className="summary-label">Tamper-Evidence Check</div>
        <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginBottom: 14, lineHeight: 1.6 }}>
          Every entry is chained to the one before it by hash — recomputing the whole chain proves whether any
          historical row has been quietly edited directly in the database since it was written.
        </p>
        <Button variant="secondary" onClick={handleVerifyChain} disabled={checkingChain}>
          {checkingChain ? 'Verifying…' : 'Verify Chain Integrity'}
        </Button>
        {chainResult && (
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              fontWeight: 700,
              color: chainResult.intact ? 'var(--verified-600)' : 'var(--alert-600)',
            }}
          >
            {chainResult.intact
              ? `✓ Intact — all ${chainResult.totalEntries} entries verified.`
              : `✗ Broken at "${chainResult.brokenAt?.eventType}" (${chainResult.brokenAt?.id}, ${chainResult.brokenAt ? new Date(chainResult.brokenAt.createdAt).toLocaleString() : ''}) — everything before this entry is verified intact; this entry or something before it was altered outside this application.`}
          </p>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search event type or actor ID…" mono />
        </div>
        <div className="chip-row">
          {ACTOR_TYPES.map((t) => (
            <div key={t || 'all'} className={`chip ${actorType === t ? 'active' : ''}`} onClick={() => setActorType(t)}>
              {t || 'All'}
            </div>
          ))}
        </div>
        <Button variant="secondary" onClick={load}>
          Search
        </Button>
      </div>

      {loading && <p style={{ color: 'var(--slate-500)' }}>Loading…</p>}
      {!loading && entries.length === 0 && <EmptyState title="No entries" body="Nothing matches this search." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((e) => (
          <Card key={e.id} style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>{e.eventType}</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: e.actorType === 'ADMIN' ? 'var(--brass-700)' : 'var(--slate-700)',
                    textTransform: 'uppercase',
                  }}
                >
                  {e.actorType}
                </span>
                {e.actorId && (
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--slate-500)' }}>
                    {e.actorId}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--slate-500)', flexShrink: 0 }}>
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
            {!!e.payload && (
              <pre
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: 'var(--slate-500)',
                  marginTop: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(e.payload)}
              </pre>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
