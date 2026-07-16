import React from 'react';
import { Link } from 'react-router-dom';
import { RecentTemplatesList } from '../components/RecentTemplatesList';
import { Button } from '../components/ui';
import { IconPlus } from '../components/icons';

export function Dashboard() {
  return (
    <div className="page">
      <div className="page-eyebrow">Engine 2 · Template Studio</div>
      <h1 className="page-title">Document Templates</h1>
      <p className="page-subtitle">
        Configure the layout, OCR zones, and reference assets Engine 2 uses to forensically verify a physical
        document — the QR position, printed fields to compare against the issued record, and marks like a
        logo or signature to check for.
      </p>

      <div style={{ display: 'flex', gap: 12, margin: '28px 0 40px' }}>
        <Link to="/templates/new" style={{ textDecoration: 'none' }}>
          <Button variant="primary" icon={<IconPlus size={16} />}>
            New Template
          </Button>
        </Link>
        <Link to="/lookup" style={{ textDecoration: 'none' }}>
          <Button variant="secondary">Look Up an Existing Template</Button>
        </Link>
      </div>

      <RecentTemplatesList />
    </div>
  );
}
