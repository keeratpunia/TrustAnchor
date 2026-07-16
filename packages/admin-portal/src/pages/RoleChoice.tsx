import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

export function RoleChoice() {
  return (
    <div className="page" style={{ maxWidth: 640, marginTop: 60, textAlign: 'center' }}>
      <div className="page-eyebrow" style={{ textAlign: 'center' }}>
        TrustAnchor
      </div>
      <h1 className="page-title">Template Studio</h1>
      <p className="page-subtitle" style={{ margin: '0 auto 40px', textAlign: 'center' }}>
        Configure Engine 2 forensic verification for your institution's document templates.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>I'm an Issuer</h3>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 20, lineHeight: 1.6 }}>
            Apply for an issuer account, or log in if you already have one.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Link to="/issuer/login" style={{ textDecoration: 'none' }}>
              <Button variant="primary">Log In</Button>
            </Link>
            <Link to="/issuer/signup" style={{ textDecoration: 'none' }}>
              <Button variant="secondary">Apply</Button>
            </Link>
          </div>
        </Card>
        <Card>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>I'm an Admin</h3>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 20, lineHeight: 1.6 }}>
            Review issuer applications and manage the platform.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Link to="/admin/login" style={{ textDecoration: 'none' }}>
              <Button variant="primary">Log In</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
