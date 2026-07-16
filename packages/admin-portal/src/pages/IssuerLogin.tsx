import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { issuerLogin } from '../lib/issuerApi';
import { ApiError } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';

export function IssuerLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await issuerLogin(email, password);
      onLoggedIn();
      navigate('/issuer/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Issuer Login</h1>
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <div className="field-error" style={{ marginBottom: 14 }}>{error}</div>}
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Card>
      <p style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 20, textAlign: 'center' }}>
        Don't have an account yet? <Link to="/issuer/signup">Apply here</Link>
      </p>
    </div>
  );
}
