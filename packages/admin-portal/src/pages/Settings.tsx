import React, { useState } from 'react';
import { loadSettings, saveSettings } from '../lib/settings';
import { checkBackendHealth } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconRefresh } from '../components/icons';

/**
 * Settings now only configures WHERE the backend is — WHO you are is
 * handled by real login (admin/issuer accounts), not a pasted shared key.
 * See lib/auth.ts and lib/adminApi.ts/issuerApi.ts.
 */
export function Settings() {
  const [settings, setSettings] = useState(loadSettings());
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<'unknown' | 'ok' | 'down'>('unknown');
  const { showSuccess } = useToast();

  const handleSave = () => {
    saveSettings(settings);
    showSuccess('Settings saved.');
  };

  const handleCheck = async () => {
    setChecking(true);
    saveSettings(settings);
    const ok = await checkBackendHealth();
    setStatus(ok ? 'ok' : 'down');
    setChecking(false);
  };

  return (
    <div className="page">
      <div className="page-eyebrow">Configuration</div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle" style={{ marginBottom: 32 }}>
        Template Studio talks directly to your backend's existing API. Point it at the right server — who you
        are is handled by logging in, not a setting here.
      </p>

      <Card style={{ maxWidth: 560 }}>
        <Field label="Backend URL" hint="e.g. http://localhost:4000">
          <Input
            value={settings.backendUrl}
            onChange={(e) => setSettings({ ...settings, backendUrl: e.target.value })}
            placeholder="http://localhost:4000"
            mono
          />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <Button variant="primary" onClick={handleSave}>
            Save Settings
          </Button>
          <Button variant="secondary" icon={<IconRefresh size={16} />} onClick={handleCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Test Connection'}
          </Button>
        </div>

        {status === 'ok' && (
          <p style={{ color: 'var(--verified-600)', fontSize: 13, marginTop: 14, fontWeight: 600 }}>
            ✓ Connected — the backend responded.
          </p>
        )}
        {status === 'down' && (
          <p style={{ color: 'var(--alert-600)', fontSize: 13, marginTop: 14, fontWeight: 600 }}>
            ✗ Could not reach the backend at that URL. Make sure it's running and the URL is correct.
          </p>
        )}
      </Card>
    </div>
  );
}
