import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArityVariants,
  buildCompletionOptions,
  buildRemainingKeywordDescriptors,
  completionBoost,
  parseSignatureParameters,
  shouldHideCompletion,
  toCompletionDescriptors,
  usedKeywordNames,
} from "./pythonCompletions.js";

// Helper: a Jedi-shaped completion item. `params` are raw signature parameter
// labels exactly as `param.to_string()` produces them, so these tests exercise
// the real input the worker sends.
function callable(name, params, extra = {}) {
  return {
    name,
    label: name,
    kind: "function",
    callable: true,
    signatures: [{ label: `${name}(${params.join(", ")})`, parameters: params.map((label) => ({ label })) }],
    ...extra,
  };
}

function value(name, kind = "statement") {
  return { name, label: name, kind, callable: false, signatures: [] };
}

const labels = (variants) => variants.map((variant) => variant.label);
const templates = (variants) => variants.map((variant) => variant.template);

test("parseSignatureParameters tracks calling convention (positional-only, normal, *args, **kwargs)", () => {
  const params = parseSignatureParameters(
    [{ label: "self" }, { label: "a" }, { label: "/" }, { label: "b" }, { label: "*args" }, { label: "c=1" }, { label: "**kw" }]
      // self dropped, a positional-only, b normal, *args, c keyword-only (after *args), **kw var_keyword
  );
  assert.deepEqual(
    params.map((p) => `${p.name}:${p.kind}:${p.hasDefault}`),
    ["a:positional_only:false", "b:normal:false", "args:var_positional:false", "c:keyword_only:true", "kw:var_keyword:false"]
  );
});

test("cumulative arity: abc(a, b=1, c=2) -> abc(a) | abc(a, b) | abc(a, b, c) (no skipping)", () => {
  const variants = buildArityVariants(callable("abc", ["a", "b=1", "c=2"]));
  assert.deepEqual(labels(variants), ["abc(a)", "abc(a, b)", "abc(a, b, c)"]);
});

test("Pybricks Motor expands required-first through every optional", () => {
  const motor = callable("Motor", ["port", "positive_direction=Direction.CLOCKWISE", "gears=None", "reset_angle=True"]);
  assert.deepEqual(labels(buildArityVariants(motor)), [
    "Motor(port)",
    "Motor(port, positive_direction)",
    "Motor(port, positive_direction, gears)",
    "Motor(port, positive_direction, gears, reset_angle)",
  ]);
});

test("inserts keyword arguments with empty values, all on one line", () => {
  const variants = buildArityVariants(callable("Motor", ["port", "positive_direction=X"]));
  // required-only, single param -> inline empty keyword value
  assert.equal(variants[0].template, "Motor(port=${})");
  // two params -> still one line, comma-separated, with empty tab-stops
  assert.equal(variants[1].template, "Motor(port=${}, positive_direction=${})");
});

test("positional-only and *args insert positionally (never `name=`, which is invalid Python)", () => {
  // len(obj, /) -> obj is positional-only
  assert.deepEqual(templates(buildArityVariants(callable("len", ["obj", "/"]))), ["len(${})"]);
  // print(*values, sep=..., ...) -> *values positional, optionals are keyword
  const printVariants = buildArityVariants(callable("print", ["*values", "sep=' '", "end='\\n'"]));
  assert.equal(printVariants[0].label, "print(values)");
  assert.equal(printVariants[0].template, "print(${})");
  assert.equal(printVariants[1].template, "print(${}, sep=${})");
});

test("zero-argument callable yields a single bare-call row", () => {
  const variants = buildArityVariants(callable("time", []));
  assert.deepEqual(labels(variants), ["time()"]);
  assert.equal(variants[0].template, "time()");
});

test("a long optional list is capped so one callable can't flood the list", () => {
  const variants = buildArityVariants(callable("open", ["file", "mode='r'", "buffering=-1", "encoding=None", "errors=None", "newline=None", "closefd=True"]));
  assert.ok(variants.length <= 5, `expected <=5 rows, got ${variants.length}`);
  assert.equal(variants[0].label, "open(file)");
});

test("toCompletionDescriptors: required-only ranks highest and is the default", () => {
  const descriptors = toCompletionDescriptors(callable("Motor", ["port", "positive_direction=X", "gears=None"]), {});
  assert.equal(descriptors[0].label, "Motor(port)");
  assert.ok(descriptors[0].boost > descriptors[1].boost, "required-only must outrank wider arities");
  assert.ok(descriptors[1].boost > descriptors[2].boost);
  // every row matches on the bare name so typing `Mot` keeps them all
  assert.ok(descriptors.every((d) => d.filterText === "Motor"));
});

test("import/def contexts insert a bare name, no call expansion", () => {
  const descriptors = toCompletionDescriptors(callable("partial", ["func", "*args"]), { importOrDef: true });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].label, "partial");
  assert.equal(descriptors[0].template, undefined);
});

test("comma case: offers remaining keyword args, skipping ones already supplied", () => {
  const params = [{ label: "port" }, { label: "positive_direction=X" }, { label: "gears=None" }, { label: "reset_angle=True" }];
  const remaining = buildRemainingKeywordDescriptors(params, usedKeywordNames("port=Port.A, "));
  assert.deepEqual(remaining.map((d) => d.label), ["positive_direction=", "gears=", "reset_angle="]);
  assert.equal(remaining[0].template, "positive_direction=${}");
});

test("usedKeywordNames reads top-level kwargs only, ignoring nesting and `==`", () => {
  assert.deepEqual(usedKeywordNames("port=Port.A, gears=Matrix([1, 2])"), ["port", "gears"]);
  assert.deepEqual(usedKeywordNames("a=f(x=1), b"), ["a"]);
  assert.deepEqual(usedKeywordNames("x == 1, "), []);
});

test("callable rows stay terse: arity label only, no inline detail or doc panel", () => {
  const item = {
    name: "sqrt",
    label: "sqrt",
    kind: "function",
    callable: true,
    signatures: [
      {
        label: "sqrt(x: SupportsFloat, /) -> float",
        parameters: [{ label: "x: SupportsFloat", kind: "POSITIONAL_ONLY" }],
        documentation: { summary: "Return the square root of x.", parameters: [], returns: "the root" },
      },
    ],
  };
  const descriptor = toCompletionDescriptors(item, {})[0];
  // The arity label communicates the parameters; the row carries no essay.
  assert.equal(descriptor.label, "sqrt(x)");
  assert.equal(descriptor.template, "sqrt(${})");
  assert.equal(descriptor.documentation, undefined);
  assert.equal(descriptor.detail, undefined);
});

test("non-callable rows still carry a concise inline detail", () => {
  const item = {
    name: "pi",
    label: "pi",
    kind: "statement",
    callable: false,
    signatures: [],
    detail: "float",
  };
  const descriptor = toCompletionDescriptors(item, {})[0];
  assert.equal(descriptor.label, "pi");
  assert.equal(descriptor.detail, "float");
  assert.equal(descriptor.template, undefined);
});

test("ranking and hiding rules survive the arity rework", () => {
  assert.ok(completionBoost("param") > completionBoost("function"));
  assert.ok(completionBoost("function") > completionBoost("module"));
  assert.equal(shouldHideCompletion(value("_internal"), "", false), true);
  assert.equal(shouldHideCompletion(value("_internal"), "_", false), false);
});

test("buildCompletionOptions flattens arity rows, dedupes, and gates snippets", () => {
  const options = buildCompletionOptions({ items: [callable("Motor", ["port", "positive_direction=X"])], allowSnippets: false });
  assert.deepEqual(options.map((o) => o.label), ["Motor(port)", "Motor(port, positive_direction)"]);

  const withSnippets = buildCompletionOptions({ items: [value("score")], allowSnippets: true });
  assert.ok(withSnippets.some((o) => o.label === "for"));
});
