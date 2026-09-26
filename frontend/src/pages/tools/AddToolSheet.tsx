/**
 * "Add a tool" (TkF-AddTool-1..7, TOOL-30..46): a 540px sheet in three steps.
 *   1 Basics — start from the catalog (→ the Browse tab), a custom server (default) or an mcp.json
 *     (→ the paste sheet); the Name, checked (rule + not already yours) on "Next: Connection".
 *   2 Connection — `ConnectionFields`; "Next: Secrets" needs a URL / command and valid raw JSON.
 *   3 Secrets — one password field per referenced secret without a value, "Choose agents" (the
 *     Turn-on dialog; the choice is held until "Add tool").
 * "Add tool" stores each typed secret, creates the tool, then turns it on for the chosen agents; a
 * failure says which step failed. The page closes the sheet, refreshes and toasts.
 */
import { ArrowLeft, Braces, Layers, Lock, Server } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, ConfirmDialog, Input, Sheet, cx } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type SetAgentsResult,
  type ToolItem,
  createSecret,
  createTool,
  listSecrets,
  setToolAgents,
} from "../../lib/api/tools";
import { ConnectionFields, type RawDraft } from "./ConnectionFields";
import { Stepper } from "./Stepper";
import { TurnOnForAgentsDialog } from "./TurnOnForAgentsDialog";
import {
  type ConnectionForm,
  EMPTY_CONNECTION,
  type SecretOption,
  connectionError,
  connectionTouched,
  formToConfig,
  refNameError,
  secretOptions,
  suggestedSecret,
  toolNameError,
} from "./connectionForm";
import { secretRefsOf } from "./toolConfig";
import { addFailedMessage, heldAgentsLine, secretsLede, wizardSubtitle } from "./toolFormat";
import "./tools.css";

const STEPS = ["Basics", "Connection", "Secrets"] as const;

/** Step 1's "Start from" choices. */
type Start = "catalog" | "custom" | "paste";
const START_LABEL: Record<Start, string> = {
  catalog: "Open the catalog",
  custom: "Next: Connection",
  paste: "Paste mcp.json",
};

export interface AddedTool {
  tool: ToolItem;
  /** PUT …/agents' answer, or null when no agents were chosen. */
  turnedOn: SetAgentsResult | null;
  /** The tool was created but turning it on failed. */
  agentsFailed: boolean;
}

/** The server's words for a 4xx, else null (a 5xx / network error says "Try again."). */
function reasonOf(e: unknown): string | null {
  return e instanceof ApiDetailError && e.status >= 400 && e.status < 500 && e.message
    ? e.message
    : null;
}

/** Your stored secrets: the picker's options and which names have a value (null = unknown). */
function useStoredSecrets() {
  const [options, setOptions] = useState<SecretOption[]>([]);
  const [stored, setStored] = useState<Set<string> | null>(null);
  useEffect(() => {
    let live = true;
    listSecrets()
      .then((list) => {
        if (!live) return;
        setOptions(secretOptions(list));
        setStored(new Set(list.secrets.map((s) => s.name)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const markStored = (name: string) => setStored((prev) => new Set(prev ?? []).add(name));
  return { options, stored, markStored };
}

function StartOption({
  value,
  checked,
  onChange,
  icon,
  title,
  description,
}: {
  value: Start;
  checked: boolean;
  onChange: (value: Start) => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label className={cx("tk-start", checked && "tk-start--on")}>
      <input
        type="radio"
        name="tk-start"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="tk-start__icon">{icon}</span>
      <span>
        <span className="tk-start__title">{title}</span>
        <span className="tk-start__desc">{description}</span>
      </span>
    </label>
  );
}

export function AddToolSheet({
  initialName = "",
  takenNames,
  onClose,
  onBrowse,
  onPaste,
  onAdded,
}: {
  initialName?: string;
  /** Your tools' names (a new one must differ). */
  takenNames: string[];
  onClose: () => void;
  /** "The catalog": close and show the Browse tab. */
  onBrowse: () => void;
  /** "An mcp.json": swap to the paste sheet. */
  onPaste: () => void;
  onAdded: (added: AddedTool) => void;
}) {
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<Start>("custom");
  // An arrow key in the radio group only moves the choice; a click or Space takes it (WCAG 3.2.2).
  const arrowed = useRef(false);
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_CONNECTION);
  const [raw, setRaw] = useState<RawDraft | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<{ ids: string[]; names: string[] }>({ ids: [], names: [] });
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { options, stored, markStored } = useStoredSecrets();

  const toolName = name.trim();
  const suggestion = suggestedSecret(toolName || "my-server");
  const config = useMemo(() => formToConfig(form), [form]);
  const refs = useMemo(() => secretRefsOf(config), [config]);
  const unset = refs.filter((n) => !stored?.has(n));

  // TOOL-30: once a connection is typed, Escape / ✕ / the scrim ask before throwing it away.
  const hasDraft =
    connectionTouched(form) ||
    raw !== null ||
    Object.values(values).some((v) => v.trim()) ||
    agents.ids.length > 0;
  const close = () => {
    if (busy) return;
    if (hasDraft) setDiscarding(true);
    else onClose();
  };

  const take = (choice: Start) => {
    if (choice === "catalog") onBrowse();
    else if (choice === "paste") onPaste();
    else setStart("custom");
  };
  const onStartChange = (choice: Start) => {
    if (!arrowed.current) return take(choice);
    arrowed.current = false;
    setStart(choice);
  };
  const onStartKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLInputElement;
    if (e.key.startsWith("Arrow")) arrowed.current = true;
    else if ((e.key === " " || e.key === "Enter") && target.type === "radio") {
      e.preventDefault();
      take(target.value as Start);
    }
  };

  const next = () => {
    if (step === 0) {
      if (start !== "custom") return take(start);
      const err = toolNameError(name, takenNames);
      setNameError(err);
      if (!err) setStep(1);
      return;
    }
    if (step === 1) {
      if (raw?.error) return;
      const err = connectionError(form);
      setConnError(err);
      const refErr = err ? null : refNameError(config);
      setRefError(refErr);
      if (!err && !refErr) setStep(2);
      return;
    }
    void submit();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const saved: string[] = [];
    for (const secret of unset) {
      const value = values[secret] ?? "";
      if (!value.trim()) continue;
      try {
        await createSecret(secret, value);
      } catch (e) {
        setError(addFailedMessage({ secret }, reasonOf(e), saved));
        setBusy(false);
        return;
      }
      saved.push(secret);
      markStored(secret);
    }
    let tool: ToolItem;
    try {
      tool = await createTool({ name: toolName, server_config: config });
    } catch (e) {
      setError(addFailedMessage({ tool: toolName }, reasonOf(e), saved));
      setBusy(false);
      return;
    }
    let turnedOn: SetAgentsResult | null = null;
    let agentsFailed = false;
    if (agents.ids.length > 0) {
      try {
        turnedOn = await setToolAgents(tool.id, agents.ids);
      } catch {
        agentsFailed = true;
      }
    }
    onAdded({ tool, turnedOn, agentsFailed });
  };

  // TOOL-72: Enter in a field takes the primary action (the secret picker's Enter picks instead).
  const onEnter = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || busy) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT" || (target as HTMLInputElement).type === "radio") return;
    e.preventDefault();
    next();
  };

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="tk-btn-inline"
      disabled={busy}
      onClick={() => {
        setError(null);
        setStep(step - 1);
      }}
    >
      <ArrowLeft size={13} strokeWidth={1.6} aria-hidden />
      <span>Back</span>
    </Button>
  );
  const cancel = (
    <Button variant="ghost" size="sm" onClick={close}>
      Cancel
    </Button>
  );
  const primary = (
    <Button size="sm" onClick={next} loading={busy} disabled={step === 1 && Boolean(raw?.error)}>
      {step === 0 ? START_LABEL[start] : step === 1 ? "Next: Secrets" : "Add tool"}
    </Button>
  );

  return (
    <>
      <Sheet
        open
        title="Add a tool"
        subtitle={wizardSubtitle(step, toolName)}
        onClose={close}
        width={540}
        footerNote={step === 0 ? cancel : back}
        footer={primary}
      >
        <div className="tk-wiz" onKeyDown={onEnter}>
          <Stepper steps={STEPS} current={step} />

          {step === 0 && (
            <>
              <span className="tk-wiz__label" id="tk-wiz-start">
                Start from
              </span>
              <div
                role="radiogroup"
                aria-labelledby="tk-wiz-start"
                className="tk-wiz__starts"
                onKeyDown={onStartKey}
                onKeyUp={() => (arrowed.current = false)}
                onPointerDown={() => (arrowed.current = false)}
              >
                <StartOption
                  value="catalog"
                  checked={start === "catalog"}
                  onChange={onStartChange}
                  icon={<Layers size={16} strokeWidth={1.6} aria-hidden />}
                  title="The catalog"
                  description="Web fetch or GitHub App repos, set up for you."
                />
                <StartOption
                  value="custom"
                  checked={start === "custom"}
                  onChange={onStartChange}
                  icon={<Server size={16} strokeWidth={1.6} aria-hidden />}
                  title="A custom server"
                  description="Any MCP server: a local command or a remote URL."
                />
                <StartOption
                  value="paste"
                  checked={start === "paste"}
                  onChange={onStartChange}
                  icon={<Braces size={16} strokeWidth={1.6} aria-hidden />}
                  title="An mcp.json"
                  description="Paste config from Claude, Cursor or VS Code."
                />
              </div>
              <Input
                label="Name"
                helper="Lowercase, no spaces. Agents see this name."
                autoComplete="off"
                spellCheck={false}
                value={name}
                error={nameError ?? undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
              />
            </>
          )}

          {step === 1 && (
            <ConnectionFields
              form={form}
              onChange={(f) => {
                setForm(f);
                setConnError(null);
                setRefError(null);
              }}
              raw={raw}
              onRawChange={setRaw}
              rawOpen={rawOpen}
              onRawToggle={() => setRawOpen(!rawOpen)}
              errors={form.transport === "remote" ? { url: connError } : { command: connError }}
              options={options}
              stored={stored}
              suggestion={suggestion}
            />
          )}
          {step === 1 && refError && (
            <p className="tk-wiz__error" role="alert">
              {refError}
            </p>
          )}

          {step === 2 && (
            <>
              <p className="tk-wiz__lede">{secretsLede(toolName, refs.length, unset.length)}</p>
              {refs.length > 0 && (
                <div className={cx("tk-secretcard", unset.length > 0 && "tk-secretcard--unset")}>
                  {refs.map((secret) => {
                    const isSet = stored?.has(secret) ?? false;
                    return (
                      <div key={secret} className="tk-secretcard__item">
                        <div className="tk-secretcard__head">
                          <span id={`tk-wiz-secret-${secret}`} className="tk-secretcard__name">
                            {secret}
                          </span>
                          {isSet ? (
                            <Badge variant="success">Set</Badge>
                          ) : (
                            <Badge variant="warning">Not set</Badge>
                          )}
                        </div>
                        {!isSet && (
                          <Input
                            type="password"
                            placeholder="Paste the value"
                            autoComplete="new-password"
                            aria-labelledby={`tk-wiz-secret-${secret}`}
                            value={values[secret] ?? ""}
                            disabled={busy}
                            onChange={(e) => setValues({ ...values, [secret]: e.target.value })}
                          />
                        )}
                      </div>
                    );
                  })}
                  {unset.length > 0 && (
                    <span className="tk-secretcard__note">
                      <Lock size={12} strokeWidth={1.6} aria-hidden />
                      Stored encrypted for your account. We never show it again.
                    </span>
                  )}
                </div>
              )}
              <div className="tk-agentsrow">
                <div>
                  <div className="tk-agentsrow__title">Switch it on for agents now</div>
                  <div className="tk-agentsrow__sub">{heldAgentsLine(agents.names)}</div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setChoosing(true)}
                >
                  Choose agents
                </Button>
              </div>
              {error && (
                <div className="tk-wiz__error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </Sheet>
      <ConfirmDialog
        open={discarding}
        title="Discard this tool?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      >
        {toolName ? `What you typed for ${toolName} isn’t saved.` : "What you typed isn’t saved."}
      </ConfirmDialog>
      {choosing && (
        <TurnOnForAgentsDialog
          toolName={toolName}
          initial={agents.ids}
          onClose={() => setChoosing(false)}
          onConfirm={(ids, names) => {
            setAgents({ ids, names });
            setChoosing(false);
          }}
        />
      )}
    </>
  );
}
