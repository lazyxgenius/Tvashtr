import { describe, expect, it } from "vitest";

import { DONE_RUN, QUEUED_RUN, RUNNING_RUN, STOPPED_RUN } from "../panel/tests/testsFixtures";
import {
  aiChecksText,
  addTestsLabel,
  changeCount,
  elapsedText,
  estimateText,
  firstUnmet,
  queuedSub,
  readyText,
  replayCostText,
  resultsSub,
  runningSub,
  runningTitle,
  sinceText,
  stoppedTitle,
  testsCount,
  unreadable,
} from "./agentTestsFormat";

const AI = { available: true, left: 186, limit: 200 };

describe("agent tests words (M7 boards)", () => {
  it("the estimate box, with and without numbers or AI checks", () => {
    expect(estimateText("Reviewer", { cost_usd: 0.4, minutes: 4 }, AI)).toBe(
      "Replays only the Reviewer, on saved inputs. About $0.40 on your keys · 4 min. AI checks are included.",
    );
    expect(estimateText("Reviewer", null, AI)).toBe(
      "Replays only the Reviewer, on saved inputs. AI checks are included.",
    );
    expect(estimateText("Reviewer", null, { ...AI, available: false })).toBe(
      "Replays only the Reviewer, on saved inputs.",
    );
    expect(replayCostText({ cost_usd: 0.07 })).toBe("Replaying costs about $0.07 on your keys");
    expect(replayCostText(null)).toBeNull();
  });

  it("R7's AI-check line (Test-New) and its no-key line (Test-NoAI)", () => {
    expect(aiChecksText(AI)).toBe(
      "AI checks use a small model on Tvashtr’s key, included in your plan: 186 of 200 left this month. Check one against your own judgement before you rely on it.",
    );
    expect(aiChecksText({ ...AI, available: false })).toBe(
      "AI checks aren’t available yet, so they’re skipped, not failed. The other checks still run.",
    );
  });

  it("the headers: running, waiting for a slot, results, stopped", () => {
    expect(runningTitle(RUNNING_RUN)).toBe("Running 3 of 6");
    expect(runningTitle({ ...RUNNING_RUN, done: 6 })).toBe("Running 6 of 6");
    expect(runningSub(RUNNING_RUN)).toBe("On v7 · $0.14 so far");
    expect(queuedSub(QUEUED_RUN)).toBe("On v7 · 6 tests");
    expect(resultsSub(DONE_RUN, "just now")).toBe("On v7 · just now · $0.38");
    expect(resultsSub({ ...DONE_RUN, version: null }, "")).toBe("$0.38");
    expect(stoppedTitle(STOPPED_RUN)).toBe("Stopped · 2 of 6 ran");
    expect(resultsSub(STOPPED_RUN, "")).toBe("On v7 · $0.14");
    expect(testsCount(1)).toBe("1 test");
    expect(testsCount(6)).toBe("6 tests");
  });

  it("+1 since v6, −1 since v6, nothing when nothing moved", () => {
    expect(sinceText({ version: 6, delta: 1 })).toEqual({ text: "+1 since v6", worse: false });
    expect(sinceText({ version: 6, delta: -1 })).toEqual({ text: "−1 since v6", worse: true });
    expect(sinceText({ version: 6, delta: 0 })).toBeNull();
    expect(sinceText(null)).toBeNull();
  });

  it("the timer, the change counts and the first unmet check (a skipped AI check isn't one)", () => {
    expect(elapsedText(40)).toBe("40s");
    expect(elapsedText(100)).toBe("1m 40s");
    expect(elapsedText(3720)).toBe("1h 2m");
    expect(changeCount({ path: "a", added: 48, removed: 3 })).toBe("+48 −3");
    expect(changeCount({ path: "a", added: 31, removed: 0 })).toBe("+31");
    expect(
      firstUnmet([
        { kind: "ai", value: "x", met: null, reason: "Not available yet" },
        { kind: "must_say", value: "y", met: false, reason: null },
      ])?.value,
    ).toBe("y");
    expect(firstUnmet([{ kind: "must_say", value: "y", met: true, reason: null }])).toBeNull();
  });

  it("Test-Upload's ready callout and button", () => {
    expect(readyText({ tests: 12, must_say: 12, must_name_file: 9 }, "Reviewer")).toEqual([
      "12 tests are ready",
      "All 12 check what the Reviewer must say. 9 also check a file it must name.",
    ]);
    expect(readyText({ tests: 1, must_say: 1, must_name_file: 0 }, "Reviewer")).toEqual([
      "1 test is ready",
      "It checks what the Reviewer must say.",
    ]);
    expect(readyText({ tests: 4, must_say: 0, must_name_file: 4 }, "Engineer")[1]).toBe(
      "All 4 check a file it must name.",
    );
    expect(addTestsLabel(12)).toBe("Add 12 tests");
    expect(addTestsLabel(1)).toBe("Add 1 test");
  });

  it("Test-UploadError: a file the server couldn't read", () => {
    expect(unreadable("This file can’t be read: line 3 isn’t valid JSON.")).toBe(
      "Line 3 isn’t valid JSON. Use CSV with a header row, or one JSON object per line.",
    );
    expect(unreadable("This file can't be read: it is larger than 2 MB.")).toBe(
      "It is larger than 2 MB.",
    );
    expect(unreadable("Pick a column for What the agent gets.")).toBeNull();
  });
});
