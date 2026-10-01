import { describe, expect, it } from "vitest";

import type { ActivityLine, RunActivity } from "../../../lib/api/activity";
import { agoLong, agoShort, currentLineIds, mergeActivity, stateWord } from "./liveFormat";

const NOW = Date.parse("2026-10-02T10:45:24Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

describe("stateWord", () => {
  it("uses exactly the brief's plain words", () => {
    expect(
      [
        "waiting",
        "working",
        "running_command",
        "needs_you",
        "retrying",
        "quiet",
        "stalled",
        "failed",
        "done",
        "stopped",
        "carried_over",
      ].map((s) => stateWord(s as never)),
    ).toEqual([
      "Waiting",
      "Working",
      "Running a command",
      "Needs you",
      "Retrying",
      "Quiet",
      "Stalled",
      "Failed",
      "Done",
      "Stopped",
      "Carried over",
    ]);
  });
});

describe("ago", () => {
  it("says seconds, then minutes, then hours, like the boards", () => {
    expect(agoLong(at(4), NOW)).toBe("4 s ago");
    expect(agoLong(at(14), NOW)).toBe("14 s ago");
    expect(agoLong(at(180), NOW)).toBe("3m ago");
    expect(agoLong(at(7300), NOW)).toBe("2h ago");
    expect(agoShort(at(4), NOW)).toBe("4s");
    expect(agoShort(at(16 * 60), NOW)).toBe("16m");
    expect(agoLong(null, NOW)).toBe("");
  });
});

const line = (id: string, text = id): ActivityLine => ({
  id,
  at: at(1),
  node_id: "n-eng",
  label: "Engineer",
  iteration: 1,
  kind: "message",
  text,
  tone: "neutral",
  refs: {},
});

const reply = (lines: ActivityLine[], cursor: string, total = lines.length): RunActivity => ({
  run_id: "r-12",
  status: "running",
  live_state: "working",
  cursor,
  total,
  agents: [],
  lines,
  pinned: null,
  summary: null,
});

describe("mergeActivity", () => {
  it("takes the first reply whole", () => {
    const merged = mergeActivity(null, reply([line("a"), line("b")], "c1"));
    expect(merged.lines.map((l) => l.id)).toEqual(["a", "b"]);
    expect(merged.cursor).toBe("c1");
  });

  it("appends newer lines and replaces a line that changed (a command that finished)", () => {
    const first = mergeActivity(null, reply([line("a"), line("cmd", "Running make test")], "c1"));
    const next = mergeActivity(first, reply([line("cmd", "Ran make test"), line("z")], "c2", 3));
    expect(next.lines.map((l) => l.text)).toEqual(["a", "Ran make test", "z"]);
    expect(next.cursor).toBe("c2");
    expect(next.total).toBe(3);
  });
});

describe("currentLineIds", () => {
  const l = (id: string, node_id: string | null, kind: string, tone = "neutral"): ActivityLine => ({
    id,
    at: at(0),
    node_id,
    label: node_id ?? "Run",
    iteration: null,
    kind,
    text: id,
    tone: tone as ActivityLine["tone"],
    refs: {},
  });

  it("marks each agent's newest line when it says where the agent is now (Prob-Failed)", () => {
    const ids = currentLineIds([
      l("busy", "n-eng", "retry", "warn"),
      l("timeout", "n-eng", "error", "danger"),
      l("failed", "n-eng", "error", "danger"),
      l("stopped", null, "done"),
    ]);
    expect([...ids]).toEqual(["failed"]);
  });

  it("marks a finished run's Done line, not a plain step", () => {
    expect([
      ...currentLineIds([l("asked", "n-eng", "message"), l("done", null, "done", "ok")]),
    ]).toEqual(["done"]);
  });
});
