import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveBar } from "./SaveBar";

afterEach(() => {
  delete (window as Window & { tvashtrDesktopInfo?: unknown }).tvashtrDesktopInfo;
});

const bar = (over: Partial<Parameters<typeof SaveBar>[0]> = {}) =>
  render(
    <SaveBar
      dirtyCount={0}
      saveState="idle"
      canSave={false}
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      {...over}
    />,
  );

describe("SaveBar (PANEL-17)", () => {
  it("dirty: plural count, Discard and Save with the platform's shortcut", () => {
    window.tvashtrDesktopInfo = { shell: "electron", version: 5, platform: "darwin" };
    bar({ dirtyCount: 2, canSave: true });
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save ⌘S" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("off macOS the shortcut reads Ctrl S", () => {
    window.tvashtrDesktopInfo = { shell: "electron", version: 5, platform: "win32" };
    bar({ dirtyCount: 1, canSave: true });
    expect(screen.getByRole("button", { name: "Save Ctrl S" })).toBeInTheDocument();
  });

  it("saving: 'Saving N changes…' with a busy Saving button", () => {
    bar({ dirtyCount: 2, saveState: "saving" });
    expect(screen.getByText("Saving 2 changes…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving" })).toHaveAttribute("aria-busy", "true");
  });
});
