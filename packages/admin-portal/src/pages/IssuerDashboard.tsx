/**
 * IssuerDashboard.tsx — implements the workflow report's §3.2 state table
 * directly: one screen, whose content is entirely driven by the issuer's
 * current `status`, always telling them exactly what's true right now and
 * exactly what (if anything) unlocks the next state.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentIssuer, issuerLogout, requestKeyRotation, fetchKeyRotationStatus } from '../lib/issuerApi';
import { RecentTemplatesList } from '../components/RecentTemplatesList';
import { IssuerAccount, KeyRotationRequest } from '../lib/types';
import { Badge, Button, Card, Field, Input, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';

export function IssuerDashboard() {
  const [account, setAccount] = useState<IssuerAccount | null>(null);
  const [rotationHistory, setRotationHistory] = useState<KeyRotationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRotationForm, setShowRotationForm] = useState(false);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const load = async () => {
    setLoading(true);
    const current = await fetchCurrentIssuer();
    if (!current) {
      navigate('/issuer/login');
      return;
    }
    setAccount(current);
    if (current.status === 'ACTIVE' || current.status === 'KEY_ROTATION_PENDING') {
      setRotationHistory(await fetchKeyRotationStatus());
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    issuerLogout();
    navigate('/');
  };

  const handleRequestRotation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await requestKeyRotation(reason.trim(), password);
      showSuccess(res.message);
      setShowRotationForm(false);
      setReason('');
      setPassword('');
      load();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !account) {
    return (
      <div className="page">
        <p style={{ color: 'var(--slate-500)' }}>Loading…</p>
      </div>
    );
  }

  const pendingRotation = rotationHistory.find((r) => r.status === 'PENDING');

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-eyebrow">Engine 2 · Template Studio</div>
          <h1 className="page-title">{account.institutionName}</h1>
        </div>
        <Button variant="ghost" onClick={handleLogout}>
          Log Out
        </Button>
      </div>

      {account.status === 'PENDING' && (
        <Card style={{ background: 'var(--slate-100)', borderColor: 'var(--slate-300)' }}>
          <strong>Your application is under review.</strong>
          <p style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
            An administrator will reach out about generating your signing key once approved. No further action is
            needed from you right now — check back any time by logging in again.
          </p>
        </Card>
      )}

      {account.status === 'APPROVED_NO_KEY' && (
        <Card style={{ background: 'var(--review-100)', borderColor: 'var(--review-600)' }}>
          <strong style={{ color: 'var(--review-600)' }}>You're approved! One step left: a signing key.</strong>
          <p style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
            Before you can issue any documents, you need a signing key — ideally on a YubiKey, so your private
            key never touches a networked machine. Contact your administrator to schedule this. Once you've
            generated a key (via <code>offline-signer keygen --card</code>) and shared the resulting{' '}
            <strong>public</strong> key hex with your admin, they'll record it here and activate your account.
          </p>
        </Card>
      )}

      {account.status === 'SUSPENDED' && (
        <Card style={{ background: 'var(--alert-100)', borderColor: 'var(--alert-600)' }}>
          <strong style={{ color: 'var(--alert-600)' }}>Your issuing privileges have been suspended.</strong>
          <p style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
            Reason: {account.suspensionReason ?? 'No reason recorded.'} Contact your platform administrator for
            next steps.
          </p>
        </Card>
      )}

      {account.status === 'REJECTED' && (
        <Card style={{ background: 'var(--alert-100)', borderColor: 'var(--alert-600)' }}>
          <strong style={{ color: 'var(--alert-600)' }}>Your application was not approved.</strong>
          <p style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>
            Reason: {account.rejectionReason ?? 'No reason recorded.'}
          </p>
        </Card>
      )}

      {(account.status === 'ACTIVE' || account.status === 'KEY_ROTATION_PENDING') && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--verified-600)' }}>Active</strong>
              <Badge tier="accept">Key on file: {account.keySource}</Badge>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 10 }}>
              issuerId: {account.issuerId}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--slate-500)', marginTop: 4, wordBreak: 'break-all' }}>
              publicKey: {account.publicKeyHex}
            </div>
          </Card>

          <RecentTemplatesList />
          <div style={{ marginBottom: 16 }} />

          {pendingRotation ? (
            <Card style={{ background: 'var(--review-100)', borderColor: 'var(--review-600)' }}>
              <strong style={{ color: 'var(--review-600)' }}>Key rotation requested</strong>
              <p style={{ fontSize: 13, marginTop: 6 }}>
                Submitted {new Date(pendingRotation.requestedAt).toLocaleString()} — awaiting admin approval. Your
                current key keeps working until then.
              </p>
            </Card>
          ) : (
            <Card>
              <strong>Need to rotate your signing key?</strong>
              <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: '8px 0 14px', lineHeight: 1.6 }}>
                Generate a new key offline first (<code>offline-signer keygen --card</code>), then request
                rotation here.
              </p>
              {!showRotationForm ? (
                <Button variant="secondary" onClick={() => setShowRotationForm(true)}>
                  Request Key Rotation
                </Button>
              ) : (
                <form onSubmit={handleRequestRotation}>
                  <Field label="Reason">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required autoFocus />
                  </Field>
                  <Field label="Confirm your password">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </Field>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="primary" type="submit" disabled={submitting || !reason.trim() || !password}>
                      {submitting ? 'Submitting…' : 'Submit Request'}
                    </Button>
                    <Button variant="ghost" type="button" onClick={() => setShowRotationForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
