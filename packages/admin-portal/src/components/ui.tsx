import React, { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, useState } from 'react';
import './ui.css';

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

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}

interface FieldProps { label: string; hint?: string; error?: string; action?: ReactNode; children: ReactNode; }
export function Field({ label, hint, error, action, children }: FieldProps) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label} {action}</span>
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

/**
 * PasswordInput — password field with an eye icon to toggle visibility.
 * Drop-in replacement for <Input type="password" />.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { mono?: boolean }) {
  const { mono, className = '', ...rest } = props;
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrapper">
      <input className={`input password-field ${mono ? 'mono' : ''} ${className}`} type={visible ? 'text' : 'password'} {...rest} />
      <button type="button" className="password-eye" onClick={() => setVisible((v) => !v)} tabIndex={-1} aria-label={visible ? 'Hide password' : 'Show password'}>
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        )}
      </button>
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`textarea ${className}`} {...rest} />;
}

export function ChipSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (v: string) => { onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]); };
  return (
    <div className="chip-row">
      {options.map((opt) => (
        <div key={opt.value} className={`chip ${value.includes(opt.value) ? 'active' : ''}`} onClick={() => toggle(opt.value)} role="checkbox" aria-checked={value.includes(opt.value)} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(opt.value); } }}>
          {opt.label}
        </div>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="toggle-row" onClick={() => onChange(!checked)} role="switch" aria-checked={checked} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!checked); } }}>
      <div className={`toggle-track ${checked ? 'on' : ''}`}><div className="toggle-thumb" /></div>
      <span className="toggle-label">{label}</span>
    </div>
  );
}

export function Badge({ tier, children }: { tier: 'accept' | 'review' | 'reject' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tier}`}>{children}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (<div className="empty-state"><h3>{title}</h3><p>{body}</p>{action}</div>);
}

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
