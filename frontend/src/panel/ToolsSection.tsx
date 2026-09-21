import { useEffect, useState } from "react";

import type { ToolCatalogEntry, ToolLibraryItem } from "../lib/api";
import {
  createToolLibraryItem,
  listSecrets,
  listToolCatalog,
  listToolLibrary,
} from "../lib/api";

/**
 * M-tools C7.A + C7.C — the per-node **Tools** (MCP) editor. A worker node gets a real editor:
 *  - a raw paste-config `<textarea>` (Cursor / Claude Code `mcp.json` parity),
 *  - per-server rows (transport badge + an on/off toggle writing the Tvashtr allow-list metadata +
 *    remove),
 *  - a guided Add-server form (Local = stdio `command`; Remote = HTTP/SSE `url`),
 *  - **(C7.C) an "Add from library" picker** — reference a reusable account-library server by id
 *    (stored at `tool_config.tvashtr.library`); referenced servers render as **Library**-badged rows
 *    with the same on/off toggle + a remove-reference control. If a library ref's name collides with
 *    an inline server the library row shows a muted "overridden" tag (inline wins at run time).
 *  - a pre-launch note for any inline `${NAME}` whose secret isn't in the account's Secrets shelf.
 * M-unify U3: the editor is available on EVERY agent node (the thinker/worker split collapsed to the
 * edits toggle) — an edits-off node still runs read-only + MCP tools, so it authors tools too, exactly
 * like `SkillsSection`, which already renders for both. Props: `value` / `onChange`.
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
// C7.C: the ids of the account-library servers this node REFERENCES (stored beside the allow-list).

function domainsOf(cfg: Cfg): boolean {
  return asRecord(asRecord(cfg)["tvashtr"])["domains"] === true;
}
function librariesOf(cfg: Cfg): string[] {
  const lib = asRecord(asRecord(cfg)["tvashtr"])["library"];
  return Array.isArray(lib) ? lib.filter((x): x is string => typeof x === "string") : [];
}

export function ToolsSection({ value, onChange }: { value: Cfg; onChange: (value: Cfg) => void }) {
  const [text, setText] = useState(value == null ? "" : JSON.stringify(value, null, 2));
  const [open, setOpen] = useState(true);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [libraryTools, setLibraryTools] = useState<ToolLibraryItem[]>([]);
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
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

  // C7.C: the account's library tools — to resolve a referenced id to its name + power the picker.
  useEffect(() => {
    let live = true;
    listToolLibrary()
      .then((t) => live && setLibraryTools(t))
      .catch(() => {});
    listToolCatalog()
      .then((c) => live && setCatalog(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

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

  // C7.C: append / drop a library reference id at `tvashtr.library` (the servers/textarea untouched).
  const addLibraryRef = (id: string) => {
    const current = librariesOf(cfg);
    if (current.includes(id)) return;
    const base = asRecord(cfg);
    const meta = asRecord(base["tvashtr"]);
    apply({ ...base, tvashtr: { ...meta, library: [...current, id] } });
    setShowPicker(false);
  };
  const removeLibraryRef = (id: string) => {
    const base = asRecord(cfg);
    const meta = asRecord(base["tvashtr"]);
    apply({ ...base, tvashtr: { ...meta, library: librariesOf(cfg).filter((x) => x !== id) } });
  };

  const setDomains = (enabled: boolean) => {
    const base = asRecord(cfg);
    const meta = { ...asRecord(base["tvashtr"]) };
    if (enabled) {
      apply({ ...base, tvashtr: { ...meta, domains: true } });
      return;
    }
    delete meta.domains;
    const nextServers = serversOf(cfg);
    const hasServers = Object.keys(nextServers).length > 0;
    const hasLibrary = (Array.isArray(meta.library) ? meta.library : []).length > 0;
    const hasServerMeta = Object.keys(asRecord(meta.servers)).length > 0;
    const metaEmpty = Object.keys(meta).length === 0;
    if (!hasServers && !hasLibrary && !hasServerMeta && metaEmpty) {
      apply(null);
      return;
    }
    const next: Record<string, unknown> = { ...base };
    if (hasServers) next.mcpServers = nextServers;
    else delete next.mcpServers;
    if (metaEmpty) delete next.tvashtr;
    else next.tvashtr = meta;
    apply(Object.keys(next).length === 0 ? null : next);
  };

  const attachFetch = async () => {
    const fetchEntry =
      catalog.find((e) => e.key === "fetch" && e.attachable) ??
      ({
        key: "fetch",
        name: "fetch",
        server_config: { command: "uvx", args: ["mcp-server-fetch"] },
        attachable: true,
      } as ToolCatalogEntry);
    // Prefer an existing library row named fetch (avoid a redundant upsert when already present).
    const existing = libraryTools.find((t) => t.name === fetchEntry.name);
    setAttachBusy(true);
    try {
      let id = existing?.id;
      if (!id) {
        const created = await createToolLibraryItem(fetchEntry.name, fetchEntry.server_config);
        id = created.id;
        setLibraryTools((prev) =>
          prev.some((t) => t.id === id)
            ? prev
            : [
                ...prev,
                {
                  id: created.id,
                  name: created.name,
                  server_config: fetchEntry.server_config,
                  created_at: "",
                },
              ],
        );
      }
      addLibraryRef(id);
    } catch {
      // Shelf/network errors stay silent here; the drawer still works without the attach.
    } finally {
      setAttachBusy(false);
    }
  };

  const serverNames = Object.keys(servers);
  const inlineNameSet = new Set(serverNames);
  const libraryIds = librariesOf(cfg);
  const referencedRows = libraryIds.map((id) => {
    const item = libraryTools.find((t) => t.id === id) ?? null;
    return { id, name: item ? item.name : null };
  });
  // The 🔧 N count includes referenced servers (a name shared with an inline server counts once).
  const effectiveCount = new Set([
    ...serverNames,
    ...referencedRows.map((r) => r.name).filter((n): n is string => n != null),
  ]).size;

  return (
    <details className="tv-field" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tv-field__label">
        Tools {effectiveCount > 0 && `(${effectiveCount})`}
      </summary>
      <span className="tv-field__hint">
        MCP servers — paste an <code>mcp.json</code>, add one below, or reference one from your
        account library. Secrets stay as <code>${"{NAME}"}</code> references, resolved at run time.
      </span>

      <div className="tv-mcp-add" style={{ marginBottom: "0.5rem" }}>
        <label className="tv-mcp-toggle">
          <input
            type="checkbox"
            aria-label="Enable Domains MCP"
            checked={domainsOf(cfg)}
            onChange={(e) => setDomains(e.currentTarget.checked)}
          />
          <span>Domains MCP</span>
        </label>
        <button
          type="button"
          className="tv-btn tv-btn--ghost"
          aria-label="Attach fetch"
          disabled={attachBusy}
          onClick={() => void attachFetch()}
        >
          Attach fetch
        </button>
      </div>

      {(serverNames.length > 0 || referencedRows.length > 0) && (
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
          {referencedRows.map(({ id, name }) => {
            const overridden = name != null && inlineNameSet.has(name);
            return (
              <li className="tv-mcp-row" key={`lib-${id}`}>
                <span className="tv-mcp-badge">Library</span>
                <span className="tv-mcp-name">{name ?? "(removed from library)"}</span>
                {name != null && (
                  <label className="tv-mcp-toggle">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${name}`}
                      checked={enabledOf(cfg, name)}
                      onChange={(e) => setEnabled(name, e.currentTarget.checked)}
                    />
                    <span>{enabledOf(cfg, name) ? "on" : "off"}</span>
                  </label>
                )}
                {overridden && (
                  <span className="tv-field__hint" style={{ fontStyle: "italic" }}>
                    overridden
                  </span>
                )}
                <button
                  type="button"
                  className="tv-mcp-remove"
                  aria-label={`Remove reference ${name ?? id}`}
                  onClick={() => removeLibraryRef(id)}
                >
                  ×
                </button>
              </li>
            );
          })}
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
        <button
          type="button"
          className="tv-btn tv-btn--ghost"
          aria-label="Add from library"
          onClick={() => setShowPicker((v) => !v)}
        >
          Add from library
        </button>
      </div>

      {showPicker && (
        <ul className="tv-mcp-list" aria-label="Tool library picker">
          {libraryTools.length === 0 ? (
            <li className="tv-field__hint">
              No library tools yet — add one in the Tool library shelf on your dashboard.
            </li>
          ) : (
            libraryTools.map((t) => {
              const already = libraryIds.includes(t.id);
              const clash = inlineNameSet.has(t.name);
              return (
                <li className="tv-mcp-row" key={`pick-${t.id}`}>
                  <span className="tv-mcp-badge">{transportOf(t.server_config)}</span>
                  <span className="tv-mcp-name">{t.name}</span>
                  <button
                    type="button"
                    className="tv-btn tv-btn--sm"
                    aria-label={`Add ${t.name} from library`}
                    disabled={already || clash}
                    onClick={() => addLibraryRef(t.id)}
                  >
                    {already ? "added" : clash ? "in use" : "Add"}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

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
