/**
 * The Ask tab's pure helpers: an answer's light Markdown with its number chips (DM-58), the words
 * to copy, which part of a passage to highlight (OQ-10), the passage meta line (DM-60) and the
 * suggested questions from the file names (DM-56). No I/O.
 */
import type { DomainPassage } from "../../lib/api/domains";

export type Inline = { kind: "text" | "bold" | "code"; text: string } | { kind: "chip"; n: number };

export type Block = { kind: "p"; parts: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\s*\[(\d+(?:\s*,\s*\d+)*)\]/g;
const MARKER = /\s*\[(\d+(?:\s*,\s*\d+)*)\]/g;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** Bold, code and `[n]` / `[1, 2]` markers (a chip hugs the word before it, as drawn). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else for (const n of m[3].split(",")) out.push({ kind: "chip", n: Number(n) });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** Paragraphs (blank-line separated) and simple bullet / numbered lists. */
export function parseAnswer(text: string): Block[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para): Block => {
      const lines = para.split("\n").filter((l) => l.trim());
      for (const [kind, re] of [
        ["ul", BULLET],
        ["ol", NUMBERED],
      ] as const) {
        if (lines.length && lines.every((l) => re.test(l))) {
          return { kind, items: lines.map((l) => parseInline(l.replace(re, ""))) };
        }
      }
      return { kind: "p", parts: parseInline(lines.join(" ")) };
    });
}

/** The answer's words for **Copy**: markers and Markdown marks removed. */
export function plainAnswer(text: string): string {
  return text
    .replace(MARKER, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** Whether the answer points at any passage (OQ-23: else its sources are just the top two). */
export function hasMarkers(text: string): boolean {
  return new RegExp(MARKER.source).test(text);
}

const STOP = new Set(
  "the and for are with from that this have has was were you your can may not but our their its into they them than then there when what which who how any all also been being".split(
    " ",
  ),
);

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(
    words
      .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}

/**
 * Sentences with their offsets: a sentence ends at . ! ? followed by a space, or the end; a
 * leading "…" (a cut passage) isn't part of it.
 */
function sentences(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /[^.!?]*(?:[.!?]+(?=\s|$)|$)/g;
  for (const m of text.matchAll(re)) {
    const body = m[0].replace(/^[\s…]+/, "").trimEnd();
    if (!body) continue;
    const start = m.index + m[0].length - m[0].replace(/^[\s…]+/, "").length;
    out.push({ start, end: start + body.length, text: body });
  }
  return out;
}

/** The first answer sentence that carries chip `n`, without its markers (`null`: none does). */
export function sentenceCiting(answer: string, n: number): string | null {
  const hit = sentences(answer.replace(/\*\*|`/g, "")).find((s) =>
    [...s.text.matchAll(MARKER)].some((m) => m[1].split(",").map(Number).includes(n)),
  );
  return hit ? hit.text.replace(MARKER, "") : null;
}

/**
 * OQ-10: the passage sentence sharing the most content words with the answer sentence carrying
 * its number (ties → the first); `null` under 2 shared words. `[start, end)` offsets into `excerpt`.
 */
export function highlightRange(excerpt: string, cited: string): [number, number] | null {
  const want = contentWords(cited);
  let best: [number, number] | null = null;
  let most = 1;
  for (const s of sentences(excerpt)) {
    const shared = [...contentWords(s.text)].filter((w) => want.has(w)).length;
    if (shared > most) {
      most = shared;
      best = [s.start, s.end];
    }
  }
  return best;
}

/** "piece 3 of 42" / "page 4 · piece 17 of 86" (DM-60). */
export function passageMeta(p: Pick<DomainPassage, "page" | "piece_number" | "pieces_in_file">) {
  const piece = `piece ${p.piece_number}${p.pieces_in_file ? ` of ${p.pieces_in_file}` : ""}`;
  return p.page ? `page ${p.page} · ${piece}` : piece;
}

/** The aside card's excerpt: "…" where the passage was cut (a piece past the first starts mid-file). */
export function passageText(p: Pick<DomainPassage, "excerpt" | "piece_number">): string {
  const body = p.excerpt.trim().replace(/\s+/g, " ");
  const lead = p.piece_number > 1 ? "…" : "";
  return `${lead}${body}${/[.!?]$/.test(body) ? "" : "…"}`;
}

/** "1.8 s · OpenAI gpt-4o-mini" (DM-58); either half may be missing. */
export function answerMeta(latencyMs: number | null, modelLabel: string | null): string {
  const secs = latencyMs === null ? null : `${(latencyMs / 1000).toFixed(1)} s`;
  return [secs, modelLabel].filter(Boolean).join(" · ");
}

// ---- Suggested questions from the file names (DM-56) ----

const ACRONYM = /^[a-z]{2,3}$/;
const SETUP = ["set", "up", "setup"];
const topic = (words: string[]) =>
  words.map((w) => (ACRONYM.test(w) ? w.toUpperCase() : w)).join(" ");

/** Name patterns, most useful first; each turns a file name's words into a question. */
const PATTERNS: [RegExp, (words: string[]) => string][] = [
  [/\brefunds?\b/, () => "What is the refund window?"],
  [/\bset ?up\b/, (w) => `How do I set up ${topic(w.filter((x) => !SETUP.includes(x)))}?`],
  [
    /\blimits?\b/,
    (w) => `What are the ${topic(w.filter((x) => !/^limits?$/.test(x)))} rate limits?`,
  ],
  [/\bexport\b/, () => "How do I export my data?"],
  [/\bpricing\b/, () => "How much does each plan cost?"],
  [/\bgetting started\b/, () => "How do I get started?"],
  [/\btroubleshoot/, () => "How do I fix a common problem?"],
  [/\bsecurity\b/, () => "How is my account kept secure?"],
];

/** Up to four questions from the file names (the design's pills), empty when none fit. */
export function suggestQuestions(filenames: string[]): string[] {
  const names = filenames.map((f) =>
    f
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !/^\d+$/.test(w)),
  );
  const out: string[] = [];
  for (const [re, ask] of PATTERNS) {
    const words = names.find((w) => re.test(w.join(" ")));
    if (!words) continue;
    const q = ask(words);
    if (!/\s\?$|\s{2}/.test(q) && !out.includes(q)) out.push(q);
    if (out.length === 4) break;
  }
  return out;
}
