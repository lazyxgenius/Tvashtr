import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { ReplayView } from "./ReplayView";
import { TESTS } from "./testsFixtures";

// M7 Test-Replay: "Open this replay" in the drawer's SubView.

const URL_ = "/api/teams/t1/nodes/n-rev/tests/results/res-t6";
const REPLAY = {
  id: "res-t6",
  name: "Names the file to fix",
  version: 7,
  status: "failed",
  at: new Date().toISOString(),
  duration_s: 41,
  cost_usd: 0.07,
  gets: TESTS[0].gets,
  answer: "Changes requested: rsi() in core/indicators.py isn’t registered.",
  files: [],
  checks: [
    { kind: "must_say", value: "Changes requested", met: true, reason: null },
    { kind: "must_name_file", value: "core/indicators.py", met: true, reason: null },
    {
      kind: "ai",
      value: "names the file and line for each problem",
      met: false,
      reason: "It names the file but no line.",
    },
    { kind: "ai", value: "is polite", met: null, reason: "Not available yet" },
  ],
  error: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

describe("ReplayView", () => {
  it("the replay: its meta and result, what the Reviewer got, its answer, files and each check", async () => {
    mockApi({ [`GET ${URL_}`]: REPLAY });
    const onBack = vi.fn();
    render(
      <ReplayView teamId="t1" nodeId="n-rev" agent="Reviewer" resultId="res-t6" onBack={onBack} />,
    );
    const sheet = await screen.findByRole("region", { name: "Replay · Names the file to fix" });
    expect(sheet).toHaveTextContent("On v7 · just now · 41s · $0.07");
    expect(within(sheet).getByText("Failed")).toBeInTheDocument();
    const got = within(sheet).getByRole("region", { name: "What the Reviewer got" });
    expect(within(got).getByText("Add an RSI indicator")).toBeInTheDocument();
    expect(within(sheet).getByText(REPLAY.answer)).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Files it changedNone");
    const checks = within(within(sheet).getByRole("region", { name: "Checks" })).getAllByRole(
      "listitem",
    );
    expect(checks.map((c) => c.textContent)).toEqual([
      "Must sayChanges requestedMet",
      "Must name a filecore/indicators.pyMet",
      "AI checknames the file and line for each problemNot metIt names the file but no line.",
      "AI checkis politeSkippedNot available yet",
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("a replay that can't be read: Retry", async () => {
    mockApi({ [`GET ${URL_}`]: () => jsonError(500, "boom") });
    render(
      <ReplayView teamId="t1" nodeId="n-rev" agent="Reviewer" resultId="res-t6" onBack={vi.fn()} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this replay.");
  });
});
