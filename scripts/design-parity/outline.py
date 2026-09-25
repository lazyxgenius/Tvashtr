"""Turn a .dc.html design screen into a compact, readable outline.

Keeps visible text, interactive elements (button/input/select/textarea/a/label),
landmarks, headings, design-system component mounts (x-import) and a few style
hints (primary/danger fills, widths of big layout columns). Drops SVG paths and
most inline styles.
"""

import html
import os
import re
import sys
from html.parser import HTMLParser

KEEP_TAGS = {
    "button", "input", "select", "textarea", "a", "label", "h1", "h2", "h3", "h4",
    "nav", "header", "aside", "main", "dialog", "section", "kbd", "ul", "ol", "li",
    "table", "tr", "td", "th", "form", "fieldset", "legend", "option", "pre", "code",
    "x-import", "sc-for", "sc-if", "dc-import", "details", "summary",
}
VOID = {"input", "img", "br", "hr", "meta", "link", "source", "wbr", "col"}
ATTRS = ["aria-label", "placeholder", "value", "type", "role", "aria-current",
         "aria-pressed", "aria-expanded", "aria-selected", "checked", "disabled",
         "href", "title", "name", "for", "id"]


def style_hint(style: str) -> str:
    s = style or ""
    hints = []
    m = re.search(r"(?<![-\w])width:\s*(\d+)px", s)
    w = int(m.group(1)) if m else 0
    if w >= 200:
        hints.append(f"w{w}")
    if re.search(r"background:\s*var\(--(coral-500|accent)\)", s):
        hints.append("PRIMARY")
    if re.search(r"background:\s*var\(--ink-900\)", s):
        hints.append("DARK")
    if re.search(r"color:\s*var\(--(red-500|danger)\)", s) or "background: var(--red-100)" in s:
        hints.append("DANGER")
    if "var(--amber-100)" in s:
        hints.append("WARN")
    if "var(--sage-100)" in s:
        hints.append("OK")
    if "position: absolute" in s or "position: fixed" in s:
        hints.append("overlay")
    if "box-shadow: var(--shadow-pop)" in s or "shadow-pop" in s:
        hints.append("popover")
    if "shadow-drawer" in s:
        hints.append("drawer")
    return ",".join(hints)


class Outliner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.depth = 0
        self.stack = []  # (tag, kept)
        self.in_dc = False
        self.skip = 0  # inside svg/style/script/helmet
        self.text_buf = []

    def flush_text(self):
        t = " ".join(" ".join(self.text_buf).split())
        self.text_buf = []
        if t:
            self.out.append("  " * self.depth + '"' + t + '"')

    def handle_starttag(self, tag, attrs):
        if tag == "x-dc":
            self.in_dc = True
            return
        if not self.in_dc:
            return
        if tag in ("svg", "style", "script", "helmet") :
            self.skip += 1
            return
        if self.skip:
            return
        a = dict(attrs)
        hint = style_hint(a.get("style", ""))
        kept = tag in KEEP_TAGS or bool(hint and any(h in hint for h in ("PRIMARY", "DANGER", "WARN", "OK", "overlay", "popover", "drawer")))
        if tag == "div" and hint and re.match(r"w\d+", hint) and int(re.match(r"w(\d+)", hint).group(1)) >= 280:
            kept = True
        if kept:
            self.flush_text()
            parts = [tag]
            if tag == "x-import":
                comp = a.get("component-from-global-scope", "")
                parts = ["<" + comp.replace("DesignSystem_dbaa69.", "DS.") + ">"]
                for k, v in a.items():
                    if k in ("component-from-global-scope", "style", "mark-src"):
                        continue
                    parts.append(f"{k}={v!r}")
            else:
                for k in ATTRS:
                    if k in a:
                        v = a[k]
                        parts.append(k if v is None else f"{k}={v!r}")
                if tag in ("sc-for", "sc-if", "dc-import"):
                    parts += [f"{k}={v!r}" for k, v in a.items() if k != "style"]
            if hint:
                parts.append(f"[{hint}]")
            self.out.append("  " * self.depth + " ".join(parts))
            if tag not in VOID:
                self.depth += 1
        if tag not in VOID:
            self.stack.append((tag, kept))

    def handle_endtag(self, tag):
        if tag == "x-dc":
            self.flush_text()
            self.in_dc = False
            return
        if not self.in_dc:
            return
        if tag in ("svg", "style", "script", "helmet"):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        # pop to matching tag
        while self.stack:
            t, kept = self.stack.pop()
            if kept:
                self.flush_text()
                self.depth -= 1
            if t == tag:
                break

    def handle_data(self, data):
        if self.in_dc and not self.skip and data.strip():
            self.text_buf.append(data.strip())


def outline(path: str) -> str:
    src = open(path, encoding="utf-8").read()
    title = re.search(r"<title>(.*?)</title>", src)
    p = Outliner()
    p.feed(src)
    p.flush_text()
    # collapse runs of identical lines
    lines = []
    for line in p.out:
        if lines and lines[-1] == line:
            continue
        lines.append(line)
    script = re.search(r'data-dc-script[^>]*>(.*?)</script>', src, re.S)
    head = f"# {os.path.basename(path)} — {html.unescape(title.group(1)) if title else ''}"
    body = "\n".join(lines)
    extra = ""
    if script:
        js = script.group(1)
        # keep only the component logic beyond the boilerplate renderVals
        if "renderVals" in js and len(js) > 2500:
            m = re.search(r"class Component extends DCLogic \{(.*)", js, re.S)
            logic = m.group(1) if m else js
            logic = re.sub(r"renderVals\(\) \{\s*return \{.*?\};\s*\}", "renderVals(){…}", logic, flags=re.S)
            if len(logic.strip()) > 20:
                extra = "\n--- logic ---\n" + logic.strip()[:4000]
    return head + "\n" + body + extra + "\n"


if __name__ == "__main__":
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if name.endswith(".dc.html"):
            o = outline(os.path.join(src_dir, name))
            open(os.path.join(out_dir, name.replace(".dc.html", ".txt")), "w").write(o)
