import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from '../lib/adminApi';
import { ApiError } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';

export function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
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
      await adminLogin(email, password);
      onLoggedIn();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Admin Login</h1>
      <p className="page-subtitle" style={{ marginBottom: 28 }}>
        Sign in with your platform admin account.
      </p>
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
      <p style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 20, textAlign: 'center' }}>
        Admin accounts are provisioned by whoever operates this deployment — there's no public admin signup.
      </p>
    </div>
  );
}
