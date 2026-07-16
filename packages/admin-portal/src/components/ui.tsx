import React, { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import './ui.css';

// ============================================================================
// Button
// ============================================================================
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: ReactNode;
}
export function Button({ variant = 'secondary', icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// ============================================================================
// Card
// ============================================================================
export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

// ============================================================================
// Form fields
// ============================================================================
interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
  children: ReactNode;
}
export function Field({ label, hint, error, action, children }: FieldProps) {
  return (
    <div className="field">
      <div className="field-label">
        <span>
          {label} {action}
        </span>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { mono, className = '', ...rest } = props;
  return <input className={`input ${mono ? 'mono' : ''} ${className}`} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`textarea ${className}`} {...rest} />;
}

// ============================================================================
// Chips (multi-select — used for OCR zone languages)
// ============================================================================
export function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <div className="chip-row">
      {options.map((opt) => (
        <div
          key={opt.value}
          className={`chip ${value.includes(opt.value) ? 'active' : ''}`}
          onClick={() => toggle(opt.value)}
          role="checkbox"
          aria-checked={value.includes(opt.value)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle(opt.value);
            }
          }}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Toggle
// ============================================================================
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      className="toggle-row"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <div className={`toggle-track ${checked ? 'on' : ''}`}>
        <div className="toggle-thumb" />
      </div>
      <span className="toggle-label">{label}</span>
    </div>
  );
}

// ============================================================================
// Badge
// ============================================================================
export function Badge({ tier, children }: { tier: 'accept' | 'review' | 'reject' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tier}`}>{children}</span>;
}

// ============================================================================
// Empty state
// ============================================================================
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

// ============================================================================
// Stepper
// ============================================================================
export function Stepper({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <div className="stepper">
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          <div className={`stepper-step ${i === currentIndex ? 'active' : ''} ${i < currentIndex ? 'done' : ''}`}>
            <div className="stepper-num">{i < currentIndex ? '✓' : i + 1}</div>
            <div className="stepper-label">{label}</div>
          </div>
          {i < steps.length - 1 && <div className={`stepper-rule ${i < currentIndex ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}
