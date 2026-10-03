import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { SpecApproveDrawer } from "./SpecApproveDrawer";

// M11 (Cnv-EditApprove): at a spec approval gate, the spec in the steering editor (P1.7) with
// Reject / Approve as is / Approve with my edits. One click saves the edit as the next spec
// version and approves: one POST to the gate's resolve route with `edited_spec`.

const SPEC = "# Add an RSI indicator\n\n- Default length: 20\n- Values stay between 0 and 100";
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let resolveStatus: number;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  resolveStatus = 200;
  fetchMock = vi.fn<Fetch>((url) => {
    if (url === "/api/documents/doc-1")
      return reply({
        id: "doc-1",
        name: "spec",
        title: "Shared spec",
        doc_type: "prd",
        run_id: "run-1",
        is_shared_spec: true,
        editable: true,
        versions: [
          { id: "v1", version_no: 1, content: "# Old", created_at: "2026-10-03T10:00:00Z" },
          { id: "v2", version_no: 2, content: SPEC, created_at: "2026-10-03T10:41:00Z" },
        ],
      });
    if (url === "/api/runs/run-1/tasks/7/resolve")
      return resolveStatus === 200
        ? reply({ run_id: "run-1", task_id: 7, decision: "approve", resolution: "approved" })
        : reply({ detail: "This gate has no spec to edit." }, resolveStatus);
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const props = {
    onReject: vi.fn(),
    onApprove: vi.fn(),
    onApproved: vi.fn(),
    onVersions: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <SpecApproveDrawer runId="run-1" taskId={7} docId="doc-1" nextAgent="Engineer" {...props} />,
  );
  return props;
}
const drawer = () => within(screen.getByRole("complementary", { name: "Spec v2" }));
const edit = (markdown: string) => {
  const pm = document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
  act(() => {
    pm.editor.commands.setContent(markdown);
  });
};

describe("SpecApproveDrawer — M11 editing", () => {
  it("tells the page while there is an edit (the Now bar says you are editing)", async () => {
    const onEditing = vi.fn();
    render(
      <SpecApproveDrawer
        runId="run-1"
        taskId={7}
        docId="doc-1"
        nextAgent="Engineer"
        onReject={vi.fn()}
        onApprove={vi.fn()}
        onApproved={vi.fn()}
        onVersions={vi.fn()}
        onClose={vi.fn()}
        onEditing={onEditing}
      />,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    edit(SPEC.replace("Default length: 20", "Default length: 14, the usual default"));
    await waitFor(() => expect(onEditing).toHaveBeenLastCalledWith(true));
    edit(SPEC);
    await waitFor(() => expect(onEditing).toHaveBeenLastCalledWith(false));
  });
});

describe("SpecApproveDrawer — M11 Approve with my edits", () => {
  it("the spec v2 in the editor, what an edit becomes, and the three choices", async () => {
    setup();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    const d = drawer();
    expect(
      d.getByText("Your edits become spec v3. The Engineer starts from it."),
    ).toBeInTheDocument();
    expect(document.querySelector(".ProseMirror")).toHaveTextContent("Default length: 20");
    expect(d.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(d.getByRole("button", { name: "Approve as is" })).toBeEnabled();
    // Nothing edited yet: nothing to approve with.
    expect(d.getByRole("button", { name: "Approve with my edits" })).toBeDisabled();
    expect(d.queryByText(/\d+ edits?$/)).toBeNull();
  });

  it("Reject, Approve as is, Spec versions and Close reuse the run's own actions", async () => {
    const p = setup();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    fireEvent.click(drawer().getByRole("button", { name: "Reject" }));
    expect(p.onReject).toHaveBeenCalledOnce();
    fireEvent.click(drawer().getByRole("button", { name: "Approve as is" }));
    expect(p.onApprove).toHaveBeenCalledOnce();
    fireEvent.click(drawer().getByRole("button", { name: "Spec versions" }));
    expect(p.onVersions).toHaveBeenCalledOnce();
    fireEvent.click(drawer().getByRole("button", { name: "Close" }));
    expect(p.onClose).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith("/resolve"))).toBe(false);
  });

  it("an edit counts as 1 edit; one click posts approve with the edited spec", async () => {
    const p = setup();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    edit(SPEC.replace("Default length: 20", "Default length: 14, the usual default"));
    expect(drawer().getByText("1 edit")).toBeInTheDocument();
    fireEvent.click(drawer().getByRole("button", { name: "Approve with my edits" }));
    await waitFor(() => expect(p.onApproved).toHaveBeenCalledOnce());
    const post = fetchMock.mock.calls.find(([u]) => u === "/api/runs/run-1/tasks/7/resolve");
    expect(post?.[1]?.method).toBe("POST");
    const body = JSON.parse(post?.[1]?.body as string) as { decision: string; edited_spec: string };
    expect(body.decision).toBe("approve");
    expect(body.edited_spec).toContain("Default length: 14, the usual default");
    expect(body.edited_spec).toContain("# Add an RSI indicator");
  });

  it("a refusal keeps the drawer and the edit, in the server's words", async () => {
    resolveStatus = 422;
    const p = setup();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    edit(`${SPEC}\n- Draw it on charts`);
    fireEvent.click(drawer().getByRole("button", { name: "Approve with my edits" }));
    expect(await drawer().findByText("This gate has no spec to edit.")).toBeInTheDocument();
    expect(p.onApproved).not.toHaveBeenCalled();
    expect(document.querySelector(".ProseMirror")).toHaveTextContent("Draw it on charts");
  });
});
