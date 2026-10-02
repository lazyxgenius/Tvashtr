import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { JudgeDialog } from "./JudgeDialog";
import { TESTS } from "./testsFixtures";

// M7 Test-Judge: Check the AI check.

const BASE = "/api/teams/t1/nodes/n-rev/tests/t6";
const FAILED =
  "Changes requested: the new function isn’t registered, so the builder can’t list it.";
const ANSWERS = Array.from({ length: 14 }, (_, i) => ({
  text: i === 0 ? FAILED : `Answer ${i + 1}`,
  from: `Run #12 · round ${i + 1}`,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
};

function renderDialog() {
  const onClose = vi.fn();
  const onUsed = vi.fn();
  render(
    <JudgeDialog
      teamId="t1"
      nodeId="n-rev"
      test={TESTS[5]}
      check={1}
      first={FAILED}
      onClose={onClose}
      onUsed={onUsed}
    />,
  );
  return { onClose, onUsed, dialog: screen.getByRole("dialog", { name: "Check the AI check" }) };
}
const row = (dialog: HTMLElement, n: number) =>
  within(dialog).getByRole("group", { name: `You: answer ${n}` });

describe("JudgeDialog", () => {
  it("the check, the answer it failed on first, seven at a time with Label more", async () => {
    mockApi({ [`GET ${BASE}/answers`]: { answers: ANSWERS } });
    const { dialog, onUsed } = renderDialog();
    await flush();
    expect(dialog).toHaveTextContent("names the file and line for each problem");
    const list = within(dialog).getByRole("list", { name: "Saved answers" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent(FAILED);
    // Listed once, first.
    expect(within(list).getAllByText(FAILED)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Label more" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("button", { name: "Label more" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this check" }));
    expect(onUsed).toHaveBeenCalled();
  });

  it("labels go together after 400 ms (the latest wins); the agreement and the one miss show", async () => {
    const calls = mockApi({
      [`GET ${BASE}/answers`]: { answers: ANSWERS },
      [`POST ${BASE}/judge`]: (_u: URL, body: { labels: { answer: string; you: boolean }[] }) => ({
        rows: body.labels.map((l) => ({
          ...l,
          ai: l.answer === "Answer 2" ? !l.you : l.you,
          reason: "",
        })),
        agree: body.labels.length - 1,
        total: body.labels.length,
        trusted: false,
        ai: { available: true, left: 180, limit: 200 },
      }),
    });
    const { dialog } = renderDialog();
    await flush();
    fireEvent.click(within(row(dialog, 1)).getByRole("button", { name: "Yes" }));
    fireEvent.click(within(row(dialog, 2)).getByRole("button", { name: "No" }));
    expect(within(row(dialog, 1)).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({
      check: 1,
      labels: [
        { answer: FAILED, you: true },
        { answer: "Answer 2", you: false },
      ],
    });
    const callout = within(dialog).getByRole("status");
    expect(callout).toHaveTextContent("Agrees with you on 1 of 2");
    expect(callout).toHaveTextContent("The one miss: it said Yes to “Answer 2”.");
    expect(within(dialog).getByLabelText("Not what you said")).toBeInTheDocument();
  });

  it("no AI-check key: the server's words", async () => {
    mockApi({
      [`GET ${BASE}/answers`]: { answers: ANSWERS },
      [`POST ${BASE}/judge`]: () => jsonError(409, "AI checks aren’t available yet"),
    });
    const { dialog } = renderDialog();
    await flush();
    fireEvent.click(within(row(dialog, 1)).getByRole("button", { name: "Yes" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("AI checks aren’t available yet");
  });
});
