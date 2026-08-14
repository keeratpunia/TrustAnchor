import React from 'react';
import { NavLink } from 'react-router-dom';
import { IconLedger, IconPlus, IconSearch, IconSettings, IconAlert, IconRefresh, IconUpload, IconQr, IconHelp } from './icons';
import './NavRail.css';
import { SigningGuideModal } from './SigningGuideModal';

interface Props {
  role: 'admin' | 'issuer' | null;
  onLogout?: () => void;
}

export function NavRail({ role, onLogout }: Props) {
  const [showSigningGuide, setShowSigningGuide] = React.useState(false);

  return (
    <>
      <SigningGuideModal open={showSigningGuide} onClose={() => setShowSigningGuide(false)} />
    <nav className="nav-rail">
      <div className="nav-brand">
        <div className="nav-seal">TA</div>
        <div>
          <div className="nav-brand-text">Template Studio</div>
          <div className="nav-brand-sub">TrustAnchor </div>
        </div>
      </div>

      {role === 'admin' && (
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconLedger size={17} /> Dashboard
          </NavLink>
          <NavLink to="/templates/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconPlus size={17} /> New Template
          </NavLink>
          <NavLink to="/lookup" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconSearch size={17} /> My Templates
          </NavLink>
          <div style={{ height: 1, background: 'var(--hairline-dark)', margin: '10px 4px' }} />
          <NavLink to="/admin/applications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconAlert size={17} /> Applications
          </NavLink>
          <NavLink to="/admin/key-rotation" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconRefresh size={17} /> Key Rotation
          </NavLink>
          <NavLink to="/admin/revocation-requests" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconAlert size={17} /> Revocation Requests
          </NavLink>
          <NavLink to="/admin/manifest" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconQr size={17} /> Trust Manifest
          </NavLink>
          <NavLink to="/admin/audit-log" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconLedger size={17} /> Audit Log
          </NavLink>
        </div>
      )}

      {role === 'issuer' && (
        <div className="nav-links">
          <NavLink to="/issuer/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconLedger size={17} /> Dashboard
          </NavLink>
          <div style={{ height: 1, background: 'var(--hairline-dark)', margin: '10px 4px' }} />
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Templates</div>
          <NavLink to="/templates/new" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconPlus size={17} /> New Template
          </NavLink>
          <NavLink to="/lookup" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconSearch size={17} /> My Templates
          </NavLink>
          <div style={{ height: 1, background: 'var(--hairline-dark)', margin: '10px 4px' }} />
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Issue</div>
          <NavLink to="/issuer/batch-issuance" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconUpload size={17} /> Issue Documents
          </NavLink>
          <NavLink to="/issuer/documents" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconQr size={17} /> My Documents
          </NavLink>
          <div style={{ height: 1, background: 'var(--hairline-dark)', margin: '10px 4px' }} />
          <button
            className="nav-link"
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setShowSigningGuide(true)}
          >
            <IconHelp size={17} /> Signing Guide
          </button>
        </div>
      )}

      {role === null && <div className="nav-links" />}

      <div className="nav-footer">
        {role === 'admin' && (
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <IconSettings size={17} /> Settings
          </NavLink>
        )}
        {role && onLogout && (
          <button className="nav-link" style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={onLogout}>
            Log Out
          </button>
        )}
      </div>
    </nav>
    </>
  );
}
