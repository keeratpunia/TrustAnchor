import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTemplate, ApiError } from '../lib/api';
import { TemplateDetail as TemplateDetailType } from '../lib/types';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import { IconPlus } from '../components/icons';

export function TemplateDetail() {
  const { templateId, version } = useParams<{ templateId: string; version: string }>();
  const [template, setTemplate] = useState<TemplateDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTemplate(templateId!, parseInt(version!, 10))
      .then((t) => {
        if (!cancelled) setTemplate(t);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'TEMPLATE_NOT_FOUND') {
          setError(`No template found for ${templateId} v${version}.`);
        } else {
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, version]);

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Template Detail</h1>

      {loading && <p className="page-subtitle">Loading…</p>}

      {!loading && error && (
        <EmptyState
          title="Template not found"
          body={error}
          action={
            <Link to="/templates/new" style={{ textDecoration: 'none' }}>
              <Button variant="primary" icon={<IconPlus size={16} />}>
                Create It Now
              </Button>
            </Link>
          }
        />
      )}

      {!loading && template && (
        <>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>
                  {template.name}
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                  {template.templateId} · v{template.version}
                </div>
              </div>
              <Badge tier="neutral">
                {template.layoutJson.page_width}×{template.layoutJson.page_height}px
              </Badge>
            </div>
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--hairline)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Template Hash
              </div>
              <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--ink-900)' }}>
                {template.templateHash}
              </div>
            </div>
          </Card>

          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            OCR Zones ({template.ocrZones.length})
          </h3>
          {template.ocrZones.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 28 }}>No OCR zones declared.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
              {template.ocrZones.map((z) => (
                <Card key={z.fieldName} style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{z.fieldName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 3 }}>
                        x:{z.boundingBox.x} y:{z.boundingBox.y} w:{z.boundingBox.width} h:{z.boundingBox.height} ·{' '}
                        {z.languages.join(', ')}
                      </div>
                    </div>
                    <Badge tier={z.isMandatory ? 'reject' : 'neutral'}>{z.isMandatory ? 'Mandatory' : 'Optional'}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Reference Assets ({template.assets.length})
          </h3>
          {template.assets.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--slate-500)' }}>No reference assets uploaded.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {template.assets.map((a) => (
                <Card key={a.assetName} style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.assetName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 3 }}>
                        {a.mimeType} · {a.contentHash.slice(0, 16)}…
                      </div>
                    </div>
                    <Badge tier={a.isMandatory ? 'reject' : 'neutral'}>{a.isMandatory ? 'Mandatory' : 'Optional'}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
