import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderCatalogueEntry } from "../../lib/api";
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";
import type { CredentialCover } from "./modelCopy";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";

const entry = (
  provider: string,
  models: string[],
  extra: Partial<ProviderCatalogueEntry> = {},
): ProviderCatalogueEntry => ({
  provider,
  thinker_default: models[0] ?? null,
  worker_default: models[0] ?? null,
  thinker_presets: models,
  worker_presets: models,
  label: provider,
  subscription: null,
  byok_probed: true,
  ...extra,
});

const CATALOGUE = [
  entry("nvidia_nim", [], { label: "NVIDIA NIM" }),
  entry("anthropic", ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"], {
    label: "Anthropic",
    subscription: "claude",
    byok_probed: false,
  }),
  entry("xai", ["xai/grok-4.7"], { label: "xAI", subscription: "grok", byok_probed: false }),
  entry("openai", ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"], { label: "OpenAI" }),
  entry("gemini", ["gemini/gemini-2.5-flash"], { label: "Gemini" }),
];

const cover = (keys: string[], subs: CredentialCover["subs"] = {}): CredentialCover => ({
  byok: new Set(keys),
  subs,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ provider: "gemini", key_last4: "9Q4k" }), { status: 200 }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPicker(over: Partial<ModelPickerProps> = {}) {
  const props: ModelPickerProps = {
    model: "xai/grok-4.7",
    onPick: vi.fn(),
    emptyLabel: "Choose a model",
    label: "Choose a model",
    catalogue: CATALOGUE,
    seat: "worker",
    cover: cover(["openai", "nvidia_nim"], { grok: true, claude: true }),
    desktop: true,
    onKeySaved: vi.fn(),
    onAddProvider: vi.fn(),
    ...over,
  };
  render(<ModelPicker {...props} />);
  return props;
}

const open = (name = "grok-4.7") => {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("listbox", { name: /^Choose a/ });
};
const group = (list: HTMLElement, provider: string) =>
  within(list).getByRole("group", { name: new RegExp(`^${provider}\\b`) });

describe("ModelPicker (Desktop-ModelPicker / Flow-Model)", () => {
  it("opens a listbox of the seat's models, grouped by provider with how each one runs", () => {
    renderPicker();
    const button = screen.getByRole("button", { name: "grok-4.7" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const list = open();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getByRole("textbox", { name: "Search models" })).toHaveFocus();
    expect(
      within(list).getByText("Only models proven to run a full build are listed."),
    ).toBeTruthy();

    expect(within(list).getAllByRole("group")).toHaveLength(4);
    expect(within(group(list, "xai")).getByText("Grok subscription · this computer")).toBeTruthy();
    expect(
      within(group(list, "anthropic")).getByText("Claude subscription · this computer"),
    ).toBeTruthy();
    expect(within(group(list, "openai")).getByText("API key")).toBeTruthy();
    expect(within(group(list, "gemini")).getByText("No key yet")).toBeTruthy();
    // NIM serves no seat: it is never offered, even though the account holds its key.
    expect(within(list).queryByText("nvidia_nim")).toBeNull();

    const selected = within(list).getByRole("option", { name: "grok-4.7" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(within(list).getByRole("option", { name: "gpt-4o-mini" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // A provider with no key yet offers its key field instead of its models.
    expect(within(list).queryByRole("option", { name: "gemini-2.5-flash" })).toBeNull();
    expect(
      within(group(list, "gemini")).getByLabelText("Paste your Gemini API key"),
    ).toHaveAttribute("type", "password");
  });

  it("picks a model and closes", () => {
    const props = renderPicker();
    const list = open();
    fireEvent.click(within(list).getByRole("option", { name: "claude-sonnet-4" }));
    expect(props.onPick).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searches providers and models", () => {
    renderPicker();
    const list = open();
    fireEvent.change(within(list).getByRole("textbox", { name: "Search models" }), {
      target: { value: "sonnet-5" },
    });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["claude-sonnet-5"]);
    fireEvent.change(within(list).getByRole("textbox", { name: "Search models" }), {
      target: { value: "zzz" },
    });
    expect(within(list).getByText("No models match “zzz”.")).toBeTruthy();
  });

  it("walks the models with the arrow keys, picks with Enter and closes on Escape", () => {
    const props = renderPicker();
    const list = open();
    const search = within(list).getByRole("textbox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(within(list).getByRole("option", { name: "grok-4.7" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(within(list).getByRole("option", { name: "claude-sonnet-5" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(within(list).getByRole("option", { name: "gpt-4o-mini" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "grok-4.7" })).toHaveFocus();
    expect(props.onPick).not.toHaveBeenCalled();

    // Enter in the search picks the first match.
    const again = open();
    const box = within(again).getByRole("textbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "4.1" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("openai/gpt-4.1-mini");
  });

  it("saves a pasted key to the account, then lands on that provider's model (Flow-Model-2/3)", async () => {
    const props = renderPicker();
    const list = open();
    const gemini = group(list, "gemini");
    fireEvent.change(within(gemini).getByLabelText("Paste your Gemini API key"), {
      target: { value: "AIza-secret" },
    });
    fireEvent.click(within(gemini).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/providers",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as unknown;
    expect(body).toEqual({ provider: "gemini", api_key: "AIza-secret" });
    expect(props.onKeySaved).toHaveBeenCalledWith(expect.objectContaining({ provider: "gemini" }));
    expect(props.onPick).toHaveBeenCalledWith("gemini/gemini-2.5-flash");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when the key can't be saved, and keeps the picker open", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 500 })));
    const props = renderPicker();
    const list = open();
    const gemini = group(list, "gemini");
    fireEvent.change(within(gemini).getByLabelText("Paste your Gemini API key"), {
      target: { value: "bad" },
    });
    fireEvent.keyDown(within(gemini).getByLabelText("Paste your Gemini API key"), {
      key: "Enter",
    });
    expect(await within(gemini).findByRole("alert")).toHaveTextContent(
      "Couldn’t save that key. Try again.",
    );
    expect(props.onKeySaved).not.toHaveBeenCalled();
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("doesn't send an empty key", () => {
    renderPicker();
    const list = open();
    fireEvent.click(within(group(list, "gemini")).getByRole("button", { name: "Add" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a custom model ID as provider/model", () => {
    const props = renderPicker();
    const list = open();
    fireEvent.click(within(list).getByRole("button", { name: "Use a custom model ID" }));
    const field = within(list).getByRole("textbox", { name: "Custom model ID" });
    fireEvent.change(field, { target: { value: "gpt-4o" } });
    fireEvent.click(within(list).getByRole("button", { name: "Use this model" }));
    expect(within(list).getByRole("alert")).toHaveTextContent(
      "Use provider/model, for example openai/gpt-4.1-mini.",
    );
    expect(props.onPick).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "openai/gpt-4o-mni" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("openai/gpt-4o-mni");
  });

  it("sends 'Add a provider' to Engines", () => {
    const props = renderPicker();
    const list = open();
    fireEvent.click(within(list).getByRole("button", { name: "Add a provider" }));
    expect(props.onAddProvider).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("ModelPicker on the website (Panel-ModelWeb)", () => {
  it("offers Claude and Grok models on a key, and points at Tvashtr Desktop for the subscription", () => {
    renderPicker({ desktop: false, cover: cover(["xai", "openai"], { grok: true }) });
    const list = open();
    // Subscriptions never run agents on the website: xai runs on its key.
    expect(within(group(list, "xai")).getByText("API key")).toBeTruthy();
    const anthropic = group(list, "anthropic");
    expect(within(anthropic).getByText("No key yet")).toBeTruthy();
    expect(anthropic).toHaveTextContent(
      "Your Claude or Grok subscription can run agents in Tvashtr Desktop. On the website, add an API key.",
    );
    expect(within(anthropic).getByRole("link", { name: "Tvashtr Desktop" })).toHaveAttribute(
      "href",
      DESKTOP_MAC_DMG_URL,
    );
    expect(within(anthropic).getByLabelText("Paste your Anthropic API key")).toBeTruthy();
    // Gemini has no subscription: just the key field.
    expect(within(group(list, "gemini")).queryByRole("link")).toBeNull();
    // Honest note: Claude and Grok models were proven on their subscriptions, not on a key.
    expect(
      within(list).getByText(
        "Proven to run a full build, except xAI and Anthropic models on an API key.",
      ),
    ).toBeTruthy();
  });
});

describe("ModelPicker for the backup model", () => {
  it("offers None and shows a custom slug whole, without a provider tile", () => {
    const props = renderPicker({
      model: "openai/gpt-4o-mni",
      emptyLabel: "None",
      label: "Choose a backup model",
      allowNone: true,
    });
    const list = open("openai/gpt-4o-mni");
    expect(list).toHaveAccessibleName("Choose a backup model");
    const none = within(list).getByRole("option", { name: "None" });
    expect(none).toHaveAttribute("aria-selected", "false");
    fireEvent.click(none);
    expect(props.onPick).toHaveBeenCalledWith("");
  });

  it("reads None when nothing is set", () => {
    renderPicker({
      model: "",
      emptyLabel: "None",
      label: "Choose a backup model",
      allowNone: true,
    });
    const list = open("None");
    expect(within(list).getByRole("option", { name: "None" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
