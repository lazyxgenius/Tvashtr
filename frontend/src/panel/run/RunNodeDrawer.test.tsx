import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphNode, NodeInvocation, NodeMemoryRow, RunRow } from "../../lib/api";
import type { NodeTab } from "../../lib/nav";
import { RunNodeDrawer } from "./RunNodeDrawer";

// Q20: the run view's drawer is the Team screen's agent drawer — the same header, badges and five
// tabs — opening on Runs. Runs holds this run's rounds and the run-only tools (Activity, Changes,
// Ask); Setup and Skills & tools are the run's copy of the agent, read-only.

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    prompt: null,
    position: { x: 0, y: 0 },
    config: null,
    status: "done",
    iteration: 1,
    invocations: [],
    ...over,
  };
}

function inv(over: Partial<NodeInvocation> & Pick<NodeInvocation, "iteration">): NodeInvocation {
  return {
    status: "done",
    outcome: null,
    outcome_detail: null,
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    context_manifest: null,
    cost: null,
    ...over,
  };
}

function runRow(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "r1",
    team_graph_id: "g1",
    idea: "x",
    status: "running",
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    cost_total_usd: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

type DrawerProps = ComponentProps<typeof RunNodeDrawer>;

/** The drawer with its tab held in state, as the page does (the address). No run id unless a test
 * reads the run's data (the step feed, the diff, memories, documents), so nothing else loads. */
function Drawer(props: Partial<DrawerProps> & Pick<DrawerProps, "node">) {
  const [tab, setTab] = useState<NodeTab>(props.tab ?? "runs");
  return (
    <RunNodeDrawer
      nodes={[props.node]}
      edges={[]}
      runId={null}
      run={runRow({ status: "completed" })}
      workflowStatus={null}
      onClose={() => {}}
      {...props}
      tab={tab}
      onTabChange={setTab}
    />
  );
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

// Every request the drawer can make answers something empty unless a test says otherwise: the step
// feed, the run's memories, the memory store, the documents, the Toolkit shelves and templates.
let answers: (url: string) => unknown;
beforeEach(() => {
  answers = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      const body = answers(url) ?? (url.includes("run-events") ? { run_id: "r1", events: [] } : {});
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const drawer = (name: string) => within(screen.getByRole("complementary", { name }));

describe("RunNodeDrawer — the Team screen's drawer, opening on Runs", () => {
  it("shows the agent's name, tagline and badges over the five tabs, on Runs", () => {
    const onClose = vi.fn();
    render(
      <Drawer
        node={gnode({
          id: "n-rev",
          role_name: "reviewer",
          kind: "agent",
          model: "xai/grok-4.7",
          edits_allowed: false,
          config: { title: "Checker", description: "Checks against the spec" },
          invocations: [inv({ iteration: 1, outcome: "changes_requested" })],
        })}
        onClose={onClose}
      />,
    );
    const d = drawer("Checker in this run");
    expect(d.getByRole("heading", { name: "Checker" })).toBeInTheDocument();
    expect(d.getByText("Checks against the spec")).toBeInTheDocument();
    expect(d.getByTitle("See the last run")).toHaveTextContent(/^Changes requested/);
    expect(d.getByText("Read-only")).toBeInTheDocument();
    expect(d.getByText("grok-4.7")).toBeInTheDocument();
    expect(d.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Setup",
      "Skills & tools",
      "Memory",
      "Runs",
      "Docs",
    ]);
    expect(d.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
    // Nothing on Runs is saved: no Save footer.
    expect(d.queryByRole("button", { name: /^Save/ })).toBeNull();
    fireEvent.click(d.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("badges what the agent is doing in THIS run", () => {
    const eng = (over: Partial<GraphNode>) =>
      gnode({ id: "n-eng", role_name: "engineer", kind: "agent", ...over });
    const { rerender } = render(
      <Drawer
        node={eng({ status: "running", invocations: [inv({ iteration: 1, status: "running" })] })}
        run={runRow({ status: "running" })}
        workflowStatus="PENDING"
      />,
    );
    const badge = () => screen.getByTitle("See the last run");
    expect(badge()).toHaveTextContent("Running");

    rerender(
      <Drawer
        node={eng({ status: "idle", iteration: 0 })}
        run={runRow({ status: "running" })}
        workflowStatus="PENDING"
      />,
    );
    expect(badge()).toHaveTextContent("Waiting");

    rerender(
      <Drawer node={eng({ status: "idle", iteration: 0 })} run={runRow({ status: "completed" })} />,
    );
    expect(badge()).toHaveTextContent("Not reached");

    rerender(
      <Drawer
        node={eng({ status: "failed", invocations: [inv({ iteration: 1, status: "failed" })] })}
        run={runRow({ status: "failed" })}
      />,
    );
    expect(badge()).toHaveTextContent(/^Failed/);

    rerender(
      <Drawer
        node={eng({ invocations: [inv({ iteration: 1, outcome: "built" })] })}
        run={runRow({ status: "completed" })}
      />,
    );
    expect(badge()).toHaveTextContent(/^Done/);
  });

  it("the status badge goes back to Runs from another tab", () => {
    render(
      <Drawer node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent" })} tab="docs" />,
    );
    fireEvent.click(screen.getByTitle("See the last run"));
    expect(screen.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses the entry agent's glyph and keeps its Setup locked to the idea", async () => {
    const { container } = render(
      <Drawer
        node={gnode({ id: "n-pm", role_name: "pm", kind: "completion", prompt: "Write the PRD." })}
        isEntry
        tab="setup"
      />,
    );
    expect(container.querySelector(".nd-glyph .lucide-zap")).not.toBeNull();
    expect(screen.getByText(/The idea you type when you press Run/)).toBeInTheDocument();
    await act(async () => {}); // the templates list lands
  });
});

describe("RunNodeDrawer — Runs: this run's rounds", () => {
  it("shows the latest round as Last run and the earlier ones below, newest first", () => {
    const reason = "Missing the overdue-check pure function.";
    render(
      <Drawer
        node={gnode({
          id: "n-rev",
          role_name: "reviewer",
          kind: "agent",
          invocations: [
            inv({ iteration: 1, outcome: "changes_requested", outcome_detail: reason }),
            inv({ iteration: 2, outcome: "approved", outcome_detail: "Looks right." }),
          ],
        })}
      />,
    );
    const last = within(screen.getByRole("region", { name: "Last run" }));
    expect(last.getByText("Approved")).toBeInTheDocument();
    expect(last.getByText(/^Round 2/)).toBeInTheDocument();
    expect(last.getByText("Looks right.")).toBeInTheDocument();
    // Round 1 waits folded under Earlier rounds; opening it shows its reasons.
    const earlier = screen.getByRole("button", { name: /Round 1/ });
    expect(earlier).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(reason)).toBeNull();
    fireEvent.click(earlier);
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("gives a round its exact tokens, cost and context manifest", () => {
    render(
      <Drawer
        node={gnode({
          id: "n-eng",
          role_name: "engineer",
          kind: "agent",
          invocations: [
            inv({
              iteration: 1,
              outcome: "built",
              outcome_detail: "Built it.",
              cost: {
                prompt_tokens: 1240,
                completion_tokens: 320,
                total_tokens: 1560,
                cost_usd: 0.0041,
              },
              context_manifest: {
                parts: [
                  { name: "system", tokens: 900 },
                  { name: "spec", tokens: 2100 },
                ],
                total_tokens: 3000,
                budget: 8000,
                handle_used: true,
              },
            }),
          ],
        })}
      />,
    );
    const last = within(screen.getByRole("region", { name: "Last run" }));
    expect(last.getByText("1,240 in / 320 out")).toBeInTheDocument();
    expect(last.getByText("$0.0041")).toBeInTheDocument();
    expect(last.getByLabelText("Context manifest")).toBeInTheDocument();
    expect(last.getByText("Budget")).toBeInTheDocument();
    expect(last.getByText("Spec offloaded to SPEC.md")).toBeInTheDocument();
  });

  it("says the agent wasn't reached yet (live) or at all (finished)", () => {
    const idle = gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "idle" });
    const { rerender } = render(
      <Drawer node={idle} run={runRow({ status: "running" })} workflowStatus="PENDING" />,
    );
    expect(screen.getByText("Not reached in this run")).toBeInTheDocument();
    expect(
      screen.getByText("Its rounds show up here once the run gets to it."),
    ).toBeInTheDocument();
    rerender(<Drawer node={idle} run={runRow({ status: "completed" })} />);
    expect(screen.getByText("The run ended before it got to this agent.")).toBeInTheDocument();
  });
});

describe("RunNodeDrawer — Runs: Activity, Changes and Ask", () => {
  it("a worker's Activity is its own step feed, round by round", async () => {
    answers = (url) =>
      url.includes("run-events")
        ? {
            run_id: "r1",
            events: [
              {
                seq: 1,
                kind: "action",
                payload: { thought: "engineer step one" },
                created_at: "2026-01-01T00:00:00Z",
                invocation_id: 10,
                node_id: "n-eng",
                iteration: 1,
              },
              {
                seq: 1,
                kind: "action",
                payload: { thought: "OTHER node step" },
                created_at: "2026-01-01T00:00:00Z",
                invocation_id: 20,
                node_id: "n-other",
                iteration: 1,
              },
            ],
          }
        : undefined;
    render(
      <Drawer runId="r1" node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent" })} />,
    );
    expect(screen.getByRole("button", { name: "Activity" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText("engineer step one")).toBeInTheDocument();
    expect(screen.queryByText("OTHER node step")).toBeNull();
  });

  it("a worker's Changes shows the run's changed files", async () => {
    answers = (url) =>
      url.endsWith("/diff")
        ? {
            run_id: "r1",
            files: [{ path: "src/app.py", status: "modified", additions: 3, deletions: 1 }],
            total: 1,
          }
        : undefined;
    render(
      <Drawer runId="r1" node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent" })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Changes" }));
    expect(await screen.findByText("src/app.py")).toBeInTheDocument();
  });

  it("Ask opens the chat once the agent has run, on a worker and a thinker", () => {
    const ran = [inv({ iteration: 1, outcome: "built", outcome_detail: "did it" })];
    const { rerender } = render(
      <Drawer
        node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent", invocations: ran })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByLabelText("Ask this node")).toBeInTheDocument();

    // A thinker has no step feed or file changes here: Ask only.
    rerender(
      <Drawer
        key="pm"
        node={gnode({ id: "n-pm", role_name: "pm", kind: "completion", invocations: ran })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ask" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Ask this node")).toBeInTheDocument();
  });

  it("hides Ask on an agent that hasn't run yet", () => {
    render(
      <Drawer
        node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "idle" })}
        run={runRow({ status: "running" })}
      />,
    );
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });
});

describe("RunNodeDrawer — Setup and Skills & tools are the run's copy, read-only", () => {
  it("Setup shows the run's instructions and settings, none of them editable", async () => {
    const onEditOnTeam = vi.fn();
    render(
      <Drawer
        node={gnode({
          id: "n-eng",
          role_name: "engineer",
          kind: "agent",
          prompt: "Build the feature.",
          edits_allowed: true,
          config: { multimodal: true },
        })}
        tab="setup"
        onEditOnTeam={onEditOnTeam}
      />,
    );
    const instructions = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /^Instructions/,
    });
    expect(instructions.value).toBe("Build the feature.");
    expect(instructions).toHaveAttribute("readonly");
    expect(screen.getByRole("switch", { name: "Images" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Templates/ })).toBeDisabled();
    // Advanced starts open (its controls can't be opened from a disabled toggle).
    expect(screen.getByRole("button", { name: /Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // The footer says where changes go, with no Save.
    expect(
      screen.getByText(
        "This run uses a copy of the team from when it started. Change the agent on the team to change the next run.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit on the team" }));
    expect(onEditOnTeam).toHaveBeenCalled();
    await act(async () => {}); // the templates list lands
  });

  it("Skills & tools lists the run's skills with every control off", async () => {
    render(
      <Drawer
        node={gnode({
          id: "n-eng",
          role_name: "engineer",
          kind: "agent",
          skills: [{ type: "inline", name: "house-style", content: "Be terse.", mode: "always" }],
        })}
        tab="skills"
      />,
    );
    expect(screen.getByRole("tab", { name: /^Skills & tools\s*1$/ })).toBeInTheDocument();
    const row = screen.getByText("house-style").closest("li") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Always on" })).toBeDisabled();
    expect(screen.getByText(/This run uses a copy of the team/)).toBeInTheDocument();
    // No team to go back to (not a copy): no button.
    expect(screen.queryByRole("button", { name: "Edit on the team" })).toBeNull();
    await act(async () => {}); // the Toolkit shelves land
  });
});

describe("RunNodeDrawer — Memory: what the agent was given and what the run taught", () => {
  function memRow(over: Partial<NodeMemoryRow> = {}): NodeMemoryRow {
    return {
      id: "m1",
      content: "a fact",
      polarity: "context",
      repo_key: null,
      node_id: null,
      tier: "account",
      pinned: false,
      status: "active",
      confirmation_count: 1,
      source_run_id: "r1",
      source_invocation_id: null,
      embedding_dim: 1536,
      valid_from: null,
      invalid_at: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: null,
      ...over,
    };
  }

  it("resolves the notes this agent used and lists what the run learned", async () => {
    answers = (url) =>
      /\/api\/runs\/[^/]+\/memories/.test(url)
        ? {
            memories: [
              memRow({ id: "l1", content: "run the linter", polarity: "require", tier: "repo" }),
            ],
          }
        : url.includes("/api/memories")
          ? { memories: [memRow({ id: "u1", content: "prefer pnpm", polarity: "prefer" })] }
          : undefined;
    render(
      <Drawer
        node={gnode({
          id: "n-eng",
          role_name: "engineer",
          kind: "agent",
          invocations: [
            inv({
              iteration: 1,
              outcome: "built",
              context_manifest: {
                parts: [],
                total_tokens: 0,
                budget: 0,
                handle_used: false,
                memory: [{ id: "u1", polarity: "prefer" }],
              },
            }),
          ],
        })}
        tab="memory"
        runId="r1"
      />,
    );
    const used = within(await screen.findByRole("region", { name: "Used this run" }));
    expect(used.getByText("prefer pnpm")).toBeInTheDocument();
    expect(used.getByText("SHOULD")).toBeInTheDocument();
    const learned = within(screen.getByRole("region", { name: "Learned this run" }));
    expect(learned.getByText("run the linter")).toBeInTheDocument();
    expect(learned.getByText("This repo")).toBeInTheDocument();
  });
});

describe("RunNodeDrawer — Docs: the run's documents", () => {
  it("lists the shared spec first, then what the agents wrote, each with Open", async () => {
    const ref = (node_id: string, label: string) => ({
      node_id,
      clone_node_id: `c-${node_id}`,
      role_name: node_id,
      label,
    });
    answers = (url) =>
      url.includes("/documents")
        ? {
            run: { run_id: "r1", idea: "x", status: "running", created_at: "", live: true },
            documents: [
              {
                id: "d-notes",
                name: "build-notes",
                latest_version: { version_no: 2, created_at: "2026-01-01T00:00:00Z" },
                written_by: [ref("n-eng", "Engineer")],
                read_by: [ref("n-rev", "Reviewer")],
              },
              {
                id: "d-spec",
                name: "spec",
                doc_type: "prd",
                is_shared_spec: true,
                latest_version: { version_no: 3, created_at: "2026-01-01T00:00:00Z" },
                written_by: [ref("n-pm", "Product manager")],
                read_by: [ref("n-eng", "Engineer")],
              },
            ],
          }
        : undefined;
    const onOpenDoc = vi.fn();
    render(
      <Drawer
        node={gnode({ id: "c-n-eng", role_name: "engineer", kind: "agent" })}
        run={runRow({ status: "running" })}
        tab="docs"
        runId="r1"
        onOpenDoc={onOpenDoc}
      />,
    );
    const shared = within(
      (await screen.findByText("PRD · written by Product manager")).closest("li")!,
    );
    expect(shared.getByText("Shared spec")).toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Shared spec");
    expect(cards[1]).toHaveTextContent("build-notes");
    expect(within(cards[1]).getByText("Written by Engineer")).toBeInTheDocument();
    fireEvent.click(shared.getByRole("button", { name: "Open" }));
    expect(onOpenDoc).toHaveBeenCalledWith("d-spec");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Open" }));
    expect(onOpenDoc).toHaveBeenLastCalledWith("d-notes");
  });

  it("says when the documents can't load (Retry), and keeps them while a new round reloads", async () => {
    const SPEC = {
      run: { run_id: "r1", idea: "x", status: "running", created_at: "", live: true },
      documents: [
        {
          id: "d-spec",
          name: "spec",
          is_shared_spec: true,
          latest_version: { version_no: 3, created_at: "2026-01-01T00:00:00Z" },
          written_by: [],
          read_by: [],
        },
      ],
    };
    let answer: () => Promise<Response> = () =>
      Promise.resolve(new Response(JSON.stringify({ detail: "down" }), { status: 500 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer()),
    );
    const docsOf = (status: string) => (
      <Drawer
        node={gnode({ id: "c-n-pm", role_name: "pm", kind: "completion", status })}
        run={runRow({ status: "running" })}
        tab="docs"
        runId="r1"
        onOpenDoc={vi.fn()}
      />
    );
    const view = render(docsOf("running"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load this run’s documents.");
    expect(screen.queryByText("The product manager is drafting the spec…")).toBeNull();

    answer = () => Promise.resolve(new Response(JSON.stringify(SPEC)));
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Shared spec")).toBeInTheDocument();

    // The node's round moves on: the card stays while the documents reload.
    answer = () => new Promise(() => undefined);
    view.rerender(docsOf("completed"));
    expect(screen.getByText("Shared spec")).toBeInTheDocument();
    expect(screen.queryByText("The product manager is drafting the spec…")).toBeNull();
  });

  it("says what's coming when the run has no documents yet", async () => {
    answers = (url) => (url.includes("/documents") ? { documents: [] } : undefined);
    render(
      <Drawer
        node={gnode({ id: "n-pm", role_name: "pm", kind: "completion" })}
        run={runRow({ status: "running" })}
        tab="docs"
        runId="r1"
      />,
    );
    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
    expect(screen.getByText("The product manager is drafting the spec…")).toBeInTheDocument();
  });
});
