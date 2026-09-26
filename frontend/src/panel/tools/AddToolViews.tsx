import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CircleCheck, KeyRound, Plus, X } from "lucide-react";

import { Badge, Button, IconButton, Input, Tabs } from "../../design-system/components";
import type { ToolLibraryItem } from "../../lib/api";
import type { Route } from "../../lib/nav";
import { PickList } from "../skills/AddSkillViews";
import { SubView } from "../SubView";
import type { ToastAction } from "../useDrawerToast";
import {
  type KeyValue,
  type ToolConfig,
  addLibrary,
  addServer,
  formOf,
  librariesOf,
  refsOf,
  replaceServer,
  secretName,
  serverFrom,
  serversOf,
  targetOf,
  targetProblem,
  toolRows,
  transportOf,
} from "./nodeTools";
import { parseMcpJson } from "./pasteMcpJson";
import type { AddToolKind } from "./ToolsPanel";

/** Which tool sheet is open over the Skills & tools tab. */
export interface ToolSub {
  kind: AddToolKind;
  /** Edit connection: the inline server being edited. */
  edit?: string;
}

interface ViewProps {
  config: ToolConfig;
  /** The account's library tools and secret names (null while unknown). */
  library: readonly ToolLibraryItem[] | null;
  secrets: readonly string[] | null;
  onChange: (next: ToolConfig) => void;
  notify: (message: string, action?: ToastAction) => void;
  onOpenToolkit?: (route: Route) => void;
  onClose: () => void;
}

const TABS: { value: AddToolKind; label: string }[] = [
  { value: "server", label: "Add a server" },
  { value: "library", label: "Library" },
  { value: "paste", label: "Paste mcp.json" },
];

/**
 * The Tools sub-views (PANEL-96..98; Panel-AddTool, Flow-PasteJson): "Add a tool" with pill tabs
 * Add a server | Library | Paste mcp.json, or Edit connection for an inline server. Each changes
 * the draft and closes; Save keeps it.
 */
export function AddToolView({ sub, ...props }: ViewProps & { sub: ToolSub }) {
  const [kind, setKind] = useState(sub.kind);
  if (sub.edit !== undefined) return <AddServerForm {...props} edit={sub.edit} />;
  const tabs = (
    <Tabs
      variant="pill"
      aria-label="How to add a tool"
      className="nd-tool-tabs"
      items={TABS}
      value={kind}
      onChange={setKind}
    />
  );
  if (kind === "paste") return <PasteMcpJson {...props} tabs={tabs} />;
  if (kind === "library") return <LibraryToolPicker {...props} tabs={tabs} />;
  return <AddServerForm {...props} tabs={tabs} />;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * PANEL-98: "<n> servers added · <k> needs a secret" with Add secret (Toolkit › Secrets), or Undo
 * when every secret is set.
 */
function notifyAdded(
  { notify, onOpenToolkit, onChange, config }: ViewProps,
  servers: readonly unknown[],
  secrets: readonly string[] | null,
) {
  const k = secrets ? servers.filter((s) => refsOf(s).some((r) => !secrets.includes(r))).length : 0;
  const text =
    `${plural(servers.length, "server", "servers")} added` +
    (k > 0 ? ` · ${k} ${k === 1 ? "needs" : "need"} a secret` : "");
  notify(
    text,
    k > 0 && onOpenToolkit
      ? { label: "Add secret", onAction: () => onOpenToolkit({ page: "secrets" }) }
      : { label: "Undo", onAction: () => onChange(config) },
  );
}

/** Names already on this agent (inline servers and library tools); `except` is the one being edited. */
function takenNames(props: ViewProps, except?: string): Set<string> {
  return new Set(
    toolRows(props.config, props.library, null)
      .filter((r) => !(r.source === "inline" && r.name === except))
      .map((r) => r.name),
  );
}

/**
 * PANEL-96: a server by name — Remote (URL + headers) or Local (command + env). `${NAME}` is filled
 * in only inside header and env values (node_tools), so those rows carry the secret hint (Q14).
 */
function AddServerForm({ tabs, edit, ...props }: ViewProps & { tabs?: ReactNode; edit?: string }) {
  const original = edit === undefined ? undefined : serversOf(props.config)[edit];
  const [start] = useState<ReturnType<typeof formOf>>(() =>
    original === undefined ? { transport: "remote", target: "", rows: [] } : formOf(original),
  );
  const [name, setName] = useState(edit ?? "");
  const [transport, setTransport] = useState(start.transport);
  const [target, setTarget] = useState(start.target);
  const [rows, setRows] = useState<KeyValue[]>(
    start.rows.length > 0 ? start.rows : [{ key: "", value: "" }],
  );
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const whereId = useId();
  const pairsId = useId();
  useEffect(() => nameRef.current?.focus(), []);

  const trimmed = name.trim();
  const duplicate = trimmed !== "" && takenNames(props, edit).has(trimmed);
  const problem = targetProblem(transport, target);
  const ready = trimmed !== "" && target.trim() !== "" && !duplicate;
  const remote = transport === "remote";
  const pair = remote ? "header" : "variable";
  const secret = `\${${secretName(trimmed)}}`;

  const submit = () => {
    if (!ready) return;
    if (problem) {
      setTried(true);
      targetRef.current?.focus();
      return;
    }
    const server = serverFrom(transport, target, rows, original);
    if (edit === undefined) {
      props.onChange(addServer(props.config, trimmed, server));
      notifyAdded(props, [server], props.secrets);
    } else {
      props.onChange(replaceServer(props.config, edit, trimmed, server));
    }
    props.onClose();
  };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };
  const setRow = (i: number, patch: Partial<KeyValue>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <SubView
      title={edit === undefined ? "Add a tool" : "Edit connection"}
      backLabel="Back to tools"
      onBack={props.onClose}
      gap={16}
      note={
        edit === undefined
          ? "Adds to this agent. Save to keep it."
          : "Changes this agent. Save to keep it."
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!ready} onClick={submit}>
            {edit === undefined ? "Add server" : "Update server"}
          </Button>
        </>
      }
    >
      {tabs}
      <Input
        ref={nameRef}
        label="Server name"
        placeholder="github"
        value={name}
        error={duplicate ? `This agent already has a tool called ${trimmed}.` : undefined}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter}
      />
      <div className="nd-skill-form__mode">
        <span className="nd-skill-form__label" id={whereId}>
          Where it runs
        </span>
        <div className="tv-seg nd-seg" role="group" aria-labelledby={whereId}>
          {(["local", "remote"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`tv-seg__btn${transport === t ? " tv-seg__btn--active" : ""}`}
              aria-pressed={transport === t}
              onClick={() => {
                setTransport(t);
                setTried(false);
              }}
            >
              {t === "local" ? "Local" : "Remote"}
            </button>
          ))}
        </div>
        <span className="nd-skill-form__hint">
          Remote servers are reached by URL. Local servers start from a command.
        </span>
      </div>
      <Input
        ref={targetRef}
        label={remote ? "URL" : "Command"}
        placeholder={remote ? "https://mcp.example.com" : "uvx mcp-server-sqlite"}
        value={target}
        error={tried && problem ? problem : undefined}
        onChange={(e) => {
          setTarget(e.target.value);
          setTried(false);
        }}
        onKeyDown={onEnter}
      />
      <div className="nd-tool-form__pairs" role="group" aria-labelledby={pairsId}>
        <span className="nd-skill-form__label" id={pairsId}>
          {remote ? "Headers" : "Env"}
        </span>
        {rows.map((row, i) => (
          <div className="nd-tool-form__pair" key={i}>
            <Input
              size="sm"
              aria-label={`${remote ? "Header" : "Variable"} ${i + 1} name`}
              placeholder={remote ? "Authorization" : "API_KEY"}
              value={row.key}
              onChange={(e) => setRow(i, { key: e.target.value })}
              onKeyDown={onEnter}
            />
            <Input
              size="sm"
              aria-label={`${remote ? "Header" : "Variable"} ${i + 1} value`}
              placeholder={remote ? `Bearer ${secret}` : secret}
              value={row.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
              onKeyDown={onEnter}
            />
            <IconButton
              size="sm"
              aria-label={`Remove ${pair} ${i + 1}`}
              title={`Remove ${pair}`}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            >
              <X size={14} strokeWidth={1.6} />
            </IconButton>
          </div>
        ))}
        <span>
          <Button
            variant="ghost"
            size="sm"
            className="nd-btn-flush"
            onClick={() => setRows((prev) => [...prev, { key: "", value: "" }])}
          >
            <Plus size={13} strokeWidth={1.6} aria-hidden />
            <span>Add {pair}</span>
          </Button>
        </span>
      </div>
      <div className="nd-tool-form__secret">
        <KeyRound size={13} strokeWidth={1.6} aria-hidden />
        <span>
          Need a secret? Write it as <code>{secret}</code>. It stays a reference and is filled in at
          run time from your Secrets.
        </span>
      </div>
    </SubView>
  );
}

const missingLine = (name: string, missing: readonly string[]) => {
  const refs = missing.map((m) => `\${${m}}`).join(" and ");
  return missing.length === 1
    ? `${name} uses ${refs}, which isn’t set yet. Add it in Toolkit → Secrets.`
    : `${name} uses ${refs}, which aren’t set yet. Add them in Toolkit → Secrets.`;
};

/**
 * PANEL-97 (Flow-PasteJson-2): paste an mcp.json; its servers are read as you type ("<n> servers
 * found", Remote/Local, the secrets not set yet). Names already on this agent are left out.
 */
function PasteMcpJson({ tabs, ...props }: ViewProps & { tabs: ReactNode }) {
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const resultId = useId();
  const result = parseMcpJson(text);

  // The box grows with its text; the sheet's body scrolls.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border (the box is border-box).
    if (el.scrollHeight > 0)
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);
  useEffect(() => textRef.current?.focus({ preventScroll: true }), []);

  const taken = takenNames(props);
  const found = result.state === "ok" ? result.servers : [];
  const fresh = found.filter((s) => !taken.has(s.name));
  const secrets = props.secrets;
  const notes = [
    ...fresh.flatMap((s) => {
      const missing = secrets ? refsOf(s.server).filter((r) => !secrets.includes(r)) : [];
      return missing.length > 0 ? [missingLine(s.name, missing)] : [];
    }),
    ...found
      .filter((s) => taken.has(s.name))
      .map((s) => `${s.name} is already on this agent, so it’s left out.`),
    ...(result.state === "ok" ? result.skipped : []).map(
      (name) => `${name} has no url or command, so it’s left out.`,
    ),
  ];

  const add = () => {
    if (fresh.length === 0) return;
    props.onChange(
      fresh.reduce<ToolConfig>((cfg, s) => addServer(cfg, s.name, s.server), props.config),
    );
    notifyAdded(
      props,
      fresh.map((s) => s.server),
      secrets,
    );
    props.onClose();
  };

  return (
    <SubView
      title="Add a tool"
      onBack={props.onClose}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={fresh.length === 0} onClick={add}>
            {fresh.length === 0
              ? "Add servers"
              : `Add ${plural(fresh.length, "server", "servers")}`}
          </Button>
        </>
      }
    >
      {tabs}
      <textarea
        ref={textRef}
        className="nd-schema nd-paste"
        title="mcp.json"
        aria-describedby={result.state === "empty" ? undefined : resultId}
        aria-invalid={result.state === "error" || undefined}
        value={text}
        spellCheck={false}
        placeholder={text ? undefined : '{ "mcpServers": { … } } from Claude, Cursor or VS Code'}
        onChange={(e) => setText(e.target.value)}
      />
      <div id={resultId} aria-live="polite" className="nd-paste__result-wrap">
        {result.state === "error" && (
          <span className="nd-schema__msg nd-schema__msg--error">
            <AlertTriangle size={13} strokeWidth={1.6} aria-hidden />
            {result.message}
          </span>
        )}
        {result.state === "ok" && (
          <div className="nd-paste__result">
            {found.length > 0 ? (
              <span className="nd-paste__count">
                <CircleCheck size={13} strokeWidth={1.6} aria-hidden />
                {plural(found.length, "server", "servers")} found
              </span>
            ) : (
              <span className="nd-paste__none">No servers found.</span>
            )}
            {found.map((s) => (
              <div className="nd-paste__row" key={s.name}>
                {s.name}{" "}
                <Badge variant="outline">
                  {transportOf(s.server) === "stdio" ? "Local" : "Remote"}
                </Badge>
              </div>
            ))}
            {notes.map((line) => (
              <span className="nd-paste__warn" key={line}>
                <AlertTriangle size={13} strokeWidth={1.6} aria-hidden />
                {line}
              </span>
            ))}
          </div>
        )}
      </div>
    </SubView>
  );
}

/** The account's library tools; ones this agent already has can't be added twice. */
function LibraryToolPicker({ tabs, ...props }: ViewProps & { tabs: ReactNode }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const { library, onOpenToolkit } = props;
  const refs = librariesOf(props.config);

  const add = () => {
    if (picked.length === 0) return;
    props.onChange(addLibrary(props.config, picked));
    notifyAdded(
      props,
      (library ?? []).filter((t) => picked.includes(t.id)).map((t) => t.server_config),
      props.secrets,
    );
    props.onClose();
  };

  let body: ReactNode;
  if (library === null) body = <p className="nd-pick__none">Loading your library…</p>;
  else if (library.length === 0)
    body = (
      <div className="nd-pick__empty">
        <p className="nd-pick__none">No library tools yet.</p>
        {onOpenToolkit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenToolkit({ page: "tools", view: "installed" })}
          >
            Open Toolkit
          </Button>
        )}
      </div>
    );
  else
    body = (
      <PickList
        items={library.map((t) => ({
          key: t.id,
          title: t.name,
          description: targetOf(t.server_config, refsOf(t.server_config)),
          added: refs.includes(t.id),
        }))}
        picked={picked}
        onToggle={toggle}
        searchLabel="Search your library"
        empty="No library tools match"
      />
    );

  return (
    <SubView
      title="Add a tool"
      onBack={props.onClose}
      gap={10}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={picked.length === 0} onClick={add}>
            {picked.length === 0 ? "Add tools" : `Add ${plural(picked.length, "tool", "tools")}`}
          </Button>
        </>
      }
    >
      {tabs}
      {body}
    </SubView>
  );
}
