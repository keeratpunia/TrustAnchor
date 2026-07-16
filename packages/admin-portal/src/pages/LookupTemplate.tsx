import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input } from '../components/ui';

export function LookupTemplate() {
  const [templateId, setTemplateId] = useState('');
  const [version, setVersion] = useState('1');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = templateId.trim();
    if (!trimmed) {
      setError('Enter a template ID.');
      return;
    }
    const versionNum = parseInt(version, 10);
    if (!Number.isFinite(versionNum) || versionNum < 1) {
      setError('Version must be a positive whole number.');
      return;
    }
    navigate(`/templates/${trimmed}/${versionNum}`);
  };

  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Look Up a Template</h1>
      <p className="page-subtitle" style={{ marginBottom: 32 }}>
        Fetch a template's full configuration directly from the backend by its exact ID and version.
      </p>

      <Card style={{ maxWidth: 480 }}>
        <form onSubmit={handleSubmit}>
          <Field label="Template ID" hint="UUID">
            <Input
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setError('');
              }}
              placeholder="e.g. 33333333-3333-3333-3333-333333333333"
              mono
            />
          </Field>
          <Field label="Version">
            <Input
              type="number"
              min={1}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </Field>
          {error && <div className="field-error" style={{ marginBottom: 14 }}>{error}</div>}
          <Button variant="primary" type="submit">
            Look Up Template
          </Button>
        </form>
      </Card>
    </div>
  );
}
