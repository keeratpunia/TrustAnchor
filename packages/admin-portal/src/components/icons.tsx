/**
 * icons.tsx — a small, custom line-icon set.
 * Deliberately not an icon-library dependency: a handful of hand-drawn
 * 20px strokes keeps the visual identity specific to this app rather than
 * reaching for whatever a generic icon pack happens to ship.
 */
import React from 'react';

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const base = (size = 20, strokeWidth = 1.6) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function IconLedger({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function IconPlus({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconSettings({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.8-1.4-2-3.4-2.1.7a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.2a7.6 7.6 0 0 0-2.6 1.5l-2.1-.7-2 3.4 1.8 1.5a7.6 7.6 0 0 0 0 3l-1.8 1.4 2 3.4 2.1-.7a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.5-2.2a7.6 7.6 0 0 0 2.6-1.5l2.1.7 2-3.4-1.8-1.5Z" />
    </svg>
  );
}

export function IconUpload({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M12 16V4M7 8l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconCheck({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="m5 13 4.5 4.5L19 8" />
    </svg>
  );
}

export function IconAlert({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

export function IconTrash({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1A2 2 0 0 1 14.2 21H9.8a2 2 0 0 1-2-1.9L7 7" />
    </svg>
  );
}

export function IconChevronRight({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconChevronLeft({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function IconQr({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
    </svg>
  );
}

export function IconStamp({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <circle cx="12" cy="10" r="6" />
      <path d="M8 21h8l-1.2-4.8a1 1 0 0 0-1-.76h-3.6a1 1 0 0 0-1 .76L8 21Z" />
      <path d="M9.5 10.2 11 11.7l3.5-3.5" />
    </svg>
  );
}

export function IconRefresh({ size, strokeWidth, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} className={className}>
      <path d="M4 4v6h6M20 20v-6h-6" />
      <path d="M5.5 9a7 7 0 0 1 12-3.5L20 8M18.5 15a7 7 0 0 1-12 3.5L4 16" />
    </svg>
  );
}
