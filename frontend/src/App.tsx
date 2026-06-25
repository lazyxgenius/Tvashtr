import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import { ABCompare } from "./components/ABCompare";
import { BackendDot } from "./components/BackendDot";
import { CancelRunButton } from "./components/CancelRunButton";
import { RunBanner } from "./components/RunBanner";
import { TasksDrawer } from "./components/TasksDrawer";
import { SidePanel } from "./panel/SidePanel";
import { TeamNodePanel } from "./panel/TeamNodePanel";
import {
  acknowledgeTask,
  cancelRun,
  type CostRow,
  type GraphData,
  getGraph,
  getRunStatus,
  getRunTasks,
  getTeamGraph,
  type HumanTask,
  resolveTask,
  type RunRow,
  runTeam,
  type TaskDecision,
  type TeamGraphData,
} from "./lib/api";
import { isRunTerminal } from "./lib/status";

export default function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  // The persistent authored team (P1.8b): fetched once on open and after each node-edit Save. The
  // canvas renders it while no run is active (the authoring view); "Run this team" clones+launches.
  const [teamGraph, setTeamGraph] = useState<TeamGraphData | null>(null);
  const [teamError, setTeamError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
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

  // Load the persistent authored team (the canvas's default view). Tolerant: a transient failure
  // shows a hint and keeps the last team; a malformed body is ignored (the canvas stays empty).
  const loadTeam = useCallback(async () => {
    try {
      const t = await getTeamGraph();
      if (!mountedRef.current) return;
      if (Array.isArray(t?.nodes)) {
        setTeamGraph(t);
        setTeamError(false);
      }
    } catch {
      if (mountedRef.current) setTeamError(true);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

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
    setSelectedRole(null);
    setFocusNodeId(null);
  }, []);

  // "Run this team": clone the authored team into a fresh run-scoped snapshot and launch it; the
  // existing live run view then takes over (same poll surface as before).
  const handleRunTeam = useCallback(async () => {
    if (!teamGraph) return;
    setStarting(true);
    setError(false);
    resetRunState();
    try {
      const id = await runTeam(teamGraph.team_graph_id);
      const g = await getGraph(id);
      setGraph(g);
      setRunId(id);
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  }, [teamGraph, resetRunState]);

  // Return to the authoring view (after a run finishes) to edit the team and run again. Refetches
  // the team so any edits made elsewhere are reflected.
  const handleEditTeam = useCallback(() => {
    resetRunState();
    setError(false);
    void loadTeam();
  }, [resetRunState, loadTeam]);

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
    return {
      run_id: teamGraph.team_graph_id,
      team_graph_id: teamGraph.team_graph_id,
      nodes: teamGraph.nodes.map((n) => ({
        ...n,
        model: n.model ?? "",
        status: "idle",
        iteration: 0,
        invocations: [],
      })),
      edges: teamGraph.edges,
    };
  }, [teamGraph]);

  const selectedTeamNode = teamGraph?.nodes.find((n) => n.role_name === selectedRole) ?? null;

  return (
    <>
      <header
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: "1px solid var(--border-hairline)" }}
      >
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
        <BackendDot />
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
              <button
                className="tv-btn"
                onClick={() => void handleRunTeam()}
                disabled={starting || teamGraph === null}
              >
                {starting ? "Starting…" : "Run this team"}
              </button>
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
            {authoring && (
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)" }}>
                Click an agent node to edit its prompt + model, then run.
              </span>
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
                graph={authoring ? teamAsGraph : graph}
                run={run}
                workflowStatus={workflowStatus}
                tasks={authoring ? [] : tasks}
                focusNodeId={focusNodeId}
                panelOpen={selectedRole !== null}
                onSelectNode={setSelectedRole}
              />
            </div>
            {selectedRole &&
              (authoring ? (
                <TeamNodePanel
                  key={selectedRole}
                  node={selectedTeamNode}
                  onSaved={loadTeam}
                  onClose={() => setSelectedRole(null)}
                />
              ) : (
                <SidePanel
                  selectedRole={selectedRole}
                  invocations={
                    graph?.nodes.find((n) => n.role_name === selectedRole)?.invocations ?? []
                  }
                  runId={runId}
                  run={run}
                  workflowStatus={workflowStatus}
                  onClose={() => setSelectedRole(null)}
                />
              ))}
          </>
        ) : (
          <ABCompare />
        )}
      </main>
    </>
  );
}
