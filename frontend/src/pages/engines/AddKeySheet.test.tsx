import {
  type BoundFunctions,
  fireEvent,
  type queries,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderDirectoryEntry } from "../../lib/api/engines";
import { useNavBadges } from "../../lib/workspaceStatus";
import {
  CATALOGUE,
  DIRECTORY,
  KEYS,
  RUNNER_STALE,
  SUBS,
  USAGE,
  installDesktop,
  mockEnginesApi,
  renderEngines,
  resetEnginesState,
  sub,
} from "./enginesTestUtils";
import "./engines.css";

beforeEach(() => resetEnginesState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnginesState();
});

const HF_HINT =
  "Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works.";

const directory: ProviderDirectoryEntry[] = DIRECTORY.map((d) =>
  d.provider === "huggingface"
    ? { ...d, label: "Domains BGE-small embeddings (free token)", embeddings: true, hint: HF_HINT }
    : d,
);

const CONFIG = {
  hosted_mode: true,
  provider_directory: directory,
  provider_catalogue: CATALOGUE,
  embedding_presets: [],
};

/** The API keys page with the sample data, then its header "Add key". */
async function openSheet(over: Record<string, unknown> = {}) {
  const calls = mockEnginesApi({ "GET /api/config": CONFIG, ...over });
  renderEngines("keys");
  await screen.findByRole("table");
  fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[0]);
  const dialog = screen.getByRole("dialog", { name: "Add an API key" });
  return { calls, dialog, sheet: within(dialog) };
}

type Scope = BoundFunctions<typeof queries>;

/** POST /api/providers as the server answers it: last4 of the posted key, a new key. */
const answerPost = (_u: URL, body: unknown) => {
  const b = body as { provider: string; api_key: string };
  const now = new Date().toISOString();
  return {
    provider: b.provider,
    key_last4: b.api_key.slice(-4),
    created_at: now,
    updated_at: now,
    replaced: false,
  };
};

/** Type a key into the open sheet and save it; resolves once the sheet has closed. */
async function saveWith(value: string) {
  const sheet = within(screen.getByRole("dialog"));
  fireEvent.change(sheet.getByLabelText("API key"), { target: { value } });
  fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

const providerButton = (sheet: Scope) => sheet.getByRole("button", { name: /^Provider / });

function openList(sheet: Scope) {
  fireEvent.click(providerButton(sheet));
  return within(sheet.getByRole("listbox", { name: "Providers" }));
}

function pick(sheet: Scope, provider: string) {
  const list = openList(sheet);
  fireEvent.click(list.getByRole("option", { name: new RegExp(`^${provider}`) }));
}

const optionNames = (list: Scope) =>
  list.getAllByRole("option").map((o) => o.querySelector(".eng-picker__opt-slug")?.textContent);

describe("Add key sheet: the provider picker (EnF-PickProvider-1..4, Eng-AddKeyPick)", () => {
  it("opens empty with Save enabled (OQ-4) and only the encryption note", async () => {
    const { sheet } = await openSheet();
    expect(providerButton(sheet)).toHaveAccessibleName("Provider Choose a provider");
    expect(providerButton(sheet)).toHaveAttribute("aria-expanded", "false");
    expect(sheet.getByLabelText("API key")).toHaveAttribute("type", "password");
    expect(sheet.getByLabelText("API key")).toHaveAttribute("autocomplete", "off");
    expect(sheet.getByRole("button", { name: "Save key" })).toBeEnabled();
    expect(
      sheet.getByText(
        "Saved encrypted. After you save, you’ll only see •••• and the last 4 characters.",
      ),
    ).toBeInTheDocument();
    expect(sheet.queryByText(/still runs first/)).toBeNull();
  });

  it("opens the list with the search focused, team-used first, tags, NIM plainly, Other last", async () => {
    const { sheet } = await openSheet();
    const list = openList(sheet);
    expect(providerButton(sheet)).toHaveAttribute("aria-expanded", "true");
    expect(sheet.getByRole("textbox", { name: "Search providers" })).toHaveFocus();
    expect(optionNames(list)).toEqual([
      "anthropic",
      "xai",
      "deepseek",
      "openai",
      "huggingface",
      "nvidia_nim",
      "openrouter",
    ]);
    expect(list.getByRole("option", { name: /^anthropic/ })).toHaveTextContent(
      "Anthropic models · your teams use it",
    );
    expect(list.getByRole("option", { name: /^deepseek/ })).toHaveTextContent(
      "Saved · DeepSeek models",
    );
    expect(list.getByRole("option", { name: /^nvidia_nim/ })).toHaveTextContent(
      "Saved · No agent uses NVIDIA NIM right now",
    );
    expect(list.getByRole("option", { name: /^nvidia_nim/ })).not.toHaveTextContent("models");
    expect(sheet.getByRole("button", { name: "Other: type the model prefix" })).toBeInTheDocument();
  });

  it('filters on the search ("hug" leaves huggingface + Other) and picks with Enter', async () => {
    const { sheet } = await openSheet();
    const list = openList(sheet);
    const search = sheet.getByRole("textbox", { name: "Search providers" });
    fireEvent.change(search, { target: { value: "hug" } });
    expect(optionNames(list)).toEqual(["huggingface"]);
    expect(sheet.getByRole("button", { name: "Other: type the model prefix" })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(sheet.queryByRole("listbox")).toBeNull();
    expect(providerButton(sheet)).toHaveAccessibleName("Provider huggingface");
    expect(providerButton(sheet)).toHaveFocus();
    // EnF-PickProvider-4: its own hint, with Domains bolded, and the footer.
    expect(sheet.getByText("Domains", { selector: "b" })).toBeInTheDocument();
    expect(sheet.getByText(/ingest for BGE-small embeddings/)).toBeInTheDocument();
    expect(sheet.getByText("Used by Domains ingest")).toBeInTheDocument();
  });

  it("walks the options with the arrows and closes only the list on Escape", async () => {
    const { sheet } = await openSheet();
    openList(sheet);
    const search = sheet.getByRole("textbox", { name: "Search providers" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const active = search.getAttribute("aria-activedescendant");
    expect(document.getElementById(active!)).toHaveTextContent(/^Xxai/);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    // Up from the first wraps to "Other".
    expect(
      document.getElementById(search.getAttribute("aria-activedescendant")!),
    ).toHaveTextContent("Other: type the model prefix");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sheet.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Add an API key" })).toBeInTheDocument();
    expect(providerButton(sheet)).toHaveFocus();
    // A second Escape closes the sheet.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add an API key" })).toBeNull();
  });

  it("anthropic picked: the covers hint, the Claude note (connected) and Used by (Eng-AddKey)", async () => {
    const { sheet } = await openSheet();
    pick(sheet, "anthropic");
    expect(providerButton(sheet)).toHaveAccessibleName("Provider anthropic");
    const hint = sheet.getByText(/^Covers models that start with/);
    expect(hint).toHaveTextContent(
      "Covers models that start with anthropic/, like anthropic/claude-sonnet-5.",
    );
    expect(within(hint).getByText("anthropic/", { selector: "code" })).toBeInTheDocument();
    expect(
      sheet.getByText(
        "On Tvashtr Desktop your Claude subscription still runs first. This key covers website runs, and Desktop runs if you disconnect Claude.",
      ),
    ).toBeInTheDocument();
    expect(sheet.getByText("Used by Engineer · Indicator sprint team")).toBeInTheDocument();
    // Reopening marks the pick.
    const list = openList(sheet);
    expect(list.getByRole("option", { name: /^anthropic/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("leaves the Claude note out while Claude isn't connected (Desktop reads the live status)", async () => {
    installDesktop([sub("claude", "needs_login"), SUBS[1], SUBS[2]]);
    const { sheet } = await openSheet();
    pick(sheet, "anthropic");
    await waitFor(() => expect(sheet.queryByText(/still runs first/)).toBeNull());
    expect(sheet.getByText("Used by Engineer · Indicator sprint team")).toBeInTheDocument();
  });

  it("a saved provider says the save replaces it (OQ-5)", async () => {
    const { sheet } = await openSheet();
    pick(sheet, "deepseek");
    expect(
      sheet.getByText("This replaces your saved deepseek key (•••• 7d24)."),
    ).toBeInTheDocument();
    expect(sheet.getByText("Used by Writer · Docs team")).toBeInTheDocument();
  });

  it("NVIDIA NIM picked: says the key won't run anything, no Used by", async () => {
    const { sheet } = await openSheet();
    pick(sheet, "nvidia_nim");
    expect(
      sheet.getByText("No agent uses NVIDIA NIM right now, so this key won’t run anything yet."),
    ).toBeInTheDocument();
    expect(sheet.queryByText(/^Used by/)).toBeNull();
  });
});

describe("Add key sheet: Other (EnF-OtherProvider-1/2)", () => {
  it("Other shows the Model prefix field; a slash is an error; a valid prefix is covered", async () => {
    const { sheet } = await openSheet();
    openList(sheet);
    fireEvent.click(sheet.getByRole("button", { name: "Other: type the model prefix" }));
    expect(providerButton(sheet)).toHaveAccessibleName("Provider Other provider");
    const prefix = sheet.getByLabelText("Model prefix");
    expect(prefix).toHaveFocus();
    expect(
      sheet.getByText(
        "The part before the slash in your model names, like mistral in mistral/large.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(prefix, { target: { value: "mistral/" } });
    expect(sheet.getByRole("alert")).toHaveTextContent("Just the part before the slash: mistral.");
    expect(sheet.queryByText(/^Covers mistral/)).toBeNull();
    fireEvent.change(prefix, { target: { value: "mistral" } });
    expect(sheet.queryByRole("alert")).toBeNull();
    expect(sheet.getByText("Covers mistral/… models")).toBeInTheDocument();
  });

  it("won't save a prefix with a slash", async () => {
    const { calls, sheet } = await openSheet();
    openList(sheet);
    fireEvent.click(sheet.getByRole("button", { name: "Other: type the model prefix" }));
    fireEvent.change(sheet.getByLabelText("Model prefix"), { target: { value: "mistral/" } });
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "sk-m-1234" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("saves a typed prefix lowercased", async () => {
    const saved = vi.fn(() => ({
      provider: "mistral",
      key_last4: "wQ3f",
      created_at: "2026-09-26T10:00:00+00:00",
      updated_at: "2026-09-26T10:00:00+00:00",
      replaced: false,
    }));
    const { calls, sheet } = await openSheet({ "POST /api/providers": saved });
    openList(sheet);
    fireEvent.click(sheet.getByRole("button", { name: "Other: type the model prefix" }));
    fireEvent.change(sheet.getByLabelText("Model prefix"), { target: { value: " Mistral " } });
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "sk-m-wQ3f" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      provider: "mistral",
      api_key: "sk-m-wQ3f",
    });
  });
});

describe("Add key sheet: saving (ENG-71..73)", () => {
  it("nothing filled in: the form error, the provider marked, nothing sent", async () => {
    const { calls, sheet } = await openSheet();
    fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
    expect(sheet.getByRole("alert")).toHaveTextContent("Enter a provider and an API key.");
    expect(providerButton(sheet)).toHaveClass("is-invalid");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("saves, adds the row at the top, shrinks the banner and toasts the next key (Eng-Flow-Key-1)", async () => {
    const { calls, sheet } = await openSheet({ "POST /api/providers": answerPost });
    const badges = renderHook(() => useNavBadges());
    await waitFor(() => expect(badges.result.current.apiKeys).toBe(3));
    pick(sheet, "anthropic");
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "  sk-ant-wQ3f " } });
    fireEvent.submit(sheet.getByLabelText("API key").closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      provider: "anthropic",
      api_key: "sk-ant-wQ3f",
    });
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveAttribute("data-provider", "anthropic");
    expect(within(rows[1]).getByText("Just now")).toBeInTheDocument();
    // The nav badges recount from the new key list.
    await waitFor(() => expect(badges.result.current.apiKeys).toBe(4));
    // The banner now names only the provider still missing.
    expect(screen.getByRole("note")).toHaveTextContent(
      "Your teams also use xai. Add a key to run them on the website.",
    );
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "anthropic key saved. Indicator sprint team still needs xai to run on the website.",
    );
    // Its one action opens the sheet again with xai picked.
    fireEvent.click(within(toast).getByRole("button", { name: "Add xai" }));
    const again = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(providerButton(again)).toHaveAccessibleName("Provider xai");
  });

  it("a network failure keeps the sheet open with the values and says the key wasn't saved", async () => {
    const { sheet } = await openSheet({
      "POST /api/providers": () => new Response("{}", { status: 503 }),
    });
    pick(sheet, "anthropic");
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "sk-ant-wQ3f" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "Couldn’t save that key — is the backend running? Your key wasn’t saved. Try again.",
    );
    expect(sheet.getByLabelText("API key")).toHaveValue("sk-ant-wQ3f");
    expect(providerButton(sheet)).toHaveAccessibleName("Provider anthropic");
  });

  it("a 422 shows the server's words", async () => {
    const { sheet } = await openSheet({
      "POST /api/providers": () =>
        new Response(JSON.stringify({ detail: "An API key is required." }), { status: 422 }),
    });
    pick(sheet, "anthropic");
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "x" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save key" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent("An API key is required.");
  });

  it("closing forgets the key; the next open starts empty", async () => {
    const { sheet } = await openSheet();
    pick(sheet, "anthropic");
    fireEvent.change(sheet.getByLabelText("API key"), { target: { value: "sk-ant-wQ3f" } });
    fireEvent.click(sheet.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[0]);
    const again = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(again.getByLabelText("API key")).toHaveValue("");
    expect(providerButton(again)).toHaveAccessibleName("Provider Choose a provider");
  });
});

describe("Add key sheet: opened with a provider (ENG-74, ENG-60)", () => {
  it("the banner's + xai opens it with xai picked", async () => {
    mockEnginesApi({ "GET /api/config": CONFIG });
    renderEngines("keys");
    await screen.findByRole("table");
    fireEvent.click(within(screen.getByRole("note")).getByRole("button", { name: "xai" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add an API key" }));
    expect(providerButton(sheet)).toHaveAccessibleName("Provider xai");
    expect(
      sheet.getByText("Used by Product manager, Reviewer · Indicator sprint team"),
    ).toBeInTheDocument();
  });

  it('the embeddings Add key opens "Add an embeddings key" with huggingface (OQ-19)', async () => {
    mockEnginesApi({
      "GET /api/config": CONFIG,
      "GET /api/engines/subscriptions": { subscriptions: SUBS, runner: RUNNER_STALE },
      "GET /api/providers": { providers: KEYS },
    });
    renderEngines("keys");
    await screen.findByRole("table");
    const embeddings = screen.getByRole("region", { name: "Domains embeddings" });
    fireEvent.click(within(embeddings).getByRole("button", { name: "Add key" }));
    const dialog = screen.getByRole("dialog", { name: "Add an embeddings key" });
    expect(
      within(dialog).getByText("For Domains ingest and Ask, on the website and on Desktop."),
    ).toBeInTheDocument();
    expect(providerButton(within(dialog))).toHaveAccessibleName("Provider huggingface");
  });

  it("from the banner, the toast says Add anthropic too; its action finishes the team (EnF-Suggest-1/2)", async () => {
    mockEnginesApi({ "GET /api/config": CONFIG, "POST /api/providers": answerPost });
    renderEngines("keys");
    await screen.findByRole("table");
    fireEvent.click(within(screen.getByRole("note")).getByRole("button", { name: "xai" }));
    await saveWith("xai-parity-9Kx2");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveAttribute("data-provider", "xai");
    expect(within(rows[1]).getByText("•••• 9Kx2")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Your teams also use anthropic.");
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "xai key saved. Add anthropic too, so Indicator sprint team can run on the website.",
    );
    fireEvent.click(within(toast).getByRole("button", { name: "Add anthropic" }));
    expect(providerButton(within(screen.getByRole("dialog")))).toHaveAccessibleName(
      "Provider anthropic",
    );
    await saveWith("sk-ant-wQ3f");
    // Every provider the teams use has a key now: the banner is gone.
    expect(screen.queryByRole("note")).toBeNull();
    expect(
      await screen.findByText(
        "anthropic key saved. Indicator sprint team is ready to run on the website.",
      ),
    ).toBeInTheDocument();
  });

  it("an embeddings key: the section shows it and the toast opens Domains (EnF-Embeddings-2, OQ-7)", async () => {
    mockEnginesApi({ "GET /api/config": CONFIG, "POST /api/providers": answerPost });
    renderEngines("keys");
    await screen.findByRole("table");
    const embeddings = screen.getByRole("region", { name: "Domains embeddings" });
    fireEvent.click(within(embeddings).getByRole("button", { name: "Add key" }));
    await saveWith("hf_parity_f0Tk");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveAttribute("data-provider", "huggingface");
    expect(within(rows[1]).getByText("Domains ingest")).toBeInTheDocument();
    expect(within(embeddings).getByText("huggingface •••• f0Tk")).toBeInTheDocument();
    expect(within(embeddings).queryByRole("button", { name: "Add key" })).toBeNull();
    // No domain exists, so nothing can ingest yet: only that Domains can use the key.
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "huggingface key saved. Domains can use Hugging Face embeddings now.",
    );
    fireEvent.click(within(toast).getByRole("button", { name: "Open Domains" }));
    expect(window.location.hash).toBe("#/domains");
  });

  it("with a domain on huggingface, the toast says Domains can ingest now", async () => {
    mockEnginesApi({
      "GET /api/config": CONFIG,
      "POST /api/providers": answerPost,
      "GET /api/engines/usage": {
        ...USAGE,
        domains: [
          {
            domain_id: "d1",
            name: "Handbook",
            embedding_model: "huggingface/BAAI/bge-small-en-v1.5",
            embedding_provider: "huggingface",
            generation_model: null,
            generation_provider: null,
          },
        ],
      },
    });
    renderEngines("keys");
    await screen.findByRole("table");
    const embeddings = screen.getByRole("region", { name: "Domains embeddings" });
    fireEvent.click(within(embeddings).getByRole("button", { name: "Add key" }));
    await saveWith("hf_parity_f0Tk");
    expect(
      await screen.findByText("huggingface key saved. Domains can ingest documents now."),
    ).toBeInTheDocument();
  });
});
