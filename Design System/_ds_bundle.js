/* @ds-bundle: {"format":3,"namespace":"DesignSystem_dbaa69","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Input.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Button.jsx":"03d93ead664e","components/core/IconButton.jsx":"6a9b04ffc8cd","components/core/Logo.jsx":"e2a4274dfbba","components/display/Avatar.jsx":"45d18529fdee","components/display/Badge.jsx":"fc1e6ad1a609","components/display/Card.jsx":"faa70f4f7942","components/forms/Checkbox.jsx":"fb8d9f987a60","components/forms/Input.jsx":"8c4049516ca1","components/forms/Select.jsx":"7e737e3d6989","components/forms/Switch.jsx":"5bf01fadbd50","components/navigation/Tabs.jsx":"0e3925606f1a","ui_kits/_shared/Icons.jsx":"a74e928243a6","ui_kits/chat/ChatApp.jsx":"83a1c6016444","ui_kits/chat/ChatConversation.jsx":"bedacebfe2bc","ui_kits/chat/ChatLogin.jsx":"89289bf46b53","ui_kits/chat/ChatSidebar.jsx":"ab4a813c1a43","ui_kits/terminal/TerminalKit.jsx":"e1ddd579f6bb","ui_kits/web/WebKit.jsx":"8f40a8ba58aa"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_dbaa69 = window.DesignSystem_dbaa69 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Button({
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
  const cls = ['tv-btn', `tv-btn--${variant}`, `tv-btn--${size}`, fullWidth ? 'tv-btn--block' : '', className].filter(Boolean).join(' ');
  const content = /*#__PURE__*/React.createElement(React.Fragment, null, loading && /*#__PURE__*/React.createElement("span", {
    className: "tv-btn__spin",
    "aria-hidden": "true"
  }), !loading && iconLeft, children && /*#__PURE__*/React.createElement("span", null, children), !loading && iconRight);
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      className: cls,
      href: href
    }, rest), content);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    disabled: disabled || loading
  }, rest), content);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function IconButton({
  variant = 'ghost',
  size = 'md',
  active = false,
  className = '',
  children,
  'aria-label': ariaLabel,
  ...rest
}) {
  const cls = ['tv-iconbtn', `tv-iconbtn--${size}`, variant === 'outline' ? 'tv-iconbtn--outline' : '', variant === 'solid' ? 'tv-iconbtn--solid' : '', active ? 'tv-iconbtn--active' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    "aria-label": ariaLabel,
    "aria-pressed": active || undefined
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  cream: 'assets/logo/mark-cream.png'
};

/**
 * Brand lockup: the rosette mark + optional wordmark.
 * The mark art is fixed — only its color (tone) may change.
 */
function Logo({
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
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), /*#__PURE__*/React.createElement("img", {
    className: "tv-logo__mark",
    src: src,
    width: size,
    height: size,
    alt: "Tvashtr Labs"
  }), showWordmark && /*#__PURE__*/React.createElement("span", {
    className: "tv-logo__word",
    style: {
      fontSize: Math.round(size * 0.78)
    }
  }, wordmark));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  return parts.map(p => p[0]?.toUpperCase() || '').join('');
}
function Avatar({
  name = '',
  src,
  size = 'md',
  shape = 'circle',
  accent = false,
  className = '',
  ...rest
}) {
  const cls = ['tv-avatar', `tv-avatar--${size}`, shape === 'square' ? 'tv-avatar--square' : '', accent ? 'tv-avatar--accent' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name
  }) : initials(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Badge({
  variant = 'neutral',
  dot = false,
  className = '',
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `tv-badge tv-badge--${variant} ${className}`
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "tv-badge__dot"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Card({
  variant = 'paper',
  pad = 'md',
  interactive = false,
  as = 'div',
  className = '',
  children,
  ...rest
}) {
  const Tag = as;
  const cls = ['tv-card', variant === 'panel' ? 'tv-card--panel' : '', variant === 'raised' ? 'tv-card--raised' : '', variant === 'inverse' ? 'tv-card--inverse' : '', pad === 'sm' ? 'tv-card--pad-sm' : '', pad === 'lg' ? 'tv-card--pad-lg' : '', interactive ? 'tv-card--interactive' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Checkbox({
  type = 'checkbox',
  label,
  description,
  className = '',
  ...rest
}) {
  const round = type === 'radio';
  return /*#__PURE__*/React.createElement("label", {
    className: `tv-check ${className}`
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: type
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: `tv-check__box${round ? ' tv-check__box--round' : ''}`,
    "aria-hidden": "true"
  }, round ? /*#__PURE__*/React.createElement("span", {
    className: "tv-check__dot"
  }) : /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6L9 17l-5-5"
  }))), (label || description) && /*#__PURE__*/React.createElement("span", {
    className: "tv-check__text"
  }, label && /*#__PURE__*/React.createElement("span", {
    className: "tv-check__title"
  }, label), description && /*#__PURE__*/React.createElement("span", {
    className: "tv-check__desc"
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Field({
  label,
  optional,
  helper,
  error,
  htmlFor,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tv-field"
  }, (label || optional) && /*#__PURE__*/React.createElement("div", {
    className: "tv-field__top"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "tv-field__label",
    htmlFor: htmlFor
  }, label), optional && /*#__PURE__*/React.createElement("span", {
    className: "tv-field__optional"
  }, "Optional")), children, (error || helper) && /*#__PURE__*/React.createElement("span", {
    className: `tv-field__help${error ? ' tv-field__help--error' : ''}`
  }, error || helper));
}
function Input({
  label,
  optional,
  helper,
  error,
  size,
  id,
  multiline,
  rows = 4,
  className = '',
  ...rest
}) {
  const fid = useId(id);
  const inputCls = ['tv-input', multiline ? 'tv-input--area' : '', error ? 'tv-input--error' : '', size === 'sm' ? 'tv-input--sm' : '', className].filter(Boolean).join(' ');
  const control = multiline ? /*#__PURE__*/React.createElement("textarea", _extends({
    id: fid,
    className: inputCls,
    rows: rows
  }, rest)) : /*#__PURE__*/React.createElement("input", _extends({
    id: fid,
    className: inputCls
  }, rest));
  if (!label && !helper && !error && !optional) return control;
  return /*#__PURE__*/React.createElement(Field, {
    label: label,
    optional: optional,
    helper: helper,
    error: error,
    htmlFor: fid
  }, control);
}
Object.assign(__ds_scope, { Field, Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.tv-select-wrap { position: relative; display: block; }
.tv-select {
  width: 100%;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  background: var(--surface-inset);
  border: var(--border-width) solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 var(--space-8) 0 var(--space-4);
  height: 44px;
  appearance: none; -webkit-appearance: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.tv-select:hover:not(:disabled) { border-color: var(--border-strong); }
.tv-select:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus); }
.tv-select:disabled { opacity: 0.55; cursor: not-allowed; }
.tv-select-wrap__chevron {
  position: absolute; right: var(--space-4); top: 50%; transform: translateY(-50%);
  pointer-events: none; color: var(--text-secondary); width: 16px; height: 16px;
}
`;
if (typeof document !== 'undefined' && !document.getElementById('tv-select-css')) {
  const s = document.createElement('style');
  s.id = 'tv-select-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
let _sid = 0;
function Select({
  label,
  optional,
  helper,
  error,
  id,
  options,
  children,
  className = '',
  ...rest
}) {
  const fid = React.useRef(id || `tv-s-${++_sid}`).current;
  const control = /*#__PURE__*/React.createElement("span", {
    className: "tv-select-wrap"
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fid,
    className: `tv-select ${className}`
  }, rest), options ? options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  }) : children), /*#__PURE__*/React.createElement("svg", {
    className: "tv-select-wrap__chevron",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  })));
  if (!label && !helper && !error && !optional) return control;
  return /*#__PURE__*/React.createElement(__ds_scope.Field, {
    label: label,
    optional: optional,
    helper: helper,
    error: error,
    htmlFor: fid
  }, control);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Switch({
  label,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `tv-switch ${className}`
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "tv-switch__track",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tv-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", {
    className: "tv-switch__label"
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
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
function Tabs({
  items = [],
  value,
  defaultValue,
  onChange,
  variant = 'line',
  className = ''
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? items[0]?.value);
  const active = value !== undefined ? value : internal;
  const select = v => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: `tv-tabs tv-tabs--${variant} ${className}`,
    role: "tablist"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.value,
    role: "tab",
    "aria-selected": active === it.value,
    className: "tv-tab",
    onClick: () => select(it.value)
  }, it.icon, /*#__PURE__*/React.createElement("span", null, it.label), it.count != null && /*#__PURE__*/React.createElement("span", {
    className: "tv-tab__count"
  }, it.count))));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/_shared/Icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Shared inline line-icons (Lucide-style, 1.6px stroke) for the UI kits.
const TvIcons = (() => {
  const S = ({
    children,
    size = 20,
    sw = 1.6,
    ...p
  }) => /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: sw,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), children);
  return {
    Plus: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    })),
    Search: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m21 21-4.3-4.3"
    })),
    ArrowUp: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M12 19V5M6 11l6-6 6 6"
    })),
    Paperclip: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 18a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
    })),
    Message: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4-1L3 20l1.1-4.9a8.4 8.4 0 0 1 16.9-3.6Z"
    })),
    Settings: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "3"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9Z"
    })),
    More: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("circle", {
      cx: "5",
      cy: "12",
      r: "1"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "1"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "19",
      cy: "12",
      r: "1"
    })),
    Pen: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M12 20h9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
    })),
    Sparkles: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 14l.7 1.9L21.5 17l-1.8.6L19 19.5l-.7-1.9L16.5 17l1.8-.6Z"
    })),
    Check: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M20 6 9 17l-5-5"
    })),
    Chevron: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "m6 9 6 6 6-6"
    })),
    Folder: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
    })),
    Terminal: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "m4 17 6-5-6-5M12 19h8"
    })),
    Book: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M2 4.5A2.5 2.5 0 0 1 4.5 2H20v17H4.5A2.5 2.5 0 0 0 2 21.5Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M2 21.5V4.5"
    })),
    Compass: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m15.5 8.5-2 5-5 2 2-5Z"
    })),
    Layout: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 9h18M9 21V9"
    })),
    Copy: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("rect", {
      x: "9",
      y: "9",
      width: "11",
      height: "11",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
    })),
    Refresh: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M21 12a9 9 0 1 1-3-6.7L21 8"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M21 3v5h-5"
    })),
    ThumbUp: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M7 10v11M2 13v6a2 2 0 0 0 2 2h13.3a2 2 0 0 0 2-1.7l1.3-7a2 2 0 0 0-2-2.3H14l1-5a2 2 0 0 0-2-2L7 10"
    })),
    Arrow: p => /*#__PURE__*/React.createElement(S, p, /*#__PURE__*/React.createElement("path", {
      d: "M5 12h14M13 6l6 6-6 6"
    }))
  };
})();
window.TvIcons = TvIcons;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/_shared/Icons.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chat/ChatApp.jsx
try { (() => {
// Chat app shell: login → workspace, thread state, fake send/reply.
const REPLIES = ["Happily. Here's a calm first draft — plain language, no hype:\n\n“We've quietly reshaped how threads carry context. Pick any one back up and it remembers where you were.”\n\nWant it warmer, or shorter?", "Let's take it slowly. The trace points at a nil thread handle being woven before the loom finished spinning up — usually an ordering thing. Move the build call after the ready event and it should settle.", "A quiet launch suits this. One note to your list, the mark on the empty state, and a single thread people can reply to. No countdown, no fireworks — just the door left open."];
function ChatApp() {
  const seed = [{
    id: 't1',
    group: 'today',
    title: 'Release note, warmer tone',
    preview: 'a calmer way to say it',
    messages: [{
      role: 'user',
      name: 'Ada Lovelace',
      text: 'Can you make this release note warmer and less hype-y?'
    }, {
      role: 'agent',
      text: REPLIES[0]
    }]
  }, {
    id: 't2',
    group: 'today',
    title: 'Stack trace on weave build',
    preview: 'nil thread handle…',
    messages: []
  }, {
    id: 't3',
    group: 'week',
    title: 'Planning a quiet launch',
    preview: 'no countdown, no fireworks',
    messages: []
  }, {
    id: 't4',
    group: 'week',
    title: 'Naming the canvas feature',
    preview: 'loom, weave, thread…',
    messages: []
  }];
  const [signedIn, setSignedIn] = React.useState(false);
  const [threads, setThreads] = React.useState(seed);
  const [activeId, setActiveId] = React.useState('t1');
  const replyIdx = React.useRef(0);
  const active = threads.find(t => t.id === activeId) || threads[0];
  const send = text => {
    setThreads(prev => prev.map(t => t.id === activeId ? {
      ...t,
      messages: [...t.messages, {
        role: 'user',
        name: 'Ada Lovelace',
        text
      }]
    } : t));
    const reply = REPLIES[replyIdx.current++ % REPLIES.length];
    setTimeout(() => {
      setThreads(prev => prev.map(t => t.id === activeId ? {
        ...t,
        messages: [...t.messages, {
          role: 'agent',
          text: reply
        }]
      } : t));
    }, 650);
  };
  const newThread = () => {
    const id = 'n' + Date.now();
    setThreads(prev => [{
      id,
      group: 'today',
      title: 'New thread',
      preview: 'just started',
      messages: []
    }, ...prev]);
    setActiveId(id);
  };
  if (!signedIn) return /*#__PURE__*/React.createElement(ChatLogin, {
    onContinue: () => setSignedIn(true)
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement(ChatSidebar, {
    threads: threads,
    activeId: activeId,
    onSelect: setActiveId,
    onNew: newThread
  }), /*#__PURE__*/React.createElement(ChatConversation, {
    thread: active,
    onSend: send
  }));
}
window.ChatApp = ChatApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chat/ChatApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chat/ChatConversation.jsx
try { (() => {
// Conversation pane: header, message list (with empty state) and composer.
function ChatMessage({
  role,
  name,
  children
}) {
  const {
    Avatar
  } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const isAgent = role === 'agent';
  return /*#__PURE__*/React.createElement("div", {
    style: cv.msg
  }, /*#__PURE__*/React.createElement("div", {
    style: cv.msgHead
  }, isAgent ? /*#__PURE__*/React.createElement("span", {
    style: cv.agentAvatar
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-coral.png",
    width: "20",
    height: "20",
    alt: ""
  })) : /*#__PURE__*/React.createElement(Avatar, {
    name: name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: cv.msgName
  }, isAgent ? 'Tvashtr' : name)), /*#__PURE__*/React.createElement("div", {
    style: cv.msgBody
  }, children), isAgent && /*#__PURE__*/React.createElement("div", {
    style: cv.msgTools
  }, /*#__PURE__*/React.createElement("button", {
    style: cv.tool
  }, /*#__PURE__*/React.createElement(I.Copy, {
    size: 15
  })), /*#__PURE__*/React.createElement("button", {
    style: cv.tool
  }, /*#__PURE__*/React.createElement(I.Refresh, {
    size: 15
  })), /*#__PURE__*/React.createElement("button", {
    style: cv.tool
  }, /*#__PURE__*/React.createElement(I.ThumbUp, {
    size: 15
  }))));
}
function ChatComposer({
  onSend
}) {
  const {
    IconButton
  } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const [val, setVal] = React.useState('');
  const send = () => {
    if (val.trim()) {
      onSend(val.trim());
      setVal('');
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    style: cv.composerWrap
  }, /*#__PURE__*/React.createElement("div", {
    style: cv.composer
  }, /*#__PURE__*/React.createElement("textarea", {
    value: val,
    onChange: e => setVal(e.target.value),
    rows: 1,
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    placeholder: "Ask anything, or pick a thread back up\u2026",
    style: cv.textarea
  }), /*#__PURE__*/React.createElement("div", {
    style: cv.composerBar
  }, /*#__PURE__*/React.createElement("div", {
    style: cv.composerLeft
  }, /*#__PURE__*/React.createElement("button", {
    style: cv.chip
  }, /*#__PURE__*/React.createElement(I.Paperclip, {
    size: 16
  })), /*#__PURE__*/React.createElement("button", {
    style: cv.modelChip
  }, /*#__PURE__*/React.createElement(I.Sparkles, {
    size: 15
  }), " Tvashtr Loom ", /*#__PURE__*/React.createElement(I.Chevron, {
    size: 14
  }))), /*#__PURE__*/React.createElement(IconButton, {
    variant: "solid",
    "aria-label": "Send",
    onClick: send
  }, /*#__PURE__*/React.createElement(I.ArrowUp, {
    size: 18
  })))), /*#__PURE__*/React.createElement("p", {
    style: cv.hint
  }, "Tvashtr can be wrong. Keep your own copy of anything important."));
}
function ChatConversation({
  thread,
  onSend
}) {
  const I = window.TvIcons;
  const scroller = React.useRef(null);
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);
  const empty = thread.messages.length === 0;
  return /*#__PURE__*/React.createElement("section", {
    style: cv.root
  }, /*#__PURE__*/React.createElement("header", {
    style: cv.header
  }, /*#__PURE__*/React.createElement("div", {
    style: cv.headerTitle
  }, thread.title), /*#__PURE__*/React.createElement("div", {
    style: cv.headerActions
  }, /*#__PURE__*/React.createElement("button", {
    style: cv.tool
  }, /*#__PURE__*/React.createElement(I.Book, {
    size: 18
  })), /*#__PURE__*/React.createElement("button", {
    style: cv.tool
  }, /*#__PURE__*/React.createElement(I.More, {
    size: 18
  })))), /*#__PURE__*/React.createElement("div", {
    ref: scroller,
    style: cv.scroll
  }, empty ? /*#__PURE__*/React.createElement("div", {
    style: cv.empty
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-charcoal.png",
    width: "64",
    height: "64",
    alt: "",
    style: {
      opacity: 0.5
    }
  }), /*#__PURE__*/React.createElement("h2", {
    style: cv.emptyTitle
  }, "What are you working on?"), /*#__PURE__*/React.createElement("p", {
    style: cv.emptySub
  }, "Start a thread and it\u2019ll appear on the loom. Tvashtr keeps the context so you can pick it back up later."), /*#__PURE__*/React.createElement("div", {
    style: cv.suggests
  }, ['Draft a warm release note', 'Explain this stack trace', 'Plan a quiet launch'].map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    style: cv.suggest,
    onClick: () => onSend(s)
  }, s)))) : /*#__PURE__*/React.createElement("div", {
    style: cv.thread
  }, thread.messages.map((m, i) => /*#__PURE__*/React.createElement(ChatMessage, {
    key: i,
    role: m.role,
    name: m.name
  }, m.text)))), /*#__PURE__*/React.createElement(ChatComposer, {
    onSend: onSend
  }));
}
const cv = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minWidth: 0,
    background: 'var(--surface-page)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 26px',
    height: 60,
    borderBottom: '1px solid var(--border-hairline)',
    flex: 'none'
  },
  headerTitle: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 19,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)'
  },
  headerActions: {
    display: 'flex',
    gap: 4,
    color: 'var(--text-tertiary)'
  },
  tool: {
    width: 34,
    height: 34,
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer'
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0'
  },
  thread: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '24px'
  },
  msg: {
    padding: '18px 0',
    borderBottom: '1px solid var(--border-faint)'
  },
  msgHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 10
  },
  agentAvatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'var(--coral-100)',
    border: '1px solid var(--coral-200)',
    display: 'grid',
    placeItems: 'center',
    flex: 'none'
  },
  msgName: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13.5,
    fontWeight: 600,
    color: 'var(--text-primary)'
  },
  msgBody: {
    fontFamily: 'var(--font-sans)',
    fontSize: 15.5,
    lineHeight: 1.62,
    color: 'var(--text-primary)',
    paddingLeft: 37,
    whiteSpace: 'pre-wrap'
  },
  msgTools: {
    display: 'flex',
    gap: 2,
    paddingLeft: 33,
    marginTop: 8,
    color: 'var(--text-tertiary)'
  },
  empty: {
    maxWidth: 560,
    margin: '0 auto',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '40px 24px'
  },
  emptyTitle: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 30,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: '20px 0 8px'
  },
  emptySub: {
    fontFamily: 'var(--font-sans)',
    fontSize: 15,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    maxWidth: 420,
    margin: 0
  },
  suggests: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 26
  },
  suggest: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13.5,
    color: 'var(--text-primary)',
    background: 'var(--cream-50)',
    border: '1px solid var(--border-hairline)',
    borderRadius: 'var(--radius-pill)',
    padding: '8px 15px',
    cursor: 'pointer'
  },
  composerWrap: {
    padding: '12px 24px 18px',
    flex: 'none'
  },
  composer: {
    maxWidth: 720,
    margin: '0 auto',
    background: 'var(--cream-50)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    padding: 12,
    boxShadow: 'var(--shadow-sm)'
  },
  textarea: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    outline: 'none',
    resize: 'none',
    fontFamily: 'var(--font-sans)',
    fontSize: 15.5,
    lineHeight: 1.5,
    color: 'var(--text-primary)',
    padding: '6px 8px',
    boxSizing: 'border-box'
  },
  composerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6
  },
  composerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  chip: {
    width: 34,
    height: 34,
    display: 'grid',
    placeItems: 'center',
    border: '1px solid var(--border-hairline)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer'
  },
  modelChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    border: '1px solid var(--border-hairline)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: 13
  },
  hint: {
    maxWidth: 720,
    margin: '8px auto 0',
    textAlign: 'center',
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    color: 'var(--text-tertiary)'
  }
};
window.ChatConversation = ChatConversation;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chat/ChatConversation.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chat/ChatLogin.jsx
try { (() => {
// Login screen for the Tvashtr chat app.
function ChatLogin({
  onContinue
}) {
  const {
    Button,
    Input,
    Logo
  } = window.DesignSystem_dbaa69;
  const [email, setEmail] = React.useState('ada@loomsandletters.co');
  return /*#__PURE__*/React.createElement("div", {
    style: cl.page
  }, /*#__PURE__*/React.createElement("div", {
    style: cl.card
  }, /*#__PURE__*/React.createElement("div", {
    style: cl.mark
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-coral.png",
    width: "52",
    height: "52",
    alt: "Tvashtr"
  })), /*#__PURE__*/React.createElement("h1", {
    style: cl.title
  }, "Welcome back"), /*#__PURE__*/React.createElement("p", {
    style: cl.sub
  }, "Pick up your threads where you left them."), /*#__PURE__*/React.createElement("div", {
    style: cl.form
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    onClick: onContinue
  }, "Continue")), /*#__PURE__*/React.createElement("div", {
    style: cl.divider
  }, /*#__PURE__*/React.createElement("span", {
    style: cl.dividerLine
  }), /*#__PURE__*/React.createElement("span", {
    style: cl.dividerWord
  }, "or"), /*#__PURE__*/React.createElement("span", {
    style: cl.dividerLine
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    fullWidth: true,
    onClick: onContinue
  }, "Continue with single sign-on"), /*#__PURE__*/React.createElement("p", {
    style: cl.foot
  }, "New to Tvashtr? ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: cl.link,
    onClick: e => {
      e.preventDefault();
      onContinue();
    }
  }, "Create a workspace"))), /*#__PURE__*/React.createElement("p", {
    style: cl.legal
  }, "Tvashtr Labs \xB7 a calmer way to think out loud"));
}
const cl = {
  page: {
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    padding: 40,
    boxSizing: 'border-box',
    background: 'var(--surface-page)'
  },
  card: {
    width: 'min(420px, 100%)',
    background: 'var(--surface-card)',
    border: '1px solid var(--border-hairline)',
    borderRadius: 'var(--radius-xl)',
    padding: '40px 40px 32px',
    boxShadow: 'var(--shadow-md)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  mark: {
    marginBottom: 18
  },
  title: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 30,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: 0
  },
  sub: {
    fontFamily: 'var(--font-sans)',
    fontSize: 15,
    color: 'var(--text-secondary)',
    margin: '8px 0 26px',
    textAlign: 'center'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: '100%'
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    margin: '20px 0'
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border-hairline)'
  },
  dividerWord: {
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    color: 'var(--text-tertiary)'
  },
  foot: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    color: 'var(--text-secondary)',
    marginTop: 22
  },
  link: {
    color: 'var(--text-link)',
    textDecoration: 'none',
    fontWeight: 500
  },
  legal: {
    fontFamily: 'var(--font-serif)',
    fontStyle: 'italic',
    fontSize: 14,
    color: 'var(--text-tertiary)'
  }
};
window.ChatLogin = ChatLogin;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chat/ChatLogin.jsx", error: String((e && e.message) || e) }); }

// ui_kits/chat/ChatSidebar.jsx
try { (() => {
// Left sidebar: brand, new thread, search, grouped thread list, account.
function ChatSidebar({
  threads,
  activeId,
  onSelect,
  onNew
}) {
  const {
    Button,
    Avatar
  } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  const groups = [{
    label: 'Today',
    items: threads.filter(t => t.group === 'today')
  }, {
    label: 'Earlier this week',
    items: threads.filter(t => t.group === 'week')
  }];
  return /*#__PURE__*/React.createElement("aside", {
    style: sb.root
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.top
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.brand
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-coral.png",
    width: "26",
    height: "26",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: sb.word
  }, "Tvashtr"))), /*#__PURE__*/React.createElement("div", {
    style: sb.actions
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "md",
    fullWidth: true,
    iconLeft: /*#__PURE__*/React.createElement(I.Pen, {
      size: 17
    }),
    onClick: onNew
  }, "New thread"), /*#__PURE__*/React.createElement("div", {
    style: sb.search
  }, /*#__PURE__*/React.createElement(I.Search, {
    size: 16
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search threads",
    style: sb.searchInput
  }))), /*#__PURE__*/React.createElement("nav", {
    style: sb.list
  }, groups.map(g => g.items.length > 0 && /*#__PURE__*/React.createElement("div", {
    key: g.label,
    style: sb.group
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.groupLabel
  }, g.label), g.items.map(t => {
    const active = t.id === activeId;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      onClick: () => onSelect(t.id),
      style: {
        ...sb.item,
        ...(active ? sb.itemActive : null)
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: sb.itemTitle
    }, t.title), /*#__PURE__*/React.createElement("span", {
      style: sb.itemMeta
    }, t.preview));
  })))), /*#__PURE__*/React.createElement("div", {
    style: sb.account
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Ada Lovelace",
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: sb.accountText
  }, /*#__PURE__*/React.createElement("span", {
    style: sb.accountName
  }, "Ada Lovelace"), /*#__PURE__*/React.createElement("span", {
    style: sb.accountPlan
  }, "Studio plan")), /*#__PURE__*/React.createElement(I.Settings, {
    size: 18
  })));
}
const sb = {
  root: {
    width: 284,
    flex: 'none',
    background: 'var(--surface-panel)',
    borderRight: '1px solid var(--border-hairline)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box'
  },
  top: {
    padding: '18px 20px 8px'
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 9
  },
  word: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 20,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)'
  },
  actions: {
    padding: '8px 16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    height: 38,
    background: 'var(--cream-50)',
    border: '1px solid var(--border-hairline)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-tertiary)'
  },
  searchInput: {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    color: 'var(--text-primary)',
    width: '100%'
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 12px 12px'
  },
  group: {
    marginBottom: 14
  },
  groupLabel: {
    fontFamily: 'var(--font-sans)',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
    padding: '8px 10px 6px'
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    width: '100%',
    textAlign: 'left',
    padding: '9px 11px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    background: 'transparent',
    cursor: 'pointer',
    marginBottom: 2
  },
  itemActive: {
    background: 'var(--cream-50)',
    borderColor: 'var(--border-hairline)'
  },
  itemTitle: {
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  itemMeta: {
    fontFamily: 'var(--font-sans)',
    fontSize: 12.5,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  account: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderTop: '1px solid var(--border-hairline)',
    color: 'var(--text-tertiary)'
  },
  accountText: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0
  },
  accountName: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13.5,
    fontWeight: 500,
    color: 'var(--text-primary)'
  },
  accountPlan: {
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    color: 'var(--text-tertiary)'
  }
};
window.ChatSidebar = ChatSidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/chat/ChatSidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/terminal/TerminalKit.jsx
try { (() => {
// Tvashtr CLI — interactive terminal in a paper window chrome.
const TERM_INTRO = [{
  type: 'sys',
  text: 'tvashtr weave · v0.4.1 — the loom is warm'
}, {
  type: 'sys',
  text: 'Type a command, or “help”. Try: weave build, chat "…", threads'
}, {
  type: 'spacer'
}, {
  type: 'prompt',
  text: 'weave build'
}, {
  type: 'dim',
  text: '# spinning up the loom…'
}, {
  type: 'ok',
  text: '✓ wove 14 threads in 1.2s'
}, {
  type: 'spacer'
}, {
  type: 'prompt',
  text: 'chat "make this error message kinder"'
}, {
  type: 'agent',
  text: 'Tvashtr  Try: “That address doesn’t look right — mind checking it?”\n         Warm, specific, and it tells them what to do next.'
}, {
  type: 'spacer'
}];
function runCommand(cmd) {
  const c = cmd.trim();
  if (!c) return [];
  const lines = [{
    type: 'prompt',
    text: c
  }];
  const word = c.split(' ')[0];
  if (word === 'help') {
    lines.push({
      type: 'out',
      text: 'commands:  weave build · chat "…" · threads · status · clear'
    });
  } else if (word === 'weave') {
    lines.push({
      type: 'dim',
      text: '# spinning up the loom…'
    });
    lines.push({
      type: 'ok',
      text: '✓ wove 14 threads in 1.1s'
    });
  } else if (word === 'threads') {
    lines.push({
      type: 'out',
      text: '  t1  release note, warmer tone     · today'
    });
    lines.push({
      type: 'out',
      text: '  t2  stack trace on weave build    · today'
    });
    lines.push({
      type: 'out',
      text: '  t3  planning a quiet launch       · this week'
    });
  } else if (word === 'status') {
    lines.push({
      type: 'ok',
      text: '● connected'
    });
    lines.push({
      type: 'out',
      text: '  model   Tvashtr Loom'
    });
    lines.push({
      type: 'out',
      text: '  ctx     4 threads · 12k tokens'
    });
  } else if (word === 'chat') {
    const m = c.match(/"([^"]*)"/);
    lines.push({
      type: 'agent',
      text: 'Tvashtr  ' + (m ? 'On it — here’s a calm first pass:\n         “' + m[1].replace(/^./, s => s.toUpperCase()) + '” — kept plain and unhurried.' : 'Tell me what to work on, in quotes.')
    });
  } else if (word === 'clear') {
    return 'CLEAR';
  } else {
    lines.push({
      type: 'err',
      text: 'unknown command: ' + word + '  — try “help”'
    });
  }
  return lines;
}
function TermLine({
  line
}) {
  if (line.type === 'spacer') return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 10
    }
  });
  const map = {
    sys: tm.sys,
    dim: tm.dim,
    ok: tm.ok,
    err: tm.err,
    out: tm.out,
    agent: tm.agent
  };
  if (line.type === 'prompt') {
    return /*#__PURE__*/React.createElement("div", {
      style: tm.line
    }, /*#__PURE__*/React.createElement("span", {
      style: tm.ps
    }, "tvashtr ~"), /*#__PURE__*/React.createElement("span", {
      style: tm.cmd
    }, line.text));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...tm.line,
      ...map[line.type]
    }
  }, line.text);
}
function TerminalKit() {
  const I = window.TvIcons;
  const [lines, setLines] = React.useState(TERM_INTRO);
  const [val, setVal] = React.useState('');
  const bodyRef = React.useRef(null);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const submit = e => {
    e.preventDefault();
    const res = runCommand(val);
    if (res === 'CLEAR') {
      setLines([]);
      setVal('');
      return;
    }
    if (res.length) setLines(p => [...p, ...res, {
      type: 'spacer'
    }]);
    setVal('');
  };
  return /*#__PURE__*/React.createElement("div", {
    style: tm.page
  }, /*#__PURE__*/React.createElement("div", {
    style: tm.window
  }, /*#__PURE__*/React.createElement("header", {
    style: tm.titlebar
  }, /*#__PURE__*/React.createElement("div", {
    style: tm.lights
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...tm.dot,
      background: '#D98C76'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...tm.dot,
      background: '#D9C07A'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      ...tm.dot,
      background: '#9DBE86'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: tm.tabs
  }, /*#__PURE__*/React.createElement("span", {
    style: tm.tabActive
  }, /*#__PURE__*/React.createElement(I.Terminal, {
    size: 14
  }), " weave"), /*#__PURE__*/React.createElement("span", {
    style: tm.tab
  }, "logs")), /*#__PURE__*/React.createElement("div", {
    style: tm.titleRight
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-charcoal.png",
    width: "18",
    height: "18",
    alt: ""
  }))), /*#__PURE__*/React.createElement("div", {
    ref: bodyRef,
    style: tm.body,
    onClick: () => inputRef.current && inputRef.current.focus()
  }, lines.map((l, i) => /*#__PURE__*/React.createElement(TermLine, {
    key: i,
    line: l
  })), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: tm.inputRow
  }, /*#__PURE__*/React.createElement("span", {
    style: tm.ps
  }, "tvashtr ~"), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    value: val,
    onChange: e => setVal(e.target.value),
    style: tm.input,
    spellCheck: false,
    autoComplete: "off",
    placeholder: "type a command\u2026",
    autoFocus: true
  }))), /*#__PURE__*/React.createElement("footer", {
    style: tm.statusbar
  }, /*#__PURE__*/React.createElement("span", {
    style: tm.stItem
  }, /*#__PURE__*/React.createElement("span", {
    style: tm.stDot
  }), " connected"), /*#__PURE__*/React.createElement("span", {
    style: tm.stItem
  }, "Tvashtr Loom"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: tm.stDim
  }, "\u23CE run \xB7 \u201Cclear\u201D to reset"))));
}
const MONO = 'var(--font-mono)';
const tm = {
  page: {
    minHeight: '100%',
    display: 'grid',
    placeItems: 'center',
    padding: 40,
    boxSizing: 'border-box',
    background: 'var(--surface-page)'
  },
  window: {
    width: 'min(860px, 100%)',
    height: 'min(620px, 86vh)',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    border: '1px solid var(--border-strong)',
    boxShadow: 'var(--shadow-lg)',
    background: 'var(--ink-900)'
  },
  titlebar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: 44,
    padding: '0 14px',
    background: 'var(--cream-100)',
    borderBottom: '1px solid var(--border-hairline)',
    flex: 'none'
  },
  lights: {
    display: 'flex',
    gap: 8
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: '50%'
  },
  tabs: {
    display: 'flex',
    gap: 6,
    alignItems: 'center'
  },
  tab: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    color: 'var(--text-tertiary)',
    padding: '4px 10px'
  },
  tabActive: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-primary)',
    padding: '4px 10px',
    background: 'var(--panel-300)',
    borderRadius: 'var(--radius-sm)'
  },
  titleRight: {
    marginLeft: 'auto',
    opacity: 0.7
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '18px 20px',
    fontFamily: MONO,
    fontSize: 13.5,
    lineHeight: 1.7,
    color: 'var(--cream-100)',
    cursor: 'text'
  },
  line: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  ps: {
    color: 'var(--coral-500)',
    marginRight: 10,
    flex: 'none'
  },
  cmd: {
    color: 'var(--cream-100)'
  },
  sys: {
    color: 'var(--stone-400)'
  },
  dim: {
    color: '#8A8780'
  },
  ok: {
    color: 'var(--sage-500)'
  },
  err: {
    color: '#E0917F'
  },
  out: {
    color: '#D9D6CC'
  },
  agent: {
    color: 'var(--blue-500)',
    whiteSpace: 'pre-wrap'
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    marginTop: 2
  },
  input: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    outline: 'none',
    fontFamily: MONO,
    fontSize: 13.5,
    color: 'var(--cream-100)',
    caretColor: 'var(--coral-500)'
  },
  statusbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: 30,
    padding: '0 16px',
    background: 'var(--ink-800)',
    borderTop: '1px solid var(--ink-700)',
    flex: 'none',
    fontFamily: MONO,
    fontSize: 11.5,
    color: 'var(--stone-400)'
  },
  stItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  },
  stDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--sage-500)'
  },
  stDim: {
    color: '#6E6B61'
  }
};
window.TerminalKit = TerminalKit;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/terminal/TerminalKit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/WebKit.jsx
try { (() => {
// Tvashtr marketing web app — nav, hero, surfaces, editorial band, footer.
function WebNav() {
  const {
    Button
  } = window.DesignSystem_dbaa69;
  return /*#__PURE__*/React.createElement("nav", {
    style: wb.nav
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.navInner
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.brand
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-coral.png",
    width: "28",
    height: "28",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: wb.word
  }, "Tvashtr")), /*#__PURE__*/React.createElement("div", {
    style: wb.navLinks
  }, ['Product', 'Developers', 'Pricing', 'Field notes'].map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: wb.navLink
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: wb.navRight
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "md"
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "md"
  }, "Start a thread"))));
}
function WebHero() {
  const {
    Button,
    Badge
  } = window.DesignSystem_dbaa69;
  const I = window.TvIcons;
  return /*#__PURE__*/React.createElement("header", {
    style: wb.hero
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-coral.png",
    width: "76",
    height: "76",
    alt: "",
    style: {
      marginBottom: 26
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: wb.eyebrow
  }, "Tvashtr Labs"), /*#__PURE__*/React.createElement("h1", {
    style: wb.h1
  }, "A calmer way to", /*#__PURE__*/React.createElement("br", null), "think out loud."), /*#__PURE__*/React.createElement("p", {
    style: wb.lead
  }, "One quiet suite for the messy middle of knowledge work \u2014 chat, a developer CLI, a writing canvas, and an agent that picks your threads back up where you left them."), /*#__PURE__*/React.createElement("div", {
    style: wb.heroCtas
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    iconRight: /*#__PURE__*/React.createElement(I.Arrow, {
      size: 18
    })
  }, "Start a thread"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg"
  }, "Read the field notes")), /*#__PURE__*/React.createElement("div", {
    style: wb.heroMeta
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "success",
    dot: true
  }, "No credit card"), /*#__PURE__*/React.createElement("span", {
    style: wb.metaDim
  }, "Free while it\u2019s small \xB7 paper-light by design")));
}
function SurfaceCard({
  icon,
  name,
  tag,
  children
}) {
  const {
    Card,
    Badge
  } = window.DesignSystem_dbaa69;
  return /*#__PURE__*/React.createElement(Card, {
    interactive: true
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.surfTop
  }, /*#__PURE__*/React.createElement("span", {
    style: wb.surfIcon
  }, icon), tag && /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, tag)), /*#__PURE__*/React.createElement("h3", {
    style: wb.surfName
  }, name), /*#__PURE__*/React.createElement("p", {
    style: wb.surfDesc
  }, children));
}
function WebSurfaces() {
  const I = window.TvIcons;
  return /*#__PURE__*/React.createElement("section", {
    style: wb.section
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.sectionHead
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.eyebrow
  }, "The suite"), /*#__PURE__*/React.createElement("h2", {
    style: wb.h2
  }, "Five surfaces, one quiet grain"), /*#__PURE__*/React.createElement("p", {
    style: wb.sectionLead
  }, "The same warm paper, the same single accent, everywhere you work.")), /*#__PURE__*/React.createElement("div", {
    style: wb.grid
  }, /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Message, {
      size: 22
    }),
    name: "Chat",
    tag: "Desktop"
  }, "A thoughtful conversation that remembers the thread."), /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Terminal, {
      size: 22
    }),
    name: "Weave CLI",
    tag: "Developers"
  }, "The loom in your terminal \u2014 build, ask, and ship."), /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Pen, {
      size: 22
    }),
    name: "Canvas",
    tag: "Web"
  }, "A calm page for drafting, side by side with the agent."), /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Compass, {
      size: 22
    }),
    name: "Agent",
    tag: "Desktop"
  }, "Quietly does the legwork across your files and tabs."), /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Layout, {
      size: 22
    }),
    name: "Workspace",
    tag: "Web"
  }, "Everyone\u2019s threads in one unhurried place."), /*#__PURE__*/React.createElement(SurfaceCard, {
    icon: /*#__PURE__*/React.createElement(I.Book, {
      size: 22
    }),
    name: "Field notes",
    tag: "Reading"
  }, "How we think about calm, useful software.")));
}
function WebQuote() {
  return /*#__PURE__*/React.createElement("section", {
    style: wb.quoteBand
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-cream.png",
    width: "44",
    height: "44",
    alt: "",
    style: {
      opacity: 0.85,
      marginBottom: 22
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: wb.quote
  }, "\u201CThe best tools get quieter the more you trust them. Tvashtr is built to disappear into the work.\u201D"), /*#__PURE__*/React.createElement("div", {
    style: wb.quoteBy
  }, "Field notes \xB7 No. 4"));
}
function WebFooter() {
  const cols = [{
    h: 'Product',
    items: ['Chat', 'Weave CLI', 'Canvas', 'Agent', 'Pricing']
  }, {
    h: 'Developers',
    items: ['Docs', 'API', 'Status', 'Changelog']
  }, {
    h: 'Company',
    items: ['Field notes', 'About', 'Careers', 'Contact']
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: wb.footer
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.footerInner
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.footerBrand
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.brand
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-charcoal.png",
    width: "26",
    height: "26",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: wb.word
  }, "Tvashtr")), /*#__PURE__*/React.createElement("p", {
    style: wb.footerTag
  }, "A calmer way to think out loud.")), /*#__PURE__*/React.createElement("div", {
    style: wb.footerCols
  }, cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h
  }, /*#__PURE__*/React.createElement("div", {
    style: wb.footerH
  }, c.h), c.items.map(it => /*#__PURE__*/React.createElement("a", {
    key: it,
    href: "#",
    style: wb.footerLink
  }, it)))))), /*#__PURE__*/React.createElement("div", {
    style: wb.footerBase
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Tvashtr Labs"), /*#__PURE__*/React.createElement("span", {
    style: wb.footerBaseRight
  }, "Made unhurriedly \xB7 Privacy \xB7 Terms")));
}
function WebKit() {
  return /*#__PURE__*/React.createElement("div", {
    style: wb.page
  }, /*#__PURE__*/React.createElement(WebNav, null), /*#__PURE__*/React.createElement(WebHero, null), /*#__PURE__*/React.createElement(WebSurfaces, null), /*#__PURE__*/React.createElement(WebQuote, null), /*#__PURE__*/React.createElement(WebFooter, null));
}
const wb = {
  page: {
    background: 'var(--surface-page)',
    minHeight: '100%'
  },
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    background: 'color-mix(in srgb, var(--cream-100) 88%, transparent)',
    backdropFilter: 'blur(8px)',
    borderBottom: '1px solid var(--border-hairline)'
  },
  navInner: {
    maxWidth: 1120,
    margin: '0 auto',
    height: 66,
    padding: '0 28px',
    display: 'flex',
    alignItems: 'center',
    gap: 32
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 9
  },
  word: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 21,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)'
  },
  navLinks: {
    display: 'flex',
    gap: 26,
    marginLeft: 8
  },
  navLink: {
    fontFamily: 'var(--font-sans)',
    fontSize: 14.5,
    color: 'var(--text-secondary)',
    textDecoration: 'none'
  },
  navRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto'
  },
  hero: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '88px 28px 76px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center'
  },
  eyebrow: {
    fontFamily: 'var(--font-sans)',
    fontSize: 12.5,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--coral-600)'
  },
  h1: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 60,
    lineHeight: 1.04,
    letterSpacing: '-0.025em',
    color: 'var(--text-primary)',
    margin: '16px 0 0',
    textWrap: 'balance'
  },
  lead: {
    fontFamily: 'var(--font-sans)',
    fontSize: 18.5,
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
    maxWidth: 560,
    margin: '22px 0 0',
    textWrap: 'pretty'
  },
  heroCtas: {
    display: 'flex',
    gap: 12,
    marginTop: 34,
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  heroMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 24
  },
  metaDim: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13.5,
    color: 'var(--text-tertiary)'
  },
  section: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '40px 28px 88px'
  },
  sectionHead: {
    textAlign: 'center',
    maxWidth: 600,
    margin: '0 auto 44px'
  },
  h2: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 38,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: '12px 0 0'
  },
  sectionLead: {
    fontFamily: 'var(--font-sans)',
    fontSize: 16.5,
    color: 'var(--text-secondary)',
    margin: '14px 0 0',
    lineHeight: 1.6
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 18
  },
  surfTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  surfIcon: {
    width: 44,
    height: 44,
    borderRadius: 'var(--radius-md)',
    background: 'var(--coral-100)',
    color: 'var(--coral-700)',
    display: 'grid',
    placeItems: 'center'
  },
  surfName: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontSize: 22,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)',
    margin: '0 0 6px'
  },
  surfDesc: {
    fontFamily: 'var(--font-sans)',
    fontSize: 14.5,
    lineHeight: 1.55,
    color: 'var(--text-secondary)',
    margin: 0
  },
  quoteBand: {
    background: 'var(--ink-900)',
    padding: '76px 28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center'
  },
  quote: {
    fontFamily: 'var(--font-serif)',
    fontWeight: 400,
    fontStyle: 'italic',
    fontSize: 30,
    lineHeight: 1.4,
    letterSpacing: '-0.01em',
    color: 'var(--cream-100)',
    maxWidth: 720,
    margin: 0,
    textWrap: 'balance'
  },
  quoteBy: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    color: 'var(--stone-400)',
    marginTop: 24,
    letterSpacing: '0.02em'
  },
  footer: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '64px 28px 28px'
  },
  footerInner: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 40,
    flexWrap: 'wrap',
    paddingBottom: 40,
    borderBottom: '1px solid var(--border-hairline)'
  },
  footerBrand: {
    maxWidth: 280
  },
  footerTag: {
    fontFamily: 'var(--font-serif)',
    fontStyle: 'italic',
    fontSize: 16,
    color: 'var(--text-secondary)',
    margin: '14px 0 0'
  },
  footerCols: {
    display: 'flex',
    gap: 56
  },
  footerH: {
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 12
  },
  footerLink: {
    display: 'block',
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    padding: '5px 0'
  },
  footerBase: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingTop: 22,
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    color: 'var(--text-tertiary)'
  },
  footerBaseRight: {
    color: 'var(--text-tertiary)'
  }
};
window.WebKit = WebKit;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/WebKit.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
