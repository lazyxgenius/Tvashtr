import { useEffect, useRef, useState } from "react";

import { LastRun } from "../components/LastRun";
import {
  addProvider,
  type GateConfig,
  type GraphEdge,
  listProviders,
  presetsForProvider,
  type ProviderCredential,
  providerOf,
  type TeamGraphNode,
  type TerminalConfig,
  updateGateNode,
  updateTeamNode,
} from "../lib/api";
import { applyEmitContract, emitContract } from "../lib/topology";
import { DrawerShell, type PanelMode } from "./DrawerShell";
import { glyphForNode } from "./nodeGlyph";
import { SkillsSection } from "./SkillsSection";
import { ToolsSection } from "./ToolsSection";

// The sentinel Provider-select value that reveals the inline "add a provider" form.
const ADD_PROVIDER = "__add_provider__";

// Friendly titles for the seeded template roles; any other role falls back to its raw name.
const ROLE_TITLES: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

// M-unify U3: a node's ONE capability distinction is `edits_allowed` (may it write files?). Seed the
// toggle from the node's own value, falling back to the backend's kind-mapped default (agent ⇒ on)
// for any node/fixture that predates the field. (Gate/terminal nodes route to the read-only branches
// below, never here.)
const editsAllowedOf = (node: TeamGraphNode | null): boolean =>
  node?.edits_allowed ?? node?.kind === "agent";

const START_LOCK_TOOLTIP =
  "The first node scopes the work — it writes the shared spec the team reads, so it stays edits-off.";

const AGENT_SUBTITLE = "Its prompt is its whole identity — edit, then run";

/**
 * The team-authoring config drawer (F1c reskin of P1.8b/c): the premium right drawer shown when a
 * node is selected on the persistent team canvas. It branches on `node.kind`:
 *  - **agent / completion** — the editor: an Edits (allowed/not) toggle, the **prompt** (the node's whole
 *    identity), a branch-worker Output-contract block, the Slice-C provider/model picker (now the
 *    design's 130px-provider + flex-1-model row), a dirty-aware Save (PATCHes the node-update
 *    endpoint), and a read-only "Last run" brief.
 *  - **gate** (F1c Decision 4) — a READ-ONLY checkpoint view (its title + description from
 *    `node.config`, no Save): the node-update endpoint 409-rejects control primitives, so editing
 *    gate copy is a backend follow-on (§15).
 *  - **terminal** (F1c Decision 4) — a READ-ONLY endpoint view (its Ship/Stop state, a DISABLED
 *    indicator — persisting ship↔stop is a backend follow-on; to switch it, delete + re-drop).
 *
 * The drawer⇄modal chrome + the sticky `panelMode` live in the shared `DrawerShell`. The node
 * card's model chip (author mode) opens this drawer with `focusModel` bumped, scrolling the Model
 * field into view + flashing it. Reset-on-select is the parent `key={selectedNodeId}` remount.
 */
export function TeamNodePanel({
  teamId,
  node,
  edges = [],
  nodes = [],
  isStartNode,
  panelMode = "drawer",
  onTogglePanelMode,
  focusModel = 0,
  onSaved,
  onClose,
}: {
  teamId: string;
  node: TeamGraphNode | null;
  edges?: GraphEdge[];
  nodes?: TeamGraphNode[];
  isStartNode: boolean;
  panelMode?: PanelMode;
  onTogglePanelMode?: () => void;
  focusModel?: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(node?.prompt ?? "");
  const [model, setModel] = useState(node?.model ?? "");
  // M-accounts Slice C: the per-node model picker is provider-gated by the account's configured
  // providers. The panel remounts per node (parent `key`), so a local fetch-on-mount is self-contained.
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addProviderSlug, setAddProviderSlug] = useState("");
  const [addKey, setAddKey] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);

  // M-unify U3: the node's ONE capability distinction — may it write files? — is authorable via the
  // Edits toggle. Seed from `edits_allowed`; reset-on-select is the parent `key` remount.
  const initialEditsAllowed = editsAllowedOf(node);
  const [editsAllowed, setEditsAllowed] = useState<boolean>(initialEditsAllowed);
  // M-tools C7.0: the node's inline tools + skills (stub editors). Seeded from the node, reset via the
  // `key` remount, folded into the dirty check, and posted on Save. NULL until a later milestone.
  const [toolConfig, setToolConfig] = useState<Record<string, unknown> | null>(
    node?.tool_config ?? null,
  );
  const [skills, setSkills] = useState<unknown[] | null>(node?.skills ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  // M-rails C8: a GATE's editable config (its type + human copy). Seeded from `node.config`; the
  // parent `key`-remount resets it per node. Unused/harmless for agent/completion/terminal nodes.
  const gateCfg = (node?.config ?? {}) as GateConfig;
  const initialGateKind = gateCfg.gate_kind || "gate_approval";
  const initialGateTitle = gateCfg.title ?? "";
  const initialGateDesc = gateCfg.description ?? "";
  const initialGateGuardrail = initialGateKind === "secret_leak_scan";
  const [gateGuardrail, setGateGuardrail] = useState(initialGateGuardrail);
  const [gateTitle, setGateTitle] = useState(initialGateTitle);
  const [gateDesc, setGateDesc] = useState(initialGateDesc);

  // F1c: the model-chip express lane — a focus signal from the parent (a bumping nonce; 0 = a normal
  // open). On a bump, scroll the Model field into view + flash a transient coral ring.
  const modelFieldRef = useRef<HTMLDivElement>(null);
  const [modelFlash, setModelFlash] = useState(false);

  const isAgent = node?.kind === "agent" || node?.kind === "completion";

  useEffect(() => {
    // Only the agent/completion editor has a provider picker — skip the fetch for gate/terminal.
    if (!isAgent) return;
    let cancelled = false;
    listProviders()
      .then((p) => {
        if (!cancelled) setProviders(Array.isArray(p) ? p : []);
      })
      .catch(() => {
        /* providers stay empty → the picker still works on the node's own provider */
      });
    return () => {
      cancelled = true;
    };
  }, [isAgent]);

  useEffect(() => {
    // 0 = a normal open (node-card body / selection): clear any lingering flash so the class toggles
    // off — a later chip click (nonce bump) then re-adds it and the highlight animation replays.
    if (!focusModel) {
      setModelFlash(false);
      return;
    }
    const el = modelFieldRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setModelFlash(true);
    const t = setTimeout(() => setModelFlash(false), 1300);
    return () => clearTimeout(t);
  }, [focusModel]);

  // P1.8d anti-drift: a branch worker (a worker with verdict-labelled out-edges) shows the
  // emit-contract derived LIVE from its edges, plus a one-click "write into the prompt".
  const contract = node && node.kind === "agent" ? emitContract(node.id, edges) : null;
  const writeContract = () => {
    if (!contract) return;
    setPrompt((p) => applyEmitContract(p, contract.promptBlock));
    setSaved(false);
  };

  // Flipping the capability alone enables Save (it's an authorable field like prompt/model).
  const dirty =
    node !== null &&
    (prompt !== (node.prompt ?? "") ||
      model !== (node.model ?? "") ||
      editsAllowed !== initialEditsAllowed ||
      // M-tools C7.0: compare the JSON of the inline tools/skills (structural equality) so editing
      // them enables Save exactly like prompt/model/capability.
      JSON.stringify(toolConfig ?? null) !== JSON.stringify(node.tool_config ?? null) ||
      JSON.stringify(skills ?? null) !== JSON.stringify(node.skills ?? null));
  const canSave = dirty && !saving && prompt.trim().length > 0 && model.trim().length > 0;

  const pickEdits = (next: boolean) => {
    if (isStartNode) return; // the entry node is locked edits-off — it writes the shared spec, never edits
    setEditsAllowed(next);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!node || !canSave) return;
    setSaving(true);
    setSaveError(false);
    try {
      // M-unify U3: the Edits toggle is the source of truth; `capability` is no longer authored here
      // (kind is vestigial under loop-always), so pass it undefined and drive `edits_allowed` instead.
      await updateTeamNode(
        teamId,
        node.id,
        prompt,
        model,
        undefined,
        toolConfig,
        skills,
        editsAllowed,
      );
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  // M-rails C8: the gate config Save. Flipping to the guardrail sends `secret_leak_scan`; staying
  // human PRESERVES the original human sub-kind (prd_approval/…) — flipping guardrail→human falls
  // back to the generic `gate_approval` (a human sub-kind can't be re-derived once switched away).
  const savedGateKind = gateGuardrail
    ? "secret_leak_scan"
    : initialGateGuardrail
      ? "gate_approval"
      : initialGateKind;
  const gateDirty =
    node !== null &&
    (gateGuardrail !== initialGateGuardrail ||
      gateTitle !== initialGateTitle ||
      gateDesc !== initialGateDesc);
  const handleGateSave = async () => {
    if (!node || !gateDirty) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateGateNode(teamId, node.id, savedGateKind, gateTitle, gateDesc);
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  // ---- M-accounts Slice C: the provider-gated model picker (UI over the SINGLE node.model string) ----
  const currentProvider = model.trim() ? providerOf(model) : "";
  const providerOptions = Array.from(
    new Set([...providers.map((p) => p.provider), ...(currentProvider ? [currentProvider] : [])]),
  ).sort();
  const quickPicks = presetsForProvider(currentProvider);

  const onProviderChange = (value: string) => {
    if (value === ADD_PROVIDER) {
      setAddOpen(true);
      return;
    }
    // Rewrite the leading segment: jump to that provider's first quick-pick, else a bare prefix.
    setModel(presetsForProvider(value)[0] ?? `${value}/`);
    setSaved(false);
  };

  const handleInlineAdd = async () => {
    const slug = providerOf(addProviderSlug);
    const key = addKey.trim();
    if (!slug || !key) {
      setAddError("Enter a provider and an API key.");
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      await addProvider(slug, key); // the SAME endpoint + table the dashboard uses
      const refreshed = await listProviders();
      setProviders(refreshed);
      onProviderChange(slug); // select the just-added provider
      setAddOpen(false);
      setAddProviderSlug("");
      setAddKey("");
    } catch {
      setAddError("Couldn’t save that key — is the backend running?");
    } finally {
      setAddBusy(false);
    }
  };

  // ---- The per-node recommendation hint (registry-free same-model detection; never blocks Save) ----
  const connectedWorkerIds = new Set<string>();
  if (node && node.kind === "agent" && contract) {
    for (const e of edges) {
      if (e.target_node_id === node.id) connectedWorkerIds.add(e.source_node_id);
      if (e.source_node_id === node.id) connectedWorkerIds.add(e.target_node_id);
    }
  }
  const sameModelSibling =
    node && node.kind === "agent" && contract && model.trim()
      ? (nodes.find(
          (n) =>
            n.id !== node.id &&
            n.kind === "agent" &&
            connectedWorkerIds.has(n.id) &&
            (n.model ?? "") === model,
        ) ?? null)
      : null;
  const showHint = sameModelSibling !== null && !hintDismissed;
  const siblingTitle = sameModelSibling
    ? (ROLE_TITLES[sameModelSibling.role_name] ?? sameModelSibling.role_name)
    : "";

  // ---- Empty selection: nothing editable ----
  if (!node) {
    return (
      <DrawerShell
        glyph={glyphForNode("agent", "")}
        title="Node"
        subtitle="Nothing selected"
        ariaLabel="Node"
        panelMode={panelMode}
        onTogglePanelMode={onTogglePanelMode}
        onClose={onClose}
      >
        <div className="tv-scroll">
          <p className="tv-panel-note">This node isn’t editable.</p>
        </div>
      </DrawerShell>
    );
  }

  // ---- M-rails C8: gate — an EDITABLE checkpoint. A "Gate type" picker chooses a human approval
  //      or the automatic `secret_leak_scan` guardrail; plus title/description + a dirty-aware Save
  //      (the node-update endpoint now PATCHes gate config). ----
  if (node.kind === "gate") {
    const gateHeaderTitle = gateTitle || ROLE_TITLES[node.role_name] || node.role_name;
    return (
      <DrawerShell
        glyph={glyphForNode("gate", node.role_name)}
        title={gateHeaderTitle}
        subtitle={gateGuardrail ? "An automatic guardrail" : "A human checkpoint"}
        ariaLabel={`${gateHeaderTitle} checkpoint`}
        panelMode={panelMode}
        onTogglePanelMode={onTogglePanelMode}
        onClose={onClose}
      >
        <div className="tv-scroll tv-node-edit">
          <div className="tv-field">
            <span className="tv-field__label">Gate type</span>
            <div className="tv-seg" role="group" aria-label="Gate type">
              <button
                type="button"
                aria-pressed={!gateGuardrail}
                disabled={saving}
                className={`tv-seg__btn${!gateGuardrail ? " tv-seg__btn--active" : ""}`}
                onClick={() => {
                  setGateGuardrail(false);
                  setSaved(false);
                }}
              >
                Human approval
              </button>
              <button
                type="button"
                aria-pressed={gateGuardrail}
                disabled={saving}
                className={`tv-seg__btn${gateGuardrail ? " tv-seg__btn--active" : ""}`}
                onClick={() => {
                  setGateGuardrail(true);
                  setSaved(false);
                }}
              >
                Secret leak scan
              </button>
            </div>
            <span className="tv-field__hint">
              {gateGuardrail
                ? "Secret leak scan — an automatic check. It scans the run’s workspace and emits approved / rejected with no human pause."
                : "Human approval — the run pauses here for a person to approve or reject."}
            </span>
          </div>

          <label className="tv-field">
            <span className="tv-field__label">Title</span>
            <input
              className="tv-node-model"
              aria-label="Gate title"
              value={gateTitle}
              spellCheck={false}
              onChange={(e) => {
                setGateTitle(e.target.value);
                setSaved(false);
              }}
            />
          </label>

          <label className="tv-field">
            <span className="tv-field__label">Description</span>
            <textarea
              className="tv-node-prompt"
              aria-label="Gate description"
              value={gateDesc}
              rows={5}
              spellCheck={false}
              onChange={(e) => {
                setGateDesc(e.target.value);
                setSaved(false);
              }}
            />
          </label>

          <div className="tv-prd__editbar">
            <button
              className="tv-btn"
              type="button"
              onClick={() => void handleGateSave()}
              disabled={!gateDirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {gateDirty ? (
              <span className="tv-prd__dirty">Unsaved changes</span>
            ) : saved ? (
              <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
            ) : null}
            {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
          </div>
        </div>
      </DrawerShell>
    );
  }

  // ---- F1c Decision 4: terminal — READ-ONLY endpoint view. Ship/Stop is a DISABLED indicator, not
  //      a working toggle (persisting ship↔stop is a §15 backend follow-on). ----
  if (node.kind === "terminal") {
    const isShip = (node.config as TerminalConfig)?.terminal_kind === "ship";
    const termTitle = isShip ? "Ship" : "Stop";
    return (
      <DrawerShell
        glyph={glyphForNode("terminal", node.role_name, isShip ? "ship" : "stop")}
        title={termTitle}
        subtitle="An endpoint of the flow"
        ariaLabel={`${termTitle} endpoint`}
        panelMode={panelMode}
        onTogglePanelMode={onTogglePanelMode}
        onClose={onClose}
      >
        <div className="tv-scroll tv-node-edit">
          <p className="tv-readonly-note">
            This is where the flow ends.{" "}
            <span className="tv-readonly-note__soft">
              Changing ship ↔ stop is a planned backend follow-on — to switch it, delete this
              endpoint and drop the other from the palette.
            </span>
          </p>
          <div className="tv-field">
            <span className="tv-field__label">Endpoint</span>
            <div className="tv-seg" role="group" aria-label="Endpoint" aria-disabled="true">
              <button
                type="button"
                disabled
                aria-pressed={isShip}
                className={`tv-seg__btn${isShip ? " tv-seg__btn--active" : ""}`}
              >
                Ship it
              </button>
              <button
                type="button"
                disabled
                aria-pressed={!isShip}
                className={`tv-seg__btn${!isShip ? " tv-seg__btn--active" : ""}`}
              >
                Stop
              </button>
            </div>
            <span className="tv-field__hint">
              {isShip
                ? "Ship — open a reviewed change on a branch and tag it."
                : "Stop — end the run here with no change shipped."}
            </span>
          </div>
        </div>
      </DrawerShell>
    );
  }

  // ---- agent / completion: the editor ----
  const title = ROLE_TITLES[node.role_name] ?? node.role_name;
  return (
    <DrawerShell
      glyph={glyphForNode(node.kind, node.role_name)}
      title={title}
      subtitle={AGENT_SUBTITLE}
      ariaLabel={`${title} editor`}
      panelMode={panelMode}
      onTogglePanelMode={onTogglePanelMode}
      onClose={onClose}
    >
      <div className="tv-scroll tv-node-edit">
        <div className="tv-field">
          <span className="tv-field__label">Edits</span>
          <div
            className="tv-seg"
            role="group"
            aria-label="Edits"
            title={isStartNode ? START_LOCK_TOOLTIP : undefined}
          >
            <button
              type="button"
              aria-pressed={editsAllowed}
              disabled={isStartNode || saving}
              className={`tv-seg__btn${editsAllowed ? " tv-seg__btn--active" : ""}`}
              onClick={() => pickEdits(true)}
              title={isStartNode ? START_LOCK_TOOLTIP : undefined}
            >
              Edits allowed
            </button>
            <button
              type="button"
              aria-pressed={!editsAllowed}
              disabled={isStartNode || saving}
              className={`tv-seg__btn${!editsAllowed ? " tv-seg__btn--active" : ""}`}
              onClick={() => pickEdits(false)}
              title={isStartNode ? START_LOCK_TOOLTIP : undefined}
            >
              Not allowed
            </button>
          </div>
          <span className="tv-field__hint">
            {isStartNode
              ? START_LOCK_TOOLTIP
              : editsAllowed
                ? "Edits allowed — this node runs the full agent loop and can write & change files in its sandbox."
                : "Not allowed — the same full agent loop, but read-only (reasoning + read-only & MCP tools); only its report leaves the sandbox."}
          </span>
        </div>

        <label className="tv-field">
          <span className="tv-field__label">System prompt</span>
          <span className="tv-field__hint">
            Its whole identity. The run appends the idea and the live PRD on top.
          </span>
          <textarea
            className="tv-node-prompt"
            value={prompt}
            rows={14}
            spellCheck={false}
            onChange={(e) => {
              setPrompt(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        {contract && (
          <div className="tv-contract">
            <span className="tv-field__label">Output contract</span>
            <p className="tv-contract__summary">{contract.summary}</p>
            <button type="button" className="tv-btn tv-btn--sm" onClick={writeContract}>
              Write this into the prompt
            </button>
            <span className="tv-field__hint">
              Keeps the prompt’s verdict-file instruction in sync with the edges you wired.
            </span>
          </div>
        )}

        <div className={`tv-field${modelFlash ? " tv-field--flash" : ""}`} ref={modelFieldRef}>
          <span className="tv-field__label">Model</span>
          <span className="tv-field__hint">
            Pick a provider you’ve configured, then a model — add a key inline if it’s missing.
          </span>

          <div className="tv-modelrow">
            <select
              className="tv-modelrow__provider"
              aria-label="Provider"
              value={currentProvider}
              onChange={(e) => onProviderChange(e.target.value)}
            >
              {currentProvider === "" && <option value="">Choose a provider…</option>}
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={ADD_PROVIDER}>+ Add a provider…</option>
            </select>

            <input
              className="tv-node-model tv-modelrow__model"
              type="text"
              list="tv-model-presets"
              aria-label="Model"
              value={model}
              spellCheck={false}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
            />
            <datalist id="tv-model-presets">
              {quickPicks.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          {addOpen && (
            <div className="tv-node-addprov">
              <input
                className="tv-launch__input"
                aria-label="New provider"
                placeholder="provider (e.g. openrouter)"
                value={addProviderSlug}
                onChange={(e) => setAddProviderSlug(e.target.value)}
              />
              <input
                className="tv-launch__input"
                type="password"
                aria-label="New provider API key"
                placeholder="paste API key"
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
              />
              <div className="tv-node-addprov__actions">
                <button
                  type="button"
                  className="tv-btn tv-btn--sm"
                  disabled={addBusy}
                  onClick={() => void handleInlineAdd()}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="tv-btn tv-btn--link tv-btn--sm"
                  onClick={() => {
                    setAddOpen(false);
                    setAddError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {addError && <span className="tv-prd__saveerr">{addError}</span>}
            </div>
          )}

          {showHint && (
            <div className="tv-node-hint" role="status">
              <span className="tv-node-hint__text">
                {title} and {siblingTitle} both run <code>{model}</code>. Reviews are stronger when
                the reviewer runs a more capable model than the worker it checks.
              </span>
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                onClick={() => setHintDismissed(true)}
                aria-label="Dismiss recommendation"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* M-tools C7.0: inline Skills (thinker + worker) + Tools (worker-only editor / thinker
            note) stub sections. Between the Model field and the Save bar; part of the Save wire. */}
        <SkillsSection
          value={skills}
          onChange={(v) => {
            setSkills(v);
            setSaved(false);
          }}
        />
        <ToolsSection
          value={toolConfig}
          onChange={(v) => {
            setToolConfig(v);
            setSaved(false);
          }}
        />

        <div className="tv-prd__editbar">
          <button
            className="tv-btn"
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty ? (
            <span className="tv-prd__dirty">Unsaved changes</span>
          ) : saved ? (
            <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
          ) : null}
          {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
        </div>

        {/* M2: read-only "Last run" brief of what THIS authored node did the last time it actually
            executed (across the team's runs). Historical -> NOT part of the dirty check. */}
        <div className="tv-node-lastrun" aria-label="Last run">
          <div className="tv-lastrun__head">Last run</div>
          {node.last_run ? (
            <LastRun
              rounds={[
                {
                  iteration: node.last_run.iteration,
                  outcome: node.last_run.outcome,
                  outcome_detail: node.last_run.outcome_detail,
                },
              ]}
              provenance={{ startedAt: node.last_run.started_at, runId: node.last_run.run_id }}
            />
          ) : (
            <p className="tv-panel-note">No runs yet.</p>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}
