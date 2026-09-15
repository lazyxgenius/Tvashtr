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
    const topK = screen.getByLabelText(/top k/i);
    await user.clear(topK);
    await user.type(topK, "5");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.top_k).toBe(5);
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
});
