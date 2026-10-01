/**
 * R10 notifications (Prob-Notify): poll the inbox and the active runs every 10 s and fire one OS
 * notification per NEW transition, per the account's three choices.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCS_RUN,
  INBOX_ITEMS,
  mockApi,
  resetHomeState,
  stalledInboxItem,
} from "../pages/home/homeTestUtils";
import { __resetNotifyPrefsForTests, useRunNotifier } from "./runNotifier";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static sent: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions = {},
  ) {
    FakeNotification.sent.push(this);
  }
}

const APPROVAL = INBOX_ITEMS[0];
const FAILED = INBOX_ITEMS[1];
const ALL_ON = {
  get_started_hidden: false,
  notify_asked: true,
  notify_needs_you: true,
  notify_stalls_fails: true,
  notify_finishes: true,
};

let prefs: Record<string, boolean>;
let inbox: unknown[];
let active: unknown[];
let details: Record<string, unknown>;

function serve() {
  return mockApi({
    "GET /api/account/preferences": () => prefs,
    "GET /api/inbox": () => ({ count: inbox.length, items: inbox }),
    "GET /api/runs": () => ({ runs: active, next_cursor: null }),
    "GET /api/runs/:id": (url: URL) => ({ run: details[url.pathname.split("/").pop() ?? ""] }),
  });
}

/** Let the in-flight fetches settle (real timers stay real; only setInterval is faked). */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

async function nextPoll() {
  await vi.advanceTimersByTimeAsync(10_000);
  await settle();
}

const titles = () => FakeNotification.sent.map((n) => n.title);

beforeEach(() => {
  resetHomeState();
  __resetNotifyPrefsForTests();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  FakeNotification.permission = "granted";
  FakeNotification.sent = [];
  vi.stubGlobal("Notification", FakeNotification);
  prefs = { ...ALL_ON };
  inbox = [];
  active = [];
  details = {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetHomeState();
  window.location.hash = "";
});

describe("useRunNotifier", () => {
  it("never notifies about what the first poll finds, then once per new approval", async () => {
    inbox = [APPROVAL];
    serve();
    renderHook(() => useRunNotifier());
    await settle();
    await nextPoll();
    expect(FakeNotification.sent).toHaveLength(0);

    const next = { ...APPROVAL, key: "gate:900", task: { ...APPROVAL.task, id: 900 } };
    inbox = [APPROVAL, next];
    await nextPoll();
    await nextPoll();
    expect(titles()).toEqual(["Indicator sprint team needs you"]);
    expect(FakeNotification.sent[0].options.body).toBe(
      "Approve the spec for “Add an RSI indicator with tests”.",
    );
  });

  it("notifies a stalled and a failed run once each", async () => {
    serve();
    renderHook(() => useRunNotifier());
    await settle();
    inbox = [stalledInboxItem(310), FAILED];
    await nextPoll();
    await nextPoll();
    expect(FakeNotification.sent.map((n) => [n.title, n.options.body])).toEqual([
      [
        "Bugfix squad stalled",
        "No update for 5 minutes. Nothing shipped; finished steps are saved.",
      ],
      ["Bugfix squad failed", "Engineer has no xai key on the website"],
    ]);
  });

  it("notifies a finished run with its pull request, not a run that left another way", async () => {
    active = [DOCS_RUN, { ...DOCS_RUN, run_id: "r-gone" }];
    details = {
      "r-docs": {
        id: "r-docs",
        idea: "Write the API reference for /runs",
        status: "completed",
        team: { id: "t-docs", name: "Docs team" },
        library_team_id: "t-docs",
        pr_url: "https://github.com/o/r/pull/57",
        pr_number: 57,
      },
      "r-gone": { id: "r-gone", idea: "x", status: "cancelled", team: null },
    };
    serve();
    renderHook(() => useRunNotifier());
    await settle();
    active = [];
    await nextPoll();
    await nextPoll();
    expect(FakeNotification.sent.map((n) => [n.title, n.options.body])).toEqual([
      ["Docs team finished", "Pull request #57 is open: “Write the API reference for /runs”."],
    ]);
  });

  it("respects the three choices", async () => {
    prefs = { ...ALL_ON, notify_needs_you: false, notify_finishes: false };
    active = [DOCS_RUN];
    const calls = serve();
    renderHook(() => useRunNotifier());
    await settle();
    inbox = [APPROVAL, FAILED];
    active = [];
    await nextPoll();
    expect(titles()).toEqual(["Bugfix squad failed"]);
    expect(calls.some((c) => c.path === "/api/runs/r-docs")).toBe(false);
  });

  it("doesn't poll before the ask was answered, or without permission", async () => {
    prefs = { ...ALL_ON, notify_asked: false };
    const calls = serve();
    renderHook(() => useRunNotifier());
    await settle();
    await nextPoll();
    expect(calls.some((c) => c.path.startsWith("/api/inbox"))).toBe(false);

    __resetNotifyPrefsForTests();
    prefs = { ...ALL_ON };
    FakeNotification.permission = "denied";
    await nextPoll();
    expect(calls.some((c) => c.path.startsWith("/api/inbox"))).toBe(false);
  });

  it("clicking a notification focuses the window and opens its run", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    serve();
    renderHook(() => useRunNotifier());
    await settle();
    inbox = [APPROVAL];
    await nextPoll();
    const n = FakeNotification.sent[0];
    n.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/teams/t-ind/runs/r-rsi");
    expect(n.close).toHaveBeenCalled();
  });
});
