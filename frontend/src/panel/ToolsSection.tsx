import { useEffect, useState } from "react";

import type { Capability } from "../lib/api";
import { listSecrets } from "../lib/api";

/**
 * M-tools C7.A — the per-node **Tools** (MCP) editor. A worker node gets a real editor:
 *  - a raw paste-config `<textarea>` (Cursor / Claude Code `mcp.json` parity),
 *  - per-server rows (transport badge + an on/off toggle writing the Tvashtr allow-list metadata +
 *    remove),
 *  - a guided Add-server form (Local = stdio `command`; Remote = HTTP/SSE `url`),
 *  - a pre-launch note for any `${NAME}` reference whose secret isn't in the account's Secrets shelf.
 * A non-worker (thinker) gets only the worker-only note (tools run in a worker's sandbox). Props are
 * unchanged from the scaffold (`value` / `onChange` / `capability`) so `TeamNodePanel` is untouched.
 */

type Cfg = Record<string, unknown> | null;

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function serversOf(cfg: Cfg): Record<string, unknown> {
  return asRecord(asRecord(cfg)["mcpServers"]);
}
function transportOf(server: unknown): "stdio" | "http" | "sse" {
  const s = asRecord(server);
  if (typeof s["url"] === "string") return s["type"] === "sse" ? "sse" : "http";
  return "stdio";
}
function enabledOf(cfg: Cfg, name: string): boolean {
  const meta = asRecord(asRecord(asRecord(cfg)["tvashtr"])["servers"]);
  return asRecord(meta[name])["enabled"] !== false;
}
function refsOf(cfg: Cfg): string[] {
  const names = new Set<string>();
  for (const server of Object.values(serversOf(cfg))) {
    for (const block of ["env", "headers"]) {
      for (const val of Object.values(asRecord(asRecord(server)[block]))) {
        if (typeof val === "string") for (const m of val.matchAll(REF)) names.add(m[1]);
      }
    }
  }
  return [...names];
}

export function ToolsSection({
  value,
  onChange,
  capability,
}: {
  value: Cfg;
  onChange: (value: Cfg) => void;
  capability: Capability;
}) {
  const [text, setText] = useState(value == null ? "" : JSON.stringify(value, null, 2));
  const [open, setOpen] = useState(true);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState<"local" | "remote">("local");
  const [addTarget, setAddTarget] = useState("");

  // The account's stored secret NAMES — to flag a ${NAME} that isn't stored yet (pre-launch check).
  useEffect(() => {
    let live = true;
    listSecrets()
      .then((s) => live && setSecretNames(s.map((x) => x.name)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Tools run inside a worker's sandbox, so a thinker gets only a nudge — no editor.
  if (capability !== "worker") {
    return (
      <div className="tv-field">
        <span className="tv-field__label">Tools</span>
        <span className="tv-field__hint">
          Tools run inside a worker&rsquo;s sandbox — switch this node to Worker to add them.
        </span>
      </div>
    );
  }

  // The current config = the textarea if it parses, else the last-good `value`.
  const parseText = (): Cfg => {
    const t = text.trim();
    if (t === "") return null;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return value;
    }
  };
  const cfg = parseText();
  const servers = serversOf(cfg);
  const missing = refsOf(cfg).filter((r) => !secretNames.includes(r));

  const apply = (next: Cfg) => {
    setText(next == null ? "" : JSON.stringify(next, null, 2));
    onChange(next);
  };

  const setEnabled = (name: string, enabled: boolean) => {
    const base = asRecord(cfg);
    const meta = asRecord(base["tvashtr"]);
    const metaServers = { ...asRecord(meta["servers"]) };
    metaServers[name] = { ...asRecord(metaServers[name]), enabled };
    apply({ ...base, tvashtr: { ...meta, servers: metaServers } });
  };

  const removeServer = (name: string) => {
    const base = asRecord(cfg);
    const nextServers = { ...serversOf(cfg) };
    delete nextServers[name];
    const meta = asRecord(base["tvashtr"]);
    const metaServers = { ...asRecord(meta["servers"]) };
    delete metaServers[name];
    apply({ ...base, mcpServers: nextServers, tvashtr: { ...meta, servers: metaServers } });
  };

  const addServer = () => {
    const name = addName.trim();
    if (name === "") return;
    const base = asRecord(cfg);
    const nextServers = { ...serversOf(cfg) };
    nextServers[name] =
      addKind === "local" ? { command: addTarget.trim(), args: [] } : { url: addTarget.trim() };
    apply({ ...base, mcpServers: nextServers });
    setAddName("");
    setAddTarget("");
  };

  const serverNames = Object.keys(servers);

  return (
    <details className="tv-field" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tv-field__label">
        Tools {serverNames.length > 0 && `(${serverNames.length})`}
      </summary>
      <span className="tv-field__hint">
        MCP servers — paste an <code>mcp.json</code> or add one below. Secrets stay as{" "}
        <code>${"{NAME}"}</code> references, resolved at run time.
      </span>

      {serverNames.length > 0 && (
        <ul className="tv-mcp-list">
          {serverNames.map((name) => (
            <li className="tv-mcp-row" key={name}>
              <span className="tv-mcp-badge">{transportOf(servers[name])}</span>
              <span className="tv-mcp-name">{name}</span>
              <label className="tv-mcp-toggle">
                <input
                  type="checkbox"
                  aria-label={`Enable ${name}`}
                  checked={enabledOf(cfg, name)}
                  onChange={(e) => setEnabled(name, e.currentTarget.checked)}
                />
                <span>{enabledOf(cfg, name) ? "on" : "off"}</span>
              </label>
              <button
                type="button"
                className="tv-mcp-remove"
                aria-label={`Remove ${name}`}
                onClick={() => removeServer(name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <div className="tv-mcp-warn" role="status">
          Needs {missing.map((m) => `$\{${m}}`).join(", ")} — add it in the account Secrets shelf.
        </div>
      )}

      <div className="tv-mcp-add">
        <input
          className="tv-launch__input"
          aria-label="New server name"
          placeholder="server name"
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
        />
        <div className="tv-seg" role="group" aria-label="Transport">
          <button
            type="button"
            className={addKind === "local" ? "tv-seg__btn is-active" : "tv-seg__btn"}
            onClick={() => setAddKind("local")}
          >
            Local
          </button>
          <button
            type="button"
            className={addKind === "remote" ? "tv-seg__btn is-active" : "tv-seg__btn"}
            onClick={() => setAddKind("remote")}
          >
            Remote
          </button>
        </div>
        <input
          className="tv-launch__input"
          aria-label={addKind === "local" ? "Command" : "URL"}
          placeholder={addKind === "local" ? "command (e.g. uvx)" : "https://…/mcp"}
          value={addTarget}
          onChange={(e) => setAddTarget(e.target.value)}
        />
        <button type="button" className="tv-btn tv-btn--ghost" onClick={addServer}>
          Add server
        </button>
      </div>

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
