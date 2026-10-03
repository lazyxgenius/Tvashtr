import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getFromRound, listTests } from "../../lib/api/agentTests";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { mockApi } from "../../pages/home/homeTestUtils";
import { NewTestDialog } from "./NewTestDialog";
import { DONE_RUN, FROM_ROUND, tests } from "./testsFixtures";
import { TestsTab } from "./TestsTab";
import type { AgentTestsApi } from "./useAgentTests";

// M-desk-2 (E2; Quality › Test-EstimateDesktop): in Tvashtr Desktop, when the agent's replays run
// on a fresh subscription, the estimate box and the New test footer name it instead of keys. The
// website (and a Desktop that would need a key) keeps today's words.

const BASE = "/api/teams/t1/nodes/n-rev/tests";
const CLAUDE = { subscriptions: ["claude"], all: true };
const MIXED = { subscriptions: [], all: false };

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
  __resetBackendStatusForTests();
});

const api = (value: ReturnType<typeof tests>): AgentTestsApi => ({
  state: "ready",
  value,
  readAt: Date.now(),
  running: false,
  watched: null,
  retry: vi.fn(),
  reload: vi.fn(),
  runAll: vi.fn(),
  stop: vi.fn(),
});
const estimateBox = (value: ReturnType<typeof tests>) => {
  const { container } = render(
    <TestsTab
      agent="Reviewer"
      tests={api(value)}
      onRunAll={vi.fn()}
      onStop={vi.fn()}
      busy={false}
      onPickRound={vi.fn()}
      onPickFile={vi.fn()}
      onOpenReplay={vi.fn()}
      onCompare={vi.fn()}
      onJudge={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return container.querySelector(".tt-estimate")?.textContent;
};

describe("Test-EstimateDesktop: the Tests tab's estimate box", () => {
  it("names the subscription when the agent's replays run on one", () => {
    expect(estimateBox(tests(DONE_RUN, { desktop: CLAUDE }))).toBe(
      "Replays only the Reviewer, on saved inputs, on your Claude subscription · about 4 min. AI checks are included.",
    );
  });

  it("the website's, and a Desktop needing a key, are today's words", () => {
    const today =
      "Replays only the Reviewer, on saved inputs. About $0.40 on your keys · 4 min. AI checks are included.";
    expect(estimateBox(tests(DONE_RUN))).toBe(today);
    expect(estimateBox(tests(DONE_RUN, { desktop: MIXED }))).toBe(today);
  });
});

describe("Test-EstimateDesktop: the New test footer", () => {
  const footer = (round = FROM_ROUND) => {
    render(
      <NewTestDialog
        teamId="t1"
        nodeId="n-rev"
        round={round}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    return screen.getByRole("dialog", { name: "New test from round 1" });
  };

  it("names the subscription when the replay runs on one", () => {
    const dialog = footer({ ...FROM_ROUND, desktop: CLAUDE });
    expect(dialog).toHaveTextContent("Replaying runs on your Claude subscription");
    expect(dialog).not.toHaveTextContent("on your keys");
  });

  it("the website's, and a Desktop needing a key, are today's words", () => {
    expect(footer()).toHaveTextContent("Replaying costs about $0.07 on your keys");
  });

  it("a Desktop needing a key keeps today's words", () => {
    const dialog = footer({ ...FROM_ROUND, desktop: MIXED });
    expect(dialog).toHaveTextContent("Replaying costs about $0.07 on your keys");
    expect(dialog).not.toHaveTextContent("Replaying runs on");
  });
});

describe("the Desktop asks where its replays run", () => {
  it("reads with ?desktop_target=1 and keeps the answer; the website reads as before", async () => {
    const calls = mockApi({
      [`GET ${BASE}`]: { ...tests(DONE_RUN), desktop: CLAUDE },
      [`GET ${BASE}/from-round`]: { ...FROM_ROUND, desktop: CLAUDE },
    });
    await listTests("t1", "n-rev");
    await getFromRound("t1", "n-rev", 812);
    document.documentElement.dataset.tvashtrDesktop = "true";
    const listed = await listTests("t1", "n-rev");
    const round = await getFromRound("t1", "n-rev", 812);
    expect(calls.map((c) => c.path)).toEqual([
      BASE,
      `${BASE}/from-round?invocation_id=812`,
      `${BASE}?desktop_target=1`,
      `${BASE}/from-round?invocation_id=812&desktop_target=1`,
    ]);
    expect(listed.desktop).toEqual(CLAUDE);
    expect(round.desktop).toEqual(CLAUDE);
  });
});
