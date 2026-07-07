import { useEffect, useRef, useState } from "react";
import { Wrench, X } from "lucide-react";

import {
  createToolLibraryItem,
  deleteToolLibraryItem,
  listToolLibrary,
  type ToolLibraryItem,
  updateToolLibraryItem,
} from "../lib/api";

/**
 * M-tools C7.C — the account's central **Tool library** shelf, beside the Providers/Secrets shelves.
 * A reusable MCP server defined ONCE here can be REFERENCED from any node's Tools section (the node
 * stores only the id; the run-time resolver fetches this content fresh). Editing an item here is the
 * "edit once → propagates" moment: every referencing node picks up the change on its next run.
 *
 * One row = one MCP server: a display name (the `mcpServers` key) + a `server_config` JSON object
 * (`{command,args,env}` for stdio or `{url,headers,type}` for http/sse). Full-fidelity JSON so a
 * library server can carry `${NAME}` secret refs, resolved server-side like an inline one.
 */
function transportOf(config: Record<string, unknown>): "stdio" | "http" | "sse" {
  if (config && typeof config.url === "string") return config.type === "sse" ? "sse" : "http";
  return "stdio";
}

export function ToolsShelf() {
  const [tools, setTools] = useState<ToolLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [configText, setConfigText] = useState("");
  const mounted = useRef(true);

  const reload = async () => {
    const t = await listToolLibrary();
    if (mounted.current) setTools(t);
  };

  useEffect(() => {
    mounted.current = true;
    listToolLibrary()
      .then((t) => mounted.current && setTools(t))
      .catch(() => {})
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setNameInput("");
    setConfigText("");
  };

  const startEdit = (t: ToolLibraryItem) => {
    setEditingId(t.id);
    setNameInput(t.name);
    setConfigText(JSON.stringify(t.server_config, null, 2));
  };

  const handleSave = async () => {
    const name = nameInput.trim();
    if (name === "") {
      setError("A name is required.");
      return;
    }
    let config: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(configText.trim() || "null");
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length === 0
      ) {
        throw new Error("empty");
      }
      config = parsed as Record<string, unknown>;
    } catch {
      setError("The server config must be a non-empty JSON object.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) await updateToolLibraryItem(editingId, name, config);
      else await createToolLibraryItem(name, config);
      resetForm();
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't save the tool.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await deleteToolLibraryItem(id);
      if (editingId === id) resetForm();
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't remove the tool.");
    }
  };

  return (
    <section className="tv-dash__panel tv-dash__prov" aria-label="Your tool library">
      <div className="tv-dash__prov-head">
        <div className="tv-dash__prov-lede">
          <div className="tv-dash__prov-title">
            <Wrench size={16} strokeWidth={1.7} />
            <h2>Tool library</h2>
          </div>
          <p className="tv-dash__prov-sub">
            Reusable MCP servers — define one here, then reference it from any node&rsquo;s Tools
            section. Edit it once and every node that uses it picks up the change on its next run.
          </p>
        </div>
        <div className="tv-dash__prov-add" style={{ display: "grid", gap: "0.4rem" }}>
          <input
            className="tv-launch__input"
            aria-label="Tool name"
            placeholder="server name (e.g. fetch)"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <textarea
            className="tv-node-prompt"
            aria-label="Server config JSON"
            rows={4}
            spellCheck={false}
            placeholder='{ "command": "uvx", "args": ["mcp-server-fetch"] }'
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
          />
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              className="tv-btn tv-btn--primary"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {editingId ? "Save tool" : "Add tool"}
            </button>
            {editingId && (
              <button className="tv-btn tv-btn--ghost" onClick={resetForm} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
      {!loading && tools.length === 0 ? (
        <p className="tv-dash__prov-empty">
          Add a reusable MCP server so any node can reference it from its Tools section.
        </p>
      ) : (
        <ul className="tv-dash__prov-list">
          {tools.map((t) => (
            <li className="tv-dash__prov-chip" key={t.id}>
              <span className="tv-mcp-badge">{transportOf(t.server_config)}</span>
              <span className="tv-dash__prov-name">{t.name}</span>
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                aria-label={`Edit ${t.name}`}
                onClick={() => startEdit(t)}
              >
                Edit
              </button>
              <button
                type="button"
                className="tv-dash__prov-x"
                aria-label={`Remove ${t.name}`}
                onClick={() => void handleRemove(t.id)}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
