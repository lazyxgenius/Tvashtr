import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { requestHomeAction, useHomeActionHandler } from "./homeActions";

function Home({ onAction }: { onAction: (a: unknown) => void }) {
  useHomeActionHandler(onAction);
  return null;
}

describe("homeActions", () => {
  it("runs an action asked for from another page once Home mounts", () => {
    requestHomeAction({ kind: "new-team" });
    const onAction = vi.fn();
    render(<Home onAction={onAction} />);
    expect(onAction).toHaveBeenCalledWith({ kind: "new-team" });
  });

  it("drops the queued action when a page keeps the user (Keep editing)", () => {
    requestHomeAction({ kind: "new-run" });
    window.dispatchEvent(new Event("tvashtr:navigation-kept"));
    const onAction = vi.fn();
    render(<Home onAction={onAction} />);
    expect(onAction).not.toHaveBeenCalled();
  });
});
