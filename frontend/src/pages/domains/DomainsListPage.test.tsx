import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests, useNavBadges } from "../../lib/workspaceStatus";
import { DomainsListPage } from "./DomainsListPage";
import { domainItem, mockApi, sampleDomains } from "./domainsTestUtils";

const TEMPLATES = {
  templates: [
    {
      template: "support",
      name: "Support",
      description: "d",
      short: "Help center and product docs",
      piece_size: 600,
      overlap: 100,
    },
    {
      template: "legal",
      name: "Legal",
      description: "d",
      short: "Contracts and policies",
      piece_size: 500,
      overlap: 80,
    },
    {
      template: "financial",
      name: "Financial",
      description: "d",
      short: "Filings and investor docs",
      piece_size: 700,
      overlap: 100,
    },
    {
      template: "scientific",
      name: "Scientific",
      description: "d",
      short: "Papers and methods",
      piece_size: 1000,
      overlap: 150,
    },
    {
      template: "blank",
      name: "Blank",
      description: "d",
      short: "Start from defaults",
      piece_size: 800,
      overlap: 100,
    },
  ],
};

function routes(over: Record<string, unknown> = {}) {
  return {
    "GET /api/domains": { domains: sampleDomains() },
    "GET /api/account/preferences": { get_started_hidden: false, domains_howto_hidden: false },
    "PATCH /api/account/preferences": { get_started_hidden: false, domains_howto_hidden: true },
    "GET /api/domain-templates": TEMPLATES,
    "GET /api/providers": { providers: [] },
    ...over,
  };
}

function NavProbe() {
  const b = useNavBadges();
  return (
    <output data-testid="nav">
      {(b.domains ?? []).map((d) => `${d.name}:${d.state}`).join(",")}
    </output>
  );
}

function renderPage() {
  return render(
    <ToastProvider>
      <DomainsListPage />
      <NavProbe />
    </ToastProvider>,
  );
}

const cardNames = () => screen.queryAllByRole("article").map((a) => a.getAttribute("aria-label"));

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  window.location.hash = "#/domains";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Domains list (Dm-List)", () => {
  it("shows a card per domain with the design's lines, and publishes the nav rows", async () => {
    mockApi(routes());
    renderPage();
    const support = await screen.findByRole("article", { name: "Support docs" });
    expect(within(support).getByRole("link", { name: "Support docs" })).toHaveAttribute(
      "href",
      "#/domains/d-support",
    );
    expect(support).toHaveTextContent("ReadySupport");
    expect(within(support).getByText("14 files · 1,212 pieces")).toBeInTheDocument();
    expect(within(support).getByText("83% found the right file")).toBeInTheDocument();
    expect(within(support).getByText("Used 3 times in 2 teams")).toBeInTheDocument();
    expect(within(support).getByText(/^Updated /)).toBeInTheDocument();
    const vendor = screen.getByRole("article", { name: "Vendor contracts" });
    expect(within(vendor).getByText("6 files · reading 4 of 6")).toBeInTheDocument();
    expect(within(vendor).getByText("Reading")).toBeInTheDocument();
    const q3 = screen.getByRole("article", { name: "Q3 filings" });
    expect(within(q3).getByText("No files yet")).toBeInTheDocument();
    expect(within(q3).getByText("—")).toBeInTheDocument();
    expect(within(q3).getByText("Created Sep 23")).toBeInTheDocument();
    // Recently updated first; the nav keeps creation order.
    expect(cardNames()).toEqual([
      "Vendor contracts",
      "Support docs",
      "Research papers",
      "Q3 filings",
    ]);
    expect(screen.getByTestId("nav")).toHaveTextContent(
      "Support docs:ready,Vendor contracts:reading,Research papers:needs_attention,Q3 filings:empty",
    );
    expect(screen.getByRole("button", { name: "New domain" })).toBeInTheDocument();
  });

  it("filters by name and offers to clear a search with no match (DmF-Find-1, -2)", async () => {
    mockApi(routes());
    renderPage();
    await screen.findByRole("article", { name: "Support docs" });
    const search = screen.getByRole("textbox", { name: "Search domains" });
    fireEvent.change(search, { target: { value: "contr" } });
    expect(cardNames()).toEqual(["Vendor contracts"]);
    fireEvent.change(search, { target: { value: "filings 2025" } });
    expect(cardNames()).toEqual([]);
    expect(screen.getByText(/^No domains match “filings 2025”\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(cardNames()).toHaveLength(4);
  });

  it("sorts from the Sort listbox, by mouse and by keyboard (DmF-Find-3)", async () => {
    mockApi(routes());
    renderPage();
    await screen.findByRole("article", { name: "Support docs" });
    const sort = screen.getByRole("button", { name: "Sort" });
    expect(sort).toHaveTextContent("Recently updated");
    fireEvent.click(sort);
    const list = screen.getByRole("listbox", { name: "Sort" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Recently updated", "Name", "Most used", "Needs attention first"]);
    expect(within(list).getByRole("option", { name: "Recently updated" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(list).getByRole("option", { name: "Name" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(cardNames()).toEqual([
      "Q3 filings",
      "Research papers",
      "Support docs",
      "Vendor contracts",
    ]);
    // Keyboard: open, move down twice (Most used), pick.
    fireEvent.keyDown(screen.getByRole("button", { name: "Sort" }), { key: "ArrowDown" });
    const again = screen.getByRole("listbox", { name: "Sort" });
    fireEvent.keyDown(again, { key: "ArrowDown" });
    fireEvent.keyDown(again, { key: "ArrowDown" });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Sort" })).toHaveTextContent("Needs attention first");
    expect(cardNames()[0]).toBe("Research papers");
    // Escape closes without changing it.
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Sort" })).toHaveTextContent("Needs attention first");
  });

  it("hides the how-it-works strip for the account (DM-6)", async () => {
    const calls = mockApi(routes());
    renderPage();
    const strip = await screen.findByRole("region", { name: "How domains work" });
    expect(strip).toHaveTextContent("1. Add your files");
    expect(strip).toHaveTextContent("3. Use it in a team");
    fireEvent.click(within(strip).getByRole("button", { name: "Hide how domains work" }));
    expect(screen.queryByRole("region", { name: "How domains work" })).toBeNull();
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PATCH",
        path: "/api/account/preferences",
        body: { domains_howto_hidden: true },
      }),
    );
  });

  it("leaves the strip out when the account hid it", async () => {
    mockApi(
      routes({
        "GET /api/account/preferences": { get_started_hidden: false, domains_howto_hidden: true },
      }),
    );
    renderPage();
    await screen.findByRole("article", { name: "Support docs" });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("region", { name: "How domains work" })).toBeNull();
  });

  it("opens, asks and copies the ID from a card's ⋯ menu", async () => {
    mockApi(routes());
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPage();
    await screen.findByRole("article", { name: "Support docs" });
    const menuFor = () => screen.getByRole("button", { name: "More actions for Support docs" });
    fireEvent.click(menuFor());
    const menu = screen.getByRole("menu", { name: "More actions for Support docs" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Open", "Ask a question", "Copy domain ID"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Ask a question" }));
    expect(window.location.hash).toBe("#/domains/d-support/ask");
    fireEvent.click(menuFor());
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(window.location.hash).toBe("#/domains/d-support");
    fireEvent.click(menuFor());
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy domain ID" }));
    expect(writeText).toHaveBeenCalledWith("d-support");
    expect(await screen.findByText("Domain ID copied.")).toBeInTheDocument();
  });

  it("polls every 3 s while a domain is being read, then stops (DM-4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    mockApi(
      routes({
        "GET /api/domains": () => {
          reads += 1;
          const vendor = domainItem({
            name: "Vendor contracts",
            state: reads < 3 ? "reading" : "ready",
          });
          return { domains: [vendor] };
        },
      }),
    );
    renderPage();
    await screen.findByRole("article", { name: "Vendor contracts" });
    expect(reads).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(reads).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(reads).toBe(3);
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(reads).toBe(3);
  });

  it("says when the list can't load and retries", async () => {
    let fail = true;
    mockApi(
      routes({
        "GET /api/domains": () =>
          fail
            ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
            : { domains: sampleDomains() },
      }),
    );
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Support docs" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("No domains yet (Dm-ListEmpty, DmF-First-1)", () => {
  it("shows the empty card, four starting points and the key hint", async () => {
    mockApi(routes({ "GET /api/domains": { domains: [] } }));
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Give your agents your own documents" }),
    ).toBeInTheDocument();
    const group = await screen.findByRole("group", { name: "Or start from a template" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "SupportHelp center and product docs600-character pieces",
      "LegalContracts and policies500-character pieces",
      "FinancialFilings and investor docs700-character pieces",
      "ScientificPapers and methods1,000-character pieces",
    ]);
    expect(
      await screen.findByText(/You’ll need an API key for a reading model, like OpenAI\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check Engines" })).toHaveAttribute(
      "href",
      "#/engines/keys",
    );
    // The page has one New domain (in the card), no search, no strip.
    expect(screen.getAllByRole("button", { name: "New domain" })).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Search domains" })).toBeNull();
    expect(screen.queryByRole("region", { name: "How domains work" })).toBeNull();
  });

  it("hides the key hint once any reading-model key is saved (DM-20)", async () => {
    mockApi(
      routes({
        "GET /api/domains": { domains: [] },
        "GET /api/providers": {
          providers: [
            { provider: "gemini", key_last4: "abcd", created_at: "2026-09-20T00:00:00Z" },
          ],
        },
      }),
    );
    renderPage();
    await screen.findByRole("group", { name: "Or start from a template" });
    await act(async () => Promise.resolve());
    expect(screen.queryByText(/You’ll need an API key/)).toBeNull();
  });

  it("opens New domain with a template picked, and How domains work", async () => {
    mockApi(routes({ "GET /api/domains": { domains: [] } }));
    renderPage();
    const group = await screen.findByRole("group", { name: "Or start from a template" });
    fireEvent.click(within(group).getByRole("button", { name: /^Legal/ }));
    const dialog = await screen.findByRole("dialog", { name: "New domain" });
    await waitFor(() =>
      expect(within(dialog).getByRole("radio", { name: /^Legal/ })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "How domains work" }));
    const how = screen.getByRole("dialog", { name: "How domains work" });
    expect(how).toHaveTextContent("2. Ask with sources");
    fireEvent.click(within(how).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog", { name: "How domains work" })).toBeNull();
  });

  it("creates a domain from New domain and lands on its page (DM-29)", async () => {
    const created = domainItem({ name: "Support docs 2", domain_id: "d-new" });
    const calls = mockApi(routes({ "POST /api/domains": created }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New domain" }));
    const dialog = await screen.findByRole("dialog", { name: "New domain" });
    // The list's names are checked before step 2.
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "support DOCS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "You already have a domain named “support DOCS”.",
    );
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Support docs 2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip — add files later" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-new"));
    expect(screen.queryByRole("dialog", { name: "New domain" })).toBeNull();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/domains")).toBe(true);
  });
});
