import { fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory } from "../../lib/api/memory";
import { __resetBackendStatusForTests, useBackendStatus } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { jsonError, mockApi } from "../home/homeTestUtils";
import { FORCE_CHOICES } from "./memoryModel";
import { ACTIVE, ACT_CONTEXT, ACT_MUST, MEM_SHOULD, NOW, renderAt } from "./memoryTestUtils";

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

const repo = (key: string, last_run_at: string | null) => ({
  repo_key: key,
  label: key,
  memory_count: 0,
  pending_count: 0,
  last_run_at,
});
/** Sorted by label like the backend; trade_mcp ran last, so One repo starts on it. */
const REPOS = [
  repo("lazyxgenius/cryptoground-mcp", "2026-09-24T12:00:00Z"),
  repo("lazyxgenius/trade_mcp", "2026-09-25T09:00:00Z"),
];
const LINTER = "Always run the linter before shipping.";

/** The backend: Active rows, the repos, and a create that answers like `POST /api/memories`. */
function addApi(
  opts: { repos?: unknown; create?: (body: unknown) => unknown; pending?: Memory[] } = {},
) {
  const state = { rows: [...ACTIVE], pending: opts.pending ?? [] };
  const calls = mockApi({
    "GET /api/memories": (u: URL) => {
      const status = u.searchParams.get("status");
      return {
        memories:
          status === "active" ? state.rows : status === "pending_review" ? state.pending : [],
      };
    },
    "GET /api/memories/counts": () => ({
      inbox: state.pending.length,
      active: state.rows.length,
      archive: 0,
    }),
    "GET /api/memory/repos": opts.repos ?? { repos: REPOS },
    "GET /api/memory/review-mode": { review_mode: true },
    "POST /api/memories": (_u: URL, body: unknown) => {
      if (opts.create) return opts.create(body);
      const b = body as { content: string; polarity: Memory["polarity"]; repo_key: string | null };
      const made: Memory = {
        ...ACT_CONTEXT,
        id: "a-new",
        content: b.content,
        polarity: b.polarity,
        repo_key: b.repo_key,
        repo_label: b.repo_key,
        tier: b.repo_key ? "repo" : "account",
        created_at: new Date(NOW).toISOString(),
        updated_at: new Date(NOW).toISOString(),
      };
      state.rows = [...state.rows, made];
      return made;
    },
  });
  return { calls, state };
}

const openSheet = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  const sheet = await screen.findByRole("dialog", { name: "Add memory" });
  // The repos have loaded (the Repo select is no longer waiting).
  await waitFor(() =>
    expect(within(sheet).queryByRole("option", { name: "Loading repos…" })).toBeNull(),
  );
  return sheet;
};
const textBox = (sheet: HTMLElement) =>
  within(sheet).getByRole("textbox", { name: "What should agents remember?" });
/** A "How strongly" card's radio; its name is the badge and the hint ("MUST Always do this."). */
const force = (sheet: HTMLElement, label: string) => {
  const c = FORCE_CHOICES.find((f) => f.label === label);
  return within(sheet).getByRole("radio", { name: `${label} ${c?.hint ?? ""}` });
};
const posts = (calls: { method: string; path: string; body?: unknown }[]) =>
  calls.filter((c) => c.method === "POST" && c.path === "/api/memories");
const activeRows = () =>
  within(screen.getByRole("region", { name: "Active" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".mem-row__text")?.textContent);

describe("MemoryPage › Add memory", () => {
  it("opens a sheet: the text first, One repo on the repo you ran on last, MUST", async () => {
    addApi();
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    expect(within(sheet).getByText("A fact or rule your agents should keep in mind")).toBeTruthy();
    expect(textBox(sheet)).toHaveFocus();
    expect(textBox(sheet)).toHaveValue("");
    const applies = within(sheet).getByRole("group", { name: "Applies to" });
    expect(within(applies).getByRole("button", { name: "One repo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(applies).getByRole("button", { name: "Every repo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(sheet).getByRole("combobox", { name: "Repo" })).toHaveValue(
      "lazyxgenius/trade_mcp",
    );
    const forces = within(sheet).getByRole("radiogroup", { name: "How strongly" });
    expect(within(forces).getAllByRole("radio")).toHaveLength(6);
    expect(force(sheet, "MUST")).toBeChecked();
    expect(within(forces).getByText("Never do this.")).toBeTruthy();
    expect(within(sheet).getByText("Memories you add apply right away.")).toBeTruthy();
  });

  it("asks for the text before adding anything", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));
    expect(await within(sheet).findByText("Write the memory first.")).toBeTruthy();
    expect(textBox(sheet)).toHaveAttribute("aria-invalid", "true");
    // Blank space is still nothing to remember.
    fireEvent.change(textBox(sheet), { target: { value: "   " } });
    expect(within(sheet).queryByText("Write the memory first.")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));
    expect(await within(sheet).findByText("Write the memory first.")).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  it("adds it to the repo, first after the pinned row, and says it applies right away", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    fireEvent.change(textBox(sheet), { target: { value: `  ${LINTER} ` } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    const toast = (
      await screen.findByText("Added. It applies to lazyxgenius/trade_mcp right away.")
    ).closest(".ds-toast");
    expect(toast).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add memory" })).toBeNull();
    expect(posts(calls).map((c) => c.body)).toEqual([
      { content: LINTER, polarity: "require", repo_key: "lazyxgenius/trade_mcp" },
    ]);
    expect(activeRows()).toEqual([
      ACT_MUST.content,
      LINTER,
      ...ACTIVE.slice(1).map((m) => m.content),
    ]);
    const row = screen.getByText(LINTER).closest("li") as HTMLElement;
    expect(within(row).getByText("Added by you · just now")).toBeTruthy();
    // The tab count follows.
    expect(await screen.findByRole("tab", { name: "Active 5" })).toBeTruthy();
  });

  it("adds a SHOULD NOT for every repo", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    fireEvent.change(textBox(sheet), { target: { value: "Don’t push to main." } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Every repo" }));
    expect(within(sheet).queryByRole("combobox", { name: "Repo" })).toBeNull();
    fireEvent.click(force(sheet, "SHOULD NOT"));
    expect(force(sheet, "SHOULD NOT")).toBeChecked();
    expect(force(sheet, "MUST")).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    expect(await screen.findByText("Added. It applies to every repo right away.")).toBeTruthy();
    expect(posts(calls).map((c) => c.body)).toEqual([
      { content: "Don’t push to main.", polarity: "avoid", repo_key: null },
    ]);
    const row = screen.getByText("Don’t push to main.").closest("li") as HTMLElement;
    expect(within(row).getByText("SHOULD NOT")).toBeTruthy();
    expect(within(row).getByText("Account · all repos")).toBeTruthy();
  });

  it("adds it to another repo you pick", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    fireEvent.change(textBox(sheet), { target: { value: LINTER } });
    fireEvent.change(within(sheet).getByRole("combobox", { name: "Repo" }), {
      target: { value: "lazyxgenius/cryptoground-mcp" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    expect(
      await screen.findByText("Added. It applies to lazyxgenius/cryptoground-mcp right away."),
    ).toBeTruthy();
    expect(posts(calls)[0].body).toMatchObject({ repo_key: "lazyxgenius/cryptoground-mcp" });
  });

  it("from the Inbox, shows the new memory in Active", async () => {
    addApi({ pending: [MEM_SHOULD] });
    renderAt("#/toolkit/memory/inbox");
    const sheet = await openSheet();

    fireEvent.change(textBox(sheet), { target: { value: LINTER } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    expect(
      await screen.findByText("Added. It applies to lazyxgenius/trade_mcp right away."),
    ).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#/toolkit/memory/active"));
    await waitFor(() => expect(activeRows()).toContain(LINTER));
    expect(activeRows()[1]).toBe(LINTER);
  });

  it("Cancel, Close and Escape drop the draft", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");

    for (const close of [
      (s: HTMLElement) => fireEvent.click(within(s).getByRole("button", { name: "Cancel" })),
      (s: HTMLElement) => fireEvent.click(within(s).getByRole("button", { name: "Close" })),
      (s: HTMLElement) => fireEvent.keyDown(s, { key: "Escape" }),
    ]) {
      const sheet = await openSheet();
      expect(textBox(sheet)).toHaveValue("");
      expect(force(sheet, "MUST")).toBeChecked();
      fireEvent.change(textBox(sheet), { target: { value: LINTER } });
      fireEvent.click(force(sheet, "MAY"));
      close(sheet);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add memory" })).toBeNull());
    }
    expect(posts(calls)).toHaveLength(0);
  });

  it("keeps the draft when the embedding service fails, without calling the app offline", async () => {
    let fail = true;
    const { calls } = addApi({
      create: () =>
        fail ? jsonError(502, "the embedding call failed") : { ...ACT_CONTEXT, id: "a-new" },
    });
    renderAt("#/toolkit/memory/active");
    const status = renderHook(() => useBackendStatus());
    const sheet = await openSheet();

    fireEvent.change(textBox(sheet), { target: { value: LINTER } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    expect(
      await within(sheet).findByText(
        "The embedding service didn’t answer, so nothing was saved. Try again.",
      ),
    ).toBeTruthy();
    expect(textBox(sheet)).toHaveValue(LINTER);
    expect(status.result.current.state).toBe("connected");
    // Try again.
    fail = false;
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add memory" })).toBeNull());
    expect(posts(calls)).toHaveLength(2);
  });

  it("applies to every repo when there are no repos to choose", async () => {
    const { calls } = addApi({ repos: { repos: [] } });
    renderAt("#/toolkit/memory/active");
    const sheet = await openSheet();

    expect(within(sheet).getByRole("button", { name: "Every repo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sheet).getByRole("button", { name: "One repo" })).toBeDisabled();
    expect(within(sheet).queryByRole("combobox", { name: "Repo" })).toBeNull();
    fireEvent.change(textBox(sheet), { target: { value: LINTER } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));
    expect(await screen.findByText("Added. It applies to every repo right away.")).toBeTruthy();
    expect(posts(calls)[0].body).toMatchObject({ repo_key: null });
  });

  it("opens from Active's empty state, and the first memory fills it", async () => {
    const { state } = addApi();
    state.rows = [];
    renderAt("#/toolkit/memory/active");
    const empty = await screen.findByRole("region", {
      name: "Your agents haven’t learned anything yet",
    });
    fireEvent.click(within(empty).getByRole("button", { name: "Add memory" }));
    const sheet = await screen.findByRole("dialog", { name: "Add memory" });
    await waitFor(() =>
      expect(within(sheet).getByRole("combobox", { name: "Repo" })).toHaveValue(
        "lazyxgenius/trade_mcp",
      ),
    );
    fireEvent.change(textBox(sheet), { target: { value: LINTER } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add memory" }));

    await waitFor(() => expect(activeRows()).toEqual([LINTER]));
    expect(screen.queryByText("Your agents haven’t learned anything yet")).toBeNull();
  });

  it("asks for the repos your GitHub App reaches too", async () => {
    const { calls } = addApi();
    renderAt("#/toolkit/memory/active");
    await openSheet();
    expect(calls.some((c) => c.path === "/api/memory/repos?include_github=true")).toBe(true);
  });
});
