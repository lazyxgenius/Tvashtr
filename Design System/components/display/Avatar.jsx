import React from 'react';

const CSS = `
.tv-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  flex: none; overflow: hidden;
  background: var(--panel-300); color: var(--ink-600);
  font-family: var(--font-ui); font-weight: var(--fw-medium);
  border-radius: var(--radius-pill);
  border: var(--border-width) solid var(--border-hairline);
  user-select: none;
}
.tv-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tv-avatar--square { border-radius: var(--radius-md); }
.tv-avatar--accent { background: var(--coral-100); color: var(--coral-700); border-color: var(--coral-200); }
.tv-avatar--xs { width: 24px; height: 24px; font-size: 10px; }
.tv-avatar--sm { width: 32px; height: 32px; font-size: 12px; }
.tv-avatar--md { width: 40px; height: 40px; font-size: var(--fs-body-sm); }
.tv-avatar--lg { width: 56px; height: 56px; font-size: var(--fs-h4); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-avatar-css')) {
  const s = document.createElement('style');
  s.id = 'tv-avatar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('');
}

export function Avatar({ name = '', src, size = 'md', shape = 'circle', accent = false, className = '', ...rest }) {
  const cls = [
    'tv-avatar',
    `tv-avatar--${size}`,
    shape === 'square' ? 'tv-avatar--square' : '',
    accent ? 'tv-avatar--accent' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}
