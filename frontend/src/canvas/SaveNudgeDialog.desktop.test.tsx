import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVersions, type VersionTests } from "../lib/api/versions";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { mockApi } from "../pages/home/homeTestUtils";
import { SaveNudgeDialog } from "./SaveNudgeDialog";

// M-desk-2 (E1, E2; Quality › Save-NudgeDesktop): saved in Tvashtr Desktop, "Save and run tests" and
// "Save and check" post `desktop_target` (the tests and the check run on the owner's subscriptions),
// and when every changed agent runs on a fresh subscription the option names it instead of keys.
// The website posts and says exactly what it did.

const TESTS: VersionTests = {
  count: 6,
  agents: [{ node_id: "n-rev", name: "Reviewer", count: 6 }],
  sub: "You changed the Reviewer’s instructions. The Reviewer has 6 tests.",
  option: "Save and run the Reviewer’s 6 tests",
  estimate: { cost_usd: 0.4, minutes: 4 },
};
const SET = { id: "set-1", name: "Indicators", count: 1, estimate: null };
const CLAUDE = { subscriptions: ["claude"], all: true };

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
  __resetBackendStatusForTests();
});

function renderDialog(tests: VersionTests | null, checkSets = [] as (typeof SET)[]) {
  const onSave = vi.fn();
  render(
    <SaveNudgeDialog
      current={7}
      next={8}
      tests={tests}
      checkSets={checkSets}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe("Save-NudgeDesktop: the option's words", () => {
  it("names the subscription when every changed agent runs on one", () => {
    renderDialog({ ...TESTS, desktop: CLAUDE });
    expect(
      screen.getByText(
        "About 4 min on your Claude subscription. Results show next to v8 in History.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/on your keys/)).toBeNull();
  });

  it("the website's, and a Desktop needing a key, are today's words", () => {
    const today = "About 4 min · about $0.40 on your keys. Results show next to v8 in History.";
    renderDialog(TESTS);
    expect(screen.getByText(today)).toBeInTheDocument();
  });

  it("a mixed Desktop (one agent on a key) keeps today's words", () => {
    renderDialog({ ...TESTS, desktop: { subscriptions: ["claude"], all: false } });
    expect(
      screen.getByText(
        "About 4 min · about $0.40 on your keys. Results show next to v8 in History.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Save-NudgeDesktop: what the save posts", () => {
  it("Save and run tests posts desktop_target in Tvashtr Desktop", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const onSave = renderDialog(TESTS);
    fireEvent.click(screen.getByRole("button", { name: "Save and run tests" }));
    expect(onSave).toHaveBeenCalledWith({ run_tests: true, desktop_target: true });
  });

  it("Save and check posts desktop_target in Tvashtr Desktop", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const onSave = renderDialog(null, [SET]);
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }));
    expect(onSave).toHaveBeenCalledWith({ check_set: "set-1", desktop_target: true });
  });

  it("Just save posts no flag, even in Tvashtr Desktop", () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const onSave = renderDialog(TESTS, [SET]);
    fireEvent.click(screen.getByRole("radio", { name: "Just save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as v8" }));
    expect(onSave).toHaveBeenCalledWith({ run_tests: false });
  });

  it("the website posts exactly what it did", () => {
    const onSave = renderDialog(TESTS, [SET]);
    fireEvent.click(screen.getByRole("button", { name: "Save and run tests" }));
    expect(onSave).toHaveBeenCalledWith({ run_tests: true, check_set: "set-1" });
  });
});

describe("the Desktop asks where the save's tests run", () => {
  it("reads the versions with ?desktop_target=1; the website reads as before", async () => {
    const calls = mockApi({
      "GET /api/teams/t1/versions": { current: 7, next: 8, tests: { ...TESTS, desktop: CLAUDE } },
    });
    await getVersions("t1");
    document.documentElement.dataset.tvashtrDesktop = "true";
    const listing = await getVersions("t1");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/teams/t1/versions",
      "/api/teams/t1/versions?desktop_target=1",
    ]);
    expect(listing.tests?.desktop).toEqual(CLAUDE);
  });
});
