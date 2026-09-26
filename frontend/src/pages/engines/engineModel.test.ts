import { describe, expect, it } from "vitest";

import {
  alsoSaved,
  desktopCell,
  engineBadges,
  isFirstTime,
  providerRows,
  providersServingNoSeat,
  roleLabel,
  rowsCoveredBy,
  teamVerdicts,
  toFixCount,
  usedByCell,
  usedBySegments,
  websiteCell,
} from "./engineModel";
import { CATALOGUE, KEYS, SUBS, USAGE, key, node, sampleInputs, sub } from "./enginesTestUtils";

const noSeat = providersServingNoSeat(CATALOGUE);

describe("the design's sample (Eng-OverviewWeb / Eng-Overview)", () => {
  it("lists the providers the teams use, rows to fix first then alphabetical", () => {
    const rows = providerRows(sampleInputs());
    expect(rows.map((r) => [r.provider, r.monogram, r.usedBy])).toEqual([
      ["anthropic", "A", "Engineer · Indicator sprint team"],
      ["xai", "X", "Product manager, Reviewer · Indicator sprint team"],
      ["deepseek", "D", "Writer · Docs team"],
    ]);
    expect(rows.map((r) => r.needsFix)).toEqual([true, true, false]);
  });

  it("website cells: the subscription is 'on Desktop', Connect becomes Open in Desktop (OQ-2)", () => {
    const [anthropic, xai, deepseek] = providerRows(sampleInputs());
    expect(anthropic.desktop).toEqual({
      tone: "ok",
      text: "Claude subscription",
      suffix: "(on Desktop)",
    });
    expect(anthropic.website).toMatchObject({
      tone: "warn",
      text: "No API key",
      action: { kind: "add-key", label: "Add key", provider: "anthropic" },
    });
    expect(xai.desktop).toMatchObject({
      tone: "warn",
      text: "Grok needs login",
      action: { kind: "open-desktop", label: "Open in Desktop", sub: "grok" },
    });
    expect(deepseek.desktop).toEqual({ tone: "ok", text: "API key •••• 7d24" });
    expect(deepseek.website).toEqual({ tone: "ok", text: "API key •••• 7d24" });
  });

  it("Desktop cells: no suffix, and Connect connects", () => {
    const [anthropic, xai] = providerRows(sampleInputs({ surface: "desktop" }));
    expect(anthropic.desktop).toEqual({ tone: "ok", text: "Claude subscription" });
    expect(xai.desktop.action).toMatchObject({ kind: "connect", label: "Connect", sub: "grok" });
  });

  it("verdicts and N to fix = 2 (team × surface pairs, OQ-1)", () => {
    const v = teamVerdicts(sampleInputs());
    expect(v.map((t) => [t.name, t.desktop.text, t.website.text])).toEqual([
      ["Indicator sprint team", "Desktop: connect Grok", "Website: add anthropic, xai keys"],
      ["Docs team", "Desktop: ready", "Website: ready"],
    ]);
    expect(toFixCount(sampleInputs())).toBe(2);
  });

  it("the Also saved line lists saved keys no team uses, with the NIM note", () => {
    expect(alsoSaved(sampleInputs())).toEqual({
      providers: ["nvidia_nim", "openrouter"],
      notes: ["No agent uses NVIDIA NIM right now."],
    });
  });

  it("nav badges: 2 to fix, 1 of 2, 3 keys", () => {
    expect(engineBadges(sampleInputs())).toEqual({
      enginesFirstTime: false,
      enginesToFix: 2,
      subscriptions: { connected: 1, total: 2 },
      apiKeys: 3,
    });
  });
});

describe("fixes move the count (OvAddKey-5, OvConnect-3)", () => {
  it("connecting Grok makes the Desktop line ready: 1 to fix", () => {
    const i = sampleInputs({
      surface: "desktop",
      subs: [SUBS[0], sub("grok", "connected"), SUBS[2]],
    });
    expect(teamVerdicts(i)[0].desktop).toEqual({ ready: true, text: "Desktop: ready" });
    expect(toFixCount(i)).toBe(1);
    expect(engineBadges(i).subscriptions).toEqual({ connected: 2, total: 2 });
  });

  it("an anthropic key alone leaves 'add xai key' (OQ-16), both keys make it ready", () => {
    const one = sampleInputs({ keys: [...KEYS, key("anthropic", "wQ3f")] });
    expect(teamVerdicts(one)[0].website.text).toBe("Website: add xai key");
    expect(providerRows(one).find((r) => r.provider === "anthropic")?.website).toEqual({
      tone: "ok",
      text: "API key •••• wQ3f",
    });
    const both = sampleInputs({ keys: [...KEYS, key("anthropic", "wQ3f"), key("xai", "9Kx2")] });
    expect(teamVerdicts(both)[0].website).toEqual({ ready: true, text: "Website: ready" });
    // A key works on Desktop too, so the Desktop line is ready as well.
    expect(teamVerdicts(both)[0].desktop.ready).toBe(true);
    expect(toFixCount(both)).toBe(0);
  });

  it("a Connect flashes the rows its subscription covers (ENG-16)", () => {
    const i = sampleInputs({ surface: "desktop" });
    expect(rowsCoveredBy(i, "grok")).toEqual(["xai"]);
    expect(rowsCoveredBy(i, "claude")).toEqual(["anthropic"]);
    expect(rowsCoveredBy(i, "codex")).toEqual([]);
  });

  it("a key covers the Desktop too when no subscription does", () => {
    const i = sampleInputs({
      surface: "desktop",
      subs: [sub("claude", "disconnected"), SUBS[1], SUBS[2]],
      keys: [...KEYS, key("anthropic", "wQ3f")],
    });
    expect(providerRows(i).find((r) => r.provider === "anthropic")?.desktop).toEqual({
      tone: "ok",
      text: "API key •••• wQ3f",
    });
  });
});

describe("subscription states in the Desktop cell (ENG-13)", () => {
  const cellFor = (state: Parameters<typeof sub>[1], surface: "desktop" | "website") =>
    desktopCell(
      sampleInputs({ surface, subs: [SUBS[0], sub("grok", state), SUBS[2]] }),
      "xai",
      noSeat,
    );

  it.each([
    ["needs_login", "Grok needs login", "connect", "Connect"],
    ["api_key", "Grok on an API key", "connect", "Connect"],
    ["needs_install", "Grok not installed", "set-up", "Set up"],
    ["error", "Couldn’t check Grok", "refresh", "Refresh"],
    ["disconnected", "Grok not connected", "connect", "Connect"],
  ] as const)("%s → %s + %s", (state, text, kind, label) => {
    expect(cellFor(state, "desktop")).toMatchObject({
      tone: "warn",
      text,
      action: { kind, label },
    });
  });

  it("the website opens Desktop instead of connecting or re-checking; Set up still navigates", () => {
    expect(cellFor("error", "website").action?.kind).toBe("open-desktop");
    expect(cellFor("disconnected", "website").action?.label).toBe("Open in Desktop");
    expect(cellFor("needs_install", "website").action?.kind).toBe("set-up");
  });

  it("a connect in progress reads Checking…", () => {
    expect(cellFor("checking", "desktop")).toEqual({ tone: "neutral", text: "Checking…" });
  });

  it("a provider with no runnable subscription needs a key (openai: Codex can't run nodes)", () => {
    expect(desktopCell(sampleInputs({ surface: "desktop" }), "openai", noSeat)).toMatchObject({
      tone: "warn",
      text: "No API key",
      action: { kind: "add-key" },
    });
  });
});

describe("an agent with no model yet (no_model)", () => {
  // The canvas allows a blank agent; the launch gate refuses the team until it has a model
  // ("This agent needs a model before the team can run.").
  const withBlank = (...blank: ReturnType<typeof node>[]) => ({
    ...USAGE,
    teams: USAGE.teams.map((t) =>
      t.team_id === "t-docs" ? { ...t, nodes: [...t.nodes, ...blank] } : t,
    ),
  });

  it("is never ready on either surface, and counts in N to fix", () => {
    const i = sampleInputs({ usage: withBlank(node("n-res", "researcher", null)) });
    const docs = teamVerdicts(i).find((v) => v.teamId === "t-docs");
    expect(docs?.website).toEqual({ ready: false, text: "Website: give Researcher a model" });
    expect(docs?.desktop).toEqual({ ready: false, text: "Desktop: give Researcher a model" });
    expect(toFixCount(i)).toBe(4);
    expect(engineBadges(i).enginesToFix).toBe(4);
  });

  it("names every blank agent once, after the key fixes, and never adds a provider row", () => {
    const i = sampleInputs({
      usage: withBlank(node("n-a", "agent", null, "Editor"), node("n-b", "agent", "  ", "Critic")),
    });
    expect(teamVerdicts(i).find((v) => v.teamId === "t-docs")?.website.text).toBe(
      "Website: give Editor and Critic models",
    );
    expect(providerRows(i).map((r) => r.provider)).toEqual(["anthropic", "xai", "deepseek"]);
    const ind = sampleInputs({
      usage: {
        ...USAGE,
        teams: [{ ...USAGE.teams[0], nodes: [...USAGE.teams[0].nodes, node("n-x", "qa", null)] }],
      },
    });
    expect(teamVerdicts(ind)[0].website.text).toBe(
      "Website: add anthropic, xai keys, give Qa a model",
    );
  });
});

describe("NVIDIA NIM serves no seat (area rule)", () => {
  const nimTeam = {
    team_id: "t-nim",
    name: "Old NIM team",
    nodes: [node("n1", "engineer", "nvidia_nim/openai/gpt-oss-20b")],
  };
  const i = sampleInputs({ usage: { ...USAGE, teams: [nimTeam] } });

  it("is derived from the catalogue, not a hard-coded slug", () => {
    expect([...noSeat]).toEqual(["nvidia_nim"]);
    expect(providersServingNoSeat([])).toEqual(new Set());
  });

  it("its saved key never makes a team ready, and it is never offered as Add key", () => {
    const row = providerRows(i)[0];
    expect(row.desktop).toEqual({ tone: "warn", text: "Not supported right now" });
    expect(row.website).toEqual({ tone: "warn", text: "Not supported right now" });
    expect(websiteCell(i, "nvidia_nim", noSeat).action).toBeUndefined();
    const v = teamVerdicts(i)[0];
    expect(v.website).toEqual({ ready: false, text: "Website: change the NVIDIA NIM model" });
    expect(v.desktop).toEqual({ ready: false, text: "Desktop: change the NVIDIA NIM model" });
    expect(toFixCount(i)).toBe(2);
  });

  it("without the NIM key the fix is still to change the model, not to add a key", () => {
    const none = sampleInputs({ keys: [], usage: { ...USAGE, teams: [nimTeam] } });
    expect(teamVerdicts(none)[0].website.text).toBe("Website: change the NVIDIA NIM model");
  });
});

describe("Used by", () => {
  it("falls back from a title to a readable role", () => {
    expect(roleLabel("pm", null)).toBe("Product manager");
    expect(roleLabel("qa_lead", null)).toBe("Qa lead");
    expect(roleLabel("engineer", "Backend dev")).toBe("Backend dev");
  });

  it("shows two teams, then +N more (OQ-12)", () => {
    const team = (n: number) => ({
      team_id: `t${n}`,
      name: `Team ${n}`,
      nodes: [node(`n${n}`, "engineer", "deepseek/deepseek-chat")],
    });
    const usage = { ...USAGE, teams: [team(1), team(2), team(3), team(4)] };
    const segments = usedBySegments(usage, "deepseek");
    expect(usedByCell(segments)).toBe("Engineer · Team 1; Engineer · Team 2 +2 more");
    expect(usedByCell(segments.slice(0, 2))).toBe("Engineer · Team 1; Engineer · Team 2");
  });

  it("a fallback model is not a row, not in verdicts, and not 'unused' (OQ-13)", () => {
    const usage = {
      ...USAGE,
      teams: [
        {
          team_id: "t1",
          name: "Solo",
          nodes: [node("n1", "engineer", "deepseek/deepseek-chat", null, "openrouter/x/y")],
        },
      ],
    };
    const i = sampleInputs({ usage });
    expect(providerRows(i).map((r) => r.provider)).toEqual(["deepseek"]);
    expect(teamVerdicts(i)[0].website.ready).toBe(true);
    expect(alsoSaved(i).providers).toEqual(["nvidia_nim"]);
  });

  it("a node with no model uses no provider, and its team can't run until it has one", () => {
    const usage = {
      ...USAGE,
      teams: [{ team_id: "t1", name: "Blank", nodes: [node("n1", "engineer", null)] }],
    };
    const i = sampleInputs({ usage });
    expect(providerRows(i)).toEqual([]);
    expect(teamVerdicts(i)[0].website).toEqual({
      ready: false,
      text: "Website: give Engineer a model",
    });
  });
});

describe("first time (ENG-75)", () => {
  it("no key and no connected subscription", () => {
    const i = sampleInputs({
      keys: [],
      subs: [sub("claude", "disconnected"), sub("grok", "needs_login"), sub("codex", "connected")],
    });
    // Codex doesn't count: it can't run agents.
    expect(isFirstTime(i)).toBe(true);
    expect(engineBadges(i)).toEqual({
      enginesFirstTime: true,
      enginesToFix: 0,
      subscriptions: { connected: 0, total: 2 },
      apiKeys: 0,
    });
  });

  it("any key or a connected Claude/Grok ends it", () => {
    expect(isFirstTime(sampleInputs({ keys: [key("openai", "abcd")], subs: [] }))).toBe(false);
    expect(isFirstTime(sampleInputs({ keys: [] }))).toBe(false);
  });
});
