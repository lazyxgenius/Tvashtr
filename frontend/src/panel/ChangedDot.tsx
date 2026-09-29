/**
 * The coral "Changed" dot beside a Setup row whose draft differs from the saved value (PANEL-18).
 * It sits in the row's left gutter (the design's `left: -13px; top: 17px`); `inline` puts it in the
 * text flow instead (the Instructions title, when a change left no line to mark).
 */
export function ChangedDot({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`nd-changed${inline ? " nd-changed--inline" : ""}`}
      role="img"
      aria-label="Changed"
      title="Changed"
    />
  );
}
