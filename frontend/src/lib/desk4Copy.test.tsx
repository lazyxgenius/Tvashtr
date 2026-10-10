/**
 * M-desk-4 (q) — each changed string shows its Desktop variant only in the case its ruling names
 * (work that ran on subscriptions, the Desktop's budgets, a Claude/Grok plan on this Mac), and the
 * website's words stay byte for byte (brief prompts/m-desk-4.md, H1–H6).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunBanner } from "../components/RunBanner";
import { keyUsage, replaceCopy } from "../pages/engines/keysModel";
import { sampleInputs } from "../pages/engines/enginesTestUtils";
import {
  missingKeysSentence,
  pickerPhrase,
  readinessHint,
  type Readiness,
} from "../pages/home/composerModel";
import { DoneSummary } from "../panel/run/live/DoneSummary";
import { ResumeConfirm, ResumePick } from "../panel/run/live/Resume";
import { planOnThisMac } from "../panel/setup/modelCopy";
import { UnknownModelWarning } from "../panel/setup/ModelNotices";
import type { RunRow, TeamRunRow, TeamSummary } from "./api";
import type { TestRun } from "./api/agentTests";
import type { ResumeInfo, ResumePoint } from "./api/resume";
import { resultsSub, runningSub } from "./agentTestsFormat";
import { spendText } from "./desktopRepos";
import { runMeta } from "./versionFormat";

const CLAUDE = { subscriptions: ["claude"], all: true };
const BOTH = { subscriptions: ["claude", "grok"], all: true };
const MIXED = { subscriptions: ["claude"], all: false };
const NONE = { subscriptions: [], all: false };
const desktop = () => (document.documentElement.dataset.tvashtrDesktop = "true");

afterEach(() => {
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("H1 — a money figure names the subscriptions on the Desktop", () => {
  it("spendText: all, mixed, key-only; the website keeps the money", () => {
    expect(spendText("$0.00", CLAUDE)).toBe("$0.00"); // the website
    desktop();
    expect(spendText("$0.00", CLAUDE)).toBe("on your Claude subscription");
    expect(spendText("$0.00", BOTH)).toBe("on your Claude and Grok subscriptions");
    expect(spendText("$0.12", MIXED)).toBe("$0.12 + your Claude subscription");
    expect(spendText("$0.50", NONE)).toBe("$0.50");
    expect(spendText("$0.50", undefined)).toBe("$0.50");
  });

  it("D3: the Done summary's cost", () => {
    const summary = {
      pr_url: null,
      pr_number: 42,
      rounds: 3,
      elapsed_s: 1358,
      cost_usd: 0,
    };
    const { unmount } = render(<DoneSummary idea="Add RSI" summary={summary} ranOn={BOTH} />);
    expect(screen.getByLabelText("Run summary")).toHaveTextContent("$0.00cost"); // the website
    unmount();
    desktop();
    render(<DoneSummary idea="Add RSI" summary={summary} ranOn={BOTH} />);
    expect(screen.getByLabelText("Run summary")).toHaveTextContent(
      "on your Claude and Grok subscriptionscost",
    );
  });

  it("D4: the run banner's cost", () => {
    const run = { id: "r1", status: "completed", cost_total_usd: 0, ran_on: CLAUDE } as RunRow;
    const { container, unmount } = render(
      <RunBanner runId="r1" run={run} workflowStatus="SUCCESS" costs={[]} />,
    );
    expect(container).toHaveTextContent("$0.0000");
    unmount();
    desktop();
    const desk = render(<RunBanner runId="r1" run={run} workflowStatus="SUCCESS" costs={[]} />);
    expect(desk.container).toHaveTextContent("on your Claude subscription");
    expect(desk.container).not.toHaveTextContent("$0.0000");
  });

  it("D8: the Tests header, running and after", () => {
    const run = {
      version: 7,
      cost_usd: 0,
      ran_on: { subscriptions: ["grok"], all: true },
    } as TestRun;
    expect(runningSub(run)).toBe("On v7 · $0.00 so far");
    expect(resultsSub(run, "just now")).toBe("On v7 · just now · $0.00");
    desktop();
    expect(runningSub(run)).toBe("On v7 · on your Grok subscription");
    expect(resultsSub(run, "just now")).toBe("On v7 · just now · on your Grok subscription");
    const mixed = { ...run, cost_usd: 0.14, ran_on: { subscriptions: ["grok"], all: false } };
    expect(runningSub(mixed)).toBe("On v7 · $0.14 + your Grok subscription so far");
    expect(runningSub({ ...run, ran_on: undefined })).toBe("On v7 · $0.00 so far");
  });

  it("D23: History's runs", () => {
    const row = {
      run_id: "r1",
      status: "completed",
      idea: "x",
      created_at: "2026-10-10T10:00:00Z",
      updated_at: "2026-10-10T10:22:00Z",
      cost_total_usd: 0,
      spent_usd: 0,
      pr_number: 42,
      ran_on: BOTH,
    } as TeamRunRow;
    expect(runMeta(row)).toBe("22m · $0.00 · pull request #42");
    desktop();
    expect(runMeta(row)).toBe("22m · on your Claude and Grok subscriptions · pull request #42");
    expect(runMeta({ ...row, ran_on: undefined })).toBe("22m · $0.00 · pull request #42");
  });
});

describe("D16–D18 (H1/H2) — Resume", () => {
  const T = (h: number, m: number) => new Date(2026, 9, 2, h, m).toISOString();
  const confirm = {
    title: "Resume from Engineer, round 2?",
    step_label: "Engineer, round 2",
    kept: [{ text: "Spec v2", at: null }],
    runs_again: ["Engineer · round 2"],
    skips_cost_usd: 0,
    skips_s: 480,
    skips_ran_on: BOTH,
    again_ran_on: BOTH,
  };
  const point: ResumePoint = {
    invocation_id: 104,
    node_id: "n-eng",
    origin_node_id: null,
    label: "Engineer",
    kind: "agent",
    iteration: 2,
    title: "Engineer · round 2",
    text: "Stopped: the model returned an error",
    at: T(10, 59),
    cost_usd: 0,
    plan: "claude",
    state: "suggested",
    resumable: true,
    confirm,
  };
  const info = (p = point): ResumeInfo => ({
    run_id: "r12",
    number: 12,
    next_number: 13,
    available: true,
    reason: null,
    stops_run: false,
    points: [p],
  });

  it("D16: each step's cost names the plan it ran on", () => {
    const web = render(<ResumePick info={info()} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("10:59 · $0.00")).toBeInTheDocument();
    web.unmount();
    desktop();
    render(<ResumePick info={info()} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("10:59 · on your Claude subscription")).toBeInTheDocument();
  });

  it("D17/D18: the confirm talks about work, not money, on the Desktop", () => {
    const web = render(
      <ResumeConfirm info={info()} point={point} onResume={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/Skips work that already cost \$0\.00 and took/)).toBeInTheDocument();
    expect(screen.getByText("You only pay for the steps that run again.")).toBeInTheDocument();
    web.unmount();
    desktop();
    const desk = render(
      <ResumeConfirm info={info()} point={point} onResume={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Skips 8 min of finished work.")).toBeInTheDocument();
    expect(
      screen.getByText("Only the steps that run again use your Claude and Grok subscriptions."),
    ).toBeInTheDocument();
    desk.unmount();
    const mixed = { ...point, confirm: { ...confirm, skips_ran_on: MIXED, again_ran_on: MIXED } };
    render(
      <ResumeConfirm info={info(mixed)} point={mixed} onResume={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/Skips work that already cost/)).toBeInTheDocument();
    expect(
      screen.getByText("Only the steps that run again use your Claude subscription and your keys."),
    ).toBeInTheDocument();
  });
});

describe("H6 — keys copy names the plan on this Mac", () => {
  const claudeOn = [
    {
      provider: "claude",
      connected: true,
      state: "connected",
      account_hint: null,
      source: "bridge",
      checked_at: null,
    },
  ] as never;

  it("K1–K3: where an anthropic key is used, and replacing it", () => {
    const web = sampleInputs();
    const desk = sampleInputs({ surface: "desktop", subs: claudeOn });
    expect(keyUsage(web, "anthropic").footer).toBe("Works for website runs and Desktop runs.");
    expect(keyUsage(desk, "anthropic").footer).toBe(
      "Works for website runs. On this Mac, Claude runs use your Claude subscription first.",
    );
    // A provider with no plan here keeps today's words on the Desktop too.
    expect(keyUsage(desk, "openai").footer).toBe(keyUsage(web, "openai").footer);
    expect(replaceCopy(web, "anthropic").body).not.toContain("website run");
    expect(replaceCopy(desk, "anthropic").body).toContain("next website run.");
    expect(replaceCopy(desk, "openai")).toEqual(replaceCopy(web, "openai"));
  });

  it("K5–K7: a model on a plan here (the custom hint, the warning, the backup hint)", () => {
    const cover = { byok: new Set<string>(), subs: { grok: true } };
    expect(planOnThisMac("xai/grok-4.7-mni", cover, false)).toBeNull(); // the website
    expect(planOnThisMac("xai/grok-4.7-mni", cover, true)).toBe("Grok");
    expect(planOnThisMac("anthropic/claude-opus-4.1", cover, true)).toBeNull(); // not connected
    expect(planOnThisMac("openai/gpt-4.1", cover, true)).toBeNull();
    const web = render(<UnknownModelWarning model="xai/grok-4.7-mni" onDismiss={vi.fn()} />);
    expect(web.container).toHaveTextContent(
      "No provider matches xai/grok-4.7-mni. It will fail at run time if the name is wrong or the key isn’t set.",
    );
    web.unmount();
    const desk = render(
      <UnknownModelWarning model="xai/grok-4.7-mni" plan="Grok" onDismiss={vi.fn()} />,
    );
    expect(desk.container).toHaveTextContent(
      "No provider matches xai/grok-4.7-mni. On this Mac it runs on your Grok subscription; it will fail at run time if the name is wrong.",
    );
  });

  it("K8: the composer names Connect in Engines first for Claude and Grok models", () => {
    const team = {
      readiness: {
        website: { ready: false, missing_providers: ["anthropic", "xai"], missing_nodes: [] },
        desktop: { ready: false, missing_providers: ["anthropic", "xai"], missing_nodes: [] },
      },
    } as unknown as TeamSummary;
    expect(pickerPhrase(team, false)).toBe("Website: needs 2 keys");
    expect(pickerPhrase(team, true)).toBe(
      "This computer: connect Claude and Grok in Engines, or add 2 keys",
    );
    const r: Readiness = { ready: false, missing: ["xai"], routed: [] };
    expect(readinessHint(r, false)?.text).toBe("Website needs xai key");
    expect(readinessHint(r, true)?.text).toBe(
      "This computer: connect Grok in Engines, or add an xai key",
    );
    expect(readinessHint({ ...r, missing: ["openai"] }, true)?.text).toBe(
      "This computer needs openai key",
    );
    expect(missingKeysSentence("Indicator sprint team", ["anthropic", "xai"])).toBe(
      "Indicator sprint team uses anthropic and xai models, and there’s no API key for them.",
    );
    expect(missingKeysSentence("Indicator sprint team", ["anthropic", "xai"], true)).toBe(
      "Indicator sprint team uses anthropic and xai models. Connect Claude and Grok in Engines, or add API keys for them.",
    );
  });
});
