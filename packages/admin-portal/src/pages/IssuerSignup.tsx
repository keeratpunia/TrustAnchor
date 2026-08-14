import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { issuerSignup } from '../lib/issuerApi';
import { ApiError } from '../lib/api';
import { Button, Card, Field, Input, PasswordInput } from '../components/ui';

export function IssuerSignup() {
  const [institutionName, setInstitutionName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    setLoading(true);
    try {
      await issuerSignup({ institutionName, email, password });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="page" style={{ maxWidth: 480, marginTop: 80, textAlign: 'center' }}>
        <h1 className="page-title">Application Submitted</h1>
        <p className="page-subtitle" style={{ margin: '0 auto 24px' }}>
          An administrator will review your application. You can log in any time to check your status — there's
          nothing further to do right now.
        </p>
        <Button variant="primary" onClick={() => navigate('/issuer/login')}>
          Go to Login
        </Button>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 460, marginTop: 60 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Apply as an Issuer</h1>
      <p className="page-subtitle" style={{ marginBottom: 28 }}>
        Submit your institution's details. An administrator reviews every application before you can log in and
        use the portal.
      </p>
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Institution Name">
            <Input value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" hint="At least 10 characters">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <div className="field-error" style={{ marginBottom: 14 }}>{error}</div>}
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit Application'}
          </Button>
        </form>
      </Card>
      <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 20, textAlign: 'center' }}>
        Already have an account? <Link to="/issuer/login">Log in</Link>
      </p>
    </div>
  );
}
