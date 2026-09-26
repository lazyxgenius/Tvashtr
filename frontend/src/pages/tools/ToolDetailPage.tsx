/**
 * Toolkit › Tools › one tool (`#/toolkit/tools/<id>`, Toolkit-ToolDetail, TkF-Detail-1..5,
 * TOOL-52..60), loaded from `GET /api/tool-library/{id}`.
 *
 * - The "Tools › <name>" breadcrumb returns to the list, which keeps its search and filter
 *   (toolsState).
 * - The header: the icon tile, the name, the Local/Remote badge and Ready / "Needs <NAME>";
 *   Duplicate, and "Save changes" (disabled while nothing changed). An edit shows "Unsaved" and
 *   Discard, and leaving asks first (useLeaveGuard).
 * - The Connection card: a Name field (spec Q6 — the Duplicate toast says "Rename it in its
 *   settings"; not drawn), then ConnectionFields' page variant: the URL (or command and arguments),
 *   the headers (or environment) read-only with their secret chips, and "Advanced (raw JSON)".
 *   Saving is a PATCH of what changed.
 * - "Remove from Toolkit" → the "Remove <name>?" alertdialog → back to the list with a toast.
 * - "Used by N agents in M teams": role, team and an Open link to that agent on its team's canvas
 *   (Skills & tools tab).
 */
import { ChevronRight, TriangleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";

import { Badge, Button, ConfirmDialog, Input, useToast } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type SecretsList,
  type ServerConfig,
  type ToolDetail,
  duplicateTool,
  getTool,
  listSecrets,
  patchTool,
  setToolAgents,
} from "../../lib/api/tools";
import { navigate, parseRoute, routeToHash } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { glyphForNode } from "../../panel/nodeGlyph";
import { type RawDraft, ConnectionFields } from "./ConnectionFields";
import { RemoveToolDialog } from "./RemoveToolDialog";
import { TurnOnForAgentsDialog } from "./TurnOnForAgentsDialog";
import {
  type ConnectionForm,
  EMPTY_CONNECTION,
  TOOL_NAME_RULE,
  configKey,
  configToForm,
  connectionError,
  formToConfig,
  secretOptions,
  suggestedSecret,
  toolNameError,
} from "./connectionForm";
import { transportOf } from "./toolConfig";
import {
  agentName,
  needsLabel,
  removeCardLine,
  savedToast,
  turnedOnToast,
  usedByTitle,
} from "./toolFormat";
import { ToolGlyph } from "./toolIcons";
import { markToolFresh, resetToolsView } from "./toolsState";
import { useLeaveGuard } from "./useLeaveGuard";
import "./tools.css";

const LIST = { page: "tools", view: "installed" } as const;
const NOT_FOUND = "This tool isn’t in your Toolkit any more.";

/** The server's own words for a 4xx, else null. */
function clientError(e: unknown): string | null {
  if (!(e instanceof ApiDetailError) || e.status < 400 || e.status >= 500) return null;
  return e.message || null;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; missing: boolean }
  | { state: "ready"; tool: ToolDetail };

function useToolDetail(toolId: string) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    getTool(toolId).then(
      (tool) => live && setLoad({ state: "ready", tool }),
      (e: unknown) => {
        if (!live) return;
        const missing = e instanceof ApiDetailError && e.status === 404;
        setLoad({
          state: "error",
          missing,
          message: missing ? NOT_FOUND : "Couldn’t load this tool.",
        });
      },
    );
    return () => {
      live = false;
    };
  }, [toolId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const setTool = useCallback((tool: ToolDetail) => setLoad({ state: "ready", tool }), []);
  return { load, retry, setTool };
}

/** Your stored secret names (the chips' "· set"), or null until they load. */
function useStoredSecrets() {
  const [list, setList] = useState<SecretsList | null>(null);
  useEffect(() => {
    let live = true;
    listSecrets().then(
      (l) => live && setList(l),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return list;
}

export function ToolDetailPage({ toolId }: { toolId: string }) {
  const { load, retry, setTool } = useToolDetail(toolId);

  // Leaving Toolkit › Tools from here ends the visit, as it does from the list.
  useEffect(
    () => () => {
      const next = parseRoute(window.location.hash).page;
      if (next !== "tools" && next !== "tool") resetToolsView();
    },
    [],
  );

  return (
    <>
      <nav className="tk-crumbs" aria-label="Breadcrumb">
        <a className="tk-crumbs__link" href={routeToHash(LIST)}>
          Tools
        </a>
        <ChevronRight size={13} strokeWidth={1.6} aria-hidden />
        <span className="tk-crumbs__here" aria-current="page">
          {load.state === "ready" ? load.tool.name : "…"}
        </span>
      </nav>
      {load.state === "ready" ? (
        <ToolEditor key={load.tool.id} saved={load.tool} onSaved={setTool} />
      ) : load.state === "error" ? (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>{load.message}</span>
            {load.missing ? (
              <Button variant="secondary" size="sm" onClick={() => navigate(LIST)}>
                Back to tools
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={retry}>
                Retry
              </Button>
            )}
          </div>
        </section>
      ) : (
        <section className="tk-card" aria-busy="true">
          <div className="tk-state">Loading the tool…</div>
        </section>
      )}
    </>
  );
}

/** The loaded page: header, Connection, Remove and Used by. */
function ToolEditor({
  saved,
  onSaved,
}: {
  saved: ToolDetail;
  onSaved: (tool: ToolDetail) => void;
}) {
  const toast = useToast();
  const formId = useId();
  const secrets = useStoredSecrets();

  const base = useMemo(() => configToForm(saved.server_config, EMPTY_CONNECTION), [saved]);
  const [name, setName] = useState(saved.name);
  const [form, setForm] = useState<ConnectionForm>(base);
  const [raw, setRaw] = useState<RawDraft | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; url?: string; command?: string }>({});
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [turningOn, setTurningOn] = useState(false);

  const nameChanged = name.trim() !== saved.name;
  const configChanged = configKey(formToConfig(form)) !== configKey(formToConfig(base));
  const dirty = nameChanged || configChanged || Boolean(raw?.error);
  const guard = useLeaveGuard(dirty, saved.name);

  // Before the secrets load, a ref the tool already had is "set" unless the server said missing.
  const stored = useMemo(() => {
    if (secrets) return new Set(secrets.secrets.map((s) => s.name));
    return new Set(saved.secret_refs.filter((n) => !saved.missing_secrets.includes(n)));
  }, [secrets, saved]);
  const options = useMemo(() => (secrets ? secretOptions(secrets) : []), [secrets]);

  const discard = () => {
    setName(saved.name);
    setForm(base);
    setRaw(null);
    setErrors({});
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dirty || saving) return;
    if (raw?.error) {
      setRawOpen(true);
      return;
    }
    const nameError = nameChanged ? toolNameError(name, []) : null;
    const connError = connectionError(form);
    if (nameError || connError) {
      setErrors({
        name: nameError ?? undefined,
        url: form.transport === "remote" ? (connError ?? undefined) : undefined,
        command: form.transport === "local" ? (connError ?? undefined) : undefined,
      });
      return;
    }
    const body: { name?: string; server_config?: ServerConfig } = {};
    if (nameChanged) body.name = name.trim();
    if (configChanged) body.server_config = formToConfig(form);
    setSaving(true);
    setErrors({});
    try {
      const next = await patchTool(saved.id, body);
      setRaw(null);
      onSaved({ ...next, used_by_agents: saved.used_by_agents });
      void refreshBadges();
      toast({ message: savedToast(next.used_by.agent_count) });
    } catch (err) {
      const message = clientError(err);
      const aboutName =
        err instanceof ApiDetailError &&
        (err.status === 409 || (message !== null && message === TOOL_NAME_RULE));
      if (aboutName && message) setErrors({ name: message });
      else toast({ message: message ?? `Couldn’t save ${saved.name}. Try again.`, tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    setCopying(true);
    try {
      const copy = await duplicateTool(saved.id);
      markToolFresh(copy.id);
      void refreshBadges();
      toast({
        message: `Copied as ${copy.name}. Rename it in its settings.`,
        action: { label: "Open", onClick: () => navigate({ page: "tool", toolId: copy.id }) },
      });
    } catch (err) {
      toast({
        message: clientError(err) ?? `Couldn’t copy ${saved.name}. Try again.`,
        tone: "error",
      });
    } finally {
      setCopying(false);
    }
  };

  const onRemoved = () => {
    setRemoving(false);
    void refreshBadges();
    toast({ message: `${saved.name} removed from Toolkit.` });
    // The tool is gone and its edits with it: not a leave to ask about.
    guard.release();
    navigate(LIST, { replace: true });
  };

  // Not used yet → "Turn on for agents…": the checked set becomes who uses it (spec Q4).
  const turnOn = async (nodeIds: string[]) => {
    const result = await setToolAgents(saved.id, nodeIds);
    setTurningOn(false);
    toast({ message: turnedOnToast(saved.name, result.agent_count, result.skipped.length) });
    void refreshBadges();
    try {
      const next = await getTool(saved.id);
      onSaved(next);
    } catch {
      // The toast already says who has it; the card catches up on the next visit.
    }
  };

  const transport = transportOf(saved.server_config);
  const agents = saved.used_by_agents;

  return (
    <>
      <div className="tk-dhead">
        <span className="tk-dhead__tile" aria-hidden="true">
          <ToolGlyph tool={saved} size={22} />
        </span>
        <div className="tk-dhead__id">
          <h1 className="tk-dhead__name">{saved.name}</h1>
          <div className="tk-dhead__meta">
            {transport && (
              <Badge
                variant="outline"
                title={transport === "local" ? "Runs in the agent’s sandbox" : undefined}
              >
                {transport === "local" ? "Local" : "Remote"}
              </Badge>
            )}
            {saved.status === "ready" ? (
              <span className="tk-ready">
                <span className="tk-ready__dot" aria-hidden="true" />
                Ready
              </span>
            ) : (
              <span className="tk-needs__label">
                <TriangleAlert size={13} strokeWidth={1.6} aria-hidden />
                {needsLabel(saved)}
              </span>
            )}
          </div>
        </div>
        <div className="tk-dhead__actions">
          <Button variant="secondary" onClick={() => void duplicate()} loading={copying}>
            Duplicate
          </Button>
          {dirty && (
            <>
              <span className="tk-unsaved">
                <span className="tk-unsaved__dot" aria-hidden="true" />
                Unsaved
              </span>
              <Button variant="ghost" onClick={discard} disabled={saving}>
                Discard
              </Button>
            </>
          )}
          <Button variant="primary" type="submit" form={formId} disabled={!dirty} loading={saving}>
            Save changes
          </Button>
        </div>
      </div>

      <div className="tk-dgrid">
        <div className="tk-dcol">
          <section className="tk-card" aria-labelledby={`${formId}-conn`}>
            <form
              id={formId}
              className="tk-dcard tk-dconn"
              onSubmit={(e) => void save(e)}
              noValidate
            >
              <div className="tk-dcard__head">
                <h2 id={`${formId}-conn`} className="tk-dcard__label">
                  Connection
                </h2>
              </div>
              <Input
                label="Name"
                autoComplete="off"
                spellCheck={false}
                value={name}
                error={errors.name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
              />
              <ConnectionFields
                variant="page"
                form={form}
                onChange={(next) => {
                  setForm(next);
                  if (errors.url || errors.command) setErrors({ name: errors.name });
                }}
                raw={raw}
                onRawChange={setRaw}
                rawOpen={rawOpen}
                onRawToggle={() => setRawOpen((o) => !o)}
                errors={{ url: errors.url, command: errors.command }}
                options={options}
                stored={stored}
                suggestion={suggestedSecret(saved.name)}
              />
            </form>
          </section>

          <section className="tk-card" aria-labelledby={`${formId}-remove`}>
            <div className="tk-dremove">
              <div>
                <h2 id={`${formId}-remove`} className="tk-dremove__title">
                  Remove from Toolkit
                </h2>
                <p className="tk-dremove__line">{removeCardLine(agents.length)}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </div>
          </section>
        </div>

        <section className="tk-card" aria-labelledby={`${formId}-used`}>
          <div className="tk-dcard">
            <div className="tk-dcard__head">
              <h2 id={`${formId}-used`} className="tk-dcard__label">
                {usedByTitle(agents)}
              </h2>
            </div>
            {agents.length > 0 ? (
              <>
                <ul className="tk-usedlist">
                  {agents.map((a) => {
                    const Glyph = glyphForNode("agent", a.role_name);
                    return (
                      <li key={`${a.team_id}/${a.node_id}`} className="tk-usedlist__row">
                        <span className="tk-usedlist__icon">
                          <Glyph size={15} strokeWidth={1.6} aria-hidden />
                        </span>
                        <div className="tk-usedlist__who">
                          <div className="tk-usedlist__name">{agentName(a)}</div>
                          <div className="tk-usedlist__team">{a.team_name}</div>
                        </div>
                        <a
                          className="tk-usedlist__open"
                          href={routeToHash({
                            page: "team",
                            teamId: a.team_id,
                            node: a.node_id,
                            tab: "skills",
                          })}
                        >
                          Open
                        </a>
                      </li>
                    );
                  })}
                </ul>
                <p className="tk-usedlist__foot">
                  Edits here reach every agent above on its next run.
                </p>
              </>
            ) : (
              <div className="tk-usedlist__none">
                <p className="tk-usedlist__empty">
                  Turn it on for an agent in its Skills &amp; tools tab.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setTurningOn(true)}>
                  Turn on for agents…
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {removing && (
        <RemoveToolDialog
          tool={saved}
          agents={agents}
          onClose={() => setRemoving(false)}
          onRemoved={onRemoved}
        />
      )}
      {turningOn && (
        <TurnOnForAgentsDialog
          toolName={saved.name}
          toolId={saved.id}
          onClose={() => setTurningOn(false)}
          onConfirm={(ids) => turnOn(ids)}
        />
      )}
      <ConfirmDialog
        open={guard.pending !== null}
        title="Leave without saving?"
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      >
        Your changes to {saved.name} aren’t saved. If you leave now, they’re lost.
      </ConfirmDialog>
    </>
  );
}
