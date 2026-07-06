import { useState } from "react";

/**
 * M-tools C7.0 (scaffold) — the per-node **Skills** editor STUB, owned by the C7.B Skills milestone.
 * Renders for BOTH thinker and worker nodes (a thinker folds skills into its prompt; a worker gets an
 * AgentContext). It proves only the state + Save wire: a collapsible block with a raw JSON `<textarea>`
 * bound to the node's `skills` array. The real skill-source editor + imports land in the Skills milestone.
 */
export function SkillsSection({
  value,
  onChange,
}: {
  value: unknown[] | null;
  onChange: (value: unknown[] | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : JSON.stringify(value, null, 2));
  const [open, setOpen] = useState(true);

  return (
    <details className="tv-field" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tv-field__label">Skills</summary>
      <span className="tv-field__hint">Skills — configured in the Skills milestone.</span>
      <textarea
        className="tv-node-prompt"
        aria-label="Skills JSON"
        rows={4}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") {
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(raw) as unknown[]);
          } catch {
            // Keep the raw text visible while it's mid-edit / invalid; don't propagate a bad value.
          }
        }}
      />
    </details>
  );
}
