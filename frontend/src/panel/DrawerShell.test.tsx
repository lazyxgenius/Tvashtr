import { fireEvent, render } from "@testing-library/react";
import { PanelRight } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DrawerShell, type PanelMode } from "./DrawerShell";

// Renders the shell in a given mode and hands back the <aside> + the onClose spy. `container` is used
// for direct attribute reads so the "docked DOM byte-unchanged" claim is proven at the attribute level.
function renderShell(panelMode: PanelMode, onClose = vi.fn()) {
  const { container } = render(
    <DrawerShell
      glyph={PanelRight}
      title="Config"
      subtitle="Worker"
      ariaLabel="Config panel"
      panelMode={panelMode}
      onTogglePanelMode={vi.fn()}
      onClose={onClose}
    >
      <button>Body control</button>
    </DrawerShell>,
  );
  const aside = container.querySelector("aside") as HTMLElement;
  return { aside, onClose };
}

describe("DrawerShell", () => {
  // A11y (Filler-A): modal mode is a real trapped dialog.
  it("modal mode marks the panel as a dialog (role + aria-modal) and closes on Escape", () => {
    const { aside, onClose } = renderShell("modal");
    expect(aside.getAttribute("role")).toBe("dialog");
    expect(aside.getAttribute("aria-modal")).toBe("true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("modal mode moves focus into the panel", () => {
    const { aside } = renderShell("modal");
    expect(aside.contains(document.activeElement)).toBe(true);
  });

  // Docked mode must be byte-for-byte the pre-Filler-A DOM: no dialog role, no aria-modal, no trap.
  it("docked mode has neither role nor aria-modal, and Escape does nothing", () => {
    const { aside, onClose } = renderShell("drawer");
    expect(aside.getAttribute("role")).toBeNull();
    expect(aside.getAttribute("aria-modal")).toBeNull();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
