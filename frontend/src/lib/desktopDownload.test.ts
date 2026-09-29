/**
 * The download page states these as facts (website.md §5 "Constants"): pin them to the Desktop
 * build that produces the DMG, so bumping Electron or renaming the artifact fails here first.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DESKTOP_MAC_DMG_URL, DESKTOP_MIN_MACOS_LABEL } from "./desktopDownload";

// Read at test time, not imported: the image builds the frontend on its own (no desktop/ there),
// and its `tsc --noEmit` must not need a file outside frontend/.
const desktopPkg = JSON.parse(readFileSync(`${process.cwd()}/../desktop/package.json`, "utf8")) as {
  devDependencies: { electron: string };
  build: { mac: { artifactName: string } };
};

/** Electron major → the oldest macOS it runs on (Electron's release notes). A major missing here
 *  fails the test: look its floor up and add it. */
const MACOS_FLOOR: Record<number, string> = {
  33: "macOS 11 or later",
  34: "macOS 11 or later",
  35: "macOS 11 or later",
  36: "macOS 11 or later",
  37: "macOS 11 or later",
};

describe("the Desktop download's constants", () => {
  it("the minimum macOS matches the Electron major the app is built with", () => {
    const major = Number(/\d+/.exec(desktopPkg.devDependencies.electron)?.[0]);
    expect(MACOS_FLOOR[major], `Electron ${major}: add its macOS floor`).toBeDefined();
    expect(DESKTOP_MIN_MACOS_LABEL).toBe(MACOS_FLOOR[major]);
  });

  it("the DMG keeps its stable, unversioned name", () => {
    expect(desktopPkg.build.mac.artifactName).toBe("Tvashtr-mac.${ext}");
    expect(DESKTOP_MAC_DMG_URL).toMatch(/\/releases\/latest\/download\/Tvashtr-mac\.dmg$/);
  });
});
