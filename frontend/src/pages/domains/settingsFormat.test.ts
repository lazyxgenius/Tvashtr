import { describe, expect, it } from "vitest";

import {
  changedFields,
  configOf,
  dangerText,
  draftOf,
  fieldErrors,
  saveImpact,
  templateOption,
  widerHelper,
} from "./settingsFormat";

const CONFIG = {
  chunking: { strategy: "fixed", size: 600, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: {
    top_k: 8,
    mode: "dense",
    rerank: { enabled: false, model: null, top_n: 20 },
    graph: { enabled: false },
  },
  generation: { model: null },
};
const SAVED = draftOf({ template: "support", config: CONFIG });
const COUNTS = { files: 14, tests: 12 };

describe("Settings draft (DM-80…DM-85)", () => {
  it("opens as the stored settings", () => {
    expect(SAVED).toEqual({
      template: "support",
      reading: "openai/text-embedding-3-small",
      size: "600",
      overlap: "100",
      answer: null,
      mode: "dense",
      topK: "8",
      rerank: false,
      graph: false,
    });
    expect(changedFields(SAVED, { ...SAVED })).toEqual([]);
  });

  it("checks the numbers with the backend's words", () => {
    expect(fieldErrors(SAVED)).toEqual({});
    expect(fieldErrors({ ...SAVED, size: "99" }).size).toBe("Use a number from 100 to 4,000.");
    expect(fieldErrors({ ...SAVED, size: "6o0" }).size).toBe("Use a number from 100 to 4,000.");
    expect(fieldErrors({ ...SAVED, overlap: "600" }).overlap).toBe(
      "Overlap must be smaller than the piece size.",
    );
    expect(fieldErrors({ ...SAVED, size: "1200", overlap: "-1" }).overlap).toBe(
      "Use a number from 0 to 1,199.",
    );
    expect(fieldErrors({ ...SAVED, topK: "31" }).topK).toBe("Use a number from 1 to 30.");
    expect(fieldErrors({ ...SAVED, topK: "" }).topK).toBe("Use a number from 1 to 30.");
    expect(fieldErrors({ ...SAVED, answer: " " }).answer).toBe("Type the model as provider/model.");
  });

  it("says how wide Look wider looks", () => {
    expect(widerHelper(SAVED, CONFIG)).toBe("Looks at 20 passages first, then keeps the best 8.");
    expect(widerHelper({ ...SAVED, topK: "15" }, CONFIG)).toBe(
      "Looks at 30 passages first, then keeps the best 15.",
    );
  });

  it("sends the stored config with the draft laid over it", () => {
    const sent = configOf(CONFIG, {
      ...SAVED,
      mode: "hybrid",
      rerank: true,
      answer: "openai/gpt-4o-mini",
    });
    expect(sent).toEqual({
      ...CONFIG,
      retrieval: {
        top_k: 8,
        mode: "hybrid",
        rerank: { enabled: true, model: null, top_n: 20 },
        graph: { enabled: false },
      },
      generation: { model: "openai/gpt-4o-mini" },
    });
    // A changed reading model is sent normalised; an unchanged one keeps its spelling.
    const moved = configOf(CONFIG, {
      ...SAVED,
      reading: "gemini/gemini-embedding-001",
      size: "400",
    });
    expect(moved.embedding).toEqual({ model: "gemini/gemini-embedding-001" });
    expect(moved.chunking).toEqual({ strategy: "fixed", size: 400, overlap: 100 });
  });
});

describe("the save bar (DM-87)", () => {
  it("a search change needs no re-read and runs the tests when there are some (DmF-Tune-2)", () => {
    expect(saveImpact(SAVED, { ...SAVED, mode: "hybrid" }, COUNTS)).toEqual({
      summary: "1 unsaved change · Search by: Both",
      note: "No re-read needed",
      action: "run-tests",
      label: "Save and run tests",
    });
    expect(saveImpact(SAVED, { ...SAVED, mode: "hybrid" }, { files: 14, tests: 0 })?.label).toBe(
      "Save changes",
    );
    expect(saveImpact(SAVED, { ...SAVED, answer: "openai/gpt-4o-mini" }, COUNTS)).toMatchObject({
      summary: "1 unsaved change · Answer model",
      action: "save",
    });
    expect(saveImpact(SAVED, SAVED, COUNTS)).toBeNull();
  });

  it("another reading model re-reads every file, unless it's the same weights (OQ-17)", () => {
    expect(saveImpact(SAVED, { ...SAVED, reading: "gemini/gemini-embedding-001" }, COUNTS)).toEqual(
      {
        summary: "1 unsaved change · Reading model",
        note: "Re-reads 14 files",
        action: "reread",
        label: "Save and re-read",
      },
    );
    const route = { ...SAVED, reading: "openrouter/openai/text-embedding-3-small" };
    expect(saveImpact(SAVED, route, COUNTS)).toMatchObject({
      note: "No re-read needed",
      action: "save",
    });
  });

  it("a piece change keeps the existing files as they are (DmF-Piece-1)", () => {
    expect(saveImpact(SAVED, { ...SAVED, size: "400" }, COUNTS)).toEqual({
      summary: "1 unsaved change · Piece size",
      note: "Existing files keep 600",
      action: "pieces",
      label: "Save",
    });
    const two = saveImpact(
      SAVED,
      { ...SAVED, template: "legal", size: "500", overlap: "80" },
      COUNTS,
    );
    expect(two?.summary).toBe("3 unsaved changes");
    expect(saveImpact(SAVED, { ...SAVED, size: "400" }, { files: 0, tests: 0 })?.action).toBe(
      "save",
    );
  });
});

describe("Settings words", () => {
  it("names a starting point with its piece size", () => {
    expect(templateOption({ template: "scientific", name: "Scientific", piece_size: 1000 })).toBe(
      "Scientific · 1,000-character pieces",
    );
    expect(templateOption({ template: "legal", name: "Legal" })).toBe("Legal");
  });

  it("says what deleting removes, with the honest in-use line (OQ-14)", () => {
    expect(dangerText(14, null)).toBe("Removes its 14 files, pieces, chat and test questions.");
    expect(
      dangerText(1, "Teams that use it as a step can’t run until you pick another domain."),
    ).toBe(
      "Removes its 1 file, pieces, chat and test questions. Teams that use it as a step can’t run until you pick another domain.",
    );
    expect(dangerText(0, null)).toBe("Removes its chat and test questions.");
  });
});
