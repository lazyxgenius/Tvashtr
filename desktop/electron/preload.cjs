const { contextBridge, ipcRenderer } = require("electron");

const engines = {
  getStatus: () => ipcRenderer.invoke("tvashtr:engines:getStatus"),
  connect: (provider) => ipcRenderer.invoke("tvashtr:engines:connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("tvashtr:engines:disconnect", provider),
  refresh: (provider) => ipcRenderer.invoke("tvashtr:engines:refresh", provider),
};

contextBridge.exposeInMainWorld("tvashtrDesktop", { engines });
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  version: 2,
});
