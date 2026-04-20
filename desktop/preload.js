const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pycollabDesktop", {
  chooseFolder: () => ipcRenderer.invoke("pycollab:choose-folder"),
  chooseCreateLocation: () => ipcRenderer.invoke("pycollab:choose-create-location"),
  revealPath: (targetPath) => ipcRenderer.invoke("pycollab:reveal-path", targetPath),
  getDesktopContext: () => ipcRenderer.invoke("pycollab:get-desktop-context"),
});
