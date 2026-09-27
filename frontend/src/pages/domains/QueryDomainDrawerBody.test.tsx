import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests, useNavBadges } from "../../lib/workspaceStatus";
import { QueryDomainPanel } from "./QueryDomainDrawerBody";
import { mockApi, sampleDomains } from "./domainsTestUtils";

function teamNode(id: string, role_name: string, kind: string, config = {}): TeamGraphNode {
  return {
    id,
    role_name,
    kind,
    model: null,
    engine: null,
    prompt: null,
    position: { x: 0, y: 0 },
    config,
  };
}

const DQ = (config: Record<string, unknown>, prompt = "{idea}"): TeamGraphNode => ({
  ...teamNode("n-dq", "domain_query", "domain_query", config),
  prompt,
});
const NODES = [
  teamNode("n-pm", "pm", "completion"),
  teamNode("n-writer", "writer", "agent", { title: "Writer" }),
  teamNode("n-rev", "reviewer", "agent"),
];
const EDGES: GraphEdge[] = [
  ["n-pm", "n-dq"],
  ["n-dq", "n-writer"],
  ["n-writer", "n-rev"],
].map(([s, t]) => ({
  id: `${s}-${t}`,
  source_node_id: s,
  target_node_id: t,
  edge_type: "work",
  conditions: null,
}));

const PICKED = DQ(
  {
    domain_id: "d-support",
    title: "Look up support docs",
    pass_to_spec: true,
    on_no_answer: "continue",
  },
  "What do our support docs say about {idea}?",
);

const RUN = {
  runs: [{ run_id: "r-14" }],
  run: {
    run_id: "r-14",
    number: 14,
    rounds: [
      {
        iteration: 1,
        status: "done",
        outcome: "answered",
        outcome_detail: "Refunds…",
        cost: { cost_usd: 0.0012 },
        domain: {
          question: "What do our support docs say about a self-serve refund button?",
          answer_text:
            "Refunds are requested from Billing → Refunds within 30 days [1]. Annual plans are prorated after that [2].",
          covered: true,
          sources: [
            {
              number: 1,
              document_id: "f1",
              filename: "refund-policy.md",
              piece_number: 3,
              pieces_in_file: 42,
              page: null,
              excerpt:
                "Customers may request a full refund within 30 days of their original purchase date.",
            },
            {
              number: 2,
              document_id: "f2",
              filename: "billing-faq.pdf",
              piece_number: 17,
              pieces_in_file: 86,
              page: 4,
              excerpt: "For annual subscriptions we refund the unused whole months.",
            },
          ],
          citations: [],
          latency_ms: 1900,
          cost_usd: 0.0012,
          spec_section: "What the docs say",
        },
      },
    ],
  },
};

let saved: ReturnType<typeof vi.fn>;

let onDraft: ReturnType<typeof vi.fn>;

function setup(node: TeamGraphNode, runs: object = { runs: [], run: null }, patch?: object) {
  const calls = mockApi({
    "GET /api/domains": { domains: sampleDomains() },
    "GET /api/teams/:t/nodes/:n/runs": runs,
    "PATCH /api/teams/:t/nodes/:n": patch ?? {},
  });
  saved = vi.fn();
  onDraft = vi.fn();
  render(
    <ToastProvider>
      <QueryDomainPanel
        teamId="t-docs"
        node={node}
        nodes={[...NODES, node]}
        edges={EDGES}
        onSaved={saved}
        onDraft={onDraft}
      >
        {({ title, subtitle, body }) => (
          <aside aria-label="Node settings">
            <h2>{title}</h2>
            <p data-testid="subtitle">{subtitle}</p>
            {body}
          </aside>
        )}
      </QueryDomainPanel>
    </ToastProvider>,
  );
  return calls;
}

const drawer = () => screen.getByRole("complementary", { name: "Node settings" });
const trigger = () => within(drawer()).getByRole("button", { name: /^Domain / });

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Query domain drawer — Setup (Dm-QueryNode)", () => {
  it("shows the picked domain, its status, the question and the settings, saved", async () => {
    setup(PICKED);
    await waitFor(() => expect(trigger()).toHaveAccessibleName("Domain Support docs"));
    const d = drawer();
    expect(within(d).getByTestId("subtitle")).toHaveTextContent("Look up support docs");
    expect(
      within(d).getByText(
        "One cited lookup, every run. The answer and its sources show on the run log.",
      ),
    ).toBeInTheDocument();
    expect(within(d).getByText("Ready · 14 files · 83% found the right file")).toBeInTheDocument();
    expect(within(d).getByLabelText<HTMLTextAreaElement>("Question to ask").value).toBe(
      "What do our support docs say about {idea}?",
    );
    expect(
      within(d).getByRole("switch", { name: "Pass the answer to the next agents" }),
    ).toBeChecked();
    expect(
      within(d).getByText(
        "Adds the answer and its sources to the spec, so the Writer and Reviewer read them.",
      ),
    ).toBeInTheDocument();
    expect(within(d).getByLabelText<HTMLSelectElement>("If the domain has no answer").value).toBe(
      "continue",
    );
    expect(within(d).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(d).getByText("Saved — this drives the next run you launch.")).toBeInTheDocument();
    expect(within(d).queryByRole("tablist")).toBeNull();
  });

  it("lists every domain with its status; one with no files can't be picked (Canvas-2)", async () => {
    setup(DQ({ domain_id: null, pass_to_spec: true, on_no_answer: "continue" }));
    await waitFor(() => expect(trigger()).toHaveAccessibleName("Domain Pick a domain"));
    fireEvent.click(trigger());
    const list = within(drawer()).getByRole("listbox", { name: "Domain" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Support docsReady · 14 files",
      "Vendor contractsReading 4 of 6",
      "Research papers1 file needs attention",
      "Q3 filingsNo files yet — can’t be used",
      "New domain…",
    ]);
    expect(options[3]).toBeDisabled();
    expect(within(list).getByRole("separator")).toBeInTheDocument();
  });

  it("picking renames a default node, fills the question and saves both settings (Canvas-3)", async () => {
    const calls = setup(DQ({ domain_id: null, pass_to_spec: true, on_no_answer: "continue" }));
    await waitFor(() => expect(trigger()).toBeEnabled());
    fireEvent.click(trigger());
    fireEvent.click(within(drawer()).getByRole("option", { name: /Support docs/ }));
    const d = drawer();
    expect(trigger()).toHaveAccessibleName("Domain Support docs");
    expect(within(d).getByTestId("subtitle")).toHaveTextContent("Look up support docs");
    expect(within(d).getByLabelText<HTMLTextAreaElement>("Question to ask").value).toBe(
      "What do our support docs say about {idea}?",
    );
    expect(within(d).getByText("Unsaved changes")).toBeInTheDocument();
    // The canvas card follows the unsaved pick (DmF-Canvas-3).
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain_id: "d-support", title: "Look up support docs" }),
    );
    fireEvent.change(within(d).getByLabelText("If the domain has no answer"), {
      target: { value: "stop" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/teams/t-docs/nodes/n-dq");
    expect(patch?.body).toEqual({
      domain_id: "d-support",
      title: "Look up support docs",
      prompt: "What do our support docs say about {idea}?",
      pass_to_spec: true,
      on_no_answer: "stop",
    });
  });

  it("a node from before the settings stores them on its first save (OQ-21)", async () => {
    const calls = setup(DQ({ domain_id: "d-support" }, "Refunds? {idea}"));
    await waitFor(() => expect(trigger()).toHaveAccessibleName("Domain Support docs"));
    expect(within(drawer()).getByRole("switch", { name: /Pass the answer/ })).not.toBeChecked();
    fireEvent.click(within(drawer()).getByRole("switch", { name: /Pass the answer/ }));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      pass_to_spec: true,
      on_no_answer: "continue",
    });
  });

  it("says so when the save fails", async () => {
    mockApi({});
    setup(PICKED, { runs: [], run: null }, new Response("{}", { status: 500 }));
    await waitFor(() => expect(trigger()).toBeEnabled());
    fireEvent.change(within(drawer()).getByLabelText("Question to ask"), {
      target: { value: "Refunds? {idea}" },
    });
    fireEvent.click(within(drawer()).getByRole("button", { name: "Save" }));
    expect(await within(drawer()).findByRole("alert")).toHaveTextContent(
      "Couldn’t save — try again.",
    );
    expect(saved).not.toHaveBeenCalled();
  });

  it("New domain… opens the New domain dialog", async () => {
    setup(PICKED);
    await waitFor(() => expect(trigger()).toBeEnabled());
    fireEvent.click(trigger());
    fireEvent.click(within(drawer()).getByRole("option", { name: "New domain…" }));
    expect(await screen.findByRole("dialog", { name: "New domain" })).toBeInTheDocument();
  });

  it("keeps the nav's domain list fresh for the canvas cards", async () => {
    let seen: unknown;
    function Probe() {
      seen = useNavBadges().domains;
      return null;
    }
    render(<Probe />);
    setup(PICKED);
    await waitFor(() => expect(seen).toHaveLength(4));
  });
});

describe("Query domain drawer — Last run (DmF-Step-5)", () => {
  it("shows the round, what it asked, the answer with its sources and where it went", async () => {
    setup(PICKED, RUN);
    const d = drawer();
    await waitFor(() =>
      expect(within(d).getByTestId("subtitle")).toHaveTextContent("Look up support docs · run 14"),
    );
    fireEvent.click(within(d).getByRole("tab", { name: "Last run" }));
    expect(within(d).getByText("Round 1")).toBeInTheDocument();
    expect(within(d).getByText("Answered")).toBeInTheDocument();
    expect(within(d).getByText("1.9 s · $0.0012")).toBeInTheDocument();
    expect(
      within(d).getByText(
        "Asked: “What do our support docs say about a self-serve refund button?”",
      ),
    ).toBeInTheDocument();
    const sources = within(d).getByRole("complementary", { name: "Sources" });
    expect(within(sources).getByText("Sources for this answer")).toBeInTheDocument();
    expect(within(sources).getByText("refund-policy.md")).toBeInTheDocument();
    expect(within(sources).getByText("page 4 · piece 17 of 86")).toBeInTheDocument();
    expect(
      within(d).getByText("Added to the spec · section “What the docs say”"),
    ).toBeInTheDocument();
    expect(within(d).queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.click(within(d).getByRole("tab", { name: "Setup" }));
    expect(within(d).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("a stopped round shows No answer and the reason", async () => {
    const stopped = structuredClone(RUN);
    Object.assign(stopped.run.rounds[0], {
      status: "failed",
      outcome: "no_answer",
      outcome_detail:
        "Look up support docs stopped the run: Support docs has no answer for “Refund button?”.",
    });
    Object.assign(stopped.run.rounds[0].domain, {
      covered: false,
      sources: [],
      spec_section: null,
    });
    setup(PICKED, stopped);
    const d = drawer();
    fireEvent.click(await within(d).findByRole("tab", { name: "Last run" }));
    expect(within(d).getByText("No answer")).toBeInTheDocument();
    expect(
      within(d).getByText(
        "Look up support docs stopped the run: Support docs has no answer for “Refund button?”.",
      ),
    ).toBeInTheDocument();
    expect(within(d).queryByRole("complementary", { name: "Sources" })).toBeNull();
  });
});
