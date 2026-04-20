const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pycollabDesktop", {
  chooseFolder: () => ipcRenderer.invoke("pycollab:choose-folder"),
  chooseCreateLocation: () => ipcRenderer.invoke("pycollab:choose-create-location"),
  revealPath: (targetPath) => ipcRenderer.invoke("pycollab:reveal-path", targetPath),
  getDesktopContext: () => ipcRenderer.invoke("pycollab:get-desktop-context"),
  onDevicePicker: (listener) => {
    const wrapped = (event, payload) => listener(payload);
    ipcRenderer.on("pycollab:device-picker", wrapped);
    return () => ipcRenderer.removeListener("pycollab:device-picker", wrapped);
  },
  resolveDevicePicker: (payload) => ipcRenderer.invoke("pycollab:resolve-device-picker", payload),
  cancelDevicePicker: (requestId) => ipcRenderer.invoke("pycollab:cancel-device-picker", requestId),
});
