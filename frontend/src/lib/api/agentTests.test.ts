import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import {
  DONE_RUN,
  FILE_CHECK,
  FROM_ROUND,
  RUNNING_RUN,
  TESTS,
  tests,
} from "../../panel/tests/testsFixtures";
import { __resetBackendStatusForTests } from "../backendStatus";
import {
  checkTestFile,
  createTest,
  deleteTest,
  getFromRound,
  getReplay,
  importTestFile,
  judgeCheck,
  listAnswers,
  listTests,
  runTests,
  stopTests,
} from "./agentTests";
import { ApiDetailError } from "./runs";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const BASE = "/api/teams/t1/nodes/n-rev/tests";

describe("agent tests client (M7 contract)", () => {
  it("lists the tests; a bare body reads as none", async () => {
    mockApi({ [`GET ${BASE}`]: tests(DONE_RUN) });
    const got = await listTests("t1", "n-rev");
    expect(got.tests.map((t) => t.name)).toEqual(TESTS.map((t) => t.name));
    expect(got.run?.since).toEqual({ version: 6, delta: 1 });
    expect(got.ai).toEqual({ available: true, left: 186, limit: 200 });
    mockApi({ [`GET ${BASE}`]: {} });
    expect(await listTests("t1", "n-rev")).toEqual({
      tests: [],
      run: null,
      last: null,
      estimate: null,
      ai: null,
    });
  });

  it("a round as a test (409 says why it can't be one)", async () => {
    const calls = mockApi({ [`GET ${BASE}/from-round`]: FROM_ROUND });
    expect((await getFromRound("t1", "n-rev", 812)).role).toBe("Reviewer");
    expect(calls.at(-1)?.path).toBe(`${BASE}/from-round?invocation_id=812`);
    mockApi({
      [`GET ${BASE}/from-round`]: () =>
        jsonError(409, "Can't make a test from this round (it ran before checkpoints)"),
    });
    const err = await getFromRound("t1", "n-rev", 9).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiDetailError);
    expect((err as ApiDetailError).message).toBe(
      "Can't make a test from this round (it ran before checkpoints)",
    );
  });

  it("saves and deletes a test", async () => {
    const calls = mockApi({
      [`POST ${BASE}`]: { test: TESTS[0] },
      [`DELETE ${BASE}/:id`]: () => new Response(null, { status: 204 }),
    });
    const body = { invocation_id: 812, name: "Catches", checks: TESTS[0].checks };
    expect((await createTest("t1", "n-rev", body)).id).toBe("t1");
    expect(calls.at(-1)?.body).toEqual(body);
    expect(await deleteTest("t1", "n-rev", "t1")).toBeNull();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: `${BASE}/t1` });
  });

  it("checks a file, then adds it with the mapping", async () => {
    const calls = mockApi({
      [`POST ${BASE}/file/check`]: FILE_CHECK,
      [`POST ${BASE}/file`]: { added: 12 },
    });
    const file = { filename: "reviewer-examples.csv", content: "task,expected\n" };
    expect((await checkTestFile("t1", "n-rev", file)).ready.tests).toBe(12);
    expect(calls.at(-1)?.body).toEqual(file);
    const mapping = { task: "gets" as const, expected: "must_say" as const };
    expect(await importTestFile("t1", "n-rev", { ...file, mapping })).toEqual({ added: 12 });
    expect(calls.at(-1)?.body).toEqual({ ...file, mapping });
  });

  it("Run all and Stop hand back the run", async () => {
    mockApi({
      [`POST ${BASE}/run`]: { run: RUNNING_RUN },
      [`POST ${BASE}/stop`]: { run: { ...RUNNING_RUN, status: "stopped" } },
    });
    expect((await runTests("t1", "n-rev"))?.status).toBe("running");
    expect((await stopTests("t1", "n-rev"))?.status).toBe("stopped");
  });

  it("a replay, the answers to label and the judge", async () => {
    const calls = mockApi({
      [`GET ${BASE}/results/:id`]: {
        id: "res-t6",
        name: "Names",
        status: "failed",
        cost_usd: 0.07,
      },
      [`GET ${BASE}/:id/answers`]: { answers: [{ text: "Approved.", from: "Run #12 · round 1" }] },
      [`POST ${BASE}/:id/judge`]: {
        rows: [{ answer: "Approved.", you: false, ai: false, reason: "No" }],
        agree: 1,
        total: 1,
        trusted: false,
        ai: null,
      },
    });
    const replay = await getReplay("t1", "n-rev", "res-t6");
    expect(replay).toMatchObject({ name: "Names", files: [], checks: [], gets: null });
    expect(await listAnswers("t1", "n-rev", "t6")).toEqual([
      { text: "Approved.", from: "Run #12 · round 1" },
    ]);
    const body = { check: 1, labels: [{ answer: "Approved.", you: false }] };
    expect((await judgeCheck("t1", "n-rev", "t6", body)).agree).toBe(1);
    expect(calls.at(-1)).toMatchObject({ path: `${BASE}/t6/judge`, body });
  });
});
