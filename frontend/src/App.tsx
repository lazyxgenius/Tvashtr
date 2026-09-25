import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LogOut, Play } from "lucide-react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import type { DashView } from "./lib/nav";
import { BackendDot } from "./components/BackendDot";
import { CancelRunButton } from "./components/CancelRunButton";
import { LaunchPanel } from "./components/LaunchPanel";
import { RunBanner } from "./components/RunBanner";
import { RunWarnings } from "./components/RunWarnings";
import { TasksDrawer } from "./components/TasksDrawer";
import { SidePanel } from "./panel/SidePanel";
import { TeamNodePanel } from "./panel/TeamNodePanel";
import {
  acknowledgeTask,
  ApiError,
  type AuthUser,
  cancelRun,
  type Config,
  type CostRow,
  type CreateNodeBody,
  createTeamEdge,
  createTeamNode,
  deleteTeamEdge,
  deleteTeamNode,
  type GraphData,
  type GraphValidity,
  getGraph,
  getRunStatus,
  getRunTasks,
  getTeamGraph,
  getTeams,
  getTeamValidity,
  type HumanTask,
  listProviders,
  listSubscriptionStatuses,
  type NodePosition,
  type ProviderCredential,
  resolveTask,
  type RunRow,
  runTeam,
  type RunTeamOptions,
  saveTeamPositions,
  type TaskDecision,
  type TeamGraphData,
} from "./lib/api";
import {
  missingCredentialCtaTitle,
  missingProviderBannerDetail,
  missingProvidersForModels,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "./lib/engines";
import type { EdgeConfirm } from "./canvas/EdgeRoleEditor";
import { nextDropPosition, withLayout } from "./lib/topology";
import { isRunTerminal } from "./lib/status";

// P1.8d-fix1: a STABLE empty task list for the authoring view. A fresh `[]` literal at the call site
// is a new reference every render, and TeamCanvas's node-refresh effect depends on `tasks` — so an
// inline `[]` re-fires that effect on every render, which (with React Flow's async re-measure +
// fitView) closes into an infinite render loop. One module-level constant kills the loop's fuel.
const EMPTY_TASKS: HumanTask[] = [];

// M-accounts Slice A: optional props so AuthGate can thread the logged-in identity + a logout
// handler into the top bar. Slice B adds `teamId` (open this dashboard-selected team) + a
// `onBackToDashboard` control. M-h1b adds `config` (the public posture) so the launch panel knows
// whether to show the hosted GitHub-repo dropdown. All optional → existing tests/usage that render
// <App /> are unchanged.
interface AppProps {
  user?: AuthUser | null;
  onLogout?: () => void;
  teamId?: string;
  // Open straight into ONE run's view (the dashboard's per-team history drill-down links here by
  // run_id) instead of the team's authoring view. Seeds `runId`, which is what makes `authoring`
  // false; the existing poll then fills in the run + its graph exactly as a fresh launch does.
  initialRunId?: string | null;
  /** Return to the dashboard; pass "engines" / "tools" to land on that page (Open Engines). */
  onBackToDashboard?: (view?: DashView) => void;
  config?: Config | null;
}

export default function App({
  user,
  onLogout,
  teamId,
  initialRunId,
  onBackToDashboard,
  config,
}: AppProps = {}) {
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  // The currently-open team + its graph (rendered on the canvas while no run is active).
  // `currentTeamId` PERSISTS across a run — only run-scoped state resets. Team SELECTION + management
  // now live on the Dashboard (F-canvas-fidelity-1 Part A removed the author-mode teams rail — "the
  // team library lives on the Dashboard"); when opened from the dashboard for a specific team, start
  // on THAT team (the loadTeams `cur ?? list[0]` guard keeps it); a standalone mount defaults to the
  // first team.
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(teamId ?? null);
  const [teamGraph, setTeamGraph] = useState<TeamGraphData | null>(null);
  const [teamError, setTeamError] = useState(false);
  // P1.8d: the current team's holistic-validity verdict (refetched after every topology edit). Run
  // is gated on `validity.runnable`; the offending nodes/edges are flagged on the canvas.
  const [validity, setValidity] = useState<GraphValidity | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  // M-brownfield Slice 2: "Run this team" opens the launch panel (it no longer fires the run
  // directly); the panel's Run calls `handleLaunch` with the assembled options.
  const [launchOpen, setLaunchOpen] = useState(false);
  const [acting, setActing] = useState(false);
  // M-legible: the launch error is the backend's REAL reason (or the generic network message), not a
  // bare boolean — a 422/429 means the backend answered, so we render what it said. `null` = no error.
  const [error, setError] = useState<string | null>(null);
  // M-live: the role names the launch pre-flight refused on. The banner shows the reason; this puts
  // it on the offending node cards too, so the eye lands on what to fix rather than on the message.
  const [blockedNodes, setBlockedNodes] = useState<string[]>([]);
  // Run-view selection is by NODE ID (Option A): a topology-edited team can carry duplicate role
  // names (e.g. two blank thinkers), so the run panel keys on the unique node id — the run-view twin
  // of the authoring `selectedNodeId` below.
  const [selectedRunNodeId, setSelectedRunNodeId] = useState<string | null>(null);
  // P1.8d: authoring selection is by NODE ID too (duplicate role names possible after topology edits).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  // F1c: the dock⇄pop-up viewing preference — SESSION-STICKY. It survives closing/reselecting a node
  // and the author↔run switch (it is NOT part of resetRunState); a reload starts docked. NOT persisted
  // to the backend (no field — the wall).
  const [panelMode, setPanelMode] = useState<"drawer" | "modal">("drawer");
  // F1c: the model-chip express lane. A bumping nonce keyed to a node: `handleOpenModel` selects the
  // node + bumps it, so the author drawer scrolls to + flashes its Model field; a normal card/selection
  // open (`handleSelectNodeId`) clears it, so only a chip click focuses the Model field.
  const [modelFocus, setModelFocus] = useState<{ nodeId: string; n: number } | null>(null);
  // Credential preflight for Run (UX): null until the first successful providers load so we
  // don't flash-disable the CTA; once loaded, missing BYOK (and no Desktop subscription cover)
  // blocks launch and points at Engines.
  const [credentialGate, setCredentialGate] = useState<{
    byok: Set<string>;
    subs: Partial<Record<SubscriptionProviderId, boolean>>;
  } | null>(null);
  // F-canvas-fidelity-1 Part B: the header profile menu (avatar → the email + Log out). Local UI state.
  const [profileOpen, setProfileOpen] = useState(false);

  // Authoring vs run: with no active run the canvas shows the persistent team; once a run launches
  // the existing live run view takes over (graph/run/tasks polled as before).
  const authoring = runId === null;
  const terminal = isRunTerminal(run, workflowStatus);

  // Load BYOK + subscription coverage while authoring so Run can gate on missing providers.
  useEffect(() => {
    if (!authoring) return;
    let cancelled = false;
    (async () => {
      try {
        // M-subs-desktop: the gate reads the SERVER mirror — a subscription covers only while it is
        // connected AND this user's Tvashtr Desktop runner has checked in (`runner_fresh`), which is
        // exactly what the server pre-flight accepts. One rule, so Run and POST /api/runs agree.
        const [providers, rows] = await Promise.all([
          listProviders(),
          listSubscriptionStatuses().catch(() => [] as SubscriptionStatus[]),
        ]);
        if (cancelled) return;
        const byok = new Set(
          (Array.isArray(providers) ? providers : []).map((p: ProviderCredential) => p.provider),
        );
        const subs: Partial<Record<SubscriptionProviderId, boolean>> = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          subs[row.provider] = row.connected === true && row.runner_fresh === true;
        }
        setCredentialGate({ byok, subs });
      } catch {
        // Leave gate null — don't block Run on a transient credentials fetch failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authoring, currentTeamId]);

  const inFlight = runId !== null && !terminal;
  // Tasks acted on this run — suppress them so a drawer card can't briefly resurrect
  // on the immediate re-poll (which can catch the backend a beat before the task
  // is marked resolved).
  const resolvedIdsRef = useRef<Set<number>>(new Set());
  const pendingBlockers = tasks.filter(
    (t) => t.status === "pending" && t.blocking && !resolvedIdsRef.current.has(t.id),
  );
  const pendingNudges = tasks.filter(
    (t) => t.status === "pending" && !t.blocking && !resolvedIdsRef.current.has(t.id),
  );

  const mountedRef = useRef(true);
  // Reset on (re)mount: StrictMode's dev mount→unmount→remount would otherwise leave
  // this stuck `false` (the unmount cleanup fires, the remount never re-arms it), and
  // then every successful poll's setState is silently skipped by the guard in `pull`.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the default open team when none was passed (a standalone mount / the tests): pick the
  // first library team. Team management + selection live on the Dashboard now (Part A); this only
  // seeds `currentTeamId` so the canvas has a team to render. Tolerant: a transient failure hints.
  const loadTeams = useCallback(async () => {
    try {
      const list = await getTeams();
      if (!mountedRef.current) return;
      // Server-seeded non-empty, so list[0] exists; keep the current selection if one is set.
      setCurrentTeamId((cur) => cur ?? list[0]?.team_graph_id ?? null);
      setTeamError(false);
    } catch {
      if (mountedRef.current) setTeamError(true);
    }
  }, []);

  // Load one team's graph onto the canvas + its validity verdict. Tolerant like `loadTeams`.
  const loadTeam = useCallback(async (teamId: string) => {
    try {
      const [t, v] = await Promise.all([getTeamGraph(teamId), getTeamValidity(teamId)]);
      if (!mountedRef.current) return;
      if (Array.isArray(t?.nodes)) {
        setTeamGraph(t);
        setValidity(v);
        setTeamError(false);
      }
    } catch {
      if (mountedRef.current) setTeamError(true);
    }
  }, []);

  // ---- Topology editing (P1.8d): node/edge CRUD + drag-persist, each followed by a team reload
  // (graph + validity) so the canvas + the Run gate reflect the edit. ----

  const handleAddNode = useCallback(
    async (body: CreateNodeBody) => {
      if (!currentTeamId || !teamGraph) return;
      setEditBusy(true);
      try {
        await createTeamNode(currentTeamId, {
          ...body,
          position: nextDropPosition(teamGraph.nodes),
        });
        await loadTeam(currentTeamId);
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, teamGraph, loadTeam],
  );

  // F1b: the inline "+" on a node — add the NEXT node downstream. Create the node just to the right
  // of the source (same y), forward-connect the source to it, then (thinker/worker only) auto-select
  // it so the existing side panel opens on it. Distinct from `handleAddNode` (the free palette add,
  // no edge). Reuses the same busy/error shape. The premium drawer replacing the panel is F1c.
  const handleAddDownstream = useCallback(
    async (fromId: string, body: CreateNodeBody) => {
      if (!currentTeamId || !teamGraph) return;
      const src = teamGraph.nodes.find((n) => n.id === fromId);
      const position = { x: (src?.position?.x ?? 0) + 300, y: src?.position?.y ?? 0 };
      setEditBusy(true);
      try {
        const created = await createTeamNode(currentTeamId, { ...body, position });
        await createTeamEdge(currentTeamId, {
          source_node_id: fromId,
          target_node_id: created.id,
          role: "forward",
        });
        await loadTeam(currentTeamId);
        // Thinker/worker → open the existing side panel on the new node (gate/terminal: not selected).
        if (mountedRef.current && (created.kind === "agent" || created.kind === "completion")) {
          setSelectedNodeId(created.id);
        }
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, teamGraph, loadTeam],
  );

  // A drawn edge S → T, with its role chosen in the inline editor. A bounded rework loop ALSO
  // creates its escalation exit (the re-entered node T → a chosen gate/Stop) — termination provable.
  const handleCreateEdge = useCallback(
    async (c: EdgeConfirm, source: string, target: string) => {
      if (!currentTeamId) return;
      setEditBusy(true);
      try {
        await createTeamEdge(currentTeamId, {
          source_node_id: source,
          target_node_id: target,
          role: c.role,
          label: c.label,
          loop_limit: c.loopLimit,
        });
        if (c.role === "loop_back" && c.escalationTargetId) {
          await createTeamEdge(currentTeamId, {
            source_node_id: target,
            target_node_id: c.escalationTargetId,
            role: "escalation",
          });
        }
        await loadTeam(currentTeamId);
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, loadTeam],
  );

  const handleDeleteNodes = useCallback(
    async (ids: string[]) => {
      if (!currentTeamId || ids.length === 0) return;
      setEditBusy(true);
      try {
        for (const id of ids) await deleteTeamNode(currentTeamId, id);
        if (selectedNodeId && ids.includes(selectedNodeId)) setSelectedNodeId(null);
        await loadTeam(currentTeamId);
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, loadTeam, selectedNodeId],
  );

  const handleDeleteEdges = useCallback(
    async (ids: string[]) => {
      if (!currentTeamId || ids.length === 0) return;
      setEditBusy(true);
      try {
        for (const id of ids) await deleteTeamEdge(currentTeamId, id);
        await loadTeam(currentTeamId);
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, loadTeam],
  );

  // Persist a node's dragged position (best-effort, no reload — validity is layout-independent).
  // Mirror it into local state so the canvas stays consistent without a refetch/snap.
  const handleMoveNode = useCallback(
    (id: string, position: NodePosition) => {
      if (!currentTeamId) return;
      setTeamGraph((tg) =>
        tg ? { ...tg, nodes: tg.nodes.map((n) => (n.id === id ? { ...n, position } : n)) } : tg,
      );
      void saveTeamPositions(currentTeamId, { [id]: position }).catch(() => {});
    },
    [currentTeamId],
  );

  // F1c: flip the sticky dock⇄pop-up viewing mode (drawer ⇄ modal).
  const togglePanelMode = useCallback(() => {
    setPanelMode((m) => (m === "drawer" ? "modal" : "drawer"));
  }, []);

  // Author-canvas node selection (a card-body click / the pane-click deselect). Clears any pending
  // model-focus so a normal open lands at the top of the drawer (prompt first), NOT scrolled to Model.
  const handleSelectNodeId = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setModelFocus(null);
  }, []);

  // The node card's model chip was clicked (author mode) — select the node AND bump the focus nonce so
  // the drawer scrolls to + flashes its Model field. Re-clicking an ALREADY-open node re-bumps → the
  // drawer re-scrolls (the edge case the brief calls out).
  const handleOpenModel = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setModelFocus((prev) => ({ nodeId, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  // Whenever the current team changes (mount-pick, select, create, delete-fallback), load its graph.
  useEffect(() => {
    if (currentTeamId) void loadTeam(currentTeamId);
  }, [currentTeamId, loadTeam]);

  // One fetch of the run snapshot + its Tasks-for-Human. Shared by the poll loop
  // and the optimistic re-poll after an approve / reject / cancel.
  const pull = useCallback(async () => {
    if (!runId) return;
    try {
      const [s, t, g] = await Promise.all([
        getRunStatus(runId),
        getRunTasks(runId),
        getGraph(runId),
      ]);
      if (!mountedRef.current) return;
      setRun(s.run);
      setWorkflowStatus(s.workflow_status);
      setCosts(s.costs);
      setTasks(t.tasks);
      setGraph(g); // re-fetch the graph each poll so per-node status/iteration go live
    } catch {
      /* transient — keep the last snapshot and retry next tick */
    }
  }, [runId]);

  // Reset the run-scoped state to a clean slate (a fresh launch, or returning to authoring).
  const resetRunState = useCallback(() => {
    setRunId(null);
    setGraph(null);
    setRun(null);
    setWorkflowStatus(null);
    setCosts([]);
    setTasks([]);
    resolvedIdsRef.current = new Set();
    setSelectedRunNodeId(null);
    setSelectedNodeId(null);
    setFocusNodeId(null);
  }, []);

  // The launch (M-brownfield Slice 2): clone the CURRENT team into a fresh run-scoped snapshot and
  // launch it with the panel's options (idea + optional brownfield repo target); the existing live
  // run view then takes over (same poll surface as before). `currentTeamId` survives
  // `resetRunState`, so returning to authoring lands back on the same team. A no-field `opts` posts
  // exactly `{ team_graph_id }` — the greenfield launch is byte-for-byte unchanged.
  const handleLaunch = useCallback(
    async (opts: RunTeamOptions) => {
      if (!currentTeamId) return;
      setLaunchOpen(false);
      setStarting(true);
      setError(null);
      setBlockedNodes([]);
      resetRunState();
      try {
        // M-subs-desktop: a Desktop launch tells the server so its Claude/Grok nodes can run on this
        // computer with the user's own CLI sign-in (the web app never sends it).
        const isDesktopLaunch = document.documentElement.dataset.tvashtrDesktop === "true";
        const id = await runTeam(
          currentTeamId,
          isDesktopLaunch ? { ...opts, desktop_target: true } : opts,
        );
        const g = await getGraph(id);
        setGraph(g);
        setRunId(id);
      } catch (e) {
        // M-legible: a backend answer (ApiError — 422 invalid graph, 429 ceiling, …) carries the
        // real reason; only a genuine network failure (no status) keeps the "is the backend running?"
        // guess.
        setError(
          e instanceof ApiError ? e.message : "Couldn't start the run — is the backend running?",
        );
        setBlockedNodes(e instanceof ApiError ? e.missingNodes : []);
      } finally {
        setStarting(false);
      }
    },
    [currentTeamId, resetRunState],
  );

  // Return to the authoring view (after a run finishes) to edit the current team and run again.
  // Refetches its graph so any edits made elsewhere are reflected.
  const handleEditTeam = useCallback(() => {
    resetRunState();
    setError(null);
    if (currentTeamId) void loadTeam(currentTeamId);
  }, [resetRunState, loadTeam, currentTeamId]);

  // Poll the run + tasks while active and not terminal; stop once terminal.
  useEffect(() => {
    if (!runId || terminal) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void pull();
    };
    tick();
    const handle = setInterval(tick, 1800);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [runId, terminal, pull]);

  const handleResolve = useCallback(
    async (taskId: number, decision: TaskDecision) => {
      if (!runId) return;
      setActing(true);
      resolvedIdsRef.current.add(taskId); // suppress so the re-poll can't resurrect it
      // Optimistic: MARK resolved in place (don't remove). The drawer card drops off
      // (status !== "pending"), and the matching gate node flips straight to its resolved
      // color (approved → sage / rejected → muted) with no remove→idle blink.
      setTasks((ts) =>
        ts.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "resolved",
                resolution: decision === "approve" ? "approved" : "rejected",
              }
            : t,
        ),
      );
      try {
        await resolveTask(runId, taskId, decision);
      } catch {
        /* the next pull reconciles if the signal didn't land */
      } finally {
        setActing(false);
      }
      void pull(); // re-poll immediately so the canvas/banner move at once
    },
    [runId, pull],
  );

  const handleAcknowledge = useCallback(
    async (taskId: number) => {
      if (!runId) return;
      setActing(true);
      resolvedIdsRef.current.add(taskId);
      // Same no-flicker optimistic update for a dismissed nudge.
      setTasks((ts) =>
        ts.map((t) =>
          t.id === taskId ? { ...t, status: "resolved", resolution: "acknowledged" } : t,
        ),
      );
      try {
        await acknowledgeTask(runId, taskId);
      } catch {
        /* the next pull reconciles */
      } finally {
        setActing(false);
      }
      void pull();
    },
    [runId, pull],
  );

  const handleCancel = useCallback(async () => {
    if (!runId) return;
    setActing(true);
    // Cancel closes EVERY pending task server-side (blockers AND the nudge) with
    // resolution "cancelled" — mark them all resolved in place (same no-flicker reasoning),
    // suppressing each so the immediate re-poll can't flash a card back.
    setTasks((ts) =>
      ts.map((t) => {
        if (t.status !== "pending") return t;
        resolvedIdsRef.current.add(t.id);
        return { ...t, status: "resolved", resolution: "cancelled" };
      }),
    );
    try {
      await cancelRun(runId);
    } catch {
      /* reconciled by the immediate pull below */
    } finally {
      setActing(false);
    }
    void pull();
  }, [runId, pull]);

  // The persistent team rendered in the canvas's GraphData shape (no run → every node idle). The
  // canvas keys its topology on `run_id`, so we hand it the stable team_graph_id there.
  const teamAsGraph: GraphData | null = useMemo(() => {
    if (!teamGraph) return null;
    // P1.8d auto-layout fallback: nodes carrying no real position (an empty {} — pre-0012 rows)
    // get a deterministic layered layout so nothing stacks at (0,0); authored/dragged coords pass
    // through untouched (and a drag persists real coords back).
    const layout = withLayout(teamGraph.nodes, teamGraph.edges);
    return {
      run_id: teamGraph.team_graph_id,
      team_graph_id: teamGraph.team_graph_id,
      nodes: teamGraph.nodes.map((n) => ({
        ...n,
        position: layout[n.id] ?? n.position,
        model: n.model ?? "",
        status: "idle",
        iteration: 0,
        invocations: [],
      })),
      edges: teamGraph.edges,
    };
  }, [teamGraph]);

  // P1.8d: the authoring panel selects by node id (duplicate role names are possible now).
  const selectedTeamNode = teamGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  // F1c: 0 for a normal open; the bumping nonce when the model chip opened THIS node (drives the
  // author drawer's Model-field scroll + flash). Guarded on the id so a stale nonce reads 0.
  const focusModel = modelFocus?.nodeId === selectedNodeId ? modelFocus.n : 0;
  // The run-view selected node (Option A): found by id so two same-role nodes select independently.
  const selectedRunNode = graph?.nodes.find((n) => n.id === selectedRunNodeId) ?? null;
  // P1.8c: the team's start node is the one NOT targeted by any edge (same rule as the backend).
  // The panel locks its capability toggle to "thinker" (it writes the spec the rest of the team reads).
  const startNodeId = teamGraph
    ? (() => {
        const targets = new Set(teamGraph.edges.map((e) => e.target_node_id));
        return teamGraph.nodes.find((n) => !targets.has(n.id))?.id ?? null;
      })()
    : null;
  // The Run gate (P1.8d): an authored team with validity errors can't launch (the server agrees —
  // create_run 422s). Default-enabled until the first verdict arrives (avoids a flash-disabled Run).
  const teamRunnable = validity === null || validity.runnable;
  const validityErrors = validity?.errors ?? [];

  const launchTarget =
    document.documentElement.dataset.tvashtrDesktop === "true" ? "local" : "hosted";
  const agentModels = (teamGraph?.nodes ?? [])
    .filter((n) => n.kind === "agent" || n.kind === "completion")
    .map((n) => n.model);
  const missingProviders =
    credentialGate === null
      ? []
      : missingProvidersForModels({
          models: agentModels,
          byokProviders: credentialGate.byok,
          subscriptionConnected: credentialGate.subs,
          launchTarget,
        });
  const providersReady = missingProviders.length === 0;
  // Providers unknown (still loading / fetch failed) → don't block; only block once we know gaps.
  const canLaunch = teamRunnable && (credentialGate === null || providersReady);

  // F-canvas-fidelity-1 Part C: the toolbar spend chip — the run's total cost (prefer the run's
  // authoritative total; else sum the polled cost rows), "$0.00" while nothing is running.
  const runCost = run?.cost_total_usd ?? costs.reduce((sum, c) => sum + c.cost_usd, 0);
  const spendLabel = `$${runCost.toFixed(2)}`;
  // Part B: the avatar shows the first letter of the account's email.
  const avatarInitial = user?.email?.trim().charAt(0).toUpperCase() || "?";

  return (
    <>
      <header className="tv-topbar">
        <div className="flex items-center gap-3">
          <img src="/mark-coral.png" alt="" style={{ width: 24, height: 24 }} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: "var(--fw-display)" as unknown as number,
              fontSize: "var(--fs-h3)",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--text-primary)",
            }}
          >
            Tvashtr
          </span>
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)" }}>
            the living canvas
          </span>
        </div>
        {/* Part B: the account avatar → a click-to-open profile menu (the email + Log out), replacing
            the raw email + Log out text. The green backend dot moved OUT of the header to the toolbar. */}
        {user && (
          <div className="tv-avatar-wrap">
            <button
              type="button"
              className="tv-avatar"
              onClick={() => setProfileOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              aria-label="Account"
              title="Account"
            >
              {avatarInitial}
            </button>
            {profileOpen && (
              <>
                <div
                  className="tv-avatarmenu__catch"
                  onClick={() => setProfileOpen(false)}
                  aria-hidden
                />
                <div className="tv-avatarmenu" role="menu">
                  <div className="tv-avatarmenu__id">
                    <span className="tv-avatarmenu__avatar" aria-hidden>
                      {avatarInitial}
                    </span>
                    <span className="tv-avatarmenu__email" title={user.email}>
                      {user.email}
                    </span>
                  </div>
                  <div className="tv-avatarmenu__divider" />
                  <button
                    type="button"
                    className="tv-avatarmenu__logout"
                    role="menuitem"
                    onClick={() => onLogout?.()}
                  >
                    <LogOut size={15} strokeWidth={1.8} />
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <div className="tv-toolbar">
        {/* Part C: the back-to-dashboard arrow (replaces the header's "← Dashboard" text button). */}
        {onBackToDashboard && (
          <button
            type="button"
            className="tv-toolbar__back"
            onClick={() => onBackToDashboard()}
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden />
          </button>
        )}
        {/* Author: Run this team (or Configure providers when keys are missing). Run mode: Edit + Cancel
            + the run banner. */}
        {authoring ? (
          <>
            <span style={{ position: "relative", display: "inline-flex" }}>
              {!providersReady && credentialGate !== null ? (
                <button
                  className="tv-btn"
                  type="button"
                  onClick={() => onBackToDashboard?.("engines")}
                  disabled={!onBackToDashboard}
                  title={missingCredentialCtaTitle(launchTarget)}
                >
                  <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                  Configure providers
                </button>
              ) : (
                <button
                  className="tv-btn"
                  onClick={() => setLaunchOpen(true)}
                  disabled={starting || currentTeamId === null || !canLaunch}
                  title={
                    !teamRunnable
                      ? "Fix the team before running (see the issues)."
                      : undefined
                  }
                >
                  <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                  {starting ? "Starting…" : "Run this team"}
                </button>
              )}
              {launchOpen && currentTeamId !== null && canLaunch && (
                <LaunchPanel
                  teamNodes={teamGraph?.nodes ?? []}
                  starting={starting}
                  onLaunch={(opts) => void handleLaunch(opts)}
                  onClose={() => setLaunchOpen(false)}
                  hosted={config?.hosted_mode ?? false}
                  githubInstallUrl={config?.github_install_url ?? ""}
                  githubManageUrl={config?.github_manage_url ?? ""}
                />
              )}
            </span>
          </>
        ) : (
          <>
            <button className="tv-btn tv-btn--ghost" onClick={handleEditTeam} disabled={inFlight}>
              {inFlight ? "Running…" : "Edit this team"}
            </button>
            {inFlight && (
              <CancelRunButton onCancel={() => void handleCancel()} disabled={acting} />
            )}
            <RunBanner runId={runId} run={run} workflowStatus={workflowStatus} costs={costs} />
            <RunWarnings warnings={graph?.resolution_warnings ?? []} />
          </>
        )}
        {/* Blocked-launch signals: topology validity and/or missing provider credentials. */}
        {authoring && !teamRunnable && (
          <div className="tv-validity" role="status">
            <span className="tv-validity__lead">Can’t run yet:</span>
            <ul className="tv-validity__list">
              {validityErrors.slice(0, 4).map((issue, i) => (
                <li key={`${issue.code}:${issue.node_id ?? issue.edge_id ?? i}`}>
                  {issue.message}
                </li>
              ))}
              {validityErrors.length > 4 && <li>…and {validityErrors.length - 4} more.</li>}
            </ul>
          </div>
        )}
        {authoring && teamRunnable && !providersReady && credentialGate !== null && (
          <div className="tv-validity" role="status" data-testid="missing-providers">
            <span className="tv-validity__lead">Missing providers:</span>
            <ul className="tv-validity__list">
              {missingProviders.map((p) => (
                <li key={p}>{missingProviderBannerDetail(p, launchTarget)}</li>
              ))}
            </ul>
            {onBackToDashboard && (
              <button
                type="button"
                className="tv-btn tv-btn--ghost"
                style={{ marginLeft: "0.5rem" }}
                onClick={() => onBackToDashboard("engines")}
              >
                Open Engines
              </button>
            )}
          </div>
        )}
        {error && (
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{error}</span>
        )}
        {authoring && teamError && (
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
            Couldn't load your team — is the backend running?
          </span>
        )}
        {/* Right cluster: the run spend ($0.00 when idle) + a hairline divider + the green backend dot
            (moved out of the header). The design's static grid icon is intentionally omitted. */}
        <div className="tv-toolbar__right">
          <span className="tv-toolbar__spend" title="Spend this run">
            {spendLabel}
          </span>
          <span className="tv-toolbar__divider" aria-hidden />
          <BackendDot />
        </div>
      </div>

      <main className="flex min-h-0 flex-1">
        {/* Part A: no author-mode team rail — the canvas is full-width while authoring (the team
            library lives on the Dashboard). A left panel appears ONLY during a run (the tasks drawer). */}
        {!authoring && (
          <TasksDrawer
            blockers={pendingBlockers}
            nudges={pendingNudges}
            onResolve={(taskId, decision) => void handleResolve(taskId, decision)}
            onAcknowledge={(taskId) => void handleAcknowledge(taskId)}
            onFocusNode={setFocusNodeId}
            busy={acting}
          />
        )}
        <div className="relative min-w-0 flex-1">
          <TeamCanvas
            blockedNodes={blockedNodes}
            blockedReason={error ?? ""}
            graph={authoring ? teamAsGraph : graph}
            run={run}
            workflowStatus={workflowStatus}
            tasks={authoring ? EMPTY_TASKS : tasks}
            focusNodeId={focusNodeId}
            panelOpen={authoring ? selectedNodeId !== null : selectedRunNodeId !== null}
            onSelectNode={setSelectedRunNodeId}
            editable={authoring}
            teamNodes={teamGraph?.nodes ?? []}
            validity={validity}
            onAddNode={(body) => void handleAddNode(body)}
            onAddDownstream={(fromId, body) => void handleAddDownstream(fromId, body)}
            onCreateEdge={(c, source, target) => void handleCreateEdge(c, source, target)}
            onDeleteNodes={(ids) => void handleDeleteNodes(ids)}
            onDeleteEdges={(ids) => void handleDeleteEdges(ids)}
            onMoveNode={handleMoveNode}
            onSelectNodeId={handleSelectNodeId}
            onOpenModel={handleOpenModel}
            busy={editBusy}
          />
        </div>
        {authoring
          ? selectedNodeId &&
            currentTeamId && (
              <TeamNodePanel
                key={selectedNodeId}
                teamId={currentTeamId}
                node={selectedTeamNode}
                edges={teamGraph?.edges ?? []}
                nodes={teamGraph?.nodes ?? []}
                isStartNode={selectedTeamNode?.id === startNodeId}
                panelMode={panelMode}
                onTogglePanelMode={togglePanelMode}
                focusModel={focusModel}
                onSaved={() => loadTeam(currentTeamId)}
                onClose={() => handleSelectNodeId(null)}
                onManageMemory={
                  onBackToDashboard ? () => onBackToDashboard("tools") : undefined
                }
              />
            )
          : selectedRunNode && (
              <SidePanel
                node={selectedRunNode}
                runId={runId}
                run={run}
                workflowStatus={workflowStatus}
                panelMode={panelMode}
                onTogglePanelMode={togglePanelMode}
                onClose={() => setSelectedRunNodeId(null)}
              />
            )}
      </main>
    </>
  );
}
