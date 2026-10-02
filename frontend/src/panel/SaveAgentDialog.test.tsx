import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SavedAgent } from "../lib/api/myAgents";
import { jsonError, mockApi } from "../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { SaveAgentDialog, type SaveAgentDialogProps } from "./SaveAgentDialog";

// M6 Agents-Save: "Save Reviewer as my agent" (580px, 56px from the top) — name, what it's for,
// the included parts (memories off by default), "Never included…", "Saved as version N".

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const strict: SavedAgent = {
  id: "a1",
  name: "Strict reviewer",
  purpose: "Reviews Python changes against the spec.",
  latest: 1,
  updated_at: "2026-10-01T10:00:00Z",
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [],
  used_in: [],
  behind: [],
};

function renderDialog(over: Partial<SaveAgentDialogProps> = {}) {
  const props: SaveAgentDialogProps = {
    teamId: "t1",
    nodeId: "n-rev",
    agentName: "Reviewer",
    defaultName: "Reviewer",
    defaultPurpose: "Checks against the spec",
    teamVersion: 7,
    model: "xai/grok-4.7",
    editsAllowed: false,
    skills: 2,
    tools: 1,
    memories: 3,
    agents: [],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  render(<SaveAgentDialog {...props} />);
  return { props, dialog: screen.getByRole("dialog", { name: "Save Reviewer as my agent" }) };
}

const box = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("checkbox", { name: new RegExp(`^${name}`) });

describe("SaveAgentDialog (Agents-Save)", () => {
  it("draws the board: fields, included parts, never included, the version note", () => {
    const { dialog } = renderDialog();
    expect(dialog).toHaveClass("lv-confirm", "cv-vdlg--save");
    expect(
      within(dialog).getByText(
        "Use it in any team. Teams keep the version they use until you update them.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Reviewer");
    expect(within(dialog).getByLabelText("What it’s for")).toHaveValue("Checks against the spec");
    expect(within(dialog).getByText("Included")).toBeInTheDocument();
    expect(box(dialog, "Instructions")).toBeChecked();
    expect(within(dialog).getByText("The current text (v7)")).toBeInTheDocument();
    expect(box(dialog, "Model: xai/grok-4.7")).toBeChecked();
    expect(within(dialog).getByText("Teams without Grok can pick another model")).toBeVisible();
    expect(box(dialog, "Skills \\(2\\) and tools \\(1\\)")).toBeChecked();
    expect(box(dialog, "File access: read-only")).toBeChecked();
    expect(box(dialog, "Memories \\(3\\)")).not.toBeChecked();
    expect(
      within(dialog).getByText("Usually about this team’s repo. Leave off to start fresh."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Never included: sign-ins, keys and secrets."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Saved as version 1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save to My agents" })).toBeEnabled();
  });

  it("hides skills and tools and memories when there are none; an editing agent says so", () => {
    const { dialog } = renderDialog({ skills: 0, tools: 0, memories: 0, editsAllowed: true });
    expect(within(dialog).queryByRole("checkbox", { name: /^Skills/ })).toBeNull();
    expect(within(dialog).queryByRole("checkbox", { name: /^Memories/ })).toBeNull();
    expect(box(dialog, "File access: can edit files")).toBeChecked();
  });

  it("names the next version when the typed name is an agent the account has", () => {
    const { dialog } = renderDialog({ agents: [strict] });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "strict Reviewer" },
    });
    expect(within(dialog).getByText("Saved as version 2")).toBeInTheDocument();
  });

  it("saves the checked parts and hands back the result", async () => {
    const calls = mockApi({ "POST /api/my-agents": { agent: strict, version: 1, created: true } });
    const { dialog, props } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "  Strict reviewer " },
    });
    fireEvent.click(box(dialog, "Memories \\(3\\)"));
    fireEvent.click(box(dialog, "Model: xai/grok-4.7"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save to My agents" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/my-agents",
      body: {
        team_id: "t1",
        node_id: "n-rev",
        name: "Strict reviewer",
        purpose: "Checks against the spec",
        include: ["instructions", "skills_tools", "file_access", "memories"],
      },
    });
    expect(props.onSaved).toHaveBeenCalledWith({ agent: strict, version: 1, created: true });
  });

  it("no Save without a name or with nothing included; the server's words on a failure", async () => {
    mockApi({ "POST /api/my-agents": jsonError(422, "Include at least one part of the agent.") });
    const { dialog, props } = renderDialog({ skills: 0, tools: 0, memories: 0 });
    const save = within(dialog).getByRole("button", { name: "Save to My agents" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  " } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Strict" } });
    for (const name of ["Instructions", "Model", "File access"]) fireEvent.click(box(dialog, name));
    expect(save).toBeDisabled();
    fireEvent.click(box(dialog, "Instructions"));
    fireEvent.click(save);
    expect(
      await within(dialog).findByText("Include at least one part of the agent."),
    ).toBeVisible();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("Cancel and the close button close it", () => {
    const { dialog, props } = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
