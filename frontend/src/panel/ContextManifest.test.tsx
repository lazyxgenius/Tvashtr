import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ContextManifest as ContextManifestData } from "../lib/api";
import { ContextManifest } from "./ContextManifest";

// Numbers are humanized with `toLocaleString()` — compute the expected string the SAME way so the
// assertion is locale-independent.
const tok = (n: number) => n.toLocaleString();

function manifest(over: Partial<ContextManifestData> = {}): ContextManifestData {
  return {
    parts: [
      { name: "system", tokens: 1200 },
      { name: "spec", tokens: 3400 },
      { name: "history", tokens: 800 },
    ],
    total_tokens: 5400,
    budget: 8000,
    handle_used: false,
    ...over,
  };
}

describe("ContextManifest (M-ledger C6)", () => {
  it("renders each context part with its token count + the total and budget", () => {
    render(<ContextManifest manifest={manifest()} />);
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("spec")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();
    expect(screen.getByText(tok(1200))).toBeInTheDocument();
    expect(screen.getByText(tok(3400))).toBeInTheDocument();
    // the total + budget footer rows
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText(tok(5400))).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText(tok(8000))).toBeInTheDocument();
  });

  it("shows the 'Spec offloaded to SPEC.md' note only when handle_used", () => {
    const { rerender } = render(<ContextManifest manifest={manifest({ handle_used: false })} />);
    expect(screen.queryByText("Spec offloaded to SPEC.md")).toBeNull();

    rerender(<ContextManifest manifest={manifest({ handle_used: true })} />);
    expect(screen.getByText("Spec offloaded to SPEC.md")).toBeInTheDocument();
  });
});
