import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrawerToast } from "./DrawerToast";
import { TOAST_MS, type ToastSpec } from "./useDrawerToast";

// Fake timers + fireEvent (user-event deadlocks with fake timers).
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const spec = (over: Partial<ToastSpec> = {}): ToastSpec => ({
  id: 1,
  message: "Reviewer template applied",
  ...over,
});

describe("DrawerToast (PANEL-102)", () => {
  it("is a live region that shows the message and hides after about 6s", () => {
    const onDismiss = vi.fn();
    render(<DrawerToast toast={spec()} onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reviewer template applied");
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 100);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds while hovered, then takes up where it left off", () => {
    const onDismiss = vi.fn();
    render(<DrawerToast toast={spec()} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    const card = screen.getByText("Reviewer template applied").closest(".nd-toast") as HTMLElement;
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("runs its action (Undo) and closes", () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    render(
      <DrawerToast toast={spec({ action: { label: "Undo", onAction } })} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a new toast restarts the clock", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<DrawerToast toast={spec()} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<DrawerToast toast={spec({ id: 2, message: "Kept" })} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Kept");
  });
});
