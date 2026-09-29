/**
 * Line diffs on one longest-common-subsequence: which lines of the edited instructions are new or
 * changed since the saved text (the design's coral line band), and the ordered same / removed /
 * added sequence a document compare renders (removed before added, as a unified diff reads).
 */

/** Above this many line pairs the LCS table gets expensive; fall back to comparing by position. */
const MAX_CELLS = 250_000;

export type DiffOp = "same" | "del" | "add";

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/** Turn `a` into `b`: every item of both, in order, marked same / del (only in a) / add (only in b). */
export function diffSeq(a: readonly string[], b: readonly string[]): DiffPart[] {
  const out: DiffPart[] = [];
  if (a.length * b.length > MAX_CELLS) {
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (k < a.length && k < b.length && a[k] === b[k]) out.push({ op: "same", text: b[k] });
      else {
        if (k < a.length) out.push({ op: "del", text: a[k] });
        if (k < b.length) out.push({ op: "add", text: b[k] });
      }
    }
    return out;
  }
  // lcs[i][j] = the LCS length of a[i..] and b[j..].
  const cols = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: "same", text: b[j] });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j >= b.length || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])
    ) {
      out.push({ op: "del", text: a[i] });
      i++;
    } else {
      out.push({ op: "add", text: b[j] });
      j++;
    }
  }
  return out;
}

export function changedLines(before: string, after: string): Set<number> {
  const out = new Set<number>();
  if (before === after) return out;
  let j = 0;
  for (const part of diffSeq(before.split("\n"), after.split("\n"))) {
    if (part.op === "add") out.add(j);
    if (part.op !== "del") j++;
  }
  return out;
}

/** One row of a unified line diff; "gap" stands for unchanged lines left out between hunks. */
export interface DiffRow {
  op: DiffOp | "gap";
  text: string;
}

export interface LineDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
}

/**
 * A unified line diff of `before` → `after` (Review changes): the changed lines with `context`
 * unchanged lines around each change (3, as git shows them), a "gap" row where unchanged lines are
 * left out, and the added / removed line counts ("+2 −1 lines").
 */
export function diffLines(before: string, after: string, context = 3): LineDiff {
  const parts = before === after ? [] : diffSeq(before.split("\n"), after.split("\n"));
  const near = parts.map(() => false);
  parts.forEach((p, i) => {
    if (p.op === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(parts.length - 1, i + context); k++) {
      near[k] = true;
    }
  });
  const rows: DiffRow[] = [];
  let last = -1;
  parts.forEach((p, i) => {
    if (!near[i]) return;
    if (last >= 0 && i > last + 1) rows.push({ op: "gap", text: "" });
    rows.push(p);
    last = i;
  });
  return {
    rows,
    added: parts.filter((p) => p.op === "add").length,
    removed: parts.filter((p) => p.op === "del").length,
  };
}
