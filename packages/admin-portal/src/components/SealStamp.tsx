import React from 'react';
import { IconStamp } from './icons';
import './SealStamp.css';

export function SealStamp({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="seal-stage">
      <div className="seal-mark">
        <IconStamp size={46} strokeWidth={1.4} />
      </div>
      <div className="seal-text">{title}</div>
      <div className="seal-subtext">{subtitle}</div>
    </div>
  );
}
