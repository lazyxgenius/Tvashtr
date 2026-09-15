const { contextBridge, ipcRenderer } = require("electron");

const engines = {
  getStatus: () => ipcRenderer.invoke("tvashtr:engines:getStatus"),
  connect: (provider) => ipcRenderer.invoke("tvashtr:engines:connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("tvashtr:engines:disconnect", provider),
  refresh: (provider) => ipcRenderer.invoke("tvashtr:engines:refresh", provider),
};

const runs = {
  startLocal: (payload) => ipcRenderer.invoke("tvashtr:runs:startLocal", payload),
  stopLocal: (localRunId) => ipcRenderer.invoke("tvashtr:runs:stopLocal", localRunId),
  subscribeLogs: (localRunId, cb) => {
    const handler = (_e, payload) => {
      if (payload?.localRunId === localRunId) cb(String(payload.line ?? ""));
    };
    ipcRenderer.on("tvashtr:runs:log", handler);
    return () => ipcRenderer.removeListener("tvashtr:runs:log", handler);
  },
};

contextBridge.exposeInMainWorld("tvashtrDesktop", { engines, runs });
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  version: 2,
});
