const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pycollabDesktop", {
  chooseFolder: () => ipcRenderer.invoke("pycollab:choose-folder"),
  chooseCreateLocation: () => ipcRenderer.invoke("pycollab:choose-create-location"),
  chooseImportSource: () => ipcRenderer.invoke("pycollab:choose-import-source"),
  revealPath: (targetPath) => ipcRenderer.invoke("pycollab:reveal-path", targetPath),
  getDesktopContext: () => ipcRenderer.invoke("pycollab:get-desktop-context"),
  getPersistentState: () => ipcRenderer.invoke("pycollab:get-persistent-state"),
  setPersistentState: (state) => ipcRenderer.invoke("pycollab:set-persistent-state", state),
  clearPersistentState: () => ipcRenderer.invoke("pycollab:clear-persistent-state"),
  checkAppUpdate: () => ipcRenderer.invoke("pycollab:check-app-update"),
  openAppUpdate: (targetUrl) => ipcRenderer.invoke("pycollab:open-app-update", targetUrl),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke("pycollab:open-external-url", targetUrl),
  copyText: (text) => ipcRenderer.invoke("pycollab:copy-text", text),
  openBluetoothSettings: () => ipcRenderer.invoke("pycollab:open-bluetooth-settings"),
  onDevicePicker: (listener) => {
    const wrapped = (event, payload) => listener(payload);
    ipcRenderer.on("pycollab:device-picker", wrapped);
    return () => ipcRenderer.removeListener("pycollab:device-picker", wrapped);
  },
  resolveDevicePicker: (payload) => ipcRenderer.invoke("pycollab:resolve-device-picker", payload),
  cancelDevicePicker: (requestId) => ipcRenderer.invoke("pycollab:cancel-device-picker", requestId),
});
