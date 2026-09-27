import { fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory } from "../../lib/api/memory";
import { __resetBackendStatusForTests, useBackendStatus } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import {
  ACTIVE,
  ACT_CONTEXT,
  ACT_MAY,
  ACT_MUST,
  ACT_SHOULD,
  NOW,
  renderAt,
} from "./memoryTestUtils";

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

const REPOS = [
  {
    repo_key: "lazyxgenius/cryptoground-mcp",
    label: "lazyxgenius/cryptoground-mcp",
    memory_count: 0,
    pending_count: 0,
    last_run_at: "2026-09-24T12:00:00Z",
  },
  {
    repo_key: "lazyxgenius/trade_mcp",
    label: "lazyxgenius/trade_mcp",
    memory_count: 1,
    pending_count: 2,
    last_run_at: "2026-09-25T09:00:00Z",
  },
];

const idAt = (u: URL, fromEnd: number) => u.pathname.split("/").at(fromEnd) ?? "";

/** Active memories that pin, edit and delete like the backend; the counts follow the rows. */
function activeApi(opts: { rows?: Memory[]; routes?: Record<string, unknown> } = {}) {
  const state = { rows: [...(opts.rows ?? ACTIVE)] };
  const find = (id: string) => state.rows.find((r) => r.id === id);
  const put = (m: Memory) => {
    state.rows = state.rows.map((r) => (r.id === m.id ? m : r));
    return m;
  };
  const calls = mockApi({
    "GET /api/memories": (u: URL) => ({
      memories: u.searchParams.get("status") === "active" ? state.rows : [],
    }),
    "GET /api/memories/counts": () => ({ inbox: 2, active: state.rows.length, archive: 3 }),
    "GET /api/memory/repos": { repos: REPOS },
    "POST /api/memories/:id/pin": (u: URL) => {
      const m = find(idAt(u, -2));
      return m ? put({ ...m, pinned: true }) : jsonError(404, "memory not found");
    },
    "POST /api/memories/:id/unpin": (u: URL) => {
      const m = find(idAt(u, -2));
      return m ? put({ ...m, pinned: false }) : jsonError(404, "memory not found");
    },
    "PATCH /api/memories/:id": (u: URL, b: unknown) => {
      const m = find(idAt(u, -1));
      if (!m) return jsonError(404, "memory not found");
      return put({ ...m, ...(b as Partial<Memory>), edited_at: new Date(NOW).toISOString() });
    },
    "DELETE /api/memories/:id": (u: URL) => {
      const m = find(idAt(u, -1));
      if (!m) return jsonError(404, "memory not found");
      state.rows = state.rows.filter((r) => r.id !== m.id);
      return new Response(null, { status: 204 });
    },
    ...opts.routes,
  });
  return { calls, state };
}

/** The Active card once it has loaded (the loading card carries the same name). */
const activeCard = async () => {
  const region = () => screen.getByRole("region", { name: "Active" });
  await waitFor(() => expect(region()).not.toHaveAttribute("aria-busy"));
  return region();
};
const rowTexts = (card: HTMLElement) =>
  within(card)
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".mem-row__text")?.textContent);
const rowOf = (text: string) => {
  const li = screen.getByText(text).closest("li");
  if (!li) throw new Error(`no row for ${text}`);
  return li;
};
const toastWith = async (text: string) =>
  (await screen.findByText(text)).closest(".ds-toast") as HTMLElement;
const tabs = () => screen.getByRole("tablist", { name: "Memory" });
const filter = (name: string) => screen.getByRole("combobox", { name });

/** Open a filter and pick an option, as a person does. */
const choose = (name: string, option: string) => {
  fireEvent.click(filter(name));
  const list = screen.getByRole("listbox", { name });
  fireEvent.click(within(list).getByRole("option", { name: option }));
};

describe("MemoryPage › Active — rows", () => {
  it("lists pinned first, then newest, with each row's scope, meta and actions", async () => {
    activeApi({ rows: [ACT_MAY, ACT_CONTEXT, ACT_SHOULD, ACT_MUST] });
    renderAt("#/toolkit/memory/active");
    const card = await activeCard();
    expect(rowTexts(card)).toEqual(ACTIVE.map((m) => m.content));

    const must = rowOf(ACT_MUST.content);
    expect(within(must).getByText("MUST")).toBeTruthy();
    expect(within(must).getByText("lazyxgenius/trade_mcp")).toBeTruthy();
    expect(within(must).getByText("Confirmed 3× · pinned")).toBeTruthy();
    const unpin = within(must).getByRole("button", { name: "Unpin" });
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    expect(within(must).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(must).getByRole("button", { name: "Delete" })).toBeTruthy();

    const should = rowOf(ACT_SHOULD.content);
    expect(within(should).getByText("Reviewer · Indicator sprint team")).toBeTruthy();
    expect(within(should).getByText("Confirmed 1× · Sep 24")).toBeTruthy();
    expect(within(should).getByRole("button", { name: "Pin" })).not.toHaveAttribute("aria-pressed");
    expect(within(rowOf(ACT_CONTEXT.content)).getByText("Added by you · Sep 20")).toBeTruthy();
    expect(within(rowOf(ACT_MAY.content)).getByText("Account · all repos")).toBeTruthy();
    expect(within(tabs()).getByRole("tab", { name: "Active 4" })).toBeTruthy();
    // No filter set: no "N of M".
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("with no memories at all, says so and offers Add memory", async () => {
    activeApi({ rows: [] });
    renderAt("#/toolkit/memory/active");
    const empty = await screen.findByRole("region", {
      name: "Your agents haven’t learned anything yet",
    });
    expect(
      within(empty).getByText(
        "As agents run, useful facts about your repos show up in the Inbox. You can also add your own.",
      ),
    ).toBeTruthy();
    expect(within(empty).getByRole("button", { name: "Add memory" })).toBeTruthy();
    // The filter bar stays, as the design draws it.
    expect(filter("Repo")).toBeTruthy();
  });

  it("says when Active can't load, and tries again", async () => {
    let fail = true;
    activeApi({
      routes: {
        "GET /api/memories": () =>
          fail ? jsonError(500, "database is down") : { memories: [ACT_MUST] },
      },
    });
    renderAt("#/toolkit/memory/active");
    const err = await screen.findByRole("region", { name: "Couldn’t load your memories" });
    expect(within(err).getByText("database is down")).toBeTruthy();
    fail = false;
    fireEvent.click(within(err).getByRole("button", { name: "Try again" }));
    expect(rowTexts(await activeCard())).toEqual([ACT_MUST.content]);
  });
});

describe("MemoryPage › Active — filters", () => {
  it("filters by force and says how many of how many, and Clear filters brings them back", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    expect(filter("Force")).toHaveTextContent("Any force");

    choose("Force", "SHOULD");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(filter("Force")).toHaveTextContent("SHOULD");
    expect(rowTexts(await activeCard())).toEqual([ACT_SHOULD.content]);
    expect(screen.getByText("1 of 4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(filter("Force")).toHaveTextContent("Any force");
    expect(rowTexts(await activeCard())).toHaveLength(4);
    expect(screen.queryByText(/ of 4$/)).toBeNull();
  });

  it("lists repos with memories first; a repo keeps its memories and the account-wide ones", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(filter("Repo"));
    const list = screen.getByRole("listbox", { name: "Repo" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All repos", "lazyxgenius/trade_mcp", "lazyxgenius/cryptoground-mcp"]);
    expect(within(list).getByRole("option", { name: "All repos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(list).getByRole("option", { name: "lazyxgenius/cryptoground-mcp" }));
    expect(rowTexts(await activeCard())).toEqual([ACT_CONTEXT.content, ACT_MAY.content]);
    expect(screen.getByText("2 of 4")).toBeTruthy();
  });

  it("combines words, scope and force with AND", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    choose("Scope", "Account");
    expect(rowTexts(await activeCard())).toEqual([ACT_CONTEXT.content, ACT_MAY.content]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search memory" }), {
      target: { value: "uvx" },
    });
    expect(rowTexts(await activeCard())).toEqual([ACT_MAY.content]);
    expect(screen.getByText("1 of 4")).toBeTruthy();
  });

  it("no match names the words, and its Clear filters resets every filter", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    choose("Scope", "Repo");
    fireEvent.change(screen.getByRole("textbox", { name: "Search memory" }), {
      target: { value: "docker" },
    });
    const none = await screen.findByRole("region", { name: "Nothing matches “docker”" });
    expect(within(none).getByText("Try another word, or clear the filters.")).toBeTruthy();
    expect(within(none).getByRole("button", { name: "Add memory" })).toBeTruthy();
    // The bar doesn't repeat Clear filters over an empty result.
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);

    fireEvent.click(within(none).getByRole("button", { name: "Clear filters" }));
    expect(rowTexts(await activeCard())).toHaveLength(4);
    expect(screen.getByRole("textbox", { name: "Search memory" })).toHaveValue("");
    expect(filter("Scope")).toHaveTextContent("All scopes");
  });

  it("a filter with no words and no match says so plainly", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    choose("Force", "MUST NOT");
    expect(
      await screen.findByRole("region", { name: "Nothing matches these filters" }),
    ).toBeTruthy();
  });

  it("works from the keyboard: arrows open and move, Escape closes back to the trigger", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    const trigger = filter("Force");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Force" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(list).getByRole("option", { name: "Any force" })),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "MUST" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "MUST NOT" }));

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveTextContent("Any force");
  });
});

describe("MemoryPage › Active — note actions", () => {
  it("Pin moves the note up under the other pinned one; Undo unpins it", async () => {
    const { calls } = activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(within(rowOf(ACT_CONTEXT.content)).getByRole("button", { name: "Pin" }));
    const toast = await toastWith("Pinned. Pinned notes go to the agent first.");
    const card = await activeCard();
    expect(rowTexts(card)).toEqual([
      ACT_MUST.content,
      ACT_CONTEXT.content,
      ACT_SHOULD.content,
      ACT_MAY.content,
    ]);
    const context = rowOf(ACT_CONTEXT.content);
    expect(within(context).getByText("Added by you · pinned")).toBeTruthy();
    expect(within(context).getByRole("button", { name: "Unpin" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/a-context/pin"))).toBe(true);

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(within(rowOf(ACT_CONTEXT.content)).getByText("Added by you · Sep 20")).toBeTruthy(),
    );
    expect(rowTexts(await activeCard())).toEqual(ACTIVE.map((m) => m.content));
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/a-context/unpin"))).toBe(
      true,
    );
  });

  it("Unpin drops the note back among the others", async () => {
    activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(within(rowOf(ACT_MUST.content)).getByRole("button", { name: "Unpin" }));
    await toastWith("Unpinned.");
    expect(within(rowOf(ACT_MUST.content)).getByText("Confirmed 3× · 3h ago")).toBeTruthy();
    expect(within(rowOf(ACT_MUST.content)).getByRole("button", { name: "Pin" })).toBeTruthy();
  });

  it("Edit saves in place and the meta says you edited it just now", async () => {
    const { calls } = activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(within(rowOf(ACT_SHOULD.content)).getByRole("button", { name: "Edit" }));
    const card = await activeCard();
    const box = within(card).getByRole("textbox", { name: "Memory text" });
    const next =
      "Approve only when the registry test, the TypeScript mirror and the docs list the same indicators.";
    fireEvent.change(box, { target: { value: next } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await toastWith("Saved. Agents see the new text on their next run.");
    expect(within(rowOf(next)).getByText("Edited by you · just now")).toBeTruthy();
    expect(rowTexts(await activeCard())[1]).toBe(next);
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ content: next });
  });

  it("an edit the embedding service can't take keeps the editor open, without calling the app offline", async () => {
    let fail = true;
    activeApi({
      routes: {
        "PATCH /api/memories/:id": (_u: URL, b: unknown) =>
          fail
            ? jsonError(502, "the embedding call failed")
            : { ...ACT_SHOULD, ...(b as Partial<Memory>), edited_at: new Date(NOW).toISOString() },
      },
    });
    renderAt("#/toolkit/memory/active");
    const status = renderHook(() => useBackendStatus());
    await activeCard();
    fireEvent.click(within(rowOf(ACT_SHOULD.content)).getByRole("button", { name: "Edit" }));
    const card = await activeCard();
    const box = within(card).getByRole("textbox", { name: "Memory text" });
    fireEvent.change(box, { target: { value: "Approve only with the docs list in step." } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    expect((await within(card).findByRole("alert")).textContent).toBe(
      "The embedding service didn’t answer, so the edit wasn’t saved. Try again.",
    );
    expect(box).toHaveValue("Approve only with the docs list in step.");
    expect(status.result.current.state).toBe("connected");
    fail = false;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await toastWith("Saved. Agents see the new text on their next run.");
  });

  it("Delete asks first, quoting the memory, then removes it", async () => {
    const { state } = activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(within(rowOf(ACT_CONTEXT.content)).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this memory?" });
    expect(dialog).toHaveTextContent(
      "“The team ships to a Fly.io preview before the human merge gate.” Agents stop seeing it on their next run. You can’t undo this.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete memory" }));

    await toastWith("Memory deleted.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rowTexts(await activeCard())).not.toContain(ACT_CONTEXT.content);
    expect(state.rows).toHaveLength(3);
    await waitFor(() => expect(within(tabs()).getByRole("tab", { name: "Active 3" })).toBeTruthy());
  });

  it("Cancel keeps the memory", async () => {
    const { calls } = activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    fireEvent.click(within(rowOf(ACT_MAY.content)).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rowTexts(await activeCard())).toContain(ACT_MAY.content);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a memory that's gone meanwhile reloads Active and says so", async () => {
    const { state } = activeApi();
    renderAt("#/toolkit/memory/active");
    await activeCard();
    state.rows = state.rows.filter((r) => r.id !== ACT_MAY.id);
    fireEvent.click(within(rowOf(ACT_MAY.content)).getByRole("button", { name: "Pin" }));
    await toastWith("That memory is no longer in Active.");
    await waitFor(async () => expect(rowTexts(await activeCard())).toHaveLength(3));
  });
});
