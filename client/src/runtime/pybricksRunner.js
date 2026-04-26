const PYBRICKS_SERVICE_UUID = "c5f50001-8280-46da-89f4-6d8051e4aeef";
const PYBRICKS_CONTROL_EVENT_CHARACTERISTIC_UUID = "c5f50002-8280-46da-89f4-6d8051e4aeef";
const PYBRICKS_HUB_CAPABILITIES_CHARACTERISTIC_UUID = "c5f50003-8280-46da-89f4-6d8051e4aeef";

const PYBRICKS_USB_CLASS = 0xff;
const PYBRICKS_USB_SUBCLASS = 0xc5;
const PYBRICKS_USB_PROTOCOL = 0xf5;
const PYBRICKS_USB_REQUEST_MAX_LENGTH = 20;

const DEVICE_NAME_UUID = 0x2a00;
const FIRMWARE_REVISION_STRING_UUID = 0x2a26;

const STOP_FALLBACK_MS = 2000;
const MPY_SCRIPT_URL = new URL("@pybricks/mpy-cross-v6/build/mpy-cross-v6.js", import.meta.url).toString();
const MPY_WASM_URL = new URL("@pybricks/mpy-cross-v6/build/mpy-cross-v6.wasm", import.meta.url).toString();

const textEncoder = new TextEncoder();

const CommandType = {
  StopUserProgram: 0,
  StartUserProgram: 1,
  WriteUserProgramMeta: 3,
  WriteUserRam: 4,
  WriteStdin: 6,
};

const EventType = {
  StatusReport: 0,
  WriteStdout: 1,
};

const Status = {
  UserProgramRunning: 6,
};

const PybricksUsbInterfaceRequest = {
  Gatt: 0x01,
  Pybricks: 0x02,
};

const PybricksUsbInEndpointMessageType = {
  Response: 1,
  Event: 2,
};

const PybricksUsbOutEndpointMessageType = {
  Subscribe: 1,
  Command: 2,
};

let mpyCrossLoadPromise = null;

function makeRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, nested) => {
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    });
  } catch {
    return String(value);
  }
}

function loadMpyCrossFactory() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("PyBricks compiler requires a browser environment."));
  }
  if (typeof window.MpyCross === "function") {
    return Promise.resolve(window.MpyCross);
  }
  if (mpyCrossLoadPromise) {
    return mpyCrossLoadPromise;
  }

  mpyCrossLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MPY_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (typeof window.MpyCross === "function") {
        resolve(window.MpyCross);
        return;
      }
      reject(new Error("Failed to load the PyBricks compiler bundle."));
    };
    script.onerror = () => reject(new Error("Failed to load the PyBricks compiler bundle."));
    document.head.appendChild(script);
  });

  return mpyCrossLoadPromise;
}

function compileWithMpyCross(mpyCrossFactory, fileName, fileContents, options, wasmPath) {
  return new Promise((resolve, reject) => {
    try {
      const args = [fileName];
      if (Array.isArray(options) && options.length) {
        args.unshift(...options);
      }

      mpyCrossFactory({
        arguments: args,
        inputFileContents: fileContents,
        callback: (status, mpy, out, err) => resolve({ status, mpy, out, err }),
        locateFile: (path, scriptDirectory) => {
          if (path === "mpy-cross-v6.wasm" && wasmPath) {
            return wasmPath;
          }
          return `${scriptDirectory}${path}`;
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

function createStopUserProgramCommand() {
  return new Uint8Array([CommandType.StopUserProgram]);
}

function createStartUserProgramCommand(progId = 0) {
  return new Uint8Array([CommandType.StartUserProgram, progId]);
}

function createWriteUserProgramMetaCommand(size) {
  const msg = new Uint8Array(5);
  const view = new DataView(msg.buffer);
  view.setUint8(0, CommandType.WriteUserProgramMeta);
  view.setUint32(1, size, true);
  return msg;
}

function createWriteUserRamCommand(offset, payload) {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const msg = new Uint8Array(5 + data.byteLength);
  const view = new DataView(msg.buffer);
  view.setUint8(0, CommandType.WriteUserRam);
  view.setUint32(1, offset, true);
  msg.set(data, 5);
  return msg;
}

function createWriteStdinCommand(payload) {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const msg = new Uint8Array(1 + data.byteLength);
  msg[0] = CommandType.WriteStdin;
  msg.set(data, 1);
  return msg;
}

function statusToFlag(status) {
  return 1 << status;
}

function parseStatusReport(msg) {
  return {
    flags: msg.getUint32(1, true),
    runningProgId: msg.byteLength > 5 ? msg.getUint8(5) : 0,
    selectedSlot: msg.byteLength > 6 ? msg.getUint8(6) : 0,
  };
}

function uuid16(uuid) {
  return Number.parseInt(uuid.slice(4, 8), 16);
}

function sliceDataViewBuffer(view, offset = 0) {
  return view.buffer.slice(view.byteOffset + offset, view.byteOffset + view.byteLength);
}

function encodeUInt32LE(value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return buf;
}

function cString(str) {
  return textEncoder.encode(`${str}\x00`);
}

function fileNameToModuleName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed.toLowerCase().endsWith(".py")) return null;
  return trimmed.slice(0, -3).replaceAll("/", ".").replaceAll("\\", ".");
}

function fileNameToModulePath(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed.toLowerCase().endsWith(".py")) return null;
  return trimmed.replaceAll("\\", "/");
}

function findImportedModules(script) {
  const modules = new Set();
  if (typeof script !== "string") {
    return modules;
  }

  const normalized = script.replace(/\r\n/g, "\n");
  const importRegex = /^\s*import\s+([A-Za-z0-9_.,\s]+)/gm;
  const fromRegex = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm;

  for (const match of normalized.matchAll(importRegex)) {
    const rawGroup = match[1] || "";
    rawGroup
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/i)[0]?.trim())
      .filter(Boolean)
      .forEach((moduleName) => modules.add(moduleName));
  }

  for (const match of normalized.matchAll(fromRegex)) {
    if (match[1]) {
      modules.add(match[1].trim());
    }
  }

  return modules;
}

async function compileProjectFiles({ files, entryFileId, entryFileName, entryFileContent, compileFn }) {
  const normalizedFiles = Array.isArray(files) ? files : [];
  const derivedEntryFile =
    typeof entryFileContent === "string"
      ? {
          id: entryFileId ?? -1,
          name: entryFileName || "main.py",
          content: entryFileContent,
        }
      : null;
  const entryFile =
    derivedEntryFile ||
    normalizedFiles.find((file) => Number(file.id) === Number(entryFileId)) ||
    normalizedFiles.find((file) => String(file.name || "").toLowerCase() === "main.py") ||
    normalizedFiles[0];

  if (!entryFile) {
    throw new Error("No Python file is available to compile.");
  }

  const localModules = new Map();
  normalizedFiles.forEach((file) => {
    if (derivedEntryFile && String(file.name || "").trim() === derivedEntryFile.name) return;
    const moduleName = fileNameToModuleName(file.name);
    const path = fileNameToModulePath(file.name);
    if (!moduleName || !path) return;
    localModules.set(moduleName, {
      moduleName,
      path,
      contents: typeof file.content === "string" ? file.content : "",
    });
  });

  const pyFiles = new Map([
    [
      "__main__",
      {
        moduleName: "__main__",
        path: fileNameToModulePath(entryFile.name) || "main.py",
        contents: typeof entryFile.content === "string" ? entryFile.content : "",
      },
    ],
  ]);

  const checkedModules = new Set(["__main__"]);
  const uncheckedScripts = [pyFiles.get("__main__").contents];

  for (;;) {
    const uncheckedModules = new Set();

    uncheckedScripts.splice(0).forEach((script) => {
      findImportedModules(script).forEach((moduleName) => {
        if (!checkedModules.has(moduleName)) {
          uncheckedModules.add(moduleName);
        }
      });
    });

    if (!uncheckedModules.size) {
      break;
    }

    uncheckedModules.forEach((moduleName) => {
      const localFile = localModules.get(moduleName);
      if (localFile) {
        pyFiles.set(moduleName, localFile);
        uncheckedScripts.push(localFile.contents);
      }
      checkedModules.add(moduleName);
    });
  }

  const blobParts = [];

  for (const [moduleName, pyFile] of pyFiles) {
    const result = await compileFn(pyFile.path, pyFile.contents, undefined, MPY_WASM_URL);
    if (result.status !== 0 || !result.mpy) {
      throw new Error((result.err || []).join("\n") || `Failed to compile ${pyFile.path}.`);
    }
    blobParts.push(encodeUInt32LE(result.mpy.length));
    blobParts.push(cString(moduleName));
    blobParts.push(result.mpy);
  }

  return new Blob(blobParts);
}

class BlePybricksTransport {
  constructor({ onEvent, onDisconnect }) {
    this.onEvent = onEvent;
    this.onDisconnect = onDisconnect;
    this.transport = "bluetooth";
    this.label = "Bluetooth";
    this.device = null;
    this.server = null;
    this.controlCharacteristic = null;
    this.controlListener = null;
    this.disconnectListener = null;
    this.deviceName = "";
    this.maxWriteSize = 0;
    this.maxUserProgramSize = 0;
    this.numOfSlots = 0;
  }

  async connect() {
    if (!navigator?.bluetooth?.requestDevice) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [PYBRICKS_SERVICE_UUID] }],
      optionalServices: [PYBRICKS_SERVICE_UUID],
    });
    this.deviceName = this.device?.name || "Pybricks Hub";

    this.disconnectListener = () => {
      this.onDisconnect?.("Hub disconnected.");
    };
    this.device.addEventListener("gattserverdisconnected", this.disconnectListener);

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(PYBRICKS_SERVICE_UUID);
    this.controlCharacteristic = await service.getCharacteristic(PYBRICKS_CONTROL_EVENT_CHARACTERISTIC_UUID);
    const hubCapabilitiesCharacteristic = await service.getCharacteristic(PYBRICKS_HUB_CAPABILITIES_CHARACTERISTIC_UUID);
    const hubCapabilities = await hubCapabilitiesCharacteristic.readValue();

    this.maxWriteSize = hubCapabilities.getUint16(0, true);
    this.maxUserProgramSize = hubCapabilities.getUint32(6, true);
    this.numOfSlots = hubCapabilities.byteLength > 10 ? hubCapabilities.getUint8(10) : 0;

    this.controlListener = (event) => {
      const value = event?.target?.value;
      if (value) {
        this.onEvent?.(value);
      }
    };
    this.controlCharacteristic.addEventListener("characteristicvaluechanged", this.controlListener);
    await this.controlCharacteristic.startNotifications();
  }

  async sendCommand(command) {
    if (!this.controlCharacteristic) {
      throw new Error("Bluetooth hub is not ready.");
    }
    await this.controlCharacteristic.writeValueWithResponse(command);
  }

  async disconnect() {
    try {
      if (this.controlCharacteristic && this.controlListener) {
        this.controlCharacteristic.removeEventListener("characteristicvaluechanged", this.controlListener);
      }
      if (this.controlCharacteristic) {
        await this.controlCharacteristic.stopNotifications().catch(() => {});
      }
    } finally {
      this.controlCharacteristic = null;
      this.controlListener = null;
      if (this.device && this.disconnectListener) {
        this.device.removeEventListener("gattserverdisconnected", this.disconnectListener);
      }
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
      this.disconnectListener = null;
      this.server = null;
      this.device = null;
    }
  }
}

class UsbPybricksTransport {
  constructor({ onEvent, onDisconnect }) {
    this.onEvent = onEvent;
    this.onDisconnect = onDisconnect;
    this.transport = "usb";
    this.label = "USB";
    this.device = null;
    this.interfaceNumber = null;
    this.inEndpointNumber = null;
    this.inEndpointPacketSize = null;
    this.outEndpointNumber = null;
    this.deviceName = "";
    this.maxWriteSize = 0;
    this.maxUserProgramSize = 0;
    this.numOfSlots = 0;
    this.closed = false;
    this.pendingCommand = null;
    this.commandChain = Promise.resolve();
    this.disconnectListener = null;
  }

  async connect() {
    if (!navigator?.usb?.requestDevice) {
      throw new Error("WebUSB is not available in this browser.");
    }

    this.device = await navigator.usb.requestDevice({
      filters: [
        {
          classCode: PYBRICKS_USB_CLASS,
          subclassCode: PYBRICKS_USB_SUBCLASS,
          protocolCode: PYBRICKS_USB_PROTOCOL,
        },
      ],
    });
    this.deviceName = this.device?.productName || "Pybricks Hub";
    this.closed = false;

    this.disconnectListener = (event) => {
      if (event?.device === this.device) {
        this.onDisconnect?.("Hub disconnected.");
      }
    };
    navigator.usb.addEventListener("disconnect", this.disconnectListener);

    await this.device.open();
    if (!this.device.configuration) {
      await this.device.selectConfiguration(1);
    }

    const iface = this.device.configuration?.interfaces?.find(
      (entry) =>
        entry.alternate.interfaceClass === PYBRICKS_USB_CLASS &&
        entry.alternate.interfaceSubclass === PYBRICKS_USB_SUBCLASS &&
        entry.alternate.interfaceProtocol === PYBRICKS_USB_PROTOCOL,
    );
    if (!iface) {
      throw new Error("The selected USB device does not expose the Pybricks interface.");
    }

    this.interfaceNumber = iface.interfaceNumber;
    const inEndpoint = iface.alternate.endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk");
    const outEndpoint = iface.alternate.endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk");

    if (!inEndpoint || !outEndpoint) {
      throw new Error("The selected USB device is missing the required Pybricks endpoints.");
    }

    this.inEndpointNumber = inEndpoint.endpointNumber;
    this.inEndpointPacketSize = inEndpoint.packetSize;
    this.outEndpointNumber = outEndpoint.endpointNumber;

    await this.device.claimInterface(this.interfaceNumber);

    const hubCapabilities = await this.device.controlTransferIn(
      {
        requestType: "class",
        recipient: "interface",
        request: PybricksUsbInterfaceRequest.Pybricks,
        value: uuid16(PYBRICKS_HUB_CAPABILITIES_CHARACTERISTIC_UUID),
        index: 0x00,
      },
      PYBRICKS_USB_REQUEST_MAX_LENGTH,
    );

    if (hubCapabilities?.status !== "ok" || !hubCapabilities.data) {
      throw new Error("Failed to read Pybricks USB hub capabilities.");
    }

    const view = new DataView(hubCapabilities.data.buffer);
    this.maxWriteSize = view.getUint16(0, true);
    this.maxUserProgramSize = view.getUint32(6, true);
    this.numOfSlots = view.byteLength > 10 ? view.getUint8(10) : 0;

    try {
      const deviceName = await this.device.controlTransferIn(
        {
          requestType: "class",
          recipient: "interface",
          request: PybricksUsbInterfaceRequest.Gatt,
          value: DEVICE_NAME_UUID,
          index: 0x00,
        },
        PYBRICKS_USB_REQUEST_MAX_LENGTH,
      );
      if (deviceName?.status === "ok" && deviceName.data) {
        this.deviceName = new TextDecoder("utf-8").decode(deviceName.data.buffer).replace(/\0/g, "") || this.deviceName;
      }
    } catch {
      // Device name is optional for the UI.
    }

    try {
      await this.device.controlTransferIn(
        {
          requestType: "class",
          recipient: "interface",
          request: PybricksUsbInterfaceRequest.Gatt,
          value: FIRMWARE_REVISION_STRING_UUID,
          index: 0x00,
        },
        PYBRICKS_USB_REQUEST_MAX_LENGTH,
      );
    } catch {
      // Firmware revision is optional for this integration.
    }

    this._startReceiveLoop();
    await this._sendSubscribe(true);
  }

  _startReceiveLoop() {
    const loop = async () => {
      while (!this.closed && this.device) {
        try {
          const result = await this.device.transferIn(this.inEndpointNumber, this.inEndpointPacketSize);
          if (this.closed || !result?.data || result.status !== "ok" || result.data.byteLength < 1) {
            continue;
          }

          const messageType = result.data.getUint8(0);
          if (messageType === PybricksUsbInEndpointMessageType.Response) {
            const statusCode = result.data.getUint32(1, true);
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            pending?.resolve(statusCode);
            continue;
          }

          if (messageType === PybricksUsbInEndpointMessageType.Event) {
            this.onEvent?.(new DataView(sliceDataViewBuffer(result.data, 1)));
          }
        } catch (error) {
          if (!this.closed) {
            this.onDisconnect?.(normalizeText(error?.message, "USB hub disconnected."));
          }
          return;
        }
      }
    };

    void loop();
  }

  async _sendSubscribe(enabled) {
    if (!this.device) {
      throw new Error("USB hub is not ready.");
    }
    const payload = new Uint8Array([PybricksUsbOutEndpointMessageType.Subscribe, enabled ? 1 : 0]);
    const result = await this.device.transferOut(this.outEndpointNumber, payload);
    if (result?.status !== "ok") {
      throw new Error(`Failed to ${enabled ? "subscribe to" : "unsubscribe from"} USB hub events.`);
    }
  }

  async sendCommand(command) {
    if (!this.device) {
      throw new Error("USB hub is not ready.");
    }

    this.commandChain = this.commandChain.then(async () => {
      const payload = new Uint8Array(1 + command.byteLength);
      payload[0] = PybricksUsbOutEndpointMessageType.Command;
      payload.set(command, 1);

      const responsePromise = new Promise((resolve, reject) => {
        const timeoutId = globalThis.setTimeout(() => {
          if (this.pendingCommand?.timeoutId === timeoutId) {
            this.pendingCommand = null;
          }
          reject(new Error("Timed out waiting for USB command response."));
        }, 1000);
        this.pendingCommand = {
          resolve: (statusCode) => {
            globalThis.clearTimeout(timeoutId);
            resolve(statusCode);
          },
          reject,
          timeoutId,
        };
      });

      const result = await this.device.transferOut(this.outEndpointNumber, payload);
      if (result?.status !== "ok") {
        const pending = this.pendingCommand;
        this.pendingCommand = null;
        if (pending?.timeoutId) {
          globalThis.clearTimeout(pending.timeoutId);
        }
        throw new Error("Failed to send USB command.");
      }

      const statusCode = await responsePromise;
      if (statusCode !== 0) {
        throw new Error(`USB command failed with status code ${statusCode}.`);
      }
    });

    return this.commandChain;
  }

  async disconnect() {
    this.closed = true;
    try {
      if (this.device && this.outEndpointNumber !== null) {
        await this._sendSubscribe(false).catch(() => {});
      }
      if (this.device && this.interfaceNumber !== null) {
        await this.device.releaseInterface(this.interfaceNumber).catch(() => {});
      }
      if (this.device) {
        await this.device.close().catch(() => {});
      }
    } finally {
      if (this.disconnectListener) {
        navigator.usb.removeEventListener("disconnect", this.disconnectListener);
      }
      if (this.pendingCommand?.timeoutId) {
        globalThis.clearTimeout(this.pendingCommand.timeoutId);
      }
      this.pendingCommand = null;
      this.device = null;
      this.interfaceNumber = null;
      this.inEndpointNumber = null;
      this.inEndpointPacketSize = null;
      this.outEndpointNumber = null;
      this.disconnectListener = null;
    }
  }
}

export class PybricksRunner {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.compileFn = null;
    this.transport = null;
    this.workerReady = false;
    this.running = false;
    this.disposed = false;
    this.bootPromise = null;
    this.currentRunId = null;
    this.currentRunWasUserStop = false;
    this.waitingForStop = [];
    this.connectionState = {
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      maxWriteSize: 0,
      maxUserProgramSize: 0,
      numOfSlots: 0,
      selectedSlot: 0,
      hubRunning: false,
    };
    this.stdoutDecoder = new TextDecoder();
  }

  _emit(name, payload) {
    const fn = this.callbacks[name];
    if (typeof fn === "function") {
      fn(payload);
    }
  }

  _setConnectionState(patch) {
    this.connectionState = {
      ...this.connectionState,
      ...patch,
    };
    this._emit("onConnectionChange", this.connectionState);
  }

  async init() {
    if (this.disposed) {
      throw new Error("Runner is disposed.");
    }
    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = (async () => {
      const mpyCrossFactory = await loadMpyCrossFactory();
      this.compileFn = (fileName, fileContents, options, wasmPath) =>
        compileWithMpyCross(mpyCrossFactory, fileName, fileContents, options, wasmPath);
      this.workerReady = true;
      this._emit("onReady", { stdinMode: "message" });
      this._setConnectionState({ status: "disconnected" });
    })();

    try {
      await this.bootPromise;
    } catch (error) {
      this._emit("onError", normalizeText(error?.message, "PyBricks compiler failed to initialize."));
      throw error;
    } finally {
      this.bootPromise = null;
    }
  }

  async _connect(kind) {
    if (this.disposed) {
      throw new Error("Runner is disposed.");
    }
    await this.init();

    const nextTransport =
      kind === "bluetooth"
        ? new BlePybricksTransport({
            onEvent: (event) => this._handleHubEvent(event),
            onDisconnect: (message) => this._handleTransportDisconnect(message),
          })
        : new UsbPybricksTransport({
            onEvent: (event) => this._handleHubEvent(event),
            onDisconnect: (message) => this._handleTransportDisconnect(message),
          });

    if (this.transport) {
      await this.transport.disconnect().catch(() => {});
      this.transport = null;
    }

    this._setConnectionState({
      connected: false,
      status: "connecting",
      transport: kind,
      transportLabel: nextTransport.label,
      deviceName: "",
    });
    this._emit("onStderr", `[pybricks] Connecting via ${nextTransport.label}...\n`);

    try {
      await nextTransport.connect();
      this.transport = nextTransport;
      this._setConnectionState({
        connected: true,
        status: "connected",
        transport: nextTransport.transport,
        transportLabel: nextTransport.label,
        deviceName: nextTransport.deviceName,
        maxWriteSize: nextTransport.maxWriteSize,
        maxUserProgramSize: nextTransport.maxUserProgramSize,
        numOfSlots: nextTransport.numOfSlots,
      });
      this._emit("onStderr", `[pybricks] Connected to ${nextTransport.deviceName} via ${nextTransport.label}.\n`);
    } catch (error) {
      this.transport = null;
      this._setConnectionState({
        connected: false,
        status: "disconnected",
        transport: null,
        transportLabel: "",
        deviceName: "",
      });
      throw error;
    }
  }

  async connectBluetooth() {
    return this._connect("bluetooth");
  }

  async connectUsb() {
    return this._connect("usb");
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.disconnect().catch(() => {});
    }
    this.transport = null;
    const wasRunning = this.running;
    this._setConnectionState({
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      hubRunning: false,
    });
    if (wasRunning) {
      this._finalizeRun(130);
    }
  }

  _handleTransportDisconnect(message) {
    const wasRunning = this.running;
    this.transport = null;
    this._setConnectionState({
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      hubRunning: false,
    });
    this._emit("onStderr", `[pybricks] ${message || "Hub disconnected."}\n`);
    if (wasRunning) {
      this._emit("onStatus", { state: "stopped" });
      this._finalizeRun(130);
    }
  }

  _finalizeRun(returnCode) {
    const runId = this.currentRunId;
    this.running = false;
    this.currentRunId = null;
    this.currentRunWasUserStop = false;
    this._emit("onRunResult", { runId, returnCode });
    const waiters = this.waitingForStop.splice(0, this.waitingForStop.length);
    waiters.forEach((resolve) => resolve());
  }

  _waitForStopped() {
    if (!this.running) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitingForStop.push(resolve);
    });
  }

  _handleHubEvent(event) {
    if (!event) return;
    const type = event.getUint8(0);

    if (type === EventType.StatusReport) {
      const status = parseStatusReport(event);
      const hubRunning = Boolean(status.flags & statusToFlag(Status.UserProgramRunning));
      const wasRunning = this.running;
      this._setConnectionState({
        hubRunning,
        selectedSlot: status.selectedSlot,
      });

      if (wasRunning && !hubRunning) {
        this._emit("onStatus", { state: "stopped" });
        this._finalizeRun(this.currentRunWasUserStop ? 130 : 0);
      }
      return;
    }

    if (type === EventType.WriteStdout) {
      const payload = sliceDataViewBuffer(event, 1);
      const text = this.stdoutDecoder.decode(new Uint8Array(payload), { stream: true });
      if (text) {
        this._emit("onStdout", text);
      }
    }
  }

  async run({ files, entryFileId, entryFileName, entryFileContent }) {
    if (this.disposed) {
      throw new Error("Runner is disposed.");
    }
    if (!this.workerReady || !this.compileFn) {
      throw new Error("PyBricks compiler is not ready.");
    }
    if (!this.transport || !this.connectionState.connected) {
      throw new Error("Connect a PyBricks hub before running.");
    }
    if (this.running) {
      throw new Error("A run is already in progress.");
    }

    const compiled = await compileProjectFiles({
      files,
      entryFileId,
      entryFileName,
      entryFileContent,
      compileFn: this.compileFn,
    });

    if (compiled.size > this.connectionState.maxUserProgramSize) {
      throw new Error(
        `Compiled program is ${compiled.size} bytes, exceeding the hub limit of ${this.connectionState.maxUserProgramSize} bytes.`,
      );
    }

    const chunkSize = Math.max(1, this.connectionState.maxWriteSize - 5);
    const programBytes = new Uint8Array(await compiled.arrayBuffer());
    const slot = this.connectionState.selectedSlot || 0;

    this._emit("onStderr", `[pybricks] Compiled ${compiled.size} bytes. Downloading over ${this.connectionState.transportLabel}...\n`);

    await this.transport.sendCommand(createWriteUserProgramMetaCommand(0));

    for (let offset = 0; offset < programBytes.byteLength; offset += chunkSize) {
      const chunk = programBytes.slice(offset, offset + chunkSize);
      await this.transport.sendCommand(createWriteUserRamCommand(offset, chunk));
    }

    await this.transport.sendCommand(createWriteUserProgramMetaCommand(programBytes.byteLength));
    await this.transport.sendCommand(createStartUserProgramCommand(slot));

    this.currentRunId = makeRunId();
    this.currentRunWasUserStop = false;
    this.running = true;
    this._emit("onStatus", { state: "running" });
    this._emit("onStderr", "[pybricks] Program downloaded. Hub started.\n");
  }

  sendStdin(data) {
    if (!this.running || !this.transport) {
      return false;
    }

    const payload = textEncoder.encode(String(data || ""));
    this.transport
      .sendCommand(createWriteStdinCommand(payload))
      .catch((error) => {
        this._emit("onError", normalizeText(error?.message, "Failed to send stdin to hub."));
      });

    return true;
  }

  async stop() {
    if (!this.transport || !this.running) {
      return;
    }

    this.currentRunWasUserStop = true;
    await this.transport.sendCommand(createStopUserProgramCommand());

    const stopped = this._waitForStopped();
    const timeout = new Promise((resolve) => {
      globalThis.setTimeout(resolve, STOP_FALLBACK_MS);
    });
    await Promise.race([stopped, timeout]);

    if (this.running) {
      this._emit("onStatus", { state: "stopped" });
      this._finalizeRun(130);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.transport) {
      this.transport.disconnect().catch(() => {});
    }
    this.transport = null;
    this.workerReady = false;
    this.running = false;
    this.currentRunId = null;
    this.currentRunWasUserStop = false;
    const waiters = this.waitingForStop.splice(0, this.waitingForStop.length);
    waiters.forEach((resolve) => resolve());
  }
}

export default PybricksRunner;
