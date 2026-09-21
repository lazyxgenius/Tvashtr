import { useEffect, useRef, useState } from "react";

import { LastRun } from "../components/LastRun";
import {
  addProvider,
  type DomainQueryConfig,
  type DomainSummary,
  type GateConfig,
  type GraphEdge,
  listDomains,
  listProviders,
  listSubscriptionStatuses,
  defaultForProvider,
  presetsForProvider,
  type ProviderCredential,
  providerOf,
  type Capability,
  type TeamGraphNode,
  type TerminalConfig,
  updateDomainQueryNode,
  updateGateNode,
  updateTeamNode,
  updateTerminalNode,
} from "../lib/api";
import {
  credentialTreatment,
  subscriptionProviderForModel,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "../lib/engines";
import { applyEmitContract, emitContract } from "../lib/topology";
import { DrawerShell, type PanelMode } from "./DrawerShell";
import { glyphForNode } from "./nodeGlyph";
import { NodeMemorySection } from "./NodeMemorySection";
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

// M-rails C8/C9: the gate_kinds that run a DETERMINISTIC guardrail check (vs the human-approval
// path). Mirrors the backend GUARDRAIL_GATE_KINDS frozenset.
const GUARDRAIL_GATE_KINDS = new Set([
  "secret_leak_scan",
  "diff_touches_forbidden_paths",
  "output_schema_check",
]);

// M-unify U3: a node's ONE capability distinction is `edits_allowed` (may it write files?). Seed the
// toggle from the node's own value, falling back to the backend's kind-mapped default (agent ⇒ on)
// for any node/fixture that predates the field. (Gate/terminal nodes route to the read-only branches
// below, never here.)
const editsAllowedOf = (node: TeamGraphNode | null): boolean =>
  node?.edits_allowed ?? node?.kind === "agent";

// M-memory: the per-node "Remember what I learn" decision, read off the node's config JSONB (the
// backend stores + echoes it under `config`). Default false. A safe cast since `config` is a union
// (GateConfig | TerminalConfig | Record) shared with the gate/terminal branches.
const rememberEnabledOf = (node: TeamGraphNode | null): boolean =>
  Boolean((node?.config as Record<string, unknown> | null | undefined)?.memory_remember_enabled);

// M-docs: per-node document routing read off the node's config JSONB. `writes_to` = the ONE document
// name the node authors (default ""); `reads_from` = the list of names whose documents feed its
// context. Safe casts (config is the shared union). Empty by default — a node with neither behaves
// exactly as today.
const writesToOf = (node: TeamGraphNode | null): string => {
  const raw = (node?.config as Record<string, unknown> | null | undefined)?.writes_to;
  return typeof raw === "string" ? raw : "";
};
const readsFromOf = (node: TeamGraphNode | null): string[] => {
  const raw = (node?.config as Record<string, unknown> | null | undefined)?.reads_from;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
};

// Per-node capabilities (Session A), read off the SAME config JSONB. `fallback_model` = the ONE slug
// the model call fails over to on a hard provider failure; `output_schema` = the ADVISORY expected
// output shape; `multimodal` = the (model-bounded) multimodal opt-in. All empty/off by default, so a
// node with none of them set behaves — and PATCHes — exactly as before this slice.
const fallbackModelOf = (node: TeamGraphNode | null): string => {
  const raw = (node?.config as Record<string, unknown> | null | undefined)?.fallback_model;
  return typeof raw === "string" ? raw : "";
};
const outputSchemaTextOf = (node: TeamGraphNode | null): string => {
  const raw = (node?.config as Record<string, unknown> | null | undefined)?.output_schema;
  return raw && typeof raw === "object" ? JSON.stringify(raw, null, 2) : "";
};
const multimodalOf = (node: TeamGraphNode | null): boolean =>
  (node?.config as Record<string, unknown> | null | undefined)?.multimodal === true;

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
 *  - **gate** (M-rails C8) — an editable checkpoint: gate type + title/description + parameterized
 *    guardrail config, dirty-aware Save via `updateGateNode`.
 *  - **terminal** (M-endpoint-editable) — an editable endpoint: live Ship/Stop control, dirty-aware
 *    Save via `updateTerminalNode` (persists `terminal_kind` + synced `role_name`).
 *  - **domain_query** (PolyRAG Phase 4a) — Domain select + prompt template; Save via
 *    `updateDomainQueryNode` (no model required).
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
  onManageMemory,
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
  // M-memory S5b: navigate to the Dashboard Memory shelf (the drawer's "Manage all memory" link).
  // Optional → existing tests/usage that render <TeamNodePanel/> without it are unchanged.
  onManageMemory?: () => void;
}) {
  const [prompt, setPrompt] = useState(node?.prompt ?? "");
  const [model, setModel] = useState(node?.model ?? "");
  // M-accounts Slice C: the per-node model picker is provider-gated by the account's configured
  // providers. The panel remounts per node (parent `key`), so a local fetch-on-mount is self-contained.
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  // Prefer-subscription: Desktop harness / mirror status keyed by subscription provider id.
  const [subscriptionById, setSubscriptionById] = useState<
    Partial<Record<SubscriptionProviderId, SubscriptionStatus>>
  >({});
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
  // M-memory: the per-node "Remember what I learn" toggle — an edits-on sub-option. Seeded from the
  // node's config JSONB (default false); reset-on-select is the parent `key` remount.
  const initialMemoryRemember = rememberEnabledOf(node);
  const [memoryRememberEnabled, setMemoryRememberEnabled] =
    useState<boolean>(initialMemoryRemember);
  // M-docs: per-node document routing. writes_to = a single doc name (text input); reads_from = a
  // list of names (one per line in a textarea). Seeded from config, reset via the `key` remount,
  // folded into the dirty check, and posted on Save. Empty by default.
  const initialWritesTo = writesToOf(node);
  const [writesTo, setWritesTo] = useState<string>(initialWritesTo);
  const initialReadsFromText = readsFromOf(node).join("\n");
  const [readsFromText, setReadsFromText] = useState<string>(initialReadsFromText);
  // Session A: the three per-node capability fields. Seeded from config, reset via the `key`
  // remount, folded into the dirty check, and posted on Save — exactly like the M-docs fields above.
  const initialFallbackModel = fallbackModelOf(node);
  const [fallbackModel, setFallbackModel] = useState<string>(initialFallbackModel);
  const initialOutputSchemaText = outputSchemaTextOf(node);
  const [outputSchemaText, setOutputSchemaText] = useState<string>(initialOutputSchemaText);
  const initialMultimodal = multimodalOf(node);
  const [multimodal, setMultimodal] = useState<boolean>(initialMultimodal);
  // The edit-time model hint is dismissible per node (the `key` remount resets it).
  const [modelHintDismissed, setModelHintDismissed] = useState(false);
  // A malformed Expected-output JSON blocks only ITS OWN save (never the model field's free text).
  const [schemaError, setSchemaError] = useState(false);
  // M-tools C7.0: the node's inline tools + skills (stub editors). Seeded from the node, reset via the
  // `key` remount, folded into the dirty check, and posted on Save. NULL until a later milestone.
  const [toolConfig, setToolConfig] = useState<Record<string, unknown> | null>(
    node?.tool_config ?? null,
  );
  const [skills, setSkills] = useState<unknown[] | null>(node?.skills ?? null);
  // Dirty baselines for tools/skills (JSON snapshots). Seeded from the node; reset to the draft on
  // successful Save so the banner clears even when the parent refetch is slow or JSONB key order
  // differs from the editor's object (JSON.stringify vs node.tool_config alone is not enough).
  const [toolConfigSaved, setToolConfigSaved] = useState(() =>
    JSON.stringify(node?.tool_config ?? null),
  );
  const [skillsSaved, setSkillsSaved] = useState(() => JSON.stringify(node?.skills ?? null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  // M-rails C8/C9: a GATE's editable config (its type + human copy + the parameterized guardrail
  // configs). Seeded from `node.config`; the parent `key`-remount resets it per node.
  // Unused/harmless for agent/completion/terminal nodes.
  const gateCfg = (node?.config ?? {}) as GateConfig;
  const initialGateKind = gateCfg.gate_kind || "gate_approval";
  const initialGateTitle = gateCfg.title ?? "";
  const initialGateDesc = gateCfg.description ?? "";
  // The human sub-kind to restore when "Human approval" is (re)selected: preserve the node's own
  // human sub-kind (prd_approval/…); a node that started as a guardrail can't recover one → the
  // generic gate_approval.
  const humanGateKind = GUARDRAIL_GATE_KINDS.has(initialGateKind)
    ? "gate_approval"
    : initialGateKind;
  const initialForbiddenText = (gateCfg.forbidden_paths ?? []).join("\n");
  const initialOutputFile = gateCfg.output_file ?? "";
  const initialSchemaText = gateCfg.schema ? JSON.stringify(gateCfg.schema, null, 2) : "";
  const [gateKind, setGateKind] = useState(initialGateKind);
  const [gateTitle, setGateTitle] = useState(initialGateTitle);
  const [gateDesc, setGateDesc] = useState(initialGateDesc);
  const [forbiddenText, setForbiddenText] = useState(initialForbiddenText);
  const [outputFile, setOutputFile] = useState(initialOutputFile);
  const [schemaText, setSchemaText] = useState(initialSchemaText);

  // M-endpoint-editable: a TERMINAL's editable disposition. Seeded from `node.config`; the parent
  // `key`-remount resets it per node. Unused/harmless for agent/gate nodes.
  const termCfg = (node?.config ?? {}) as TerminalConfig;
  const initialTerminalKind: "ship" | "stop" = termCfg.terminal_kind === "ship" ? "ship" : "stop";
  const [terminalKind, setTerminalKind] = useState<"ship" | "stop">(initialTerminalKind);

  // Phase 4a: domain_query drawer — selected Domain + prompt template. Seeded from config/prompt;
  // parent `key` remount resets. Unused/harmless for other kinds.
  const dqCfg = (node?.config ?? {}) as DomainQueryConfig;
  const initialDomainId = dqCfg.domain_id ?? "";
  const [domainId, setDomainId] = useState<string>(initialDomainId || "");
  const [domains, setDomains] = useState<DomainSummary[]>([]);

  // F1c: the model-chip express lane — a focus signal from the parent (a bumping nonce; 0 = a normal
  // open). On a bump, scroll the Model field into view + flash a transient coral ring.
  const modelFieldRef = useRef<HTMLDivElement>(null);
  const [modelFlash, setModelFlash] = useState(false);

  const isAgent = node?.kind === "agent" || node?.kind === "completion";
  const isDomainQuery = node?.kind === "domain_query";

  useEffect(() => {
    // Phase 4a: load Domains for the domain_query select. Skip for other kinds.
    if (!isDomainQuery) return;
    let cancelled = false;
    listDomains()
      .then((rows) => {
        if (!cancelled) setDomains(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isDomainQuery]);

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
    // Prefer-subscription treatment: Desktop engines.getStatus when available, else mirror API.
    if (!isAgent) return;
    let cancelled = false;
    (async () => {
      try {
        const d = window.tvashtrDesktop;
        const engines =
          d && typeof d === "object" && d.engines ? d.engines : null;
        const rows = engines?.getStatus
          ? await engines.getStatus()
          : await listSubscriptionStatuses();
        if (cancelled) return;
        const map: Partial<Record<SubscriptionProviderId, SubscriptionStatus>> = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          map[row.provider] = row;
        }
        setSubscriptionById(map);
      } catch {
        /* leave empty — pill stays hidden / BYOK path still works */
      }
    })();
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
      memoryRememberEnabled !== initialMemoryRemember ||
      // M-tools C7.0: compare drafts to the last-saved JSON baselines (not live node props) so a
      // successful Save clears dirty even if the parent refetch lags or JSONB reorders keys.
      JSON.stringify(toolConfig ?? null) !== toolConfigSaved ||
      JSON.stringify(skills ?? null) !== skillsSaved ||
      // M-docs: writes_to/reads_from are authorable fields — editing either enables Save.
      writesTo !== initialWritesTo ||
      readsFromText !== initialReadsFromText ||
      // Session A: the three capability fields are authorable too — editing any enables Save.
      fallbackModel !== initialFallbackModel ||
      outputSchemaText !== initialOutputSchemaText ||
      multimodal !== initialMultimodal);
  const canSave = dirty && !saving && prompt.trim().length > 0 && model.trim().length > 0;

  const pickEdits = (next: boolean) => {
    if (isStartNode) return; // the entry node is locked edits-off — it writes the shared spec, never edits
    setEditsAllowed(next);
    setSaved(false);
  };

  // M-memory: flip the per-node remember toggle (an edits-on sub-option) — an authorable field like
  // prompt/model, so it enables Save.
  const pickRemember = (next: boolean) => {
    setMemoryRememberEnabled(next);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!node || !canSave) return;
    // Session A: build the capability payload FIRST — a malformed Expected-output JSON must refuse
    // the save before any request goes out (the same guard the gate editor's schema field uses).
    // Each key is included ONLY when this node actually has a value or is CLEARING a stored one, so
    // a node that never touched these fields sends a PATCH body byte-identical to before the slice.
    const capabilities: {
      fallback_model?: string | null;
      output_schema?: Record<string, unknown> | null;
      multimodal?: boolean;
    } = {};
    if (fallbackModel.trim() !== initialFallbackModel) {
      capabilities.fallback_model = fallbackModel.trim() || null;
    }
    if (outputSchemaText !== initialOutputSchemaText) {
      if (!outputSchemaText.trim()) {
        capabilities.output_schema = null; // cleared
      } else {
        try {
          capabilities.output_schema = JSON.parse(outputSchemaText) as Record<string, unknown>;
        } catch {
          setSchemaError(true); // invalid JSON — surface it, save nothing
          return;
        }
      }
    }
    if (multimodal !== initialMultimodal) capabilities.multimodal = multimodal;

    setSaving(true);
    setSaveError(false);
    setSchemaError(false);
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
        memoryRememberEnabled,
        writesTo.trim(),
        readsFromText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        // Session A: an EMPTY object sends none of the three keys (byte-identical PATCH).
        capabilities,
      );
      // Clear the tools/skills dirty banner immediately — don't wait for parent refetch equality.
      setToolConfigSaved(JSON.stringify(toolConfig ?? null));
      setSkillsSaved(JSON.stringify(skills ?? null));
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  // M-rails C8/C9: the gate config Save. `gateKind` is the source of truth (Human approval restores
  // the human sub-kind; each guardrail button sets its own kind). The parameterized config is sent
  // ONLY for the kind that uses it, so a human / secret_leak_scan save keeps the byte-identical
  // `{gate_kind, title, description}` body.
  const gateDirty =
    node !== null &&
    (gateKind !== initialGateKind ||
      gateTitle !== initialGateTitle ||
      gateDesc !== initialGateDesc ||
      forbiddenText !== initialForbiddenText ||
      outputFile !== initialOutputFile ||
      schemaText !== initialSchemaText);
  const handleGateSave = async () => {
    if (!node || !gateDirty) return;
    let extra:
      | {
          forbidden_paths?: string[];
          output_file?: string;
          output_schema?: Record<string, unknown>;
        }
      | undefined;
    if (gateKind === "diff_touches_forbidden_paths") {
      extra = {
        forbidden_paths: forbiddenText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    } else if (gateKind === "output_schema_check") {
      let parsed: Record<string, unknown>;
      try {
        parsed = (schemaText.trim() ? JSON.parse(schemaText) : {}) as Record<string, unknown>;
      } catch {
        setSaveError(true); // invalid JSON schema — surface the error, do not save
        return;
      }
      extra = { output_file: outputFile.trim(), output_schema: parsed };
    }
    setSaving(true);
    setSaveError(false);
    try {
      await updateGateNode(teamId, node.id, gateKind, gateTitle, gateDesc, extra);
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  // ---- M-accounts Slice C: the provider-gated model picker (UI over the SINGLE node.model string) ----
  // M-seat: the quick-picks are chosen for this node's SEAT. A worker drives the OpenHands agent
  // loop and a thinker makes one completion, so the two lists are genuinely different — offering a
  // worker a thinker-only slug invites, by hand, the failure the backend defaults now avoid.
  const capability: Capability = node?.kind === "agent" ? "worker" : "thinker";
  const currentProvider = model.trim() ? providerOf(model) : "";
  const providerOptions = Array.from(
    new Set([...providers.map((p) => p.provider), ...(currentProvider ? [currentProvider] : [])]),
  ).sort();
  const quickPicks = presetsForProvider(currentProvider, capability);

  const onProviderChange = (value: string) => {
    if (value === ADD_PROVIDER) {
      setAddOpen(true);
      return;
    }
    // Rewrite the leading segment: jump to that provider's default FOR THIS SEAT, else its first
    // quick-pick for the seat, else a bare prefix (the field stays free text).
    setModel(
      defaultForProvider(value, capability) ??
        presetsForProvider(value, capability)[0] ??
        `${value}/`,
    );
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

  // ---- Session A, Feature 3: edit-time model validation (SOFT — never blocks Save) ----
  // The model field is deliberately free-text (BYOK, any provider), so an unrecognised slug is a
  // WARNING, not a block: we cannot know every valid model. It fires when EITHER the slug's provider
  // isn't one the account has configured a key for, OR the provider is configured but the slug isn't
  // a known preset for it. That catches the typo-that-fails-30s-into-a-run at authoring time.
  // Suppressed while the providers list is still loading (empty) so it can't flash on mount.
  const configuredProviders = new Set(providers.map((p) => p.provider));
  const providerConfigured = configuredProviders.has(currentProvider);
  const knownPreset = quickPicks.includes(model.trim());
  const subId = subscriptionProviderForModel(model);
  const subConnected = subId ? subscriptionById[subId]?.connected === true : false;
  const launchTarget =
    document.documentElement.dataset.tvashtrDesktop === "true" ? "local" : "hosted";
  const treatment = credentialTreatment({
    model,
    subscriptionConnected: subConnected,
    byokConfigured: providerConfigured,
    launchTarget,
  });
  // Soften: when a local subscription covers the model, don't warn solely for missing BYOK.
  const modelWarning =
    isAgent && model.trim() && providers.length > 0 && !(providerConfigured && knownPreset)
      ? !providerConfigured
        ? subConnected && launchTarget === "local"
          ? null
          : `No API key configured for “${currentProvider}”.`
        : `“${model.trim()}” isn’t a known ${currentProvider} model.`
      : null;
  const showModelWarning = modelWarning !== null && !modelHintDismissed;
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
    const isGuardrail = GUARDRAIL_GATE_KINDS.has(gateKind);
    const gateTypeOptions: { kind: string; label: string; pressed: boolean }[] = [
      { kind: humanGateKind, label: "Human approval", pressed: !isGuardrail },
      {
        kind: "secret_leak_scan",
        label: "Secret leak scan",
        pressed: gateKind === "secret_leak_scan",
      },
      {
        kind: "diff_touches_forbidden_paths",
        label: "Forbidden paths",
        pressed: gateKind === "diff_touches_forbidden_paths",
      },
      {
        kind: "output_schema_check",
        label: "Output schema",
        pressed: gateKind === "output_schema_check",
      },
    ];
    const gateTypeHint =
      gateKind === "secret_leak_scan"
        ? "Secret leak scan — scans the run’s workspace and emits approved / rejected with no human pause."
        : gateKind === "diff_touches_forbidden_paths"
          ? "Forbidden paths — rejects automatically if the run’s changes touch any path you list below."
          : gateKind === "output_schema_check"
            ? "Output schema — rejects unless the named output file exists and matches the JSON schema."
            : "Human approval — the run pauses here for a person to approve or reject.";
    return (
      <DrawerShell
        glyph={glyphForNode("gate", node.role_name)}
        title={gateHeaderTitle}
        subtitle={isGuardrail ? "An automatic guardrail" : "A human checkpoint"}
        ariaLabel={`${gateHeaderTitle} checkpoint`}
        panelMode={panelMode}
        onTogglePanelMode={onTogglePanelMode}
        onClose={onClose}
      >
        <div className="tv-scroll tv-node-edit">
          <div className="tv-field">
            <span className="tv-field__label">Gate type</span>
            <div
              className="tv-seg"
              role="group"
              aria-label="Gate type"
              style={{ flexWrap: "wrap" }}
            >
              {gateTypeOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={opt.pressed}
                  disabled={saving}
                  className={`tv-seg__btn${opt.pressed ? " tv-seg__btn--active" : ""}`}
                  onClick={() => {
                    setGateKind(opt.kind);
                    setSaved(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="tv-field__hint">{gateTypeHint}</span>
          </div>

          {gateKind === "diff_touches_forbidden_paths" && (
            <label className="tv-field">
              <span className="tv-field__label">Forbidden paths</span>
              <span className="tv-field__hint">
                One glob per line (e.g. <code>.github/**</code>, <code>infra/**</code>,{" "}
                <code>*.pem</code>). The gate rejects if the run’s diff touches any of them.
              </span>
              <textarea
                className="tv-node-prompt"
                aria-label="Forbidden paths"
                value={forbiddenText}
                rows={4}
                spellCheck={false}
                onChange={(e) => {
                  setForbiddenText(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
          )}

          {gateKind === "output_schema_check" && (
            <>
              <label className="tv-field">
                <span className="tv-field__label">Output file</span>
                <span className="tv-field__hint">
                  A workspace-relative path to a JSON file (e.g. <code>result.json</code>).
                </span>
                <input
                  className="tv-node-model"
                  aria-label="Output file"
                  value={outputFile}
                  spellCheck={false}
                  onChange={(e) => {
                    setOutputFile(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <label className="tv-field">
                <span className="tv-field__label">JSON schema</span>
                <span className="tv-field__hint">
                  A JSON Schema (type / required / properties / items / enum). The gate rejects
                  unless the output file validates.
                </span>
                <textarea
                  className="tv-node-prompt"
                  aria-label="JSON schema"
                  value={schemaText}
                  rows={8}
                  spellCheck={false}
                  onChange={(e) => {
                    setSchemaText(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
            </>
          )}

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

  // ---- M-endpoint-editable: terminal — live Ship/Stop control + dirty-aware Save. ----
  if (node.kind === "terminal") {
    const isShip = terminalKind === "ship";
    const termTitle = isShip ? "Ship" : "Stop";
    const terminalDirty = terminalKind !== initialTerminalKind;
    const handleTerminalSave = async () => {
      if (!terminalDirty) return;
      setSaving(true);
      setSaveError(false);
      try {
        await updateTerminalNode(teamId, node.id, terminalKind);
        setSaved(true);
        await onSaved();
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    };
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
          <div className="tv-field">
            <span className="tv-field__label">Endpoint</span>
            <div className="tv-seg" role="group" aria-label="Endpoint">
              <button
                type="button"
                aria-pressed={isShip}
                className={`tv-seg__btn${isShip ? " tv-seg__btn--active" : ""}`}
                onClick={() => {
                  setTerminalKind("ship");
                  setSaved(false);
                }}
              >
                Ship it
              </button>
              <button
                type="button"
                aria-pressed={!isShip}
                className={`tv-seg__btn${!isShip ? " tv-seg__btn--active" : ""}`}
                onClick={() => {
                  setTerminalKind("stop");
                  setSaved(false);
                }}
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

          <div className="tv-prd__editbar">
            <button
              className="tv-btn"
              type="button"
              onClick={() => void handleTerminalSave()}
              disabled={!terminalDirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {terminalDirty ? (
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

  // ---- Phase 4a: domain_query — Domain select + prompt template (no model). ----
  if (node.kind === "domain_query") {
    const dqTitle = "Domain ask";
    const domainDirty =
      domainId !== (initialDomainId || "") || prompt !== (node.prompt ?? "");
    const handleDomainQuerySave = async () => {
      if (!domainDirty) return;
      setSaving(true);
      setSaveError(false);
      try {
        await updateDomainQueryNode(teamId, node.id, {
          domain_id: domainId || null,
          prompt,
        });
        setSaved(true);
        await onSaved();
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    };
    return (
      <DrawerShell
        glyph={glyphForNode("domain_query", node.role_name)}
        title={dqTitle}
        subtitle="Cited ask against a Domain"
        ariaLabel="Cited ask editor"
        panelMode={panelMode}
        onTogglePanelMode={onTogglePanelMode}
        onClose={onClose}
      >
        <div className="tv-scroll tv-node-edit">
          <label className="tv-field">
            <span className="tv-field__label">Domain</span>
            <select
              className="tv-node-model"
              aria-label="Domain"
              value={domainId}
              disabled={saving}
              onChange={(e) => {
                setDomainId(e.target.value);
                setSaved(false);
              }}
            >
              <option value="">Select a Domain…</option>
              {domains.map((d) => (
                <option key={d.domain_id} value={d.domain_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="tv-field">
            <span className="tv-field__label">Prompt template</span>
            <span className="tv-field__hint">
              Use <code>{"{idea}"}</code> for the run idea.
            </span>
            <textarea
              className="tv-node-prompt"
              aria-label="Prompt template"
              value={prompt}
              rows={8}
              spellCheck={false}
              onChange={(e) => {
                setPrompt(e.target.value);
                setSaved(false);
              }}
            />
          </label>

          <div className="tv-prd__editbar">
            <button
              className="tv-btn"
              type="button"
              onClick={() => void handleDomainQuerySave()}
              disabled={!domainDirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {domainDirty ? (
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

        {editsAllowed && (
          <div className="tv-field">
            <span className="tv-field__label">Remember what I learn</span>
            <div className="tv-seg" role="group" aria-label="Remember what I learn">
              <button
                type="button"
                aria-pressed={memoryRememberEnabled}
                disabled={saving}
                className={`tv-seg__btn${memoryRememberEnabled ? " tv-seg__btn--active" : ""}`}
                onClick={() => pickRemember(true)}
              >
                Remember
              </button>
              <button
                type="button"
                aria-pressed={!memoryRememberEnabled}
                disabled={saving}
                className={`tv-seg__btn${!memoryRememberEnabled ? " tv-seg__btn--active" : ""}`}
                onClick={() => pickRemember(false)}
              >
                {"Don't remember"}
              </button>
            </div>
            <span className="tv-field__hint">
              When on, this node records durable lessons from each run so future runs recall them.
            </span>
          </div>
        )}

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
            {capability === "worker"
              ? "This node runs the agent — the models offered are the ones proven to drive a build. Pick a provider you’ve configured, then a model; add a key inline if it’s missing."
              : "Pick a provider you’ve configured, then a model — add a key inline if it’s missing."}
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
          {treatment === "subscription" && (
            <span className="tv-engines__pill">via subscription (local)</span>
          )}
          {treatment === "byok" && <span className="tv-engines__pill">via API key</span>}

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

          {/* Session A, Feature 3: the edit-time model warning. SOFT by design — Save is never
              disabled and the field stays free-text; this only catches the typo/unconfigured-provider
              case at authoring time instead of 30s into a run. */}
          {showModelWarning && (
            <div className="tv-node-hint" role="status" data-testid="model-validity-hint">
              <span className="tv-node-hint__text">
                {modelWarning} It’ll fail at run time if the slug is wrong or the provider key isn’t
                set.
              </span>
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                onClick={() => setModelHintDismissed(true)}
                aria-label="Dismiss model warning"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Session A, Feature 1: the per-node fallback model — directly under the model picker.
            Empty by default ⇒ no behaviour change. Same free-text + preset datalist as the primary
            field, because the same BYOK "any provider" rule applies. */}
        <label className="tv-field">
          <span className="tv-field__label">Fallback model</span>
          <span className="tv-field__hint">
            Used once if this node’s model hard-fails (bad key, provider down). Blank = no fallback.
          </span>
          <input
            className="tv-node-model"
            type="text"
            list="tv-model-presets"
            aria-label="Fallback model"
            value={fallbackModel}
            spellCheck={false}
            placeholder="e.g. openai/gpt-4o-mini"
            onChange={(e) => {
              setFallbackModel(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        {/* Session A, Feature 2: the ADVISORY expected-output schema + the multimodal opt-in. */}
        <label className="tv-field">
          <span className="tv-field__label">Expected output</span>
          <span className="tv-field__hint">
            Optional JSON Schema for this node’s output. Advisory — a mismatch is recorded as a run
            warning, never a failure.
          </span>
          <textarea
            className="tv-field__input tv-field__input--mono"
            aria-label="Expected output"
            rows={4}
            spellCheck={false}
            placeholder={'{ "type": "object", "required": ["title"] }'}
            value={outputSchemaText}
            onChange={(e) => {
              setOutputSchemaText(e.target.value);
              setSchemaError(false);
              setSaved(false);
            }}
          />
          {schemaError && (
            <span className="tv-prd__saveerr">That isn’t valid JSON — fix it to save.</span>
          )}
        </label>

        <div className="tv-field">
          <span className="tv-field__label">Multimodal</span>
          <span className="tv-field__hint">
            Let this node exchange images as well as text. Bounded by the model — a text-only model
            ignores it.
          </span>
          <div className="tv-seg" role="group" aria-label="Multimodal">
            <button
              type="button"
              className="tv-seg__btn"
              aria-pressed={multimodal}
              onClick={() => {
                setMultimodal(!multimodal);
                setSaved(false);
              }}
            >
              Multimodal
            </button>
          </div>
        </div>

        {/* M-docs: per-node document routing. Writes-to = the ONE document this node authors;
            reads-from = the documents that feed its context (one name per line). Empty by default —
            a node with neither behaves exactly as before. Rendered for any agent/completion node
            (not gated on Edits: a thinker authors documents too). */}
        <label className="tv-field">
          <span className="tv-field__label">Writes to</span>
          <span className="tv-field__hint">
            The document this node authors (e.g. design). Blank = the shared spec (the entry node)
            or nothing.
          </span>
          <input
            className="tv-node-model"
            type="text"
            value={writesTo}
            spellCheck={false}
            placeholder="(none)"
            onChange={(e) => {
              setWritesTo(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        <label className="tv-field">
          <span className="tv-field__label">Reads from</span>
          <span className="tv-field__hint">
            Documents that feed this node, one name per line (e.g. spec, then design). Blank = the
            run spec/PRD.
          </span>
          <textarea
            className="tv-node-prompt"
            value={readsFromText}
            rows={3}
            spellCheck={false}
            placeholder="(defaults to the spec)"
            onChange={(e) => {
              setReadsFromText(e.target.value);
              setSaved(false);
            }}
          />
        </label>

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

        {/* M-memory S5b: the node's own private notes (its node-tier facts). Independent-fetch +
            direct-mutate — it hits the memory endpoints itself, NOT part of the Save wire above. */}
        <NodeMemorySection nodeId={node.id} onManageAll={onManageMemory} />

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
