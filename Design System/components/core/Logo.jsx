import React from 'react';

const CSS = `
.tv-logo { display: inline-flex; align-items: center; gap: var(--space-3); }
.tv-logo__mark { display: block; flex: none; }
.tv-logo__word {
  font-family: var(--font-display);
  font-weight: var(--fw-display);
  letter-spacing: var(--tracking-tight);
  line-height: 1;
  color: var(--text-primary);
}
.tv-logo--inverse .tv-logo__word { color: var(--text-inverse); }
.tv-logo__word b { font-weight: var(--fw-display); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-logo-css')) {
  const s = document.createElement('style');
  s.id = 'tv-logo-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const SRC = {
  coral: 'assets/logo/mark-coral.png',
  charcoal: 'assets/logo/mark-charcoal.png',
  cream: 'assets/logo/mark-cream.png',
};

/**
 * Brand lockup: the rosette mark + optional wordmark.
 * The mark art is fixed — only its color (tone) may change.
 */
export function Logo({
  tone = 'coral',
  size = 28,
  showWordmark = true,
  wordmark = 'Tvashtr',
  markSrc,
  inverse = false,
  className = '',
  ...rest
}) {
  const src = markSrc || SRC[tone] || SRC.coral;
  const cls = ['tv-logo', inverse ? 'tv-logo--inverse' : '', className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      <img className="tv-logo__mark" src={src} width={size} height={size} alt="Tvashtr Labs" />
      {showWordmark && (
        <span className="tv-logo__word" style={{ fontSize: Math.round(size * 0.78) }}>
          {wordmark}
        </span>
      )}
    </span>
  );
}
