import { describe, expect, it } from "vitest";

import {
  READING_MODELS,
  addKeyLabel,
  keySavedText,
  keySavedToast,
  missingKeyText,
  readingExamples,
  readingModel,
} from "./readingModels";

describe("reading models (DM-82)", () => {
  it("lists the design's five models and never NVIDIA NIM", () => {
    expect(READING_MODELS.map((m) => m.label)).toEqual([
      "OpenAI text-embedding-3-small",
      "OpenAI text-embedding-ada-002",
      "OpenRouter text-embedding-3-small",
      "Gemini embedding-001",
      "Hugging Face BGE-small (free)",
    ]);
    expect(READING_MODELS.some((m) => /nim|nvidia/i.test(m.slug))).toBe(false);
  });

  it("finds a stored slug, bare OpenAI names included", () => {
    expect(readingModel("text-embedding-3-small").label).toBe("OpenAI text-embedding-3-small");
    expect(readingModel("gemini/gemini-embedding-001").dim).toBe(768);
    expect(readingModel("acme/embed-x")).toMatchObject({ label: "acme/embed-x", provider: "acme" });
  });

  it("calls Hugging Face's key a token", () => {
    expect(keySavedText("openai")).toBe("key saved");
    expect(keySavedText("huggingface")).toBe("token saved");
    expect(missingKeyText("gemini")).toBe("No gemini key");
    expect(missingKeyText("huggingface")).toBe("No huggingface token");
    expect(addKeyLabel("openai")).toBe("Add openai key");
    expect(addKeyLabel("huggingface")).toBe("Add huggingface token");
    expect(keySavedToast("openai")).toBe("openai key saved");
  });

  it("gives the key sheet an example model per provider, the current one first", () => {
    const ex = readingExamples(readingModel("openai/text-embedding-ada-002"));
    expect(ex.openai).toBe("openai/text-embedding-ada-002");
    expect(ex.huggingface).toBe("huggingface/BAAI/bge-small-en-v1.5");
  });
});
