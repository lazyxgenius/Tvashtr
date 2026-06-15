import React from 'react';

const CSS = `
.tv-btn {
  --_bg: var(--accent);
  --_fg: var(--accent-contrast);
  --_bd: transparent;
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-weight: var(--fw-medium);
  line-height: 1;
  white-space: nowrap;
  border: var(--border-width) solid var(--_bd);
  background: var(--_bg);
  color: var(--_fg);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              transform var(--dur-fast) var(--ease-standard);
  user-select: none;
}
.tv-btn:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.tv-btn:active { transform: translateY(0.5px); }
.tv-btn[disabled], .tv-btn[aria-disabled="true"] {
  cursor: not-allowed; opacity: 0.45; transform: none;
}

/* sizes */
.tv-btn--sm { height: 32px; padding: 0 var(--space-3); font-size: var(--fs-caption); border-radius: var(--radius-xs); }
.tv-btn--md { height: 40px; padding: 0 var(--space-4); font-size: var(--fs-body-sm); }
.tv-btn--lg { height: 48px; padding: 0 var(--space-6); font-size: var(--fs-body); }
.tv-btn--block { width: 100%; }

/* primary */
.tv-btn--primary { --_bg: var(--accent); --_fg: var(--accent-contrast); }
.tv-btn--primary:hover:not([disabled]) { --_bg: var(--accent-hover); }
.tv-btn--primary:active:not([disabled]) { --_bg: var(--accent-active); }

/* secondary — ghost/outline charcoal */
.tv-btn--secondary { --_bg: transparent; --_fg: var(--ink-900); --_bd: var(--border-strong); }
.tv-btn--secondary:hover:not([disabled]) { --_bg: var(--panel-300); }
.tv-btn--secondary:active:not([disabled]) { --_bg: var(--panel-400); }

/* ghost — no border */
.tv-btn--ghost { --_bg: transparent; --_fg: var(--ink-700); --_bd: transparent; }
.tv-btn--ghost:hover:not([disabled]) { --_bg: var(--panel-300); }

/* accent-tint — soft coral fill */
.tv-btn--tint { --_bg: var(--coral-100); --_fg: var(--coral-700); --_bd: transparent; }
.tv-btn--tint:hover:not([disabled]) { --_bg: var(--coral-200); }

.tv-btn__spin {
  width: 1em; height: 1em; border-radius: 50%;
  border: 1.5px solid currentColor; border-top-color: transparent;
  animation: tv-btn-spin 0.7s linear infinite;
}
@keyframes tv-btn-spin { to { transform: rotate(360deg); } }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-btn-css')) {
  const s = document.createElement('style');
  s.id = 'tv-btn-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  loading = false,
  fullWidth = false,
  disabled = false,
  href,
  className = '',
  children,
  ...rest
}) {
  const cls = [
    'tv-btn',
    `tv-btn--${variant}`,
    `tv-btn--${size}`,
    fullWidth ? 'tv-btn--block' : '',
    className,
  ].filter(Boolean).join(' ');

  const content = (
    <>
      {loading && <span className="tv-btn__spin" aria-hidden="true" />}
      {!loading && iconLeft}
      {children && <span>{children}</span>}
      {!loading && iconRight}
    </>
  );

  if (href && !disabled) {
    return (
      <a className={cls} href={href} {...rest}>{content}</a>
    );
  }
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  );
}
