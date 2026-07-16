import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { verifyAdminSession } from '../lib/adminApi';
import { fetchCurrentIssuer } from '../lib/issuerApi';

/**
 * Guards an admin-only route. Re-verifies the session against the backend
 * (GET /auth/admin/me) on every mount rather than trusting a locally-cached
 * token blindly — an expired or revoked session bounces to /admin/login
 * instead of rendering a half-broken page that then fails every API call.
 */
export function RequireAdmin({ children }: { children: React.ReactElement }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'fail'>('checking');

  useEffect(() => {
    let mounted = true;
    verifyAdminSession().then((account) => {
      if (mounted) setStatus(account ? 'ok' : 'fail');
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="page">
        <p style={{ color: 'var(--slate-500)' }}>Loading…</p>
      </div>
    );
  }
  if (status === 'fail') return <Navigate to="/admin/login" replace />;
  return children;
}

/** Same idea as RequireAdmin, for issuer-only routes. */
export function RequireIssuer({ children }: { children: React.ReactElement }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'fail'>('checking');

  useEffect(() => {
    let mounted = true;
    fetchCurrentIssuer().then((account) => {
      if (mounted) setStatus(account ? 'ok' : 'fail');
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="page">
        <p style={{ color: 'var(--slate-500)' }}>Loading…</p>
      </div>
    );
  }
  if (status === 'fail') return <Navigate to="/issuer/login" replace />;
  return children;
}

/**
 * Guards a route reachable by EITHER role (currently: template
 * creation/lookup — templatesAuth.ts's backend middleware accepts either
 * an ACTIVE issuer or an admin, so the frontend guard mirrors that). Tries
 * admin first, then issuer, redirecting to a role-choice screen only if
 * neither session is valid.
 */
export function RequireAdminOrIssuer({ children }: { children: React.ReactElement }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'fail'>('checking');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const admin = await verifyAdminSession();
      if (admin) {
        if (mounted) setStatus('ok');
        return;
      }
      const issuer = await fetchCurrentIssuer();
      if (mounted) setStatus(issuer ? 'ok' : 'fail');
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="page">
        <p style={{ color: 'var(--slate-500)' }}>Loading…</p>
      </div>
    );
  }
  if (status === 'fail') return <Navigate to="/" replace />;
  return children;
}
