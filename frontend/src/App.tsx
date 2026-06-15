import { useCallback, useEffect, useState } from "react";

import { TeamCanvas } from "./canvas/TeamCanvas";
import { BackendDot } from "./components/BackendDot";
import { RunBanner } from "./components/RunBanner";
import {
  type CostRow,
  type GraphData,
  getGraph,
  getRunStatus,
  type RunRow,
  startRun,
} from "./lib/api";
import { isRunTerminal } from "./lib/status";

export default function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);

  const terminal = isRunTerminal(run, workflowStatus);
  const inFlight = runId !== null && !terminal;

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(false);
    setRunId(null);
    setGraph(null);
    setRun(null);
    setWorkflowStatus(null);
    setCosts([]);
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

  // Poll the run while it is active and not terminal; stop once terminal.
  useEffect(() => {
    if (!runId || terminal) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getRunStatus(runId);
        if (cancelled) return;
        setRun(s.run);
        setWorkflowStatus(s.workflow_status);
        setCosts(s.costs);
      } catch {
        /* transient — keep the last snapshot and retry next tick */
      }
    };
    void poll();
    const handle = setInterval(poll, 1800);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [runId, terminal]);

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
        <button
          className="tv-btn"
          onClick={() => void handleStart()}
          disabled={starting || inFlight}
        >
          {buttonLabel}
        </button>
        <RunBanner runId={runId} run={run} workflowStatus={workflowStatus} costs={costs} />
        {error && (
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
            Couldn't start the run — is the backend running?
          </span>
        )}
      </div>

      <main className="relative min-h-0 flex-1">
        <TeamCanvas graph={graph} run={run} workflowStatus={workflowStatus} />
      </main>
    </>
  );
}
