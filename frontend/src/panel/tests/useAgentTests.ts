/**
 * M7 — the Tests tab's data: the agent's tests and its newest test run, read when the tab first
 * wants them and every 2 s while a run is going (R15). A failed poll keeps what's on screen and tries
 * again; Run all and Stop put the run they get back in place at once.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AgentTests,
  listTests,
  runTests,
  stopTests,
  type TestRun,
} from "../../lib/api/agentTests";

export const TESTS_POLL_MS = 2000;

export interface AgentTestsApi {
  state: "idle" | "loading" | "error" | "ready";
  value: AgentTests | null;
  /** When `value` was read (the running timer counts on from it). */
  readAt: number;
  /** The newest run is going. */
  running: boolean;
  /** A run this tab saw going that has since ended (its header reads "5 of 6 passed"). */
  watched: string | null;
  retry: () => void;
  /** Read again now (after a test is added or deleted). */
  reload: () => void;
  /** Run all N (throws the server's refusal). */
  runAll: () => Promise<void>;
  stop: () => Promise<void>;
}

interface Got {
  key: string;
  value: AgentTests | null;
  failed: boolean;
  /** Bumped on every reply (or failure), so the poll re-arms even when nothing changed. */
  seq: number;
  at: number;
}

export function useAgentTests(
  teamId: string,
  nodeId: string,
  wanted: boolean,
  /** A run this tab watched has ended (the canvas chip and the tab count read the graph again). */
  onRunEnded?: () => void,
): AgentTestsApi {
  const key = `${teamId}:${nodeId}`;
  const [got, setGot] = useState<Got | null>(null);
  const [rev, setRev] = useState(0);
  const [watched, setWatched] = useState<{ key: string; run: string } | null>(null);
  // The newest request wins (#6): a read only lands if nothing (another read, Run all, Stop) has
  // happened since it was sent.
  const generation = useRef(0);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const mine = ++generation.current;
    const current = () => live && mine === generation.current;
    listTests(teamId, nodeId).then(
      (value) =>
        current() &&
        setGot((g) => ({ key, value, failed: false, seq: (g?.seq ?? 0) + 1, at: Date.now() })),
      () =>
        current() &&
        setGot((g) => ({
          key,
          value: g?.key === key ? g.value : null,
          failed: true,
          seq: (g?.seq ?? 0) + 1,
          at: g?.at ?? Date.now(),
        })),
    );
    return () => {
      live = false;
    };
  }, [wanted, teamId, nodeId, key, rev]);

  const mine = got?.key === key ? got : null;
  const value = mine?.value ?? null;
  const run = value?.run ?? null;
  const running = run?.status === "running";
  if (running && run && (watched?.key !== key || watched.run !== run.id))
    setWatched({ key, run: run.id });

  // R15: poll every 2 s while the run is going.
  const seq = mine?.seq ?? 0;
  useEffect(() => {
    if (!wanted || !running) return;
    const t = window.setTimeout(() => setRev((r) => r + 1), TESTS_POLL_MS);
    return () => window.clearTimeout(t);
  }, [wanted, running, seq]);

  const ended = useRef(onRunEnded);
  ended.current = onRunEnded;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) ended.current?.();
    wasRunning.current = running;
  }, [running]);

  const putRun = useCallback(
    (next: TestRun | null) => {
      generation.current += 1;
      setGot((g) =>
        g && g.key === key && g.value
          ? { ...g, value: { ...g.value, run: next }, seq: g.seq + 1, at: Date.now() }
          : g,
      );
    },
    [key],
  );
  const retry = useCallback(() => {
    setGot(null);
    setRev((r) => r + 1);
  }, []);
  const reload = useCallback(() => setRev((r) => r + 1), []);
  const runAll = useCallback(async () => {
    putRun(await runTests(teamId, nodeId));
  }, [teamId, nodeId, putRun]);
  const stop = useCallback(async () => {
    putRun(await stopTests(teamId, nodeId));
  }, [teamId, nodeId, putRun]);

  const state = !wanted ? "idle" : !mine ? "loading" : mine.failed && !value ? "error" : "ready";
  return {
    state,
    value,
    readAt: mine?.at ?? 0,
    running,
    watched: watched?.key === key && !running ? watched.run : null,
    retry,
    reload,
    runAll,
    stop,
  };
}
