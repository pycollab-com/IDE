const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pycollabDesktop", {
  chooseFolder: () => ipcRenderer.invoke("pycollab:choose-folder"),
  chooseImportSource: () => ipcRenderer.invoke("pycollab:choose-import-source"),
  chooseCreateLocation: () => ipcRenderer.invoke("pycollab:choose-create-location"),
  revealPath: (targetPath) => ipcRenderer.invoke("pycollab:reveal-path", targetPath),
  getDesktopContext: () => ipcRenderer.invoke("pycollab:get-desktop-context"),
});
