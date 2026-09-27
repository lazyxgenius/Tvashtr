/**
 * A run document as the viewer shows it (DOCS-21, DOCS-33..36): the markdown rendered read-only, and
 * two versions compared block by block — each heading, paragraph, code block and list item is one
 * block, so an edited bullet reads as the old one struck and the new one added.
 */
import MarkdownIt from "markdown-it";

import { type DiffOp, diffSeq } from "../setup/lineDiff";

// Markdown only: raw HTML in a document is shown as text, never rendered (`html: false`).
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** The document as HTML (markdown-it escapes everything the markdown doesn't make). */
export const renderMarkdown = (markdown: string): string => md.render(markdown);

/**
 * The document's top-level blocks as markdown source. A list item keeps its marker, so it renders as
 * a one-item list; its nested lines stay with it.
 */
export function docBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (const t of md.parse(markdown, {})) {
    if (!t.map || t.nesting === -1) continue;
    const list = t.type === "bullet_list_open" || t.type === "ordered_list_open";
    const block = t.level === 0 ? !list : t.type === "list_item_open" && t.level === 1;
    if (!block) continue;
    const src = lines.slice(t.map[0], t.map[1]).join("\n").trimEnd();
    if (src.trim()) out.push(src);
  }
  return out;
}

export interface DocDiffBlock {
  op: DiffOp;
  html: string;
}

export interface DocDiff {
  blocks: DocDiffBlock[];
  /** Source lines only in the newer version / only in the older one. */
  added: number;
  removed: number;
}

const lineCount = (src: string) => src.split("\n").filter((l) => l.trim()).length;

/** `from` → `to`, block by block (removed before added, as a unified diff reads). */
export function compareDocs(from: string, to: string): DocDiff {
  const parts = diffSeq(docBlocks(from), docBlocks(to));
  const count = (op: DiffOp) =>
    parts.filter((p) => p.op === op).reduce((n, p) => n + lineCount(p.text), 0);
  return {
    blocks: parts.map((p) => ({ op: p.op, html: md.render(p.text) })),
    added: count("add"),
    removed: count("del"),
  };
}

/** "+2 lines" / "−1 line". */
export const linesLabel = (sign: "+" | "−", n: number): string =>
  `${sign}${n} line${n === 1 ? "" : "s"}`;
