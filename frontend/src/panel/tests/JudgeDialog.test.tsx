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

function renderDialog(test = TESTS[5]) {
  const onClose = vi.fn();
  const onUsed = vi.fn();
  render(
    <JudgeDialog
      teamId="t1"
      nodeId="n-rev"
      test={test}
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

  it("opens with the labels saved with the test: their You and AI values, the saved agreement, and how many more are labelled", async () => {
    // Ten saved labels on answers 1–10 (Yes on the odd ones); the AI said the opposite on answer 4.
    const labels = ANSWERS.slice(0, 10).map((a, i) => ({
      answer: a.text,
      you: i % 2 === 0,
      ai: i % 2 === 0,
      reason: "",
    }));
    labels[3] = { ...labels[3], ai: !labels[3].you };
    const test = {
      ...TESTS[5],
      checks: [
        TESTS[5].checks[0],
        { ...TESTS[5].checks[1], judge: { agree: 9, total: 10, trusted: true, labels } },
      ],
    };
    const calls = mockApi({
      [`GET ${BASE}/answers`]: { answers: ANSWERS },
      [`POST ${BASE}/judge`]: { rows: labels, agree: 9, total: 10, trusted: true, ai: null },
    });
    const { dialog } = renderDialog(test);
    await flush();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Agrees with you on 9 of 10");
    expect(within(row(dialog, 1)).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(row(dialog, 2)).getByRole("button", { name: "No" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByLabelText("AI check: answer 1")).toHaveTextContent("Yes");
    // Answer 4 is the miss.
    expect(within(dialog).getAllByLabelText("Not what you said")).toHaveLength(1);
    // Seven shown, three more labelled below them.
    expect(within(dialog).getByText("3 more labelled")).toBeInTheDocument();
    // Opening runs nothing.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    // A change sends every label, the saved ones too.
    fireEvent.click(within(row(dialog, 2)).getByRole("button", { name: "Yes" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect((posts[0].body as { labels: unknown[] }).labels).toHaveLength(10);
    // Label more shows them: nothing more labelled below.
    fireEvent.click(within(dialog).getByRole("button", { name: "Label more" }));
    expect(within(dialog).queryByText(/more labelled/)).toBeNull();
  });
});
