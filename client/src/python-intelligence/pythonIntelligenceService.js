function normalizeBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveRuntimeConfigUrl(runtimeApiBase = "") {
  const base =
    normalizeBase(runtimeApiBase) ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    (typeof self !== "undefined" ? self.location?.href || "" : "");
  return new URL("/runtime/pyodide-config", base).toString();
}

function resolveAnalyzerAssetBaseUrl() {
  const origin =
    (typeof window !== "undefined" ? window.location.origin : "") ||
    (typeof self !== "undefined" ? self.location?.href || "" : "");
  return new URL("/vendor/python-intelligence/", origin).toString();
}

function cloneProjectFiles(files) {
  return (Array.isArray(files) ? files : [])
    .filter((file) => typeof file?.name === "string")
    .map((file) => ({
      id: file.id ?? file.name,
      name: file.name,
      content: typeof file.content === "string" ? file.content : "",
    }));
}

function projectSnapshotsEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (a.id !== b.id || a.name !== b.name || a.content !== b.content) {
      return false;
    }
  }
  return true;
}

export class PythonIntelligenceService {
  constructor({ runtimeApiBase = "" } = {}) {
    this.runtimeApiBase = runtimeApiBase;
    this.worker = null;
    this.bootPromise = null;
    this.ready = false;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.requestChain = Promise.resolve();
    this.syncedProjectSnapshot = [];
    this.syncedProjectMode = "normal";
  }

  async _fetchRuntimeConfig() {
    const response = await fetch(resolveRuntimeConfigUrl(this.runtimeApiBase), {
      method: "GET",
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`Runtime config request failed (${response.status}).`);
    }
    return response.json();
  }

  _spawnWorker() {
    if (this.worker) {
      this.worker.removeEventListener("message", this._handleWorkerMessage);
      this.worker.terminate();
    }

    this.worker = new Worker(new URL("./pythonIntelligence.worker.js", import.meta.url));
    this.worker.addEventListener("message", this._handleWorkerMessage);
    this.ready = false;
  }

  _handleWorkerMessage = (event) => {
    const message = event.data || {};
    if (message.type === "READY") {
      this.ready = true;
      return;
    }

    if (message.type !== "RESPONSE") {
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    this.pendingRequests.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || "Analyzer request failed."));
    }
  };

  _request(type, payload = {}) {
    if (!this.worker) {
      return Promise.reject(new Error("Analyzer worker is not running."));
    }

    const requestId = ++this.requestId;
    const runRequest = () =>
      new Promise((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
        this.worker.postMessage({ type, requestId, ...payload });
      });

    const queuedRequest = this.requestChain.then(runRequest, runRequest);
    this.requestChain = queuedRequest.catch(() => {});
    return queuedRequest;
  }

  async init() {
    if (this.ready) return;
    if (this.bootPromise) {
      await this.bootPromise;
      return;
    }

    this.bootPromise = (async () => {
      const runtimeConfig = await this._fetchRuntimeConfig();
      this._spawnWorker();

      const readyPromise = new Promise((resolve, reject) => {
        const timeoutId = globalThis.setTimeout(() => {
          reject(new Error("Timed out while booting Python intelligence worker."));
        }, 45000);

        const handleReady = (event) => {
          const message = event.data || {};
          if (message.type === "READY") {
            globalThis.clearTimeout(timeoutId);
            this.worker?.removeEventListener("message", handleReady);
            resolve();
            return;
          }
          if (message.type === "RESPONSE" && !message.ok) {
            globalThis.clearTimeout(timeoutId);
            this.worker?.removeEventListener("message", handleReady);
            reject(new Error(message.error || "Python intelligence worker failed to initialize."));
          }
        };

        this.worker?.addEventListener("message", handleReady);
      });

      this.worker.postMessage({
        type: "BOOT",
        config: {
          ...runtimeConfig,
          asset_base_url: resolveAnalyzerAssetBaseUrl(),
        },
      });

      await readyPromise;
      this.ready = true;
    })();

    try {
      await this.bootPromise;
    } finally {
      this.bootPromise = null;
    }
  }

  async ensureProjectSynced({ files, isPybricksProject }) {
    await this.init();

    const nextSnapshot = cloneProjectFiles(files);
    const nextMode = isPybricksProject ? "pybricks" : "normal";
    if (projectSnapshotsEqual(this.syncedProjectSnapshot, nextSnapshot) && this.syncedProjectMode === nextMode) {
      return;
    }

    await this._request("SYNC_PROJECT", {
      files: nextSnapshot,
      isPybricksProject,
    });

    this.syncedProjectSnapshot = nextSnapshot;
    this.syncedProjectMode = nextMode;
  }

  async complete({ files, path, code, line, column, isPybricksProject }) {
    await this.ensureProjectSynced({ files, isPybricksProject });
    return this._request("COMPLETE", {
      path,
      code,
      line,
      column,
      isPybricksProject,
    });
  }

  async getSignatures({ files, path, code, line, column, isPybricksProject }) {
    await this.ensureProjectSynced({ files, isPybricksProject });
    return this._request("SIGNATURES", {
      path,
      code,
      line,
      column,
      isPybricksProject,
    });
  }

  async getHover({ files, path, code, line, column, isPybricksProject }) {
    await this.ensureProjectSynced({ files, isPybricksProject });
    return this._request("HOVER", {
      path,
      code,
      line,
      column,
      isPybricksProject,
    });
  }

  dispose() {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error("Python intelligence worker disposed."));
    }
    this.pendingRequests.clear();

    if (this.worker) {
      try {
        this.worker.postMessage({ type: "DISPOSE" });
      } catch {
        // Ignore teardown races.
      }
      this.worker.removeEventListener("message", this._handleWorkerMessage);
      this.worker.terminate();
      this.worker = null;
    }

    this.ready = false;
    this.bootPromise = null;
    this.requestChain = Promise.resolve();
    this.syncedProjectSnapshot = [];
    this.syncedProjectMode = "normal";
  }
}
