import { useState } from "react";

import type { Capability } from "../lib/api";

/**
 * M-tools C7.0 (scaffold) — the per-node **Tools** (MCP) editor STUB, owned by the C7.A Tools
 * milestone. It proves only the state + Save wire: a worker node gets a collapsible block with a raw
 * JSON `<textarea>` bound to the node's `tool_config`; a non-worker gets a one-line note (tools run in
 * a worker's sandbox). The real MCP-server editor + secret brokering land in the Tools milestone.
 */
export function ToolsSection({
  value,
  onChange,
  capability,
}: {
  value: Record<string, unknown> | null;
  onChange: (value: Record<string, unknown> | null) => void;
  capability: Capability;
}) {
  const [text, setText] = useState(value == null ? "" : JSON.stringify(value, null, 2));
  const [open, setOpen] = useState(true);

  // Tools run inside a worker's sandbox, so a thinker gets only a nudge — no editor.
  if (capability !== "worker") {
    return (
      <div className="tv-field">
        <span className="tv-field__label">Tools</span>
        <span className="tv-field__hint">
          Tools run inside a worker’s sandbox — switch this node to Worker to add them.
        </span>
      </div>
    );
  }

  return (
    <details className="tv-field" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tv-field__label">Tools</summary>
      <span className="tv-field__hint">MCP servers — configured in the Tools milestone.</span>
      <textarea
        className="tv-node-prompt"
        aria-label="Tools JSON"
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
            onChange(JSON.parse(raw) as Record<string, unknown>);
          } catch {
            // Keep the raw text visible while it's mid-edit / invalid; don't propagate a bad value.
          }
        }}
      />
    </details>
  );
}
