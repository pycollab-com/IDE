const CONTROL_READ = 0;
const CONTROL_WRITE = 1;
const CONTROL_CLOSED = 2;
const MESSAGE_STDIN_POLL_MS = 8;

let pyodide = null;
let runtimeConfig = null;
let interruptBuffer = null;
let stdinControl = null;
let stdinData = null;
let stdinMode = "message";
let stdinQueue = [];
let stdinQueueOffset = 0;
let stdinClosed = false;
let currentRunId = null;
let running = false;
let stopRequested = false;
let timeoutTriggered = false;
let pyodideImportToPackage = new Map();

const encoder = new TextEncoder();
const FALLBACK_IMPORT_PACKAGE_ALIASES = new Map([
  ["pil", "pillow"],
  ["sklearn", "scikit-learn"],
  ["bs4", "beautifulsoup4"],
  ["yaml", "pyyaml"],
]);

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function rawToChunk(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return String.fromCodePoint(value);
    } catch {
      return String.fromCharCode(value);
    }
  }
  return String(value ?? "");
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, nested) => {
    if (typeof nested === "object" && nested !== null) {
      if (seen.has(nested)) return "[Circular]";
      seen.add(nested);
    }
    return nested;
  });
}

function normalizeError(err) {
  if (!err) return "Unknown runtime error.";
  if (typeof err === "string") return err;
  if (err.message) {
    if (typeof err.message === "string") return err.message;
    try {
      return safeStringify(err.message);
    } catch {
      return String(err.message);
    }
  }
  if (typeof err === "object") {
    try {
      const asJson = safeStringify(err);
      if (asJson && asJson !== "{}") return asJson;
    } catch {
      // Fall through to String coercion.
    }
  }
  return String(err);
}

function parseErrno(err) {
  if (!err || typeof err !== "object") return null;
  if (typeof err.errno === "number") return err.errno;
  return null;
}

function parseErrorCode(err) {
  if (!err || typeof err !== "object") return "";
  if (typeof err.code === "string") return err.code.toUpperCase();
  return "";
}

function parseErrorText(err) {
  const text = normalizeError(err);
  return typeof text === "string" ? text.toUpperCase() : "";
}

function normalizePackageName(name) {
  return String(name || "").trim().toLowerCase();
}

function resolveAbsoluteUrl(input, fallbackBase = self.location.href) {
  return new URL(String(input || ""), fallbackBase).toString();
}

function formatModuleNotFoundError(names) {
  const unique = [];
  const seen = new Set();
  for (const name of names || []) {
    const normalized = normalizePackageName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  if (!unique.length) {
    return "Module not found.";
  }
  if (unique.length === 1) {
    return `Module not found: ${unique[0]}`;
  }
  return `Modules not found: ${unique.join(", ")}`;
}

// These substrings are matched against parseErrorText(err), based on
// pyodide.loadPackage failures observed in Pyodide v0.29.x (for example:
// "No known package with name ..." / "No such package ...").
// Message text can change across Pyodide versions, so verify/update these
// patterns when bumping runtime versions:
// https://pyodide.org/en/stable/usage/loading-packages.html
function isUnknownPyodidePackageError(err) {
  const text = parseErrorText(err);
  return text.includes("NO KNOWN PACKAGE") || text.includes("NO SUCH PACKAGE");
}

function resolvePyodidePackageForModule(moduleName) {
  const normalized = normalizePackageName(moduleName);
  if (!normalized) return "";
  const fromLock = pyodideImportToPackage.get(normalized);
  if (fromLock) return fromLock;
  const alias = FALLBACK_IMPORT_PACKAGE_ALIASES.get(normalized);
  if (alias) return alias;
  return normalized;
}

async function hydratePyodidePackageIndex(base) {
  pyodideImportToPackage = new Map();
  const lockUrl = new URL("pyodide-lock.json", base).toString();
  try {
    const response = await fetch(lockUrl);
    if (!response.ok) return;
    const lockfile = await response.json();
    const packages = lockfile?.packages;
    if (!packages || typeof packages !== "object") return;

    for (const [packageName, packageMeta] of Object.entries(packages)) {
      const normalizedPackage = normalizePackageName(packageName);
      if (!normalizedPackage) continue;

      if (!pyodideImportToPackage.has(normalizedPackage)) {
        pyodideImportToPackage.set(normalizedPackage, normalizedPackage);
      }

      const imports = Array.isArray(packageMeta?.imports) ? packageMeta.imports : [];
      for (const importName of imports) {
        const normalizedImport = normalizePackageName(importName);
        if (!normalizedImport || pyodideImportToPackage.has(normalizedImport)) continue;
        pyodideImportToPackage.set(normalizedImport, normalizedPackage);
      }
    }
  } catch (err) {
    console.warn(
      `[pyodide] Failed to load pyodide lockfile: ${lockUrl}. Falling back to direct import-name package resolution.`,
      err,
    );
    // Fall back to direct import-name package resolution when lockfile lookup fails.
  }
}

function isFsNoSuchFileError(err) {
  const errno = parseErrno(err);
  if (errno === 2 || errno === 44) return true;
  const code = parseErrorCode(err);
  if (code === "ENOENT") return true;
  const text = parseErrorText(err);
  return text.includes("ENOENT") || text.includes("NO SUCH FILE") || text.includes("NO SUCH FILE OR DIRECTORY");
}

function isFsAlreadyExistsError(err) {
  const errno = parseErrno(err);
  if (errno === 17 || errno === 20) return true;
  const code = parseErrorCode(err);
  if (code === "EEXIST") return true;
  const text = parseErrorText(err);
  return text.includes("EEXIST") || text.includes("FILE EXISTS");
}

function isKeyboardInterrupt(err) {
  const message = normalizeError(err);
  return message.includes("KeyboardInterrupt") || message.includes("InterruptedError");
}

function normalizeProjectPath(rawName) {
  const name = String(rawName || "").replace(/\\/g, "/").trim();
  if (!name) {
    throw new Error("Project file name cannot be empty.");
  }
  if (name.startsWith("/") || name.includes("\u0000")) {
    throw new Error(`Unsafe project file path: ${rawName}`);
  }
  const parts = [];
  for (const part of name.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error(`Unsafe project file path: ${rawName}`);
    }
    parts.push(part);
  }
  if (!parts.length) {
    throw new Error(`Invalid project file path: ${rawName}`);
  }
  return parts.join("/");
}

function fsPathForProjectPath(projectPath) {
  return `/workspace/${projectPath}`;
}

function ensureFsDir(path) {
  try {
    pyodide.FS.mkdir(path);
  } catch (err) {
    if (!isFsAlreadyExistsError(err)) {
      throw err;
    }
  }
}

function ensureFsParents(path) {
  const parts = path.split("/").filter(Boolean);
  let cursor = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor += `/${parts[i]}`;
    ensureFsDir(cursor);
  }
}

function removeFsTree(path) {
  const entries = pyodide.FS.readdir(path);
  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;
    const child = `${path}/${entry}`;
    const stat = pyodide.FS.stat(child);
    if (pyodide.FS.isDir(stat.mode)) {
      removeFsTree(child);
    } else {
      pyodide.FS.unlink(child);
    }
  }
  pyodide.FS.rmdir(path);
}

function resetWorkspace() {
  try {
    removeFsTree("/workspace");
  } catch (err) {
    if (!isFsNoSuchFileError(err)) {
      throw err;
    }
  }
  ensureFsDir("/workspace");
}

function clearMessageStdinQueue() {
  stdinQueue = [];
  stdinQueueOffset = 0;
  stdinClosed = false;
}

function appendMessageStdinChunk(data) {
  if (typeof data !== "string" || !data.length) return;
  stdinQueue.push(encoder.encode(data));
}

function closeStdin() {
  if (stdinMode === "shared") {
    if (!stdinControl) return;
    Atomics.store(stdinControl, CONTROL_CLOSED, 1);
    Atomics.notify(stdinControl, CONTROL_WRITE, 1);
    return;
  }
  stdinClosed = true;
}

function readSharedStdinBytes(maxBytes) {
  if (!stdinControl || !stdinData) {
    return null;
  }

  const size = stdinData.length;
  while (true) {
    const read = Atomics.load(stdinControl, CONTROL_READ);
    const write = Atomics.load(stdinControl, CONTROL_WRITE);
    if (read !== write) {
      break;
    }
    if (Atomics.load(stdinControl, CONTROL_CLOSED) === 1) {
      return null;
    }
    Atomics.wait(stdinControl, CONTROL_WRITE, write, 1000);
  }

  const out = [];
  let read = Atomics.load(stdinControl, CONTROL_READ);
  const write = Atomics.load(stdinControl, CONTROL_WRITE);
  while (read !== write && out.length < maxBytes) {
    out.push(stdinData[read]);
    read = (read + 1) % size;
  }
  Atomics.store(stdinControl, CONTROL_READ, read);
  return new Uint8Array(out);
}

function readMessageStdinBytes(maxBytes) {
  while (!stdinQueue.length && !stdinClosed && !stopRequested) {
    const start = Date.now();
    while (Date.now() - start < MESSAGE_STDIN_POLL_MS) {
      // Busy wait to simulate blocking stdin in non-isolated mode.
    }
  }

  if (!stdinQueue.length) {
    return null;
  }

  const out = [];
  while (stdinQueue.length && out.length < maxBytes) {
    const chunk = stdinQueue[0];
    out.push(chunk[stdinQueueOffset]);
    stdinQueueOffset += 1;
    if (stdinQueueOffset >= chunk.length) {
      stdinQueue.shift();
      stdinQueueOffset = 0;
    }
  }
  return new Uint8Array(out);
}

function readStdin(buffer) {
  const chunk =
    stdinMode === "shared"
      ? readSharedStdinBytes(buffer.length)
      : readMessageStdinBytes(buffer.length);

  if (chunk === null) {
    return 0;
  }
  buffer.set(chunk);
  return chunk.length;
}

function triggerInterrupt() {
  if (interruptBuffer) {
    Atomics.store(interruptBuffer, 0, 2);
  }
  closeStdin();
}

function buildLocalModuleNames(files) {
  const localModules = new Set();
  for (const file of files) {
    const parts = file.projectPath.split("/");
    const base = parts[parts.length - 1];
    if (base.endsWith(".py")) {
      const stem = base.slice(0, -3).toLowerCase();
      if (stem && stem !== "__init__") {
        localModules.add(stem);
      }
      if (stem === "__init__" && parts.length > 1) {
        localModules.add(parts[parts.length - 2].toLowerCase());
      }
    }
    if (parts.length > 1) {
      localModules.add(parts[0].toLowerCase());
    }
  }
  return localModules;
}

async function discoverImports(files) {
  const payload = files.map((f) => ({ name: f.projectPath, content: f.content || "" }));
  pyodide.globals.set("__pycollab_files_json", JSON.stringify(payload));
  try {
    const raw = await pyodide.runPythonAsync(`
import ast
import json
import sys

files = json.loads(__pycollab_files_json)
stdlib = set(getattr(sys, "stdlib_module_names", []))
imports = set()
for item in files:
    source = item.get("content") or ""
    filename = item.get("name") or "<file>"
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = (alias.name or "").split(".", 1)[0]
                if root:
                    imports.add(root)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            root = module.split(".", 1)[0] if module else ""
            if root:
                imports.add(root)
json.dumps(sorted(name for name in imports if name and name not in stdlib))
    `);
    return JSON.parse(raw);
  } finally {
    pyodide.globals.delete("__pycollab_files_json");
  }
}

async function enforcePackagePolicy(files, allowedPackages) {
  const localModules = buildLocalModuleNames(files);
  const discovered = await discoverImports(files);
  const requiredModules = [];
  const seenModules = new Set();
  for (const name of discovered) {
    const normalized = normalizePackageName(name);
    if (!normalized || localModules.has(normalized) || seenModules.has(normalized)) {
      continue;
    }
    seenModules.add(normalized);
    requiredModules.push(normalized);
  }

  const enforceAllowlist = allowedPackages.size > 0;
  const blockedModules = [];
  const packagesToLoad = [];
  const seenPackages = new Set();

  for (const moduleName of requiredModules) {
    const packageName = resolvePyodidePackageForModule(moduleName);
    const isAllowed =
      !enforceAllowlist || allowedPackages.has(moduleName) || allowedPackages.has(packageName);
    if (!isAllowed) {
      blockedModules.push(moduleName);
      continue;
    }
    if (packageName && !seenPackages.has(packageName)) {
      seenPackages.add(packageName);
      packagesToLoad.push(packageName);
    }
  }

  if (blockedModules.length) {
    throw new Error(formatModuleNotFoundError(blockedModules));
  }

  for (const pkg of packagesToLoad) {
    try {
      await pyodide.loadPackage(pkg);
    } catch (err) {
      if (isUnknownPyodidePackageError(err)) {
        // Let Python raise a standard ModuleNotFoundError when execution starts.
        continue;
      }
      throw err;
    }
  }
}

async function patchMicropipInstall(allowedPackages) {
  if (!(allowedPackages instanceof Set) || allowedPackages.size === 0) {
    await pyodide.runPythonAsync(`
try:
    import micropip
except Exception:
    micropip = None

if micropip is not None and hasattr(micropip, "__pycollab_orig_install__"):
    micropip.install = micropip.__pycollab_orig_install__
    `);
    return;
  }

  pyodide.globals.set("__pycollab_allowed_packages_json", JSON.stringify([...allowedPackages]));
  try {
    await pyodide.runPythonAsync(`
import json
import re

allowed = set(json.loads(__pycollab_allowed_packages_json))

def _normalize_req(req):
    text = str(req or "").strip().lower()
    text = re.split(r"[<>=!~\\[]", text, maxsplit=1)[0].strip()
    return text

try:
    import micropip
except Exception:
    micropip = None

if micropip is not None:
    if not hasattr(micropip, "__pycollab_orig_install__"):
        micropip.__pycollab_orig_install__ = micropip.install

    async def _pycollab_guarded_install(requirements, *args, **kwargs):
        reqs = requirements if isinstance(requirements, (list, tuple, set)) else [requirements]
        blocked = []
        for req in reqs:
            pkg = _normalize_req(req)
            if pkg and pkg not in allowed:
                blocked.append(pkg)
        if blocked:
            names = ", ".join(sorted(set(blocked)))
            raise RuntimeError(f"Module not found: {names}")
        return await micropip.__pycollab_orig_install__(requirements, *args, **kwargs)

    micropip.install = _pycollab_guarded_install
    `);
  } finally {
    pyodide.globals.delete("__pycollab_allowed_packages_json");
  }
}

function selectEntryFile(files, entryFileId) {
  const explicit = files.find((f) => f.id === entryFileId);
  if (explicit) {
    return explicit;
  }
  const mainFile = files.find((f) => f.projectPath === "main.py");
  if (mainFile) {
    return mainFile;
  }
  return files[0];
}

async function runProjectFiles(files, entryFileId, maxRunSeconds) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files in project.");
  }

  const materialized = files.map((file) => ({
    id: Number(file.id),
    projectPath: normalizeProjectPath(file.name || ""),
    content: typeof file.content === "string" ? file.content : "",
  }));

  resetWorkspace();
  for (const file of materialized) {
    const path = fsPathForProjectPath(file.projectPath);
    ensureFsParents(path);
    pyodide.FS.writeFile(path, file.content, { encoding: "utf8" });
  }

  const entry = selectEntryFile(materialized, entryFileId);
  const entryPath = fsPathForProjectPath(entry.projectPath);
  const allowedPackages = new Set((runtimeConfig.allowed_packages || []).map((pkg) => String(pkg).toLowerCase()));
  await enforcePackagePolicy(materialized, allowedPackages);

  timeoutTriggered = false;
  let timer = null;
  if (interruptBuffer && Number(maxRunSeconds) > 0) {
    timer = setTimeout(() => {
      timeoutTriggered = true;
      triggerInterrupt();
    }, Number(maxRunSeconds) * 1000);
  }

  pyodide.globals.set("__pycollab_entry_path", entryPath);
  try {
    const returnCode = await pyodide.runPythonAsync(`
import runpy
import sys
import traceback

_workspace = "/workspace"
_entry = __pycollab_entry_path
_prev_path = list(sys.path)
if _workspace not in sys.path:
    sys.path.insert(0, _workspace)

_code = 0
try:
    runpy.run_path(_entry, run_name="__main__")
except SystemExit as exc:
    _exit_code = exc.code
    if _exit_code is None:
        _code = 0
    elif isinstance(_exit_code, int):
        _code = _exit_code
    else:
        print(_exit_code, file=sys.stderr)
        _code = 1
except KeyboardInterrupt:
    _code = 130
except BaseException:
    traceback.print_exc()
    _code = 1
finally:
    sys.path[:] = _prev_path

_code
    `);
    return Number(returnCode);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    pyodide.globals.delete("__pycollab_entry_path");
  }
}

async function loadRuntime(config, buffers) {
  runtimeConfig = {
    pyodide_base_url: String(config?.pyodide_base_url || "").trim(),
    allowed_packages: Array.isArray(config?.allowed_packages) ? config.allowed_packages : [],
    max_run_seconds: Number(config?.max_run_seconds ?? 0),
  };
  stdinMode = config?.stdin_mode === "shared" ? "shared" : "message";

  if (stdinMode === "shared") {
    if (!buffers?.interrupt || !buffers?.stdinControl || !buffers?.stdinData) {
      throw new Error("Missing shared stdin buffers.");
    }
    interruptBuffer = new Int32Array(buffers.interrupt);
    stdinControl = new Int32Array(buffers.stdinControl);
    stdinData = new Uint8Array(buffers.stdinData);
    Atomics.store(interruptBuffer, 0, 0);
  } else {
    interruptBuffer = null;
    stdinControl = null;
    stdinData = null;
    clearMessageStdinQueue();
  }

  if (!runtimeConfig.pyodide_base_url) {
    throw new Error("Missing pyodide_base_url runtime config.");
  }

  const base = runtimeConfig.pyodide_base_url.endsWith("/")
    ? runtimeConfig.pyodide_base_url
    : `${runtimeConfig.pyodide_base_url}/`;
  const absoluteBase = resolveAbsoluteUrl(base);

  if (!self.loadPyodide) {
    importScripts(resolveAbsoluteUrl("pyodide.js", absoluteBase));
  }

  pyodide = await self.loadPyodide({ indexURL: absoluteBase });
  await hydratePyodidePackageIndex(absoluteBase);
  pyodide.setStdout({
    raw: (value) => post("STDOUT", { data: rawToChunk(value) }),
  });
  pyodide.setStderr({
    raw: (value) => post("STDERR", { data: rawToChunk(value) }),
  });
  pyodide.setStdin({
    read(buffer) {
      return readStdin(buffer);
    },
  });
  if (interruptBuffer) {
    pyodide.setInterruptBuffer(interruptBuffer);
  }
  await patchMicropipInstall(new Set(runtimeConfig.allowed_packages.map((pkg) => String(pkg).toLowerCase())));
}

async function handleRun(message) {
  if (running) {
    post("STDERR", { data: "[compiler] Runtime already has an active run.\n" });
    return;
  }
  if (!pyodide) {
    post("RUNTIME_ERROR", { message: "Runtime is not ready." });
    return;
  }

  running = true;
  stopRequested = false;
  timeoutTriggered = false;
  currentRunId = message.runId;

  if (interruptBuffer) {
    Atomics.store(interruptBuffer, 0, 0);
  }
  if (stdinMode === "shared") {
    Atomics.store(stdinControl, CONTROL_CLOSED, 0);
  } else {
    clearMessageStdinQueue();
  }

  post("STATUS", { state: "running" });

  let returnCode = 1;
  try {
    returnCode = await runProjectFiles(
      Array.isArray(message.files) ? message.files : [],
      message.entryFileId == null ? null : Number(message.entryFileId),
      runtimeConfig.max_run_seconds,
    );
    if (timeoutTriggered) {
      post("STDERR", {
        data: `[compiler] Execution timed out after ${runtimeConfig.max_run_seconds} seconds.\n`,
      });
      returnCode = -1;
    }
  } catch (err) {
    if (timeoutTriggered) {
      post("STDERR", {
        data: `[compiler] Execution timed out after ${runtimeConfig.max_run_seconds} seconds.\n`,
      });
      returnCode = -1;
    } else if (isKeyboardInterrupt(err)) {
      returnCode = 130;
    } else {
      post("STDERR", { data: `[compiler] ${normalizeError(err)}\n` });
      returnCode = 1;
    }
  } finally {
    running = false;
    currentRunId = null;
    closeStdin();
    post("RUN_RESULT", { runId: message.runId, returnCode });
    post("STATUS", { state: "stopped" });
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "BOOT") {
      await loadRuntime(message.config || {}, message.buffers || {});
      post("RUNTIME_READY");
      return;
    }
    if (message.type === "RUN") {
      await handleRun(message);
      return;
    }
    if (message.type === "STDIN") {
      if (!running || stdinMode !== "message") return;
      if (message.runId && currentRunId && message.runId !== currentRunId) return;
      appendMessageStdinChunk(String(message.data || ""));
      return;
    }
    if (message.type === "STOP") {
      if (!running) {
        return;
      }
      stopRequested = true;
      triggerInterrupt();
      return;
    }
    if (message.type === "DISPOSE") {
      stopRequested = true;
      triggerInterrupt();
      close();
      return;
    }
  } catch (err) {
    post("RUNTIME_ERROR", { message: normalizeError(err) });
    if (running) {
      running = false;
      currentRunId = null;
      closeStdin();
      post("STATUS", { state: "stopped" });
    }
  }
};

self.addEventListener("error", (event) => {
  post("RUNTIME_ERROR", { message: normalizeError(event.error || event.message) });
});
self.addEventListener("unhandledrejection", (event) => {
  post("RUNTIME_ERROR", { message: normalizeError(event.reason) });
});
