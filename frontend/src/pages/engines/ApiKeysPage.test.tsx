import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { useNavBadges } from "../../lib/workspaceStatus";
import { ApiKeysPage } from "./ApiKeysPage";
import { EnginesDataProvider } from "./enginesData";
import {
  KEYS,
  installDesktop,
  key,
  mockEnginesApi,
  renderEngines,
  resetEnginesState,
} from "./enginesTestUtils";
import "./engines.css";

beforeEach(() => resetEnginesState());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetEnginesState();
});

function renderKeys() {
  const onAddKey = vi.fn();
  render(
    <ToastProvider>
      <EnginesDataProvider>
        <ApiKeysPage onAddKey={onAddKey} />
      </EnginesDataProvider>
    </ToastProvider>,
  );
  return onAddKey;
}

const table = () => screen.getByRole("table");
const row = (provider: string) =>
  within(table())
    .getAllByRole("row")
    .find((r) => r.getAttribute("data-provider") === provider)!;
const loaded = () => screen.findByRole("table");

function openMenu(provider: string) {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${provider}` }));
  return within(screen.getByRole("menu", { name: `More actions for ${provider}` }));
}

describe("API keys page (Eng-Keys)", () => {
  it("shows the lede, the banner, the keys newest first and the embeddings suggestion", async () => {
    mockEnginesApi();
    const onAddKey = renderKeys();
    await loaded();

    const page = screen.getByRole("region", { name: "API keys" });
    expect(within(page).getByRole("heading", { level: 1, name: "API keys" })).toBeInTheDocument();
    expect(
      screen.getByText(/We only ever show the last 4 characters\. Keys work on the website/),
    ).toBeInTheDocument();

    // e2e hook: each saved provider, newest first.
    expect(
      within(page)
        .getAllByTestId("engines-key-provider")
        .map((el) => el.textContent),
    ).toEqual(["deepseek", "nvidia_nim", "openrouter"]);
    const deepseek = within(row("deepseek"));
    expect(deepseek.getByText("•••• 7d24")).toBeInTheDocument();
    expect(deepseek.getByText("Desktop · Website")).toBeInTheDocument();
    expect(deepseek.getByText("Writer · Docs team")).toBeInTheDocument();
    expect(deepseek.getByText("Sep 12")).toBeInTheDocument();
    // NVIDIA NIM serves no seat: said plainly (area rule).
    expect(
      within(row("nvidia_nim")).getByText("No agent uses NVIDIA NIM right now."),
    ).toBeInTheDocument();
    expect(within(row("openrouter")).getByText("Not used by any team")).toBeInTheDocument();
    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Provider", "Key", "Works on", "Used by", "Added", "Actions"]);

    const banner = screen.getByRole("note");
    expect(banner).toHaveTextContent(
      "Your teams also use anthropic and xai. Add keys to run them on the website.",
    );
    fireEvent.click(within(banner).getByRole("button", { name: "xai" }));
    expect(onAddKey).toHaveBeenLastCalledWith("xai");

    // The header's Add key comes first (the embeddings section has its own).
    fireEvent.click(within(page).getAllByRole("button", { name: "Add key" })[0]);
    expect(onAddKey).toHaveBeenLastCalledWith();

    const embeddings = screen.getByRole("region", { name: "Domains embeddings" });
    expect(within(embeddings).getByText("huggingface not added")).toBeInTheDocument();
    fireEvent.click(within(embeddings).getByRole("button", { name: "Add key" }));
    expect(onAddKey).toHaveBeenLastCalledWith("huggingface", { embeddings: true });
  });

  it("says one provider in the singular", async () => {
    mockEnginesApi({
      "GET /api/providers": { providers: [...KEYS, key("anthropic", "wQ3f", "2026-09-26")] },
    });
    renderKeys();
    await loaded();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Your teams also use xai. Add a key to run them on the website.",
    );
    expect(within(screen.getByRole("note")).getAllByRole("button")).toHaveLength(1);
  });

  it("hides the banner when every provider the teams use has a key", async () => {
    mockEnginesApi({
      "GET /api/providers": {
        providers: [...KEYS, key("anthropic", "wQ3f"), key("xai", "x41x")],
      },
    });
    renderKeys();
    await loaded();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows a saved embeddings key with no button", async () => {
    mockEnginesApi({
      "GET /api/providers": { providers: [...KEYS, key("huggingface", "f0Tk")] },
    });
    renderKeys();
    await loaded();
    const embeddings = screen.getByRole("region", { name: "Domains embeddings" });
    expect(within(embeddings).getByText("huggingface •••• f0Tk")).toBeInTheDocument();
    expect(within(embeddings).queryByRole("button")).toBeNull();
  });

  it("turns Just now into the date after a minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-26T12:00:00+00:00"));
    const fresh = { ...key("anthropic", "wQ3f"), updated_at: "2026-09-26T11:59:40+00:00" };
    mockEnginesApi({ "GET /api/providers": { providers: [...KEYS, fresh] } });
    renderKeys();
    await loaded();
    expect(within(row("anthropic")).getByText("Just now")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(row("anthropic")).getByText("Sep 26")).toBeInTheDocument();
  });

  it("reads the same on Tvashtr Desktop", async () => {
    mockEnginesApi();
    installDesktop();
    renderEngines("keys");
    await loaded();
    expect(screen.getByRole("region", { name: "API keys" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Add keys to run them on the website.");
  });

  it("says so when the keys can't load, and retries", async () => {
    let fail = true;
    mockEnginesApi({
      "GET /api/providers": () =>
        fail ? new Response("{}", { status: 500 }) : { providers: KEYS },
    });
    renderKeys();
    expect(
      await screen.findByText("Couldn’t load your engines — is the backend running?"),
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await loaded();
  });
});

describe("the ⋯ menu and where a key is used (EnF-KeyUsed-1/2)", () => {
  it("offers Replace, See where it’s used and Remove", async () => {
    mockEnginesApi();
    renderKeys();
    await loaded();
    const menu = openMenu("deepseek");
    expect(menu.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Replace key",
      "See where it’s used",
      "Remove key",
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists each agent with an Open link to its node on the canvas", async () => {
    mockEnginesApi();
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "See where it’s used" }));
    const pop = within(screen.getByRole("dialog", { name: "Where the deepseek key is used" }));
    expect(pop.getByText("deepseek is used by")).toBeInTheDocument();
    expect(pop.getByText("Writer")).toBeInTheDocument();
    expect(pop.getByText("Docs team · deepseek/deepseek-chat")).toBeInTheDocument();
    expect(pop.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "#/teams/t-docs?node=n-writer",
    );
    expect(pop.getByText("Works for website runs and Desktop runs.")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when nothing uses the key", async () => {
    mockEnginesApi();
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("openrouter").getByRole("menuitem", { name: "See where it’s used" }));
    const pop = within(screen.getByRole("dialog", { name: "Where the openrouter key is used" }));
    expect(pop.getByText("No team uses openrouter yet.")).toBeInTheDocument();
  });
});

describe("Replace (Eng-Flow-Key-4, EnF-KeyUsed-3/4)", () => {
  it("asks for the new key, then updates the row and says who uses it", async () => {
    const calls = mockEnginesApi({
      "POST /api/providers": {
        provider: "deepseek",
        key_last4: "Qm81",
        created_at: "2026-09-12T08:00:00+00:00",
        updated_at: new Date().toISOString(),
        replaced: true,
      },
    });
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Replace key" }));
    const dialog = within(screen.getByRole("alertdialog", { name: "Replace the deepseek key" }));
    expect(
      dialog.getByText(
        "The old key is deleted when you save. Writer uses the new one on its next run.",
      ),
    ).toBeInTheDocument();
    const input = dialog.getByLabelText<HTMLInputElement>("New key");
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("Paste the new key");

    fireEvent.click(dialog.getByRole("button", { name: "Replace key" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Paste the new key.");
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(input, { target: { value: "sk-new-Qm81" } });
    fireEvent.click(dialog.getByRole("button", { name: "Replace key" }));
    expect(
      await screen.findByText("deepseek key replaced. Writer uses it on its next run."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      provider: "deepseek",
      api_key: "sk-new-Qm81",
    });
    const deepseek = within(row("deepseek"));
    expect(deepseek.getByText("•••• Qm81")).toBeInTheDocument();
    expect(deepseek.getByText("Just now")).toBeInTheDocument();
    // The secret is never shown.
    expect(screen.queryByText(/sk-new-Qm81/)).toBeNull();
  });

  it("keeps the dialog and the value on a server error", async () => {
    mockEnginesApi({
      "POST /api/providers": () =>
        new Response(JSON.stringify({ detail: "An API key is required." }), { status: 422 }),
    });
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Replace key" }));
    const dialog = within(screen.getByRole("alertdialog"));
    const input = dialog.getByLabelText<HTMLInputElement>("New key");
    fireEvent.change(input, { target: { value: "sk-x" } });
    fireEvent.click(dialog.getByRole("button", { name: "Replace key" }));
    expect(await dialog.findByText("An API key is required.")).toBeInTheDocument();
    expect(input.value).toBe("sk-x");
  });

  it("says the key wasn't saved when the backend is unreachable", async () => {
    mockEnginesApi({
      "POST /api/providers": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Replace key" }));
    const dialog = within(screen.getByRole("alertdialog"));
    fireEvent.change(dialog.getByLabelText("New key"), { target: { value: "sk-x" } });
    fireEvent.click(dialog.getByRole("button", { name: "Replace key" }));
    expect(
      await dialog.findByText(
        "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Remove (Eng-Flow-Key-3)", () => {
  it("states the impact, removes the key, and recounts the badges", async () => {
    const calls = mockEnginesApi({
      "GET /api/teams": { teams: [] },
      "DELETE /api/providers/deepseek": () => new Response(null, { status: 204 }),
    });
    renderKeys();
    await loaded();
    const badges = renderHook(() => useNavBadges());
    await waitFor(() => expect(badges.result.current.apiKeys).toBe(3));

    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Remove key" }));
    const dialog = within(screen.getByRole("alertdialog", { name: "Remove the deepseek key?" }));
    expect(
      dialog.getByText(
        "Writer in Docs team uses deepseek. Docs team can’t run on the website, or on Desktop, until you add a key again. You can’t undo this.",
      ),
    ).toBeInTheDocument();
    const confirm = dialog.getByRole("button", { name: "Remove key" });
    expect(confirm).toHaveClass("ds-btn--danger");
    fireEvent.click(confirm);

    expect(await screen.findByText("deepseek key removed.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(row("deepseek")).toBeUndefined();
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/providers/deepseek")).toBe(
      true,
    );
    await waitFor(() => expect(badges.result.current.apiKeys).toBe(2));
    // Docs team can no longer run anywhere: two more pairs to fix.
    expect(badges.result.current.enginesToFix).toBe(4);
  });

  it("warns that a run in progress will fail (OQ-21)", async () => {
    mockEnginesApi({
      "GET /api/teams": {
        teams: [{ team_graph_id: "t-docs", name: "Docs team", active_run_count: 1 }],
      },
    });
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Remove key" }));
    const dialog = within(screen.getByRole("alertdialog"));
    expect(
      await dialog.findByText(
        "A run of Docs team is in progress and will fail at its next deepseek step.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the key when the removal fails, and Cancel closes", async () => {
    mockEnginesApi({
      "GET /api/teams": { teams: [] },
      "DELETE /api/providers/deepseek": () => new Response("{}", { status: 500 }),
    });
    renderKeys();
    await loaded();
    fireEvent.click(openMenu("deepseek").getByRole("menuitem", { name: "Remove key" }));
    const dialog = within(screen.getByRole("alertdialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Remove key" }));
    expect(
      await dialog.findByText(
        "Couldn’t remove that key — is the backend running? The key is still saved. Try again.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(row("deepseek")).toBeDefined();
    await act(async () => {});
  });
});
