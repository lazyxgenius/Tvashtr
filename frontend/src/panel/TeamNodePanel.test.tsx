import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../lib/api";
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

const jsonOk = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;

// The PATCH call among all fetches (the panel also GETs /api/providers on mount + may POST a key).
function patchCall() {
  return fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH") as
    | [RequestInfo | URL, RequestInit]
    | undefined;
}

let fetchMock: ReturnType<typeof vi.fn>;
let providersState: { provider: string; key_last4: string; created_at: string }[];

beforeEach(() => {
  // M-accounts Slice C: the panel fetches /api/providers on mount + can POST a key inline, so the
  // stub is URL-aware + stateful — GET returns the live list, POST appends + echoes last4, PATCH (the
  // node-update) echoes the node. Anything else (e.g. updateTeamNode's response) echoes the node too.
  providersState = [
    { provider: "openai", key_last4: "1111", created_at: "x" },
    { provider: "nvidia_nim", key_last4: "2222", created_at: "x" },
  ];
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/api/providers" && method === "GET") {
      return Promise.resolve(jsonOk({ providers: providersState }));
    }
    if (url === "/api/providers" && method === "POST") {
      const { provider, api_key } = JSON.parse(init!.body as string) as {
        provider: string;
        api_key: string;
      };
      const last4 = api_key.slice(-4);
      if (!providersState.some((p) => p.provider === provider)) {
        providersState.push({ provider, key_last4: last4, created_at: "x" });
      }
      return Promise.resolve(jsonOk({ provider, key_last4: last4 }));
    }
    return Promise.resolve(jsonOk(node({ prompt: "edited" })));
  });
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
    const model = screen.getByRole<HTMLInputElement>("combobox", { name: "Model" });
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
    expect(patchCall()).toBeUndefined(); // no node-update PATCH before a real edit

    await user.clear(prompt);
    await user.type(prompt, "Write greeting.txt = SENTINEL");
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(save);

    // The Save PATCHed the node-update endpoint with the edited prompt + model + the (unchanged)
    // capability — the panel posts the full values (the FE is dirty-aware but sends all of them).
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [calledUrl, init] = patchCall()!;
    expect(urlOf(calledUrl)).toBe("/api/teams/team-1/nodes/n-eng");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Write greeting.txt = SENTINEL",
      model: "openai/gpt-4o-mini",
      capability: "worker",
      // M-tools C7.A (S2): updateTeamNode now always sends tool_config/skills (null when unset).
      tool_config: null,
      skills: null,
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
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Original engineer prompt",
      model: "openai/gpt-4o-mini",
      capability: "thinker",
      // M-tools C7.A (S2): updateTeamNode now always sends tool_config/skills (null when unset).
      tool_config: null,
      skills: null,
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

// ---- M-accounts Slice C: the provider-gated picker + the recommendation hint ----

function reviewer(model: string): TeamGraphNode {
  return { ...node({ id: "n-rev", role_name: "reviewer", model }) };
}
function engineer(model: string): TeamGraphNode {
  return { ...node({ id: "n-eng", role_name: "engineer", model }) };
}
// A review_loop-shaped wiring so emitContract(reviewer) is a verdict/branch worker (gating), while
// engineer (only an unconditional out-edge) is NOT gating.
const REVIEW_EDGES: GraphEdge[] = [
  {
    id: "e1",
    source_node_id: "n-eng",
    target_node_id: "n-rev",
    edge_type: "review",
    conditions: null,
  },
  {
    id: "e2",
    source_node_id: "n-rev",
    target_node_id: "n-eng",
    edge_type: "review",
    conditions: { loop_limit: 3 },
  },
  {
    id: "e3",
    source_node_id: "n-rev",
    target_node_id: "n-ship",
    edge_type: "review",
    conditions: { when: "approved" },
  },
];

describe("TeamNodePanel — provider-gated model picker (Slice C)", () => {
  it("lists the account's providers, scopes the model to one, and composes node.model on Save", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="t1"
        node={engineer("openai/gpt-4o-mini")}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    // The Provider select is populated from listProviders (openai + nvidia_nim) and reflects the node.
    const provider = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Provider" });
    await waitFor(() => expect(provider).toHaveValue("openai"));
    expect(screen.getByRole("option", { name: "nvidia_nim" })).toBeInTheDocument();

    // Switching the provider rewrites node.model's leading segment to that provider's quick-pick.
    await user.selectOptions(provider, "nvidia_nim");
    const model = screen.getByRole<HTMLInputElement>("combobox", { name: "Model" });
    expect(model.value).toBe("nvidia_nim/meta/llama-3.3-70b-instruct");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const saved = JSON.parse(patchCall()![1].body as string) as { model: string };
    expect(saved.model).toBe("nvidia_nim/meta/llama-3.3-70b-instruct");
  });

  it("inline 'Add a provider' reuses addProvider, refetches, and selects the new provider", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="t1"
        node={engineer("openai/gpt-4o-mini")}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    const provider = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Provider" });
    await waitFor(() => expect(provider).toHaveValue("openai"));
    // groq is NOT configured yet.
    expect(screen.queryByRole("option", { name: "groq" })).toBeNull();

    await user.selectOptions(provider, "__add_provider__");
    await user.type(screen.getByLabelText("New provider"), "groq");
    await user.type(screen.getByLabelText("New provider API key"), "gsk-dummy-9999");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // It POSTed via addProvider, refetched, and the new provider is now in the select + selected.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            urlOf(c[0] as RequestInfo | URL) === "/api/providers" &&
            (c[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole("option", { name: "groq" })).toBeInTheDocument();
    await waitFor(() => expect(provider).toHaveValue("groq"));
  });
});

describe("TeamNodePanel — recommendation hint (Slice C, the discriminating pair)", () => {
  const HINT = /Reviews are stronger when the reviewer runs a more capable model/i;

  it("fires for a reviewer sharing the worker's model AND is absent when they differ", async () => {
    // PRESENT: reviewer + engineer both run the SAME model.
    const same = render(
      <TeamNodePanel
        teamId="t1"
        node={reviewer("openai/gpt-4o-mini")}
        edges={REVIEW_EDGES}
        nodes={[reviewer("openai/gpt-4o-mini"), engineer("openai/gpt-4o-mini")]}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    same.unmount();

    // ABSENT: a DIFFERENT model on the engineer → no shared-model sibling → no hint (an always-on
    // hint would fail here; an always-off hint would fail above).
    render(
      <TeamNodePanel
        teamId="t1"
        node={reviewer("openai/gpt-4o-mini")}
        edges={REVIEW_EDGES}
        nodes={[reviewer("openai/gpt-4o-mini"), engineer("nvidia_nim/meta/llama-3.3-70b-instruct")]}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("is absent on a thinker (non-gating), dismiss hides it, and it never blocks Save", async () => {
    const user = userEvent.setup();
    // A thinker (kind completion) never shows the hint even with a same-model sibling.
    const t = render(
      <TeamNodePanel
        teamId="t1"
        node={node({
          id: "n-pm",
          role_name: "pm",
          kind: "completion",
          engine: null,
          model: "openai/gpt-4o-mini",
        })}
        edges={REVIEW_EDGES}
        nodes={[engineer("openai/gpt-4o-mini")]}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(HINT)).toBeNull();
    t.unmount();

    render(
      <TeamNodePanel
        teamId="t1"
        node={reviewer("openai/gpt-4o-mini")}
        edges={REVIEW_EDGES}
        nodes={[reviewer("openai/gpt-4o-mini"), engineer("openai/gpt-4o-mini")]}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    // Save is NOT blocked by the hint (Save is gated only by dirty + non-empty model — it's clean here).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // disabled because not dirty, not because of the hint
    await user.click(screen.getByRole("button", { name: "Dismiss recommendation" }));
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

// ---- F1c Decision 4: the read-only gate / terminal author views (the node-update endpoint
// 409-rejects control primitives, so the drawer SHOWS but never saves — no PATCH may fire) ----

describe("TeamNodePanel — F1c read-only gate / terminal author views (Decision 4)", () => {
  it("a gate opens a READ-ONLY checkpoint drawer: title + description, NO Save, NO node-update PATCH", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({
          id: "n-gate",
          role_name: "prd_gate",
          kind: "gate",
          model: null,
          prompt: null,
          config: {
            gate_kind: "prd_approval",
            title: "Approve the PRD",
            description: "Approve the spec before building.",
          },
        })}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    // The read-only checkpoint copy + the gate's own title/description show…
    expect(screen.getByText(/A checkpoint pauses the run/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Approve the PRD")).toBeInTheDocument();
    expect(screen.getByText("Approve the spec before building.")).toBeInTheDocument();
    // …but there is NO editable surface: no prompt textbox, no Save control.
    expect(screen.queryByRole("textbox", { name: /prompt/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // And no node-update PATCH is ever fired from this view (the drawer only shows the control copy).
    await Promise.resolve();
    expect(patchCall()).toBeUndefined();
  });

  it("a terminal opens a READ-ONLY endpoint drawer: a DISABLED Ship/Stop indicator, NO Save/PATCH", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({
          id: "n-ship",
          role_name: "ship",
          kind: "terminal",
          model: null,
          prompt: null,
          config: { terminal_kind: "ship" },
        })}
        isStartNode={false}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    // Ship is the active endpoint; BOTH buttons are DISABLED (a read-only indicator, not a toggle —
    // persisting ship↔stop is a §15 backend follow-on).
    const ship = screen.getByRole("button", { name: "Ship it" });
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(ship).toBeDisabled();
    expect(stop).toBeDisabled();
    expect(ship).toHaveAttribute("aria-pressed", "true");
    expect(stop).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await Promise.resolve();
    expect(patchCall()).toBeUndefined();
  });
});

describe("TeamNodePanel — F1c model-field focus flash (Decision 3)", () => {
  it("flashes the Model field when the model-chip signal (focusModel) is bumped; a normal open (0) does not", async () => {
    const { container, rerender } = render(
      <TeamNodePanel
        teamId="t1"
        node={engineer("openai/gpt-4o-mini")}
        isStartNode={false}
        focusModel={0}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    // Let the provider fetch settle (avoids an act warning), then: a normal open does NOT flash Model.
    await screen.findByRole("combobox", { name: "Model" });
    expect(container.querySelector(".tv-field--flash")).toBeNull();

    // A model-chip open bumps the nonce → the Model field flashes (the transient highlight class).
    rerender(
      <TeamNodePanel
        teamId="t1"
        node={engineer("openai/gpt-4o-mini")}
        isStartNode={false}
        focusModel={1}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".tv-field--flash")).not.toBeNull();
  });
});

// ---- F-canvas-fidelity-1 Part D: the Model row is INLINE in the drawer body. F1c named it `.tv-picker`,
// which canvas.css ALSO owns for the floating "add a node" popover (position:absolute; z-index:16) — so
// the row detached + floated to the window bottom. The rename to `.tv-modelrow` un-floats it. ----

describe("TeamNodePanel — Model row un-floated, inline in the drawer body (Part D)", () => {
  it("puts the provider select + model input under .tv-modelrow inside the drawer body — never .tv-picker", async () => {
    const { container } = render(
      <TeamNodePanel
        teamId="t1"
        node={engineer("openai/gpt-4o-mini")}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    // Let the on-mount providers fetch settle (avoids an act warning).
    await screen.findByRole("combobox", { name: "Provider" });

    // The row carries the UNIQUE class, NEVER the canvas popover's `.tv-picker` (which would float it).
    const modelRow = container.querySelector(".tv-modelrow");
    expect(modelRow).not.toBeNull();
    expect(container.querySelector(".tv-picker")).toBeNull();

    // The provider <select> AND the model <input> both live inside that row…
    const provider = within(modelRow as HTMLElement).getByRole("combobox", { name: "Provider" });
    const model = within(modelRow as HTMLElement).getByRole("combobox", { name: "Model" });

    // …and the row sits INSIDE the drawer body (the same panel container) — not detached elsewhere.
    const panelBody = container.querySelector(".tv-panel__body");
    expect(panelBody).not.toBeNull();
    expect(panelBody).toContainElement(modelRow as HTMLElement);
    expect(panelBody).toContainElement(provider);
    expect(panelBody).toContainElement(model);
  });
});

describe("TeamNodePanel — M-tools C7.0 tools + skills sections", () => {
  it("renders both a Skills and a Tools section (with editor) for a worker node", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node()} // kind: agent => worker
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    await screen.findByRole("combobox", { name: "Provider" }); // settle the on-mount providers fetch

    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    // The worker's Tools section shows the real (stub) editor, not the worker-only note.
    expect(screen.getByLabelText("Tools JSON")).toBeInTheDocument();
    expect(screen.getByLabelText("Skills JSON")).toBeInTheDocument();
  });

  it("shows the Tools worker-only note (no editor) for a thinker, Skills still present", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ kind: "completion", engine: null })}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    await screen.findByRole("combobox", { name: "Provider" });

    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(/switch this node to Worker to add them/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tools JSON")).toBeNull();
  });
});
