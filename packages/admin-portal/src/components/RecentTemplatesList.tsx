import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { loadRecentTemplates, forgetTemplate } from '../lib/recentTemplates';
import { Button, Card, EmptyState } from './ui';
import { IconPlus, IconTrash, IconChevronRight } from './icons';

/**
 * The "recent templates" list — extracted out of Dashboard.tsx so
 * IssuerDashboard can show it too. This used to only exist on the admin's
 * home page, which meant an issuer who'd just created a template had no
 * "my templates" screen anywhere to land on — Look Up (type a UUID
 * manually) was the only path left. Not acceptable friction; every actor
 * gets this list now.
 */
export function RecentTemplatesList({ compact = false }: { compact?: boolean }) {
  const [recents, setRecents] = useState(loadRecentTemplates());

  const handleForget = (templateId: string, version: number) => {
    forgetTemplate(templateId, version);
    setRecents(loadRecentTemplates());
  };

  return (
    <div>
      {!compact && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            My Templates
          </h3>
          <p style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 16 }}>
            Remembered on this device the moment you create or view one — not fetched from the server, since
            there's no "list every template" endpoint by design.
          </p>
        </>
      )}

      {recents.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="Every credential Engine 2 verifies needs a configured template first. Start by creating one — it only takes a few minutes."
          action={
            <Link to="/templates/new" style={{ textDecoration: 'none' }}>
              <Button variant="primary" icon={<IconPlus size={16} />}>
                Create Your First Template
              </Button>
            </Link>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {recents.map((t) => (
            <Card key={`${t.templateId}-${t.version}`} style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>{t.name}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>
                    {t.templateId} · v{t.version}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleForget(t.templateId, t.version)}
                    title="Remove from this list"
                  >
                    <IconTrash size={15} />
                  </button>
                  <Link to={`/templates/${t.templateId}/${t.version}`} style={{ textDecoration: 'none' }}>
                    <Button variant="secondary" icon={<IconChevronRight size={15} />}>
                      View
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
