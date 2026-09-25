import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopTitleBar } from "./DesktopTitleBar";

afterEach(() => {
  delete window.tvashtrDesktop;
  delete window.tvashtrDesktopInfo;
});

describe("DesktopTitleBar", () => {
  it("draws the design's title strip on macOS Desktop", () => {
    window.tvashtrDesktop = true;
    window.tvashtrDesktopInfo = { shell: "electron", version: 4, platform: "darwin" };
    render(<DesktopTitleBar />);
    expect(screen.getByTestId("desktop-titlebar")).toHaveTextContent("Tvashtr — the living canvas");
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
