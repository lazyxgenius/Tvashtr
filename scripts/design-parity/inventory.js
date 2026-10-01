// The kept-elements inventory (brief §2.2): every visible landmark, heading, button, link, tab and
// input on the page, by role and accessible name — one "role: name" line each, sorted, de-duplicated.
(() => {
  const SEL = [
    "header", "nav", "main", "aside", "footer", "section[aria-label]", "[role=region]",
    "[role=toolbar]", "[role=dialog]", "dialog", "h1", "h2", "h3", "h4", "button", "a[href]",
    "[role=button]", "[role=tab]", "[role=link]", "[role=menuitem]", "input", "select", "textarea",
  ].join(",");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const role = (el) => {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "a") return "link";
    if (t === "input") return `input[${el.type}]`;
    return t;
  };
  const name = (el) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("title");
    if (label) return label.trim();
    if (el.id) {
      const l = document.querySelector(`label[for="${el.id}"]`);
      if (l) return l.innerText.trim();
    }
    if (el.placeholder) return el.placeholder.trim();
    const t = ["header", "nav", "main", "aside", "footer", "section"].includes(el.tagName.toLowerCase());
    return t ? "" : (el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const lines = new Set();
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    lines.add(`${role(el)}: ${name(el)}`);
  }
  return [...lines].sort().join("\n") + "\n";
})()
