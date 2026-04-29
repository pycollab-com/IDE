import { useEffect, useMemo, useRef } from "react";
import { autocompletion, snippetCompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip } from "@codemirror/view";
import { PythonIntelligenceService } from "./pythonIntelligenceService";

const IDENTIFIER_CHAR_RE = /[A-Za-z0-9_]/;

const SNIPPET_OPTIONS = Object.freeze([
  snippetCompletion("for ${item} in ${iterable}:\n    ${}", {
    label: "for",
    detail: "snippet",
    type: "keyword",
  }),
  snippetCompletion("def ${name}(${params}):\n    ${}", {
    label: "def",
    detail: "snippet",
    type: "keyword",
  }),
  snippetCompletion("class ${Name}:\n    def __init__(self):\n        ${}", {
    label: "class",
    detail: "snippet",
    type: "keyword",
  }),
  snippetCompletion("while ${condition}:\n    ${}", {
    label: "while",
    detail: "snippet",
    type: "keyword",
  }),
  snippetCompletion("if __name__ == \"__main__\":\n    ${}", {
    label: "ifmain",
    detail: "snippet",
    type: "keyword",
  }),
  snippetCompletion("try:\n    ${}\nexcept ${Exception} as ${error}:\n    pass", {
    label: "try",
    detail: "snippet",
    type: "keyword",
  }),
]);

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

function isInsideUnclosedParentheses(doc, pos) {
  const start = Math.max(0, pos - 600);
  const text = doc.sliceString(start, pos);
  let depth = 0;

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ")") {
      depth += 1;
      continue;
    }
    if (char === "(") {
      if (depth === 0) {
        return true;
      }
      depth -= 1;
    }
  }

  return false;
}

function shouldHideCompletion(item, typedPrefix, isPybricksProject) {
  const name = String(item?.name || item?.label || "");
  if (!name) return true;

  const wantsPrivate = String(typedPrefix || "").startsWith("_");
  if (!wantsPrivate && name.startsWith("_")) {
    return true;
  }

  const fullName = String(item?.fullName || "");
  if (isPybricksProject) {
    if (fullName.startsWith("typing.") || fullName.startsWith("enum.")) {
      return true;
    }
    if (name === "mro" && fullName.startsWith("builtins.type.")) {
      return true;
    }
  }

  return false;
}

function mapCompletionType(kind, label = "") {
  if (label.endsWith("=")) return "property";

  switch (kind) {
    case "module":
    case "namespace":
      return "module";
    case "class":
      return "class";
    case "function":
      return "function";
    case "property":
      return "property";
    case "param":
      return "variable";
    case "keyword":
      return "keyword";
    case "statement":
    case "instance":
      return "variable";
    default:
      return "variable";
  }
}

function dedupeCompletionOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option?.label || seen.has(option.label)) {
      return false;
    }
    seen.add(option.label);
    return true;
  });
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

function normalizeParameter(parameter) {
  const rawLabel = String(parameter?.label || parameter?.name || "").trim();
  if (!rawLabel || rawLabel === "/" || rawLabel === "*") {
    return null;
  }

  const nameChunk = rawLabel.split(":", 1)[0].split("=", 1)[0].trim();
  const normalizedName = nameChunk.replace(/^\*+/, "").trim();
  if (!normalizedName || normalizedName === "/" || normalizedName === "*") {
    return null;
  }

  const typeMatch = rawLabel.match(/^[^:=]+:\s*([^=]+?)(?:\s*=\s*.*)?$/);
  return {
    name: normalizedName,
    label: rawLabel,
    typeName: typeMatch ? typeMatch[1].trim() : "",
    hasDefault: /\s=\s*/.test(rawLabel),
    isSelfParameter: normalizedName === "self" || normalizedName === "cls",
    isVarArg: /^\*/.test(nameChunk),
  };
}

function normalizeParameters(parameters) {
  return (Array.isArray(parameters) ? parameters : [])
    .map(normalizeParameter)
    .filter((parameter) => parameter && !parameter.isSelfParameter && !parameter.isVarArg);
}

function guessParameterValue(parameter, isPybricksProject) {
  const name = String(parameter?.name || "");
  const lowerName = name.toLowerCase();
  const typeName = String(parameter?.typeName || "");
  const lowerType = typeName.toLowerCase();

  if (
    /\bport\b/i.test(typeName) ||
    lowerName === "port" ||
    lowerName.endsWith("_port") ||
    lowerName.endsWith("port")
  ) {
    return "Port.A";
  }
  if (/\b(str|string|text)\b/.test(lowerType)) {
    return "\"\"";
  }
  if (/\b(bytes|bytearray)\b/.test(lowerType)) {
    return "b\"\"";
  }
  if (/\b(bool|boolean)\b/.test(lowerType) || /^(is_|has_|should_|can_)/.test(lowerName)) {
    return "False";
  }
  if (/\b(float|double|decimal|real|supportsfloat)\b/.test(lowerType)) {
    return "0.0";
  }
  if (
    /\b(int|integer|number)\b/.test(lowerType) ||
    lowerName === "time" ||
    lowerName.endsWith("_ms") ||
    lowerName.endsWith("ms")
  ) {
    return "0";
  }
  if (/\b(dict|mapping|json)\b/.test(lowerType)) {
    return "{}";
  }
  if (/\b(tuple)\b/.test(lowerType)) {
    return "()";
  }
  if (/\b(set)\b/.test(lowerType)) {
    return "set()";
  }
  if (/\b(list|sequence|iterable|array)\b/.test(lowerType)) {
    return "[]";
  }
  if (/\b(callable|function|callback|handler)\b/.test(lowerType) || /(callback|handler)$/.test(lowerName)) {
    return name || "callback";
  }
  if (/\b(url|uri)\b/.test(lowerName)) {
    return "\"\"";
  }
  if (/\b(path|filename|file)\b/.test(lowerName)) {
    return "\"\"";
  }
  if (/\b(name|text|message|label|title)\b/.test(lowerName) && !isPybricksProject) {
    return "\"\"";
  }

  return name || "value";
}

function buildArgumentEntries(parameters, startIndex = 0) {
  return normalizeParameters(parameters).slice(Math.max(0, startIndex));
}

function buildArgumentPreview(parameters, { isPybricksProject, namedArguments = false, requiredOnly = false } = {}) {
  const entries = (requiredOnly ? parameters.filter((parameter) => !parameter.hasDefault) : parameters).filter(Boolean);
  return entries
    .map((parameter) => {
      const value = guessParameterValue(parameter, isPybricksProject);
      return namedArguments ? `${parameter.name}=${value}` : value;
    })
    .join(", ");
}

function selectionOffsetsForValue(value, prefix = "") {
  const normalizedValue = String(value || "");
  const normalizedPrefix = String(prefix || "");
  const prefixLength = normalizedPrefix.length;

  if (!normalizedValue) {
    return { start: prefixLength, end: prefixLength };
  }
  if (/^b?""$/.test(normalizedValue)) {
    return { start: prefixLength + normalizedValue.indexOf("\"") + 1, end: prefixLength + normalizedValue.length - 1 };
  }
  if (
    (normalizedValue.startsWith("\"") && normalizedValue.endsWith("\"")) ||
    (normalizedValue.startsWith("'") && normalizedValue.endsWith("'")) ||
    (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
    (normalizedValue.startsWith("{") && normalizedValue.endsWith("}")) ||
    (normalizedValue.startsWith("(") && normalizedValue.endsWith(")"))
  ) {
    return {
      start: prefixLength + 1,
      end: Math.max(prefixLength + 1, prefixLength + normalizedValue.length - 1),
    };
  }

  return {
    start: prefixLength,
    end: prefixLength + normalizedValue.length,
  };
}

function buildArgumentInsertSpec(parameters, { isPybricksProject, namedArguments = false, requiredOnly = false } = {}) {
  const entries = (requiredOnly ? parameters.filter((parameter) => !parameter.hasDefault) : parameters).filter(Boolean);
  if (!entries.length) {
    return { text: "", selectionStart: 0, selectionEnd: 0 };
  }

  const firstValue = guessParameterValue(entries[0], isPybricksProject);
  const firstPrefix = namedArguments ? `${entries[0].name}=` : "";
  const text = entries
    .map((parameter) => {
      const value = guessParameterValue(parameter, isPybricksProject);
      return namedArguments ? `${parameter.name}=${value}` : value;
    })
    .join(", ");
  const firstSelection = selectionOffsetsForValue(firstValue, firstPrefix);

  return {
    text,
    selectionStart: firstSelection.start,
    selectionEnd: firstSelection.end,
  };
}

function createTextApply(insertText, selectionStart = insertText.length, selectionEnd = selectionStart) {
  return (view, _completion, from, to) => {
    view.dispatch(
      view.state.update({
        changes: { from, to, insert: insertText },
        selection: EditorSelection.single(from + selectionStart, from + selectionEnd),
        scrollIntoView: true,
        userEvent: "input.complete",
      })
    );
  };
}

function buildCallableTemplateOption(item, context, snapshot) {
  if (!item?.callable || !item?.name || isImportOrDefinitionContext(context.state.doc, context.pos)) {
    return null;
  }

  const signature = item.signatures?.[0] || null;
  const parameters = buildArgumentEntries(signature?.parameters || [], 0);
  const requiredParameters = parameters.filter((parameter) => !parameter.hasDefault);
  const insertSpec = buildArgumentInsertSpec(requiredParameters, {
    isPybricksProject: snapshot.isPybricksProject,
    requiredOnly: true,
  });
  const previewArgs = buildArgumentPreview(requiredParameters, {
    isPybricksProject: snapshot.isPybricksProject,
    requiredOnly: true,
  });
  const insertText = `${item.name}(${insertSpec.text})`;
  const selectionBaseOffset = item.name.length + 1;

  return {
    label: `${item.name}(${previewArgs})`,
    filterText: item.name,
    detail: signature?.label || item.detail || "call",
    type: mapCompletionType(item.kind, item.name),
    boost: 125,
    apply: createTextApply(
      insertText,
      selectionBaseOffset + insertSpec.selectionStart,
      selectionBaseOffset + insertSpec.selectionEnd
    ),
  };
}

function toCompletionOptions(item, context, snapshot) {
  const label = item.label || item.name || "";
  if (!label) {
    return [];
  }

  const options = [];
  const callableTemplate = buildCallableTemplateOption(item, context, snapshot);
  if (callableTemplate) {
    options.push(callableTemplate);
  }

  options.push({
    label,
    detail: item.signatures?.[0]?.label || item.detail || "",
    type: mapCompletionType(item.kind, label),
  });

  return options;
}

function buildCallArgumentOptions(signatureHelp, snapshot) {
  const activeSignature = signatureHelp?.signatures?.[signatureHelp.activeSignature || 0];
  if (!activeSignature) {
    return [];
  }

  const allParameters = normalizeParameters(activeSignature.parameters || []);
  const requestedIndex = Math.max(0, activeSignature.activeParameter ?? signatureHelp.activeParameter ?? 0);
  const activeIndex = allParameters.length ? Math.min(requestedIndex, allParameters.length - 1) : 0;
  const parameters = allParameters.slice(activeIndex);
  if (!parameters.length) {
    return [];
  }

  const requiredParameters = parameters.filter((parameter) => !parameter.hasDefault);
  const options = [];

  const positionalPreview = buildArgumentPreview(requiredParameters, {
    isPybricksProject: snapshot.isPybricksProject,
    requiredOnly: true,
  });
  const positionalInsertSpec = buildArgumentInsertSpec(requiredParameters, {
    isPybricksProject: snapshot.isPybricksProject,
    requiredOnly: true,
  });
  if (positionalInsertSpec.text) {
    options.push({
      label: positionalPreview,
      filterText: parameters[0]?.name || positionalPreview,
      detail: `required arguments for ${activeSignature.label}`,
      type: "variable",
      boost: 140,
      apply: createTextApply(
        positionalInsertSpec.text,
        positionalInsertSpec.selectionStart,
        positionalInsertSpec.selectionEnd
      ),
    });
  }

  parameters.forEach((parameter, index) => {
    const valuePreview = guessParameterValue(parameter, snapshot.isPybricksProject);
    const insertSpec = buildArgumentInsertSpec([parameter], {
      isPybricksProject: snapshot.isPybricksProject,
      namedArguments: true,
    });
    options.push({
      label: `${parameter.name}=`,
      filterText: parameter.name,
      detail: parameter.label || valuePreview,
      type: "property",
      boost: 110 - index,
      apply: createTextApply(insertSpec.text, insertSpec.selectionStart, insertSpec.selectionEnd),
    });
  });

  return options;
}

function buildRequiredArgumentFill(signatureHelp, snapshot) {
  const activeSignature = signatureHelp?.signatures?.[signatureHelp.activeSignature || 0];
  if (!activeSignature) {
    return null;
  }

  const allParameters = normalizeParameters(activeSignature.parameters || []);
  const requestedIndex = Math.max(0, activeSignature.activeParameter ?? signatureHelp.activeParameter ?? 0);
  const activeIndex = allParameters.length ? Math.min(requestedIndex, allParameters.length - 1) : 0;
  const parameters = allParameters.slice(activeIndex);
  const requiredParameters = parameters.filter((parameter) => !parameter.hasDefault);
  if (!requiredParameters.length) {
    return null;
  }

  return {
    preview: buildArgumentPreview(requiredParameters, {
      isPybricksProject: snapshot.isPybricksProject,
      requiredOnly: true,
    }),
    ...buildArgumentInsertSpec(requiredParameters, {
      isPybricksProject: snapshot.isPybricksProject,
      requiredOnly: true,
    }),
  };
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
  renderDocumentation(dom, activeSignature.documentation, activeParameterIndex, activeSignature.parameters || []);

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

function insertedTriggerCharacter(update) {
  let triggered = false;
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (triggered) return;
    const text = inserted.toString();
    if (text.includes(".") || text.includes("(") || text.includes(",")) {
      triggered = true;
    }
  });
  return triggered;
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

function createCompletionSource(service, getProjectState) {
  return async (context) => {
    const snapshot = buildProjectSnapshot(getProjectState(), context.state.doc.toString());
    if (!snapshot) {
      return null;
    }

    const cursorPos = context.pos;
    const token = context.matchBefore(/[A-Za-z_][\w]*/);
    const charBefore = context.state.doc.sliceString(Math.max(0, cursorPos - 1), cursorPos);
    const shouldQuery = context.explicit || token || charBefore === "." || charBefore === "(" || charBefore === ",";
    if (!shouldQuery) {
      return null;
    }

    const from = charBefore === "." || charBefore === "(" || charBefore === "," ? cursorPos : token ? token.from : cursorPos;
    const { line, column } = positionToLineColumn(context.state.doc, cursorPos);
    const shouldQuerySignatures =
      charBefore === "(" ||
      charBefore === "," ||
      (Boolean(token) && isInsideUnclosedParentheses(context.state.doc, cursorPos)) ||
      context.explicit;

    try {
      const [result, signatureHelp] = await Promise.all([
        service.complete({
          files: snapshot.files,
          path: snapshot.path,
          code: snapshot.code,
          line,
          column,
          isPybricksProject: snapshot.isPybricksProject,
        }),
        shouldQuerySignatures
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

      const typedPrefix = token?.text || "";
      const options = dedupeCompletionOptions([
        ...buildCallArgumentOptions(signatureHelp, snapshot),
        ...SNIPPET_OPTIONS,
        ...((result?.items || [])
          .filter((item) => !shouldHideCompletion(item, typedPrefix, snapshot.isPybricksProject))
          .flatMap((item) => toCompletionOptions(item, context, snapshot))),
      ]);

      if (!options.length) {
        return null;
      }

      return {
        from,
        options,
        validFor: /^[A-Za-z_]*$/,
      };
    } catch {
      return null;
    }
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
      if (update.viewportChanged || update.geometryChanged) {
        this.positionTooltip();
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
      this.tooltipLayer.remove();
    }
  }

  return [ViewPlugin.fromClass(SignatureTooltipPlugin)];
}

function createTriggerExtension() {
  return EditorView.updateListener.of((update) => {
    if (!shouldHandleInteractiveDocChange(update)) {
      return;
    }
    if (!insertedTriggerCharacter(update)) {
      return;
    }
    queueMicrotask(() => startCompletion(update.view));
  });
}

function createCallArgumentAutofillExtension(service, getProjectState) {
  return EditorView.updateListener.of((update) => {
    if (!shouldHandleInteractiveDocChange(update)) {
      return;
    }

    let insertedCallTrigger = false;
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (insertedCallTrigger) {
        return;
      }
      const text = inserted.toString();
      if (text.includes("(") || text.includes(",")) {
        insertedCallTrigger = true;
      }
    });

    if (!insertedCallTrigger) {
      return;
    }

    queueMicrotask(async () => {
      const view = update.view;
      const selection = view.state.selection.main;
      if (!selection.empty) {
        return;
      }

      const cursorPos = selection.head;
      const previousChar = view.state.doc.sliceString(Math.max(0, cursorPos - 1), cursorPos);
      if (previousChar !== "(" && previousChar !== ",") {
        return;
      }

      const nextChar = view.state.doc.sliceString(cursorPos, Math.min(view.state.doc.length, cursorPos + 1));
      if (nextChar && nextChar !== ")" && nextChar.trim()) {
        return;
      }

      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latestSelection = view.state.selection.main;
          if (!latestSelection.empty || latestSelection.head !== cursorPos) {
            return;
          }

          const latestPreviousChar = view.state.doc.sliceString(Math.max(0, cursorPos - 1), cursorPos);
          const latestNextChar = view.state.doc.sliceString(cursorPos, Math.min(view.state.doc.length, cursorPos + 1));
          if ((latestPreviousChar !== "(" && latestPreviousChar !== ",") || (latestNextChar && latestNextChar !== ")" && latestNextChar.trim())) {
            return;
          }

          const snapshot = buildProjectSnapshot(getProjectState(), view.state.doc.toString());
          if (!snapshot) {
            return;
          }

          const { line, column } = positionToLineColumn(view.state.doc, cursorPos);
          const signatureHelp = await service.getSignatures({
            files: snapshot.files,
            path: snapshot.path,
            code: snapshot.code,
            line,
            column,
            isPybricksProject: snapshot.isPybricksProject,
          });
          const fill = buildRequiredArgumentFill(signatureHelp, snapshot);
          if (!fill?.text) {
            if (attempt < 2) {
              await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
              continue;
            }
            return;
          }

          view.dispatch(
            view.state.update({
              changes: { from: cursorPos, to: cursorPos, insert: fill.text },
              selection: EditorSelection.single(
                cursorPos + fill.selectionStart,
                cursorPos + fill.selectionEnd
              ),
              scrollIntoView: true,
              userEvent: "input.complete",
            })
          );
          queueMicrotask(() => startCompletion(view));
          return;
        }
      } catch {
        // Ignore autofill failures to avoid blocking normal editing.
      }
    });
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
      autocompletion({
        override: [createCompletionSource(service, getProjectState)],
        activateOnTyping: true,
        maxRenderedOptions: 16,
      }),
      createTriggerExtension(),
      createCallArgumentAutofillExtension(service, getProjectState),
      createHoverExtension(service, getProjectState),
      ...createSignatureExtension(service, getProjectState),
    ];
  }, [service]);

  return { extensions };
}
