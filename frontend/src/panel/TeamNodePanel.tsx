import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { LastRun } from "../components/LastRun";
import {
  addProvider,
  type Capability,
  type GraphEdge,
  listProviders,
  presetsForProvider,
  type ProviderCredential,
  providerOf,
  type TeamGraphNode,
  updateTeamNode,
} from "../lib/api";
import { applyEmitContract, emitContract } from "../lib/topology";

// The sentinel Provider-select value that reveals the inline "add a provider" form.
const ADD_PROVIDER = "__add_provider__";

// Friendly titles for the seeded template roles; any other role falls back to its raw name.
const ROLE_TITLES: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

// A node's capability rides the `kind` column: a `completion` node is a thinker, an `agent` is a
// worker. (Gate/terminal nodes never reach this panel — the canvas only opens it for agent/completion.)
const capabilityOf = (node: TeamGraphNode | null): Capability =>
  node?.kind === "completion" ? "thinker" : "worker";

const START_LOCK_TOOLTIP =
  "The first node scopes the work — it writes the spec the rest of the team reads.";

/**
 * The team-authoring editor (P1.8b): the right-hand panel shown when an **agent** node
 * (`completion`/`agent`) is selected on the persistent team canvas. It edits the node's two
 * authorable fields — its **prompt** (the node's whole identity in the prompt-driven model) and
 * its **model** (free text, with a tiny set of proven presets as datalist quick-picks). Save is
 * explicit and **dirty-aware** (no autosave): it PATCHes the node-update endpoint, then asks the
 * parent to refetch the team. Gate/terminal nodes never reach this panel (the canvas only opens it
 * for agent/completion nodes), so there is no editable surface for the control primitives.
 *
 * Reset-on-select is handled by a `key` on the parent mount (keyed on the selected role, which is
 * unique per node in the seeded team): selecting a different node remounts with fresh state, while
 * a post-save refetch of the SAME node keeps the local edits + the "Saved" note (the values now
 * match, so the panel reads clean).
 */
export function TeamNodePanel({
  teamId,
  node,
  edges = [],
  nodes = [],
  isStartNode,
  onSaved,
  onClose,
}: {
  teamId: string;
  node: TeamGraphNode | null;
  edges?: GraphEdge[];
  nodes?: TeamGraphNode[];
  isStartNode: boolean;
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

  useEffect(() => {
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
  }, []);
  // P1.8c: the node's capability (thinker = completion / worker = agent) is now authorable. Seed it
  // from the node's kind; reset-on-select is the parent `key={selectedRole}` remount.
  const initialCapability = capabilityOf(node);
  const [capability, setCapability] = useState<Capability>(initialCapability);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  const title = node ? (ROLE_TITLES[node.role_name] ?? node.role_name) : "Node";

  // P1.8d anti-drift: a branch worker (a worker with verdict-labelled out-edges) shows the
  // emit-contract derived LIVE from its edges, plus a one-click "write into the prompt" so the
  // prompt's verdict-file instruction can never silently fall out of sync with the wiring.
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
      capability !== initialCapability);
  const canSave = dirty && !saving && prompt.trim().length > 0 && model.trim().length > 0;

  const pickCapability = (next: Capability) => {
    if (isStartNode) return; // the start node is locked to "thinker" (the backend 409 is the real guard)
    setCapability(next);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!node || !canSave) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateTeamNode(teamId, node.id, prompt, model, capability);
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
  // The select offers the account's configured providers, plus the node's CURRENT provider even if
  // unconfigured (so the select reflects the actual model), plus the inline-add affordance.
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
  // A GATING worker = an agent node with a verdict/branch contract (a reviewer). The workers it
  // reviews / sends rework to are the OTHER endpoints of edges touching it (the review edge in, the
  // loop-back out). Compared against the LIVE edited `model`, so the hint clears the moment they differ.
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

  return (
    <aside className="tv-panel" aria-label={`${title} editor`}>
      <header className="tv-panel__head">
        <div>
          <div className="tv-panel__title">{title}</div>
          <div className="tv-panel__subtitle">
            Its prompt is its whole identity — edit, then run
          </div>
        </div>
        <button
          type="button"
          className="tv-panel__close"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
        >
          <X size={18} strokeWidth={1.7} />
        </button>
      </header>

      <div className="tv-panel__body">
        {!node ? (
          <div className="tv-scroll">
            <p className="tv-panel-note">This node isn’t editable.</p>
          </div>
        ) : (
          <div className="tv-scroll tv-node-edit">
            <div className="tv-field">
              <span className="tv-field__label">Capability</span>
              <div
                className="tv-seg"
                role="group"
                aria-label="Capability"
                title={isStartNode ? START_LOCK_TOOLTIP : undefined}
              >
                <button
                  type="button"
                  aria-pressed={capability === "thinker"}
                  disabled={isStartNode || saving}
                  className={`tv-seg__btn${capability === "thinker" ? " tv-seg__btn--active" : ""}`}
                  onClick={() => pickCapability("thinker")}
                  title={isStartNode ? START_LOCK_TOOLTIP : undefined}
                >
                  Thinker
                </button>
                <button
                  type="button"
                  aria-pressed={capability === "worker"}
                  disabled={isStartNode || saving}
                  className={`tv-seg__btn${capability === "worker" ? " tv-seg__btn--active" : ""}`}
                  onClick={() => pickCapability("worker")}
                  title={isStartNode ? START_LOCK_TOOLTIP : undefined}
                >
                  Worker
                </button>
              </div>
              <span className="tv-field__hint">
                {isStartNode
                  ? START_LOCK_TOOLTIP
                  : capability === "thinker"
                    ? "Thinker — one direct LLM call; writes the shared spec."
                    : "Worker — runs in a sandbox; can read & write files."}
              </span>
            </div>

            <label className="tv-field">
              <span className="tv-field__label">Prompt</span>
              <span className="tv-field__hint">
                The agent’s behavior. The run appends the idea + the live PRD on top of this.
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

            <div className="tv-field">
              <span className="tv-field__label">Model</span>
              <span className="tv-field__hint">
                Pick a provider you’ve configured, then a model — add a key inline if it’s missing.
              </span>

              <select
                className="tv-launch__select"
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

              <input
                className="tv-node-model"
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

              {showHint && (
                <div className="tv-node-hint" role="status">
                  <span className="tv-node-hint__text">
                    {title} and {siblingTitle} both run <code>{model}</code>. Reviews are stronger
                    when the reviewer runs a more capable model than the worker it checks.
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

            {/* M2: read-only "Last run" brief of what THIS authored node did the last time it
                actually executed (across the team's runs). Historical -> NOT part of the dirty
                check, untouched by Save. */}
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
        )}
      </div>
    </aside>
  );
}
