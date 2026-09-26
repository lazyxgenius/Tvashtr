import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import {
  bodyOf,
  CATALOGUE,
  edges,
  engineer,
  json,
  pm,
  reviewer,
  ship,
  stubFetch,
} from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Memory tab (G10; Web-Memory, Panel-MemoryEmpty, Flow-Memory-1..4): the Remember switch saves
// alone, Keep / Discard with Undo (requeue), notes by repo with Pin / Edit / Delete.

type Row = Record<string, unknown>;
const note = (id: string, content: string, extra: Row = {}): Row => ({
  id,
  content,
  polarity: "require",
  repo_key: "lazyxgenius/trade_mcp",
  repo_label: "lazyxgenius/trade_mcp",
  node_id: "n-rev",
  tier: "node",
  pinned: false,
  status: "active",
  created_at: "2026-09-22T12:00:00Z",
  source: { kind: "run", round: 2 },
  ...extra,
});

let rows: Row[];
let fetchMock: ReturnType<typeof vi.fn>;
let failList = false;

const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(
    (c) =>
      ((c[1] as RequestInit | undefined)?.method ?? "GET") === method &&
      String(c[0]).includes(part),
  );

beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  failList = false;
  rows = [
    note("m-new", "Check web/lib/engine-facts.ts whenever the list changes.", {
      status: "pending_review",
    }),
    note("m-1", "Tests live under tests/.", { pinned: true }),
    note("m-2", "Approve only when both lists match.", {
      source: { kind: "run", round: 3 },
      created_at: "2026-09-24T12:00:00Z",
    }),
    note("m-3", "Prefer small diffs.", {
      repo_key: null,
      repo_label: null,
      source: { kind: "manual" },
    }),
  ];
  const find = (url: string) => rows.find((r) => url.includes(`/api/memories/${r.id as string}`));
  fetchMock = stubFetch(
    () => reviewer(),
    (url, init) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/memories?")) {
        if (failList) return json({ detail: "boom" }, 500);
        const q = new URLSearchParams(url.split("?")[1]);
        return json({ memories: rows.filter((r) => r.status === q.get("status")) });
      }
      const row = find(url);
      if (!row) return undefined;
      const act = (status: string, extra: Row = {}) => {
        Object.assign(row, { status }, extra);
        return json(row);
      };
      if (url.endsWith("/promote")) return act("active", { action: "promote" });
      if (url.endsWith("/reject")) return act("rejected");
      if (url.endsWith("/requeue")) return act("pending_review", { action: "requeue" });
      if (url.endsWith("/pin")) return act("active", { pinned: true });
      if (url.endsWith("/unpin")) return act("active", { pinned: false });
      if (method === "PATCH") {
        Object.assign(row, JSON.parse(init?.body as string) as Row);
        return json(row);
      }
      if (method === "DELETE") {
        rows = rows.filter((r) => r !== row);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return undefined;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderTab(saved: TeamGraphNode = reviewer(), over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: saved,
    nodes: [pm, engineer, saved, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "memory",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onOpenToolkit: vi.fn(),
    ...over,
  };
  render(<NodeEditor {...props} />);
  return { props, drawer: screen.getByRole("complementary", { name: "Reviewer settings" }) };
}

const region = (name: RegExp) => within(screen.getByRole("region", { name }));
const toast = () => document.querySelector(".nd-toast-host") as HTMLElement;
const noteRow = (text: string) => screen.getByText(text).closest("li") as HTMLElement;

describe("Memory tab — notes (Web-Memory)", () => {
  it("lists the waiting note, then this agent's notes by repo, with where each came from", async () => {
    const { drawer } = renderTab();
    const review = await screen.findByRole("region", { name: "Waiting for your review · 1" });
    expect(within(review).getByRole("button", { name: "Keep" })).toBeInTheDocument();
    const repo = region(/^lazyxgenius\/trade_mcp · 2$/);
    expect(repo.getByText("Learned in round 2 · Sep 22")).toBeInTheDocument();
    expect(repo.getByText("Learned in round 3 · Sep 24")).toBeInTheDocument();
    expect(
      within(noteRow("Tests live under tests/.")).getByRole("button", { name: "Pin" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(region(/^Not repo-specific · 1$/).getByText("Added by you · Sep 22")).toBeVisible();
    expect(within(drawer).getByRole("tab", { name: /^Memory\s*4$/ })).toBeInTheDocument();
    expect(within(drawer).getByText("Memory changes save right away")).toBeInTheDocument();
  });

  it("Keep promotes the note; Undo sends it back for review", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    await waitFor(() => expect(calls("POST", "/m-new/promote")).toHaveLength(1));
    expect(await within(toast()).findByText("Kept. It applies to future runs.")).toBeVisible();
    expect(await screen.findByText(/lazyxgenius\/trade_mcp · 3/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Waiting for your review/ })).toBeNull();

    fireEvent.click(within(toast()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls("POST", "/m-new/requeue")).toHaveLength(1));
    expect(
      await screen.findByRole("region", { name: "Waiting for your review · 1" }),
    ).toBeInTheDocument();
  });

  it("Discard rejects the note; Undo sends it back for review", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(calls("POST", "/m-new/reject")).toHaveLength(1));
    expect(await within(toast()).findByText("Discarded")).toBeVisible();
    fireEvent.click(within(toast()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls("POST", "/m-new/requeue")).toHaveLength(1));
  });

  it("Pin toggles the note's pin", async () => {
    renderTab();
    await screen.findByText("Tests live under tests/.");
    fireEvent.click(
      within(noteRow("Tests live under tests/.")).getByRole("button", { name: "Pin" }),
    );
    await waitFor(() => expect(calls("POST", "/m-1/unpin")).toHaveLength(1));
    fireEvent.click(
      within(noteRow("Approve only when both lists match.")).getByRole("button", { name: "Pin" }),
    );
    await waitFor(() => expect(calls("POST", "/m-2/pin")).toHaveLength(1));
  });

  it("edits a note inline: blank is refused, Save note sends the text and the force", async () => {
    renderTab();
    await screen.findByText("Tests live under tests/.");
    fireEvent.click(
      within(noteRow("Tests live under tests/.")).getByRole("button", { name: "Edit" }),
    );
    const text = screen.getByRole("textbox", { name: "Note" });
    expect(screen.getByRole("combobox", { name: "Force" })).toHaveValue("require");
    fireEvent.change(text, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.change(text, { target: { value: "Tests live in tests/." } });
    fireEvent.change(screen.getByRole("combobox", { name: "Force" }), {
      target: { value: "forbid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH", "/api/memories/m-1")).toEqual({
        content: "Tests live in tests/.",
        polarity: "forbid",
      }),
    );
    expect(await screen.findByText("Tests live in tests/.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
  });

  it("Delete asks first, then deletes the note (Flow-Memory-4)", async () => {
    renderTab();
    await screen.findByText("Prefer small diffs.");
    fireEvent.click(within(noteRow("Prefer small diffs.")).getByRole("button", { name: "Delete" }));
    const ask = screen.getByRole("alertdialog", { name: "Delete this note?" });
    expect(ask).toHaveTextContent("Reviewer won’t be reminded of it again. You can’t undo this.");
    fireEvent.click(within(ask).getByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(calls("DELETE", "/api/memories/m-3")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Prefer small diffs.")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Open Memory shelf goes to Toolkit › Memory (the Inbox while notes wait)", async () => {
    const { props } = renderTab();
    await screen.findByRole("region", { name: /Waiting for your review/ });
    const link = screen.getByRole("link", { name: "Open Memory shelf" });
    expect(link).toHaveAttribute("href", "#/toolkit/memory/inbox");
    fireEvent.click(link);
    expect(props.onOpenToolkit).toHaveBeenCalledWith({ page: "memory", tab: "inbox" });
  });
});

describe("Memory tab — states (Panel-MemoryEmpty)", () => {
  it("says there are no notes yet, and the tab shows no count", async () => {
    rows = [];
    const { drawer } = renderTab();
    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
    expect(within(drawer).getByRole("tab", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Memory shelf" })).toHaveAttribute(
      "href",
      "#/toolkit/memory/active",
    );
  });

  it("shows loading, then a failed load with Retry", async () => {
    failList = true;
    renderTab();
    expect(screen.getByRole("status", { name: "Loading notes" })).toBeInTheDocument();
    expect(await screen.findByText("Couldn’t load notes.")).toBeInTheDocument();
    failList = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Tests live under tests/.")).toBeInTheDocument();
  });
});

describe("Memory tab — Remember what it learns (PANEL-63)", () => {
  it("is off and locked for a read-only agent; File access opens Setup", async () => {
    const { props } = renderTab();
    const remember = screen.getByRole("switch", { name: "Remember what it learns" });
    expect(remember).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "File access" }));
    expect(props.onTabChange).toHaveBeenCalledWith("setup");
    await screen.findByText("Tests live under tests/.");
  });

  it("saves the switch alone, right away, for an agent that can edit files", async () => {
    const { props, drawer } = renderTab(reviewer({ edits_allowed: true }));
    const remember = screen.getByRole("switch", { name: "Remember what it learns" });
    expect(remember).not.toBeDisabled();
    fireEvent.click(remember);
    await waitFor(() =>
      expect(bodyOf(fetchMock, "PATCH", "/api/teams/t1/nodes/n-rev")).toEqual({
        memory_remember_enabled: true,
      }),
    );
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(remember).toBeChecked();
    expect(within(drawer).getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("the entry agent stays read-only, so there's no File access link", () => {
    renderTab(reviewer(), { isEntry: true });
    expect(screen.getByRole("switch", { name: "Remember what it learns" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "File access" })).toBeNull();
  });
});
