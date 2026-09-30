import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { connection } from "../../pages/connectors/connectorsTestUtils";
import { mockApi } from "../../pages/tools/toolsTestUtils";
import type { ToolConfig } from "./nodeTools";
import { ToolsPanel } from "./ToolsPanel";

// What ToolsPanel hands the Connectors checklist (CnF-Grant-3/4).

const LINEAR = connection({ id: "c3", name: "Linear", slug: "linear", access: "write" });

beforeEach(() => __resetBackendStatusForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

describe("ToolsPanel — Connectors", () => {
  it("the read-only note for a fresh tick goes once the saved config has that tick", async () => {
    mockApi({
      "GET /api/connectors": { connections: [LINEAR] },
      "GET /api/domains": { domains: [] },
    });
    const onChange = vi.fn<(next: ToolConfig) => void>();
    const panel = (config: ToolConfig, savedConfig: ToolConfig) => (
      <ToolsPanel
        config={config}
        savedConfig={savedConfig}
        library={[]}
        secrets={[]}
        onChange={onChange}
        notify={noop}
        onAdd={noop}
        onEditServer={noop}
      />
    );
    const { rerender } = render(panel(null, null));
    const section = screen.getByRole("region", { name: /^Connectors/ });
    fireEvent.click(await within(section).findByRole("checkbox", { name: /^Linear/ }));
    const ticked = onChange.mock.lastCall?.[0] ?? null;
    expect(ticked).toEqual({ tvashtr: { connectors: [{ id: "c3", access: "read" }] } });
    rerender(panel(ticked, null));
    expect(section).toHaveTextContent("This agent starts on read only.");
    rerender(panel(ticked, ticked));
    expect(section).not.toHaveTextContent("starts on read only");
    expect(section).toHaveTextContent("During a run it can call the read tools of what’s ticked.");
  });

  it("a link to Connectors leaves through the drawer, which asks about an unsaved draft", async () => {
    const SENTRY = connection({ id: "c5", name: "Sentry", slug: "sentry", status: "needs_signin" });
    let connections = [SENTRY];
    mockApi({
      "GET /api/connectors": () => ({ connections }),
      "GET /api/domains": { domains: [] },
    });
    const onOpenToolkit = vi.fn();
    const panel = (
      <ToolsPanel
        config={null}
        library={[]}
        secrets={[]}
        onChange={noop}
        notify={noop}
        onAdd={noop}
        onEditServer={noop}
        onOpenToolkit={onOpenToolkit}
      />
    );
    const { unmount } = render(panel);
    const link = await screen.findByRole("link", { name: "Sign in again" });
    // Not followed on its own: the drawer decides (it has the "Save your changes?" question).
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpenToolkit).toHaveBeenLastCalledWith({ page: "connector", connectorId: "c5" });

    unmount();
    connections = [];
    render(panel);
    fireEvent.click(await screen.findByRole("link", { name: "Open Connectors" }));
    expect(onOpenToolkit).toHaveBeenLastCalledWith({ page: "connectors", view: "connected" });

    // "Connect an app" › "Open Connectors" is for what isn't Featured: Browse, the same way.
    fireEvent.click(screen.getByRole("button", { name: "Connect an app" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect an app for this agent" });
    expect(fireEvent.click(within(dialog).getByRole("link", { name: "Open Connectors" }))).toBe(
      false,
    );
    expect(onOpenToolkit).toHaveBeenLastCalledWith({ page: "connectors", view: "browse" });
  });
});
