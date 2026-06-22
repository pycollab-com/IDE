let pyodide = null;
let runtimeConfig = null;
let installedAnalyzer = false;
let pyodideImportToPackage = new Map();
let syncedProjectFiles = new Map();
let pybricksSysPath = "";
let lastProjectMode = "normal";

const FALLBACK_IMPORT_PACKAGE_ALIASES = new Map([
  ["pil", "pillow"],
  ["sklearn", "scikit-learn"],
  ["bs4", "beautifulsoup4"],
  ["yaml", "pyyaml"],
]);

const ANALYZER_WHEELS = Object.freeze([
  "jedi-0.19.2-py2.py3-none-any.whl",
  "parso-0.8.5-py2.py3-none-any.whl",
  "docstring_parser-0.14.1-py3-none-any.whl",
  "pybricks-3.6.1-py3-none-any.whl",
]);

const ANALYZER_PROVIDED_MODULES = new Set([
  "docstring_parser",
  "jedi",
  "micropython",
  "parso",
  "pybricks",
  "uerrno",
  "uio",
  "ujson",
  "umath",
  "urandom",
  "uselect",
  "ustruct",
  "usys",
]);

const PYTHON_ANALYZER_BOOTSTRAP = String.raw`
from __future__ import annotations

import json
import re

import docstring_parser
import jedi
from jedi.api.classes import BaseName, Name, ParamName, Signature

WORKSPACE_ROOT = "/workspace"


def _build_project(extra_sys_path):
    return jedi.Project(
        WORKSPACE_ROOT,
        added_sys_path=[path for path in (extra_sys_path or []) if path],
    )


def _get_docstring(name: BaseName) -> str:
    docstring = name.docstring(raw=True) or ""

    if getattr(name, "type", "") == "class" and isinstance(name, Name):
        for defined_name in name.defined_names():
            if defined_name.name == "__init__":
                init_docstring = _get_docstring(defined_name)
                if init_docstring and init_docstring not in docstring:
                    docstring = "\n\n".join(filter(None, [docstring, init_docstring]))
                break

    return docstring


def _strip_signature_prelude(text: str) -> str:
    if not text:
        return ""

    lines = []
    seen_content = False
    for line in text.splitlines():
        stripped = line.strip()
        if not seen_content and re.match(r"^[A-Za-z_][\w.]*\([^)]*\)(?:\s*->.*)?$", stripped):
            continue
        if stripped:
            seen_content = True
        lines.append(line)

    return "\n".join(lines).strip()


def _parse_doc_payload(name: BaseName) -> dict:
    raw = (_get_docstring(name) or "").strip()
    cleaned = _strip_signature_prelude(raw)
    summary = ""
    parameters = []
    returns = ""

    if cleaned:
        try:
            parsed = docstring_parser.parse(cleaned)
            summary_parts = []
            if parsed.short_description:
                summary_parts.append(parsed.short_description.strip())
            if parsed.long_description:
                summary_parts.append(parsed.long_description.strip())
            summary = "\n\n".join(part for part in summary_parts if part)
            parameters = [
                {
                    "name": (param.arg_name or "").strip(),
                    "label": (
                        f"{(param.arg_name or '').strip()}: {param.type_name}"
                        if param.arg_name and param.type_name
                        else (param.arg_name or "").strip()
                    ),
                    "documentation": (param.description or "").strip(),
                }
                for param in parsed.params
                if param.arg_name or param.description
            ]
            returns = (
                (parsed.returns.description or "").strip()
                if parsed.returns and parsed.returns.description
                else ""
            )
        except Exception:
            summary = cleaned
    elif raw:
        summary = raw

    return {
        "raw": raw,
        "summary": summary,
        "parameters": parameters,
        "returns": returns,
    }


def _signatures_for_name(name: BaseName):
    try:
        signatures = name.get_signatures()
    except Exception:
        signatures = []

    if signatures:
        return signatures

    if getattr(name, "type", "") == "class" and isinstance(name, Name):
        try:
            defined_names = name.defined_names()
        except Exception:
            defined_names = []

        for defined_name in defined_names:
            if defined_name.name != "__init__":
                continue
            try:
                signatures = defined_name.get_signatures()
            except Exception:
                signatures = []
            if signatures:
                return signatures

    return []


def _completion_signatures(completion):
    signatures = _signatures_for_name(completion)
    if signatures:
        return signatures

    try:
        inferred_names = completion.infer()
    except Exception:
        inferred_names = []

    for inferred_name in inferred_names:
        signatures = _signatures_for_name(inferred_name)
        if signatures:
            return signatures

    return []


def _map_completion_item(completion) -> dict:
    signatures = [_map_signature(signature) for signature in _completion_signatures(completion)[:2]]
    return {
        "label": completion.name_with_symbols,
        "name": completion.name,
        "kind": completion.type or "text",
        "detail": (completion.description or "").strip(),
        "moduleName": completion.module_name or "",
        "fullName": completion.full_name or "",
        "callable": bool(signatures),
        "signatures": signatures,
    }


def _map_signature(signature: Signature) -> dict:
    doc_payload = _parse_doc_payload(signature)
    parameter_docs = {
        (parameter.get("name") or "").lstrip("*"): parameter.get("documentation") or ""
        for parameter in doc_payload.get("parameters") or []
    }

    mapped_parameters = []
    for parameter in signature.params:
        label = parameter.to_string()
        normalized_name = label.split(":", 1)[0].split("=", 1)[0].strip().lstrip("*")
        # The real calling convention (POSITIONAL_ONLY / VAR_POSITIONAL / ...),
        # the source of truth for whether an argument may be passed by keyword.
        # The slash marker is not reliably present in the params list. Jedi
        # exposes this as the ParamName.kind property (an inspect.Parameter kind).
        try:
            kind = parameter.kind.name
        except Exception:
            kind = ""
        mapped_parameters.append(
            {
                "name": normalized_name,
                "label": label,
                "kind": kind,
                "documentation": parameter_docs.get(normalized_name, ""),
            }
        )

    active_index = getattr(signature, "index", None)
    return {
        "label": signature.to_string(),
        "documentation": doc_payload,
        "parameters": mapped_parameters,
        "activeParameter": active_index if active_index is not None else 0,
    }


def _name_signature(name: BaseName) -> str:
    try:
        signatures = name.get_signatures()
    except Exception:
        signatures = []

    if signatures:
        return signatures[0].to_string()

    description = (name.description or "").strip()
    if description.startswith("def ") or description.startswith("class "):
        return description

    rendered = (name.docstring() or "").strip()
    first_line = rendered.splitlines()[0].strip() if rendered else ""
    return first_line


def _script_for_payload(payload: dict):
    project = _build_project(payload.get("extraSysPath") or [])
    return jedi.Script(
        code=payload.get("code") or "",
        path=payload.get("path") or None,
        project=project,
    )


def _complete(payload: dict) -> dict:
    script = _script_for_payload(payload)
    completions = script.complete(int(payload["line"]), int(payload["column"]))
    return {"items": [_map_completion_item(completion) for completion in completions]}


def _get_signatures(payload: dict) -> dict:
    script = _script_for_payload(payload)
    signatures = script.get_signatures(int(payload["line"]), int(payload["column"]))
    if not signatures:
        return {"signatures": [], "activeSignature": 0, "activeParameter": 0}

    active_parameter = signatures[0].index if signatures[0].index is not None else 0
    return {
        "signatures": [_map_signature(signature) for signature in signatures],
        "activeSignature": 0,
        "activeParameter": active_parameter,
    }


def _hover(payload: dict):
    script = _script_for_payload(payload)
    names = script.infer(int(payload["line"]), int(payload["column"]))
    if not names:
        names = script.goto(int(payload["line"]), int(payload["column"]), follow_imports=True)
    if not names:
        return None

    name = names[0]
    return {
        "label": name.name,
        "kind": name.type,
        "detail": (name.description or "").strip(),
        "fullName": name.full_name or "",
        "signature": _name_signature(name),
        "documentation": _parse_doc_payload(name),
    }


def __pycollab_handle_request(action: str, payload_json: str) -> str:
    payload = json.loads(payload_json)

    if action == "complete":
        result = _complete(payload)
    elif action == "signatures":
        result = _get_signatures(payload)
    elif action == "hover":
        result = _hover(payload)
    else:
        raise ValueError(f"Unsupported analyzer action: {action}")

    return json.dumps(result)
`;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
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
  if (!err) return "Unknown analyzer error.";
  if (typeof err === "string") return err;
  if (err.message) {
    if (typeof err.message === "string") return err.message;
    try {
      return safeStringify(err.message);
    } catch {
      return String(err.message);
    }
  }
  try {
    return safeStringify(err);
  } catch {
    return String(err);
  }
}

function parseErrorCode(err) {
  if (!err || typeof err !== "object") return "";
  return typeof err.code === "string" ? err.code.toUpperCase() : "";
}

function parseErrno(err) {
  if (!err || typeof err !== "object") return null;
  return typeof err.errno === "number" ? err.errno : null;
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

function isUnknownPyodidePackageError(err) {
  const text = parseErrorText(err);
  return text.includes("NO KNOWN PACKAGE") || text.includes("NO SUCH PACKAGE");
}

function isFsAlreadyExistsError(err) {
  const errno = parseErrno(err);
  if (errno === 17 || errno === 20) return true;
  const code = parseErrorCode(err);
  if (code === "EEXIST") return true;
  const text = parseErrorText(err);
  return text.includes("EEXIST") || text.includes("FILE EXISTS");
}

function isFsNoSuchFileError(err) {
  const errno = parseErrno(err);
  if (errno === 2 || errno === 44) return true;
  const code = parseErrorCode(err);
  if (code === "ENOENT") return true;
  const text = parseErrorText(err);
  return text.includes("ENOENT") || text.includes("NO SUCH FILE");
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
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor += `/${parts[index]}`;
    ensureFsDir(cursor);
  }
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

function deleteWorkspaceFile(path) {
  try {
    pyodide.FS.unlink(path);
  } catch (err) {
    if (!isFsNoSuchFileError(err)) {
      throw err;
    }
  }
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
    console.warn(`[python-intelligence] Failed to load pyodide lockfile from ${lockUrl}.`, err);
  }
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
  const payload = files.map((file) => ({ name: file.projectPath, content: file.content || "" }));
  pyodide.globals.set("__pycollab_intelligence_files_json", JSON.stringify(payload));
  try {
    const raw = await pyodide.runPythonAsync(`
import ast
import json
import re
import sys

files = json.loads(__pycollab_intelligence_files_json)
stdlib = set(getattr(sys, "stdlib_module_names", []))
imports = set()

# A file being typed almost always has a syntax error somewhere (a trailing
# 'numpy.', a half-written line). ast.parse would then yield nothing, so the
# packages that file imports would never get installed. This line regex runs
# as a fallback so a half-written file still advertises its dependencies.
import_re = re.compile(r"^[ \\t]*(?:import[ \\t]+([\\w.]+)|from[ \\t]+([\\w.]+)[ \\t]+import)", re.M)

for item in files:
    source = item.get("content") or ""
    filename = item.get("name") or "<file>"

    parsed = None
    try:
        parsed = ast.parse(source, filename=filename)
    except SyntaxError:
        parsed = None

    if parsed is not None:
        for node in ast.walk(parsed):
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
    else:
        for match in import_re.finditer(source):
            module = match.group(1) or match.group(2) or ""
            root = module.split(".", 1)[0]
            if root:
                imports.add(root)

json.dumps(sorted(name for name in imports if name and name not in stdlib))
    `);
    return JSON.parse(raw);
  } finally {
    pyodide.globals.delete("__pycollab_intelligence_files_json");
  }
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

async function ensureProjectPackages(files) {
  const localModules = buildLocalModuleNames(files);
  const discoveredImports = await discoverImports(files);

  for (const moduleName of discoveredImports) {
    const normalizedModule = normalizePackageName(moduleName);
    if (!normalizedModule || localModules.has(normalizedModule) || ANALYZER_PROVIDED_MODULES.has(normalizedModule)) {
      continue;
    }

    const packageName = resolvePyodidePackageForModule(normalizedModule);
    if (!packageName || ANALYZER_PROVIDED_MODULES.has(packageName)) {
      continue;
    }

    try {
      await pyodide.loadPackage(packageName);
    } catch (err) {
      if (!isUnknownPyodidePackageError(err)) {
        console.warn(`[python-intelligence] Failed to load package '${packageName}'.`, err);
      }
    }
  }
}

async function installAnalyzerPackages(assetBaseUrl) {
  if (installedAnalyzer) return;

  const absoluteAssetBase = resolveAbsoluteUrl(
    assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`
  );

  const wheelDir = "/tmp/pycollab-intelligence-wheels";
  ensureFsDir("/tmp");
  ensureFsDir(wheelDir);

  const wheelPaths = [];
  for (const wheel of ANALYZER_WHEELS) {
    const wheelUrl = resolveAbsoluteUrl(wheel, absoluteAssetBase);
    const response = await fetch(wheelUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch analyzer wheel '${wheel}' (${response.status}).`);
    }

    const wheelPath = `${wheelDir}/${wheel}`;
    pyodide.FS.writeFile(wheelPath, new Uint8Array(await response.arrayBuffer()));
    wheelPaths.push(wheelPath);
  }

  pyodide.globals.set(
    "__pycollab_intelligence_wheel_paths_json",
    JSON.stringify(wheelPaths)
  );
  try {
    await pyodide.runPythonAsync(`
import json
import importlib
import os
import sysconfig
import zipfile

wheel_paths = json.loads(__pycollab_intelligence_wheel_paths_json)
site_packages = sysconfig.get_paths().get("purelib") or sysconfig.get_paths().get("platlib")
if not site_packages:
    raise RuntimeError("Could not determine site-packages path for analyzer wheels.")

os.makedirs(site_packages, exist_ok=True)
for wheel_path in wheel_paths:
    with zipfile.ZipFile(wheel_path) as archive:
        archive.extractall(site_packages)

importlib.invalidate_caches()
    `);
  } finally {
    pyodide.globals.delete("__pycollab_intelligence_wheel_paths_json");
    for (const wheelPath of wheelPaths) {
      deleteWorkspaceFile(wheelPath);
    }
  }

  pybricksSysPath = JSON.parse(
    await pyodide.runPythonAsync(`
import json
import os
import pybricks

json.dumps(os.path.dirname(os.path.dirname(pybricks.__file__)))
    `)
  );

  await pyodide.runPythonAsync(PYTHON_ANALYZER_BOOTSTRAP);
  installedAnalyzer = true;
}

async function loadAnalyzer(config) {
  runtimeConfig = {
    pyodideBaseUrl: String(config?.pyodide_base_url || "").trim(),
    allowedPackages: Array.isArray(config?.allowed_packages) ? config.allowed_packages : [],
    assetBaseUrl: String(config?.asset_base_url || "").trim(),
  };

  if (!runtimeConfig.pyodideBaseUrl) {
    throw new Error("Missing pyodide_base_url runtime config.");
  }
  if (!runtimeConfig.assetBaseUrl) {
    throw new Error("Missing analyzer asset base URL.");
  }

  const base = runtimeConfig.pyodideBaseUrl.endsWith("/")
    ? runtimeConfig.pyodideBaseUrl
    : `${runtimeConfig.pyodideBaseUrl}/`;
  const absoluteBase = resolveAbsoluteUrl(base);

  if (!self.loadPyodide) {
    importScripts(resolveAbsoluteUrl("pyodide.js", absoluteBase));
  }

  pyodide = await self.loadPyodide({ indexURL: absoluteBase });
  await hydratePyodidePackageIndex(absoluteBase);
  ensureFsDir("/workspace");
  await installAnalyzerPackages(runtimeConfig.assetBaseUrl);
}

function normalizeProjectFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    projectPath: normalizeProjectPath(file?.name || ""),
    content: typeof file?.content === "string" ? file.content : "",
  }));
}

async function syncProjectFiles(files, isPybricksProject) {
  const normalizedFiles = normalizeProjectFiles(files);
  const nextFiles = new Map(normalizedFiles.map((file) => [file.projectPath, file.content]));

  for (const projectPath of syncedProjectFiles.keys()) {
    if (!nextFiles.has(projectPath)) {
      deleteWorkspaceFile(fsPathForProjectPath(projectPath));
    }
  }

  for (const file of normalizedFiles) {
    const existingContent = syncedProjectFiles.get(file.projectPath);
    if (existingContent === file.content) {
      continue;
    }

    const targetPath = fsPathForProjectPath(file.projectPath);
    ensureFsParents(targetPath);
    pyodide.FS.writeFile(targetPath, file.content, { encoding: "utf8" });
  }

  syncedProjectFiles = nextFiles;
  lastProjectMode = isPybricksProject ? "pybricks" : "normal";
  await ensureProjectPackages(normalizedFiles);
}

async function callAnalyzer(action, payload) {
  if (!pyodide || !installedAnalyzer) {
    throw new Error("Python analyzer is not ready.");
  }
  pyodide.globals.set("__pycollab_intelligence_action", action);
  pyodide.globals.set("__pycollab_intelligence_payload_json", JSON.stringify(payload));
  try {
    const raw = await pyodide.runPythonAsync(
      `__pycollab_handle_request(__pycollab_intelligence_action, __pycollab_intelligence_payload_json)`
    );
    return JSON.parse(raw);
  } finally {
    pyodide.globals.delete("__pycollab_intelligence_action");
    pyodide.globals.delete("__pycollab_intelligence_payload_json");
  }
}

function buildAnalyzerPayload(message) {
  const path = normalizeProjectPath(message.path || "");
  return {
    code: typeof message.code === "string" ? message.code : "",
    path: fsPathForProjectPath(path),
    line: Number(message.line || 1),
    column: Number(message.column || 0),
    extraSysPath: message.isPybricksProject && pybricksSysPath ? [pybricksSysPath] : [],
  };
}

self.onmessage = async (event) => {
  const message = event.data || {};

  try {
    if (message.type === "BOOT") {
      await loadAnalyzer(message.config || {});
      post("READY");
      return;
    }

    if (message.type === "SYNC_PROJECT") {
      await syncProjectFiles(message.files || [], Boolean(message.isPybricksProject));
      post("RESPONSE", { requestId: message.requestId, ok: true, result: { synced: true, mode: lastProjectMode } });
      return;
    }

    if (message.type === "COMPLETE" || message.type === "SIGNATURES" || message.type === "HOVER") {
      const action =
        message.type === "COMPLETE"
          ? "complete"
          : message.type === "SIGNATURES"
            ? "signatures"
            : "hover";
      const result = await callAnalyzer(action, buildAnalyzerPayload(message));
      post("RESPONSE", { requestId: message.requestId, ok: true, result });
      return;
    }

    if (message.type === "DISPOSE") {
      close();
    }
  } catch (err) {
    post("RESPONSE", {
      requestId: message.requestId,
      ok: false,
      error: normalizeError(err),
    });
  }
};
