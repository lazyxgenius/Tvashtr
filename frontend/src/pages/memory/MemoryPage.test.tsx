import { fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory } from "../../lib/api/memory";
import { __resetBackendStatusForTests, useBackendStatus } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { MEM_MUST_NOT, MEM_SHOULD, NOW, memory, renderAt } from "./memoryTestUtils";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const idOf = (u: URL) => u.pathname.split("/").at(-2) ?? "";

/** A small stateful backend: the Inbox, the counts and the review switch move together. */
function memoryApi(
  opts: { pending?: Memory[]; review?: boolean; routes?: Record<string, unknown> } = {},
) {
  const state = {
    pending: [...(opts.pending ?? [MEM_SHOULD, MEM_MUST_NOT])],
    away: new Map<string, Memory>(),
    active: 14,
    archive: 3,
    review: opts.review ?? true,
  };
  /** Out of the Inbox into Active (Keep) or the Archive (Discard); the other tabs list it there. */
  const take = (id: string, status: "active" | "rejected") => {
    const m = state.pending.find((x) => x.id === id);
    if (!m) return null;
    state.pending = state.pending.filter((x) => x.id !== id);
    state.away.set(id, { ...m, status });
    return m;
  };
  const calls = mockApi({
    "GET /api/memories": (u: URL) => {
      const status = u.searchParams.get("status");
      if (status === "pending_review") return { memories: state.pending };
      return { memories: [...state.away.values()].filter((m) => m.status === status) };
    },
    "GET /api/memories/counts": () => ({
      inbox: state.pending.length,
      active: state.active,
      archive: state.archive,
    }),
    "GET /api/memory/review-mode": () => ({ review_mode: state.review }),
    "PATCH /api/memory/review-mode": (_u: URL, b: unknown) => {
      state.review = (b as { review_mode: boolean }).review_mode;
      return { review_mode: state.review };
    },
    "POST /api/memories/:id/promote": (u: URL) => {
      const m = take(idOf(u), "active");
      if (!m) return jsonError(404, "memory not found");
      state.active += 1;
      return { ...m, status: "active", action: "promote" };
    },
    "POST /api/memories/:id/reject": (u: URL) => {
      const m = take(idOf(u), "rejected");
      if (!m) return jsonError(404, "memory not found");
      state.archive += 1;
      return { ...m, status: "rejected" };
    },
    "POST /api/memories/:id/requeue": (u: URL) => {
      const m = state.away.get(idOf(u));
      if (!m) return jsonError(404, "memory not found");
      state.away.delete(m.id);
      state.pending.push({ ...m, status: "pending_review" });
      return {
        ...m,
        status: "pending_review",
        action: "requeue",
        restored: [],
        unmerged_from: null,
      };
    },
    "PATCH /api/memories/:id": (u: URL, b: unknown) => {
      const id = u.pathname.split("/").pop();
      const i = state.pending.findIndex((x) => x.id === id);
      if (i < 0) return jsonError(404, "memory not found");
      const patch = b as Partial<Memory> & { scope?: string };
      const next = { ...state.pending[i], ...patch, edited_at: new Date(NOW).toISOString() };
      if (patch.scope === "account") Object.assign(next, { tier: "account", repo_key: null });
      state.pending[i] = next;
      return next;
    },
    ...opts.routes,
  });
  return { calls, state };
}

/** The Inbox card once it has loaded (the loading card carries the same name). */
const inbox = async () => {
  const region = () => screen.getByRole("region", { name: "Inbox" });
  await waitFor(() => expect(region()).not.toHaveAttribute("aria-busy"));
  return region();
};
const rowOf = (text: string) => {
  const li = screen.getByText(text).closest("li");
  if (!li) throw new Error(`no row for ${text}`);
  return li;
};
const toastWith = async (text: string) =>
  (await screen.findByText(text)).closest(".ds-toast") as HTMLElement;
const tabs = () => screen.getByRole("tablist", { name: "Memory" });
const badge = () => screen.getByRole("status", { name: "memory badge" });

describe("MemoryPage — shell", () => {
  it("shows the header, the review switch, the tab counts and the Inbox rows", async () => {
    memoryApi();
    renderAt("#/toolkit/memory/inbox");
    expect(screen.getByRole("heading", { level: 1, name: "Memory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add memory" })).toBeTruthy();
    const sw = await screen.findByRole("switch", { name: "Review new memories before they apply" });
    await waitFor(() => expect(sw).toBeChecked());
    expect(
      screen.getByText("On: every new memory waits in the Inbox until you keep it."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(within(tabs()).getByRole("tab", { name: "Inbox 2" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(within(tabs()).getByRole("tab", { name: "Active 14" })).toBeTruthy();
    expect(within(tabs()).getByRole("tab", { name: "Archive" })).toBeTruthy();
    expect(badge().textContent).toBe("2");

    const list = await inbox();
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByText("SHOULD")).toBeTruthy();
    expect(within(first).getByText(MEM_SHOULD.content)).toBeTruthy();
    expect(within(first).getByText("Reviewer · Indicator sprint team")).toBeTruthy();
    expect(
      within(first).getByText("From run “Add an RSI indicator” · round 3 · 31m ago"),
    ).toBeTruthy();
    expect(within(second).getByText("MUST NOT")).toBeTruthy();
    expect(within(second).getByText("lazyxgenius/trade_mcp")).toBeTruthy();
    expect(within(second).getByText("From a failed run · Sep 23 · a caution")).toBeTruthy();
    for (const name of ["Keep", "Edit", "Discard"])
      expect(within(first).getByRole("button", { name })).toBeTruthy();
  });

  it("switches tabs by address and shows the review switch on the Inbox only", async () => {
    memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await inbox();
    fireEvent.click(within(tabs()).getByRole("tab", { name: /Active/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/active"));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Your agents haven’t learned anything yet" }),
    ).toBeTruthy();
  });

  it("says when the Inbox can't load, and tries again", async () => {
    let fail = true;
    memoryApi({
      routes: {
        "GET /api/memories": () =>
          fail ? jsonError(500, "database is down") : { memories: [MEM_SHOULD] },
      },
    });
    renderAt("#/toolkit/memory/inbox");
    const card = await screen.findByRole("region", { name: "Couldn’t load the Inbox" });
    expect(within(card).getByText("database is down")).toBeTruthy();
    fail = false;
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await within(await inbox()).findByText(MEM_SHOULD.content)).toBeTruthy();
  });
});

describe("MemoryPage — the tab it opens on (MEM-4)", () => {
  it("the bare address opens Active when nothing waits in the Inbox", async () => {
    memoryApi({ pending: [] });
    renderAt("#/toolkit/memory");
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/active"));
    expect(within(tabs()).getByRole("tab", { name: "Active 14" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("the bare address opens the Inbox when memories wait there", async () => {
    memoryApi();
    renderAt("#/toolkit/memory");
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/inbox"));
    expect(await within(await inbox()).findByText(MEM_SHOULD.content)).toBeTruthy();
  });

  it("an address that names the Inbox stays on it, empty or not", async () => {
    memoryApi({ pending: [] });
    renderAt("#/toolkit/memory/inbox");
    expect(await screen.findByRole("region", { name: "Inbox is clear" })).toBeTruthy();
    expect(window.location.hash).toBe("#/toolkit/memory/inbox");
  });

  it("opens the Inbox when the counts can't be read", async () => {
    memoryApi({ routes: { "GET /api/memories/counts": () => jsonError(500, "boom") } });
    renderAt("#/toolkit/memory");
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/inbox"));
  });
});

describe("MemoryPage — review switch", () => {
  it("turns off at once, says so, and Undo turns it back on", async () => {
    const { calls, state } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    const sw = await screen.findByRole("switch", { name: "Review new memories before they apply" });
    await waitFor(() => expect(sw).toBeChecked());
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    expect(
      screen.getByText(
        "Off: new memories apply right away. Cautions from failed runs still wait here.",
      ),
    ).toBeTruthy();
    const toast = await toastWith("New memories now apply right away.");
    expect(state.review).toBe(false);
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sw).toBeChecked());
    expect(state.review).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { review_mode: false },
      { review_mode: true },
    ]);
  });

  it("turning it on says new memories wait in the Inbox", async () => {
    memoryApi({ review: false });
    renderAt("#/toolkit/memory/inbox");
    const sw = await screen.findByRole("switch", { name: "Review new memories before they apply" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    expect(await toastWith("New memories now wait in the Inbox.")).toBeTruthy();
    expect(sw).toBeChecked();
  });

  it("rolls back when the save fails", async () => {
    memoryApi({
      routes: { "PATCH /api/memory/review-mode": () => jsonError(500, "nope") },
    });
    renderAt("#/toolkit/memory/inbox");
    const sw = await screen.findByRole("switch", { name: "Review new memories before they apply" });
    await waitFor(() => expect(sw).toBeChecked());
    fireEvent.click(sw);
    expect(await toastWith("Couldn’t change the review setting. Try again.")).toBeTruthy();
    expect(sw).toBeChecked();
    expect(
      screen.getByText("On: every new memory waits in the Inbox until you keep it."),
    ).toBeTruthy();
  });
});

describe("MemoryPage — Keep and Discard", () => {
  it("Keep takes the row out, updates the counts, and Undo puts it back", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    const list = await inbox();
    await within(list).findByText(MEM_SHOULD.content);
    fireEvent.click(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" }));
    const toast = await toastWith("Kept. Reviewer uses it from the next run.");
    expect(screen.queryByText(MEM_SHOULD.content)).toBeNull();
    await waitFor(() => expect(within(tabs()).getByRole("tab", { name: "Inbox 1" })).toBeTruthy());
    expect(within(tabs()).getByRole("tab", { name: "Active 15" })).toBeTruthy();
    expect(badge().textContent).toBe("1");

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(MEM_SHOULD.content)).toBeTruthy();
    expect(calls.at(-2)).toMatchObject({
      method: "POST",
      path: "/api/memories/m-should/requeue",
    });
    await waitFor(() => expect(within(tabs()).getByRole("tab", { name: "Inbox 2" })).toBeTruthy());
    // Back in its place: newest first.
    const items = within(await inbox()).getAllByRole("listitem");
    expect(within(items[0]).getByText(MEM_SHOULD.content)).toBeTruthy();
  });

  it("a merged Keep says so, and Undo requeues the memory that was merged", async () => {
    const { calls } = memoryApi({
      routes: {
        "POST /api/memories/:id/promote": {
          ...memory({ id: "m-old", status: "active" }),
          action: "promote_merged",
          merged_id: "m-should",
        },
        "POST /api/memories/:id/requeue": {
          ...MEM_SHOULD,
          action: "requeue",
          restored: [],
          unmerged_from: "m-old",
        },
      },
    });
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_SHOULD.content);
    fireEvent.click(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" }));
    const toast = await toastWith("Already known. Confirmed the existing memory.");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(MEM_SHOULD.content)).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/memories/m-should/requeue")).toBe(true);
  });

  it("a repo memory's Keep doesn't name one agent", async () => {
    memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_MUST_NOT.content);
    fireEvent.click(within(rowOf(MEM_MUST_NOT.content)).getByRole("button", { name: "Keep" }));
    expect(await toastWith("Kept. Agents use it from the next run.")).toBeTruthy();
  });

  it("Discard sends it to Archive, and Undo returns it to the Inbox", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_MUST_NOT.content);
    fireEvent.click(within(rowOf(MEM_MUST_NOT.content)).getByRole("button", { name: "Discard" }));
    const toast = await toastWith("Discarded. You’ll find it in Archive.");
    expect(screen.queryByText(MEM_MUST_NOT.content)).toBeNull();
    expect(calls.some((c) => c.path === "/api/memories/m-mustnot/reject")).toBe(true);
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(MEM_MUST_NOT.content)).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/memories/m-mustnot/requeue")).toBe(true);
  });

  it("an empty Inbox is clear, the badge goes, and See Active opens Active", async () => {
    memoryApi({ pending: [MEM_MUST_NOT] });
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_MUST_NOT.content);
    fireEvent.click(within(rowOf(MEM_MUST_NOT.content)).getByRole("button", { name: "Discard" }));
    const empty = await screen.findByRole("region", { name: "Inbox is clear" });
    expect(
      within(empty).getByText(
        "New memories from your runs show up here for you to keep or discard.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(badge().textContent).toBe("0"));
    fireEvent.click(within(empty).getByRole("button", { name: "See Active" }));
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/active"));
  });

  it("a memory someone else already handled reloads the Inbox", async () => {
    memoryApi({
      routes: { "POST /api/memories/:id/promote": () => jsonError(404, "memory not found") },
    });
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_SHOULD.content);
    fireEvent.click(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" }));
    expect(await toastWith("That memory is no longer in the Inbox.")).toBeTruthy();
  });
});

describe("MemoryPage — Undo after switching tabs", () => {
  /** A tab's card once it has loaded (the loading card carries the same name). */
  const card = async (name: string) => {
    const region = () => screen.getByRole("region", { name });
    await waitFor(() => expect(region()).not.toHaveAttribute("aria-busy"));
    return region();
  };

  it("Undo Keep from the Active tab takes the memory back out of Active", async () => {
    memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_SHOULD.content);
    fireEvent.click(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" }));
    const toast = await toastWith("Kept. Reviewer uses it from the next run.");
    fireEvent.click(within(tabs()).getByRole("tab", { name: /^Active/ }));
    expect(await within(await card("Active")).findByText(MEM_SHOULD.content)).toBeTruthy();

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText(MEM_SHOULD.content)).toBeNull());
    await waitFor(() => expect(within(tabs()).getByRole("tab", { name: "Inbox 2" })).toBeTruthy());
  });

  it("Undo Discard from the Archive tab takes the memory out of the Archive", async () => {
    memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await within(await inbox()).findByText(MEM_MUST_NOT.content);
    fireEvent.click(within(rowOf(MEM_MUST_NOT.content)).getByRole("button", { name: "Discard" }));
    const toast = await toastWith("Discarded. You’ll find it in Archive.");
    fireEvent.click(within(tabs()).getByRole("tab", { name: /^Archive/ }));
    const archive = await card("Archive");
    expect(within(archive).getByText(MEM_MUST_NOT.content)).toBeTruthy();
    expect(within(archive).getByRole("button", { name: "Restore" })).toBeTruthy();

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText(MEM_MUST_NOT.content)).toBeNull());
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});

describe("MemoryPage — inline editor", () => {
  const openEditor = async (text: string) => {
    await within(await inbox()).findByText(text);
    fireEvent.click(within(rowOf(text)).getByRole("button", { name: "Edit" }));
    return screen.getByRole("textbox", { name: "Memory text" });
  };

  it("edits text and force in place; the memory stays in the Inbox", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    const box = await openEditor(MEM_MUST_NOT.content);
    expect(box).toHaveValue(MEM_MUST_NOT.content);
    expect(box).toHaveAttribute("rows", "3");
    expect(document.activeElement).toBe(box);
    const force = screen.getByRole("combobox", { name: "Force" });
    const scope = screen.getByRole("combobox", { name: "Scope" });
    expect(force).toHaveValue("forbid");
    expect(scope).toHaveValue("repo");
    expect(
      within(scope)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Account", "Repo", "Agent"]);

    fireEvent.change(box, { target: { value: "Never edit web/generated/ by hand." } });
    fireEvent.change(force, { target: { value: "avoid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await toastWith("Saved.")).toBeTruthy();
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toMatchObject({
      path: "/api/memories/m-mustnot",
      body: { content: "Never edit web/generated/ by hand.", polarity: "avoid" },
    });
    const row = rowOf("Never edit web/generated/ by hand.");
    expect(within(row).getByText("SHOULD NOT")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Memory text" })).toBeNull();
  });

  it("changes the scope", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await openEditor(MEM_MUST_NOT.content);
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), {
      target: { value: "account" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await toastWith("Saved.");
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ scope: "account" });
    expect(within(rowOf(MEM_MUST_NOT.content)).getByText("Account · all repos")).toBeTruthy();
  });

  it("can't save blank text; Cancel leaves the memory as it was", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    const box = await openEditor(MEM_SHOULD.content);
    fireEvent.change(box, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("Save with nothing changed just closes", async () => {
    const { calls } = memoryApi();
    renderAt("#/toolkit/memory/inbox");
    await openEditor(MEM_SHOULD.content);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(within(rowOf(MEM_SHOULD.content)).getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("keeps the editor open with the backend's reason when a save fails", async () => {
    memoryApi({
      routes: {
        "PATCH /api/memories/:id": () => jsonError(422, "This memory has no agent to scope to."),
      },
    });
    renderAt("#/toolkit/memory/inbox");
    await openEditor(MEM_MUST_NOT.content);
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), {
      target: { value: "agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This memory has no agent to scope to.",
    );
    expect(screen.getByRole("textbox", { name: "Memory text" })).toBeTruthy();
  });

  it("an edit the embedding service can't take says so, without calling the app offline", async () => {
    memoryApi({
      routes: { "PATCH /api/memories/:id": () => jsonError(502, "the embedding call failed") },
    });
    renderAt("#/toolkit/memory/inbox");
    const status = renderHook(() => useBackendStatus());
    const box = await openEditor(MEM_MUST_NOT.content);
    fireEvent.change(box, { target: { value: "Never edit web/generated/ by hand." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The embedding service didn’t answer, so the edit wasn’t saved. Try again.",
    );
    expect(box).toHaveValue("Never edit web/generated/ by hand.");
    expect(status.result.current.state).toBe("connected");
  });
});
