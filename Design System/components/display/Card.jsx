import React from 'react';

const CSS = `
.tv-card {
  background: var(--surface-card);
  border: var(--border-width) solid var(--border-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-sizing: border-box;
}
.tv-card--panel { background: var(--surface-panel); border-color: var(--border-hairline); }
.tv-card--flat { box-shadow: none; }
.tv-card--raised { box-shadow: var(--shadow-md); border-color: var(--border-faint); }
.tv-card--inverse { background: var(--surface-inverse); border-color: var(--ink-700); color: var(--text-inverse); }
.tv-card--pad-sm { padding: var(--space-4); }
.tv-card--pad-lg { padding: var(--space-8); }
.tv-card--interactive { cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.tv-card--interactive:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.tv-card--interactive:active { transform: translateY(0.5px); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-card-css')) {
  const s = document.createElement('style');
  s.id = 'tv-card-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Card({
  variant = 'paper',
  pad = 'md',
  interactive = false,
  as = 'div',
  className = '',
  children,
  ...rest
}) {
  const Tag = as;
  const cls = [
    'tv-card',
    variant === 'panel' ? 'tv-card--panel' : '',
    variant === 'raised' ? 'tv-card--raised' : '',
    variant === 'inverse' ? 'tv-card--inverse' : '',
    pad === 'sm' ? 'tv-card--pad-sm' : '',
    pad === 'lg' ? 'tv-card--pad-lg' : '',
    interactive ? 'tv-card--interactive' : '',
    className,
  ].filter(Boolean).join(' ');
  return <Tag className={cls} {...rest}>{children}</Tag>;
}
