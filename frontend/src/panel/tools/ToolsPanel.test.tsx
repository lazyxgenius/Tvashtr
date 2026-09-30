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
});
