/**
 * A small SKILL.md reader for the editor's Preview tab (TkF-NewSkill-3, SKILL-24): headings,
 * bullets, numbered items, paragraphs and code blocks, with `code` and **bold** inside a line. It
 * returns data, never HTML, so the preview renders plain React elements (nothing is injected).
 */
export type MdInline = { kind: "text" | "code" | "strong"; text: string };

export type MdBlock =
  | { kind: "heading"; level: number; inline: MdInline[] }
  | { kind: "bullet"; inline: MdInline[] }
  | { kind: "number"; marker: string; inline: MdInline[] }
  | { kind: "para"; inline: MdInline[] }
  | { kind: "code"; text: string };

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

export function parseInline(line: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: line.slice(last, at) });
    const tok = m[0];
    out.push(
      tok.startsWith("`")
        ? { kind: "code", text: tok.slice(1, -1) }
        : { kind: "strong", text: tok.slice(2, -2) },
    );
    last = at + tok.length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

export function parseSkillMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", inline: parseInline(para.join(" ")) });
    para = [];
  };
  let i = 0;
  // Frontmatter (`---` … `---` at the very top) shows as written, in a code block.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end > 0) {
      blocks.push({ kind: "code", text: lines.slice(0, end + 1).join("\n") });
      i = end + 1;
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) body.push(lines[i]);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!t) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, inline: parseInline(h[2]) });
      continue;
    }
    const b = /^[-*+]\s+(.*)$/.exec(t);
    if (b) {
      flush();
      blocks.push({ kind: "bullet", inline: parseInline(b[1]) });
      continue;
    }
    const n = /^(\d+[.)])\s+(.*)$/.exec(t);
    if (n) {
      flush();
      blocks.push({ kind: "number", marker: n[1], inline: parseInline(n[2]) });
      continue;
    }
    para.push(t.replace(/^>\s?/, ""));
  }
  flush();
  return blocks;
}
