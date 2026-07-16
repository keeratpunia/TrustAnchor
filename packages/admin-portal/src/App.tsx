import React, { useState } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { NavRail } from './components/NavRail';
import { ToastProvider } from './components/Toast';
import { RequireAdmin, RequireIssuer, RequireAdminOrIssuer } from './components/AuthGuards';
import { Dashboard } from './pages/Dashboard';
import { NewTemplateWizard } from './pages/NewTemplateWizard';
import { LookupTemplate } from './pages/LookupTemplate';
import { TemplateDetail } from './pages/TemplateDetail';
import { Settings } from './pages/Settings';
import { RoleChoice } from './pages/RoleChoice';
import { AdminLogin } from './pages/AdminLogin';
import { AdminApplications } from './pages/AdminApplications';
import { AdminKeyRotation } from './pages/AdminKeyRotation';
import { AdminAuditLog } from './pages/AdminAuditLog';
import { AdminRevocationRequests } from './pages/AdminRevocationRequests';
import { AdminManifest } from './pages/AdminManifest';
import { AdminIssuerDocuments } from './pages/AdminIssuerDocuments';
import { IssuerSignup } from './pages/IssuerSignup';
import { IssuerLogin } from './pages/IssuerLogin';
import { IssuerDashboard } from './pages/IssuerDashboard';
import { BatchIssuance } from './pages/BatchIssuance';
import { DocumentLedger } from './pages/DocumentLedger';
import { loadAdminSession, clearAdminSession, loadIssuerSession, clearIssuerSession } from './lib/auth';

type Role = 'admin' | 'issuer' | null;

function currentRole(): Role {
  if (loadAdminSession()) return 'admin';
  if (loadIssuerSession()) return 'issuer';
  return null;
}

function Shell() {
  const [role, setRole] = useState<Role>(currentRole());
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminSession();
    clearIssuerSession();
    setRole(null);
    navigate('/');
  };

  return (
    <div className="app-shell">
      <NavRail role={role} onLogout={role ? handleLogout : undefined} />
      <div className="app-main">
        <Routes>
          {/* Public */}
          <Route path="/" element={role ? (role === 'admin' ? <Dashboard /> : <IssuerDashboard />) : <RoleChoice />} />
          <Route path="/admin/login" element={<AdminLogin onLoggedIn={() => setRole('admin')} />} />
          <Route path="/issuer/signup" element={<IssuerSignup />} />
          <Route path="/issuer/login" element={<IssuerLogin onLoggedIn={() => setRole('issuer')} />} />

          {/* Admin or Issuer (template ownership is scoped server-side) */}
          <Route path="/templates/new" element={<RequireAdminOrIssuer><NewTemplateWizard /></RequireAdminOrIssuer>} />
          <Route path="/lookup" element={<RequireAdminOrIssuer><LookupTemplate /></RequireAdminOrIssuer>} />
          <Route path="/templates/:templateId/:version" element={<RequireAdminOrIssuer><TemplateDetail /></RequireAdminOrIssuer>} />

          {/* Admin only */}
          <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
          <Route path="/admin/applications" element={<RequireAdmin><AdminApplications /></RequireAdmin>} />
          <Route path="/admin/key-rotation" element={<RequireAdmin><AdminKeyRotation /></RequireAdmin>} />
          <Route path="/admin/audit-log" element={<RequireAdmin><AdminAuditLog /></RequireAdmin>} />
          <Route path="/admin/revocation-requests" element={<RequireAdmin><AdminRevocationRequests /></RequireAdmin>} />
          <Route path="/admin/manifest" element={<RequireAdmin><AdminManifest /></RequireAdmin>} />
          <Route path="/admin/issuer-accounts/:issuerAccountId/documents" element={<RequireAdmin><AdminIssuerDocuments /></RequireAdmin>} />

          {/* Issuer only */}
          <Route path="/issuer/dashboard" element={<RequireIssuer><IssuerDashboard /></RequireIssuer>} />
          <Route path="/issuer/batch-issuance" element={<RequireIssuer><BatchIssuance /></RequireIssuer>} />
          <Route path="/issuer/documents" element={<RequireIssuer><DocumentLedger /></RequireIssuer>} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  );
}
