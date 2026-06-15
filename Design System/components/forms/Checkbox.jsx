import React from 'react';

const CSS = `
.tv-check { display: inline-flex; align-items: flex-start; gap: var(--space-3); cursor: pointer; font-family: var(--font-ui); }
.tv-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.tv-check__box {
  flex: none; width: 20px; height: 20px; margin-top: 1px;
  border: var(--border-width-2) solid var(--border-strong);
  background: var(--surface-inset);
  border-radius: var(--radius-xs);
  display: grid; place-items: center;
  color: var(--accent-contrast);
  transition: background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.tv-check__box--round { border-radius: var(--radius-pill); }
.tv-check__box svg { width: 13px; height: 13px; opacity: 0; transform: scale(0.7); transition: opacity var(--dur-fast), transform var(--dur-fast) var(--ease-out); }
.tv-check__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-contrast); opacity: 0; transform: scale(0.5); transition: opacity var(--dur-fast), transform var(--dur-fast) var(--ease-out); }
.tv-check:hover input:not(:disabled) ~ .tv-check__box { border-color: var(--accent); }
.tv-check input:checked ~ .tv-check__box { background: var(--accent); border-color: var(--accent); }
.tv-check input:checked ~ .tv-check__box svg,
.tv-check input:checked ~ .tv-check__box .tv-check__dot { opacity: 1; transform: scale(1); }
.tv-check input:focus-visible ~ .tv-check__box { box-shadow: var(--shadow-focus); }
.tv-check input:disabled ~ .tv-check__box { opacity: 0.5; }
.tv-check input:disabled ~ .tv-check__text { opacity: 0.5; }
.tv-check__text { display: flex; flex-direction: column; gap: 2px; }
.tv-check__title { font-size: var(--fs-body-sm); color: var(--text-primary); line-height: var(--lh-normal); }
.tv-check__desc { font-size: var(--fs-caption); color: var(--text-secondary); line-height: var(--lh-normal); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-check-css')) {
  const s = document.createElement('style');
  s.id = 'tv-check-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Checkbox({ type = 'checkbox', label, description, className = '', ...rest }) {
  const round = type === 'radio';
  return (
    <label className={`tv-check ${className}`}>
      <input type={type} {...rest} />
      <span className={`tv-check__box${round ? ' tv-check__box--round' : ''}`} aria-hidden="true">
        {round
          ? <span className="tv-check__dot" />
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
      </span>
      {(label || description) && (
        <span className="tv-check__text">
          {label && <span className="tv-check__title">{label}</span>}
          {description && <span className="tv-check__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}
