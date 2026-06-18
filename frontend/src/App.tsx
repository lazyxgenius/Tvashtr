import { useCallback, useEffect, useRef, useState } from "react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import { BackendDot } from "./components/BackendDot";
import { CancelRunButton } from "./components/CancelRunButton";
import { RunBanner } from "./components/RunBanner";
import { TasksForHuman } from "./components/TasksForHuman";
import { SidePanel } from "./panel/SidePanel";
import {
  cancelRun,
  type CostRow,
  type GraphData,
  getGraph,
  getRunStatus,
  getRunTasks,
  type HumanTask,
  resolveTask,
  type RunRow,
  startRun,
  type TaskDecision,
} from "./lib/api";
import { isRunTerminal } from "./lib/status";

export default function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [starting, setStarting] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const terminal = isRunTerminal(run, workflowStatus);
  const inFlight = runId !== null && !terminal;
  // Tasks acted on this run — suppress them so the strip can't briefly resurrect
  // on the immediate re-poll (which can catch the backend a beat before the task
  // is marked resolved). A full-width band flashing back = a canvas flicker.
  const resolvedIdsRef = useRef<Set<number>>(new Set());
  const pendingTasks = tasks.filter(
    (t) => t.status === "pending" && t.blocking && !resolvedIdsRef.current.has(t.id),
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

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(false);
    setRunId(null);
    setGraph(null);
    setRun(null);
    setWorkflowStatus(null);
    setCosts([]);
    setTasks([]);
    resolvedIdsRef.current = new Set(); // a new run starts with a clean slate
    setSelectedRole(null);
    try {
      const id = await startRun();
      const g = await getGraph(id);
      setGraph(g);
      setRunId(id);
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  }, []);

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
      setTasks((ts) => ts.filter((t) => t.id !== taskId)); // optimistic: clear the card
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

  const handleCancel = useCallback(async () => {
    if (!runId) return;
    setActing(true);
    // Suppress every still-pending task before clearing, so the immediate re-poll
    // can't flash the strip back before the backend closes them.
    setTasks((ts) => {
      for (const t of ts) {
        if (t.status === "pending" && t.blocking) resolvedIdsRef.current.add(t.id);
      }
      return [];
    });
    try {
      await cancelRun(runId);
    } catch {
      /* reconciled by the immediate pull below */
    } finally {
      setActing(false);
    }
    void pull();
  }, [runId, pull]);

  const buttonLabel = starting
    ? "Starting…"
    : inFlight
      ? "Running…"
      : runId
        ? "Start another run"
        : "Start the run";

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
        <button className="tv-btn" onClick={() => void handleStart()} disabled={starting || inFlight}>
          {buttonLabel}
        </button>
        {inFlight && <CancelRunButton onCancel={() => void handleCancel()} disabled={acting} />}
        <RunBanner runId={runId} run={run} workflowStatus={workflowStatus} costs={costs} />
        {error && (
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
            Couldn't start the run — is the backend running?
          </span>
        )}
      </div>

      <TasksForHuman
        tasks={pendingTasks}
        onResolve={(taskId, decision) => void handleResolve(taskId, decision)}
        busy={acting}
      />

      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <TeamCanvas
            graph={graph}
            run={run}
            workflowStatus={workflowStatus}
            panelOpen={selectedRole !== null}
            onSelectNode={setSelectedRole}
          />
        </div>
        {selectedRole && (
          <SidePanel
            selectedRole={selectedRole}
            iteration={graph?.nodes.find((n) => n.role_name === selectedRole)?.iteration ?? 0}
            runId={runId}
            run={run}
            workflowStatus={workflowStatus}
            onClose={() => setSelectedRole(null)}
          />
        )}
      </main>
    </>
  );
}
