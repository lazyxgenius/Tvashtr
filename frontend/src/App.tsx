import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import { ABCompare } from "./components/ABCompare";
import { BackendDot } from "./components/BackendDot";
import { CancelRunButton } from "./components/CancelRunButton";
import { RunBanner } from "./components/RunBanner";
import { TasksDrawer } from "./components/TasksDrawer";
import { TeamsRail } from "./components/TeamsRail";
import { SidePanel } from "./panel/SidePanel";
import { TeamNodePanel } from "./panel/TeamNodePanel";
import {
  acknowledgeTask,
  cancelRun,
  type CostRow,
  createTeam,
  deleteTeam,
  type GraphData,
  getGraph,
  getRunStatus,
  getRunTasks,
  getTeamGraph,
  getTeams,
  getTemplates,
  type HumanTask,
  resolveTask,
  type RunRow,
  runTeam,
  type TaskDecision,
  type TeamGraphData,
  type TeamSummary,
  type Template,
} from "./lib/api";
import { isRunTerminal } from "./lib/status";

export default function App() {
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
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
  const [teamGraph, setTeamGraph] = useState<TeamGraphData | null>(null);
  const [teamError, setTeamError] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
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

  // Load one team's graph onto the canvas. Tolerant in the same way as `loadTeams`.
  const loadTeam = useCallback(async (teamId: string) => {
    try {
      const t = await getTeamGraph(teamId);
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
    setSelectedRole(null);
    setFocusNodeId(null);
  }, []);

  // "Run this team": clone the CURRENT team into a fresh run-scoped snapshot and launch it; the
  // existing live run view then takes over (same poll surface as before). `teams`/`currentTeamId`
  // survive `resetRunState`, so returning to authoring lands back on the same team.
  const handleRunTeam = useCallback(async () => {
    if (!currentTeamId) return;
    setStarting(true);
    setError(false);
    resetRunState();
    try {
      const id = await runTeam(currentTeamId);
      const g = await getGraph(id);
      setGraph(g);
      setRunId(id);
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  }, [currentTeamId, resetRunState]);

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
    setSelectedRole(null);
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
        setSelectedRole(null);
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
          setSelectedRole(null);
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
                disabled={starting || currentTeamId === null}
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
                tasks={authoring ? [] : tasks}
                focusNodeId={focusNodeId}
                panelOpen={selectedRole !== null}
                onSelectNode={setSelectedRole}
              />
            </div>
            {selectedRole &&
              (authoring ? (
                currentTeamId && (
                  <TeamNodePanel
                    key={selectedRole}
                    teamId={currentTeamId}
                    node={selectedTeamNode}
                    onSaved={() => loadTeam(currentTeamId)}
                    onClose={() => setSelectedRole(null)}
                  />
                )
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
