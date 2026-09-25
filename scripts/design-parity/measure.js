// Injected into a page: returns a list of measured text/controls — the input to parity.py.
// Each entry: { key, tag, text, fs, fw, ff, lh, w, h, x, y }
(() => {
  const out = [];
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const seen = new Set();
  const isControl = (el) =>
    ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "KBD"].includes(el.tagName) ||
    el.getAttribute("role") === "tab" ||
    el.getAttribute("role") === "menuitem" ||
    el.getAttribute("role") === "option";
  const visible = (r, cs) =>
    r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.bottom > 0 && r.top < innerHeight;
  const push = (el, text, kind) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!visible(r, cs)) return;
    const t = norm(text).slice(0, 80);
    if (!t) return;
    const key = kind + "|" + t;
    if (seen.has(key + "|" + Math.round(r.y))) return;
    seen.add(key + "|" + Math.round(r.y));
    out.push({
      key,
      kind,
      tag: el.tagName.toLowerCase(),
      text: t,
      fs: parseFloat(cs.fontSize),
      fw: parseInt(cs.fontWeight, 10),
      ff: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      lh: cs.lineHeight,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
    });
  };
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "SVG", "PATH"].includes(el.tagName.toUpperCase())) continue;
    if (isControl(el)) {
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.value ||
        el.textContent ||
        "";
      push(el, label, "ctl");
      continue;
    }
    // Leaf-ish text: own text nodes only.
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    if (norm(own).length >= 2) push(el, own, "txt");
  }
  return out;
})();
