/** The focus editor's status line (PANEL-100): where the caret is, and how long the text is. */

/** 1-based line and column of a caret offset in `text`. */
export function caretPosition(text: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, at);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: at - lineStart + 1 };
}

/**
 * The executor's own estimate (`context_compiler.estimate_tokens` = characters // 4). It is an
 * estimate, so above 100 it's said to the nearest ten: 1,284 characters → "about 320 tokens".
 */
export function approxTokens(chars: number): number {
  const tokens = Math.floor(chars / 4);
  return tokens >= 100 ? Math.round(tokens / 10) * 10 : tokens;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "1,284 characters · about 320 tokens". */
export function sizeLine(chars: number): string {
  return `${plural(chars, "character", "characters")} · about ${plural(
    approxTokens(chars),
    "token",
    "tokens",
  )}`;
}
