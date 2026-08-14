import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

export function RoleChoice() {
  return (
    <div className="page" style={{ maxWidth: 520, marginTop: 80, textAlign: 'center' }}>
      <div className="page-eyebrow" style={{ textAlign: 'center' }}>TrustAnchor</div>
      <h1 className="page-title">Welcome</h1>
      <p className="page-subtitle" style={{ margin: '0 auto 40px', textAlign: 'center' }}>
        Issue and manage tamper-proof credentials for your institution.
      </p>

      {/* Issuer is the primary path */}
      <Card style={{ marginBottom: 16, padding: '28px 32px' }}>
        <h3 style={{ fontSize: 17, marginBottom: 8 }}>Issuer Login</h3>
        <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 20, lineHeight: 1.6 }}>
          Sign in to create templates, issue documents, and manage your credentials.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link to="/issuer/login" style={{ textDecoration: 'none' }}>
            <Button variant="primary">Log In</Button>
          </Link>
          <Link to="/issuer/signup" style={{ textDecoration: 'none' }}>
            <Button variant="secondary">Register</Button>
          </Link>
        </div>
      </Card>

      {/* Admin is secondary */}
      <Link
        to="/admin/login"
        style={{ fontSize: 12.5, color: 'var(--slate-500)', textDecoration: 'underline', display: 'inline-block', marginTop: 8 }}
      >
        Platform administrator? Log in here
      </Link>
    </div>
  );
}
