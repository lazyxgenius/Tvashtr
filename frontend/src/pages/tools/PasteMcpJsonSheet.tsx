/**
 * "Paste mcp.json" (TkF-Paste-1..3, TOOL-61..66): a 540px sheet with a monospace box for the file
 * from Claude, Cursor or VS Code. Every keystroke re-reads it (`readMcpJson`): a mistake shows as
 * one friendly, line-numbered sentence and keeps "Add N servers" disabled; once it reads, "N
 * servers found" lists each server with its Local / Remote badge, all checked — except one whose
 * name you already have ("Replaces your <name>", unchecked; checking it replaces that tool, spec
 * Q1) and one that can't connect (its reason, can't be checked). Values that look like secrets
 * offer to move to Secrets (spec Q13).
 *
 * "Add N servers" stores the moved secrets, then POSTs /api/tool-library/import in one go
 * (`on_conflict: "replace"` only when a server you already have is checked). The page closes the
 * sheet, refreshes and toasts.
 */
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, Sheet, cx } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import { type ToolItem, createSecret, importTools, listSecrets } from "../../lib/api/tools";
import { type LiteralSecret, type PastedServer, readMcpJson, withSecretsMoved } from "./mcpJson";
import { addServersLabel, serversFoundLabel } from "./toolFormat";
import "./tools.css";

export interface PastedTools {
  /** Every tool written, in pasted order (a replaced one keeps its id). */
  added: ToolItem[];
  /** The names that replaced a tool you had. */
  replaced: string[];
}

const PLACEHOLDER = `{
  "mcpServers": {
    "my-server": { "command": "uvx", "args": ["my-server"] }
  }
}`;

const secretKey = (server: PastedServer, s: LiteralSecret) =>
  `${server.name}\u0000${s.block}\u0000${s.key}`;

/** The import's 4xx in words: "sqlite: Add a command or a URL.", else null. */
function importError(e: unknown): string | null {
  if (!(e instanceof ApiDetailError) || e.status < 400 || e.status >= 500 || !e.message)
    return null;
  const d = e.detail;
  const server =
    d && typeof d === "object" && "server" in d && typeof d.server === "string" ? d.server : null;
  return server ? `${server}: ${e.message}` : e.message;
}

/** The names a 409 says you already have. */
function conflictsOf(e: unknown): string[] {
  if (!(e instanceof ApiDetailError) || e.status !== 409) return [];
  const d = e.detail;
  const list = d && typeof d === "object" && "conflicts" in d ? d.conflicts : null;
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
}

export function PasteMcpJsonSheet({
  existing,
  onClose,
  onAdded,
  onStale,
}: {
  /** Your tool names (a pasted one of these "Replaces your <name>"). */
  existing: string[];
  onClose: () => void;
  onAdded: (result: PastedTools) => void;
  /** The server knew of a tool this list didn't: reload it. */
  onStale: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  // Your ticks, by server name / secret; unticked defaults follow the list (a clash starts off).
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [moves, setMoves] = useState<Record<string, boolean>>({});
  const [stored, setStored] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Secrets already saved by an earlier try: a retry never POSTs them twice.
  const saved = useRef(new Set<string>());
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    listSecrets()
      .then((list) => live && setStored(new Set(list.secrets.map((s) => s.name))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The box takes the focus (the sheet starts on its ✕), and grows with what you paste.
  useEffect(() => box.current?.focus(), []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "";
    if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const read = useMemo(() => readMcpJson(text, existing, stored), [text, existing, stored]);
  const isChecked = (s: PastedServer) => !s.problem && (choices[s.name] ?? !s.replaces);
  const isMoved = (s: PastedServer, sec: LiteralSecret) => moves[secretKey(s, sec)] ?? true;
  const chosen = read.servers.filter(isChecked);
  const error = read.error;

  const add = async () => {
    if (error || chosen.length === 0 || busy) return;
    setBusy(true);
    setFailure(null);
    const moving = chosen.flatMap((s) => s.secrets.filter((sec) => isMoved(s, sec)));
    for (const sec of moving) {
      if (saved.current.has(sec.name)) continue;
      try {
        await createSecret(sec.name, sec.value);
        saved.current.add(sec.name);
      } catch (e) {
        const reason = e instanceof ApiDetailError && e.status < 500 ? ` ${e.message}` : "";
        setFailure(`Couldn’t save ${sec.name} in Secrets.${reason} No servers were added yet.`);
        setBusy(false);
        return;
      }
    }
    const servers = Object.fromEntries(
      chosen.map((s) => [
        s.name,
        withSecretsMoved(
          s.config,
          s.secrets.filter((sec) => isMoved(s, sec)),
        ),
      ]),
    );
    const replacing = chosen.some((s) => s.replaces);
    try {
      const result = await importTools(servers, replacing ? "replace" : "error");
      onAdded({ added: result.added, replaced: result.conflicts });
    } catch (e) {
      const clashes = conflictsOf(e);
      if (clashes.length > 0) {
        // Someone added one meanwhile: those rows turn to "Replaces your <name>", unticked.
        setChoices((c) =>
          Object.fromEntries(Object.entries(c).filter(([n]) => !clashes.includes(n))),
        );
        onStale();
      }
      setFailure(importError(e) ?? "Couldn’t add the servers. Try again.");
      setBusy(false);
    }
  };

  const onText = (value: string) => {
    setText(value);
    setFailure(null);
  };

  return (
    <Sheet
      open
      title="Paste mcp.json"
      subtitle="From Claude, Cursor or VS Code"
      onClose={onClose}
      width={540}
      footerNote={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      footer={
        <Button
          size="sm"
          onClick={() => void add()}
          loading={busy}
          disabled={Boolean(error) || chosen.length === 0}
        >
          {addServersLabel(error ? read.servers.filter((s) => !s.problem).length : chosen.length)}
        </Button>
      }
    >
      <div className="tk-paste__entry">
        <span id={`${id}-label`} className="tk-sr">
          mcp.json
        </span>
        <textarea
          ref={box}
          className={cx("tk-paste__text", error && "tk-paste__text--error")}
          aria-labelledby={`${id}-label`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder={text ? undefined : PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
        {/* Polite: it changes as you type. */}
        <div aria-live="polite">
          {error && (
            <span id={`${id}-error`} className="tk-paste__error">
              <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
              {error}
            </span>
          )}
        </div>
      </div>

      {!error && read.servers.length > 0 && (
        <div className="tk-paste__found" role="group" aria-labelledby={`${id}-found`}>
          <span id={`${id}-found`} className="tk-paste__count">
            <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
            {serversFoundLabel(read.servers.length)}
          </span>
          {read.servers.map((s, i) => (
            <ServerRow
              key={`${i}-${s.name}`}
              server={s}
              checked={isChecked(s)}
              onCheck={(on) => setChoices((c) => ({ ...c, [s.name]: on }))}
              isMoved={(sec) => isMoved(s, sec)}
              onMove={(sec, on) => setMoves((m) => ({ ...m, [secretKey(s, sec)]: on }))}
              disabled={busy}
            />
          ))}
        </div>
      )}

      {failure && (
        <p role="alert" className="tk-wiz__error">
          {failure}
        </p>
      )}
    </Sheet>
  );
}

function ServerRow({
  server,
  checked,
  onCheck,
  isMoved,
  onMove,
  disabled,
}: {
  server: PastedServer;
  checked: boolean;
  onCheck: (on: boolean) => void;
  isMoved: (s: LiteralSecret) => boolean;
  onMove: (s: LiteralSecret, on: boolean) => void;
  disabled: boolean;
}) {
  const local = server.transport === "local";
  return (
    <>
      <label className={cx("tk-paste__server", server.problem && "tk-paste__server--off")}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || Boolean(server.problem)}
          onChange={(e) => onCheck(e.target.checked)}
        />
        {server.name}{" "}
        {server.transport && (
          <Badge variant="outline" title={local ? "Runs in the agent’s sandbox" : undefined}>
            {local ? "Local" : "Remote"}
          </Badge>
        )}
        {server.pastedAs !== null && !server.problem && (
          <span className="tk-paste__note">Pasted as “{server.pastedAs}”</span>
        )}
        {server.problem ? (
          <span className="tk-paste__note tk-paste__note--warn">{server.problem}</span>
        ) : (
          server.replaces && <span className="tk-paste__note">Replaces your {server.name}</span>
        )}
      </label>
      {checked &&
        server.secrets.map((sec) => (
          <label key={`${sec.block}-${sec.key}`} className="tk-paste__secret">
            <input
              type="checkbox"
              checked={isMoved(sec)}
              disabled={disabled}
              onChange={(e) => onMove(sec, e.target.checked)}
            />
            <span>
              Move {sec.key} to Secrets as <code>{sec.name}</code>
              <span className="tk-paste__hint">
                {" "}
                It looks like a secret. The tool reads it as <code>{`\${${sec.name}}`}</code>.
              </span>
            </span>
          </label>
        ))}
    </>
  );
}
