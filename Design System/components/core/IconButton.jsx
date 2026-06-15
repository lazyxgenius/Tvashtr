import React from 'react';

const CSS = `
.tv-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  border: var(--border-width) solid transparent;
  background: transparent;
  color: var(--ink-700);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard);
}
.tv-iconbtn:hover:not([disabled]) { background: var(--panel-300); color: var(--ink-900); }
.tv-iconbtn:active:not([disabled]) { background: var(--panel-400); }
.tv-iconbtn:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.tv-iconbtn[disabled] { opacity: 0.4; cursor: not-allowed; }
.tv-iconbtn--sm { width: 32px; height: 32px; }
.tv-iconbtn--md { width: 40px; height: 40px; }
.tv-iconbtn--lg { width: 48px; height: 48px; }
.tv-iconbtn--outline { border-color: var(--border-strong); }
.tv-iconbtn--solid { background: var(--accent); color: var(--accent-contrast); }
.tv-iconbtn--solid:hover:not([disabled]) { background: var(--accent-hover); color: var(--accent-contrast); }
.tv-iconbtn--active { background: var(--coral-100); color: var(--coral-700); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-iconbtn-css')) {
  const s = document.createElement('style');
  s.id = 'tv-iconbtn-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  active = false,
  className = '',
  children,
  'aria-label': ariaLabel,
  ...rest
}) {
  const cls = [
    'tv-iconbtn',
    `tv-iconbtn--${size}`,
    variant === 'outline' ? 'tv-iconbtn--outline' : '',
    variant === 'solid' ? 'tv-iconbtn--solid' : '',
    active ? 'tv-iconbtn--active' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} aria-label={ariaLabel} aria-pressed={active || undefined} {...rest}>
      {children}
    </button>
  );
}
