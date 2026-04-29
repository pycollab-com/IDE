(function(){"use strict";let o=null,c=null,f=!1,p=new Map,y=new Map,g="",P="normal";const O=new Map([["pil","pillow"],["sklearn","scikit-learn"],["bs4","beautifulsoup4"],["yaml","pyyaml"]]),F=Object.freeze(["jedi-0.19.2-py2.py3-none-any.whl","parso-0.8.5-py2.py3-none-any.whl","docstring_parser-0.14.1-py3-none-any.whl","pybricks-3.6.1-py3-none-any.whl"]),j=new Set(["docstring_parser","jedi","micropython","parso","pybricks","uerrno","uio","ujson","umath","urandom","uselect","ustruct","usys"]),z=String.raw`
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
        mapped_parameters.append(
            {
                "name": normalized_name,
                "label": label,
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
`;function d(e,t={}){self.postMessage({type:e,...t})}function E(e){const t=new WeakSet;return JSON.stringify(e,(r,n)=>{if(typeof n=="object"&&n!==null){if(t.has(n))return"[Circular]";t.add(n)}return n})}function S(e){if(!e)return"Unknown analyzer error.";if(typeof e=="string")return e;if(e.message){if(typeof e.message=="string")return e.message;try{return E(e.message)}catch{return String(e.message)}}try{return E(e)}catch{return String(e)}}function k(e){return!e||typeof e!="object"?"":typeof e.code=="string"?e.code.toUpperCase():""}function N(e){return!e||typeof e!="object"?null:typeof e.errno=="number"?e.errno:null}function h(e){const t=S(e);return typeof t=="string"?t.toUpperCase():""}function u(e){return String(e||"").trim().toLowerCase()}function m(e,t=self.location.href){return new URL(String(e||""),t).toString()}function U(e){const t=h(e);return t.includes("NO KNOWN PACKAGE")||t.includes("NO SUCH PACKAGE")}function I(e){const t=N(e);if(t===17||t===20||k(e)==="EEXIST")return!0;const n=h(e);return n.includes("EEXIST")||n.includes("FILE EXISTS")}function C(e){const t=N(e);if(t===2||t===44||k(e)==="ENOENT")return!0;const n=h(e);return n.includes("ENOENT")||n.includes("NO SUCH FILE")}function _(e){try{o.FS.mkdir(e)}catch(t){if(!I(t))throw t}}function R(e){const t=e.split("/").filter(Boolean);let r="";for(let n=0;n<t.length-1;n+=1)r+=`/${t[n]}`,_(r)}function A(e){const t=String(e||"").replace(/\\/g,"/").trim();if(!t)throw new Error("Project file name cannot be empty.");if(t.startsWith("/")||t.includes("\0"))throw new Error(`Unsafe project file path: ${e}`);const r=[];for(const n of t.split("/"))if(!(!n||n===".")){if(n==="..")throw new Error(`Unsafe project file path: ${e}`);r.push(n)}if(!r.length)throw new Error(`Invalid project file path: ${e}`);return r.join("/")}function w(e){return`/workspace/${e}`}function x(e){try{o.FS.unlink(e)}catch(t){if(!C(t))throw t}}async function T(e){p=new Map;const t=new URL("pyodide-lock.json",e).toString();try{const r=await fetch(t);if(!r.ok)return;const n=await r.json(),a=n==null?void 0:n.packages;if(!a||typeof a!="object")return;for(const[i,s]of Object.entries(a)){const l=u(i);if(!l)continue;p.has(l)||p.set(l,l);const Y=Array.isArray(s==null?void 0:s.imports)?s.imports:[];for(const G of Y){const b=u(G);!b||p.has(b)||p.set(b,l)}}}catch(r){console.warn(`[python-intelligence] Failed to load pyodide lockfile from ${t}.`,r)}}function v(e){const t=new Set;for(const r of e){const n=r.projectPath.split("/"),a=n[n.length-1];if(a.endsWith(".py")){const i=a.slice(0,-3).toLowerCase();i&&i!=="__init__"&&t.add(i),i==="__init__"&&n.length>1&&t.add(n[n.length-2].toLowerCase())}n.length>1&&t.add(n[0].toLowerCase())}return t}async function L(e){const t=e.map(r=>({name:r.projectPath,content:r.content||""}));o.globals.set("__pycollab_intelligence_files_json",JSON.stringify(t));try{const r=await o.runPythonAsync(`
import ast
import json
import sys

files = json.loads(__pycollab_intelligence_files_json)
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
    `);return JSON.parse(r)}finally{o.globals.delete("__pycollab_intelligence_files_json")}}function B(e){const t=u(e);if(!t)return"";const r=p.get(t);if(r)return r;const n=O.get(t);return n||t}async function M(e){const t=v(e),r=await L(e);for(const n of r){const a=u(n);if(!a||t.has(a)||j.has(a))continue;const i=B(a);if(!(!i||j.has(i)))try{await o.loadPackage(i)}catch(s){U(s)||console.warn(`[python-intelligence] Failed to load package '${i}'.`,s)}}}async function $(e){if(f)return;const t=m(e.endsWith("/")?e:`${e}/`),r="/tmp/pycollab-intelligence-wheels";_("/tmp"),_(r);const n=[];for(const a of F){const i=m(a,t),s=await fetch(i);if(!s.ok)throw new Error(`Failed to fetch analyzer wheel '${a}' (${s.status}).`);const l=`${r}/${a}`;o.FS.writeFile(l,new Uint8Array(await s.arrayBuffer())),n.push(l)}o.globals.set("__pycollab_intelligence_wheel_paths_json",JSON.stringify(n));try{await o.runPythonAsync(`
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
    `)}finally{o.globals.delete("__pycollab_intelligence_wheel_paths_json");for(const a of n)x(a)}g=JSON.parse(await o.runPythonAsync(`
import json
import os
import pybricks

json.dumps(os.path.dirname(os.path.dirname(pybricks.__file__)))
    `)),await o.runPythonAsync(z),f=!0}async function W(e){if(c={pyodideBaseUrl:String((e==null?void 0:e.pyodide_base_url)||"").trim(),allowedPackages:Array.isArray(e==null?void 0:e.allowed_packages)?e.allowed_packages:[],assetBaseUrl:String((e==null?void 0:e.asset_base_url)||"").trim()},!c.pyodideBaseUrl)throw new Error("Missing pyodide_base_url runtime config.");if(!c.assetBaseUrl)throw new Error("Missing analyzer asset base URL.");const t=c.pyodideBaseUrl.endsWith("/")?c.pyodideBaseUrl:`${c.pyodideBaseUrl}/`,r=m(t);self.loadPyodide||importScripts(m("pyodide.js",r)),o=await self.loadPyodide({indexURL:r}),await T(r),_("/workspace"),await $(c.assetBaseUrl)}function q(e){return(Array.isArray(e)?e:[]).map(t=>({projectPath:A((t==null?void 0:t.name)||""),content:typeof(t==null?void 0:t.content)=="string"?t.content:""}))}async function J(e,t){const r=q(e),n=new Map(r.map(a=>[a.projectPath,a.content]));for(const a of y.keys())n.has(a)||x(w(a));for(const a of r){if(y.get(a.projectPath)===a.content)continue;const s=w(a.projectPath);R(s),o.FS.writeFile(s,a.content,{encoding:"utf8"})}y=n,P=t?"pybricks":"normal",await M(r)}async function D(e,t){if(!o||!f)throw new Error("Python analyzer is not ready.");o.globals.set("__pycollab_intelligence_action",e),o.globals.set("__pycollab_intelligence_payload_json",JSON.stringify(t));try{const r=await o.runPythonAsync("__pycollab_handle_request(__pycollab_intelligence_action, __pycollab_intelligence_payload_json)");return JSON.parse(r)}finally{o.globals.delete("__pycollab_intelligence_action"),o.globals.delete("__pycollab_intelligence_payload_json")}}function K(e){const t=A(e.path||"");return{code:typeof e.code=="string"?e.code:"",path:w(t),line:Number(e.line||1),column:Number(e.column||0),extraSysPath:e.isPybricksProject&&g?[g]:[]}}self.onmessage=async e=>{const t=e.data||{};try{if(t.type==="BOOT"){await W(t.config||{}),d("READY");return}if(t.type==="SYNC_PROJECT"){await J(t.files||[],!!t.isPybricksProject),d("RESPONSE",{requestId:t.requestId,ok:!0,result:{synced:!0,mode:P}});return}if(t.type==="COMPLETE"||t.type==="SIGNATURES"||t.type==="HOVER"){const r=t.type==="COMPLETE"?"complete":t.type==="SIGNATURES"?"signatures":"hover",n=await D(r,K(t));d("RESPONSE",{requestId:t.requestId,ok:!0,result:n});return}t.type==="DISPOSE"&&close()}catch(r){d("RESPONSE",{requestId:t.requestId,ok:!1,error:S(r)})}}})();
