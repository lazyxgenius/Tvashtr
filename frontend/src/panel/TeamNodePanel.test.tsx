import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { TeamNodePanel } from "./TeamNodePanel";

// P1.8b: the team-authoring editor — the prompt + model fields, dirty-aware Save (no autosave),
// and the node-update PATCH. Stubs `fetch` (so updateTeamNode is exercised end-to-end through the
// real client) rather than mocking the helper, so the URL/method/body contract is proven too.

function node(over: Partial<TeamGraphNode> = {}): TeamGraphNode {
  return {
    id: "n-eng",
    role_name: "engineer",
    kind: "agent",
    model: "openai/gpt-4o-mini",
    engine: "openhands",
    prompt: "Original engineer prompt",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(node({ prompt: "edited" })),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamNodePanel — edit prompt + model, dirty-aware Save", () => {
  it("shows prompt + model, gates Save on dirty, and PATCHes the node-update endpoint", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<TeamNodePanel node={node()} onSaved={onSaved} onClose={() => {}} />);

    const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /prompt/i });
    const model = screen.getByRole<HTMLInputElement>("combobox");
    expect(prompt.value).toBe("Original engineer prompt");
    expect(model.value).toBe("openai/gpt-4o-mini");

    // Dirty-aware, no autosave: Save is disabled until a field actually changes.
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(prompt);
    await user.type(prompt, "Write greeting.txt = SENTINEL");
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(save);

    // The Save PATCHed the node-update endpoint with the edited prompt + the model.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(urlOf(calledUrl)).toBe("/api/team/nodes/n-eng");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Write greeting.txt = SENTINEL",
      model: "openai/gpt-4o-mini",
    });
    // …and the parent was asked to refetch the team (which clears dirty + shows the saved note).
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("does not render an editable surface for a null node", () => {
    render(<TeamNodePanel node={null} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/isn.t editable/i)).toBeInTheDocument();
  });
});
