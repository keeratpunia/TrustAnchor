import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { loadRecentTemplates, forgetTemplate } from '../lib/recentTemplates';
import { Button, Card, EmptyState } from './ui';
import { IconPlus, IconTrash, IconChevronRight } from './icons';

export function RecentTemplatesList({ compact = false }: { compact?: boolean }) {
  const [recents, setRecents] = useState(loadRecentTemplates());

  const handleForget = (templateId: string, version: number) => {
    forgetTemplate(templateId, version);
    setRecents(loadRecentTemplates());
  };

  return (
    <div>
      {!compact && (
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
          My Templates
        </h3>
      )}

      {recents.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="Start by creating a template — it defines the layout and fields for the credentials you'll issue."
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
