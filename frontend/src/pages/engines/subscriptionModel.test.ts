import { describe, expect, it } from "vitest";

import { SUBSCRIPTION_INSTALL_URLS } from "../../lib/engines";
import { KEYS, USAGE, key, node, sampleInputs, sub } from "./enginesTestUtils";
import {
  CONNECT_FAILED,
  IDLE_UI,
  checkedJustNow,
  connectedToast,
  disconnectCopy,
  disconnectedMessage,
  refreshToast,
  rowConnectedToast,
  runnerBanner,
  subUsedBy,
  subscriptionCard,
  terminalOpenedToast,
} from "./subscriptionModel";

const desktop = sampleInputs({ surface: "desktop" });
const web = sampleInputs();
const texts = (badges: { text: string }[]) => badges.map((b) => b.text);
const labels = (actions: { label: string }[]) => actions.map((a) => a.label);

describe("subscription cards on Desktop (Eng-Subs, Eng-CardStates)", () => {
  it("Claude connected: plan hint, Connected, covers and users, Refresh + Disconnect", () => {
    const v = subscriptionCard(desktop, sub("claude", "connected", "Claude Pro"));
    expect(v).toMatchObject({
      name: "Claude",
      letter: "C",
      account: "Claude Pro · via Claude Code",
      coversCode: "anthropic/*",
      coversRest: " models · Desktop runs",
      usedBy: "Engineer · Indicator sprint team",
      message: { kind: "text", text: "Runs while Tvashtr Desktop is open." },
      ok: true,
    });
    expect(v.badges).toEqual([{ variant: "success", dot: true, text: "Connected" }]);
    expect(v.actions).toEqual([
      { kind: "refresh", label: "Refresh", variant: "secondary" },
      { kind: "disconnect", label: "Disconnect", variant: "ghost" },
    ]);
  });

  it("after an explicit Refresh the connected message adds when it was checked (ENG-29)", () => {
    const s = { ...sub("claude", "connected", "Claude Pro"), checked_at: new Date().toISOString() };
    const v = subscriptionCard(desktop, s, { ...IDLE_UI, refreshed: true });
    expect(v.message).toEqual({
      kind: "text",
      text: "Runs while Tvashtr Desktop is open. Checked just now.",
    });
  });

  it("a status checked within the last minute says so without a Refresh (EnF-ClaudeRefresh-1)", () => {
    const at = (ms: number) => ({
      ...sub("claude", "connected", "Claude Pro"),
      checked_at: new Date(Date.now() - ms).toISOString(),
    });
    expect(subscriptionCard(desktop, at(20_000)).message).toEqual({
      kind: "text",
      text: "Runs while Tvashtr Desktop is open. Checked just now.",
    });
    expect(subscriptionCard(desktop, at(120_000)).message).toEqual({
      kind: "text",
      text: "Runs while Tvashtr Desktop is open.",
    });
    const now = Date.parse("2026-09-26T09:00:30Z");
    expect(checkedJustNow({ ...at(0), checked_at: "2026-09-26T09:00:00Z" }, now)).toBe(true);
    expect(checkedJustNow({ ...at(0), checked_at: "2026-09-26T08:59:00Z" }, now)).toBe(false);
    expect(checkedJustNow({ ...at(0), checked_at: "2026-09-26T09:05:00Z" }, now)).toBe(false);
    expect(checkedJustNow({ ...at(0), checked_at: null }, now)).toBe(false);
  });

  it("Grok has no plan name, so its account line says Grok subscription (OQ-10)", () => {
    const v = subscriptionCard(desktop, sub("grok", "connected", "SuperGrok"));
    expect(v.account).toBe("Grok subscription · via Grok CLI");
    expect(v.coversCode).toBe("xai/*");
  });

  it("Grok needs login: Connect opens a Terminal window", () => {
    const v = subscriptionCard(desktop, sub("grok", "needs_login"));
    expect(v.account).toBe("Not signed in");
    expect(v.badges).toEqual([{ variant: "warning", dot: true, text: "Needs login" }]);
    expect(v.usedBy).toBe("Product manager, Reviewer · Indicator sprint team");
    expect(v.message).toEqual({
      kind: "text",
      text: "Connect opens a Terminal window. Sign in to Grok there, then come back.",
    });
    expect(labels(v.actions)).toEqual(["Connect"]);
    expect(v.ok).toBe(false);
  });

  it("waiting for the sign-in: the Terminal callout, Checking… and Cancel (Eng-Flow-Grok-2)", () => {
    const v = subscriptionCard(desktop, sub("grok", "needs_login"), {
      ...IDLE_UI,
      waiting: true,
      waitingFrom: "needs_login",
    });
    expect(v.account).toBe("Waiting for sign-in");
    expect(v.badges).toEqual([{ variant: "neutral", dot: true, text: "Checking…" }]);
    expect(v.message).toEqual({
      kind: "terminal",
      text: "Finish signing in to Grok in the Terminal window that just opened, then come back. Tvashtr checks again automatically.",
    });
    expect(v.actions).toEqual([
      { kind: "connect", label: "Checking", variant: "primary", loading: true },
      { kind: "cancel", label: "Cancel", variant: "ghost" },
    ]);
  });

  it("waiting after Connect from an API key asks for the plan (ENG-31)", () => {
    const v = subscriptionCard(desktop, sub("claude", "api_key"), {
      ...IDLE_UI,
      waiting: true,
      waitingFrom: "api_key",
    });
    expect(v.message).toEqual({
      kind: "terminal",
      text: "Finish signing in to Claude in the Terminal window that just opened. Choose your Claude plan, not an API key.",
    });
  });

  it("a Refresh in flight: Checking…, a loading Checking and a disabled Disconnect (ENG-33)", () => {
    const v = subscriptionCard(desktop, sub("claude", "connected", "Claude Pro"), {
      ...IDLE_UI,
      refreshing: true,
    });
    expect(texts(v.badges)).toEqual(["Checking…"]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Checking that Claude Code is installed and signed in.",
    });
    expect(v.actions).toEqual([
      { kind: "refresh", label: "Checking", variant: "secondary", loading: true },
      { kind: "disconnect", label: "Disconnect", variant: "ghost", disabled: true },
    ]);
  });

  it("the launch probe (ENG-34)", () => {
    const v = subscriptionCard(desktop, sub("claude", "checking"));
    expect(texts(v.badges)).toEqual(["Checking…"]);
    expect(v.message).toEqual({ kind: "text", text: "Looking for Claude Code on this computer." });
    expect(v.actions).toEqual([
      { kind: "refresh", label: "Checking", variant: "secondary", loading: true },
    ]);
  });

  it("on an API key (ENG-35, the plan wording of OQ-20)", () => {
    const v = subscriptionCard(desktop, sub("claude", "api_key"));
    expect(v.account).toBe("Claude Code signed in with an API key");
    expect(v.badges).toEqual([{ variant: "info", dot: false, text: "On an API key" }]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Claude Code is using an API key, not your Claude plan. Connect to sign in with your plan instead.",
    });
    expect(labels(v.actions)).toEqual(["Connect"]);
  });

  it("an error (ENG-37)", () => {
    const v = subscriptionCard(desktop, sub("grok", "error"));
    expect(v.badges).toEqual([{ variant: "danger", dot: true, text: "Error" }]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Couldn’t check Grok. Try Refresh. If it keeps failing, reopen Tvashtr Desktop.",
    });
    expect(labels(v.actions)).toEqual(["Refresh"]);
  });

  it("disconnected: who now runs on the API key (ENG-36, EnF-FirstTime-2)", () => {
    const v = subscriptionCard(desktop, sub("claude", "disconnected"));
    expect(v.account).toBe("Not connected");
    expect(v.badges).toEqual([{ variant: "neutral", dot: false, text: "Disconnected" }]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Engineer now runs on your anthropic API key, if you have one. Connect to use your Claude plan again.",
    });
    expect(disconnectedMessage(desktop, "grok")).toBe(
      "Product manager and Reviewer now run on your xai API key, if you have one. Connect to use your Grok plan again.",
    );
    const nobody = sampleInputs({ surface: "desktop", usage: { ...USAGE, teams: [] } });
    expect(disconnectedMessage(nobody, "grok")).toBe(
      "Not connected. Connect opens a Terminal window where you sign in to Grok.",
    );
  });

  it("a CLI that isn't installed links its install page", () => {
    const v = subscriptionCard(desktop, sub("grok", "needs_install"));
    expect(v.account).toBe("Not found on this computer");
    expect(v.message).toEqual({
      kind: "text",
      text: "Install the Grok CLI, make sure it’s on your PATH, then quit and reopen Tvashtr.",
      link: { label: "Install Grok CLI", href: SUBSCRIPTION_INSTALL_URLS.grok },
    });
    expect(labels(v.actions)).toEqual(["I’ve installed it — Refresh"]);
  });
});

describe("the Codex card is status only (ENG-39..41, OQ-8)", () => {
  it("needs install: Status only + Needs install, the PATH hint and the install link", () => {
    const v = subscriptionCard(desktop, sub("codex", "needs_install"));
    expect(v).toMatchObject({
      letter: "O",
      account: "Not found on this computer",
      coversCode: "openai/*",
      coversRest: " models",
      usedBy: "—",
      ok: false,
    });
    expect(v.badges).toEqual([
      { variant: "info", dot: false, text: "Status only" },
      { variant: "neutral", dot: false, text: "Needs install" },
    ]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Install the Codex CLI, make sure it’s on your PATH (npm global bin or Homebrew), then quit and reopen Tvashtr.",
      link: { label: "Install Codex CLI", href: "https://developers.openai.com/codex" },
    });
    expect(labels(v.actions)).toEqual(["I’ve installed it — Refresh"]);
  });

  it("a Refresh that still found nothing: Still not found and the Dock PATH callout", () => {
    const s = { ...sub("codex", "needs_install"), checked_at: new Date().toISOString() };
    const v = subscriptionCard(desktop, s, { ...IDLE_UI, stillNotFound: true });
    expect(v.account).toBe("Checked just now");
    expect(texts(v.badges)).toEqual(["Status only", "Still not found"]);
    expect(v.badges[1]).toEqual({ variant: "warning", dot: false, text: "Still not found" });
    expect(v.message).toEqual({
      kind: "warn",
      text: "Apps opened from the Dock don’t see your Terminal’s PATH. Quit Tvashtr fully, reopen it, then Refresh.",
    });
    expect(labels(v.actions)).toEqual(["Refresh again"]);
  });

  it("installed is Ready whatever its sign-in; never a Connect", () => {
    for (const state of ["needs_login", "connected", "api_key"] as const) {
      const v = subscriptionCard(desktop, sub("codex", state));
      expect(v.account).toBe("Codex CLI found");
      expect(v.badges).toEqual([
        { variant: "info", dot: false, text: "Status only" },
        { variant: "success", dot: true, text: "Ready" },
      ]);
      expect(v.message).toEqual({
        kind: "text",
        text: "Codex can’t run agents yet. You’ll be ready when it can.",
      });
      expect(labels(v.actions)).toEqual(["Refresh"]);
      expect(v.ok).toBe(true);
    }
    const waiting = subscriptionCard(desktop, sub("codex", "needs_login"), {
      ...IDLE_UI,
      waiting: true,
    });
    expect(labels(waiting.actions)).toEqual(["Refresh"]);
  });
});

describe("subscription cards on the website (Eng-SubsWeb, ENG-49/50)", () => {
  it("connected and checking in: the web message, every action disabled", () => {
    const v = subscriptionCard(web, {
      ...sub("claude", "connected", "Claude Pro"),
      runner_fresh: true,
    });
    expect(v.message).toEqual({
      kind: "text",
      text: "Connected on your computer. It only runs agents from Tvashtr Desktop.",
    });
    expect(v.actions.map((a) => [a.label, a.disabled])).toEqual([
      ["Refresh", true],
      ["Disconnect", true],
    ]);
    expect(v.ok).toBe(true);
  });

  it("connected but Desktop isn't checking in: only Open Tvashtr Desktop is enabled (ENG-38)", () => {
    const v = subscriptionCard(web, sub("claude", "connected", "Claude Pro"));
    expect(v.badges).toEqual([{ variant: "warning", dot: true, text: "Desktop not checking in" }]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Connected, but Tvashtr Desktop hasn’t checked in lately. Open it to run agents on your subscription.",
    });
    expect(v.actions).toEqual([
      { kind: "open-desktop", label: "Open Tvashtr Desktop", variant: "secondary" },
    ]);
  });

  it("needs login: Connect in Desktop, disabled", () => {
    const v = subscriptionCard(web, sub("grok", "needs_login"));
    expect(v.message).toEqual({ kind: "text", text: "Open Tvashtr Desktop to connect Grok." });
    expect(v.actions).toEqual([
      { kind: "connect", label: "Connect in Desktop", variant: "primary", disabled: true },
    ]);
  });

  it("never checked by Desktop: Not checked yet (OQ-11)", () => {
    const v = subscriptionCard(web, { ...sub("claude", "disconnected"), checked_at: null });
    expect(v.badges).toEqual([{ variant: "neutral", dot: false, text: "Not checked yet" }]);
    expect(v.message).toEqual({ kind: "text", text: "Open Tvashtr Desktop to connect." });
  });

  it("Codex: its status appears when Desktop is open", () => {
    const v = subscriptionCard(web, sub("codex", "needs_install"));
    expect(texts(v.badges)).toEqual(["Status only", "Needs install"]);
    expect(v.message).toEqual({
      kind: "text",
      text: "Status appears when Tvashtr Desktop is open.",
    });
    expect(v.actions.map((a) => [a.label, a.disabled])).toEqual([
      ["I’ve installed it — Refresh", true],
    ]);
  });
});

describe("Used by, the banner and the toasts", () => {
  it("Used by covers every team, and a dash when no agent uses it", () => {
    const usage = {
      ...USAGE,
      teams: [
        ...USAGE.teams,
        { team_id: "t-3", name: "Ops team", nodes: [node("n-o", "engineer", "grok/grok-4")] },
      ],
    };
    expect(subUsedBy(sampleInputs({ usage }), "grok")).toBe(
      "Product manager, Reviewer · Indicator sprint team; Engineer · Ops team",
    );
    expect(subUsedBy(sampleInputs(), "codex")).toBe("—");
  });

  it("the runner banner: checking in, or can't reach Tvashtr (ENG-25)", () => {
    const now = new Date().toISOString();
    expect(runnerBanner({ fresh: true, last_seen_at: now, providers: [] })).toEqual({
      tone: "ok",
      text: "Tvashtr Desktop is open and checking in. Subscription runs stop when you quit it.",
      checked: "Checked just now",
    });
    const hoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(runnerBanner({ fresh: false, last_seen_at: hoursAgo, providers: [] })).toEqual({
      tone: "warn",
      text: "Tvashtr Desktop can’t reach Tvashtr right now. Subscription runs won’t start.",
      checked: "Last checked in 3h ago",
    });
    expect(runnerBanner({ fresh: false, last_seen_at: null, providers: [] }).checked).toBeNull();
  });

  it("an Overview row's Connect: Terminal opened, then the teams that can run here (ENG-16)", () => {
    expect(terminalOpenedToast("grok")).toBe(
      "A Terminal window opened. Sign in to Grok there, then come back.",
    );
    const grokOn = sampleInputs({
      surface: "desktop",
      subs: [
        sub("claude", "connected", "Claude Pro"),
        sub("grok", "connected"),
        sub("codex", "needs_install"),
      ],
    });
    expect(rowConnectedToast(grokOn, sub("grok", "connected"), "needs_login")).toBe(
      "Grok connected. Indicator sprint team can run on this computer.",
    );
    // Claude still missing: no team can run yet, so it says what the sign-in covers.
    const claudeOff = sampleInputs({
      surface: "desktop",
      subs: [
        sub("claude", "disconnected"),
        sub("grok", "connected"),
        sub("codex", "needs_install"),
      ],
    });
    expect(rowConnectedToast(claudeOff, sub("grok", "connected"), "needs_login")).toBe(
      "Grok connected. xai models now run on this computer.",
    );
  });

  it("toasts after a sign-in or a Refresh", () => {
    expect(connectedToast(sub("grok", "connected"), "needs_login")).toBe(
      "Grok connected. xai models now run on this computer.",
    );
    expect(connectedToast(sub("claude", "connected", "Claude Pro"), "api_key")).toBe(
      "Claude connected with Claude Pro.",
    );
    expect(
      refreshToast(
        sub("claude", "connected", "Claude Pro"),
        sub("claude", "connected", "Claude Pro"),
      ),
    ).toBe("Claude is connected. Checked just now.");
    expect(refreshToast(sub("codex", "needs_install"), sub("codex", "needs_login"))).toBe(
      "Codex CLI found. It can’t run agents yet.",
    );
    expect(refreshToast(sub("codex", "needs_install"), sub("codex", "needs_install"))).toBeNull();
    expect(refreshToast(sub("grok", "needs_login"), sub("grok", "needs_login"))).toBeNull();
    expect(CONNECT_FAILED).toBe("Couldn’t open a Terminal window to sign in. Try again.");
  });

  it("the Disconnect impact (ENG-42/43)", () => {
    expect(disconnectCopy(desktop, "claude")).toEqual({
      title: "Disconnect Claude?",
      body: "Engineer in Indicator sprint team uses anthropic models. Without Claude, it runs on your anthropic API key. You don’t have one yet, so it can’t run until you add a key or connect again. You stay signed in to Claude Code itself.",
      toast: "Claude disconnected.",
      addKeyProvider: "anthropic",
    });
    const withKey = sampleInputs({ surface: "desktop", keys: [...KEYS, key("anthropic", "wQ3f")] });
    expect(disconnectCopy(withKey, "claude")).toMatchObject({
      body: "Engineer in Indicator sprint team uses anthropic models. Without Claude, it runs on your anthropic API key •••• wQ3f. You stay signed in to Claude Code itself.",
      addKeyProvider: null,
    });
    expect(disconnectCopy(desktop, "grok").body).toBe(
      "Product manager and Reviewer in Indicator sprint team use xai models. Without Grok, they run on your xai API key. You don’t have one yet, so they can’t run until you add a key or connect again. You stay signed in to the Grok CLI itself.",
    );
    const nobody = sampleInputs({ surface: "desktop", usage: { ...USAGE, teams: [] } });
    expect(disconnectCopy(nobody, "claude").body).toBe(
      "No team uses anthropic models. You stay signed in to Claude Code itself.",
    );
  });
});
