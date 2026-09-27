/**
 * The secret dialog on its own: a tool may reference `${linear_token}` (a run reads any `${name}`),
 * but a secret is only stored under a name that follows the rule — so the prefilled modes explain
 * the fix and link to the tool instead of offering a value field that can never save.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi } from "../tools/toolsTestUtils";
import { SecretDialog } from "./SecretDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const PROBLEM =
  "Secret names use capital letters, numbers and _: write ${LINEAR_TOKEN}, not ${linear_token}.";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("SecretDialog · a reference no secret can be stored under", () => {
  it("Add <name> explains the rule and opens the tool instead of offering a value", () => {
    const calls = mockApi({});
    const onClose = vi.fn();
    render(
      <SecretDialog
        mode={{
          kind: "add-prefilled",
          name: "linear_token",
          tools: [{ id: "t-lin", name: "linear" }],
        }}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add linear_token" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("linear_token");
    expect(within(dialog).getByText(PROBLEM)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Value")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Save secret" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open linear" }));
    expect(onClose).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/toolkit/tools/t-lin");
    expect(calls).toEqual([]);
  });

  it("a name that follows the rule still gets its Value field", () => {
    mockApi({});
    render(
      <SecretDialog
        mode={{
          kind: "add-prefilled",
          name: "LINEAR_TOKEN",
          tools: [{ id: "t-lin", name: "linear" }],
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add LINEAR_TOKEN" });
    expect(within(dialog).getByLabelText("Value")).toBeInTheDocument();
    expect(within(dialog).queryByText(PROBLEM)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Open linear" })).toBeNull();
  });

  it("Add N secrets: the rule-breaking name gets the note, the others still save", async () => {
    const calls = mockApi({
      "POST /api/secrets": (_u: URL, body: { name: string }) =>
        json(201, { name: body.name, created_at: null, updated_at: null }),
    });
    const onSaved = vi.fn();
    render(
      <SecretDialog
        mode={{
          kind: "add-many",
          names: ["SENTRY_TOKEN", "linear_token"],
          tool: "linear",
          toolId: "t-lin",
        }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add 2 secrets for linear" });
    expect(within(dialog).queryByLabelText("linear_token")).toBeNull();
    expect(within(dialog).getByText(PROBLEM)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open linear" })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("SENTRY_TOKEN"), {
      target: { value: "sntrys_1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save secrets" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(["SENTRY_TOKEN"]));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { name: "SENTRY_TOKEN", value: "sntrys_1" },
    ]);
  });
});
