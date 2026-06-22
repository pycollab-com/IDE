import { useEffect, useMemo, useRef } from "react";
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  snippetCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip, keymap } from "@codemirror/view";
import { PythonIntelligenceService } from "./pythonIntelligenceService";
import {
  buildCompletionOptions,
  buildRemainingKeywordDescriptors,
  usedKeywordNames,
} from "./pythonCompletions";

const IDENTIFIER_CHAR_RE = /[A-Za-z0-9_]/;

function positionToLineColumn(doc, pos) {
  const line = doc.lineAt(pos);
  return {
    line: line.number,
    column: pos - line.from,
  };
}

function buildProjectSnapshot(projectState, liveCode) {
  const currentFile = projectState?.currentFile || null;
  if (!currentFile?.name?.endsWith(".py")) {
    return null;
  }

  const files = (projectState.files || []).map((file) =>
    file.id === currentFile.id
      ? {
          ...file,
          content: typeof liveCode === "string" ? liveCode : file.content || "",
        }
      : {
          ...file,
          content: typeof file.content === "string" ? file.content : "",
        }
  );

  return {
    files,
    path: currentFile.name,
    code: typeof liveCode === "string" ? liveCode : currentFile.content || "",
    isPybricksProject: Boolean(projectState.isPybricksProject),
  };
}

function getLinePrefix(doc, pos) {
  const line = doc.lineAt(pos);
  return line.text.slice(0, pos - line.from);
}

function isImportOrDefinitionContext(doc, pos) {
  const prefix = getLinePrefix(doc, pos);
  if (/^\s*(?:from\s+[\w.]+\s+import|import)\s+[^#]*$/.test(prefix)) {
    return true;
  }
  if (/^\s*(?:class|def)\s+[\w.]*$/.test(prefix)) {
    return true;
  }
  return false;
}

// A descriptor carries a `template` only when it should be inserted as a
// tab-through snippet; everything else is inserted verbatim. Completion rows
// stay lean — no doc panel — so the list reads as autocomplete, not an essay.
function descriptorToCompletion(descriptor) {
  const { template, ...completion } = descriptor;
  return template ? snippetCompletion(template, completion) : completion;
}

function getIdentifierRange(doc, pos) {
  const line = doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;

  const atChar = text[start] || "";
  const leftChar = start > 0 ? text[start - 1] : "";
  if (IDENTIFIER_CHAR_RE.test(atChar)) {
    end = start + 1;
  } else if (IDENTIFIER_CHAR_RE.test(leftChar)) {
    start -= 1;
    end = start + 1;
  } else {
    return null;
  }

  while (start > 0 && IDENTIFIER_CHAR_RE.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && IDENTIFIER_CHAR_RE.test(text[end])) {
    end += 1;
  }

  return {
    from: line.from + start,
    to: line.from + end,
  };
}

function appendSection(container, title, content, className = "") {
  if (!content) return;
  const section = document.createElement("div");
  section.className = className || "cm-python-intelligence-section";

  if (title) {
    const heading = document.createElement("div");
    heading.className = "cm-python-intelligence-heading";
    heading.textContent = title;
    section.appendChild(heading);
  }

  const body = document.createElement("div");
  body.className = "cm-python-intelligence-body";
  body.textContent = content;
  section.appendChild(body);
  container.appendChild(section);
}

function appendParameterList(container, parameters, activeParameterIndex = -1) {
  if (!Array.isArray(parameters) || !parameters.length) return;

  const section = document.createElement("div");
  section.className = "cm-python-intelligence-section";

  const heading = document.createElement("div");
  heading.className = "cm-python-intelligence-heading";
  heading.textContent = "Parameters";
  section.appendChild(heading);

  parameters.forEach((parameter, index) => {
    const row = document.createElement("div");
    row.className = `cm-python-intelligence-parameter-row${index === activeParameterIndex ? " is-active" : ""}`;

    const label = document.createElement("div");
    label.className = "cm-python-intelligence-parameter-label";
    label.textContent = parameter.label || parameter.name || "parameter";
    row.appendChild(label);

    if (parameter.documentation) {
      const body = document.createElement("div");
      body.className = "cm-python-intelligence-parameter-doc";
      body.textContent = parameter.documentation;
      row.appendChild(body);
    }

    section.appendChild(row);
  });

  container.appendChild(section);
}

function renderDocumentation(dom, documentation, activeParameterIndex = -1, signatureParameters = []) {
  if (!documentation) return;

  appendSection(dom, null, documentation.summary || "", "cm-python-intelligence-section summary");

  const parameters =
    Array.isArray(signatureParameters) && signatureParameters.length
      ? signatureParameters
      : Array.isArray(documentation.parameters)
        ? documentation.parameters
        : [];
  appendParameterList(dom, parameters, activeParameterIndex);

  appendSection(dom, "Returns", documentation.returns || "");
}

function appendHighlightedSignature(container, label, activeParameterLabel) {
  const line = document.createElement("div");
  line.className = "cm-python-intelligence-signature";

  if (!activeParameterLabel) {
    line.textContent = label || "";
    container.appendChild(line);
    return;
  }

  const matchIndex = label.indexOf(activeParameterLabel);
  if (matchIndex === -1) {
    line.textContent = label || "";
    container.appendChild(line);
    return;
  }

  line.append(document.createTextNode(label.slice(0, matchIndex)));
  const active = document.createElement("span");
  active.className = "cm-python-intelligence-signature-active";
  active.textContent = activeParameterLabel;
  line.appendChild(active);
  line.append(document.createTextNode(label.slice(matchIndex + activeParameterLabel.length)));
  container.appendChild(line);
}

// While you fill a call, show only the signature line with the active parameter
// highlighted, plus that one parameter's short description. Deliberately compact
// — no full parameter dump, no multi-paragraph docstring (that lives in hover).
function createSignatureTooltipDom(signatureHelp) {
  const dom = document.createElement("div");
  dom.className = "cm-python-intelligence-tooltip cm-python-intelligence-signature-tooltip";

  const activeSignature = signatureHelp?.signatures?.[signatureHelp.activeSignature || 0];
  if (!activeSignature) {
    return dom;
  }

  const activeParameterIndex = Math.max(
    0,
    activeSignature.activeParameter ?? signatureHelp.activeParameter ?? 0
  );
  const activeParameter = activeSignature.parameters?.[activeParameterIndex] || null;
  appendHighlightedSignature(dom, activeSignature.label || "", activeParameter?.label || "");

  const activeDoc = String(activeParameter?.documentation || "").trim();
  if (activeDoc) {
    appendSection(dom, null, activeDoc.split("\n")[0], "cm-python-intelligence-section summary");
  }

  return dom;
}

function createHoverTooltipDom(hover) {
  const dom = document.createElement("div");
  dom.className = "cm-python-intelligence-tooltip cm-python-intelligence-hover-tooltip";

  if (hover?.signature) {
    const signature = document.createElement("div");
    signature.className = "cm-python-intelligence-signature";
    signature.textContent = hover.signature;
    dom.appendChild(signature);
  }

  renderDocumentation(dom, hover?.documentation || null);
  return dom;
}

// The trigger character just typed, if any: `.` pops member lists, `(`/`,` pop a
// call's parameter picker the moment you open or continue an argument list
// (`print(▌`, `Motor(port, ▌`). Returns the character or null.
function insertedTriggerChar(update) {
  let trigger = null;
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (trigger) return;
    const match = inserted.toString().match(/[.(,]/);
    if (match) trigger = match[0];
  });
  return trigger;
}

function lineIsDefinition(view) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return /^\s*(?:async\s+)?(?:def|class)\b/.test(line.text);
}

function hasUserInputChange(update) {
  return update.docChanged && update.transactions.some((transaction) => transaction.isUserEvent("input"));
}

function editorHasActiveFocus(view) {
  if (view.hasFocus) {
    return true;
  }

  const activeElement = view.dom.ownerDocument?.activeElement;
  return Boolean(activeElement && view.dom.contains(activeElement));
}

function shouldHandleInteractiveDocChange(update) {
  return update.docChanged && (hasUserInputChange(update) || editorHasActiveFocus(update.view));
}

// Locate the enclosing call and the argument the cursor sits in, so we can tell
// a keyword-name slot (`Motor(port=Port.A, ▌)` -> offer remaining kwargs) from a
// value slot (`Motor(port=▌)` -> complete values). Scans a bounded window back.
function getCallArgumentContext(doc, pos) {
  const windowStart = Math.max(0, pos - 2000);
  const text = doc.sliceString(windowStart, pos);
  let depth = 0;
  let argStartRel = null;
  let callOpenRel = null;

  for (let i = text.length - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === ")" || char === "]" || char === "}") {
      depth += 1;
    } else if (char === "(" || char === "[" || char === "{") {
      if (depth === 0) {
        if (char === "(") callOpenRel = i;
        break;
      }
      depth -= 1;
    } else if (char === "," && depth === 0 && argStartRel === null) {
      argStartRel = i + 1;
    }
  }

  if (callOpenRel === null) {
    return { inCall: false };
  }
  if (argStartRel === null) {
    argStartRel = callOpenRel + 1;
  }
  const argText = text.slice(argStartRel);
  return {
    inCall: true,
    callOpenPos: windowStart + callOpenRel,
    // A keyword-name slot is an argument that has not yet started its value.
    keywordPosition: !argText.includes("="),
  };
}

function createCompletionSource(service, getProjectState) {
  return async (context) => {
    const snapshot = buildProjectSnapshot(getProjectState(), context.state.doc.toString());
    if (!snapshot) {
      return null;
    }

    const doc = context.state.doc;
    const cursorPos = context.pos;
    const token = context.matchBefore(/[A-Za-z_]\w*/);
    const charBefore = doc.sliceString(Math.max(0, cursorPos - 1), cursorPos);
    const isMemberAccess = charBefore === ".";
    if (!context.explicit && !token && !isMemberAccess) {
      return null;
    }

    const from = isMemberAccess ? cursorPos : token ? token.from : cursorPos;
    const { line, column } = positionToLineColumn(doc, cursorPos);
    const callContext = getCallArgumentContext(doc, cursorPos);
    const wantKeywordArguments = callContext.inCall && callContext.keywordPosition;

    let result;
    let signatureHelp = null;
    try {
      [result, signatureHelp] = await Promise.all([
        service.complete({
          files: snapshot.files,
          path: snapshot.path,
          code: snapshot.code,
          line,
          column,
          isPybricksProject: snapshot.isPybricksProject,
        }),
        wantKeywordArguments
          ? service.getSignatures({
              files: snapshot.files,
              path: snapshot.path,
              code: snapshot.code,
              line,
              column,
              isPybricksProject: snapshot.isPybricksProject,
            })
          : Promise.resolve(null),
      ]);
    } catch {
      return null;
    }

    // Inside a call's keyword slot, surface the not-yet-supplied keyword
    // arguments first (the spec's comma case), then the normal symbols so you
    // can still pass a variable or expression.
    let keywordOptions = [];
    if (wantKeywordArguments) {
      const activeSignature = signatureHelp?.signatures?.[signatureHelp.activeSignature || 0];
      if (activeSignature?.parameters?.length) {
        const used = usedKeywordNames(doc.sliceString(callContext.callOpenPos + 1, cursorPos));
        keywordOptions = buildRemainingKeywordDescriptors(activeSignature.parameters, used);
      }
    }

    const importOrDef = isImportOrDefinitionContext(doc, cursorPos);
    const options = [
      ...keywordOptions,
      ...buildCompletionOptions({
        items: result?.items,
        typedPrefix: token?.text || "",
        isPybricksProject: snapshot.isPybricksProject,
        importOrDef,
        allowSnippets: !isMemberAccess && !callContext.inCall && !importOrDef,
      }),
    ].map(descriptorToCompletion);

    if (!options.length) {
      return null;
    }

    return {
      from,
      options,
      validFor: /^\w*$/,
    };
  };
}

function createHoverExtension(service, getProjectState) {
  return hoverTooltip(async (view, pos) => {
    const snapshot = buildProjectSnapshot(getProjectState(), view.state.doc.toString());
    if (!snapshot) {
      return null;
    }

    const range = getIdentifierRange(view.state.doc, pos);
    if (!range) {
      return null;
    }

    const { line, column } = positionToLineColumn(view.state.doc, pos);
    try {
      const hover = await service.getHover({
        files: snapshot.files,
        path: snapshot.path,
        code: snapshot.code,
        line,
        column,
        isPybricksProject: snapshot.isPybricksProject,
      });
      if (!hover?.signature && !hover?.documentation?.summary && !hover?.documentation?.raw) {
        return null;
      }

      return {
        pos: range.from,
        end: range.to,
        above: true,
        create() {
          return { dom: createHoverTooltipDom(hover) };
        },
      };
    } catch {
      return null;
    }
  });
}

function createSignatureExtension(service, getProjectState) {
  class SignatureTooltipPlugin {
    constructor(view) {
      this.view = view;
      this.timeoutId = null;
      this.repositionFrame = null;
      this.requestId = 0;
      this.renderedCursorPos = null;
      this.host = view.dom.parentElement || view.dom;
      if (globalThis.getComputedStyle(this.host).position === "static") {
        this.host.style.position = "relative";
      }
      this.tooltipLayer = document.createElement("div");
      this.tooltipLayer.className = "cm-python-intelligence-floating-layer";
      this.tooltipLayer.style.display = "none";
      this.tooltipLayer.style.position = "absolute";
      this.tooltipLayer.style.zIndex = "40";
      this.host.appendChild(this.tooltipLayer);
      this.schedule();
    }

    update(update) {
      // The completion popup already lists the parameters as you fill a call, so
      // the signature hint would just overlap it. Yield to the popup entirely.
      if (completionStatus(update.state) === "active") {
        this.hide();
        return;
      }
      if (update.viewportChanged || update.geometryChanged) {
        // Reading layout (coordsAtPos / getBoundingClientRect) is forbidden
        // mid-update, so reposition on the next frame instead of inline.
        this.scheduleReposition();
      }
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        if (!editorHasActiveFocus(update.view)) {
          this.hide();
          return;
        }
        this.schedule();
      }
    }

    schedule() {
      if (this.timeoutId !== null) {
        globalThis.clearTimeout(this.timeoutId);
      }
      this.timeoutId = globalThis.setTimeout(() => {
        this.timeoutId = null;
        this.query();
      }, 90);
    }

    scheduleReposition() {
      if (this.repositionFrame !== null) {
        return;
      }
      this.repositionFrame = globalThis.requestAnimationFrame(() => {
        this.repositionFrame = null;
        this.positionTooltip();
      });
    }

    hide() {
      this.requestId += 1;
      this.renderedCursorPos = null;
      this.tooltipLayer.replaceChildren();
      this.tooltipLayer.style.display = "none";
    }

    positionTooltip() {
      if (this.renderedCursorPos == null || !this.tooltipLayer.firstChild) {
        return;
      }

      const coords = this.view.coordsAtPos(this.renderedCursorPos);
      if (!coords) {
        this.hide();
        return;
      }

      const hostRect = this.host.getBoundingClientRect();
      this.tooltipLayer.style.display = "block";

      const tooltipRect = this.tooltipLayer.getBoundingClientRect();
      let left = coords.left - hostRect.left;
      let top = coords.top - hostRect.top - tooltipRect.height - 10;

      if (top < 8) {
        top = coords.bottom - hostRect.top + 10;
      }
      if (left + tooltipRect.width > hostRect.width - 8) {
        left = Math.max(8, hostRect.width - tooltipRect.width - 8);
      }

      this.tooltipLayer.style.left = `${Math.max(8, left)}px`;
      this.tooltipLayer.style.top = `${Math.max(8, top)}px`;
    }

    async query() {
      if (completionStatus(this.view.state) === "active") {
        this.hide();
        return;
      }

      const selection = this.view.state.selection.main;
      if (!selection.empty) {
        this.hide();
        return;
      }

      const snapshot = buildProjectSnapshot(getProjectState(), this.view.state.doc.toString());
      if (!snapshot) {
        this.hide();
        return;
      }

      const cursorPos = selection.head;
      const { line, column } = positionToLineColumn(this.view.state.doc, cursorPos);
      const requestId = ++this.requestId;

      try {
        const signatureHelp = await service.getSignatures({
          files: snapshot.files,
          path: snapshot.path,
          code: snapshot.code,
          line,
          column,
          isPybricksProject: snapshot.isPybricksProject,
        });

        if (requestId !== this.requestId) {
          return;
        }

        // The popup may have opened during the await; don't draw over it.
        if (completionStatus(this.view.state) === "active") {
          this.hide();
          return;
        }

        if (!signatureHelp?.signatures?.length) {
          this.hide();
          return;
        }

        this.renderedCursorPos = cursorPos;
        this.tooltipLayer.replaceChildren(createSignatureTooltipDom(signatureHelp));
        this.positionTooltip();
      } catch {
        if (requestId === this.requestId) {
          this.hide();
        }
      }
    }

    destroy() {
      this.requestId += 1;
      if (this.timeoutId !== null) {
        globalThis.clearTimeout(this.timeoutId);
      }
      if (this.repositionFrame !== null) {
        globalThis.cancelAnimationFrame(this.repositionFrame);
      }
      this.tooltipLayer.remove();
    }
  }

  return [ViewPlugin.fromClass(SignatureTooltipPlugin)];
}

// One Tab key, context-dependent — the way Xcode behaves. `acceptCompletion`
// accepts the highlighted suggestion when the popup is open and otherwise
// no-ops to `false`, so Tab falls straight through to snippet-field navigation
// (jumping between argument placeholders) and finally to normal indentation.
// Checking `completionStatus` here would be wrong: just after the popup opens
// the status is briefly "pending", and a guarded Tab would indent instead.
function createCompletionKeymap() {
  return Prec.highest(
    keymap.of([
      {
        key: "Tab",
        run: acceptCompletion,
      },
    ])
  );
}

// Auto-pop the completer after `.`, `(`, and `,` so member lists and call
// parameter pickers appear without an explicit Ctrl-Space. `(`/`,` are skipped
// on a `def`/`class` line, where the parens hold parameter *names* you're
// declaring, not arguments to complete.
function createTriggerExtension() {
  return EditorView.updateListener.of((update) => {
    if (!shouldHandleInteractiveDocChange(update)) {
      return;
    }
    const trigger = insertedTriggerChar(update);
    if (!trigger) {
      return;
    }
    if ((trigger === "(" || trigger === ",") && lineIsDefinition(update.view)) {
      return;
    }
    queueMicrotask(() => startCompletion(update.view));
  });
}

export function usePythonIntelligence({ files, currentFile, isPybricksProject, runtimeApiBase = "" }) {
  const projectStateRef = useRef({
    files,
    currentFile,
    isPybricksProject,
  });
  projectStateRef.current = {
    files,
    currentFile,
    isPybricksProject,
  };

  const service = useMemo(() => new PythonIntelligenceService({ runtimeApiBase }), [runtimeApiBase]);

  useEffect(() => {
    service.init().catch(() => {});
    return () => service.dispose();
  }, [service]);

  const extensions = useMemo(() => {
    const getProjectState = () => projectStateRef.current;
    return [
      createCompletionKeymap(),
      autocompletion({
        override: [createCompletionSource(service, getProjectState)],
        activateOnTyping: true,
        maxRenderedOptions: 16,
      }),
      createTriggerExtension(),
      createHoverExtension(service, getProjectState),
      ...createSignatureExtension(service, getProjectState),
    ];
  }, [service]);

  return { extensions };
}
