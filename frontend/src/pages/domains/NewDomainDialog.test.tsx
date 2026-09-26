import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetHomeConfigForTests } from "../../lib/api/home";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetHomeDataForTests } from "../home/homeData";
import { NewDomainDialog } from "./NewDomainDialog";
import { detailView, domainItem, mockApi } from "./domainsTestUtils";

const TEMPLATES = {
  templates: [
    ["support", "Support", "Help center and product docs", 600],
    ["legal", "Legal", "Contracts and policies · precise sources", 500],
    ["financial", "Financial", "Filings, metrics, investor docs", 700],
    ["scientific", "Scientific", "Papers and methods · more context", 1000],
    ["blank", "Blank", "Start from defaults and tune it yourself", 800],
  ].map(([template, name, description, size]) => ({
    template,
    name,
    description,
    short: description,
    piece_size: size,
    overlap: 100,
  })),
};

const OPENAI = { providers: [{ provider: "openai", key_last4: "4f2a" }] };
const CREATED = detailView(domainItem({ name: "Support docs", domain_id: "new-1" }));

function routes(over: Record<string, unknown> = {}) {
  return {
    "GET /api/domain-templates": TEMPLATES,
    "GET /api/providers": OPENAI,
    "GET /api/config": { provider_directory: [] },
    "POST /api/domains": CREATED,
    "POST /api/domains/:id/documents": { document_id: "doc-1" },
    ...over,
  };
}

function renderDialog(props: Partial<Parameters<typeof NewDomainDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <NewDomainDialog
        open
        existingNames={["Vendor contracts"]}
        onClose={onClose}
        onCreated={onCreated}
        {...props}
      />
    </ToastProvider>,
  );
  return { onCreated, onClose, dialog: screen.getByRole("dialog", { name: "New domain" }) };
}

function typeName(dialog: HTMLElement, name: string) {
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: name } });
}

function file(name: string, bytes: number, type = "text/markdown"): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

function pickFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="new-domain-files"]');
  if (!input) throw new Error("no file input");
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetHomeConfigForTests();
  __resetHomeDataForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("New domain · step 1 (Dm-NewDialog, DmF-First-2)", () => {
  it("names it and picks one of five starting points, Support by default", async () => {
    mockApi(routes());
    const { dialog } = renderDialog();
    expect(dialog).toHaveTextContent("Step 1 of 2 · Name it and pick what kind of files it holds");
    expect(within(dialog).getByLabelText("Name")).toHaveFocus();
    const group = within(dialog).getByRole("radiogroup", { name: "Starting point" });
    await waitFor(() => expect(within(group).getAllByRole("radio")).toHaveLength(5));
    const support = within(group).getByRole("radio", { name: /^Support/ });
    expect(support).toHaveAttribute("aria-checked", "true");
    expect(support).toHaveTextContent("Help center and product docs600-character pieces");
    expect(within(group).getByRole("radio", { name: /^Scientific/ })).toHaveTextContent(
      "1,000-character pieces",
    );
    fireEvent.click(within(group).getByRole("radio", { name: /^Legal/ }));
    expect(within(group).getByRole("radio", { name: /^Legal/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Arrow keys move the choice.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: /^Financial/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens with the template a starting-point card picked (DM-19)", async () => {
    mockApi(routes());
    const { dialog } = renderDialog({ initialTemplate: "scientific" });
    await waitFor(() =>
      expect(within(dialog).getByRole("radio", { name: /^Scientific/ })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("shows the reading model with its key saved, and Change swaps in the model list", async () => {
    mockApi(routes());
    const { dialog } = renderDialog();
    await within(dialog).findByText("key saved");
    expect(dialog).toHaveTextContent("Files are read with OpenAI text-embedding-3-small");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change" }));
    const list = within(dialog).getByRole("listbox", { name: "Reading model" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "OpenAI text-embedding-3-small1536 · defaultkey saved",
      "OpenAI text-embedding-ada-0021536 · olderkey saved",
      "OpenRouter text-embedding-3-small1536 · billed via OpenRouterNo openrouter key",
      "Gemini embedding-001768 · Google AI StudioNo gemini key",
      "Hugging Face BGE-small (free)384 · rate-limited, for testingNo huggingface token",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(options[2]);
    expect(within(dialog).queryByRole("listbox")).toBeNull();
    expect(dialog).toHaveTextContent(
      "No openrouter key yet. Files are read with OpenRouter text-embedding-3-small, which needs one.",
    );
  });

  it("warns when there is no key for the reading model (DmF-NoKey-1) — and doesn't block", async () => {
    mockApi(routes({ "GET /api/providers": { providers: [] } }));
    const { dialog } = renderDialog();
    await within(dialog).findByRole("button", { name: "Add openai key" });
    expect(dialog).toHaveTextContent(
      "No openai key yet. Files are read with OpenAI text-embedding-3-small, which needs one. You can create the domain now, but files wait until a key is added.",
    );
    expect(within(dialog).queryByText("key saved")).toBeNull();
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(dialog).toHaveTextContent("Step 2 of 2 · Add files to Support docs");
    expect(dialog).toHaveTextContent("Files are saved now and read once you add an openai key.");
  });

  it("adds the key in the Add an API key sheet, then shows it saved (DmF-NoKey-2/3)", async () => {
    let saved = false;
    const calls = mockApi(
      routes({
        "GET /api/providers": () => (saved ? OPENAI : { providers: [] }),
        "POST /api/providers": () => {
          saved = true;
          return { provider: "openai", key_last4: "4f2a" };
        },
      }),
    );
    const { dialog } = renderDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Add openai key" }));
    const sheet = screen.getByRole("dialog", { name: "Add an API key" });
    expect(sheet).toHaveTextContent("So Domains can read files with OpenAI text-embedding-3-small");
    expect(sheet).toHaveTextContent(
      "Covers models that start with openai/, like openai/text-embedding-3-small.",
    );
    expect(sheet).toHaveTextContent("Used by Domains · reading files");
    fireEvent.change(within(sheet).getByLabelText("API key"), {
      target: { value: "sk-proj-test" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add an API key" })).toBeNull(),
    );
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/providers",
      body: { provider: "openai", api_key: "sk-proj-test" },
    });
    await within(dialog).findByText("key saved");
    expect(within(dialog).queryByRole("button", { name: "Add openai key" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("openai key saved");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Next: add files" })).toHaveFocus(),
    );
  });

  it("switches to the free Hugging Face model, which still needs a token (DmF-NoKey-4, OQ-9)", async () => {
    const calls = mockApi(routes({ "GET /api/providers": { providers: [] } }));
    const { dialog, onCreated } = renderDialog();
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Use the free Hugging Face model" }),
    );
    expect(dialog).toHaveTextContent(
      "No huggingface token yet. Hugging Face BGE-small is free, but it needs a free token from huggingface.co. You can create the domain now, but files wait until a token is added.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Add huggingface token" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Use the free Hugging Face model" }),
    ).toBeNull();
    typeName(dialog, "Free reads");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip — add files later" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/domains")?.body).toEqual({
      name: "Free reads",
      template: "support",
      embedding_model: "huggingface/BAAI/bge-small-en-v1.5",
    });
  });

  it("checks the name before step 2 (DM-27)", () => {
    mockApi(routes());
    const { dialog } = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Give this domain a name.");
    typeName(dialog, "  vendor CONTRACTS ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "You already have a domain named “vendor CONTRACTS”.",
    );
    typeName(dialog, "x".repeat(121));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Use 120 characters or fewer.");
    expect(dialog).toHaveTextContent("Step 1 of 2");
  });
});

describe("New domain · step 2 (DmF-First-3)", () => {
  it("lists picked files, refuses the ones it can't read, and counts the rest", async () => {
    mockApi(routes());
    const { dialog } = renderDialog();
    await within(dialog).findByText("key saved");
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(dialog).toHaveTextContent("Step 2 of 2 · Add files to Support docs");
    expect(dialog).toHaveTextContent(
      "PDF, Markdown, text or HTML · up to 10 MB each · as many as you like",
    );
    expect(dialog).toHaveTextContent(
      "Reading starts as soon as the domain is created. It takes about a minute for small files.",
    );
    const create = () => within(dialog).getByRole("button", { name: /^Create and read/ });
    expect(create()).toHaveTextContent("Create and read 0 files");
    expect(create()).toBeDisabled();

    pickFiles([
      file("refund-policy.md", 18 * 1024),
      file("billing-faq.pdf", 1.2 * 1024 * 1024, "application/pdf"),
      file("getting-started.md", 24 * 1024),
      file("huge.pdf", 11 * 1024 * 1024, "application/pdf"),
      file("slides.pptx", 2048),
    ]);
    const list = within(dialog).getByRole("list", { name: "Files to add" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "MDrefund-policy.md18 KB",
      "PDFbilling-faq.pdf1.2 MB",
      "MDgetting-started.md24 KB",
      "PDFhuge.pdfOver 10 MB.11.0 MB",
      "TXTslides.pptxOnly PDF, Markdown, text or HTML.2 KB",
    ]);
    expect(create()).toHaveTextContent("Create and read 3 files");
    expect(create()).toBeEnabled();
    fireEvent.click(within(list).getByRole("button", { name: "Remove getting-started.md" }));
    expect(create()).toHaveTextContent("Create and read 2 files");
    fireEvent.click(within(list).getByRole("button", { name: "Remove refund-policy.md" }));
    expect(create()).toHaveTextContent("Create and read 1 file");

    // Back keeps what was typed and picked.
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  });

  it("creates the domain, uploads the readable files one by one, then lands on it (DM-29)", async () => {
    const calls = mockApi(routes());
    const { dialog, onCreated } = renderDialog({ initialTemplate: "legal" });
    await within(dialog).findByText("key saved");
    typeName(dialog, " Support docs ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    pickFiles([file("refund-policy.md", 18 * 1024), file("notes.docx", 100)]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and read 1 file" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.path)).toEqual(["/api/domains", "/api/domains/new-1/documents"]);
    // The default reading model isn't sent: the template's default stays.
    expect(posts[0].body).toEqual({ name: "Support docs", template: "legal" });
  });

  it("drops files on the zone", () => {
    mockApi(routes());
    const { dialog } = renderDialog();
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    const zone = within(dialog).getByText(/^Drop files here, or/).parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file("faq.md", 2048)], types: ["Files"] } });
    expect(within(dialog).getByRole("list", { name: "Files to add" })).toHaveTextContent(
      "MDfaq.md2 KB",
    );
  });

  it("goes back to the name when the server finds a clash", async () => {
    mockApi(
      routes({
        "POST /api/domains": () =>
          new Response(
            JSON.stringify({ detail: "You already have a domain named “Support docs”." }),
            {
              status: 409,
            },
          ),
      }),
    );
    const { dialog, onCreated } = renderDialog();
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip — add files later" }));
    await within(dialog).findByText("You already have a domain named “Support docs”.");
    expect(dialog).toHaveTextContent("Step 1 of 2");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the create fails", async () => {
    mockApi(
      routes({
        "POST /api/domains": () => new Response("{}", { status: 500 }),
      }),
    );
    const { dialog, onCreated } = renderDialog();
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip — add files later" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t create the domain — is the backend running?",
    );
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => Promise.resolve());
  });

  it("says which uploads failed and still lands on the new domain", async () => {
    mockApi(
      routes({
        "POST /api/domains/:id/documents": () => new Response("{}", { status: 500 }),
      }),
    );
    const { dialog, onCreated } = renderDialog();
    await within(dialog).findByText("key saved");
    typeName(dialog, "Support docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next: add files" }));
    pickFiles([file("refund-policy.md", 18 * 1024)]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and read 1 file" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t add refund-policy.md. Add it again from Sources.",
    );
  });
});
