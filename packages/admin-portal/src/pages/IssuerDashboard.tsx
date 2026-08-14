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


/**
 * PublicKeySubmitForm — inline form for an approved issuer to submit their
 * public key hex string. Sends it to POST /auth/issuer/submit-public-key.
 */
function PublicKeySubmitForm() {
  const [publicKey, setPublicKey] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async () => {
    const trimmed = publicKey.trim();
    if (!trimmed || trimmed.length < 32) {
      setError('Please paste your full public key (it should be a long string of letters and numbers).');
      return;
    }
    // Basic hex validation
    if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
      setError('The public key should only contain characters 0-9 and a-f. Make sure you copied the right value.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { loadSettings } = await import('../lib/settings');
      const { loadIssuerSession } = await import('../lib/auth');
      const session = loadIssuerSession();
      const res = await fetch(`${loadSettings().backendUrl.replace(/\/+$/, '')}/auth/issuer/submit-public-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ publicKeyHex: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `Request failed (HTTP ${res.status})`);
      }
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '12px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#166534' }}>Public key submitted!</div>
        <div style={{ fontSize: 12.5, color: '#15803d', marginTop: 4 }}>
          Your administrator will verify it and activate your account. Check back by refreshing this page.
        </div>
      </div>
    );
  }

  return (
    <div>
      <textarea
        value={publicKey}
        onChange={(e) => setPublicKey(e.target.value)}
        placeholder="Paste your public key hex here (e.g. b382bd52bdd6752b55d33594b0fd802887f...)"
        style={{
          width: '100%', minHeight: 60, padding: '10px 12px',
          border: '1px solid var(--hairline)', borderRadius: 6,
          fontFamily: 'var(--font-mono)', fontSize: 12,
          resize: 'vertical', marginBottom: 8,
        }}
      />
      {error && <div style={{ fontSize: 12, color: 'var(--alert-600)', marginBottom: 8 }}>{error}</div>}
      <Button variant="primary" onClick={handleSubmit} disabled={submitting || !publicKey.trim()}>
        {submitting ? 'Submitting...' : 'Submit Public Key'}
      </Button>
    </div>
  );
}

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
        <Card style={{ background: 'var(--review-100)', borderColor: 'var(--review-600)', padding: '28px 32px' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
          <strong style={{ color: 'var(--review-600)', fontSize: 17 }}>You're approved!</strong>
          <p style={{ fontSize: 14, marginTop: 8, lineHeight: 1.7, marginBottom: 20 }}>
            Before you can start issuing documents, you need to set up your
            <strong> digital signing key</strong>. This key lives on a small USB device called a <strong>YubiKey</strong>,
            which ensures only you can sign documents on behalf of your institution — no one else, not even this platform.
          </p>

          {/* Step-by-step onboarding */}
          <div style={{ background: '#fff', borderRadius: 'var(--radius-md)', border: '1px solid var(--hairline)', padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Setup Steps</div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Get a YubiKey</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4, lineHeight: 1.6 }}>
                  If you don't have one yet, purchase a YubiKey 5 series from <strong>yubico.com</strong> (any model with USB works).
                  Your administrator may also provide one.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Generate your signing key</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4, lineHeight: 1.6 }}>
                  Plug in your YubiKey and use the TrustAnchor key generation tool to create your signing key pair.
                  The private key is generated <strong>inside</strong> the YubiKey and can never be extracted.
                  The tool will output your <strong>public key</strong> — a long string of letters and numbers.
                  This is what you'll share with us in the next step.
                </div>
                <div style={{ background: 'var(--parchment-050)', border: '1px solid var(--hairline)', borderRadius: 6, padding: '10px 14px', marginTop: 10, fontSize: 12.5 }}>
                  <strong>Your administrator will help you with this step</strong> — they'll provide the key generation tool
                  and walk you through the process. Contact them when you have your YubiKey ready.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brass-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Submit your public key</div>
                <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4, lineHeight: 1.6, marginBottom: 12 }}>
                  Paste the public key from the previous step below. Your administrator will verify it and activate your account.
                </div>
                <PublicKeySubmitForm />
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--slate-500)', lineHeight: 1.6 }}>
            Once your administrator verifies your public key, your account will be activated and you'll be able
            to create templates and issue documents.
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

          {/* Primary action — issue documents */}
          <Card style={{ marginBottom: 16, background: 'linear-gradient(135deg, rgba(168,130,61,0.06) 0%, transparent 100%)', borderColor: 'var(--brass-500)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 15 }}>Ready to issue documents?</strong>
                <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                  Select a template, upload your data, sign offline, and generate printable credentials.
                </p>
              </div>
              <Button variant="primary" onClick={() => navigate('/issuer/batch-issuance')} style={{ whiteSpace: 'nowrap', marginLeft: 16 }}>
                Issue Documents
              </Button>
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
