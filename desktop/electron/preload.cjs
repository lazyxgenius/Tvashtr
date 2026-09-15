// Thin bridge: mark this renderer as the desktop shell so the shared FE can
// optionally hide web-only chrome later. Keep the surface minimal — no IPC yet.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("tvashtrDesktop", true);
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  version: 1,
});
