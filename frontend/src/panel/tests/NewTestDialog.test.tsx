import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { NewTestDialog } from "./NewTestDialog";
import { FROM_ROUND, TESTS } from "./testsFixtures";

// M7 Test-New / Test-AddCheck / Test-NoAI.

const BASE = "/api/teams/t1/nodes/n-rev/tests";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

function renderDialog(round = FROM_ROUND) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <NewTestDialog teamId="t1" nodeId="n-rev" round={round} onClose={onClose} onSaved={onSaved} />,
  );
  return {
    onClose,
    onSaved,
    dialog: screen.getByRole("dialog", { name: "New test from round 1" }),
  };
}

describe("NewTestDialog", () => {
  it("Test-New: the round, what the Reviewer gets, the prefilled check, the AI line and the cost", () => {
    const { dialog } = renderDialog();
    expect(dialog).toHaveTextContent(
      "Reviewer · run #12 · answered “Changes requested”. The test replays the Reviewer on exactly what it got then.",
    );
    const gets = within(dialog).getByRole("region", { name: "What the Reviewer gets" });
    expect(within(gets).getByText("Saved from the round")).toBeInTheDocument();
    expect(within(gets).getByText("Add an RSI indicator")).toBeInTheDocument();
    expect(within(gets).getByText("Spec v2")).toBeInTheDocument();
    expect(within(gets).getByText("1 page")).toBeInTheDocument();
    expect(within(gets).getByText("core/indicators.py")).toBeInTheDocument();
    expect(within(gets).getByText("3 failed, 38 passed")).toBeInTheDocument();
    expect(within(dialog).getByLabelText<HTMLInputElement>("Must say").value).toBe(
      "Changes requested",
    );
    expect(within(dialog).getByText("from the round")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("186 of 200 left this month");
    expect(dialog).toHaveTextContent("Replaying costs about $0.07 on your keys");
    // A name is required.
    expect(within(dialog).getByRole("button", { name: "Save test" })).toBeDisabled();
  });

  it("Test-AddCheck: the four kinds with what they check; a new row waits for its value", () => {
    const { dialog } = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a check" }));
    const menu = within(dialog).getByRole("menu", { name: "Add a check" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Must sayWords the answer must contain",
      "Must not sayWords it must not contain",
      "Must name a fileA file it must name or change",
      "AI checkA small model checks the answer",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Must not say/ }));
    const input = within(dialog).getByLabelText<HTMLInputElement>("Must not say");
    expect(input.placeholder).toBe("What it must not say");
    expect(input).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText("Test name"), {
      target: { value: "Catches an unregistered indicator" },
    });
    // An empty check can't be saved.
    expect(within(dialog).getByRole("button", { name: "Save test" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Must not say" }));
    expect(within(dialog).getByRole("button", { name: "Save test" })).toBeEnabled();
  });

  it("Save test posts the name and checks and hands back the test", async () => {
    const calls = mockApi({ [`POST ${BASE}`]: { test: TESTS[0] } });
    const { dialog, onSaved } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Test name"), {
      target: { value: "  Catches an unregistered indicator " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a check" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Must name a file/ }));
    fireEvent.change(within(dialog).getByLabelText("Must name a file"), {
      target: { value: "core/indicators.py" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save test" }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" })),
    );
    expect(calls.at(-1)?.body).toEqual({
      invocation_id: 812,
      name: "Catches an unregistered indicator",
      checks: [
        { kind: "must_say", value: "Changes requested", from_round: true },
        { kind: "must_name_file", value: "core/indicators.py" },
      ],
    });
  });

  it("a refusal shows the server's words", async () => {
    mockApi({ [`POST ${BASE}`]: () => jsonError(422, "Add at least one check") });
    const { dialog } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Test name"), { target: { value: "A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save test" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Add at least one check");
  });

  it("Test-NoAI: an AI check is Not available yet, skipped not failed", () => {
    const { dialog } = renderDialog({
      ...FROM_ROUND,
      checks: [{ kind: "ai", value: "Asks for RSI to be registered on INDICATORS" }],
      ai: { available: false, left: 200, limit: 200 },
    });
    expect(within(dialog).getByText("Not available yet")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "AI checks aren’t available yet, so they’re skipped, not failed. The other checks still run.",
    );
  });

  it("no estimate: no cost note; no run number or answer: a shorter line", () => {
    const { dialog } = renderDialog({
      ...FROM_ROUND,
      estimate: null,
      run_number: null,
      answered: null,
    });
    expect(dialog).not.toHaveTextContent("Replaying costs");
    expect(dialog).toHaveTextContent(
      "Reviewer. The test replays the Reviewer on exactly what it got then.",
    );
  });
});
