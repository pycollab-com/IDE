(function(){"use strict";let o=null,p=null,f=!1,c=new Map,y=new Map,g="",P="normal";const O=new Map([["pil","pillow"],["sklearn","scikit-learn"],["bs4","beautifulsoup4"],["yaml","pyyaml"]]),I=Object.freeze(["jedi-0.19.2-py2.py3-none-any.whl","parso-0.8.5-py2.py3-none-any.whl","docstring_parser-0.14.1-py3-none-any.whl","pybricks-3.6.1-py3-none-any.whl"]),j=new Set(["docstring_parser","jedi","micropython","parso","pybricks","uerrno","uio","ujson","umath","urandom","uselect","ustruct","usys"]),F=String.raw`
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
`;function d(e,t={}){self.postMessage({type:e,...t})}function k(e){const t=new WeakSet;return JSON.stringify(e,(n,r)=>{if(typeof r=="object"&&r!==null){if(t.has(r))return"[Circular]";t.add(r)}return r})}function E(e){if(!e)return"Unknown analyzer error.";if(typeof e=="string")return e;if(e.message){if(typeof e.message=="string")return e.message;try{return k(e.message)}catch{return String(e.message)}}try{return k(e)}catch{return String(e)}}function S(e){return!e||typeof e!="object"?"":typeof e.code=="string"?e.code.toUpperCase():""}function N(e){return!e||typeof e!="object"?null:typeof e.errno=="number"?e.errno:null}function h(e){const t=E(e);return typeof t=="string"?t.toUpperCase():""}function m(e){return String(e||"").trim().toLowerCase()}function u(e,t=self.location.href){return new URL(String(e||""),t).toString()}function T(e){const t=h(e);return t.includes("NO KNOWN PACKAGE")||t.includes("NO SUCH PACKAGE")}function z(e){const t=N(e);if(t===17||t===20||S(e)==="EEXIST")return!0;const r=h(e);return r.includes("EEXIST")||r.includes("FILE EXISTS")}function U(e){const t=N(e);if(t===2||t===44||S(e)==="ENOENT")return!0;const r=h(e);return r.includes("ENOENT")||r.includes("NO SUCH FILE")}function _(e){try{o.FS.mkdir(e)}catch(t){if(!z(t))throw t}}function v(e){const t=e.split("/").filter(Boolean);let n="";for(let r=0;r<t.length-1;r+=1)n+=`/${t[r]}`,_(n)}function x(e){const t=String(e||"").replace(/\\/g,"/").trim();if(!t)throw new Error("Project file name cannot be empty.");if(t.startsWith("/")||t.includes("\0"))throw new Error(`Unsafe project file path: ${e}`);const n=[];for(const r of t.split("/"))if(!(!r||r===".")){if(r==="..")throw new Error(`Unsafe project file path: ${e}`);n.push(r)}if(!n.length)throw new Error(`Invalid project file path: ${e}`);return n.join("/")}function w(e){return`/workspace/${e}`}function A(e){try{o.FS.unlink(e)}catch(t){if(!U(t))throw t}}async function L(e){c=new Map;const t=new URL("pyodide-lock.json",e).toString();try{const n=await fetch(t);if(!n.ok)return;const r=await n.json(),a=r==null?void 0:r.packages;if(!a||typeof a!="object")return;for(const[i,s]of Object.entries(a)){const l=m(i);if(!l)continue;c.has(l)||c.set(l,l);const Y=Array.isArray(s==null?void 0:s.imports)?s.imports:[];for(const G of Y){const b=m(G);!b||c.has(b)||c.set(b,l)}}}catch(n){console.warn(`[python-intelligence] Failed to load pyodide lockfile from ${t}.`,n)}}function C(e){const t=new Set;for(const n of e){const r=n.projectPath.split("/"),a=r[r.length-1];if(a.endsWith(".py")){const i=a.slice(0,-3).toLowerCase();i&&i!=="__init__"&&t.add(i),i==="__init__"&&r.length>1&&t.add(r[r.length-2].toLowerCase())}r.length>1&&t.add(r[0].toLowerCase())}return t}async function R(e){const t=e.map(n=>({name:n.projectPath,content:n.content||""}));o.globals.set("__pycollab_intelligence_files_json",JSON.stringify(t));try{const n=await o.runPythonAsync(`
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
    `);return JSON.parse(n)}finally{o.globals.delete("__pycollab_intelligence_files_json")}}function B(e){const t=m(e);if(!t)return"";const n=c.get(t);if(n)return n;const r=O.get(t);return r||t}async function M(e){const t=C(e),n=await R(e);for(const r of n){const a=m(r);if(!a||t.has(a)||j.has(a))continue;const i=B(a);if(!(!i||j.has(i)))try{await o.loadPackage(i)}catch(s){T(s)||console.warn(`[python-intelligence] Failed to load package '${i}'.`,s)}}}async function $(e){if(f)return;const t=u(e.endsWith("/")?e:`${e}/`),n="/tmp/pycollab-intelligence-wheels";_("/tmp"),_(n);const r=[];for(const a of I){const i=u(a,t),s=await fetch(i);if(!s.ok)throw new Error(`Failed to fetch analyzer wheel '${a}' (${s.status}).`);const l=`${n}/${a}`;o.FS.writeFile(l,new Uint8Array(await s.arrayBuffer())),r.push(l)}o.globals.set("__pycollab_intelligence_wheel_paths_json",JSON.stringify(r));try{await o.runPythonAsync(`
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
    `)}finally{o.globals.delete("__pycollab_intelligence_wheel_paths_json");for(const a of r)A(a)}g=JSON.parse(await o.runPythonAsync(`
import json
import os
import pybricks

json.dumps(os.path.dirname(os.path.dirname(pybricks.__file__)))
    `)),await o.runPythonAsync(F),f=!0}async function W(e){if(p={pyodideBaseUrl:String((e==null?void 0:e.pyodide_base_url)||"").trim(),allowedPackages:Array.isArray(e==null?void 0:e.allowed_packages)?e.allowed_packages:[],assetBaseUrl:String((e==null?void 0:e.asset_base_url)||"").trim()},!p.pyodideBaseUrl)throw new Error("Missing pyodide_base_url runtime config.");if(!p.assetBaseUrl)throw new Error("Missing analyzer asset base URL.");const t=p.pyodideBaseUrl.endsWith("/")?p.pyodideBaseUrl:`${p.pyodideBaseUrl}/`,n=u(t);self.loadPyodide||importScripts(u("pyodide.js",n)),o=await self.loadPyodide({indexURL:n}),await L(n),_("/workspace"),await $(p.assetBaseUrl)}function J(e){return(Array.isArray(e)?e:[]).map(t=>({projectPath:x((t==null?void 0:t.name)||""),content:typeof(t==null?void 0:t.content)=="string"?t.content:""}))}async function q(e,t){const n=J(e),r=new Map(n.map(a=>[a.projectPath,a.content]));for(const a of y.keys())r.has(a)||A(w(a));for(const a of n){if(y.get(a.projectPath)===a.content)continue;const s=w(a.projectPath);v(s),o.FS.writeFile(s,a.content,{encoding:"utf8"})}y=r,P=t?"pybricks":"normal",await M(n)}async function D(e,t){if(!o||!f)throw new Error("Python analyzer is not ready.");o.globals.set("__pycollab_intelligence_action",e),o.globals.set("__pycollab_intelligence_payload_json",JSON.stringify(t));try{const n=await o.runPythonAsync("__pycollab_handle_request(__pycollab_intelligence_action, __pycollab_intelligence_payload_json)");return JSON.parse(n)}finally{o.globals.delete("__pycollab_intelligence_action"),o.globals.delete("__pycollab_intelligence_payload_json")}}function K(e){const t=x(e.path||"");return{code:typeof e.code=="string"?e.code:"",path:w(t),line:Number(e.line||1),column:Number(e.column||0),extraSysPath:e.isPybricksProject&&g?[g]:[]}}self.onmessage=async e=>{const t=e.data||{};try{if(t.type==="BOOT"){await W(t.config||{}),d("READY");return}if(t.type==="SYNC_PROJECT"){await q(t.files||[],!!t.isPybricksProject),d("RESPONSE",{requestId:t.requestId,ok:!0,result:{synced:!0,mode:P}});return}if(t.type==="COMPLETE"||t.type==="SIGNATURES"||t.type==="HOVER"){const n=t.type==="COMPLETE"?"complete":t.type==="SIGNATURES"?"signatures":"hover",r=await D(n,K(t));d("RESPONSE",{requestId:t.requestId,ok:!0,result:r});return}t.type==="DISPOSE"&&close()}catch(n){d("RESPONSE",{requestId:t.requestId,ok:!1,error:E(n)})}}})();
