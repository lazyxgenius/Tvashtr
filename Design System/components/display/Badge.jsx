import React from 'react';

const CSS = `
.tv-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-ui); font-size: var(--fs-micro); font-weight: var(--fw-medium);
  line-height: 1; white-space: nowrap;
  padding: 4px 9px; border-radius: var(--radius-pill);
  border: var(--border-width) solid transparent;
}
.tv-badge--neutral { background: var(--panel-300); color: var(--ink-600); border-color: var(--border-hairline); }
.tv-badge--accent  { background: var(--coral-100); color: var(--coral-700); }
.tv-badge--info    { background: var(--blue-100); color: #3F6790; }
.tv-badge--success { background: var(--sage-100); color: #4F6038; }
.tv-badge--warning { background: var(--amber-100); color: #8A5E22; }
.tv-badge--danger  { background: var(--red-100); color: #8E3A2E; }
.tv-badge--outline { background: transparent; color: var(--ink-600); border-color: var(--border-strong); }
.tv-badge__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-badge-css')) {
  const s = document.createElement('style');
  s.id = 'tv-badge-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Badge({ variant = 'neutral', dot = false, className = '', children, ...rest }) {
  return (
    <span className={`tv-badge tv-badge--${variant} ${className}`} {...rest}>
      {dot && <span className="tv-badge__dot" />}
      {children}
    </span>
  );
}
