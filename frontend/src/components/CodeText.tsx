/** Escape a string for a RegExp. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The server's words with some parts in code style (M4): every `backticked` part (its backticks
 * dropped) and every substring listed in `code` ("The tool chart-render isn’t in your Toolkit").
 */
export function CodeText({ text, code = [] }: { text: string; code?: readonly string[] }) {
  const listed = code.filter(Boolean).map(escape);
  const re = new RegExp(`\`([^\`]+)\`${listed.length ? `|(${listed.join("|")})` : ""}`, "g");
  const parts: (string | { code: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push({ code: m[1] ?? m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <code key={i} className="tv-code">
            {p.code}
          </code>
        ),
      )}
    </>
  );
}
