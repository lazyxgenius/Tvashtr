import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetGetStartedForTests } from "../home/getStarted";
import { Shell } from "../shell/Shell";
import { installDesktopBridge, stubFetch, uninstallDesktopBridge } from "./desktopTestUtils";

const GOING = { run_id: "r1", status: "running", status_group: "running", desktop_target: true };
const HOSTED = { run_id: "r2", status: "running", status_group: "running", desktop_target: false };

function renderShell() {
  render(
    <Shell
      route={{ page: "home" }}
      user={{ email: "l@tvashtr.dev", display_name: "lazyxgenius" }}
      badges={{}}
      onNavigate={vi.fn()}
      onOpenSearch={vi.fn()}
      onShowShortcuts={vi.fn()}
      onLogout={vi.fn()}
    >
      <p>page</p>
    </Shell>,
  );
  return screen.getByRole("navigation", { name: "Dashboard" });
}

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
  __resetGetStartedForTests();
});

describe("the Shell's update card (DT-43–46)", () => {
  it("ready: counts this Mac's running runs and restarts through the bridge", async () => {
    const bridge = installDesktopBridge({ update: { state: "ready", version: "0.8.0" } });
    stubFetch({ "GET /api/runs": { body: { runs: [GOING, HOSTED], next_cursor: null } } });
    const nav = renderShell();
    expect(await within(nav).findByText("Update ready · 0.8.0")).toBeInTheDocument();
    expect(
      await within(nav).findByText("Restarting stops running teams. 1 run is going."),
    ).toBeInTheDocument();
    expect(within(nav).queryByText("Shortcuts")).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "Restart to update" }));
    expect(bridge.update.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  it("manual: Download update opens the stable DMG link, with the xattr fix", async () => {
    const bridge = installDesktopBridge({
      update: { state: "manual", version: "0.8.0", reason: "not_writable" },
    });
    stubFetch({});
    const nav = renderShell();
    expect(await within(nav).findByText("Update available · 0.8.0")).toBeInTheDocument();
    expect(
      within(nav).getByText(
        "Download it, quit Tvashtr, then drag the new Tvashtr to Applications.",
      ),
    ).toBeInTheDocument();
    expect(
      within(nav).getByText("xattr -dr com.apple.quarantine /Applications/Tvashtr.app"),
    ).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "Download update" }));
    expect(bridge.update.openDownload).toHaveBeenCalledTimes(1);
  });

  it("follows the updater: nothing while idle or downloading, the card once staged", async () => {
    const bridge = installDesktopBridge();
    stubFetch({ "GET /api/runs": { body: { runs: [], next_cursor: null } } });
    const nav = renderShell();
    expect(await within(nav).findByText("Shortcuts")).toBeInTheDocument();
    act(() => bridge.fireUpdate({ state: "downloading", version: "0.8.0", progress: 0.5 }));
    expect(within(nav).getByText("Shortcuts")).toBeInTheDocument();
    act(() => bridge.fireUpdate({ state: "ready", version: "0.8.0" }));
    expect(
      await within(nav).findByText("Restarting stops running teams. No runs are going."),
    ).toBeInTheDocument();
  });

  it("the website never shows it", () => {
    stubFetch({});
    const nav = renderShell();
    expect(within(nav).getByText("Shortcuts")).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /update/ })).not.toBeInTheDocument();
  });
});
