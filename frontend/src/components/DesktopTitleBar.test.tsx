import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setDesktopTitle, TITLE_CANVAS, TITLE_LAUNCH } from "../lib/desktopApp";
import { DesktopTitleBar } from "./DesktopTitleBar";

afterEach(() => {
  delete window.tvashtrDesktop;
  delete window.tvashtrDesktopInfo;
  setDesktopTitle(TITLE_LAUNCH);
});

describe("DesktopTitleBar", () => {
  it("draws the design's title strip on macOS Desktop, titled by the current screen (DT-3)", () => {
    window.tvashtrDesktop = true;
    window.tvashtrDesktopInfo = { shell: "electron", version: 4, platform: "darwin" };
    render(<DesktopTitleBar />);
    const strip = screen.getByTestId("desktop-titlebar");
    expect(strip).toHaveTextContent(/^Tvashtr$/);
    act(() => setDesktopTitle(TITLE_CANVAS));
    expect(strip).toHaveTextContent("Tvashtr — the living canvas");
    expect(document.title).toBe("Tvashtr — the living canvas");
    act(() => setDesktopTitle(TITLE_LAUNCH));
    expect(strip).toHaveTextContent(/^Tvashtr$/);
    expect(document.title).toBe("Tvashtr");
  });

  it("renders nothing on the website", () => {
    render(<DesktopTitleBar />);
    expect(screen.queryByTestId("desktop-titlebar")).toBeNull();
  });

  it("renders nothing on Desktop for Windows/Linux, which keep the native frame", () => {
    window.tvashtrDesktop = true;
    window.tvashtrDesktopInfo = { shell: "electron", version: 4, platform: "win32" };
    render(<DesktopTitleBar />);
    expect(screen.queryByTestId("desktop-titlebar")).toBeNull();
  });
});
