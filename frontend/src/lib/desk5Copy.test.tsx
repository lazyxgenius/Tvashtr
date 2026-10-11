/**
 * M-desk-5 L1 — the run banner (D4) says what the toolbar chip says at every poll of a live run:
 * a run on the Desktop's subscriptions names them from launch to Done, before its first cost row
 * and after its $0 usage rows. The website's banner stays byte for byte (prompts/m-desk-5-v2.md).
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RunBanner } from "../components/RunBanner";
import type { CostRow, RunRow } from "./api";

const BOTH = { subscriptions: ["claude", "grok"], all: true };
const NONE = { subscriptions: [], all: false };
const desktop = () => (document.documentElement.dataset.tvashtrDesktop = "true");
const live = (ran_on?: RunRow["ran_on"]) =>
  ({ id: "r1", status: "running", cost_total_usd: null, ran_on }) as RunRow;
const rows = (...usd: number[]) => usd.map((cost_usd) => ({ cost_usd }) as CostRow);
const banner = (run: RunRow, costs: CostRow[]) =>
  render(<RunBanner runId="r1" run={run} workflowStatus="PENDING" costs={costs} />).container;

afterEach(() => {
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("L1 — the live run banner names the subscriptions", () => {
  it("names them once a step's $0 usage row exists", () => {
    desktop();
    const el = banner(live(BOTH), rows(0, 0));
    expect(el).toHaveTextContent("coston your Claude and Grok subscriptions");
    expect(el).not.toHaveTextContent("$0.0000");
  });

  it("names them before the first row (routed at launch)", () => {
    desktop();
    expect(banner(live(BOTH), [])).toHaveTextContent("coston your Claude and Grok subscriptions");
  });

  it("a live key-only run on the Desktop keeps today's figure", () => {
    desktop();
    expect(banner(live(NONE), rows(0.0123))).toHaveTextContent("cost$0.0123");
    expect(banner(live(NONE), [])).not.toHaveTextContent("cost");
  });

  it("the website keeps today's banner", () => {
    expect(banner(live(), [])).not.toHaveTextContent("cost");
    expect(banner(live(), rows(0.0123))).toHaveTextContent("cost$0.0123");
    const done = { ...live(), status: "completed", cost_total_usd: 0 } as RunRow;
    expect(banner(done, [])).toHaveTextContent("cost$0.0000");
  });
});
