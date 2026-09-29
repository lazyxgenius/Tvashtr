import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { useSaveShortcut } from "../saveShortcut";
import { useUnsavedGuard } from "../useUnsavedGuard";
import { DocumentViewer } from "./DocumentViewer";
import type { DocPlace } from "./docView";

// The document viewer (Docs-Viewer, Docs-Compare, Docs-EditLive; DOCS-18..36).

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const agent = (node_id: string, role_name: string, label: string) => ({
  kind: "agent",
  node_id,
  role_name,
  label,
});
const PM = agent("n-pm", "pm", "Product manager");
const YOU = { kind: "human", node_id: null, role_name: null, label: "You" };
const ref = (node_id: string, label: string) => ({
  node_id,
  clone_node_id: `c-${node_id}`,
  role_name: node_id,
  label,
});

const V2 = [
  "# Add an RSI indicator",
  "",
  "## Acceptance",
  "",
  "- `TestRegistry` lists 29 indicators, including `rsi`.",
  "- `TestRegistry` lists 28 indicators.",
].join("\n");
const V3 = V2.replace(
  "- `TestRegistry` lists 28 indicators.",
  "- `web/lib/engine-facts.ts` sets `indicator_count` to 29.\n- A unit test checks RSI against a known series.",
);
const version = (n: number, content: string, author: unknown, note: string, min: number) => ({
  id: `v${n}`,
  version_no: n,
  content,
  created_at: ago(min),
  author,
  note,
});
const spec = (editable: boolean) => ({
  id: "d-spec",
  name: "spec",
  title: "PRD",
  doc_type: "prd",
  run_id: "r-rsi",
  is_shared_spec: true,
  editable,
  versions: [
    version(1, "# Add an RSI indicator", PM, "First draft", 52),
    version(2, V2, YOU, "Edited while the run was live", 40),
    version(3, V3, PM, "Revised in round 3", 31),
    ...newer,
  ],
});
const NOTES = {
  id: "d-notes",
  name: "build-notes",
  run_id: "r-rsi",
  is_shared_spec: false,
  editable: true,
  versions: [
    version(1, "Ran pytest: 12 passed", agent("n-eng", "engineer", "Engineer"), "Round 1", 36),
  ],
};
const RUN_DOCS = {
  run: { run_id: "r-rsi", idea: "Add an RSI indicator", status: "running", created_at: ago(60) },
  documents: [
    {
      id: "d-spec",
      name: "spec",
      is_shared_spec: true,
      latest_version: { version_no: 3, created_at: ago(31), author: PM, note: null },
      written_by: [ref("n-pm", "Product manager")],
      read_by: [ref("n-pm", "Product manager"), ref("n-eng", "Engineer"), ref("n-rev", "Reviewer")],
    },
    {
      id: "d-notes",
      name: "build-notes",
      latest_version: { version_no: 1, created_at: ago(36), author: PM, note: null },
      written_by: [ref("n-eng", "Engineer")],
      read_by: [ref("n-rev", "Reviewer")],
    },
  ],
};

let editable: boolean;
// The versions an agent saved meanwhile (a stale save's reload sees them).
let newer: unknown[];
let saveAnswer: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;
const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  editable = true;
  newer = [];
  saveAnswer = {
    status: 200,
    body: { ...version(4, "x", YOU, "Edited while the run was live", 0) },
  };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/documents/d-spec/versions" && init?.method === "POST")
      return answer(saveAnswer.body, saveAnswer.status);
    if (url === "/api/documents/d-spec") return answer(spec(editable));
    if (url === "/api/documents/d-notes") return answer(NOTES);
    if (url === "/api/runs/r-rsi/documents") return answer(RUN_DOCS);
    return answer({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Viewer({
  initial = {},
  onClose = () => undefined,
}: {
  initial?: DocPlace & { docId?: string };
  onClose?: () => void;
}) {
  const [at, setAt] = useState({ docId: initial.docId ?? "d-spec", place: initial });
  return (
    <ToastProvider>
      <DocumentViewer
        docId={at.docId}
        place={{ version: at.place.version, compare: at.place.compare }}
        runs={[
          {
            run_id: "r-rsi",
            idea: "Add an RSI indicator",
            status: "running",
            created_at: ago(60),
            updated_at: ago(31),
          },
        ]}
        onPlace={(docId, place) => setAt({ docId, place })}
        onClose={onClose}
      />
    </ToastProvider>
  );
}

const dialog = () => screen.getByRole("dialog", { name: /Shared spec|build-notes/ });
const versions = () => within(screen.getByRole("complementary", { name: "Versions" }));
const rail = () => within(screen.getByRole("complementary", { name: "This run’s documents" }));
const ready = () => screen.findByRole("heading", { name: "Add an RSI indicator" });
const setEditor = (markdown: string) => {
  const pm = document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
  act(() => {
    pm.editor.commands.setContent(markdown);
  });
};

describe("DocumentViewer — reading", () => {
  it("shows the spec with the run's documents, its versions and who uses it", async () => {
    render(<Viewer />);
    await ready();
    const d = within(dialog());
    expect(d.getByText("The PRD for this run · everyone reads it")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "v3 · latest" })).toBeInTheDocument();
    expect(d.getByText("TestRegistry", { selector: "code" })).toBeInTheDocument();
    expect(
      await rail().findByRole("button", { name: /build-notes\s*Engineer · v1/ }),
    ).toBeVisible();
    expect(rail().getByText("Run “Add an RSI indicator” · 31m ago")).toBeInTheDocument();
    const rows = versions().getAllByRole("button", { name: /^v\d/ });
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(["v3", "v2", "v1"]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(within(rows[1]).getByText("You")).toBeInTheDocument();
    expect(within(rows[1]).getByText("You · Edited while the run was live")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Product manager · First draft")).toBeInTheDocument();
    // Who uses it: the writer, then the readers who don't write it (OQ-12).
    expect(await versions().findByText("Engineer")).toBeInTheDocument();
    expect(versions().getByText("Reviewer")).toBeInTheDocument();
    expect(
      versions().getByText("Every agent reads the shared spec unless its Reads says otherwise."),
    ).toBeInTheDocument();
  });

  it("a version row shows that version; Edit is only on the latest", async () => {
    render(<Viewer />);
    await ready();
    expect(within(dialog()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(versions().getByRole("button", { name: /^v2/ }));
    expect(within(dialog()).getByRole("button", { name: "v2" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText("lists 28 indicators.", { exact: false })).toBeInTheDocument();
  });

  it("a rail row switches documents; a named document has no Edit", async () => {
    render(<Viewer />);
    await ready();
    fireEvent.click(await rail().findByRole("button", { name: /build-notes/ }));
    expect(await screen.findByText("Ran pytest: 12 passed")).toBeInTheDocument();
    const d = within(screen.getByRole("dialog", { name: "build-notes" }));
    expect(d.getByText("Written by Engineer · read by Reviewer")).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(versions().getByRole("button", { name: "Compare" })).toBeDisabled();
  });

  it("no Edit once the run has finished (OQ-8)", async () => {
    editable = false;
    render(<Viewer />);
    await ready();
    expect(within(dialog()).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("Copy as Markdown copies the shown version and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Viewer />);
    await ready();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Copy as Markdown" }));
    expect(writeText).toHaveBeenCalledWith(V3);
    expect(await screen.findByText("Copied as Markdown")).toBeInTheDocument();
  });
});

describe("DocumentViewer — compare (DOCS-33..36)", () => {
  it("compares the shown version with the one before it, inline", async () => {
    render(<Viewer />);
    await ready();
    fireEvent.click(versions().getByRole("button", { name: "Compare" }));
    expect(versions().getByRole("button", { name: "Compare" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Comparing v2 (You) → v3 (Product manager)+2 lines−1 line",
    );
    expect(screen.getByRole("group", { name: "Removed" })).toHaveTextContent(
      "TestRegistry lists 28 indicators.",
    );
    expect(screen.getAllByRole("group", { name: "Added" })).toHaveLength(2);
    // Compare hides Edit (DOCS-26).
    expect(within(dialog()).queryByRole("button", { name: "Edit" })).toBeNull();
    // Another version becomes the "from".
    fireEvent.click(versions().getByRole("button", { name: /^v1/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Comparing v1 (Product manager) → v3");
    fireEvent.click(versions().getByRole("button", { name: "Compare" }));
    expect(screen.queryByRole("group", { name: "Added" })).toBeNull();
  });
});

describe("DocumentViewer — live edit (DOCS-26..32)", () => {
  const startEditing = async () => {
    await ready();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
  };

  it("edits the spec and saves it as the next version, naming its base", async () => {
    render(<Viewer />);
    await startEditing();
    const d = within(dialog());
    expect(
      d.getByText("Save and agents pick up your edit at their next step.", { exact: false }),
    ).toBeInTheDocument();
    expect(d.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
    expect(d.getByText("No changes yet · saves as v4")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Save as v4" })).toBeDisabled();

    setEditor(`${V3}\n- Show the RSI line under the price chart.`);
    expect(d.getByText("Unsaved edit · saves as v4")).toBeInTheDocument();
    fireEvent.click(d.getByRole("button", { name: "Save as v4" }));
    expect(
      await screen.findByText("Saved v4 — the agents read it on their next round."),
    ).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((post?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.base_version_no).toBe(3);
    expect(body.content).toContain("- Show the RSI line under the price chart.");
    // Back to reading.
    expect(d.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
  });

  it("an agent's newer version: the server's sentence, plainly, with Compare", async () => {
    saveAnswer = {
      status: 409,
      body: {
        detail: {
          code: "stale_version",
          message: "Product manager saved v4 while you were editing. Compare, then save again.",
          latest_version_no: 4,
          latest_author: PM,
        },
      },
    };
    render(<Viewer />);
    await startEditing();
    setEditor(`${V3}\n- More.`);
    newer = [version(4, `${V3}\n- Agent's line.`, PM, "Revised in round 4", 1)];
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save as v4" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Product manager saved v4 while you were editing. Compare, then save again.",
    );
    // Compare shows the version the edit started on against the newest, and keeps the edit.
    fireEvent.click(within(alert).getByRole("button", { name: "Compare" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByText("Comparing", { exact: false })).toHaveTextContent(
      "Comparing v3 (Product manager) → v4 (Product manager)+1 line−0 lines",
    );
    fireEvent.click(within(dialog()).getByRole("button", { name: "Back to your edit" }));
    const d = within(dialog());
    expect(await d.findByText("Unsaved edit · saves as v5")).toBeInTheDocument();
    // Save again: the edit is still there, now based on v4.
    saveAnswer = { status: 200, body: version(5, "x", YOU, "Edited while the run was live", 0) };
    fireEvent.click(d.getByRole("button", { name: "Save as v5" }));
    expect(
      await screen.findByText("Saved v5 — the agents read it on their next round."),
    ).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((posts.at(-1)?.[1] as RequestInit).body as string) as {
      base_version_no: number;
      content: string;
    };
    expect(body.base_version_no).toBe(4);
    expect(body.content).toContain("- More.");
  });

  it("⌘S saves the edit, never the agent drawer underneath", async () => {
    const agentSave = vi.fn();
    function AgentDrawer() {
      useSaveShortcut(agentSave);
      return null;
    }
    render(
      <>
        <AgentDrawer />
        <Viewer />
      </>,
    );
    await ready();
    // Reading: ⌘S is the viewer's (nothing to save), not the agent's.
    fireEvent.keyDown(dialog(), { key: "s", metaKey: true });
    expect(agentSave).not.toHaveBeenCalled();
    await startEditing();
    setEditor(`${V3}\n- Saved with the keyboard.`);
    fireEvent.keyDown(document.querySelector(".ProseMirror")!, { key: "s", metaKey: true });
    expect(
      await screen.findByText("Saved v4 — the agents read it on their next round."),
    ).toBeInTheDocument();
    expect(agentSave).not.toHaveBeenCalled();
  });

  it("browser Back while the edit is unsaved asks first, and keeps the address", async () => {
    const here = "#/teams/t1/docs/d-spec";
    window.history.replaceState(null, "", here);
    const app = vi.fn();
    window.addEventListener("hashchange", app);
    try {
      render(<Viewer />);
      await startEditing();
      setEditor(`${V3}\n- More.`);
      // Back: the address leaves the document.
      window.history.replaceState(null, "", "#/teams/t1");
      act(() => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(app).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(here);
      const confirm = screen.getByRole("alertdialog", {
        name: "Discard your edit to the Shared spec?",
      });
      fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
      expect(within(dialog()).getByText("Unsaved edit · saves as v4")).toBeInTheDocument();

      window.history.replaceState(null, "", "#/teams/t1");
      act(() => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      fireEvent.click(screen.getByRole("button", { name: "Discard edit" }));
      expect(window.location.hash).toBe("#/teams/t1");
      expect(app).toHaveBeenCalled();
    } finally {
      window.removeEventListener("hashchange", app);
      window.history.replaceState(null, "", "#");
    }
  });

  it("an ended edit leaves Tvashtr Desktop's quit guard to a dirty agent underneath", async () => {
    const setUnsavedChanges = vi.fn();
    window.tvashtrDesktop = {
      app: { setUnsavedChanges },
    } as unknown as typeof window.tvashtrDesktop;
    function DirtyAgent() {
      useUnsavedGuard({ dirty: true, agentName: "Reviewer" });
      return null;
    }
    try {
      render(
        <>
          <DirtyAgent />
          <Viewer />
        </>,
      );
      await startEditing();
      setEditor(`${V3}\n- More.`);
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({
        dirty: true,
        agentName: "Shared spec",
      });
      fireEvent.click(within(dialog()).getByRole("button", { name: "Discard" }));
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: true, agentName: "Reviewer" });
    } finally {
      delete (window as { tvashtrDesktop?: unknown }).tvashtrDesktop;
    }
  });

  it("the run ended meanwhile: says so, and Save stays off", async () => {
    saveAnswer = {
      status: 409,
      body: {
        detail: {
          code: "run_finished",
          message: "This run has finished — edits can’t reach its agents.",
        },
      },
    };
    render(<Viewer />);
    await startEditing();
    setEditor(`${V3}\n- More.`);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save as v4" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This run has finished — edits can’t reach its agents.",
    );
    expect(within(dialog()).getByRole("button", { name: "Save as v4" })).toBeDisabled();
    // The editor no longer says the run is live.
    expect(within(dialog()).queryByText("The run is live.", { exact: false })).toBeNull();
    expect(
      within(dialog()).queryByText("Save and agents pick up your edit", { exact: false }),
    ).toBeNull();
  });

  it("the run ends while you edit: the editor says so before you save, and Save is off", async () => {
    render(<Viewer />);
    await startEditing();
    setEditor(`${V3}\n- More.`);
    expect(within(dialog()).getByText("The run is live.", { exact: false })).toBeInTheDocument();
    editable = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This run has finished — edits can’t reach its agents.",
    );
    expect(within(dialog()).queryByText("The run is live.", { exact: false })).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Save as v4" })).toBeDisabled();
    expect(within(dialog()).getByText("Unsaved edit · saves as v4")).toBeInTheDocument();
  });

  it("leaving an unsaved edit asks first, and tells Tvashtr Desktop", async () => {
    const setUnsavedChanges = vi.fn();
    window.tvashtrDesktop = {
      app: { setUnsavedChanges },
    } as unknown as typeof window.tvashtrDesktop;
    const onClose = vi.fn();
    try {
      render(<Viewer onClose={onClose} />);
      await startEditing();
      setEditor(`${V3}\n- More.`);
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: true, agentName: "Shared spec" });
      fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
      const confirm = screen.getByRole("alertdialog", {
        name: "Discard your edit to the Shared spec?",
      });
      fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
      expect(onClose).not.toHaveBeenCalled();
      expect(within(dialog()).getByText("Unsaved edit · saves as v4")).toBeInTheDocument();

      // Switching documents asks too.
      fireEvent.click(rail().getByRole("button", { name: /build-notes/ }));
      fireEvent.click(screen.getByRole("button", { name: "Discard edit" }));
      expect(await screen.findByText("Ran pytest: 12 passed")).toBeInTheDocument();
      expect(setUnsavedChanges).toHaveBeenLastCalledWith({ dirty: false });
    } finally {
      delete (window as { tvashtrDesktop?: unknown }).tvashtrDesktop;
    }
  });

  it("Discard leaves the edit without asking", async () => {
    render(<Viewer />);
    await startEditing();
    setEditor(`${V3}\n- More.`);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});

describe("DocumentViewer — a live run moves on under it", () => {
  const V4 = version(4, `${V3}\n- Agent's line.`, PM, "Revised in round 4", 1);
  const rows = () =>
    versions()
      .getAllByRole("button", { name: /^v\d/ })
      .map((r) => r.textContent?.slice(0, 2));
  afterEach(() => vi.useRealTimers());

  it("an agent's newer version shows up on its own, every few seconds and when you come back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    render(<Viewer />);
    await ready();
    newer = [V4];
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(await within(dialog()).findByRole("button", { name: "v4 · latest" })).toBeVisible();
    expect(rows()).toEqual(["v4", "v3", "v2", "v1"]);

    // Back on the window after the run ended: no more Edit.
    editable = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(within(dialog()).queryByRole("button", { name: "Edit" })).toBeNull(),
    );
  });

  it("Edit starts on the real latest version, even one saved since the viewer last looked", async () => {
    render(<Viewer />);
    await ready();
    newer = [V4];
    fireEvent.click(within(dialog()).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    expect(document.querySelector(".ProseMirror")).toHaveTextContent("Agent's line.");
    const d = within(dialog());
    expect(d.getByText("No changes yet · saves as v5")).toBeInTheDocument();
    setEditor(`${V3}\n- Agent's line.\n- Mine.`);
    saveAnswer = { status: 200, body: version(5, "x", YOU, "Edited while the run was live", 0) };
    fireEvent.click(d.getByRole("button", { name: "Save as v5" }));
    await screen.findByText("Saved v5 — the agents read it on their next round.");
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toMatchObject({
      base_version_no: 4,
    });
  });

  it("a look while you edit keeps your edit as it is", async () => {
    render(<Viewer />);
    await ready();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    setEditor(`${V3}\n- Mine.`);
    newer = [V4];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(rows()).toEqual(["v4", "v3", "v2", "v1"]));
    expect(document.querySelector(".ProseMirror")).toHaveTextContent("Mine.");
    expect(document.querySelector(".ProseMirror")).not.toHaveTextContent("Agent's line.");
    expect(within(dialog()).getByText("Unsaved edit", { exact: false })).toBeInTheDocument();
  });
});
