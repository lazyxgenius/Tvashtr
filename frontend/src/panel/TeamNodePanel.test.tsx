import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { TeamNodePanel } from "./TeamNodePanel";

// P1.8b/P1.8c: the team-authoring editor — the capability toggle (Thinker/Worker) + prompt + model
// fields, dirty-aware Save (no autosave), and the node-update PATCH. Stubs `fetch` (so updateTeamNode
// is exercised end-to-end through the real client) rather than mocking the helper, so the URL/method/
// body contract is proven too.

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

describe("TeamNodePanel — edit prompt + model + capability, dirty-aware Save", () => {
  it("shows prompt + model + capability, gates Save on dirty, and PATCHes the node-update endpoint", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node()}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /prompt/i });
    const model = screen.getByRole<HTMLInputElement>("combobox");
    expect(prompt.value).toBe("Original engineer prompt");
    expect(model.value).toBe("openai/gpt-4o-mini");

    // The agent node seeds the toggle to Worker (kind=agent).
    expect(screen.getByRole("button", { name: "Worker" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thinker" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Dirty-aware, no autosave: Save is disabled until a field actually changes.
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(prompt);
    await user.type(prompt, "Write greeting.txt = SENTINEL");
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(save);

    // The Save PATCHed the node-update endpoint with the edited prompt + model + the (unchanged)
    // capability — the panel posts the full values (the FE is dirty-aware but sends all of them).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(urlOf(calledUrl)).toBe("/api/teams/team-1/nodes/n-eng");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Write greeting.txt = SENTINEL",
      model: "openai/gpt-4o-mini",
      capability: "worker",
    });
    // …and the parent was asked to refetch the team (which clears dirty + shows the saved note).
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("flipping the capability ALONE (no prompt/model edit) enables Save and PATCHes the new capability", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node()}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    // Flip Worker -> Thinker without touching prompt/model.
    await user.click(screen.getByRole("button", { name: "Thinker" }));
    expect(screen.getByRole("button", { name: "Thinker" })).toHaveAttribute("aria-pressed", "true");
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Original engineer prompt",
      model: "openai/gpt-4o-mini",
      capability: "thinker",
    });
  });

  it("locks the capability toggle for the start node (defense-in-depth on the backend 409)", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ id: "n-pm", role_name: "pm", kind: "completion", engine: null })}
        isStartNode
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );

    const thinker = screen.getByRole("button", { name: "Thinker" });
    const worker = screen.getByRole("button", { name: "Worker" });
    // The root is a thinker, and the toggle is locked there.
    expect(thinker).toHaveAttribute("aria-pressed", "true");
    expect(thinker).toBeDisabled();
    expect(worker).toBeDisabled();

    // Clicking the locked Worker does nothing — capability stays thinker, Save stays disabled.
    await user.click(worker);
    expect(thinker).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does not render an editable surface for a null node", () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={null}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/isn.t editable/i)).toBeInTheDocument();
  });
});

describe("TeamNodePanel — authoring 'Last run' brief (M2)", () => {
  it("renders the last_run brief + a relative-time provenance tag below the editable fields", () => {
    const withRun = node({
      last_run: {
        outcome: "built",
        outcome_detail: "Built the feature — changed 2 file(s): a.py, b.py",
        run_id: "r1",
        iteration: 1,
        started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    });
    const { container } = render(
      <TeamNodePanel
        teamId="t1"
        node={withRun}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText("Built the feature — changed 2 file(s): a.py, b.py"),
    ).toBeInTheDocument();
    expect(container.querySelector(".tv-lastrun__when")?.textContent).toContain("ran 3h ago");
    expect(screen.queryByText("No runs yet.")).toBeNull();
  });

  it("renders 'No runs yet.' when the node has never run (last_run null)", () => {
    render(
      <TeamNodePanel
        teamId="t1"
        node={node({ last_run: null })}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("the brief is read-only — editing the prompt marks the form dirty but never alters the brief", async () => {
    const user = userEvent.setup();
    const withRun = node({
      kind: "completion",
      engine: null,
      last_run: {
        outcome: "prd_written",
        outcome_detail: "Drafted the spec from the idea.",
        run_id: "r1",
        iteration: 1,
        started_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    });
    render(
      <TeamNodePanel
        teamId="t1"
        node={withRun}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /prompt/i }), " more");
    // The form reads dirty (the brief is NOT part of the dirty check)...
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    // ...yet the read-only historical brief is untouched, still rendered.
    expect(screen.getByText("Drafted the spec from the idea.")).toBeInTheDocument();
  });
});
