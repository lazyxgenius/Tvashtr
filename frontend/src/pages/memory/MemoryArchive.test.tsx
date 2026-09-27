import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory } from "../../lib/api/memory";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import {
  ACT_MUST,
  ARCHIVE,
  ARC_DISCARDED,
  ARC_REPLACED,
  NOW,
  memory,
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

const idAt = (u: URL, fromEnd: number) => u.pathname.split("/").at(fromEnd) ?? "";
type Promoted = Memory & { action: string; merged_id?: string; superseded?: string };

/**
 * The Archive's two lists and Restore (= promote). `promote` decides what the backend did with a
 * restored memory; by default it simply goes back to Active.
 */
function archiveApi(
  opts: {
    rows?: Memory[];
    promote?: (m: Memory, state: { rows: Memory[]; active: number }) => Promoted;
    routes?: Record<string, unknown>;
  } = {},
) {
  const state = { rows: [...(opts.rows ?? ARCHIVE)], active: 14 };
  const calls = mockApi({
    "GET /api/memories": (u: URL) => {
      const status = u.searchParams.get("status");
      return { memories: state.rows.filter((r) => r.status === status) };
    },
    "GET /api/memories/counts": () => ({
      inbox: 2,
      active: state.active,
      archive: state.rows.length,
    }),
    "POST /api/memories/:id/promote": (u: URL) => {
      const m = state.rows.find((r) => r.id === idAt(u, -2) && r.status === "rejected");
      if (!m) return jsonError(404, "memory not found");
      if (opts.promote) return opts.promote(m, state);
      state.rows = state.rows.filter((r) => r.id !== m.id);
      state.active += 1;
      return { ...m, status: "active", invalid_at: null, action: "promote" };
    },
    ...opts.routes,
  });
  return { calls, state };
}

/** The Archive card once it has loaded (the loading card carries the same name). */
const archiveCard = async () => {
  const region = () => screen.getByRole("region", { name: "Archive" });
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

describe("MemoryPage › Archive", () => {
  it("lists what was replaced or discarded, newest first, and only a discarded one restores", async () => {
    archiveApi({ rows: [ARC_DISCARDED, ARC_REPLACED] });
    renderAt("#/toolkit/memory/archive");
    const card = await archiveCard();
    expect(
      screen.getByText(
        "Memories that were replaced or discarded. Agents don’t see these. You can restore a discarded one.",
      ),
    ).toBeTruthy();
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".mem-row__text")?.textContent),
    ).toEqual([ARC_REPLACED.content, ARC_DISCARDED.content]);

    const replaced = rowOf(ARC_REPLACED.content);
    expect(within(replaced).getByText("SHOULD")).toBeTruthy();
    expect(within(replaced).getByText("lazyxgenius/trade_mcp")).toBeTruthy();
    expect(within(replaced).getByText("Replaced by a newer memory · Sep 22")).toBeTruthy();
    expect(within(replaced).getByText("Superseded")).toHaveClass("ds-badge--neutral");
    expect(within(replaced).queryByRole("button")).toBeNull();

    const discarded = rowOf(ARC_DISCARDED.content);
    expect(within(discarded).getByText("MUST NOT")).toBeTruthy();
    expect(within(discarded).getByText("Engineer · Indicator sprint team")).toBeTruthy();
    expect(within(discarded).getByText("Discarded by you · Sep 21")).toBeTruthy();
    expect(within(discarded).getByText("Discarded")).toHaveClass("ds-badge--outline");
    expect(within(discarded).getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("Restore puts it back in Active, and the toast's Open Active goes there", async () => {
    const { calls } = archiveApi();
    renderAt("#/toolkit/memory/archive");
    await archiveCard();
    await waitFor(() =>
      expect(within(tabs()).getByRole("tab", { name: "Active 14" })).toBeTruthy(),
    );
    fireEvent.click(within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }));

    const toast = await toastWith("Restored to Active.");
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/x-discarded/promote"))).toBe(
      true,
    );
    await waitFor(() => expect(screen.queryByText(ARC_DISCARDED.content)).toBeNull());
    expect(screen.getByText(ARC_REPLACED.content)).toBeTruthy();
    await waitFor(() =>
      expect(within(tabs()).getByRole("tab", { name: "Active 15" })).toBeTruthy(),
    );

    fireEvent.click(within(toast).getByRole("button", { name: "Open Active" }));
    expect(window.location.hash).toBe("#/toolkit/memory/active");
  });

  it("a restore that only confirms a memory you had says so, and the row stays as merged", async () => {
    archiveApi({
      promote: (m, state) => {
        const merged = {
          ...m,
          status: "superseded" as const,
          superseded_by: ACT_MUST.id,
          superseded_reason: "merged" as const,
          invalid_at: new Date(NOW).toISOString(),
        };
        state.rows = state.rows.map((r) => (r.id === m.id ? merged : r));
        return { ...ACT_MUST, confirmation_count: 4, action: "promote_merged", merged_id: m.id };
      },
    });
    renderAt("#/toolkit/memory/archive");
    await archiveCard();
    fireEvent.click(within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }));

    const toast = await toastWith("Already known. Confirmed the existing memory.");
    expect(within(toast).getByRole("button", { name: "Open Active" })).toBeTruthy();
    const row = await waitFor(() => rowOf(ARC_DISCARDED.content));
    expect(within(row).getByText("Merged into a memory you already had · just now")).toBeTruthy();
    expect(within(row).getByText("Superseded")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("a restore that replaces an opposite memory says so, and that memory shows up here", async () => {
    const opposite = memory({
      id: "a-opposite",
      content: "Touch web/lib when the build needs it.",
      polarity: "allow",
      status: "active",
    });
    archiveApi({
      promote: (m, state) => {
        const retired = {
          ...opposite,
          status: "superseded" as const,
          superseded_by: m.id,
          superseded_reason: "replaced" as const,
          invalid_at: new Date(NOW).toISOString(),
        };
        state.rows = [...state.rows.filter((r) => r.id !== m.id), retired];
        return { ...m, status: "active", action: "promote_supersede", superseded: opposite.id };
      },
    });
    renderAt("#/toolkit/memory/archive");
    await archiveCard();
    fireEvent.click(within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }));

    await toastWith("Restored to Active. It replaces an older memory that said the opposite.");
    const row = await waitFor(() => rowOf(opposite.content));
    expect(within(row).getByText("Replaced by a newer memory · just now")).toBeTruthy();
    expect(screen.queryByText(ARC_DISCARDED.content)).toBeNull();
  });

  it("a memory someone else already restored reloads the Archive and says so", async () => {
    const { state } = archiveApi();
    renderAt("#/toolkit/memory/archive");
    await archiveCard();
    state.rows = state.rows.filter((r) => r.id !== ARC_DISCARDED.id);
    fireEvent.click(within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }));

    await toastWith("That memory is no longer in the Archive.");
    await waitFor(() => expect(screen.queryByText(ARC_DISCARDED.content)).toBeNull());
    expect(screen.getByText(ARC_REPLACED.content)).toBeTruthy();
  });

  it("keeps the row and says why when a restore fails", async () => {
    archiveApi({
      routes: {
        "POST /api/memories/:id/promote": () => jsonError(503, "The database is busy. Try again."),
      },
    });
    renderAt("#/toolkit/memory/archive");
    await archiveCard();
    fireEvent.click(within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }));

    await toastWith("The database is busy. Try again.");
    expect(
      within(rowOf(ARC_DISCARDED.content)).getByRole("button", { name: "Restore" }),
    ).not.toBeDisabled();
  });

  it("an empty Archive says what shows up here", async () => {
    archiveApi({ rows: [] });
    renderAt("#/toolkit/memory/archive");
    expect(await screen.findByRole("heading", { name: "Nothing in the Archive" })).toBeTruthy();
    expect(
      screen.getByText("When you discard a memory, or a newer one replaces it, it shows up here."),
    ).toBeTruthy();
  });

  it("says when the Archive can't load, and tries again", async () => {
    let fail = true;
    archiveApi({
      routes: {
        "GET /api/memories": (u: URL) =>
          fail
            ? jsonError(500, "Couldn’t read memories.")
            : { memories: ARCHIVE.filter((r) => r.status === u.searchParams.get("status")) },
      },
    });
    renderAt("#/toolkit/memory/archive");
    expect(await screen.findByRole("heading", { name: "Couldn’t load the Archive" })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await archiveCard();
    expect(screen.getByText(ARC_DISCARDED.content)).toBeTruthy();
  });
});
