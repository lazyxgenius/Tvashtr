import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders Home | Domains | Engines | Tools in order", () => {
    render(
      <AppShell view="home" onNavigate={vi.fn()} brand={<span>Tvashtr</span>}>
        <div>main</div>
      </AppShell>,
    );
    const labels = ["Home", "Domains", "Engines", "Tools"];
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => labels.includes(b.textContent ?? ""));
    expect(buttons.map((b) => b.textContent)).toEqual(labels);
  });

  it("notifies onNavigate when Domains is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <AppShell view="home" onNavigate={onNavigate} brand={<span>Tvashtr</span>}>
        <div>main</div>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Domains" }));
    expect(onNavigate).toHaveBeenCalledWith("domains");
  });
});
