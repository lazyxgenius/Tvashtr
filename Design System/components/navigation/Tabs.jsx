import React from 'react';

const CSS = `
.tv-tabs { display: inline-flex; align-items: center; gap: var(--space-1); font-family: var(--font-ui); }
.tv-tabs--line { gap: var(--space-5); border-bottom: var(--border-width) solid var(--border-hairline); }
.tv-tab {
  appearance: none; border: none; background: transparent; cursor: pointer;
  font-family: inherit; font-size: var(--fs-body-sm); font-weight: var(--fw-medium);
  color: var(--text-secondary);
  display: inline-flex; align-items: center; gap: var(--space-2);
  transition: color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
}
.tv-tab:hover { color: var(--text-primary); }
.tv-tab:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-sm); }

/* pill style */
.tv-tabs--pill .tv-tab { padding: 7px 14px; border-radius: var(--radius-pill); }
.tv-tabs--pill { background: var(--surface-inset); padding: var(--space-1); border-radius: var(--radius-pill); border: var(--border-width) solid var(--border-hairline); }
.tv-tabs--pill .tv-tab[aria-selected="true"] { background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-xs); }

/* line style */
.tv-tabs--line .tv-tab { padding: 0 0 12px; position: relative; }
.tv-tabs--line .tv-tab[aria-selected="true"] { color: var(--text-primary); }
.tv-tabs--line .tv-tab[aria-selected="true"]::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  background: var(--accent); border-radius: 2px 2px 0 0;
}
.tv-tab__count { font-size: var(--fs-micro); color: var(--text-tertiary); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-tabs-css')) {
  const s = document.createElement('style');
  s.id = 'tv-tabs-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Tabs({ items = [], value, defaultValue, onChange, variant = 'line', className = '' }) {
  const [internal, setInternal] = React.useState(defaultValue ?? items[0]?.value);
  const active = value !== undefined ? value : internal;
  const select = (v) => { if (value === undefined) setInternal(v); onChange?.(v); };
  return (
    <div className={`tv-tabs tv-tabs--${variant} ${className}`} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={active === it.value}
          className="tv-tab"
          onClick={() => select(it.value)}
        >
          {it.icon}
          <span>{it.label}</span>
          {it.count != null && <span className="tv-tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
