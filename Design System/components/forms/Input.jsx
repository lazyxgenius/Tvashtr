import React from 'react';

const CSS = `
.tv-field { display: flex; flex-direction: column; gap: var(--space-2); font-family: var(--font-ui); }
.tv-field__top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.tv-field__label { font-size: var(--fs-label); font-weight: var(--fw-medium); color: var(--text-primary); }
.tv-field__optional { font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: var(--fw-regular); }
.tv-field__help { font-size: var(--fs-caption); color: var(--text-secondary); line-height: var(--lh-normal); }
.tv-field__help--error { color: var(--danger); }

.tv-input {
  width: 100%;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  background: var(--surface-inset);
  border: var(--border-width) solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 var(--space-4);
  height: 44px;
  transition: border-color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard),
              background var(--dur-fast) var(--ease-standard);
  box-sizing: border-box;
}
.tv-input::placeholder { color: var(--text-placeholder); }
.tv-input:hover:not(:disabled) { border-color: var(--border-strong); }
.tv-input:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus); background: var(--surface-raised); }
.tv-input:disabled { opacity: 0.55; cursor: not-allowed; }
.tv-input--area { height: auto; min-height: 96px; padding: var(--space-3) var(--space-4); line-height: var(--lh-normal); resize: vertical; }
.tv-input--error { border-color: var(--danger); }
.tv-input--error:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 30%, transparent); }
.tv-input--sm { height: 36px; font-size: var(--fs-body-sm); }
`;

if (typeof document !== 'undefined' && !document.getElementById('tv-input-css')) {
  const s = document.createElement('style');
  s.id = 'tv-input-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

let _uid = 0;
function useId(provided) {
  const ref = React.useRef(provided);
  if (!ref.current) ref.current = provided || `tv-f-${++_uid}`;
  return ref.current;
}

export function Field({ label, optional, helper, error, htmlFor, children }) {
  return (
    <div className="tv-field">
      {(label || optional) && (
        <div className="tv-field__top">
          {label && <label className="tv-field__label" htmlFor={htmlFor}>{label}</label>}
          {optional && <span className="tv-field__optional">Optional</span>}
        </div>
      )}
      {children}
      {(error || helper) && (
        <span className={`tv-field__help${error ? ' tv-field__help--error' : ''}`}>
          {error || helper}
        </span>
      )}
    </div>
  );
}

export function Input({
  label, optional, helper, error, size, id, multiline, rows = 4, className = '', ...rest
}) {
  const fid = useId(id);
  const inputCls = [
    'tv-input',
    multiline ? 'tv-input--area' : '',
    error ? 'tv-input--error' : '',
    size === 'sm' ? 'tv-input--sm' : '',
    className,
  ].filter(Boolean).join(' ');

  const control = multiline
    ? <textarea id={fid} className={inputCls} rows={rows} {...rest} />
    : <input id={fid} className={inputCls} {...rest} />;

  if (!label && !helper && !error && !optional) return control;
  return (
    <Field label={label} optional={optional} helper={helper} error={error} htmlFor={fid}>
      {control}
    </Field>
  );
}
