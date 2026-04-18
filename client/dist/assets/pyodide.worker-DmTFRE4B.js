(function(){"use strict";let i=null,_=null,m=null,l=null,R=null,w="message",y=[],k=0,b=!1,T=null,h=!1,N=!1,O=!1,E=new Map;const $=new TextEncoder,W=new Map([["pil","pillow"],["sklearn","scikit-learn"],["bs4","beautifulsoup4"],["yaml","pyyaml"]]);function a(e,t={}){self.postMessage({type:e,...t})}function j(e){if(typeof e=="number"&&Number.isFinite(e))try{return String.fromCodePoint(e)}catch{return String.fromCharCode(e)}return String(e??"")}function L(e){const t=new WeakSet;return JSON.stringify(e,(r,n)=>{if(typeof n=="object"&&n!==null){if(t.has(n))return"[Circular]";t.add(n)}return n})}function S(e){if(!e)return"Unknown runtime error.";if(typeof e=="string")return e;if(e.message){if(typeof e.message=="string")return e.message;try{return L(e.message)}catch{return String(e.message)}}if(typeof e=="object")try{const t=L(e);if(t&&t!=="{}")return t}catch{}return String(e)}function P(e){return!e||typeof e!="object"?null:typeof e.errno=="number"?e.errno:null}function F(e){return!e||typeof e!="object"?"":typeof e.code=="string"?e.code.toUpperCase():""}function C(e){const t=S(e);return typeof t=="string"?t.toUpperCase():""}function A(e){return String(e||"").trim().toLowerCase()}function U(e,t=self.location.href){return new URL(String(e||""),t).toString()}function B(e){const t=[],r=new Set;for(const n of e||[]){const o=A(n);!o||r.has(o)||(r.add(o),t.push(o))}return t.length?t.length===1?`Module not found: ${t[0]}`:`Modules not found: ${t.join(", ")}`:"Module not found."}function K(e){const t=C(e);return t.includes("NO KNOWN PACKAGE")||t.includes("NO SUCH PACKAGE")}function v(e){const t=A(e);if(!t)return"";const r=E.get(t);if(r)return r;const n=W.get(t);return n||t}async function J(e){E=new Map;const t=new URL("pyodide-lock.json",e).toString();try{const r=await fetch(t);if(!r.ok)return;const n=await r.json(),o=n==null?void 0:n.packages;if(!o||typeof o!="object")return;for(const[u,p]of Object.entries(o)){const d=A(u);if(!d)continue;E.has(d)||E.set(d,d);const s=Array.isArray(p==null?void 0:p.imports)?p.imports:[];for(const g of s){const f=A(g);!f||E.has(f)||E.set(f,d)}}}catch(r){console.warn(`[pyodide] Failed to load pyodide lockfile: ${t}. Falling back to direct import-name package resolution.`,r)}}function G(e){const t=P(e);if(t===2||t===44||F(e)==="ENOENT")return!0;const n=C(e);return n.includes("ENOENT")||n.includes("NO SUCH FILE")||n.includes("NO SUCH FILE OR DIRECTORY")}function H(e){const t=P(e);if(t===17||t===20||F(e)==="EEXIST")return!0;const n=C(e);return n.includes("EEXIST")||n.includes("FILE EXISTS")}function Q(e){const t=S(e);return t.includes("KeyboardInterrupt")||t.includes("InterruptedError")}function X(e){const t=String(e||"").replace(/\\/g,"/").trim();if(!t)throw new Error("Project file name cannot be empty.");if(t.startsWith("/")||t.includes("\0"))throw new Error(`Unsafe project file path: ${e}`);const r=[];for(const n of t.split("/"))if(!(!n||n===".")){if(n==="..")throw new Error(`Unsafe project file path: ${e}`);r.push(n)}if(!r.length)throw new Error(`Invalid project file path: ${e}`);return r.join("/")}function M(e){return`/workspace/${e}`}function D(e){try{i.FS.mkdir(e)}catch(t){if(!H(t))throw t}}function Y(e){const t=e.split("/").filter(Boolean);let r="";for(let n=0;n<t.length-1;n+=1)r+=`/${t[n]}`,D(r)}function q(e){const t=i.FS.readdir(e);for(const r of t){if(r==="."||r==="..")continue;const n=`${e}/${r}`,o=i.FS.stat(n);i.FS.isDir(o.mode)?q(n):i.FS.unlink(n)}i.FS.rmdir(e)}function V(){try{q("/workspace")}catch(e){if(!G(e))throw e}D("/workspace")}function z(){y=[],k=0,b=!1}function Z(e){typeof e!="string"||!e.length||y.push($.encode(e))}function I(){if(w==="shared"){if(!l)return;Atomics.store(l,2,1),Atomics.notify(l,1,1);return}b=!0}function ee(e){if(!l||!R)return null;const t=R.length;for(;;){const u=Atomics.load(l,0),p=Atomics.load(l,1);if(u!==p)break;if(Atomics.load(l,2)===1)return null;Atomics.wait(l,1,p,1e3)}const r=[];let n=Atomics.load(l,0);const o=Atomics.load(l,1);for(;n!==o&&r.length<e;)r.push(R[n]),n=(n+1)%t;return Atomics.store(l,0,n),new Uint8Array(r)}function te(e){for(;!y.length&&!b&&!N;);if(!y.length)return null;const t=[];for(;y.length&&t.length<e;){const r=y[0];t.push(r[k]),k+=1,k>=r.length&&(y.shift(),k=0)}return new Uint8Array(t)}function ne(e){const t=w==="shared"?ee(e.length):te(e.length);return t===null?0:(e.set(t),t.length)}function x(){m&&Atomics.store(m,0,2),I()}function re(e){const t=new Set;for(const r of e){const n=r.projectPath.split("/"),o=n[n.length-1];if(o.endsWith(".py")){const u=o.slice(0,-3).toLowerCase();u&&u!=="__init__"&&t.add(u),u==="__init__"&&n.length>1&&t.add(n[n.length-2].toLowerCase())}n.length>1&&t.add(n[0].toLowerCase())}return t}async function oe(e){const t=e.map(r=>({name:r.projectPath,content:r.content||""}));i.globals.set("__pycollab_files_json",JSON.stringify(t));try{const r=await i.runPythonAsync(`
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
    `);return JSON.parse(r)}finally{i.globals.delete("__pycollab_files_json")}}async function ie(e,t){const r=re(e),n=await oe(e),o=[],u=new Set;for(const f of n){const c=A(f);!c||r.has(c)||u.has(c)||(u.add(c),o.push(c))}const p=t.size>0,d=[],s=[],g=new Set;for(const f of o){const c=v(f);if(!(!p||t.has(f)||t.has(c))){d.push(f);continue}c&&!g.has(c)&&(g.add(c),s.push(c))}if(d.length)throw new Error(B(d));for(const f of s)try{await i.loadPackage(f)}catch(c){if(K(c))continue;throw c}}async function se(e){if(!(e instanceof Set)||e.size===0){await i.runPythonAsync(`
try:
    import micropip
except Exception:
    micropip = None

if micropip is not None and hasattr(micropip, "__pycollab_orig_install__"):
    micropip.install = micropip.__pycollab_orig_install__
    `);return}i.globals.set("__pycollab_allowed_packages_json",JSON.stringify([...e]));try{await i.runPythonAsync(`
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
    `)}finally{i.globals.delete("__pycollab_allowed_packages_json")}}function ae(e,t){const r=e.find(o=>o.id===t);if(r)return r;const n=e.find(o=>o.projectPath==="main.py");return n||e[0]}async function le(e,t,r){if(!Array.isArray(e)||e.length===0)throw new Error("No files in project.");const n=e.map(s=>({id:Number(s.id),projectPath:X(s.name||""),content:typeof s.content=="string"?s.content:""}));V();for(const s of n){const g=M(s.projectPath);Y(g),i.FS.writeFile(g,s.content,{encoding:"utf8"})}const o=ae(n,t),u=M(o.projectPath),p=new Set((_.allowed_packages||[]).map(s=>String(s).toLowerCase()));await ie(n,p),O=!1;let d=null;m&&Number(r)>0&&(d=setTimeout(()=>{O=!0,x()},Number(r)*1e3)),i.globals.set("__pycollab_entry_path",u);try{const s=await i.runPythonAsync(`
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
    `);return Number(s)}finally{d&&clearTimeout(d),i.globals.delete("__pycollab_entry_path")}}async function ce(e,t){if(_={pyodide_base_url:String((e==null?void 0:e.pyodide_base_url)||"").trim(),allowed_packages:Array.isArray(e==null?void 0:e.allowed_packages)?e.allowed_packages:[],max_run_seconds:Number((e==null?void 0:e.max_run_seconds)??0)},w=(e==null?void 0:e.stdin_mode)==="shared"?"shared":"message",w==="shared"){if(!(t!=null&&t.interrupt)||!(t!=null&&t.stdinControl)||!(t!=null&&t.stdinData))throw new Error("Missing shared stdin buffers.");m=new Int32Array(t.interrupt),l=new Int32Array(t.stdinControl),R=new Uint8Array(t.stdinData),Atomics.store(m,0,0)}else m=null,l=null,R=null,z();if(!_.pyodide_base_url)throw new Error("Missing pyodide_base_url runtime config.");const r=_.pyodide_base_url.endsWith("/")?_.pyodide_base_url:`${_.pyodide_base_url}/`,n=U(r);self.loadPyodide||importScripts(U("pyodide.js",n)),i=await self.loadPyodide({indexURL:n}),await J(n),i.setStdout({raw:o=>a("STDOUT",{data:j(o)})}),i.setStderr({raw:o=>a("STDERR",{data:j(o)})}),i.setStdin({read(o){return ne(o)}}),m&&i.setInterruptBuffer(m),await se(new Set(_.allowed_packages.map(o=>String(o).toLowerCase())))}async function ue(e){if(h){a("STDERR",{data:`[compiler] Runtime already has an active run.
`});return}if(!i){a("RUNTIME_ERROR",{message:"Runtime is not ready."});return}h=!0,N=!1,O=!1,T=e.runId,m&&Atomics.store(m,0,0),w==="shared"?Atomics.store(l,2,0):z(),a("STATUS",{state:"running"});let t=1;try{t=await le(Array.isArray(e.files)?e.files:[],e.entryFileId==null?null:Number(e.entryFileId),_.max_run_seconds),O&&(a("STDERR",{data:`[compiler] Execution timed out after ${_.max_run_seconds} seconds.
`}),t=-1)}catch(r){O?(a("STDERR",{data:`[compiler] Execution timed out after ${_.max_run_seconds} seconds.
`}),t=-1):Q(r)?t=130:(a("STDERR",{data:`[compiler] ${S(r)}
`}),t=1)}finally{h=!1,T=null,I(),a("RUN_RESULT",{runId:e.runId,returnCode:t}),a("STATUS",{state:"stopped"})}}self.onmessage=async e=>{const t=e.data||{};try{if(t.type==="BOOT"){await ce(t.config||{},t.buffers||{}),a("RUNTIME_READY");return}if(t.type==="RUN"){await ue(t);return}if(t.type==="STDIN"){if(!h||w!=="message"||t.runId&&T&&t.runId!==T)return;Z(String(t.data||""));return}if(t.type==="STOP"){if(!h)return;N=!0,x();return}if(t.type==="DISPOSE"){N=!0,x(),close();return}}catch(r){a("RUNTIME_ERROR",{message:S(r)}),h&&(h=!1,T=null,I(),a("STATUS",{state:"stopped"}))}},self.addEventListener("error",e=>{a("RUNTIME_ERROR",{message:S(e.error||e.message)})}),self.addEventListener("unhandledrejection",e=>{a("RUNTIME_ERROR",{message:S(e.reason)})})})();
