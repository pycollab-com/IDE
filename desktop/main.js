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
let devicePermissionsRegistered = false;
let nextDeviceRequestId = 1;
let pendingDeviceRequest = null;

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

function formatUsbHex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return `0x${parsed.toString(16).padStart(4, "0")}`;
}

function normalizeBluetoothDevices(devices) {
  return (Array.isArray(devices) ? devices : [])
    .filter((device) => device?.deviceId)
    .map((device) => ({
      id: String(device.deviceId),
      name: device.deviceName || "Unnamed Bluetooth hub",
      detail: String(device.deviceId),
    }));
}

function normalizeUsbDevices(devices) {
  return (Array.isArray(devices) ? devices : [])
    .filter((device) => device?.deviceId)
    .map((device) => {
      const vendorId = formatUsbHex(device.vendorId);
      const productId = formatUsbHex(device.productId);
      const identity = [vendorId, productId].filter(Boolean).join(" / ");
      return {
        id: String(device.deviceId),
        name: device.productName || device.deviceName || "Unnamed USB hub",
        detail: identity || device.serialNumber || String(device.deviceId),
      };
    });
}

function sameDeviceLists(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((device, index) => {
    const next = right[index];
    return next && device.id === next.id && device.name === next.name && device.detail === next.detail;
  });
}

function sendDevicePickerState(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("pycollab:device-picker", payload);
}

function updatePendingDeviceRequestDevices(request, nextDevices) {
  if (!pendingDeviceRequest || pendingDeviceRequest.id !== request.id) {
    return;
  }

  if (sameDeviceLists(pendingDeviceRequest.devices, nextDevices)) {
    return;
  }

  pendingDeviceRequest.devices = nextDevices;
  appendLog(`Device picker update id=${request.id} kind=${request.kind} devices=${nextDevices.length}`);
  sendDevicePickerState({
    id: request.id,
    kind: request.kind,
    devices: nextDevices,
  });
}

function finishPendingDeviceRequest(selectionId = null) {
  const request = pendingDeviceRequest;
  if (!request) {
    return false;
  }

  pendingDeviceRequest = null;

  if (request.refreshTimer) {
    clearInterval(request.refreshTimer);
  }
  if (request.timeoutId) {
    clearTimeout(request.timeoutId);
  }

  sendDevicePickerState(null);

  try {
    if (request.kind === "bluetooth") {
      request.callback(selectionId || "");
    } else if (selectionId) {
      request.callback(selectionId);
    } else {
      request.callback();
    }
  } catch (error) {
    appendLog(`Failed to finish device picker request: ${error?.message || error}`);
  }

  return true;
}

function beginPendingDeviceRequest({ kind, callback, initialDevices = [], refreshDevices = null }) {
  if (pendingDeviceRequest) {
    appendLog(`Cancelling stale device picker id=${pendingDeviceRequest.id} kind=${pendingDeviceRequest.kind}`);
    finishPendingDeviceRequest(null);
  }

  const request = {
    id: `picker-${nextDeviceRequestId++}`,
    kind,
    callback,
    rawDevices: initialDevices,
    refreshDevices,
    devices: [],
    refreshTimer: null,
    timeoutId: null,
  };

  pendingDeviceRequest = request;
  updatePendingDeviceRequestDevices(request, initialDevices);
  sendDevicePickerState({
    id: request.id,
    kind: request.kind,
    devices: request.devices,
  });

  if (refreshDevices) {
    request.refreshTimer = setInterval(() => {
      request.rawDevices = refreshDevices();
      updatePendingDeviceRequestDevices(request, request.rawDevices);
    }, 250);
  }

  request.timeoutId = setTimeout(() => {
    if (!pendingDeviceRequest || pendingDeviceRequest.id !== request.id) {
      return;
    }
    appendLog(`Device picker timed out id=${request.id} kind=${request.kind}`);
    finishPendingDeviceRequest(null);
  }, 30000);

  appendLog(`Opened device picker id=${request.id} kind=${request.kind}`);
  return request;
}

function registerDevicePermissions() {
  if (devicePermissionsRegistered) {
    return;
  }
  devicePermissionsRegistered = true;

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

  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const initialDevices = normalizeUsbDevices(details?.deviceList);
    beginPendingDeviceRequest({
      kind: "usb",
      callback,
      initialDevices,
    });
  });

  ses.on("usb-device-added", (event, device) => {
    if (!pendingDeviceRequest || pendingDeviceRequest.kind !== "usb") {
      return;
    }
    const nextDevices = [...pendingDeviceRequest.devices.filter((entry) => entry.id !== String(device.deviceId)), ...normalizeUsbDevices([device])];
    updatePendingDeviceRequestDevices(pendingDeviceRequest, nextDevices);
  });

  ses.on("usb-device-removed", (event, device) => {
    if (!pendingDeviceRequest || pendingDeviceRequest.kind !== "usb") {
      return;
    }
    const nextDevices = pendingDeviceRequest.devices.filter((entry) => entry.id !== String(device.deviceId));
    updatePendingDeviceRequestDevices(pendingDeviceRequest, nextDevices);
  });
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

  mainWindow.on("closed", () => {
    finishPendingDeviceRequest(null);
    mainWindow = null;
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

  mainWindow.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    const devices = normalizeBluetoothDevices(deviceList);
    appendLog(
      `select-bluetooth-device count=${devices.length} devices=${devices
        .map((device) => `${device.name}:${device.id}`)
        .join(", ")}`
    );
    beginPendingDeviceRequest({
      kind: "bluetooth",
      callback,
      initialDevices: devices,
      refreshDevices: () => normalizeBluetoothDevices(deviceList),
    });
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

ipcMain.handle("pycollab:resolve-device-picker", async (event, payload) => {
  const requestId = String(payload?.requestId || "");
  const deviceId = String(payload?.deviceId || "");

  if (!pendingDeviceRequest || pendingDeviceRequest.id !== requestId || !deviceId) {
    return { ok: false };
  }

  appendLog(`Resolving device picker id=${requestId} device=${deviceId}`);
  finishPendingDeviceRequest(deviceId);
  return { ok: true };
});

ipcMain.handle("pycollab:cancel-device-picker", async (event, requestId) => {
  if (!pendingDeviceRequest || pendingDeviceRequest.id !== String(requestId || "")) {
    return { ok: false };
  }

  appendLog(`Cancelling device picker id=${pendingDeviceRequest.id}`);
  finishPendingDeviceRequest(null);
  return { ok: true };
});

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
  finishPendingDeviceRequest(null);
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
