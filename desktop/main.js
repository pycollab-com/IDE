const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } = require("electron");
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
const RELEASE_OWNER = "pycollab-com";
const RELEASE_REPO = "IDE";
const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;
const MAC_BLUETOOTH_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth";

function getPersistentStatePath() {
  return path.join(app.getPath("userData"), "renderer-state.json");
}

function parsePersistentState(rawValue) {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function decodePersistentState(buffer) {
  if (!buffer?.length) {
    return {};
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return parsePersistentState(safeStorage.decryptString(buffer));
    } catch {
      // Fall back to plain text for older installs.
    }
  }

  return parsePersistentState(buffer.toString("utf8"));
}

function readPersistentState() {
  const statePath = getPersistentStatePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }

  try {
    return decodePersistentState(fs.readFileSync(statePath));
  } catch (error) {
    appendLog(`Failed to read persistent state: ${error?.message || error}`);
    return {};
  }
}

function writePersistentState(nextState) {
  const statePath = getPersistentStatePath();
  const payload = JSON.stringify(nextState && typeof nextState === "object" ? nextState : {});
  const encoded = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, "utf8");

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, encoded);
}

function removePersistentState() {
  fs.rmSync(getPersistentStatePath(), { force: true });
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Ignore logging failures.
  }
}

function normalizeVersion(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return (match ? match[1] : normalized.replace(/^v/i, "")).split("+")[0];
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function readBundledPackageVersion() {
  const candidatePaths = [
    path.join(__dirname, "package.json"),
    path.join(process.resourcesPath || "", "app", "package.json"),
  ];

  for (const candidate of candidatePaths) {
    if (!candidate || !fs.existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      const version = normalizeVersion(parsed?.version);
      if (version) {
        return version;
      }
    } catch (error) {
      appendLog(`Failed to read bundled package version from ${candidate}: ${error?.message || error}`);
    }
  }

  return "";
}

function getReportedAppVersion() {
  const bundleVersion = normalizeVersion(app.getVersion());
  const packagedVersion = readBundledPackageVersion();

  if (packagedVersion && compareVersions(packagedVersion, bundleVersion) > 0) {
    return packagedVersion;
  }

  return bundleVersion || packagedVersion || "0.0.0";
}

function chooseReleaseAsset(assets) {
  const candidates = Array.isArray(assets) ? assets.filter((asset) => asset?.browser_download_url) : [];

  if (process.platform === "darwin") {
    return (
      candidates.find((asset) => /\.dmg$/i.test(asset.name || "")) ||
      candidates.find((asset) => /\.zip$/i.test(asset.name || ""))
    );
  }

  if (process.platform === "win32") {
    return (
      candidates.find((asset) => /\.exe$/i.test(asset.name || "")) ||
      candidates.find((asset) => /\.msix$/i.test(asset.name || "")) ||
      candidates.find((asset) => /\.nupkg$/i.test(asset.name || ""))
    );
  }

  return null;
}

async function fetchLatestReleaseInfo() {
  appendLog(`Checking GitHub release feed ${RELEASES_API_URL}`);

  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "PyCollab IDE",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}`);
  }

  const release = await response.json();
  const currentVersion = getReportedAppVersion();
  const latestVersion = normalizeVersion(release.tag_name || release.name || "");

  if (!latestVersion) {
    throw new Error("GitHub release response did not include a version tag.");
  }

  const asset = chooseReleaseAsset(release.assets);
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

  return {
    checked_at: new Date().toISOString(),
    current_version: currentVersion,
    latest_version: latestVersion,
    update_available: updateAvailable,
    release_name: release.name || release.tag_name || latestVersion,
    release_url: release.html_url || `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases`,
    download_url: asset?.browser_download_url || null,
    asset_name: asset?.name || null,
    published_at: release.published_at || null,
    notes: typeof release.body === "string" ? release.body : "",
  };
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

async function openBluetoothPrivacySettings() {
  if (process.platform !== "darwin") {
    return { ok: false };
  }

  try {
    await shell.openExternal(MAC_BLUETOOTH_SETTINGS_URL);
    return { ok: true };
  } catch (error) {
    appendLog(`Failed to open Bluetooth privacy settings: ${error?.message || error}`);
    return { ok: false, error: error?.message || "Could not open Bluetooth settings." };
  }
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

function refreshPendingDeviceRequest({ kind, callback, nextDevices = [] }) {
  if (!pendingDeviceRequest || pendingDeviceRequest.kind !== kind) {
    return false;
  }

  pendingDeviceRequest.callback = callback;
  pendingDeviceRequest.rawDevices = nextDevices;
  updatePendingDeviceRequestDevices(pendingDeviceRequest, nextDevices);
  appendLog(`Refreshed device picker id=${pendingDeviceRequest.id} kind=${kind} devices=${nextDevices.length}`);
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
    if (refreshPendingDeviceRequest({ kind: "usb", callback, nextDevices: initialDevices })) {
      return;
    }
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
  const rendererUrl = String(process.env.PYCOLLAB_IDE_RENDERER_URL || "").trim();
  registerDevicePermissions();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#121113",
    title: "PyCollab IDE",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {}),
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
    if (refreshPendingDeviceRequest({ kind: "bluetooth", callback, nextDevices: devices })) {
      return;
    }
    beginPendingDeviceRequest({
      kind: "bluetooth",
      callback,
      initialDevices: devices,
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const loadUrl = rendererUrl
    ? `${rendererUrl}${rendererUrl.includes("?") ? "&" : "?"}localApiBase=${encodeURIComponent(serviceUrl)}`
    : serviceUrl;
  appendLog(`Loading renderer URL ${loadUrl}`);
  await mainWindow.loadURL(loadUrl);
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

ipcMain.handle("pycollab:choose-import-source", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Project",
    properties: ["openFile", "openDirectory", "createDirectory"],
    filters: [
      { name: "Supported project sources", extensions: ["zip", "py"] },
      { name: "ZIP archives", extensions: ["zip"] },
      { name: "Python files", extensions: ["py"] },
    ],
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
  version: getReportedAppVersion(),
}));

ipcMain.handle("pycollab:get-persistent-state", async () => {
  return readPersistentState();
});

ipcMain.handle("pycollab:set-persistent-state", async (event, nextState) => {
  try {
    const state = nextState && typeof nextState === "object" ? nextState : {};
    writePersistentState(state);
    return { ok: true, state };
  } catch (error) {
    appendLog(`Failed to write persistent state: ${error?.stack || error}`);
    return { ok: false, error: error?.message || "Could not store IDE state." };
  }
});

ipcMain.handle("pycollab:clear-persistent-state", async () => {
  try {
    removePersistentState();
    return { ok: true };
  } catch (error) {
    appendLog(`Failed to clear persistent state: ${error?.stack || error}`);
    return { ok: false, error: error?.message || "Could not clear IDE state." };
  }
});

ipcMain.handle("pycollab:check-app-update", async () => {
  try {
    return {
      ok: true,
      ...await fetchLatestReleaseInfo(),
    };
  } catch (error) {
    appendLog(`Update check failed: ${error?.stack || error}`);
    return {
      ok: false,
      error: error?.message || "Could not check for updates.",
      current_version: getReportedAppVersion(),
    };
  }
});

ipcMain.handle("pycollab:open-app-update", async (event, targetUrl) => {
  const nextUrl = String(targetUrl || "").trim();
  if (!nextUrl || !/^https:\/\//i.test(nextUrl)) {
    return { ok: false };
  }
  await shell.openExternal(nextUrl);
  return { ok: true };
});

ipcMain.handle("pycollab:open-external-url", async (event, targetUrl) => {
  const nextUrl = String(targetUrl || "").trim();
  if (!nextUrl || !/^https:\/\//i.test(nextUrl)) {
    return { ok: false };
  }
  await shell.openExternal(nextUrl);
  return { ok: true };
});

ipcMain.handle("pycollab:copy-text", async (event, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

ipcMain.handle("pycollab:open-bluetooth-settings", async () => {
  return openBluetoothPrivacySettings();
});

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

app.whenReady().then(createMainWindow).catch((error) => {
  console.error(error);
  app.quit();
});

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
