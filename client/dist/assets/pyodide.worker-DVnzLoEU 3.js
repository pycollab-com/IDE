(function(){"use strict";let o=null,_=null,m=null,l=null,R=null,w="message",y=[],k=0,b=!1,T=null,h=!1,A=!1,O=!1,E=new Map;const $=new TextEncoder,z=new Map([["pil","pillow"],["sklearn","scikit-learn"],["bs4","beautifulsoup4"],["yaml","pyyaml"]]);function a(e,t={}){self.postMessage({type:e,...t})}function j(e){if(typeof e=="number"&&Number.isFinite(e))try{return String.fromCodePoint(e)}catch{return String.fromCharCode(e)}return String(e??"")}function P(e){const t=new WeakSet;return JSON.stringify(e,(r,n)=>{if(typeof n=="object"&&n!==null){if(t.has(n))return"[Circular]";t.add(n)}return n})}function S(e){if(!e)return"Unknown runtime error.";if(typeof e=="string")return e;if(e.message){if(typeof e.message=="string")return e.message;try{return P(e.message)}catch{return String(e.message)}}if(typeof e=="object")try{const t=P(e);if(t&&t!=="{}")return t}catch{}return String(e)}function L(e){return!e||typeof e!="object"?null:typeof e.errno=="number"?e.errno:null}function F(e){return!e||typeof e!="object"?"":typeof e.code=="string"?e.code.toUpperCase():""}function C(e){const t=S(e);return typeof t=="string"?t.toUpperCase():""}function N(e){return String(e||"").trim().toLowerCase()}function W(e){const t=[],r=new Set;for(const n of e||[]){const i=N(n);!i||r.has(i)||(r.add(i),t.push(i))}return t.length?t.length===1?`Module not found: ${t[0]}`:`Modules not found: ${t.join(", ")}`:"Module not found."}function B(e){const t=C(e);return t.includes("NO KNOWN PACKAGE")||t.includes("NO SUCH PACKAGE")}function K(e){const t=N(e);if(!t)return"";const r=E.get(t);if(r)return r;const n=z.get(t);return n||t}async function v(e){E=new Map;const t=new URL("pyodide-lock.json",e).toString();try{const r=await fetch(t);if(!r.ok)return;const n=await r.json(),i=n==null?void 0:n.packages;if(!i||typeof i!="object")return;for(const[u,p]of Object.entries(i)){const d=N(u);if(!d)continue;E.has(d)||E.set(d,d);const s=Array.isArray(p==null?void 0:p.imports)?p.imports:[];for(const g of s){const f=N(g);!f||E.has(f)||E.set(f,d)}}}catch(r){console.warn(`[pyodide] Failed to load pyodide lockfile: ${t}. Falling back to direct import-name package resolution.`,r)}}function J(e){const t=L(e);if(t===2||t===44||F(e)==="ENOENT")return!0;const n=C(e);return n.includes("ENOENT")||n.includes("NO SUCH FILE")||n.includes("NO SUCH FILE OR DIRECTORY")}function G(e){const t=L(e);if(t===17||t===20||F(e)==="EEXIST")return!0;const n=C(e);return n.includes("EEXIST")||n.includes("FILE EXISTS")}function H(e){const t=S(e);return t.includes("KeyboardInterrupt")||t.includes("InterruptedError")}function Q(e){const t=String(e||"").replace(/\\/g,"/").trim();if(!t)throw new Error("Project file name cannot be empty.");if(t.startsWith("/")||t.includes("\0"))throw new Error(`Unsafe project file path: ${e}`);const r=[];for(const n of t.split("/"))if(!(!n||n===".")){if(n==="..")throw new Error(`Unsafe project file path: ${e}`);r.push(n)}if(!r.length)throw new Error(`Invalid project file path: ${e}`);return r.join("/")}function M(e){return`/workspace/${e}`}function U(e){try{o.FS.mkdir(e)}catch(t){if(!G(t))throw t}}function X(e){const t=e.split("/").filter(Boolean);let r="";for(let n=0;n<t.length-1;n+=1)r+=`/${t[n]}`,U(r)}function D(e){const t=o.FS.readdir(e);for(const r of t){if(r==="."||r==="..")continue;const n=`${e}/${r}`,i=o.FS.stat(n);o.FS.isDir(i.mode)?D(n):o.FS.unlink(n)}o.FS.rmdir(e)}function Y(){try{D("/workspace")}catch(e){if(!J(e))throw e}U("/workspace")}function q(){y=[],k=0,b=!1}function V(e){typeof e!="string"||!e.length||y.push($.encode(e))}function I(){if(w==="shared"){if(!l)return;Atomics.store(l,2,1),Atomics.notify(l,1,1);return}b=!0}function Z(e){if(!l||!R)return null;const t=R.length;for(;;){const u=Atomics.load(l,0),p=Atomics.load(l,1);if(u!==p)break;if(Atomics.load(l,2)===1)return null;Atomics.wait(l,1,p,1e3)}const r=[];let n=Atomics.load(l,0);const i=Atomics.load(l,1);for(;n!==i&&r.length<e;)r.push(R[n]),n=(n+1)%t;return Atomics.store(l,0,n),new Uint8Array(r)}function ee(e){for(;!y.length&&!b&&!A;);if(!y.length)return null;const t=[];for(;y.length&&t.length<e;){const r=y[0];t.push(r[k]),k+=1,k>=r.length&&(y.shift(),k=0)}return new Uint8Array(t)}function te(e){const t=w==="shared"?Z(e.length):ee(e.length);return t===null?0:(e.set(t),t.length)}function x(){m&&Atomics.store(m,0,2),I()}function ne(e){const t=new Set;for(const r of e){const n=r.projectPath.split("/"),i=n[n.length-1];if(i.endsWith(".py")){const u=i.slice(0,-3).toLowerCase();u&&u!=="__init__"&&t.add(u),u==="__init__"&&n.length>1&&t.add(n[n.length-2].toLowerCase())}n.length>1&&t.add(n[0].toLowerCase())}return t}async function re(e){const t=e.map(r=>({name:r.projectPath,content:r.content||""}));o.globals.set("__pycollab_files_json",JSON.stringify(t));try{const r=await o.runPythonAsync(`
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
    `);return JSON.parse(r)}finally{o.globals.delete("__pycollab_files_json")}}async function oe(e,t){const r=ne(e),n=await re(e),i=[],u=new Set;for(const f of n){const c=N(f);!c||r.has(c)||u.has(c)||(u.add(c),i.push(c))}const p=t.size>0,d=[],s=[],g=new Set;for(const f of i){const c=K(f);if(!(!p||t.has(f)||t.has(c))){d.push(f);continue}c&&!g.has(c)&&(g.add(c),s.push(c))}if(d.length)throw new Error(W(d));for(const f of s)try{await o.loadPackage(f)}catch(c){if(B(c))continue;throw c}}async function ie(e){if(!(e instanceof Set)||e.size===0){await o.runPythonAsync(`
try:
    import micropip
except Exception:
    micropip = None

if micropip is not None and hasattr(micropip, "__pycollab_orig_install__"):
    micropip.install = micropip.__pycollab_orig_install__
    `);return}o.globals.set("__pycollab_allowed_packages_json",JSON.stringify([...e]));try{await o.runPythonAsync(`
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
    `)}finally{o.globals.delete("__pycollab_allowed_packages_json")}}function se(e,t){const r=e.find(i=>i.id===t);if(r)return r;const n=e.find(i=>i.projectPath==="main.py");return n||e[0]}async function ae(e,t,r){if(!Array.isArray(e)||e.length===0)throw new Error("No files in project.");const n=e.map(s=>({id:Number(s.id),projectPath:Q(s.name||""),content:typeof s.content=="string"?s.content:""}));Y();for(const s of n){const g=M(s.projectPath);X(g),o.FS.writeFile(g,s.content,{encoding:"utf8"})}const i=se(n,t),u=M(i.projectPath),p=new Set((_.allowed_packages||[]).map(s=>String(s).toLowerCase()));await oe(n,p),O=!1;let d=null;m&&Number(r)>0&&(d=setTimeout(()=>{O=!0,x()},Number(r)*1e3)),o.globals.set("__pycollab_entry_path",u);try{const s=await o.runPythonAsync(`
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
    `);return Number(s)}finally{d&&clearTimeout(d),o.globals.delete("__pycollab_entry_path")}}async function le(e,t){if(_={pyodide_base_url:String((e==null?void 0:e.pyodide_base_url)||"").trim(),allowed_packages:Array.isArray(e==null?void 0:e.allowed_packages)?e.allowed_packages:[],max_run_seconds:Number((e==null?void 0:e.max_run_seconds)??0)},w=(e==null?void 0:e.stdin_mode)==="shared"?"shared":"message",w==="shared"){if(!(t!=null&&t.interrupt)||!(t!=null&&t.stdinControl)||!(t!=null&&t.stdinData))throw new Error("Missing shared stdin buffers.");m=new Int32Array(t.interrupt),l=new Int32Array(t.stdinControl),R=new Uint8Array(t.stdinData),Atomics.store(m,0,0)}else m=null,l=null,R=null,q();if(!_.pyodide_base_url)throw new Error("Missing pyodide_base_url runtime config.");const r=_.pyodide_base_url.endsWith("/")?_.pyodide_base_url:`${_.pyodide_base_url}/`;self.loadPyodide||importScripts(`${r}pyodide.js`),o=await self.loadPyodide({indexURL:r}),await v(r),o.setStdout({raw:n=>a("STDOUT",{data:j(n)})}),o.setStderr({raw:n=>a("STDERR",{data:j(n)})}),o.setStdin({read(n){return te(n)}}),m&&o.setInterruptBuffer(m),await ie(new Set(_.allowed_packages.map(n=>String(n).toLowerCase())))}async function ce(e){if(h){a("STDERR",{data:`[compiler] Runtime already has an active run.
`});return}if(!o){a("RUNTIME_ERROR",{message:"Runtime is not ready."});return}h=!0,A=!1,O=!1,T=e.runId,m&&Atomics.store(m,0,0),w==="shared"?Atomics.store(l,2,0):q(),a("STATUS",{state:"running"});let t=1;try{t=await ae(Array.isArray(e.files)?e.files:[],e.entryFileId==null?null:Number(e.entryFileId),_.max_run_seconds),O&&(a("STDERR",{data:`[compiler] Execution timed out after ${_.max_run_seconds} seconds.
`}),t=-1)}catch(r){O?(a("STDERR",{data:`[compiler] Execution timed out after ${_.max_run_seconds} seconds.
`}),t=-1):H(r)?t=130:(a("STDERR",{data:`[compiler] ${S(r)}
`}),t=1)}finally{h=!1,T=null,I(),a("RUN_RESULT",{runId:e.runId,returnCode:t}),a("STATUS",{state:"stopped"})}}self.onmessage=async e=>{const t=e.data||{};try{if(t.type==="BOOT"){await le(t.config||{},t.buffers||{}),a("RUNTIME_READY");return}if(t.type==="RUN"){await ce(t);return}if(t.type==="STDIN"){if(!h||w!=="message"||t.runId&&T&&t.runId!==T)return;V(String(t.data||""));return}if(t.type==="STOP"){if(!h)return;A=!0,x();return}if(t.type==="DISPOSE"){A=!0,x(),close();return}}catch(r){a("RUNTIME_ERROR",{message:S(r)}),h&&(h=!1,T=null,I(),a("STATUS",{state:"stopped"}))}},self.addEventListener("error",e=>{a("RUNTIME_ERROR",{message:S(e.error||e.message)})}),self.addEventListener("unhandledrejection",e=>{a("RUNTIME_ERROR",{message:S(e.reason)})})})();
