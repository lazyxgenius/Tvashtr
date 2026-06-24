// @vitest-environment jsdom
//
// Round-trip-stability guard for the live-steering editor (P1.7b). A Save POSTs the editor's
// serialized markdown as a new DocumentVersion the running agents re-source (J3), so a no-op
// "load the latest version, Save it again" must NOT mutate the spec — otherwise opening the
// panel could silently rewrite the PM's PRD. These tests feed a representative PRD (a `#`
// heading, a `-` bullet list, AND a fenced code block carrying the deliverable's file + exact
// line) through the SAME `PRD_EDITOR_EXTENSIONS` the editor uses and assert byte-stability.
import { describe, expect, it } from "vitest";

import { roundTripMarkdown } from "./prdEditor";

// The shape the PM emits: heading + prose + a dash bullet list + a fenced code block whose
// last line is the exact deliverable. Authored in the serializer's canonical form so a faithful
// editor leaves it untouched.
const PRD = [
  "# Mini-PRD: greeting file",
  "",
  "The deliverable is a single text file at the repository root.",
  "",
  "- It must be named `greeting.txt`",
  "- It must contain exactly one line and nothing else",
  "",
  "```text",
  "greeting.txt",
  "Shipped by the Tvashtr PM->Engineer team",
  "```",
].join("\n");

const FENCED_BLOCK = ["```text", "greeting.txt", "Shipped by the Tvashtr PM->Engineer team", "```"].join(
  "\n",
);
const DELIVERABLE_LINE = "Shipped by the Tvashtr PM->Engineer team";

describe("roundTripMarkdown — the editor's load→save is a faithful no-op", () => {
  it("is byte-stable on a representative PRD (idempotent no-op load-then-save)", () => {
    expect(roundTripMarkdown(PRD)).toBe(PRD);
  });

  it("preserves the fenced code block AND the exact deliverable line verbatim (non-vacuous)", () => {
    const out = roundTripMarkdown(PRD);
    // The whole fence (language tag, file path, the exact line, closing fence) survives intact —
    // not just "some text round-tripped".
    expect(out).toContain(FENCED_BLOCK);
    expect(out).toContain(DELIVERABLE_LINE);
    // And the heading + dash bullets survive as themselves (no `*`/`+` rewrite, no `##` shift).
    expect(out).toContain("# Mini-PRD: greeting file");
    expect(out).toContain("- It must be named `greeting.txt`");
  });

  it("is a fixed point — round-tripping the round-trip changes nothing", () => {
    const once = roundTripMarkdown(PRD);
    expect(roundTripMarkdown(once)).toBe(once);
  });

  it("is byte-stable on a human-steered SENTINEL PRD (the shape the live E2E types)", () => {
    // Mirrors the minimal PRD a human types over the PM's in the steering E2E: a different
    // deliverable line must survive a Save just as faithfully as the PM's original.
    const steered = [
      "# Steered spec",
      "",
      "Create a file named `greeting.txt` at the repository root with exactly this line:",
      "",
      "```text",
      "Steered by a human mid-run via Tvashtr",
      "```",
    ].join("\n");
    expect(roundTripMarkdown(steered)).toBe(steered);
    expect(roundTripMarkdown(steered)).toContain("Steered by a human mid-run via Tvashtr");
  });
});
