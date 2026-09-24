const { contextBridge, ipcRenderer } = require("electron");

const engines = {
  getStatus: () => ipcRenderer.invoke("tvashtr:engines:getStatus"),
  connect: (provider) => ipcRenderer.invoke("tvashtr:engines:connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("tvashtr:engines:disconnect", provider),
  refresh: (provider) => ipcRenderer.invoke("tvashtr:engines:refresh", provider),
  // M-subs-desktop: the main process re-asks a CLI when the window regains focus after Connect
  // opened the vendor login in Terminal — cards subscribe so they flip to Connected on their own.
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("tvashtr:engines:status", handler);
    return () => ipcRenderer.removeListener("tvashtr:engines:status", handler);
  },
};

contextBridge.exposeInMainWorld("tvashtrDesktop", { engines });
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  version: 3,
});
