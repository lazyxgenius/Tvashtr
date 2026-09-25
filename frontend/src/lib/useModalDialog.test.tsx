import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useModalDialog } from "./useModalDialog";

// A minimal dialog container driven by the hook — three focusables so the Tab / Shift+Tab wrap is
// observable via `document.activeElement`.
function TrapBox({
  active = true,
  onClose = () => {},
}: {
  active?: boolean;
  onClose?: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(active, onClose);
  return (
    <div ref={ref} data-testid="dialog">
      <button data-testid="first">first</button>
      <button data-testid="mid">mid</button>
      <button data-testid="last">last</button>
    </div>
  );
}

// A persistent outside button under which the trap mounts/unmounts — so focus-restore across the
// trap subtree's unmount is observable (the outside button survives that unmount).
function MountHarness({ open }: { open: boolean }) {
  return (
    <>
      <button data-testid="outside">outside</button>
      {open ? <TrapBox /> : null}
    </>
  );
}

describe("useModalDialog", () => {
  it("moves focus into the dialog container when activated", () => {
    render(<TrapBox />);
    // On activate the hook focuses the first focusable inside the container.
    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps Tab from the last focusable back to the first (explicit wrap, observable under jsdom)", () => {
    render(<TrapBox />);
    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Tab" });

    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    render(<TrapBox />);
    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");
    first.focus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<TrapBox onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously-focused element on unmount", () => {
    const { rerender } = render(<MountHarness open={false} />);
    const outside = screen.getByTestId("outside");
    outside.focus();
    expect(document.activeElement).toBe(outside);

    // Mount the trap: focus moves inside.
    rerender(<MountHarness open={true} />);
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    // Unmount the trap: focus is restored to the previously-focused (outside) button.
    rerender(<MountHarness open={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it("is inert when inactive — no focus move, Escape ignored", () => {
    const onClose = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    render(<TrapBox active={false} onClose={onClose} />);

    // Inactive: focus was NOT pulled into the dialog and Escape does nothing.
    expect(document.activeElement).toBe(outside);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    document.body.removeChild(outside);
  });

  it("stacks: with two dialogs open, Escape closes only the top one", () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    function Nested() {
      const outer = useModalDialog<HTMLDivElement>(true, onOuter);
      const inner = useModalDialog<HTMLDivElement>(true, onInner);
      return (
        <>
          <div ref={outer}>
            <button type="button">outer</button>
          </div>
          <div ref={inner}>
            <button type="button">inner</button>
          </div>
        </>
      );
    }
    render(<Nested />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
  });
});
