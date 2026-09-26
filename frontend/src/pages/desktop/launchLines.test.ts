import { describe, expect, it } from "vitest";

import { plan } from "./desktopTestUtils";
import {
  offlineDetail,
  planLines,
  reconnectedLines,
  runsGoingLine,
  splashLines,
  updatingLines,
} from "./launchLines";

const ME = {
  id: "u1",
  email: "l@x.dev",
  github_login: "lazyxgenius",
  display_name: "Lazy X",
};

describe("launch checklist lines", () => {
  it("one line per runnable plan that is on; Codex and plans that are off get none", () => {
    expect(
      planLines([
        plan("claude", "connected"),
        plan("grok", "connected"),
        plan("codex", "connected"),
      ]),
    ).toEqual([
      { tone: "done", text: "Claude Code connected" },
      { tone: "done", text: "Grok connected" },
    ]);
    expect(planLines([plan("claude", "disconnected"), plan("grok", "needs_install")])).toEqual([
      { tone: "warn", text: "Grok not found · you can fix it later" },
    ]);
    expect(planLines([plan("claude", "api_key"), plan("grok", "error")])).toEqual([]);
    expect(planLines(null)).toEqual([]);
  });

  it("Splash: Connecting… until the session answers, then the login and the teams", () => {
    expect(splashLines({ mode: "splash", me: null, plans: null })).toEqual([
      { tone: "busy", text: "Connecting…" },
    ]);
    expect(
      splashLines({ mode: "splash", me: ME, plans: [plan("grok", "needs_login")] }).map(
        (l) => l.text,
      ),
    ).toEqual([
      "Signed in as lazyxgenius",
      "Grok needs sign-in · you can fix it later",
      "Loading your teams…",
    ]);
  });

  it("Reconnected: connected, then who, then the teams", () => {
    expect(reconnectedLines({ mode: "reconnected", me: null, plans: null })).toEqual([
      { tone: "done", text: "Connected" },
    ]);
    expect(
      reconnectedLines({ mode: "reconnected", me: ME, plans: null }).map((l) => l.tone),
    ).toEqual(["done", "done", "busy"]);
  });

  it("Updating: the resume note only while a Desktop run is going", () => {
    expect(updatingLines("0.7.0", 0)).toEqual([{ tone: "busy", text: "Installing 0.7.0" }]);
    expect(updatingLines("0.7.0", null)).toHaveLength(1);
    expect(updatingLines("0.7.0", 1)[1]).toEqual({
      tone: "note",
      text: "Your running team will resume from its last step",
    });
    expect(updatingLines("0.7.0", 2)[1].text).toBe(
      "Your running teams will resume from their last step",
    );
  });

  it("Update card run count (DT-44): none, one, many", () => {
    expect(runsGoingLine(0)).toBe("No runs are going.");
    expect(runsGoingLine(1)).toBe("1 run is going.");
    expect(runsGoingLine(3)).toBe("3 runs are going.");
  });

  it("Offline detail: host · reason · tries", () => {
    expect(offlineDetail({ kind: "timeout" }, 3, "tvashtr.fly.dev")).toBe(
      "tvashtr.fly.dev · no response after 10 s · tried 3 times",
    );
    expect(offlineDetail({ kind: "error", status: 500 }, 1, null)).toBe(
      "answered with an error (500) · tried once",
    );
  });
});
