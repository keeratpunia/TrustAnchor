/**
 * LookupTemplate.tsx — shows all of the issuer's templates in a
 * searchable list. No UUIDs anywhere — the issuer picks by name.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMyTemplates, TemplateSummary } from '../lib/api';
import { Card, Input } from '../components/ui';

export function LookupTemplate() {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listMyTemplates()
      .then(setTemplates)
      .catch((err) => setError((err as Error).message));
  }, []);

  const filtered = templates?.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.templateId.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">My Templates</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        All the templates you've created. Click one to view its full configuration.
      </p>

      <div style={{ maxWidth: 420, marginBottom: 24 }}>
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {error && (
        <Card>
          <p style={{ color: 'var(--alert-600)' }}>{error}</p>
        </Card>
      )}

      {templates === null && !error && (
        <p style={{ color: 'var(--slate-500)' }}>Loading templates…</p>
      )}

      {filtered && filtered.length === 0 && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          {search.trim() ? (
            <>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>No matches</p>
              <p style={{ color: 'var(--slate-500)', fontSize: 13 }}>
                Nothing matched "{search}". Try a different search term.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>No templates yet</p>
              <p style={{ color: 'var(--slate-500)', fontSize: 13 }}>
                Create your first template via "New Template" in the sidebar.
              </p>
            </>
          )}
        </Card>
      )}

      {filtered && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((t) => (
            <div
              key={`${t.templateId}-${t.version}`}
              onClick={() => navigate(`/templates/${t.templateId}/${t.version}`)}
              style={{
                background: 'var(--parchment-100)',
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                cursor: 'pointer',
                transition: 'border-color 0.12s, box-shadow 0.12s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--brass-500)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(168,130,61,0.12)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--hairline)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--slate-500)', fontFamily: 'var(--font-mono)' }}>
                  v{t.version} · {t.ocrZoneCount} field{t.ocrZoneCount !== 1 ? 's' : ''}
                  {t.hasBackgroundImage ? ' · has reference photo' : ''}
                </div>
              </div>
              <div style={{ color: 'var(--slate-500)', fontSize: 18, flexShrink: 0, marginLeft: 16 }}>›</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
