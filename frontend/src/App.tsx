import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasHeader } from "./canvas/CanvasHeader";
import { CanvasToolbar } from "./canvas/CanvasToolbar";
import { RunBlockedBanner } from "./canvas/RunBlockedBanner";
import { credentialBlock, validityBlock } from "./canvas/runBlocked";
import { TeamCanvas } from "./canvas/TeamCanvas";
import "./canvas/chrome.css";
import { type DashView, navigate, type NodeTab } from "./lib/nav";
import { CancelRunButton } from "./components/CancelRunButton";
import { RunBanner } from "./components/RunBanner";
import { RunWarnings } from "./components/RunWarnings";
import { TasksDrawer } from "./components/TasksDrawer";
import { listTeamRuns, type RunDoc } from "./lib/api/docs";
import { docChipsByNode } from "./panel/docs/agentDocs";
import { DocumentsDrawer } from "./panel/docs/DocumentsDrawer";
import { DocumentViewer } from "./panel/docs/DocumentViewer";
import { useRunDocs } from "./panel/docs/useRunDocs";
import { NodeEditor } from "./panel/NodeEditor";
import { useLoaded } from "./panel/runs/useLoaded";
import { RunNodeDrawer } from "./panel/run/RunNodeDrawer";
import type { LeaveGuard } from "./panel/useUnsavedGuard";
import {
  acknowledgeTask,
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
  type GraphNode,
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
  saveTeamPositions,
  type TaskDecision,
  type TeamGraphData,
} from "./lib/api";
import {
  missingProvidersForModels,
  type SubscriptionProviderId,
  type SubscriptionStatus,
} from "./lib/engines";
import type { EdgeConfirm } from "./canvas/EdgeRoleEditor";
import { nextDropPosition, withLayout } from "./lib/topology";
import { requestHomeAction } from "./lib/homeActions";
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
  /** The public config (the old launch panel read it; launching now happens on Home). */
  config?: Config | null;
  /** The agent drawer's place from the address (`#/teams/<id>?node=&tab=&focus=1`). */
  node?: string;
  tab?: NodeTab;
  focus?: boolean;
  /** Write the drawer's place back to the address. Without it the drawer keeps its own state. */
  onNodeRoute?: (next: { node?: string; tab?: NodeTab; focus?: boolean }) => void;
  /** The document viewer's place from the address (`#/teams/<id>/docs/<doc>?v=&compare=`). */
  doc?: DocRoute;
  /** Write the viewer's place back to the address (null: closed); `push` when it opens. Without it
   * the viewer keeps its own state. */
  onDocRoute?: (next: DocRoute | null, opts: { push: boolean }) => void;
}

/** The open document, the version shown (none: the latest) and the one it's compared with. */
export interface DocRoute {
  id: string;
  version?: number;
  compare?: number;
}

/** Where the agent drawer is: which node, which tab, docked or in focus view. */
interface DrawerPlace {
  node: string | null;
  tab: NodeTab;
  focus: boolean;
}

export default function App({
  user,
  onLogout,
  teamId,
  initialRunId,
  onBackToDashboard,
  config,
  node: routeNode,
  tab: routeTab,
  focus: routeFocus,
  onNodeRoute,
  doc: routeDoc,
  onDocRoute,
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
  const [acting, setActing] = useState(false);
  // An error to show beside the toolbar (launching moved to Home's composer, so this is only ever
  // cleared here now; kept for the canvas' blocked-reason plumbing).
  const [error, setError] = useState<string | null>(null);
  const blockedNodes: string[] = [];
  // P1.8d: selection is by NODE ID (duplicate role names possible after topology edits), in the
  // authoring view and the run view alike. The drawer's place (node, tab, focus) lives in the page
  // address when the Workspace passes `onNodeRoute` (spec §3.2: refresh and back/forward keep it); a
  // bare mount keeps it here. The run view's drawer opens on Runs (Q20), the Team screen's on Setup.
  const defaultTab: NodeTab = runId === null ? "setup" : "runs";
  const [localPlace, setLocalPlace] = useState<DrawerPlace>({
    node: routeNode ?? null,
    tab: routeTab ?? defaultTab,
    focus: routeFocus ?? false,
  });
  const place: DrawerPlace = onNodeRoute
    ? { node: routeNode ?? null, tab: routeTab ?? defaultTab, focus: routeFocus ?? false }
    : localPlace;
  const selectedNodeId = place.node;
  const setPlace = useCallback(
    (next: DrawerPlace) => {
      if (onNodeRoute) {
        onNodeRoute({
          node: next.node ?? undefined,
          tab: next.node && next.tab !== defaultTab ? next.tab : undefined,
          focus: next.node && next.focus ? true : undefined,
        });
      } else {
        setLocalPlace(next);
      }
    },
    [onNodeRoute, defaultTab],
  );
  // Select a node (keeping the open tab) or close the drawer (null).
  const setSelectedNodeId = useCallback(
    (id: string | null) =>
      setPlace({ node: id, tab: id ? place.tab : defaultTab, focus: id ? place.focus : false }),
    [setPlace, place.tab, place.focus, defaultTab],
  );
  // PANEL-21: the open agent drawer registers its unsaved-changes guard here. Everything that would
  // drop its draft (Close, selecting another node, leaving the canvas) goes through `guardLeave`,
  // which runs at once when the draft is clean and otherwise asks "Save your changes to <Name>?".
  const leaveGuardRef = useRef<LeaveGuard | null>(null);
  // The document viewer's unsaved live edit asks first (DOCS-31), then the agent drawer.
  const docGuardRef = useRef<LeaveGuard | null>(null);
  // Bumped when the user keeps editing: a click on another card has already moved React Flow's
  // selection there, so the canvas rings the open agent again.
  const [ringKey, setRingKey] = useState(0);
  const guardLeave = useCallback((proceed: () => void) => {
    const agentGuard = () => {
      const guard = leaveGuardRef.current;
      if (guard) guard(proceed, () => setRingKey((k) => k + 1));
      else proceed();
    };
    const docGuard = docGuardRef.current;
    if (docGuard) docGuard(agentGuard);
    else agentGuard();
  }, []);
  // The document viewer (DOCS-18): its place lives in the address when the Workspace passes
  // `onDocRoute`; opening it adds a history step, moving inside it doesn't.
  const [localDoc, setLocalDoc] = useState<DocRoute | null>(routeDoc ?? null);
  const docRoute = onDocRoute ? (routeDoc ?? null) : localDoc;
  const setDocRoute = useCallback(
    (next: DocRoute | null, push = false) =>
      onDocRoute ? onDocRoute(next, { push }) : setLocalDoc(next),
    [onDocRoute],
  );
  const openDoc = useCallback(
    (docId: string, at: Omit<DocRoute, "id"> = {}) => setDocRoute({ id: docId, ...at }, true),
    [setDocRoute],
  );
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  // The toolbar's Documents drawer (DOCS-12): the run it shows. Never beside an agent drawer (OQ-20).
  const [docsDrawer, setDocsDrawer] = useState<{ runId: string } | null>(null);
  // Credential preflight for Run (UX): null until the first successful providers load so we
  // don't flash-disable the CTA; once loaded, missing BYOK (and no Desktop subscription cover)
  // blocks launch and points at Engines.
  const [credentialGate, setCredentialGate] = useState<{
    byok: Set<string>;
    subs: Partial<Record<SubscriptionProviderId, boolean>>;
  } | null>(null);

  // Authoring vs run: with no active run the canvas shows the persistent team; once a run launches
  // the existing live run view takes over (graph/run/tasks polled as before).
  const authoring = runId === null;
  const terminal = isRunTerminal(run, workflowStatus);

  // Load BYOK + subscription coverage while authoring so Run can gate on missing providers.
  useEffect(() => {
    if (!authoring) return;
    let cancelled = false;
    void (async () => {
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
          guardLeave(() => setSelectedNodeId(created.id));
        }
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setEditBusy(false);
      }
    },
    [currentTeamId, teamGraph, loadTeam, setSelectedNodeId, guardLeave],
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
    [currentTeamId, loadTeam, selectedNodeId, setSelectedNodeId],
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

  // Author-canvas node selection (a card-body click / the pane-click deselect / the drawer's Close).
  const handleSelectNodeId = useCallback(
    (id: string | null) => {
      if (id === selectedNodeId) return;
      guardLeave(() => {
        if (id) setDocsDrawer(null);
        setSelectedNodeId(id);
      });
    },
    [selectedNodeId, setSelectedNodeId, guardLeave],
  );

  // The node card's model chip was clicked (author mode): open that agent on Setup, where its Model
  // row is.
  const handleOpenModel = useCallback(
    (nodeId: string) => {
      const open = () => {
        setDocsDrawer(null);
        setPlace({ node: nodeId, tab: "setup", focus: false });
      };
      if (nodeId === selectedNodeId) open();
      else guardLeave(open);
    },
    [setPlace, selectedNodeId, guardLeave],
  );

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
    setSelectedNodeId(null);
    setFocusNodeId(null);
  }, [setSelectedNodeId]);

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
  // The run view's selected agent, by id so two same-role nodes select independently. Only an agent
  // opens there (a gate's approval lives in the Tasks drawer), even from a hand-typed address.
  const selectedRunNode = authoring
    ? null
    : (graph?.nodes.find(
        (n) => n.id === selectedNodeId && (n.kind === "agent" || n.kind === "completion"),
      ) ?? null);

  // Documents (DOCS-10..17): the toolbar's run is the team's latest run while authoring, else the
  // run on screen. A finished round in the run view refetches its documents (new versions).
  const teamRuns = useLoaded(currentTeamId, () => listTeamRuns(currentTeamId ?? ""));
  const toolbarRunId = authoring ? (teamRuns.value?.[0]?.run_id ?? null) : runId;
  const roundsTick = authoring
    ? ""
    : (graph?.nodes.map((n) => `${n.status}:${n.iteration}`).join(",") ?? "");
  const toolbarDocs = useRunDocs(toolbarRunId, roundsTick);
  const docChips = useMemo(
    () => (toolbarDocs ? docChipsByNode(toolbarDocs.documents, !authoring) : undefined),
    [toolbarDocs, authoring],
  );
  const agentCount = ((authoring ? teamGraph?.nodes : graph?.nodes) ?? []).filter(
    (n) => n.kind === "agent" || n.kind === "completion",
  ).length;
  const nodeDrawerOpen = authoring ? selectedTeamNode !== null : selectedRunNode !== null;
  const docsOpen = docsDrawer !== null && !nodeDrawerOpen;
  // OQ-20: opening the Documents drawer closes the agent drawer (through its unsaved guard).
  const openDocuments = useCallback(
    (docsRunId: string) =>
      guardLeave(() => {
        if (selectedNodeId !== null) setPlace({ node: null, tab: defaultTab, focus: false });
        setDocsDrawer({ runId: docsRunId });
      }),
    [guardLeave, selectedNodeId, setPlace, defaultTab],
  );
  // A canvas chip opens its document in the viewer.
  const openChipDoc = useCallback((doc: RunDoc) => openDoc(doc.id), [openDoc]);
  const openRunDoc = useCallback((docId: string) => openDoc(docId), [openDoc]);
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
  // Why Run is disabled, as the canvas callout says it: the team's blocking findings first, then the
  // providers nothing covers (the same rule POST /api/runs enforces).
  const runBlock = !authoring
    ? null
    : !teamRunnable
      ? validityBlock(validityErrors)
      : credentialGate !== null
        ? credentialBlock(missingProviders, launchTarget === "local")
        : null;
  const openEngines = onBackToDashboard
    ? () => guardLeave(() => onBackToDashboard("engines"))
    : undefined;
  // The run drawer's "Edit on the team": the team this run came from, with the agent the run
  // copied open on Setup.
  const editOnTeam = (node: GraphNode) => {
    const teamOfRun = run?.library_team_id ?? currentTeamId;
    const origin = node.origin_node_id;
    return teamOfRun && origin
      ? () => navigate({ page: "team", teamId: teamOfRun, node: origin })
      : undefined;
  };

  return (
    <>
      <CanvasHeader user={user} onLogout={onLogout} />
      <CanvasToolbar
        onBack={onBackToDashboard ? () => guardLeave(() => onBackToDashboard()) : undefined}
        // One launch surface (spec §4.6, Q18): Run opens Home's "Start a run" composer with this
        // team picked.
        run={
          authoring
            ? {
                disabled: currentTeamId === null || !canLaunch,
                title: runBlock?.title,
                onRun: () =>
                  currentTeamId &&
                  guardLeave(() => requestHomeAction({ kind: "new-run", teamId: currentTeamId })),
              }
            : undefined
        }
        teamName={teamGraph?.name ?? ""}
        spend={spendLabel}
        docs={
          toolbarRunId
            ? {
                count: toolbarDocs ? toolbarDocs.documents.length : null,
                open: docsOpen,
                onToggle: () => (docsOpen ? setDocsDrawer(null) : openDocuments(toolbarRunId)),
              }
            : undefined
        }
      >
        {!authoring && (
          <>
            <button className="tv-btn tv-btn--ghost" onClick={handleEditTeam} disabled={inFlight}>
              {inFlight ? "Running…" : "Edit this team"}
            </button>
            {inFlight && <CancelRunButton onCancel={() => void handleCancel()} disabled={acting} />}
            <RunBanner runId={runId} run={run} workflowStatus={workflowStatus} costs={costs} />
            <RunWarnings warnings={graph?.resolution_warnings ?? []} />
          </>
        )}
        {error && <span className="cv-error">{error}</span>}
        {authoring && teamError && (
          <span className="cv-error">Couldn't load your team — is the backend running?</span>
        )}
      </CanvasToolbar>

      <main className="cv-main">
        {docsOpen && docsDrawer && (
          <DocumentsDrawer
            runs={teamRuns}
            runId={docsDrawer.runId}
            tick={roundsTick}
            onPickRun={(id) => setDocsDrawer({ runId: id })}
            agentCount={agentCount}
            onOpenDoc={(doc) => openDoc(doc.id)}
            onClose={() => setDocsDrawer(null)}
          />
        )}
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
        <div className="cv-canvas">
          <TeamCanvas
            blockedNodes={blockedNodes}
            blockedReason={error ?? ""}
            graph={authoring ? teamAsGraph : graph}
            run={run}
            workflowStatus={workflowStatus}
            tasks={authoring ? EMPTY_TASKS : tasks}
            focusNodeId={focusNodeId}
            panelOpen={docsOpen ? "docs" : nodeDrawerOpen}
            onSelectNode={(id) => {
              if (id) setDocsDrawer(null);
              setSelectedNodeId(id);
            }}
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
            ringKey={ringKey}
            onOpenModel={handleOpenModel}
            busy={editBusy}
            selectedNodeId={selectedNodeId}
            docChips={docChips}
            onOpenDoc={openChipDoc}
          />
          {runBlock && <RunBlockedBanner block={runBlock} onOpenEngines={openEngines} />}
        </div>
        {authoring
          ? selectedTeamNode &&
            currentTeamId && (
              <NodeEditor
                key={selectedTeamNode.id}
                teamId={currentTeamId}
                node={selectedTeamNode}
                nodes={teamGraph?.nodes ?? []}
                edges={teamGraph?.edges ?? []}
                isEntry={selectedTeamNode.id === startNodeId}
                cover={credentialGate}
                tab={place.tab}
                onTabChange={(tab) => setPlace({ ...place, tab })}
                focus={place.focus}
                onFocusChange={(focus) => setPlace({ ...place, focus })}
                onClose={() => handleSelectNodeId(null)}
                onSaved={() => loadTeam(currentTeamId)}
                guardRef={leaveGuardRef}
                onDelete={() => handleDeleteNodes([selectedTeamNode.id])}
                catalogue={config?.provider_catalogue}
                onOpenEngines={
                  onBackToDashboard
                    ? (tab) =>
                        guardLeave(() =>
                          tab === "overview"
                            ? onBackToDashboard("engines")
                            : navigate({ page: "engines", tab }),
                        )
                    : undefined
                }
                onOpenToolkit={(route) => guardLeave(() => navigate(route))}
                onOpenDocuments={(docsRunId) => openDocuments(docsRunId)}
                onOpenDoc={openDoc}
                onOpenRun={(openRunId) =>
                  guardLeave(() =>
                    navigate({ page: "team", teamId: currentTeamId, runId: openRunId }),
                  )
                }
                onProviderAdded={(provider) =>
                  setCredentialGate((gate) =>
                    gate ? { ...gate, byok: new Set([...gate.byok, provider]) } : gate,
                  )
                }
              />
            )
          : selectedRunNode &&
            graph && (
              <RunNodeDrawer
                key={selectedRunNode.id}
                node={selectedRunNode}
                nodes={graph.nodes}
                edges={graph.edges}
                isEntry={!graph.edges.some((e) => e.target_node_id === selectedRunNode.id)}
                runId={runId}
                run={run}
                workflowStatus={workflowStatus}
                tab={place.tab}
                onTabChange={(tab) => setPlace({ ...place, tab })}
                onClose={() => setSelectedNodeId(null)}
                onOpenDoc={openRunDoc}
                onEditOnTeam={editOnTeam(selectedRunNode)}
              />
            )}
        {/* Over a focus view, the viewer mounts after it (once the team is in), so the viewer is
            the top overlay that owns Escape and Tab — a reload on the address included. */}
        {docRoute && !(authoring && selectedNodeId && place.focus && !teamGraph) && (
          <DocumentViewer
            docId={docRoute.id}
            place={{ version: docRoute.version, compare: docRoute.compare }}
            runs={teamRuns.value}
            onPlace={(id, p) => setDocRoute({ id, ...p })}
            onClose={() => setDocRoute(null)}
            guardRef={docGuardRef}
          />
        )}
      </main>
    </>
  );
}
