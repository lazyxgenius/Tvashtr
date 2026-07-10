import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LARGE_REPO_FILE_THRESHOLD, type RepoInspect, type TeamGraphNode } from "../lib/api";
import { LaunchPanel } from "./LaunchPanel";

// Interaction in this file uses fireEvent (not user-event): some flows assert across the async
// inspect round-trip, and fireEvent is the deterministic, fake-timer-safe driver (HANDOVER §4).

function tnode(
  over: Partial<TeamGraphNode> & Pick<TeamGraphNode, "id" | "role_name" | "kind">,
): TeamGraphNode {
  return {
    model: "openai/gpt-4o-mini",
    engine: null,
    prompt: "behavior",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  };
}

function stubInspect(result: RepoInspect) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(result),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(opts?: { nodes?: TeamGraphNode[]; onLaunch?: ReturnType<typeof vi.fn> }) {
  const onLaunch = opts?.onLaunch ?? vi.fn();
  const onClose = vi.fn();
  render(
    <LaunchPanel
      teamNodes={opts?.nodes ?? [tnode({ id: "n1", role_name: "engineer", kind: "agent" })]}
      starting={false}
      onLaunch={onLaunch}
      onClose={onClose}
    />,
  );
  return { onLaunch, onClose };
}

function inspectPath(path: string) {
  const input = screen.getByLabelText("Repo path");
  fireEvent.change(input, { target: { value: path } });
  fireEvent.blur(input);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LaunchPanel", () => {
  it("opens with the feature-request box and the repo toggle Off (greenfield by default)", () => {
    renderPanel();
    expect(screen.getByLabelText("Feature request")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    // Repo fields are hidden until the toggle is On.
    expect(screen.queryByLabelText("Repo path")).toBeNull();
  });

  it("greenfield Run (empty idea, toggle Off) launches with NO extra fields", () => {
    const { onLaunch } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith({});
  });

  it("greenfield Run with a typed idea launches with only { idea }", () => {
    const { onLaunch } = renderPanel();
    fireEvent.change(screen.getByLabelText("Feature request"), {
      target: { value: "ship a greeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onLaunch).toHaveBeenCalledWith({ idea: "ship a greeting" });
  });

  it("the toggle reveals the repo path field", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    expect(screen.getByLabelText("Repo path")).toBeInTheDocument();
  });

  it("an invalid repo shows an inline error and keeps Run disabled", async () => {
    stubInspect({ is_git: false, error: "not a git work tree: /nope" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    inspectPath("/nope");

    await screen.findByText("Not a git repo:");
    expect(screen.getByText(/not a git work tree/)).toBeInTheDocument();
    // The Run-into-repo path stays disabled on a bad path.
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    // No base-branch dropdown for a non-repo.
    expect(screen.queryByLabelText("Base branch")).toBeNull();
  });

  it("a valid repo populates the base-branch dropdown defaulted to current_branch", async () => {
    stubInspect({
      is_git: true,
      current_branch: "develop",
      branches: ["main", "develop", "feature/x"],
      tracked_file_count: 12,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    inspectPath("/Users/me/repo");

    const select = await screen.findByLabelText<HTMLSelectElement>("Base branch");
    expect(select.value).toBe("develop"); // defaulted to current_branch
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "main",
      "develop",
      "feature/x",
    ]);
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("renders the large-repo model hint above threshold, naming the worker nodes", async () => {
    stubInspect({
      is_git: true,
      current_branch: "main",
      branches: ["main"],
      tracked_file_count: LARGE_REPO_FILE_THRESHOLD + 1,
    });
    renderPanel({
      nodes: [
        tnode({ id: "n-pm", role_name: "pm", kind: "completion" }),
        tnode({ id: "n-eng", role_name: "engineer", kind: "agent" }),
        tnode({ id: "n-rev", role_name: "reviewer", kind: "agent" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    inspectPath("/Users/me/big-repo");

    const hint = await screen.findByRole("note");
    expect(hint).toHaveTextContent(/Large repo/);
    // Names the WORKER (agent) nodes by role_name — and NOT the thinker (pm).
    expect(hint).toHaveTextContent("engineer, reviewer");
    expect(hint).not.toHaveTextContent("pm,");

    // Dismissible (D4 — advisory, never a blocker).
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
  });

  it("does NOT show the hint below threshold", async () => {
    stubInspect({
      is_git: true,
      current_branch: "main",
      branches: ["main"],
      tracked_file_count: LARGE_REPO_FILE_THRESHOLD,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    inspectPath("/Users/me/small-repo");
    await screen.findByLabelText("Base branch");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("brownfield Run launches with idea + repo_path + base_ref", async () => {
    stubInspect({
      is_git: true,
      current_branch: "main",
      branches: ["main", "dev"],
      tracked_file_count: 8,
    });
    const { onLaunch } = renderPanel();
    fireEvent.change(screen.getByLabelText("Feature request"), {
      target: { value: "add subtract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    inspectPath("/Users/me/repo");
    await screen.findByLabelText("Base branch");
    fireEvent.change(screen.getByLabelText("Base branch"), { target: { value: "dev" } });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onLaunch).toHaveBeenCalledWith({
      idea: "add subtract",
      repo_path: "/Users/me/repo",
      base_ref: "dev",
    });
  });
});

describe("LaunchPanel — edits-off action-verb advisory (M-unify U3)", () => {
  const WARN = "Edits-off action-verb advisory";

  it("flags an edits-off node whose prompt asks it to implement (amber, names node + verb, non-blocking)", () => {
    const { onLaunch } = renderPanel({
      nodes: [
        tnode({
          id: "n-x",
          role_name: "planner",
          kind: "completion", // completion ⇒ edits-off by default
          prompt: "Implement the subtract(a, b) function and a unit test.",
        }),
      ],
    });
    // The advisory names the node + the verb…
    const warn = screen.getByRole("note", { name: WARN });
    expect(warn).toHaveTextContent("planner");
    expect(warn).toHaveTextContent("implement");
    expect(warn).toHaveTextContent(/can.t write files/i);
    // …and it NEVER blocks launch — Run is enabled and fires.
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("does NOT flag an EDITS-ON node with the same action-verb prompt", () => {
    renderPanel({
      nodes: [
        tnode({
          id: "n-eng",
          role_name: "engineer",
          kind: "agent", // agent ⇒ edits-on by default → not a misconfiguration
          prompt: "Implement the subtract(a, b) function.",
        }),
      ],
    });
    expect(screen.queryByRole("note", { name: WARN })).toBeNull();
  });

  it("does NOT flag an edits-off node whose action verb is NEGATED or about its own verdict/report", () => {
    renderPanel({
      nodes: [
        // A Reviewer-shaped prompt: "do NOT modify…" (negated) + "Write … REVIEW_VERDICT.json" (its
        // own deliverable) — both spared, so a correctly edits-off reviewer never trips the advisory.
        tnode({
          id: "n-rev",
          role_name: "reviewer",
          kind: "agent",
          edits_allowed: false,
          prompt:
            "Review it. Do NOT modify, create, or delete any file. Write a file named REVIEW_VERDICT.json with your verdict.",
        }),
      ],
    });
    expect(screen.queryByRole("note", { name: WARN })).toBeNull();
  });
});
