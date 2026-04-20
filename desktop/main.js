const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const childProcess = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

app.setName("PyCollab IDE");

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
const logFile = "/tmp/pycollab-ide.log";

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Ignore logging failures.
  }
}

function resolvePythonCommand() {
  const explicit = process.env.PYCOLLAB_IDE_PYTHON;
  if (explicit) {
    return explicit;
  }

  const candidates =
    process.platform === "darwin"
      ? [
          "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "python3",
        ]
      : process.platform === "win32"
        ? ["python"]
        : ["/usr/bin/python3", "/usr/local/bin/python3", "python3"];

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "python3";
}

function getAppRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..");
}

function getPreloadPath() {
  return path.join(__dirname, "preload.js");
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out while starting the local PyCollab IDE service.");
}

async function startLocalService() {
  serverPort = await findOpenPort();
  const pythonCommand = resolvePythonCommand();
  const appRoot = getAppRoot();
  const env = {
    ...process.env,
    PYCOLLAB_PYODIDE_BASE_URL: process.env.PYCOLLAB_PYODIDE_BASE_URL || "/vendor/pyodide/v0.29.3/full/",
    PYTHONPATH: [process.env.PYTHONPATH, appRoot].filter(Boolean).join(path.delimiter),
  };

  appendLog(`Starting local service with python: ${pythonCommand}`);
  appendLog(`App root: ${appRoot}`);

  serverProcess = childProcess.spawn(
    pythonCommand,
    ["-m", "uvicorn", "server.ide_app:app", "--host", "127.0.0.1", "--port", String(serverPort)],
    {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  serverProcess.stdout?.on("data", (chunk) => appendLog(String(chunk).trimEnd()));
  serverProcess.stderr?.on("data", (chunk) => appendLog(String(chunk).trimEnd()));

  serverProcess.on("exit", (code, signal) => {
    appendLog(`Local service exited with code=${code} signal=${signal}`);
    serverProcess = null;
  });

  const url = `http://127.0.0.1:${serverPort}`;
  await waitForServer(url);
  return url;
}

function registerDevicePermissions() {
  const allowedPermissions = new Set(["bluetooth", "usb", "hid", "serial"]);
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((webContents, permission) => {
    return allowedPermissions.has(permission);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  if (typeof ses.setDevicePermissionHandler === "function") {
    ses.setDevicePermissionHandler(() => true);
  }

  if (typeof ses.setUSBProtectedClassesHandler === "function") {
    ses.setUSBProtectedClassesHandler(() => []);
  }
}

async function createMainWindow() {
  await session.defaultSession.clearCache();
  const serviceUrl = await startLocalService();
  registerDevicePermissions();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#121113",
    title: "PyCollab IDE",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
    },
  });

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on("did-fail-load", (event, code, description, validatedUrl) => {
    appendLog(`did-fail-load code=${code} description=${description} url=${validatedUrl}`);
  });

  mainWindow.webContents.on("render-process-gone", (event, details) => {
    appendLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    appendLog(`renderer-console level=${level} ${sourceId}:${line} ${message}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  appendLog(`Loading renderer URL ${serviceUrl}`);
  await mainWindow.loadURL(serviceUrl);
}

ipcMain.handle("pycollab:choose-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Local Project Folder",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle("pycollab:choose-create-location", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Project Location",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle("pycollab:reveal-path", async (event, targetPath) => {
  if (!targetPath) {
    return { ok: false };
  }
  shell.showItemInFolder(targetPath);
  return { ok: true };
});

ipcMain.handle("pycollab:get-desktop-context", async () => ({
  isDesktop: true,
  platform: process.platform,
  version: app.getVersion(),
}));

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      console.error(error);
      app.quit();
    });
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
