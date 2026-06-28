import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import { ABCompare } from "./components/ABCompare";
import { BackendDot } from "./components/BackendDot";
import { CancelRunButton } from "./components/CancelRunButton";
import { LaunchPanel } from "./components/LaunchPanel";
import { RunBanner } from "./components/RunBanner";
import { TasksDrawer } from "./components/TasksDrawer";
import { TeamsRail } from "./components/TeamsRail";
import { SidePanel } from "./panel/SidePanel";
import { TeamNodePanel } from "./panel/TeamNodePanel";
import {
  acknowledgeTask,
  type AuthUser,
  cancelRun,
  type CostRow,
  createTeam,
  type CreateNodeBody,
  createTeamEdge,
  createTeamNode,
  deleteTeam,
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
  getTemplates,
  type HumanTask,
  type NodePosition,
  resolveTask,
  type RunRow,
  runTeam,
  type RunTeamOptions,
  saveTeamPositions,
  type TaskDecision,
  type TeamGraphData,
  type TeamSummary,
  type Template,
} from "./lib/api";
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
// `onBackToDashboard` control. All optional → existing tests/usage that render <App /> are unchanged.
interface AppProps {
  user?: AuthUser | null;
  onLogout?: () => void;
  teamId?: string;
  onBackToDashboard?: () => void;
}

export default function App({ user, onLogout, teamId, onBackToDashboard }: AppProps = {}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  // The team library (P1.8b): the user's library teams (the rail) + the starter templates (the
  // picker), the currently-open team, and that team's graph (rendered on the canvas while no run is
  // active). `teams`/`currentTeamId` PERSIST across a run — only run-scoped state resets.
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  // M-accounts Slice B: when opened from the dashboard for a specific team, start on THAT team (the
  // loadTeams `cur ?? list[0]` guard then keeps it); standalone (no teamId) keeps the prior
  // first-team default.
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(teamId ?? null);
  const [teamGraph, setTeamGraph] = useState<TeamGraphData | null>(null);
  const [teamError, setTeamError] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  // P1.8d: the current team's holistic-validity verdict (refetched after every topology edit). Run
  // is gated on `validity.runnable`; the offending nodes/edges are flagged on the canvas.
  const [validity, setValidity] = useState<GraphValidity | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  // M-brownfield Slice 2: "Run this team" opens the launch panel (it no longer fires the run
  // directly); the panel's Run calls `handleLaunch` with the assembled options.
  const [launchOpen, setLaunchOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(false);
  // Run-view selection is by NODE ID (Option A): a topology-edited team can carry duplicate role
  // names (e.g. two blank thinkers), so the run panel keys on the unique node id — the run-view twin
  // of the authoring `selectedNodeId` below.
  const [selectedRunNodeId, setSelectedRunNodeId] = useState<string | null>(null);
  // P1.8d: authoring selection is by NODE ID too (duplicate role names possible after topology edits).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  // The view mode (§14.3): the existing single-run canvas, or the A/B comparison. Plain state,
  // no router — the single-run state/poll stay alive underneath so switching back is lossless.
  const [mode, setMode] = useState<"single" | "ab">("single");

  // Authoring vs run: with no active run the canvas shows the persistent team; once a run launches
  // the existing live run view takes over (graph/run/tasks polled as before).
  const authoring = runId === null;
  const terminal = isRunTerminal(run, workflowStatus);
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

  // Load the library teams (the rail) + the starter templates (the picker). On first load, pick the
  // first team as current. Tolerant: a transient failure shows a hint and keeps the last list.
  const loadTeams = useCallback(async () => {
    try {
      const [list, tmpls] = await Promise.all([getTeams(), getTemplates()]);
      if (!mountedRef.current) return;
      setTeams(list);
      setTemplates(tmpls);
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
  // run view then takes over (same poll surface as before). `teams`/`currentTeamId` survive
  // `resetRunState`, so returning to authoring lands back on the same team. A no-field `opts` posts
  // exactly `{ team_graph_id }` — the greenfield launch is byte-for-byte unchanged.
  const handleLaunch = useCallback(
    async (opts: RunTeamOptions) => {
      if (!currentTeamId) return;
      setLaunchOpen(false);
      setStarting(true);
      setError(false);
      resetRunState();
      try {
        const id = await runTeam(currentTeamId, opts);
        const g = await getGraph(id);
        setGraph(g);
        setRunId(id);
      } catch {
        setError(true);
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
    setError(false);
    if (currentTeamId) void loadTeam(currentTeamId);
  }, [resetRunState, loadTeam, currentTeamId]);

  // Select a team in the rail: make it current (the effect loads its graph) and close any open
  // node panel (it was editing the previous team's node).
  const handleSelectTeam = useCallback((teamId: string) => {
    setSelectedRunNodeId(null);
    setSelectedNodeId(null);
    setCurrentTeamId(teamId);
  }, []);

  // "+ New team": create a library team from a template, make it current, and refresh the rail.
  const handleCreateTeam = useCallback(
    async (template: string, name: string) => {
      setTeamBusy(true);
      setTeamError(false);
      try {
        const created = await createTeam(template, name);
        if (!mountedRef.current) return;
        setSelectedRunNodeId(null);
        setSelectedNodeId(null);
        setCurrentTeamId(created.team_graph_id); // the effect loads its graph
        await loadTeams(); // the new team appears in the rail (keeps currentTeamId via the ?? guard)
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setTeamBusy(false);
      }
    },
    [loadTeams],
  );

  // Delete a library team. The server re-seeds if it was the last, so the rail is never empty; if
  // the deleted team was current, fall back to the first remaining team.
  const handleDeleteTeam = useCallback(
    async (teamId: string) => {
      setTeamBusy(true);
      setTeamError(false);
      try {
        await deleteTeam(teamId);
        const remaining = await getTeams(); // re-seeds server-side if this was the last team
        if (!mountedRef.current) return;
        setTeams(remaining);
        if (teamId === currentTeamId) {
          setSelectedRunNodeId(null);
          setSelectedNodeId(null);
          setCurrentTeamId(remaining[0]?.team_graph_id ?? null);
        }
      } catch {
        if (mountedRef.current) setTeamError(true);
      } finally {
        if (mountedRef.current) setTeamBusy(false);
      }
    },
    [currentTeamId],
  );

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

  return (
    <>
      <header
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}
      >
        <div className="flex items-center gap-3">
          {onBackToDashboard && (
            <button
              type="button"
              className="tv-btn tv-btn--ghost tv-btn--sm"
              onClick={onBackToDashboard}
            >
              ← Dashboard
            </button>
          )}
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
        <div className="flex items-center gap-3">
          {user && (
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)" }}>
              {user.email}
            </span>
          )}
          {onLogout && (
            <button type="button" className="tv-btn tv-btn--ghost tv-btn--sm" onClick={onLogout}>
              Log out
            </button>
          )}
          <BackendDot />
        </div>
      </header>

      <div
        className="flex flex-wrap items-center gap-4 px-6 py-3"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}
      >
        <div className="tv-seg" role="group" aria-label="View mode">
          <button
            type="button"
            aria-pressed={mode === "single"}
            className={`tv-seg__btn${mode === "single" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setMode("single")}
          >
            Single run
          </button>
          <button
            type="button"
            aria-pressed={mode === "ab"}
            className={`tv-seg__btn${mode === "ab" ? " tv-seg__btn--active" : ""}`}
            onClick={() => setMode("ab")}
          >
            A/B compare
          </button>
        </div>
        {mode === "single" && (
          <>
            {authoring ? (
              <span style={{ position: "relative", display: "inline-flex" }}>
                <button
                  className="tv-btn"
                  onClick={() => setLaunchOpen(true)}
                  disabled={starting || currentTeamId === null || !teamRunnable}
                  title={teamRunnable ? undefined : "Fix the team before running (see the issues)."}
                >
                  {starting ? "Starting…" : "Run this team"}
                </button>
                {launchOpen && currentTeamId !== null && (
                  <LaunchPanel
                    teamNodes={teamGraph?.nodes ?? []}
                    starting={starting}
                    onLaunch={(opts) => void handleLaunch(opts)}
                    onClose={() => setLaunchOpen(false)}
                  />
                )}
              </span>
            ) : (
              <>
                <button className="tv-btn" onClick={handleEditTeam} disabled={inFlight}>
                  {inFlight ? "Running…" : "Edit this team"}
                </button>
                {inFlight && (
                  <CancelRunButton onCancel={() => void handleCancel()} disabled={acting} />
                )}
                <RunBanner runId={runId} run={run} workflowStatus={workflowStatus} costs={costs} />
              </>
            )}
            {authoring && teamRunnable && (
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)" }}>
                Drag from a node’s edge to wire it; drop nodes from the palette; click a node to
                edit.
              </span>
            )}
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
            {error && (
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
                Couldn't start the run — is the backend running?
              </span>
            )}
            {teamError && authoring && (
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
                Couldn't load your team — is the backend running?
              </span>
            )}
          </>
        )}
      </div>

      <main className="flex min-h-0 flex-1">
        {mode === "single" ? (
          <>
            {authoring ? (
              <TeamsRail
                teams={teams}
                currentTeamId={currentTeamId}
                templates={templates}
                onSelect={handleSelectTeam}
                onCreate={(template, name) => void handleCreateTeam(template, name)}
                onDelete={(teamId) => void handleDeleteTeam(teamId)}
                busy={teamBusy}
              />
            ) : (
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
                onCreateEdge={(c, source, target) => void handleCreateEdge(c, source, target)}
                onDeleteNodes={(ids) => void handleDeleteNodes(ids)}
                onDeleteEdges={(ids) => void handleDeleteEdges(ids)}
                onMoveNode={handleMoveNode}
                onSelectNodeId={setSelectedNodeId}
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
                    isStartNode={selectedTeamNode?.id === startNodeId}
                    onSaved={() => loadTeam(currentTeamId)}
                    onClose={() => setSelectedNodeId(null)}
                  />
                )
              : selectedRunNode && (
                  <SidePanel
                    node={selectedRunNode}
                    runId={runId}
                    run={run}
                    workflowStatus={workflowStatus}
                    onClose={() => setSelectedRunNodeId(null)}
                  />
                )}
          </>
        ) : (
          <ABCompare />
        )}
      </main>
    </>
  );
}
