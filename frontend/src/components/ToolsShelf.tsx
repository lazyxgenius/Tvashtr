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
 *
 * Filler-B — a **guided** Local/Remote add form sits above the raw JSON (mirroring the in-drawer
 * `ToolsSection` add-server form). `configText` stays the SINGLE source of truth: the guided controls
 * READ by parsing it and WRITE by regenerating it via `buildServerConfig`; the raw textarea is an
 * "Advanced (raw JSON)" fallback over that same `configText`. `handleSave` is untouched.
 */
function transportOf(config: Record<string, unknown>): "stdio" | "http" | "sse" {
  if (config && typeof config.url === "string") return config.type === "sse" ? "sse" : "http";
  return "stdio";
}

type SecretRow = { key: string; value: string };

/**
 * Pure builder: the guided form's fields → the INNER `server_config` object (never mcpServers-wrapped).
 * Local → `{ command, args, env? }` (args split on whitespace); Remote → `{ url, headers? }`. Blank-key
 * rows are dropped; an empty env/headers map is omitted entirely.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure, unit-tested builder co-located with its only consumer (the shelf); a separate module is out of this change's scope.
export function buildServerConfig(
  transport: "local" | "remote",
  target: string,
  argsText: string,
  rows: SecretRow[],
): Record<string, unknown> {
  const map: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k !== "") map[k] = value;
  }
  if (transport === "remote") {
    const cfg: Record<string, unknown> = { url: target.trim() };
    if (Object.keys(map).length > 0) cfg.headers = map;
    return cfg;
  }
  const a = argsText.trim();
  const cfg: Record<string, unknown> = {
    command: target.trim(),
    args: a === "" ? [] : a.split(/\s+/),
  };
  if (Object.keys(map).length > 0) cfg.env = map;
  return cfg;
}

// Parse an env/headers block back into editable rows (guided seed on edit / advanced hand-edit).
function rowsOfBlock(block: unknown): SecretRow[] {
  if (block === null || typeof block !== "object" || Array.isArray(block)) return [];
  return Object.entries(block as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

export function ToolsShelf() {
  const [tools, setTools] = useState<ToolLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [configText, setConfigText] = useState("");
  // Guided-form buffer — a thin editing surface that is always mirrored into `configText`.
  const [transport, setTransport] = useState<"local" | "remote">("local");
  const [target, setTarget] = useState("");
  const [argsText, setArgsText] = useState("");
  const [rows, setRows] = useState<SecretRow[]>([]);
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

  // WRITE: regenerate `configText` from the guided buffer (called on every guided edit).
  const writeConfig = (t: "local" | "remote", tgt: string, a: string, r: SecretRow[]) =>
    setConfigText(JSON.stringify(buildServerConfig(t, tgt, a, r), null, 2));

  // READ/seed: populate the guided buffer by PARSING a server_config object.
  const seedGuided = (cfg: Record<string, unknown>) => {
    const remote = transportOf(cfg) !== "stdio";
    const rawTarget = remote ? cfg.url : cfg.command;
    const argsVal = cfg.args;
    setTransport(remote ? "remote" : "local");
    setTarget(typeof rawTarget === "string" ? rawTarget : "");
    setArgsText(
      Array.isArray(argsVal)
        ? argsVal.filter((x): x is string => typeof x === "string").join(" ")
        : "",
    );
    setRows(rowsOfBlock(remote ? cfg.headers : cfg.env));
  };
  const clearGuided = () => {
    setTransport("local");
    setTarget("");
    setArgsText("");
    setRows([]);
  };

  const resetForm = () => {
    setEditingId(null);
    setNameInput("");
    setConfigText("");
    clearGuided();
  };

  const startEdit = (t: ToolLibraryItem) => {
    setEditingId(t.id);
    setNameInput(t.name);
    setConfigText(JSON.stringify(t.server_config, null, 2));
    seedGuided(t.server_config);
  };

  // Guided-field handlers — each updates its own state AND rewrites `configText` from the new values.
  const onTransport = (t: "local" | "remote") => {
    setTransport(t);
    writeConfig(t, target, argsText, rows);
  };
  const onTarget = (v: string) => {
    setTarget(v);
    writeConfig(transport, v, argsText, rows);
  };
  const onArgs = (v: string) => {
    setArgsText(v);
    writeConfig(transport, target, v, rows);
  };
  const onRow = (i: number, patch: Partial<SecretRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    writeConfig(transport, target, argsText, next);
  };
  // A fresh (blank) row contributes nothing to the config, so it doesn't rewrite `configText` yet —
  // that keeps any richer Advanced-JSON intact until the user actually types a key.
  const addRow = () => setRows((r) => [...r, { key: "", value: "" }]);
  const removeRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setRows(next);
    writeConfig(transport, target, argsText, next);
  };

  // Advanced raw-JSON edits are the source of truth too: mirror them back into the guided buffer.
  const onAdvanced = (raw: string) => {
    setConfigText(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      clearGuided();
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        seedGuided(parsed as Record<string, unknown>);
      }
    } catch {
      // Invalid mid-edit — keep the guided buffer as-is; handleSave rejects a bad config on save.
    }
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

  const isLocal = transport === "local";
  const rowNoun = isLocal ? "Environment variable" : "Header";

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
          <div className="tv-seg" role="group" aria-label="Transport">
            <button
              type="button"
              className={isLocal ? "tv-seg__btn is-active" : "tv-seg__btn"}
              onClick={() => onTransport("local")}
            >
              Local
            </button>
            <button
              type="button"
              className={!isLocal ? "tv-seg__btn is-active" : "tv-seg__btn"}
              onClick={() => onTransport("remote")}
            >
              Remote
            </button>
          </div>
          <input
            className="tv-launch__input"
            aria-label={isLocal ? "Command" : "URL"}
            placeholder={isLocal ? "command (e.g. uvx)" : "https://…/mcp"}
            value={target}
            onChange={(e) => onTarget(e.target.value)}
          />
          {isLocal && (
            <input
              className="tv-launch__input"
              aria-label="Arguments"
              placeholder="args, space-separated (optional)"
              value={argsText}
              onChange={(e) => onArgs(e.target.value)}
            />
          )}
          <div style={{ display: "grid", gap: "0.3rem" }}>
            {rows.length > 0 && (
              <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>
                {isLocal ? "Environment (use ${SECRET} refs)" : "Headers (use ${SECRET} refs)"}
              </span>
            )}
            {rows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: "0.3rem" }}>
                <input
                  className="tv-launch__input"
                  style={{ flex: 1 }}
                  aria-label={`${rowNoun} name ${i + 1}`}
                  placeholder={isLocal ? "NAME" : "Header-Name"}
                  value={row.key}
                  onChange={(e) => onRow(i, { key: e.target.value })}
                />
                <input
                  className="tv-launch__input"
                  style={{ flex: 1 }}
                  aria-label={`${rowNoun} value ${i + 1}`}
                  placeholder="${SECRET} or value"
                  value={row.value}
                  onChange={(e) => onRow(i, { value: e.target.value })}
                />
                <button
                  type="button"
                  className="tv-btn tv-btn--ghost tv-btn--sm"
                  aria-label={`Remove ${rowNoun.toLowerCase()} ${i + 1}`}
                  onClick={() => removeRow(i)}
                >
                  ×
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="tv-btn tv-btn--ghost tv-btn--sm" onClick={addRow}>
                {isLocal ? "Add variable" : "Add header"}
              </button>
            </div>
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.82rem", opacity: 0.8 }}>
              Advanced (raw JSON)
            </summary>
            <textarea
              className="tv-node-prompt"
              aria-label="Server config JSON"
              rows={4}
              spellCheck={false}
              placeholder='{ "command": "uvx", "args": ["mcp-server-fetch"] }'
              value={configText}
              onChange={(e) => onAdvanced(e.target.value)}
              style={{ marginTop: "0.3rem", width: "100%" }}
            />
          </details>
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
