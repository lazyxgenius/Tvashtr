import React from 'react';
import { Field } from './Input.jsx';

const CSS = `
.tv-select-wrap { position: relative; display: block; }
.tv-select {
  width: 100%;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  background: var(--surface-inset);
  border: var(--border-width) solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 var(--space-8) 0 var(--space-4);
  height: 44px;
  appearance: none; -webkit-appearance: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.tv-select:hover:not(:disabled) { border-color: var(--border-strong); }
.tv-select:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus); }
.tv-select:disabled { opacity: 0.55; cursor: not-allowed; }
.tv-select-wrap__chevron {
  position: absolute; right: var(--space-4); top: 50%; transform: translateY(-50%);
  pointer-events: none; color: var(--text-secondary); width: 16px; height: 16px;
}
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-select-css')) {
  const s = document.createElement('style');
  s.id = 'tv-select-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let _sid = 0;

export function Select({ label, optional, helper, error, id, options, children, className = '', ...rest }) {
  const fid = React.useRef(id || `tv-s-${++_sid}`).current;
  const control = (
    <span className="tv-select-wrap">
      <select id={fid} className={`tv-select ${className}`} {...rest}>
        {options
          ? options.map((o) => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o;
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })
          : children}
      </select>
      <svg className="tv-select-wrap__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
  if (!label && !helper && !error && !optional) return control;
  return (
    <Field label={label} optional={optional} helper={helper} error={error} htmlFor={fid}>
      {control}
    </Field>
  );
}
