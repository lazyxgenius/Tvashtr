import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../design-system/components";
import { loadDesktopSetup, rememberAfterSetup } from "../../../lib/desktopSetup";
import { installDesktopBridge, ME, stubFetch, uninstallDesktopBridge } from "../desktopTestUtils";
import { TeamStep } from "./TeamStep";

const node = (
  kind: string,
  role: string,
  label: string,
  model: string | null = null,
  runs_on: string | null = null,
) => ({ id: null, kind, role, label, model, runs_on });

const TEMPLATES = {
  templates: [
    {
      template: "review_loop",
      name: "PM → Engineer ⇄ Reviewer",
      description: "Adds a Reviewer that runs the tests and loops back for fixes.",
      shape: {
        nodes: [
          node("thinker", "pm", "PM", "xai/grok-4.7", "grok"),
          node("gate", "gate", "Approval"),
          node("worker", "engineer", "Engineer", "anthropic/claude-sonnet-5", "claude"),
          node("worker", "reviewer", "Reviewer", "deepseek/deepseek-chat", "api_key"),
          node("terminal", "ship", "Ship"),
        ],
        loops: [{ from: 3, to: 2 }],
      },
    },
    {
      template: "spec_only",
      name: "Spec only",
      description: "Turns an idea into a reviewed spec. No code changes.",
      shape: {
        nodes: [
          node("thinker", "pm", "PM", "openrouter/x", null),
          node("worker", "reviewer", "Reviewer", "anthropic/claude-sonnet-5", "claude"),
        ],
        loops: [],
      },
    },
  ],
  blank: {
    template: "blank",
    name: "Blank",
    description: "An empty canvas.",
    shape: { nodes: [node("thinker", "thinker", "Thinker", "xai/grok-4.7", "grok")], loops: [] },
  },
};

type Reply = Parameters<typeof stubFetch>[0][string];

async function renderStep(post: Reply = { body: { team_graph_id: "t-1" } }) {
  const bridge = installDesktopBridge({ setup: { step: "team" } });
  const fetchMock = stubFetch({
    "GET /api/templates": { body: TEMPLATES },
    "POST /api/teams": post,
  });
  await loadDesktopSetup(ME.id);
  render(
    <ToastProvider placement="setup">
      <TeamStep login="lazyxgenius" onSwitch={vi.fn()} />
    </ToastProvider>,
  );
  await screen.findAllByText("Claude plan");
  return { bridge, fetchMock };
}

const radio = (name: RegExp | string) => screen.getByRole("radio", { name });
const createButton = () => screen.getByRole("button", { name: "Create team" });
const posts = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === "POST")
    .map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);

beforeEach(() => {
  window.location.hash = "#/setup/team";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TeamStep — DT-Team, DtF-Run-7", () => {
  it("offers the three cards with Plan, build, review chosen and the honest copy (OQ-11, OQ-12)", async () => {
    const { fetchMock } = await renderStep();
    expect(screen.getByRole("heading", { name: "Start with a team" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick a starting point. You can change every role, prompt and model on the canvas.",
      ),
    ).toBeInTheDocument();
    expect(radio(/Plan, build, review/)).toHaveAttribute("aria-checked", "true");
    expect(within(radio(/Plan, build, review/)).getByText("Recommended")).toBeInTheDocument();
    expect(radio("Spec only")).toHaveAttribute("aria-checked", "false");
    expect(radio("Blank canvas")).toHaveAccessibleDescription(
      "Start with one agent and add your own.",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Team name").value).toBe("My first team");
    expect(fetchMock.mock.calls[0][0] as string).toContain("/api/templates?for=desktop");
  });

  it("draws each strip with the design's names and where each agent runs (DT-35)", async () => {
    await renderStep();
    const plan = within(radio(/Plan, build, review/));
    expect(
      plan.getAllByText(/./, { selector: ".st-tpl-chip__name" }).map((e) => e.textContent),
    ).toEqual(["Product manager", "You approve", "Engineer", "Reviewer", "Ship PR"]);
    expect(
      plan.getAllByText(/./, { selector: ".st-tpl-chip__where" }).map((e) => e.textContent),
    ).toEqual(["Grok plan", "Claude plan", "API key"]);
    const spec = within(radio("Spec only"));
    expect(spec.getByText("Needs setup")).toBeInTheDocument();
    expect(spec.getByText("Claude plan")).toBeInTheDocument();
    // Blank canvas draws no strip, as designed.
    expect(within(radio("Blank canvas")).queryByText("Grok plan")).toBeNull();
  });

  it("Create team makes the team on the plans, finishes setup and goes Home", async () => {
    const { bridge, fetchMock } = await renderStep();
    fireEvent.click(createButton());
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    expect(posts(fetchMock)).toEqual([
      { template: "review_loop", name: "My first team", use_plans: true },
    ]);
    const patch = bridge.setup.update.mock.calls.at(-1)![1];
    expect(patch.step).toBe("team");
    expect(typeof patch.finishedAt).toBe("string");
  });

  it("creates the chosen card with the typed name, and returns to a parked deep link", async () => {
    const { fetchMock } = await renderStep();
    const plan = radio(/Plan, build, review/);
    plan.focus();
    fireEvent.keyDown(plan, { key: "ArrowDown" });
    expect(radio("Spec only")).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Refund feature team" },
    });
    rememberAfterSetup("#/engines");
    fireEvent.click(createButton());
    await waitFor(() => expect(window.location.hash).toBe("#/engines"));
    expect(posts(fetchMock)).toEqual([
      { template: "spec_only", name: "Refund feature team", use_plans: true },
    ]);
  });

  it("a 422 shows the server's words under the name and stays", async () => {
    await renderStep({ status: 422, body: { detail: "A team name is required." } });
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "  " } });
    fireEvent.click(createButton());
    expect(await screen.findByText("A team name is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Team name")).toHaveAttribute("aria-invalid", "true");
    expect(window.location.hash).toBe("#/setup/team");
  });

  it.each<[string, Reply]>([
    ["the server fails", { status: 500, body: { detail: "boom" } }],
    ["nothing answers", "network"],
  ])("when %s: the form error, and setup is not finished", async (_what, reply) => {
    const { bridge } = await renderStep(reply);
    fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't create the team — is the backend running? Try again.",
    );
    expect(bridge.setup.update).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/setup/team");
  });

  it("a failed 'finished' save says so, and trying again never makes a second team", async () => {
    const { bridge, fetchMock } = await renderStep();
    bridge.setup.update.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(createButton());
    expect(
      await screen.findByText("Couldn’t save this Mac’s setup. Try again."),
    ).toBeInTheDocument();
    fireEvent.click(createButton());
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it("without the templates the cards still work (no strips)", async () => {
    installDesktopBridge({ setup: { step: "team" } });
    const fetchMock = stubFetch({
      "GET /api/templates": { status: 500 },
      "POST /api/teams": { body: { team_graph_id: "t" } },
    });
    await loadDesktopSetup(ME.id);
    render(
      <ToastProvider placement="setup">
        <TeamStep login="lazyxgenius" onSwitch={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Grok plan")).toBeNull();
    fireEvent.click(screen.getByText("Blank canvas"));
    fireEvent.click(createButton());
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    expect(posts(fetchMock)[0]).toMatchObject({ template: "blank" });
  });

  it("Back goes to Project", async () => {
    await renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(window.location.hash).toBe("#/setup/project");
  });
});
