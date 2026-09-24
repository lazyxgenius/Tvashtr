import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../lib/api";
import { TeamNodePanel } from "./TeamNodePanel";

// P1.8b/P1.8c → M-unify U3: the team-authoring editor — the Edits toggle (Edits allowed / Not allowed,
// driving `edits_allowed`, replacing Thinker/Worker) + prompt + model fields, dirty-aware Save (no
// autosave), and the node-update PATCH. Stubs `fetch` (so updateTeamNode is exercised end-to-end
// through the real client) rather than mocking the helper, so the URL/method/body contract is proven.

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
    if (url === "/api/engines/subscriptions" && method === "GET") {
      return Promise.resolve(jsonOk({ subscriptions: [] }));
    }
    // ToolsSection mounts with the agent editor and GETs these; empty lists keep it quiet.
    if (url === "/api/secrets" && method === "GET") {
      return Promise.resolve(jsonOk({ secrets: [] }));
    }
    if (url === "/api/tool-library" && method === "GET") {
      return Promise.resolve(jsonOk({ tools: [] }));
    }
    if (url === "/api/tool-catalog" && method === "GET") {
      return Promise.resolve(jsonOk({ tools: [] }));
    }
    if (url === "/api/skill-library" && method === "GET") {
      return Promise.resolve(jsonOk({ skills: [] }));
    }
    if (url === "/api/skill-presets" && method === "GET") {
      return Promise.resolve(jsonOk({ skills: [] }));
    }
    return Promise.resolve(jsonOk(node({ prompt: "edited" })));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
  delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
});

describe("TeamNodePanel — edit prompt + model + edits toggle, dirty-aware Save", () => {
  it("shows prompt + model + edits toggle, gates Save on dirty, and PATCHes the node-update endpoint", async () => {
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

    // The agent node seeds the toggle to Edits allowed (edits_allowed defaults on for a worker).
    expect(screen.getByRole("button", { name: "Edits allowed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
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
    // edits_allowed — the panel posts the full values (the FE is dirty-aware but sends all of them).
    // M-unify U3: it drives `edits_allowed` (the source of truth), NOT `capability` (no longer sent).
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [calledUrl, init] = patchCall()!;
    expect(urlOf(calledUrl)).toBe("/api/teams/team-1/nodes/n-eng");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Write greeting.txt = SENTINEL",
      model: "openai/gpt-4o-mini",
      edits_allowed: true,
      // M-memory: the remember toggle is always sent too (config: null ⇒ seeded false).
      memory_remember_enabled: false,
      // M-tools C7.A (S2): updateTeamNode now always sends tool_config/skills (null when unset).
      tool_config: null,
      skills: null,
      // M-docs: writes_to/reads_from are always sent too (config: null ⇒ seeded "" / []).
      writes_to: "",
      reads_from: [],
    });
    // …and the parent was asked to refetch the team (which clears dirty + shows the saved note).
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("flipping the Edits toggle ALONE (no prompt/model edit) enables Save and PATCHes edits_allowed", async () => {
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

    // Flip Edits allowed -> Not allowed without touching prompt/model.
    await user.click(screen.getByRole("button", { name: "Not allowed" }));
    expect(screen.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Original engineer prompt",
      model: "openai/gpt-4o-mini",
      edits_allowed: false,
      // M-memory: the remember toggle is always sent too (config: null ⇒ seeded false).
      memory_remember_enabled: false,
      // M-tools C7.A (S2): updateTeamNode now always sends tool_config/skills (null when unset).
      tool_config: null,
      skills: null,
      // M-docs: writes_to/reads_from are always sent too (config: null ⇒ seeded "" / []).
      writes_to: "",
      reads_from: [],
    });
  });

  it("locks the Edits toggle OFF for the start node (it writes the shared spec, edits-off)", async () => {
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

    const notAllowed = screen.getByRole("button", { name: "Not allowed" });
    const editsAllowed = screen.getByRole("button", { name: "Edits allowed" });
    // The entry node is edits-off (it writes the shared spec), and the toggle is locked there.
    expect(notAllowed).toHaveAttribute("aria-pressed", "true");
    expect(notAllowed).toBeDisabled();
    expect(editsAllowed).toBeDisabled();

    // Clicking the locked "Edits allowed" does nothing — it stays edits-off, Save stays disabled.
    await user.click(editsAllowed);
    expect(notAllowed).toHaveAttribute("aria-pressed", "true");
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

    // Switching the provider rewrites node.model's leading segment to that provider's default FOR
    // THIS NODE'S SEAT (M-seat). The node under test is an engineer — a worker — so this is
    // nvidia's probed worker default, not whatever slug the provider happens to lead with.
    await user.selectOptions(provider, "nvidia_nim");
    const model = screen.getByRole<HTMLInputElement>("combobox", { name: "Model" });
    expect(model.value).toBe("nvidia_nim/minimaxai/minimax-m3");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const saved = JSON.parse(patchCall()![1].body as string) as { model: string };
    expect(saved.model).toBe("nvidia_nim/minimaxai/minimax-m3");
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

// ---- M-rails C8 (re-point): the gate author view is now EDITABLE (Gate type picker + title/desc +
// a Save that PATCHes gate config); the terminal view stays read-only. ----

function gateNode() {
  return node({
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
  });
}

describe("TeamNodePanel — M-rails C8 editable gate + read-only terminal author views", () => {
  it("a gate opens an EDITABLE drawer: Gate type picker + title/description + a dirty-aware Save that PATCHes gate config", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={gateNode()}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    // The gate's copy is shown + EDITABLE (a title input + a description textarea).
    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "Gate title" });
    expect(title.value).toBe("Approve the PRD");
    expect(screen.getByRole("textbox", { name: "Gate description" })).toBeInTheDocument();

    // prd_approval is a human kind → "Human approval" is the initial type; Save is disabled (clean).
    expect(screen.getByRole("button", { name: "Human approval" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Secret leak scan" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(patchCall()).toBeUndefined();

    // Flip to the guardrail → dirty → Save → PATCHes gate config (gate_kind=secret_leak_scan), and
    // the body carries ONLY gate fields (no prompt/model — this is the gate-update fn, not updateTeamNode).
    await user.click(screen.getByRole("button", { name: "Secret leak scan" }));
    expect(screen.getByRole("button", { name: "Secret leak scan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);

    await waitFor(() => expect(patchCall()).toBeDefined());
    const [calledUrl, init] = patchCall()!;
    expect(urlOf(calledUrl)).toBe("/api/teams/team-1/nodes/n-gate");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      gate_kind: "secret_leak_scan",
      title: "Approve the PRD",
      description: "Approve the spec before building.",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("editing the title while staying 'Human approval' PRESERVES the original human gate_kind (prd_approval)", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="team-1"
        node={gateNode()}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    const title = screen.getByRole("textbox", { name: "Gate title" });
    await user.clear(title);
    await user.type(title, "Approve before building");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCall()).toBeDefined());
    // Still human → the original sub-kind survives (NOT flattened to gate_approval), title updated.
    expect(JSON.parse(patchCall()![1].body as string)).toEqual({
      gate_kind: "prd_approval",
      title: "Approve before building",
      description: "Approve the spec before building.",
    });
  });

  it("selecting 'Forbidden paths' reveals a globs textarea and Save PATCHes forbidden_paths config", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="team-1"
        node={gateNode()}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    // The globs field is HIDDEN until the diff_touches_forbidden_paths kind is picked.
    expect(screen.queryByRole("textbox", { name: "Forbidden paths" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Forbidden paths" }));
    const box = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Forbidden paths" });
    // One glob per line; a trailing blank line is trimmed away on Save.
    fireEvent.change(box, { target: { value: ".github/**\ninfra/**\n" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCall()).toBeDefined());
    expect(urlOf(patchCall()![0])).toBe("/api/teams/team-1/nodes/n-gate");
    expect(JSON.parse(patchCall()![1].body as string)).toEqual({
      gate_kind: "diff_touches_forbidden_paths",
      title: "Approve the PRD",
      description: "Approve the spec before building.",
      forbidden_paths: [".github/**", "infra/**"],
    });
  });

  it("selecting 'Output schema' reveals output-file + JSON-schema inputs and Save PATCHes output_schema config", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="team-1"
        node={gateNode()}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "Output file" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Output schema" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Output file" }), {
      target: { value: "result.json" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "JSON schema" }), {
      target: { value: '{"type":"object","required":["ok"]}' },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchCall()).toBeDefined());
    expect(JSON.parse(patchCall()![1].body as string)).toEqual({
      gate_kind: "output_schema_check",
      title: "Approve the PRD",
      description: "Approve the spec before building.",
      output_file: "result.json",
      output_schema: { type: "object", required: ["ok"] },
    });
  });

  it("a terminal opens an EDITABLE endpoint drawer: live Ship/Stop, dirty Save, no readonly note", async () => {
    // M-endpoint-editable: the Ship/Stop control is LIVE (not disabled); flipping enables Save and
    // PATCHes terminal_kind; the apologetic "delete and re-drop" note is gone.
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
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
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    const ship = screen.getByRole("button", { name: "Ship it" });
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(ship).toBeEnabled();
    expect(stop).toBeEnabled();
    expect(ship).toHaveAttribute("aria-pressed", "true");
    expect(stop).toHaveAttribute("aria-pressed", "false");
    // No apologetic readonly note about deleting and re-dropping.
    expect(screen.queryByText(/planned backend follow-on/i)).toBeNull();
    expect(screen.queryByText(/delete this endpoint/i)).toBeNull();

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // clean until an edit

    await user.click(stop);
    expect(stop).toHaveAttribute("aria-pressed", "true");
    expect(ship).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body as string)).toEqual({ terminal_kind: "stop" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
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
    // C7.B re-point: the real Skills editor replaced the C7.0 JSON textarea — assert one of its
    // real controls instead of the removed "Skills JSON" label (the DOM legitimately changed).
    expect(screen.getByLabelText("Skill name")).toBeInTheDocument();
  });

  it("renders the Tools editor for a completion/edits-off node too (tools on every node — M-unify U3)", async () => {
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
    // U3: a completion/edits-off node shows the SAME real Tools editor — the worker-only note is gone.
    expect(screen.getByLabelText("Tools JSON")).toBeInTheDocument();
    expect(screen.queryByText(/switch this node to Worker/i)).toBeNull();
  });

  it("clears the Unsaved changes banner after a successful ToolsSection save (Domains MCP)", async () => {
    // Regression: dirty compared draft toolConfig to live node.tool_config via JSON.stringify.
    // After Save the parent refetch can lag (or JSONB key order can differ), so the banner stuck
    // even though the PATCH succeeded. Baselines must reset on successful Save.
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
    await screen.findByRole("combobox", { name: "Provider" });

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Enable Domains MCP"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const body = JSON.parse(patchCall()![1].body as string) as Record<string, unknown>;
    expect(body.tool_config).toEqual({ tvashtr: { domains: true } });

    // Banner clears even though the `node` prop was NOT updated (parent refetch not simulated) —
    // proving the save-path baseline reset, not prop-equality, owns the clear.
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Saved — this drives the next run/i)).toBeInTheDocument();
    expect(save).toBeDisabled();

    // Intentional dirty detection still works after the baseline reset.
    await user.click(screen.getByLabelText("Enable Domains MCP")); // on → off
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });
});

describe("TeamNodePanel — Remember what I learn toggle (edits-on agent only)", () => {
  it("renders on an edits-on agent node (seeded from config) and hides when Edits flips off", async () => {
    const user = userEvent.setup();
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ config: { memory_remember_enabled: true } })}
        isStartNode={false}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={() => {}}
      />,
    );
    // Seeded ON from the node's config JSONB.
    expect(await screen.findByRole("button", { name: "Remember" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Flipping Edits -> Not allowed hides the remember sub-option (backend gate is `and edits_allowed`).
    await user.click(screen.getByRole("button", { name: "Not allowed" }));
    expect(screen.queryByRole("button", { name: "Remember" })).toBeNull();
  });

  it("is absent on a gate node", () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ kind: "gate", config: { gate_kind: "gate_approval" } })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Remember" })).toBeNull();
  });

  it("is absent on a terminal node", () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ kind: "terminal", config: { terminal_kind: "ship" } })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Remember" })).toBeNull();
  });

  it("flipping Remember alone enables Save and PATCHes memory_remember_enabled: true", async () => {
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
    // node() has config: null ⇒ Remember seeded OFF; flipping it ON marks the drawer dirty.
    await user.click(await screen.findByRole("button", { name: "Remember" }));
    expect(screen.getByRole("button", { name: "Remember" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(patchCall()).toBeDefined());
    const [, init] = patchCall()!;
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "Original engineer prompt",
      model: "openai/gpt-4o-mini",
      edits_allowed: true,
      memory_remember_enabled: true,
      tool_config: null,
      skills: null,
      writes_to: "",
      reads_from: [],
    });
  });
});

describe("TeamNodePanel — writes_to / reads_from document routing (M-docs)", () => {
  it("seeds the routing fields from config and Save PATCHes the edited routing", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ config: { writes_to: "design", reads_from: ["spec", "design"] } })}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    // Seeded from the node's config JSONB: the text input + the newline-joined list.
    const writesTo = screen.getByRole<HTMLInputElement>("textbox", { name: /writes to/i });
    const readsFrom = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /reads from/i });
    expect(writesTo.value).toBe("design");
    expect(readsFrom.value).toBe("spec\ndesign");

    // Editing writes_to enables Save; the PATCH carries the edited value + the seeded reads_from.
    fireEvent.change(writesTo, { target: { value: "blueprint" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(patchCall()).toBeDefined());
    const body = JSON.parse(patchCall()![1].body as string) as Record<string, unknown>;
    expect(body.writes_to).toBe("blueprint");
    expect(body.reads_from).toEqual(["spec", "design"]);
  });
});

// ---- Per-node capabilities (Session A): the three new drawer fields + the edit-time model hint ----

describe("TeamNodePanel — per-node capability fields", () => {
  it("renders a Fallback model field seeded from config and PATCHes it on Save", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ config: { fallback_model: "openai/gpt-4o-mini" } })}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    const fallback = screen.getByRole<HTMLInputElement>("combobox", { name: "Fallback model" });
    expect(fallback.value).toBe("openai/gpt-4o-mini");

    // Editing it alone enables Save (it is an authorable field like prompt/model).
    fireEvent.change(fallback, { target: { value: "gemini/gemini-2.0-flash" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(patchCall()).toBeDefined());
    const body = JSON.parse(patchCall()![1].body as string) as Record<string, unknown>;
    expect(body.fallback_model).toBe("gemini/gemini-2.0-flash");
  });

  it("renders an Expected output JSON field + a Multimodal toggle, and PATCHes both", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ kind: "completion", engine: null })}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    const schema = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /expected output/i });
    expect(schema.value).toBe("");
    fireEvent.change(schema, { target: { value: '{"type":"object"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Multimodal" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const body = JSON.parse(patchCall()![1].body as string) as Record<string, unknown>;
    expect(body.output_schema).toEqual({ type: "object" });
    expect(body.multimodal).toBe(true);
  });

  it("a node with none of the three set sends a PATCH with none of the three keys", async () => {
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
    // Dirty ONLY the prompt — the capability fields stay untouched/empty.
    fireEvent.change(screen.getByRole("textbox", { name: /prompt/i }), {
      target: { value: "edited prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    const body = JSON.parse(patchCall()![1].body as string) as Record<string, unknown>;
    expect("fallback_model" in body).toBe(false);
    expect("output_schema" in body).toBe(false);
    expect("multimodal" in body).toBe(false);
  });

  it("refuses to save an Expected output that is not valid JSON", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node()}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /expected output/i }), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/valid JSON/i)).toBeInTheDocument());
    expect(patchCall()).toBeUndefined(); // nothing was PATCHed
  });
});

describe("TeamNodePanel — edit-time model validation hint (soft, never blocks Save)", () => {
  it("is ABSENT for a recognised preset on a configured provider, IN THIS NODE'S SEAT", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        // `node()` is an agent — a WORKER — and openai's probed worker model is gpt-4.1-mini.
        node={node({ model: "openai/gpt-4.1-mini" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    // The providers fetch resolves openai + nvidia_nim; gpt-4.1-mini is a served WORKER preset.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("model-validity-hint")).not.toBeInTheDocument();
  });

  it("IS PRESENT when a worker node carries a slug proven only for the thinker seat", async () => {
    // M-seat's user-facing half. `openai/gpt-4o-mini` passed the THINKER gates and was never
    // proven able to drive the agent loop, so on a worker node it is exactly the hand-picked
    // failure the seat split exists to prevent. The hint stays SOFT — Save is never blocked and
    // the field stays free text — but the user is told before the run instead of 30s into it.
    // This assertion is the reason the test above had to change rather than be deleted: the old
    // expectation ("gpt-4o-mini on an engineer is fine") IS the defect.
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "openai/gpt-4o-mini" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument(),
    );
    expect(await screen.findByTestId("model-validity-hint")).toBeInTheDocument();
  });

  it("is ABSENT for deepseek/deepseek-chat once the catalogue is served (M-runnable)", async () => {
    providersState.push({ provider: "deepseek", key_last4: "3333", created_at: "x" });
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "deepseek/deepseek-chat" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument(),
    );
    // deepseek is configured AND deepseek/deepseek-chat is a served-catalogue preset (setup.ts seeds
    // it), so the "isn't a known deepseek model" false-positive is gone — it fired pre-M-runnable when
    // presetsForProvider("deepseek") was [] on the product's OWN default agent model.
    expect(screen.queryByTestId("model-validity-hint")).not.toBeInTheDocument();
  });

  it("RENDERS when the slug's provider is not one the account has configured", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "anthropic/claude-3-5-sonnet" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    const hint = await screen.findByTestId("model-validity-hint");
    expect(hint).toHaveTextContent(/anthropic/i);
  });

  it("RENDERS when the provider IS configured but the slug is not a known preset", async () => {
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "openai/gpt-9-turbo-typo" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByTestId("model-validity-hint")).toBeInTheDocument();
  });

  it("is dismissible, and Save still fires while it is showing", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "anthropic/claude-3-5-sonnet" })}
        isStartNode={false}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("model-validity-hint");

    // Save is NEVER disabled by the hint: dirty the prompt and it saves with the hint showing.
    fireEvent.change(screen.getByRole("textbox", { name: /prompt/i }), {
      target: { value: "edited" },
    });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(patchCall()).toBeDefined());

    // And it can be dismissed.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss model warning" }));
    await waitFor(() =>
      expect(screen.queryByTestId("model-validity-hint")).not.toBeInTheDocument(),
    );
  });
});

describe("TeamNodePanel — prefer-subscription treatment pills", () => {
  it("shows 'via your Claude subscription · runs on this computer' on Desktop + Claude connected", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    window.tvashtrDesktop = {
      engines: {
        getStatus: async () => [
          {
            provider: "claude",
            connected: true,
            state: "connected",
            account_hint: "a@b.c",
            source: "harness",
            checked_at: "x",
          },
        ],
        connect: async () => ({}) as never,
        disconnect: async () => ({}) as never,
        refresh: async () => ({}) as never,
      },
    };
    providersState = [];
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "anthropic/claude-3-5-sonnet", kind: "agent" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(
      await screen.findByText("via your Claude subscription · runs on this computer"),
    ).toBeInTheDocument();
  });

  it("shows via API key when BYOK configured without prefer-sub local win", async () => {
    delete document.documentElement.dataset.tvashtrDesktop;
    delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
    providersState = [{ provider: "anthropic", key_last4: "1234", created_at: "x" }];
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node({ model: "anthropic/claude-3-5-sonnet", kind: "agent" })}
        isStartNode={false}
        onSaved={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/via API key/i)).toBeInTheDocument();
  });
});
