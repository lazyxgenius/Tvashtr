import React from 'react';

const CSS = `
.tv-switch { display: inline-flex; align-items: center; gap: var(--space-3); cursor: pointer; font-family: var(--font-ui); }
.tv-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.tv-switch__track {
  flex: none; width: 40px; height: 24px; border-radius: var(--radius-pill);
  background: var(--panel-400);
  border: var(--border-width) solid var(--border-strong);
  position: relative;
  transition: background var(--dur-base) var(--ease-standard), border-color var(--dur-base) var(--ease-standard);
}
.tv-switch__thumb {
  position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
  background: var(--cream-50); border-radius: 50%;
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease-out);
}
.tv-switch input:checked ~ .tv-switch__track { background: var(--accent); border-color: var(--accent); }
.tv-switch input:checked ~ .tv-switch__track .tv-switch__thumb { transform: translateX(16px); }
.tv-switch input:focus-visible ~ .tv-switch__track { box-shadow: var(--shadow-focus); }
.tv-switch input:disabled ~ .tv-switch__track { opacity: 0.5; }
.tv-switch__label { font-size: var(--fs-body-sm); color: var(--text-primary); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-switch-css')) {
  const s = document.createElement('style');
  s.id = 'tv-switch-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function Switch({ label, className = '', ...rest }) {
  return (
    <label className={`tv-switch ${className}`}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="tv-switch__track" aria-hidden="true"><span className="tv-switch__thumb" /></span>
      {label && <span className="tv-switch__label">{label}</span>}
    </label>
  );
}
