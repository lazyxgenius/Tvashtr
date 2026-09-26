import { describe, expect, it } from "vitest";

import { plan } from "../desktopTestUtils";
import {
  canContinue,
  CODEX_INSTALL_URL,
  codexRow,
  planInUse,
  planRowView,
  planRowViews,
} from "./planRows";

const MAC = { mac: "this Mac", signingIn: false, setUpTint: true };

describe("plan rows (DT-20, DT-21)", () => {
  it("connected: success dot, the plan line, Use my plan on, sage border", () => {
    expect(planRowView("claude", plan("claude", "connected"), MAC)).toEqual({
      provider: "claude",
      title: "Claude Code",
      badge: { variant: "success", dot: true, label: "Connected" },
      line: "Found on this Mac · signed in with your Claude plan · covers anthropic/* models",
      tone: "sage",
      action: { kind: "switch", checked: true },
    });
    // OQ-10: never "SuperGrok" — the CLI exposes no plan name.
    expect(planRowView("grok", plan("grok", "connected"), MAC).line).toBe(
      "Found on this Mac · signed in with your Grok plan · covers xai/* models",
    );
  });

  it("needs_login: warning dot, Sign in to <plan> (tint), amber border", () => {
    const grok = planRowView("grok", plan("grok", "needs_login"), MAC);
    expect(grok.badge).toEqual({ variant: "warning", dot: true, label: "Needs sign-in" });
    expect(grok.line).toBe("Found on this Mac · not signed in · covers xai/* models");
    expect(grok.tone).toBe("amber");
    expect(grok.action).toEqual({
      kind: "button",
      variant: "tint",
      label: "Sign in to Grok",
      does: "connect",
    });
    expect(planRowView("claude", plan("claude", "needs_login"), MAC).action).toMatchObject({
      label: "Sign in to Claude",
    });
  });

  it("needs_install: Not installed + Set up; each plan's own install line", () => {
    const claude = planRowView("claude", plan("claude", "needs_install"), MAC);
    expect(claude.badge).toEqual({ variant: "neutral", dot: false, label: "Not installed" });
    expect(claude.line).toBe("Install it and sign in once to use your Claude plan");
    expect(claude.action).toEqual({
      kind: "button",
      variant: "tint",
      label: "Set up",
      does: "setUp",
    });
    expect(planRowView("grok", plan("grok", "needs_install"), MAC).line).toBe(
      "Install the Grok CLI to use your Grok plan",
    );
  });

  it("api_key, error and turned off (Use my plan off, OQ-17)", () => {
    const key = planRowView("claude", plan("claude", "api_key"), MAC);
    expect(key.badge).toEqual({ variant: "info", dot: false, label: "On an API key" });
    expect(key.line).toBe("Found on this Mac · signed in with an API key, not your Claude plan");
    expect(key.action).toMatchObject({
      variant: "tint",
      label: "Sign in with your plan",
      does: "connect",
    });

    const err = planRowView("grok", plan("grok", "error"), MAC);
    expect(err.badge).toEqual({ variant: "danger", dot: true, label: "Error" });
    expect(err.line).toBe("Couldn’t check Grok. Try again.");
    expect(err.action).toMatchObject({ variant: "ghost", label: "Check again", does: "refresh" });

    const off = planRowView("claude", plan("claude", "disconnected"), MAC);
    expect(off.badge).toEqual({ variant: "neutral", dot: false, label: "Not used" });
    expect(off.line).toBe(
      "Tvashtr won’t run agents on your Claude plan. Turn this on to use it again.",
    );
    expect(off.action).toEqual({ kind: "switch", checked: false });
    expect(off.tone).toBe("line");
  });

  it("while a Terminal sign-in is open: Checking…, the Terminal line and Cancel (DtF-Run-4)", () => {
    const row = planRowView("grok", plan("grok", "needs_login"), { ...MAC, signingIn: true });
    expect(row.badge).toEqual({ variant: "info", dot: true, label: "Checking…" });
    expect(row.line).toBe("Finish signing in in the Terminal window");
    expect(row.tone).toBe("line");
    expect(row.action).toEqual({
      kind: "button",
      variant: "ghost",
      label: "Cancel",
      does: "cancel",
    });
  });

  it("before the bridge answers: Checking… with no action", () => {
    const row = planRowView("claude", null, MAC);
    expect(row.badge.label).toBe("Checking…");
    expect(row.line).toBe("Looking for Claude Code on this Mac…");
    expect(row.action).toBeNull();
  });

  it("says “this computer” off macOS (DT-50)", () => {
    expect(
      planRowView("grok", plan("grok", "needs_login"), { ...MAC, mac: "this computer" }).line,
    ).toBe("Found on this computer · not signed in · covers xai/* models");
  });

  it("Grok's Set up is ghost when an earlier row already offers a tint action (DtF-Key-1 vs Claude-1)", () => {
    const key1 = planRowViews(
      { claude: plan("claude", "needs_install"), grok: plan("grok", "needs_install") },
      { mac: "this Mac", signingIn: null },
    );
    expect(key1.map((r) => r.action)).toEqual([
      { kind: "button", variant: "tint", label: "Set up", does: "setUp" },
      { kind: "button", variant: "ghost", label: "Set up", does: "setUp" },
    ]);
    const connectedFirst = planRowViews(
      { claude: plan("claude", "connected"), grok: plan("grok", "needs_install") },
      { mac: "this Mac", signingIn: null },
    );
    expect(connectedFirst[1].action).toMatchObject({ variant: "tint", label: "Set up" });
  });
});

describe("Codex row (DT-22)", () => {
  it("not found: the status-only line and How to install", () => {
    expect(codexRow(plan("codex", "needs_install"), "this Mac")).toEqual({
      line: "Not found. Tvashtr can show its status, but can’t run agents on it yet.",
      installUrl: CODEX_INSTALL_URL,
    });
    expect(codexRow(null, "this Mac").installUrl).toBe("https://developers.openai.com/codex");
  });

  it("installed: found, no button", () => {
    expect(codexRow(plan("codex", "needs_login"), "this Mac")).toEqual({
      line: "Found on this Mac. Tvashtr can show its status, but can’t run agents on it yet.",
      installUrl: null,
    });
  });
});

describe("Continue (DT-27, OQ-16)", () => {
  it("a plan in use needs the box ticked; a key alone doesn't", () => {
    // DtF-Run-5: both connected, ticked → on.
    expect(canContinue({ planInUse: true, consent: true, savedKeys: 0 })).toBe(true);
    // DtF-Claude-3 / DT-Engines: a plan in use, unticked → off.
    expect(canContinue({ planInUse: true, consent: false, savedKeys: 0 })).toBe(false);
    // DtF-Key-3: no plan in use, one saved key, unticked → on.
    expect(canContinue({ planInUse: false, consent: false, savedKeys: 1 })).toBe(true);
    // A plan in use with a saved key still needs the box.
    expect(canContinue({ planInUse: true, consent: false, savedKeys: 2 })).toBe(false);
    // Nothing set up: only Skip for now.
    expect(canContinue({ planInUse: false, consent: true, savedKeys: 0 })).toBe(false);
  });

  it("a plan is in use only while connected with Use my plan on", () => {
    expect(planInUse({ claude: plan("claude", "connected") })).toBe(true);
    expect(
      planInUse({ claude: plan("claude", "disconnected"), grok: plan("grok", "needs_login") }),
    ).toBe(false);
    expect(planInUse({ grok: plan("grok", "api_key") })).toBe(false);
  });
});
