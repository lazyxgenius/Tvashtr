import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../../lib/api";
import { GateBody } from "./GateBody";

// Moved from the old TeamNodePanel tests with the gate body (M-rails C8/C9): the gate's own
// editable body — type picker, parameters, title/description — and its dirty-aware Save, which
// PATCHes only gate fields. Stubs `fetch` so the real client's URL/method/body contract is proven.

function gateNode(): TeamGraphNode {
  return {
    id: "n-gate",
    role_name: "prd_gate",
    kind: "gate",
    model: null,
    engine: null,
    prompt: null,
    position: { x: 0, y: 0 },
    config: {
      gate_kind: "prd_approval",
      title: "Approve the PRD",
      description: "Approve the spec before building.",
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const patchCall = () =>
  fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH") as
    | [string, RequestInit]
    | undefined;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(gateNode()) }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const renderGate = (onSaved = vi.fn().mockResolvedValue(undefined)) =>
  render(<GateBody teamId="team-1" node={gateNode()} onSaved={onSaved} />);

describe("GateBody", () => {
  it("edits the gate type and PATCHes only the gate config", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    renderGate(onSaved);

    const title = screen.getByRole<HTMLInputElement>("textbox", { name: "Gate title" });
    expect(title.value).toBe("Approve the PRD");
    expect(screen.getByRole("button", { name: "Human approval" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Secret leak scan" }));
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);

    await waitFor(() => expect(patchCall()).toBeDefined());
    const [url, init] = patchCall()!;
    expect(url).toBe("/api/teams/team-1/nodes/n-gate");
    expect(JSON.parse(init.body as string)).toEqual({
      gate_kind: "secret_leak_scan",
      title: "Approve the PRD",
      description: "Approve the spec before building.",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps the original human gate_kind when only the title changes", async () => {
    const user = userEvent.setup();
    renderGate();
    const title = screen.getByRole("textbox", { name: "Gate title" });
    await user.clear(title);
    await user.type(title, "Approve before building");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    expect(JSON.parse(patchCall()![1].body as string)).toEqual({
      gate_kind: "prd_approval",
      title: "Approve before building",
      description: "Approve the spec before building.",
    });
  });

  it("Forbidden paths: a globs textarea whose lines PATCH as forbidden_paths", async () => {
    const user = userEvent.setup();
    renderGate();
    expect(screen.queryByRole("textbox", { name: "Forbidden paths" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Forbidden paths" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Forbidden paths" }), {
      target: { value: ".github/**\ninfra/**\n" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    expect(JSON.parse(patchCall()![1].body as string)).toMatchObject({
      gate_kind: "diff_touches_forbidden_paths",
      forbidden_paths: [".github/**", "infra/**"],
    });
  });

  it("Output schema: output file + JSON schema PATCH as output_schema config", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.click(screen.getByRole("button", { name: "Output schema" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Output file" }), {
      target: { value: "result.json" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "JSON schema" }), {
      target: { value: '{"type":"object","required":["ok"]}' },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchCall()).toBeDefined());
    expect(JSON.parse(patchCall()![1].body as string)).toMatchObject({
      gate_kind: "output_schema_check",
      output_file: "result.json",
      output_schema: { type: "object", required: ["ok"] },
    });
  });
});
