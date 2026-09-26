/**
 * Which lines of the edited instructions are new or changed since the saved text, so the editor can
 * mark them (the design's coral line band). A line-level longest-common-subsequence: every line of
 * `after` outside the common subsequence is marked.
 */

/** Above this many line pairs the LCS table gets expensive; fall back to comparing by position. */
const MAX_CELLS = 250_000;

export function changedLines(before: string, after: string): Set<number> {
  const out = new Set<number>();
  if (before === after) return out;
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > MAX_CELLS) {
    b.forEach((line, i) => {
      if (a[i] !== line) out.add(i);
    });
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
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      i++;
    } else {
      out.add(j);
      j++;
    }
  }
  return out;
}
