import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DrawerConfirm } from "./DrawerConfirm";

function confirm(placement?: "center" | "footer") {
  const onCancel = vi.fn();
  const onDelete = vi.fn();
  render(
    <aside aria-label="Reviewer settings">
      <button type="button">Behind</button>
      <DrawerConfirm
        title="Delete Reviewer?"
        placement={placement}
        onCancel={onCancel}
        actions={
          <>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" onClick={onDelete}>
              Delete agent
            </button>
          </>
        }
      >
        Past runs keep their results.
      </DrawerConfirm>
    </aside>,
  );
  return { onCancel, onDelete, dialog: screen.getByRole("alertdialog") };
}

describe("DrawerConfirm", () => {
  it("is an alertdialog named by its title and described by its sentence, focused on the first button", () => {
    const { dialog } = confirm();
    expect(dialog).toHaveAccessibleName("Delete Reviewer?");
    expect(dialog).toHaveAccessibleDescription("Past runs keep their results.");
    expect(dialog).toHaveClass("nd-confirm--center");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Escape and a click on the scrim cancel", () => {
    const { onCancel } = confirm();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector(".nd-scrim") as Element);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("the footer placement keeps the drawer visible (a clear scrim)", () => {
    const { dialog } = confirm("footer");
    expect(dialog).toHaveClass("nd-confirm--footer");
    expect(document.querySelector(".nd-scrim")).toHaveClass("nd-scrim--clear");
  });
});
