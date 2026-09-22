import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DomainConfigForm } from "./DomainConfigForm";

const sample = {
  chunking: { strategy: "fixed", size: 800, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: { top_k: 8, mode: "dense" },
  generation: { model: null },
};

describe("DomainConfigForm", () => {
  it("edits top_k via form and saves", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    // Exact label — /top k/i also hits the rerank hint ("…cutting to Top K").
    const topK = screen.getByLabelText("Top K");
    await user.clear(topK);
    await user.type(topK, "5");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.top_k).toBe(5);
  });

  it("selects hybrid mode and rerank knobs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const mode = screen.getByLabelText(/retrieval mode/i);
    expect(mode.tagName).toBe("SELECT");
    await user.selectOptions(mode, "hybrid");
    await user.click(screen.getByLabelText(/rerank enabled/i));
    const topN = screen.getByLabelText(/rerank top n/i);
    await user.clear(topN);
    await user.type(topN, "16");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.mode).toBe("hybrid");
    expect(arg.retrieval.rerank.enabled).toBe(true);
    expect(arg.retrieval.rerank.top_n).toBe(16);
    expect(arg.retrieval.rerank.model).toBeNull();
  });

  it("rejects invalid JSON in raw mode", async () => {
    const user = userEvent.setup();
    render(<DomainConfigForm initial={sample} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Raw JSON/i }));
    const area = screen.getByLabelText(/config json/i);
    await user.clear(area);
    await user.type(area, "{{not-json");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("toggles graph-lite mention expansion into saved config", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <DomainConfigForm
        initial={{
          ...sample,
          retrieval: { ...sample.retrieval, graph: { enabled: false } },
        }}
        onSave={onSave}
      />,
    );
    const box = screen.getByRole("checkbox", { name: /Graph-lite mention expansion/i });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const saved = onSave.mock.calls[0][0];
    expect(saved.retrieval.graph.enabled).toBe(true);
  });

  it("graph-lite hint points operators to Eval tab (#7)", () => {
    render(<DomainConfigForm initial={sample} onSave={vi.fn()} />);
    const box = screen.getByRole("checkbox", { name: /Graph-lite mention expansion/i });
    const label = box.closest("label");
    expect(label?.textContent).toMatch(/Eval/i);
    expect(label?.textContent).toMatch(/mention|neighbor|chunk/i);
  });

  it("picks OpenRouter embedding preset and saves the slug", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const emb = screen.getByLabelText("Embedding model");
    expect(emb.tagName).toBe("SELECT");
    await user.selectOptions(emb, "openrouter/openai/text-embedding-3-small");
    expect(screen.getAllByText(/Dashboard → Engines/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.embedding.model).toBe("openrouter/openai/text-embedding-3-small");
    confirmSpy.mockRestore();
  });

  it("picks Gemini embedding preset showing 768-dim and saves the slug", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const emb = screen.getByLabelText("Embedding model");
    expect(emb.tagName).toBe("SELECT");
    await user.selectOptions(emb, "gemini/gemini-embedding-001");
    expect(emb).toHaveValue("gemini/gemini-embedding-001");
    expect(screen.getByText(/needs a/i)).toBeTruthy();
    expect(screen.getAllByText(/Dashboard → Engines/i).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.embedding.model).toBe("gemini/gemini-embedding-001");
    confirmSpy.mockRestore();
  });

  it("picks Groq generation preset and saves the slug", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const gen = screen.getByLabelText("Generation model");
    expect(gen.tagName).toBe("SELECT");
    await user.selectOptions(gen, "groq/openai/gpt-oss-120b");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.generation.model).toBe("groq/openai/gpt-oss-120b");
  });

  it("warns when switching embed dim and confirms before save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const emb = screen.getByLabelText("Embedding model");
    await user.selectOptions(emb, "gemini/gemini-embedding-001");
    expect(
      screen.getByRole("alert", { name: /re-ingest/i }),
    ).toBeTruthy();
    expect(screen.getByText(/clear embeddings/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(String(confirmSpy.mock.calls[0][0])).toMatch(/re-ingest/i);
    expect(onSave).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("cancels save when re-ingest confirm is declined", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    await user.selectOptions(screen.getByLabelText("Embedding model"), "gemini/gemini-embedding-001");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("saves Account default generation as null", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <DomainConfigForm
        initial={{ ...sample, generation: { model: "groq/openai/gpt-oss-120b" } }}
        onSave={onSave}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Generation model"), "");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave.mock.calls[0][0].generation.model).toBeNull();
  });
});
