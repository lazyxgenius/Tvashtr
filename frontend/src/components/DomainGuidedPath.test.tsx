import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DomainGuidedPath } from "./DomainGuidedPath";

describe("DomainGuidedPath", () => {
  it("renders the happy-path steps including Eval / graph-lite (#7)", () => {
    render(<DomainGuidedPath />);
    expect(screen.getByRole("region", { name: /Guided path/i })).toBeTruthy();
    expect(screen.getByText(/Create or open a domain/i)).toBeTruthy();
    expect(screen.getByText(/Configure embed & generation/i)).toBeTruthy();
    expect(screen.getByText(/Upload & ingest/i)).toBeTruthy();
    expect(screen.getByText("Eval golden sets & graph-lite")).toBeTruthy();
    expect(screen.getByText(/Attach Domains MCP or fetch/i)).toBeTruthy();
    expect(screen.getByText(/Create or open a team/i)).toBeTruthy();
  });

  it("fires New domain / Engines / New team / Config / Documents / Eval CTAs", async () => {
    const user = userEvent.setup();
    const onNewDomain = vi.fn();
    const onOpenEngines = vi.fn();
    const onCreateTeam = vi.fn();
    const onGoConfig = vi.fn();
    const onGoDocuments = vi.fn();
    const onGoEval = vi.fn();
    render(
      <DomainGuidedPath
        context="detail"
        onNewDomain={onNewDomain}
        onOpenEngines={onOpenEngines}
        onCreateTeam={onCreateTeam}
        onGoConfig={onGoConfig}
        onGoDocuments={onGoDocuments}
        onGoEval={onGoEval}
      />,
    );
    const configBtns = screen.getAllByRole("button", { name: /Open Config/i });
    expect(configBtns.length).toBeGreaterThanOrEqual(2);
    await user.click(configBtns[0]);
    expect(onGoConfig).toHaveBeenCalled();
    onGoConfig.mockClear();
    await user.click(configBtns[1]);
    expect(onGoConfig).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Open Documents/i }));
    expect(onGoDocuments).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Open Eval/i }));
    expect(onGoEval).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Open Engines/i }));
    expect(onOpenEngines).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^New team$/i }));
    expect(onCreateTeam).toHaveBeenCalled();
  });

  it("on list context offers New domain CTA", async () => {
    const user = userEvent.setup();
    const onNewDomain = vi.fn();
    render(<DomainGuidedPath context="list" onNewDomain={onNewDomain} />);
    await user.click(screen.getByRole("button", { name: /^New domain$/i }));
    expect(onNewDomain).toHaveBeenCalled();
  });

  it("shows When to use what discoverability blurb (#5)", () => {
    render(<DomainGuidedPath />);
    const note = screen.getByRole("note", { name: /When to use what/i });
    expect(note).toBeTruthy();
    expect(note.textContent).toMatch(/Chat\/Ask/i);
    expect(note.textContent).toMatch(/Query domain/i);
    expect(note.textContent).toMatch(/Domains MCP/i);
  });

  it("Eval / graph-lite operator path (#7) links Eval tab and Config graph toggle", () => {
    render(<DomainGuidedPath context="detail" onGoEval={() => {}} onGoConfig={() => {}} />);
    expect(screen.getByRole("button", { name: /Open Eval/i })).toBeTruthy();
    const step = screen.getByText("Eval golden sets & graph-lite").closest("li");
    expect(step?.textContent).toMatch(/graph-lite|Graph-lite/i);
    expect(step?.textContent).toMatch(/Config/i);
  });
});
