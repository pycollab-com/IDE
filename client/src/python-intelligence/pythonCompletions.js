// Pure completion logic for the Python intelligence layer.
//
// Nothing here touches React, CodeMirror, or the DOM: it is plain data in,
// plain completion descriptors out. That keeps the actual decisions — what gets
// inserted, what shape a call takes, how things rank — testable in isolation and
// identical for every symbol, not just the handful anyone happened to try.
//
// A descriptor is `{ label, detail, type, boost, template?, apply? }`. When
// `template` is present the editor inserts it as a tab-through snippet; when
// `apply` is present it inserts that exact text; otherwise the label is inserted
// verbatim.

// Keyword snippets only ever surface at the start of a statement (see the
// caller's `allowSnippets` gate), and always sit below real symbols.
export const SNIPPET_DESCRIPTORS = Object.freeze([
  { label: "for", detail: "snippet", type: "keyword", boost: -15, template: "for ${item} in ${iterable}:\n    ${}" },
  { label: "def", detail: "snippet", type: "keyword", boost: -15, template: "def ${name}(${params}):\n    ${}" },
  { label: "class", detail: "snippet", type: "keyword", boost: -15, template: "class ${Name}:\n    def __init__(self):\n        ${}" },
  { label: "while", detail: "snippet", type: "keyword", boost: -15, template: "while ${condition}:\n    ${}" },
  { label: "ifmain", detail: "snippet", type: "keyword", boost: -15, template: "if __name__ == \"__main__\":\n    ${}" },
  { label: "try", detail: "snippet", type: "keyword", boost: -15, template: "try:\n    ${}\nexcept ${Exception} as ${error}:\n    pass" },
]);

export function mapCompletionType(kind, label = "") {
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

// Floats the names a programmer actually reaches for to the top of the list:
// the locals and parameters in scope first, then the things they define, then
// modules, and keyword-argument hints (`sep=`) below real values.
export function completionBoost(kind, label = "") {
  if (label.endsWith("=")) return -10;

  switch (kind) {
    case "param":
      return 50;
    case "statement":
    case "instance":
      return 40;
    case "property":
      return 25;
    case "function":
      return 20;
    case "class":
      return 15;
    case "keyword":
      return -5;
    case "module":
    case "namespace":
      return 0;
    default:
      return 5;
  }
}

export function shouldHideCompletion(item, typedPrefix, isPybricksProject) {
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

// How many optional parameters the cumulative arity rows climb to before we
// stop, so a single callable can't flood the list (`open` has ~8 optionals).
const MAX_OPTIONAL_VARIANTS = 4;

// Jedi's `inspect.Parameter.kind` names, mapped to our internal kinds. When the
// worker provides this it is authoritative; otherwise we fall back to parsing
// the `/` and `*` markers out of the parameter labels.
const JEDI_KIND_MAP = Object.freeze({
  POSITIONAL_ONLY: "positional_only",
  POSITIONAL_OR_KEYWORD: "normal",
  VAR_POSITIONAL: "var_positional",
  KEYWORD_ONLY: "keyword_only",
  VAR_KEYWORD: "var_keyword",
});

// Parse a Jedi signature's parameters into an ordered list that knows each
// parameter's calling convention. This is what lets us insert *correct* Python:
// positional-only params and `*args` can't be passed by keyword, while
// everything else reads best as `name=` (Pybricks style).
export function parseSignatureParameters(parameters) {
  const raw = Array.isArray(parameters) ? parameters : [];
  const slashIndex = raw.findIndex((parameter) => String(parameter?.label || "").trim() === "/");
  let keywordOnly = false;
  const params = [];

  raw.forEach((parameter, index) => {
    const label = String(parameter?.label || parameter?.name || "").trim();
    if (label === "/") return; // positional-only marker
    if (label === "*") {
      keywordOnly = true; // bare star: everything after is keyword-only
      return;
    }

    const nameChunk = label.split(":", 1)[0].split("=", 1)[0].trim();
    const stars = (nameChunk.match(/^\*+/) || [""])[0].length;
    const name = nameChunk.replace(/^\*+/, "").trim();
    if (!name || name === "self" || name === "cls") return;

    const explicitKind = JEDI_KIND_MAP[parameter?.kind];
    let kind;
    if (explicitKind) {
      kind = explicitKind;
    } else if (stars === 2) {
      kind = "var_keyword"; // **kwargs
    } else if (stars === 1) {
      kind = "var_positional"; // *args
    } else if (slashIndex !== -1 && index < slashIndex) {
      kind = "positional_only";
    } else if (keywordOnly) {
      kind = "keyword_only";
    } else {
      kind = "normal";
    }

    if (kind === "var_positional") {
      keywordOnly = true; // params after *args are keyword-only
    }

    params.push({ name, kind, hasDefault: label.includes("=") });
  });

  return params;
}

// Params that can appear as call arguments — drops **kwargs (you don't fill it
// in by name) but keeps *args as a single positional slot.
function fillableParameters(params) {
  return params.filter((parameter) => parameter.kind !== "var_keyword");
}

function canBeKeyword(parameter) {
  return parameter.kind === "normal" || parameter.kind === "keyword_only";
}

// One snippet fragment per argument: `name=${}` when it can be keyword, a bare
// `${}` tab-stop when it must stay positional. Values insert empty so the call
// is never filled with guessed garbage; Tab moves between the empty slots.
function parameterFragment(parameter) {
  return canBeKeyword(parameter) ? `${parameter.name}=\${}` : "${}";
}

function callTemplate(name, includedParams) {
  if (!includedParams.length) {
    return `${name}()`;
  }
  // The whole call stays on one line — `Motor(port=, positive_direction=, ...)`
  // — and Tab walks the empty placeholders left to right. No indented block.
  const fragments = includedParams.map(parameterFragment);
  return `${name}(${fragments.join(", ")})`;
}

// The cumulative arity expansion from the spec: required-only first, then one
// more optional per row, in declaration order, never skipping. For
// `def abc(a, b=1, c=2)` this yields abc(a) -> abc(a, b) -> abc(a, b, c).
export function buildArityVariants(item) {
  const name = item.name;
  const params = fillableParameters(parseSignatureParameters(item.signatures?.[0]?.parameters));
  const required = params.filter((parameter) => !parameter.hasDefault);
  const optional = params.filter((parameter) => parameter.hasDefault).slice(0, MAX_OPTIONAL_VARIANTS);

  const variants = [];
  for (let count = 0; count <= optional.length; count += 1) {
    const included = [...required, ...optional.slice(0, count)];
    // Skip an empty `name()` row only when the callable actually takes params
    // (a genuinely zero-arg callable still deserves its single `name()` row).
    if (!included.length && params.length) continue;
    variants.push({
      included,
      label: `${name}(${included.map((parameter) => parameter.name).join(", ")})`,
      template: callTemplate(name, included),
      addedOptional: count,
    });
  }
  return variants.length ? variants : [{ included: [], label: `${name}()`, template: `${name}()`, addedOptional: 0 }];
}

// The detail shown inline on a completion row. We strip the leading name so a
// row reads `sqrt  (x) -> float` instead of the doubled `sqrt sqrt(x) -> float`.
function conciseDetail(name, item) {
  const signature = item.signatures?.[0]?.label || "";
  if (signature) {
    return signature.startsWith(name) ? signature.slice(name.length) : signature;
  }
  return item.detail || "";
}

// A callable expands into one descriptor per cumulative arity row; everything
// else is a single descriptor. Returns an array so the caller can flat-map.
// Rows stay terse on purpose — the arity label (`Motor(port, gears)`) already
// communicates the parameters, so callables carry no inline detail and no doc
// panel. Types show up in the slim signature hint while you fill the call.
export function toCompletionDescriptors(item, { importOrDef, importContext = "" } = {}) {
  const label = item.label || item.name || "";
  if (!label) {
    return [];
  }
  if (importContext === "from-import" && (item.name === "*" || label === "*")) {
    return [];
  }

  // `from os import pa…` and `def fo…` complete to bare names, never `name(...)`.
  if (item.callable && item.name && !importOrDef) {
    const baseBoost = completionBoost(item.kind, item.name);
    const type = mapCompletionType(item.kind, item.name);
    return buildArityVariants(item).map((variant, index) => ({
      label: variant.label,
      // Match on the bare name, so typing `Mot` ranks every `Motor(...)` row.
      filterText: item.name,
      type,
      // Required-only (index 0) ranks highest and is the default selection.
      boost: baseBoost - index,
      template: variant.template,
    }));
  }

  const descriptor = {
    label,
    filterText: item.name || label,
    detail: conciseDetail(label, item),
    type: mapCompletionType(item.kind, label),
    boost: completionBoost(item.kind, label),
  };
  if (importContext) {
    descriptor.apply = item.name || label;
  }
  return [descriptor];
}

// Keyword arguments already written in a call's argument text, so the comma
// case doesn't re-offer them. Splits on top-level commas (ignoring nested
// brackets) and reads a leading `name=` from each segment, skipping `==`.
export function usedKeywordNames(argsText) {
  const text = String(argsText || "");
  const segments = [];
  let depth = 0;
  let segmentStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      segments.push(text.slice(segmentStart, i));
      segmentStart = i + 1;
    }
  }
  segments.push(text.slice(segmentStart));

  const names = [];
  for (const segment of segments) {
    const match = segment.match(/^\s*([A-Za-z_]\w*)\s*=(?!=)/);
    if (match) names.push(match[1]);
  }
  return names;
}

// The comma case: inside `Motor(port=Port.A, ▌)` offer the keyword arguments not
// yet supplied — `positive_direction=`, `gears=`, `reset_angle=` — in order.
export function buildRemainingKeywordDescriptors(signatureParameters, usedNames = []) {
  const used = new Set(usedNames);
  return parseSignatureParameters(signatureParameters)
    .filter((parameter) => canBeKeyword(parameter) && !used.has(parameter.name))
    .map((parameter, index) => ({
      label: `${parameter.name}=`,
      detail: "argument",
      type: "property",
      boost: 80 - index,
      template: `${parameter.name}=\${}`,
    }));
}

function dedupeByLabel(descriptors) {
  const seen = new Set();
  return descriptors.filter((descriptor) => {
    if (!descriptor?.label || seen.has(descriptor.label)) {
      return false;
    }
    seen.add(descriptor.label);
    return true;
  });
}

export function buildCompletionOptions({
  items,
  typedPrefix = "",
  isPybricksProject = false,
  importOrDef = false,
  importContext = "",
  allowSnippets = false,
}) {
  const symbols = (Array.isArray(items) ? items : [])
    .filter((item) => !shouldHideCompletion(item, typedPrefix, isPybricksProject))
    .flatMap((item) => toCompletionDescriptors(item, { importOrDef, importContext }));

  return dedupeByLabel([...(allowSnippets ? SNIPPET_DESCRIPTORS : []), ...symbols]);
}
