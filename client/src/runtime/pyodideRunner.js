import { API_BASE } from "../api";
import {
  closeStdinRingBuffer,
  createStdinRingBuffer,
  resetStdinRingBuffer,
  writeStdinRingBuffer,
} from "./stdinRingBuffer";

const STOP_FALLBACK_MS = 2000;

function makeRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function resolveRuntimeConfigUrl() {
  const base =
    API_BASE ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    (typeof self !== "undefined" ? self.location?.href || "" : "");
  return new URL("/runtime/pyodide-config", base).toString();
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

export class PyodideRunner {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.worker = null;
    this.workerReady = false;
    this.running = false;
    this.bootPromise = null;
    this.runtimeConfig = null;
    this.currentRunId = null;
    this.disposed = false;
    this.waitingForStop = [];
    this.stdinMode = "message";
    this.stdinRing = null;
    this.runWatchdog = null;
    this.forceRestarting = false;
  }

  _emit(name, payload) {
    const fn = this.callbacks[name];
    if (typeof fn === "function") {
      fn(payload);
    }
  }

  _supportsSharedStdin() {
    if (typeof SharedArrayBuffer === "undefined") return false;
    if (typeof window === "undefined") return true;
    return Boolean(window.crossOriginIsolated);
  }

  _clearRunWatchdog() {
    if (this.runWatchdog !== null) {
      globalThis.clearTimeout(this.runWatchdog);
      this.runWatchdog = null;
    }
  }

  _armRunWatchdog() {
    this._clearRunWatchdog();
    const timeoutSeconds = Number(this.runtimeConfig?.max_run_seconds ?? 0);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      return;
    }
    this.runWatchdog = globalThis.setTimeout(() => {
      if (!this.running) return;
      this._emit("onStderr", `[compiler] Execution timed out after ${timeoutSeconds} seconds.\n`);
      this._restartAfterForceStop({ emitTerminationMessage: true }).catch((err) => {
        this._emit("onError", normalizeText(err?.message, "Failed to recover runtime after timeout."));
      });
    }, timeoutSeconds * 1000);
  }

  async _fetchRuntimeConfig() {
    const response = await fetch(resolveRuntimeConfigUrl(), {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Runtime config request failed (${response.status}).`);
    }
    return response.json();
  }

  _handleWorkerMessage = (event) => {
    const message = event.data || {};
    const type = message.type;

    if (type === "RUNTIME_READY") {
      this.workerReady = true;
      this._emit("onReady", { stdinMode: this.stdinMode });
      return;
    }

    if (type === "STATUS") {
      const running = message.state === "running";
      this.running = running;
      if (running) {
        this._armRunWatchdog();
      } else {
        this._clearRunWatchdog();
      }
      this._emit("onStatus", message);
      if (!running) {
        const waiters = this.waitingForStop.splice(0, this.waitingForStop.length);
        for (const resolve of waiters) {
          resolve();
        }
      }
      return;
    }

    if (type === "STDOUT") {
      this._emit("onStdout", normalizeText(message.data, ""));
      return;
    }

    if (type === "STDERR") {
      this._emit("onStderr", normalizeText(message.data, ""));
      return;
    }

    if (type === "RUN_RESULT") {
      this._emit("onRunResult", message);
      return;
    }

    if (type === "RUNTIME_ERROR") {
      this._emit("onError", normalizeText(message.message, "Runtime error."));
    }
  };

  _spawnWorker() {
    if (this.worker) {
      this.worker.removeEventListener("message", this._handleWorkerMessage);
      this.worker.terminate();
      this.worker = null;
    }

    this.workerReady = false;
    const worker = new Worker(new URL("../workers/pyodide.worker.js", import.meta.url));
    worker.addEventListener("message", this._handleWorkerMessage);
    this.worker = worker;
  }

  async _bootWorker() {
    this._spawnWorker();

    const readyPromise = new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        reject(new Error("Timed out while booting browser runtime."));
      }, 30000);

      const handleMessage = (event) => {
        const message = event.data || {};
        if (message.type === "RUNTIME_READY") {
          globalThis.clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", handleMessage);
          resolve();
          return;
        }
        if (message.type === "RUNTIME_ERROR") {
          globalThis.clearTimeout(timeoutId);
          this.worker?.removeEventListener("message", handleMessage);
          reject(new Error(normalizeText(message.message, "Runtime failed to initialize.")));
        }
      };

      this.worker?.addEventListener("message", handleMessage);
    });

    const bootMessage = {
      type: "BOOT",
      config: {
        ...this.runtimeConfig,
        stdin_mode: this.stdinMode,
      },
    };

    if (this.stdinMode === "shared" && this.stdinRing) {
      bootMessage.buffers = {
        interrupt: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        stdinControl: this.stdinRing.controlBuffer,
        stdinData: this.stdinRing.dataBuffer,
      };
    }

    this.worker.postMessage(bootMessage);
    await readyPromise;
  }

  async init() {
    if (this.disposed) {
      throw new Error("Runner is disposed.");
    }
    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = (async () => {
      this.runtimeConfig = await this._fetchRuntimeConfig();
      if (!this._supportsSharedStdin()) {
        throw new Error("Browser runtime requires cross-origin isolation (COOP/COEP).");
      }
      this.stdinMode = "shared";
      this.stdinRing = createStdinRingBuffer();
      await this._bootWorker();
    })();

    try {
      await this.bootPromise;
    } catch (err) {
      this._emit("onError", normalizeText(err?.message, "Runtime bootstrap failed."));
      throw err;
    } finally {
      this.bootPromise = null;
    }
  }

  async run({ files, entryFileId }) {
    if (this.disposed) {
      throw new Error("Runner is disposed.");
    }
    if (!this.workerReady || !this.worker) {
      throw new Error("Runtime is not ready.");
    }
    if (this.running) {
      throw new Error("A run is already in progress.");
    }

    if (this.stdinMode === "shared" && this.stdinRing) {
      resetStdinRingBuffer(this.stdinRing);
    }
    this.currentRunId = makeRunId();
    this.worker.postMessage({
      type: "RUN",
      runId: this.currentRunId,
      entryFileId: entryFileId == null ? null : Number(entryFileId),
      files: Array.isArray(files) ? files : [],
    });
  }

  sendStdin(data) {
    if (!this.running || !this.worker) {
      return false;
    }
    if (this.stdinMode === "shared" && this.stdinRing) {
      return writeStdinRingBuffer(this.stdinRing, data);
    }
    this.worker.postMessage({
      type: "STDIN",
      data: String(data || ""),
      runId: this.currentRunId,
    });
    return true;
  }

  _waitForStopped() {
    if (!this.running) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitingForStop.push(resolve);
    });
  }

  async _restartAfterForceStop({ emitTerminationMessage = true } = {}) {
    if (this.forceRestarting) return;
    this.forceRestarting = true;
    this._clearRunWatchdog();
    try {
      if (emitTerminationMessage) {
        this._emit("onStderr", "[compiler] execution terminated\n");
      }
      this.running = false;
      this.currentRunId = null;
      if (this.stdinMode === "shared" && this.stdinRing) {
        // Allocate a fresh ring for restarted workers so any stale writes from
        // the terminated worker cannot flip CLOSED on the new runtime.
        this.stdinRing = createStdinRingBuffer(this.stdinRing.size);
      }
      await this._bootWorker();
      this._emit("onStatus", { state: "stopped" });
    } finally {
      this.forceRestarting = false;
    }
  }

  async stop() {
    if (!this.worker || !this.running) {
      return;
    }

    this.worker.postMessage({
      type: "STOP",
      runId: this.currentRunId,
    });

    const stopped = this._waitForStopped();
    const timeout = new Promise((resolve) => {
      globalThis.setTimeout(resolve, STOP_FALLBACK_MS);
    });
    await Promise.race([stopped, timeout]);

    if (this.running) {
      await this._restartAfterForceStop({ emitTerminationMessage: true });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearRunWatchdog();
    if (this.stdinRing) {
      closeStdinRingBuffer(this.stdinRing);
    }
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "DISPOSE" });
      } catch (err) {
        // Ignore teardown send failures on terminated workers.
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.running = false;
    this.currentRunId = null;
    const waiters = this.waitingForStop.splice(0, this.waitingForStop.length);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

export default PyodideRunner;
