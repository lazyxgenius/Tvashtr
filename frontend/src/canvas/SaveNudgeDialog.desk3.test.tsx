import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CheckSet, VersionTests } from "../lib/api/versions";
import type { DesktopRoutes } from "../lib/desktopRepos";
import { SaveNudgeDialog } from "./SaveNudgeDialog";

// M-desk-3 (G2; Quality › Set-SaveCheckDesktop): read from Tvashtr Desktop, the set check's line
// names the subscriptions when every model of both versions it compares runs on one, and the
// footnote says both checks run on them when both are fully routed. Mixed, not fresh, or the
// website: today's words, byte for byte.

const TESTS: VersionTests = {
  count: 6,
  agents: [{ node_id: "n-rev", name: "Reviewer", count: 6 }],
  sub: "You changed the Reviewer’s instructions and the Engineer’s model.",
  option: "Run the Reviewer’s 6 tests",
  estimate: { cost_usd: 0.4, minutes: 4 },
};
const SET: CheckSet = {
  id: "set-1",
  name: "Indicators",
  count: 5,
  estimate: { cost_usd: 4.6, minutes: 25 },
};
const CLAUDE: DesktopRoutes = { subscriptions: ["claude"], all: true };
const GROK: DesktopRoutes = { subscriptions: ["grok"], all: true };
const BOTH: DesktopRoutes = { subscriptions: ["claude", "grok"], all: true };
const MIXED: DesktopRoutes = { subscriptions: ["claude", "grok"], all: false };
const STALE: DesktopRoutes = { subscriptions: [], all: false };

const TODAY_SET = "5 tasks · about 25 min · about $4.60 · nothing ships";
const DESK_SET = "5 tasks · about 25 min · on your Claude and Grok subscriptions · nothing ships";
const TODAY_FOOT = "About $5.00 for both checks";
const DESK_FOOT = "Both checks run on your Claude and Grok subscriptions";

function renderDialog(tests: VersionTests | null, set: CheckSet) {
  render(
    <SaveNudgeDialog
      current={7}
      next={8}
      tests={tests}
      checkSets={[set]}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe("Set-SaveCheckDesktop: the set check's line", () => {
  it("names the subscriptions when every model of both versions runs on one", () => {
    renderDialog(null, { ...SET, desktop: BOTH });
    expect(screen.getByText(DESK_SET)).toBeInTheDocument();
    expect(screen.queryByText(TODAY_SET)).toBeNull();
  });

  it("one subscription is named on its own", () => {
    renderDialog(null, { ...SET, desktop: CLAUDE });
    expect(
      screen.getByText("5 tasks · about 25 min · on your Claude subscription · nothing ships"),
    ).toBeInTheDocument();
  });

  it.each([
    ["the website", undefined],
    ["a mixed Desktop", MIXED],
    ["a Desktop with no fresh subscription", STALE],
  ])("%s keeps today's words", (_name, desktop) => {
    renderDialog(null, { ...SET, ...(desktop ? { desktop } : {}) });
    expect(screen.getByText(TODAY_SET)).toBeInTheDocument();
    expect(screen.queryByText(/subscription/)).toBeNull();
  });

  it("with no estimate there is no price to replace", () => {
    renderDialog(null, { ...SET, estimate: null, desktop: BOTH });
    expect(screen.getByText("5 tasks · nothing ships")).toBeInTheDocument();
  });
});

describe("Set-SaveCheckDesktop: the footnote with both checks ticked", () => {
  it("both checks fully routed: they run on the union of their subscriptions", () => {
    renderDialog({ ...TESTS, desktop: CLAUDE }, { ...SET, desktop: GROK });
    expect(screen.getByText(DESK_FOOT)).toBeInTheDocument();
    expect(screen.queryByText(/for both checks/)).toBeNull();
  });

  it("the same subscriptions named once", () => {
    renderDialog({ ...TESTS, desktop: GROK }, { ...SET, desktop: BOTH });
    expect(screen.getByText(DESK_FOOT)).toBeInTheDocument();
    expect(screen.getByText(DESK_SET)).toBeInTheDocument();
  });

  it.each([
    ["the website", undefined, undefined],
    ["the tests routed, the set mixed", CLAUDE, MIXED],
    ["the set routed, the tests mixed", { subscriptions: ["claude"], all: false }, BOTH],
    ["the tests routed, the set not fresh", CLAUDE, STALE],
  ])("%s: today's words", (_name, tests, set) => {
    renderDialog(
      { ...TESTS, ...(tests ? { desktop: tests } : {}) },
      { ...SET, ...(set ? { desktop: set } : {}) },
    );
    expect(screen.getByText(TODAY_FOOT)).toBeInTheDocument();
    expect(screen.queryByText(DESK_FOOT)).toBeNull();
  });
});
