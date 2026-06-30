import {
  createHubMonitorBootstrap,
  createHubMonitorSource,
  estimateBatteryPercent,
  getHubMonitorPrefix,
  getHubPortNames,
  parseHubMonitorPayload,
} from "./pybricksHubMonitor.js";

const PYBRICKS_SERVICE_UUID = "c5f50001-8280-46da-89f4-6d8051e4aeef";
const PYBRICKS_CONTROL_EVENT_CHARACTERISTIC_UUID = "c5f50002-8280-46da-89f4-6d8051e4aeef";
const PYBRICKS_HUB_CAPABILITIES_CHARACTERISTIC_UUID = "c5f50003-8280-46da-89f4-6d8051e4aeef";

const PYBRICKS_USB_CLASS = 0xff;
const PYBRICKS_USB_SUBCLASS = 0xc5;
const PYBRICKS_USB_PROTOCOL = 0xf5;
const PYBRICKS_USB_REQUEST_MAX_LENGTH = 20;

const DEVICE_INFORMATION_SERVICE_UUID = 0x180a;
const DEVICE_NAME_UUID = 0x2a00;
const FIRMWARE_REVISION_STRING_UUID = 0x2a26;
const SOFTWARE_REVISION_STRING_UUID = 0x2a28;
const PNP_ID_UUID = 0x2a50;

const LEGO_COMPANY_ID = 0x0397;
const HubType = {
  MoveHub: 0x40,
  CityHub: 0x41,
  TechnicHub: 0x80,
  TechnicLargeHub: 0x81,
  TechnicSmallHub: 0x83,
};

const STOP_FALLBACK_MS = 2000;
const MONITOR_START_TIMEOUT_MS = 8000;
const MPY_SCRIPT_URL = new URL("@pybricks/mpy-cross-v6/build/mpy-cross-v6.js", import.meta.url).toString();
const MPY_WASM_URL = new URL("@pybricks/mpy-cross-v6/build/mpy-cross-v6.wasm", import.meta.url).toString();

const textEncoder = new TextEncoder();

const CommandType = {
  StopUserProgram: 0,
  StartUserProgram: 1,
  StartRepl: 2,
  WriteUserProgramMeta: 3,
  WriteUserRam: 4,
  WriteStdin: 6,
};

const BuiltinProgramId = {
  Repl: 0x80,
};

const HubCapabilityFlag = {
  HasRepl: 1 << 0,
};

const EventType = {
  StatusReport: 0,
  WriteStdout: 1,
  WriteTelemetry: 3,
};

const Status = {
  BatteryLowVoltageWarning: 0,
  BatteryLowVoltageShutdown: 1,
  BatteryHighCurrent: 2,
  BleLowSignal: 4,
  UserProgramRunning: 6,
  Shutdown: 7,
  ShutdownRequested: 8,
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

function createLegacyStartReplCommand() {
  return new Uint8Array([CommandType.StartRepl]);
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

function isProfileBefore(version, major, minor) {
  const match = String(version || "").match(/^(\d+)\.(\d+)/);
  if (!match) return null;
  const currentMajor = Number(match[1]);
  const currentMinor = Number(match[2]);
  return currentMajor < major || (currentMajor === major && currentMinor < minor);
}

function decodeTextValue(value) {
  if (!value) return "";
  return new TextDecoder("utf-8").decode(sliceDataViewBuffer(value)).replace(/\0/g, "").trim();
}

function decodePnpId(value) {
  if (!value || value.byteLength < 7) return null;
  return {
    vendorIdSource: value.getUint8(0),
    vendorId: value.getUint16(1, true),
    productId: value.getUint16(3, true),
    productVersion: value.getUint16(5, true),
  };
}

function getHubTypeName(pnpId) {
  if (!pnpId) return "";
  if (pnpId.vendorIdSource !== 1) return "USB hub";
  if (pnpId.vendorId !== LEGO_COMPANY_ID) return "Non-LEGO hub";

  switch (pnpId.productId) {
    case HubType.MoveHub:
      return "Move Hub";
    case HubType.CityHub:
      return "City Hub";
    case HubType.TechnicHub:
      return "Technic Hub";
    case HubType.TechnicLargeHub:
      return pnpId.productVersion === 1 ? "Inventor Hub" : "Prime Hub";
    case HubType.TechnicSmallHub:
      return "Essential Hub";
    default:
      return "LEGO Hub";
  }
}

function getBatteryState(flags) {
  if (flags & statusToFlag(Status.BatteryLowVoltageShutdown)) return "critical";
  if (flags & statusToFlag(Status.BatteryLowVoltageWarning)) return "low";
  if (flags & statusToFlag(Status.BatteryHighCurrent)) return "high-current";
  return "ok";
}

function getHubWarnings(flags) {
  const warnings = [];
  if (flags & statusToFlag(Status.BatteryHighCurrent)) warnings.push("High battery current");
  if (flags & statusToFlag(Status.BleLowSignal)) warnings.push("Low Bluetooth signal");
  if (flags & (statusToFlag(Status.Shutdown) | statusToFlag(Status.ShutdownRequested))) {
    warnings.push("Hub shutting down");
  }
  return warnings;
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
    this.writeQueue = Promise.resolve();
    this.deviceName = "";
    this.maxWriteSize = 0;
    this.maxUserProgramSize = 0;
    this.numOfSlots = 0;
    this.featureFlags = 0;
    this.firmwareVersion = "";
    this.protocolVersion = "";
    this.hubType = "";
  }

  async connect() {
    if (!navigator?.bluetooth?.requestDevice) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [PYBRICKS_SERVICE_UUID] }],
      optionalServices: [PYBRICKS_SERVICE_UUID, DEVICE_INFORMATION_SERVICE_UUID],
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
    this.featureFlags = hubCapabilities.getUint32(2, true);
    this.maxUserProgramSize = hubCapabilities.getUint32(6, true);
    this.numOfSlots = hubCapabilities.byteLength > 10 ? hubCapabilities.getUint8(10) : 0;

    try {
      const deviceInformationService = await this.server.getPrimaryService(DEVICE_INFORMATION_SERVICE_UUID);
      const readCharacteristic = async (uuid) => {
        try {
          const characteristic = await deviceInformationService.getCharacteristic(uuid);
          return await characteristic.readValue();
        } catch {
          return null;
        }
      };
      const [firmware, protocol, pnpId] = await Promise.all([
        readCharacteristic(FIRMWARE_REVISION_STRING_UUID),
        readCharacteristic(SOFTWARE_REVISION_STRING_UUID),
        readCharacteristic(PNP_ID_UUID),
      ]);
      this.firmwareVersion = decodeTextValue(firmware);
      this.protocolVersion = decodeTextValue(protocol);
      this.hubType = getHubTypeName(decodePnpId(pnpId));
    } catch {
      // Device information is useful but not required to run programs.
    }

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
    // Web Bluetooth permits only one in-flight GATT operation. The hub monitor
    // and a program download can both issue writes, so serialize them through a
    // single chain — otherwise overlapping writes throw "GATT operation already
    // in progress." Keep the chain alive after a rejection so it never wedges.
    const write = () => this.controlCharacteristic.writeValueWithResponse(command);
    this.writeQueue = this.writeQueue.then(write, write);
    return this.writeQueue;
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
    this.featureFlags = 0;
    this.firmwareVersion = "";
    this.protocolVersion = "";
    this.hubType = "";
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

    const view = hubCapabilities.data;
    this.maxWriteSize = view.getUint16(0, true);
    this.featureFlags = view.getUint32(2, true);
    this.maxUserProgramSize = view.getUint32(6, true);
    this.numOfSlots = view.byteLength > 10 ? view.getUint8(10) : 0;

    const readGattValue = async (uuid) => {
      try {
        const result = await this.device.controlTransferIn(
          {
            requestType: "class",
            recipient: "interface",
            request: PybricksUsbInterfaceRequest.Gatt,
            value: uuid,
            index: 0x00,
          },
          PYBRICKS_USB_REQUEST_MAX_LENGTH,
        );
        return result?.status === "ok" && result.data ? result.data : null;
      } catch {
        return null;
      }
    };

    try {
      const [deviceName, firmware, protocol, pnpId] = await Promise.all([
        readGattValue(DEVICE_NAME_UUID),
        readGattValue(FIRMWARE_REVISION_STRING_UUID),
        readGattValue(SOFTWARE_REVISION_STRING_UUID),
        readGattValue(PNP_ID_UUID),
      ]);
      this.deviceName = decodeTextValue(deviceName) || this.deviceName;
      this.firmwareVersion = decodeTextValue(firmware);
      this.protocolVersion = decodeTextValue(protocol);
      this.hubType = getHubTypeName(decodePnpId(pnpId));
    } catch {
      // Device information is useful but not required to run programs.
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
    this.monitorRunning = false;
    this.monitorStarting = false;
    this.monitorGeneration = 0;
    this.monitorStdoutBuffer = "";
    this.programStdoutBuffer = "";
    this.monitorOutputBuffer = "";
    this.monitorOutputWaiter = null;
    this.monitorRestartTimer = null;
    this.monitorRetryCount = 0;
    this.connectionState = {
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      hubType: "",
      firmwareVersion: "",
      protocolVersion: "",
      maxWriteSize: 0,
      maxUserProgramSize: 0,
      featureFlags: 0,
      numOfSlots: 0,
      selectedSlot: 0,
      hubRunning: false,
      batteryState: "unknown",
      batteryVoltage: null,
      batteryPercent: null,
      ports: [],
      motion: null,
      buttons: [],
      telemetryAvailable: false,
      telemetryError: "",
      statusFlags: 0,
      warnings: [],
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
      hubType: "",
      firmwareVersion: "",
      protocolVersion: "",
      batteryState: "unknown",
      statusFlags: 0,
      warnings: [],
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
        hubType: nextTransport.hubType,
        firmwareVersion: nextTransport.firmwareVersion,
        protocolVersion: nextTransport.protocolVersion,
        maxWriteSize: nextTransport.maxWriteSize,
        maxUserProgramSize: nextTransport.maxUserProgramSize,
        featureFlags: nextTransport.featureFlags,
        numOfSlots: nextTransport.numOfSlots,
        telemetryError: "",
      });
      this.monitorRetryCount = 0;
      this._emit("onStderr", `[pybricks] Connected to ${nextTransport.deviceName} via ${nextTransport.label}.\n`);
      void this._startHubMonitor();
    } catch (error) {
      this.transport = null;
      this._setConnectionState({
        connected: false,
        status: "disconnected",
        transport: null,
        transportLabel: "",
        deviceName: "",
        hubType: "",
        firmwareVersion: "",
        protocolVersion: "",
        batteryState: "unknown",
        statusFlags: 0,
        warnings: [],
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
    this._clearMonitorRestart();
    this._clearMonitorWaiters(new Error("Hub disconnected."));
    this.monitorRunning = false;
    this.monitorStarting = false;
    this.monitorRetryCount = 0;
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
      batteryState: "unknown",
      batteryVoltage: null,
      batteryPercent: null,
      ports: [],
      telemetryAvailable: false,
      telemetryError: "",
      statusFlags: 0,
      warnings: [],
    });
    if (wasRunning) {
      this._finalizeRun(130);
    }
  }

  _handleTransportDisconnect(message) {
    this._clearMonitorRestart();
    this._clearMonitorWaiters(new Error("Hub disconnected."));
    this.monitorRunning = false;
    this.monitorStarting = false;
    this.monitorRetryCount = 0;
    const wasRunning = this.running;
    this.transport = null;
    this._setConnectionState({
      connected: false,
      status: "disconnected",
      transport: null,
      transportLabel: "",
      deviceName: "",
      hubRunning: false,
      batteryState: "unknown",
      batteryVoltage: null,
      batteryPercent: null,
      ports: [],
      telemetryAvailable: false,
      telemetryError: "",
      statusFlags: 0,
      warnings: [],
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
    this._scheduleMonitorRestart();
  }

  _clearMonitorRestart() {
    if (this.monitorRestartTimer) {
      globalThis.clearTimeout(this.monitorRestartTimer);
      this.monitorRestartTimer = null;
    }
  }

  _clearMonitorWaiters(error) {
    const waiters = [this.monitorOutputWaiter];
    this.monitorOutputWaiter = null;
    waiters.forEach((waiter) => {
      if (!waiter) return;
      globalThis.clearTimeout(waiter.timeoutId);
      if (error) waiter.reject(error);
    });
  }

  _waitForMonitorOutput(predicate, timeoutMs = MONITOR_START_TIMEOUT_MS) {
    if (predicate(this.monitorOutputBuffer)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        if (this.monitorOutputWaiter?.timeoutId === timeoutId) {
          this.monitorOutputWaiter = null;
        }
        reject(new Error("Timed out waiting for the hub REPL."));
      }, timeoutMs);
      this.monitorOutputWaiter = { predicate, resolve, reject, timeoutId };
    });
  }

  _resolveMonitorOutputWaiter() {
    const waiter = this.monitorOutputWaiter;
    if (!waiter || !waiter.predicate(this.monitorOutputBuffer)) return;
    this.monitorOutputWaiter = null;
    globalThis.clearTimeout(waiter.timeoutId);
    waiter.resolve();
  }

  async _startMonitorRepl(command) {
    this.monitorOutputBuffer = "";
    const prompt = this._waitForMonitorOutput((output) => output.includes(">>>"));
    try {
      await this.transport.sendCommand(command);
      await prompt;
    } catch (error) {
      this._clearMonitorWaiters(error);
      await prompt.catch(() => {});
      throw error;
    }
  }

  _scheduleMonitorRestart(delayMs = 300) {
    this._clearMonitorRestart();
    if (this.disposed || !this.transport || !this.connectionState.connected || this.running) return;
    this.monitorRestartTimer = globalThis.setTimeout(() => {
      this.monitorRestartTimer = null;
      void this._startHubMonitor();
    }, delayMs);
  }

  async _downloadAndStart(compiled, slot = 0) {
    if (!this.transport) throw new Error("Hub is not connected.");
    const chunkSize = Math.max(1, this.connectionState.maxWriteSize - 5);
    const programBytes = new Uint8Array(await compiled.arrayBuffer());

    await this.transport.sendCommand(createWriteUserProgramMetaCommand(0));
    for (let offset = 0; offset < programBytes.byteLength; offset += chunkSize) {
      await this.transport.sendCommand(
        createWriteUserRamCommand(offset, programBytes.slice(offset, offset + chunkSize)),
      );
    }
    await this.transport.sendCommand(createWriteUserProgramMetaCommand(programBytes.byteLength));
    await this.transport.sendCommand(createStartUserProgramCommand(slot));
  }

  async _startHubMonitor() {
    if (
      this.monitorRunning ||
      this.monitorStarting ||
      this.running ||
      this.disposed ||
      !this.transport ||
      !this.connectionState.connected
    ) {
      return;
    }

    if (!(this.connectionState.featureFlags & HubCapabilityFlag.HasRepl)) {
      this._setConnectionState({
        telemetryAvailable: false,
        telemetryError: "Live readings require newer Pybricks firmware.",
      });
      return;
    }

    const generation = ++this.monitorGeneration;
    this.monitorStarting = true;
    this.monitorRunning = false;
    this.monitorStdoutBuffer = "";
    this.monitorOutputBuffer = "";
    this._setConnectionState({ telemetryAvailable: false, telemetryError: "" });
    try {
      const source = createHubMonitorSource(this.connectionState.hubType);
      const bootstrap = createHubMonitorBootstrap(this.connectionState.hubType);
      if (generation !== this.monitorGeneration || this.running || !this.transport) {
        return;
      }
      await this.transport.sendCommand(createStopUserProgramCommand()).catch(() => {});
      await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
      if (generation !== this.monitorGeneration || this.running || !this.transport) {
        return;
      }

      const legacyProfile = isProfileBefore(this.connectionState.protocolVersion, 1, 4);
      const startCommands =
        legacyProfile === true
          ? [createLegacyStartReplCommand(), createStartUserProgramCommand(BuiltinProgramId.Repl)]
          : legacyProfile === false
            ? [createStartUserProgramCommand(BuiltinProgramId.Repl), createLegacyStartReplCommand()]
            : [createStartUserProgramCommand(BuiltinProgramId.Repl), createLegacyStartReplCommand()];

      let replStarted = false;
      for (const command of startCommands) {
        try {
          await this._startMonitorRepl(command);
          replStarted = true;
          break;
        } catch {
          await this.transport.sendCommand(createStopUserProgramCommand()).catch(() => {});
          await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
        }
      }
      if (!replStarted) {
        throw new Error("Hub REPL did not start.");
      }

      this.monitorRunning = true;
      await this._sendMonitorReplLine(bootstrap, true);
      if (!this.connectionState.telemetryAvailable) {
        throw new Error("Hub battery probe did not return a value.");
      }
      await this._writeMonitorSourceToRepl(source);
    } catch (error) {
      this._clearMonitorWaiters();
      this.monitorRunning = false;
      if (generation === this.monitorGeneration && this.connectionState.connected) {
        this.monitorRetryCount += 1;
        if (this.monitorRetryCount < 3) {
          this._setConnectionState({ telemetryAvailable: false, telemetryError: "" });
          this._scheduleMonitorRestart(350 * this.monitorRetryCount);
        } else {
          const reason = normalizeText(error?.message, "Unknown hub response.");
          this._setConnectionState({
            telemetryAvailable: false,
            telemetryError: "Live battery and port readings failed to start.",
          });
          this._emit("onStderr", `[pybricks] Hub readings failed: ${reason}\n`);
        }
      }
    } finally {
      if (generation === this.monitorGeneration) {
        this.monitorStarting = false;
      }
    }
  }

  async _writeMonitorSourceToRepl(source) {
    const sourceChunks = source.match(/[\s\S]{1,96}/g) || [""];
    for (let index = 0; index < sourceChunks.length; index += 1) {
      const assignment = `${index === 0 ? "__pc_src=" : "__pc_src+="}${JSON.stringify(sourceChunks[index])}\r`;
      await this._sendMonitorReplLine(assignment, true);
    }
    await this._sendMonitorReplLine("exec(__pc_src)\r", false);
  }

  async _sendMonitorReplLine(line, waitForPrompt) {
    this.monitorOutputBuffer = "";
    const prompt = waitForPrompt
      ? this._waitForMonitorOutput((output) => /\r?\n>>>/.test(output))
      : null;
    const chunkSize = Math.max(1, this.connectionState.maxWriteSize || 20);
    const bytes = textEncoder.encode(line);
    try {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        if (!this.transport || !this.monitorRunning) return;
        await this.transport.sendCommand(
          createWriteStdinCommand(bytes.slice(offset, offset + chunkSize)),
        );
      }
      if (prompt) await prompt;
    } catch (error) {
      this._clearMonitorWaiters(error);
      if (prompt) await prompt.catch(() => {});
      throw error;
    }
  }

  async _stopHubMonitor() {
    this._clearMonitorRestart();
    this.monitorGeneration += 1;
    if (!this.monitorRunning && !this.monitorStarting) return;
    this.monitorRunning = false;
    this.monitorStarting = false;
    this._carryMonitorSentinelToProgram();
    this._clearMonitorWaiters(new Error("Hub monitor stopped."));
    this._setConnectionState({ telemetryAvailable: false, telemetryError: "" });
    if (this.transport) {
      await this.transport.sendCommand(createStopUserProgramCommand()).catch(() => {});
      await new Promise((resolve) => globalThis.setTimeout(resolve, 120));
    }
  }

  _carryMonitorSentinelToProgram() {
    // A sentinel line may be half-buffered when the monitor flips off. Hand the
    // partial (which still carries the \x1e prefix) to the program stdout buffer
    // so its tail completes the sentinel and gets dropped instead of leaking.
    const rs = getHubMonitorPrefix()[0];
    const rsIndex = this.monitorStdoutBuffer.lastIndexOf(rs);
    this.programStdoutBuffer = rsIndex >= 0 ? this.monitorStdoutBuffer.slice(rsIndex) : "";
    this.monitorStdoutBuffer = "";
  }

  _emitProgramStdout(text) {
    // The hub monitor's `while True` loop can keep printing PYCOLLAB_HUB sentinel
    // lines for a beat after monitorRunning/monitorStarting flip false (during a
    // stop or a status report). Those sentinels are an internal telemetry channel
    // and must never reach the terminal, so strip them here regardless of state.
    const prefix = getHubMonitorPrefix();
    const rs = prefix[0];
    let pending = this.programStdoutBuffer + text;
    this.programStdoutBuffer = "";
    let output = "";

    while (pending) {
      const rsIndex = pending.indexOf(rs);
      if (rsIndex < 0) {
        output += pending;
        pending = "";
        break;
      }
      output += pending.slice(0, rsIndex);
      const lineEnd = pending.indexOf("\n", rsIndex);
      if (lineEnd < 0) {
        // The sentinel line is still arriving. Hold it back only while it can
        // still match the prefix; otherwise it is ordinary output, so pass it on.
        const partial = pending.slice(rsIndex);
        if (prefix.startsWith(partial) || partial.startsWith(prefix)) {
          this.programStdoutBuffer = partial;
        } else {
          output += partial;
        }
        pending = "";
        break;
      }
      const line = pending.slice(rsIndex, lineEnd);
      if (!line.includes(prefix)) {
        output += `${line}\n`;
      }
      pending = pending.slice(lineEnd + 1);
    }

    if (output) this._emit("onStdout", output);
  }

  _handleMonitorStdout(text) {
    this.monitorOutputBuffer = `${this.monitorOutputBuffer}${text}`.slice(-4096);
    this._resolveMonitorOutputWaiter();
    this.monitorStdoutBuffer += text;
    const lines = this.monitorStdoutBuffer.split("\n");
    this.monitorStdoutBuffer = lines.pop() || "";
    const prefix = getHubMonitorPrefix();

    for (const line of lines) {
      const marker = line.indexOf(prefix);
      if (marker < 0) continue;
      const payload = parseHubMonitorPayload(
        line.slice(marker + prefix.length),
        this.connectionState.hubType,
      );
      if (!payload) continue;
      this._setConnectionState({
        batteryVoltage: payload.batteryVoltage,
        batteryPercent: estimateBatteryPercent(payload.batteryVoltage, this.connectionState.hubType),
        ports: payload.ports,
        motion: payload.motion,
        buttons: payload.buttons,
        telemetryAvailable: true,
        telemetryError: "",
      });
      this.monitorRetryCount = 0;
    }
  }

  _handleNativeTelemetry(event) {
    if (event.byteLength < 7) return;
    const portIndex = event.getInt8(2);
    const angle = event.getInt32(3, true);
    const portName = getHubPortNames(this.connectionState.hubType)[portIndex];
    if (!portName) return;
    const ports = [...this.connectionState.ports];
    const currentIndex = ports.findIndex((port) => port.port === portName);
    const nextPort = {
      ...(currentIndex >= 0 ? ports[currentIndex] : {}),
      port: portName,
      kind: "motor",
      device: currentIndex >= 0 ? ports[currentIndex].device : "Motor",
      angle,
    };
    if (currentIndex >= 0) ports[currentIndex] = nextPort;
    else ports.push(nextPort);
    this._setConnectionState({ ports, telemetryAvailable: true, telemetryError: "" });
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
        hubRunning:
          hubRunning &&
          status.runningProgId !== BuiltinProgramId.Repl &&
          !this.monitorStarting &&
          !this.monitorRunning,
        selectedSlot: status.selectedSlot,
        batteryState: getBatteryState(status.flags),
        statusFlags: status.flags,
        warnings: getHubWarnings(status.flags),
      });

      if (wasRunning && !hubRunning) {
        this._emit("onStatus", { state: "stopped" });
        this._finalizeRun(this.currentRunWasUserStop ? 130 : 0);
      }
      if (this.monitorRunning && !this.monitorStarting && !hubRunning) {
        this.monitorRunning = false;
        this._carryMonitorSentinelToProgram();
        this._setConnectionState({ telemetryAvailable: false, telemetryError: "" });
      }
      return;
    }

    if (type === EventType.WriteStdout) {
      const payload = sliceDataViewBuffer(event, 1);
      const text = this.stdoutDecoder.decode(new Uint8Array(payload), { stream: true });
      if (text) {
        if (this.monitorRunning || this.monitorStarting) {
          this._handleMonitorStdout(text);
        } else {
          this._emitProgramStdout(text);
        }
      }
      return;
    }

    if (type === EventType.WriteTelemetry) {
      this._handleNativeTelemetry(event);
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

    await this._stopHubMonitor();

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

    const slot = this.connectionState.selectedSlot || 0;

    this._emit("onStderr", `[pybricks] Compiled ${compiled.size} bytes. Downloading over ${this.connectionState.transportLabel}...\n`);

    await this._downloadAndStart(compiled, slot);

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

    this.sendStdinAsync(data)
      .catch((error) => {
        this._emit("onError", normalizeText(error?.message, "Failed to send stdin to hub."));
      });

    return true;
  }

  async sendStdinAsync(data) {
    if (!this.running || !this.transport) {
      throw new Error("No hub program is accepting input.");
    }
    const payload = textEncoder.encode(String(data || ""));
    await this.transport.sendCommand(createWriteStdinCommand(payload));
  }

  // Hub actions (light, beep, shutdown) ride the live-readings monitor: it polls
  // stdin each loop, so a single newline-terminated line is picked up without
  // disturbing telemetry. Only valid while the monitor — not a user program — runs.
  sendHubAction(command) {
    this.sendHubActionAsync(command).catch((error) => {
      this._emit("onError", normalizeText(error?.message, "Hub action failed."));
    });
    return this.monitorRunning;
  }

  async sendHubActionAsync(command) {
    if (!this.transport || !this.monitorRunning) {
      throw new Error("Live hub readings are not running.");
    }
    const bytes = textEncoder.encode(`${String(command || "").trim()}\n`);
    const chunkSize = Math.max(1, this.connectionState.maxWriteSize || 20);
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      if (!this.transport || !this.monitorRunning) return;
      await this.transport.sendCommand(createWriteStdinCommand(bytes.slice(offset, offset + chunkSize)));
    }
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
    this._clearMonitorRestart();
    this._clearMonitorWaiters(new Error("Runner disposed."));
    this.monitorGeneration += 1;
    this.monitorRunning = false;
    this.monitorStarting = false;
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
