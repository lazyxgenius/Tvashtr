/**
 * BrowserWindow options for the main Tvashtr window, per platform.
 *
 * The Desktop designs are 1440×900 artboards whose top 30px is a dark (#232220) title strip with
 * the macOS window buttons on the left and "Tvashtr — the living canvas" centred. On macOS we hide
 * the system title bar and let the renderer draw that strip (it is a drag region), with the traffic
 * lights positioned to sit centred in it. Other platforms keep their native frame; the renderer only
 * draws the strip when `tvashtrDesktopInfo.platform === "darwin"`.
 *
 * @param {{ platform: string, preload: string }} opts
 */
function mainWindowOptions({ platform, preload }) {
  const base = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Tvashtr",
    // Paper cream, so the first paint matches the page instead of flashing dark.
    backgroundColor: "#faf9f5",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (platform === "darwin") {
    return {
      ...base,
      titleBarStyle: "hidden",
      // 12px lights centred in the 30px strip, 12px in from the left edge.
      trafficLightPosition: { x: 12, y: 9 },
    };
  }
  return base;
}

module.exports = { mainWindowOptions };
