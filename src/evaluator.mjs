import * as logic from "./logic.mjs";

export const PROFILE = "aicore.reference-evaluator/0.1";
export const VOCABULARY_ID = "aicore.reference-vocabulary/0.1";
export const EVALUATOR_ID = "aicore.js-reference/0.1";
export const DEFAULT_LIMITS = Object.freeze({ max_depth: 64, max_nodes: 5000, max_atoms: 1000 });

export class EvaluationError extends Error {
  constructor(completion, code, path, message) {
    super(message);
    Object.assign(this, { completion, code, path });
  }
}
const fail = (code, path, message, completion = "INVALID") => {
  throw new EvaluationError(completion, code, path, message);
};
const own = (x, key) => Object.hasOwn(x, key);
function record(x, path, required, optional = []) {
  if (x === null || typeof x !== "object" || Array.isArray(x)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(x))) {
    fail("EXPECTED_RECORD", path, "Expected a plain record");
  }
  for (const key of required) if (!own(x, key)) fail("MISSING_FIELD", `${path}.${key}`, "Required field is missing");
  for (const key of Object.keys(x)) {
    if (!required.includes(key) && !optional.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "Unknown field");
  }
}
function text(x, path) {
  if (typeof x !== "string" || !x.length || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x)) {
    fail("EXPECTED_ID", path, "Expected a nonempty Unicode scalar string");
  }
}
function ids(x, path) {
  if (!Array.isArray(x)) fail("EXPECTED_LIST", path, "Expected a list of identifiers");
  x.forEach((id, i) => text(id, `${path}[${i}]`));
  if (new Set(x).size !== x.length) fail("DUPLICATE_ID", path, "Duplicate identifier");
}
function typed(x, path) {
  record(x, path, ["type", "value"]);
  if (x.type === "Bool2" && typeof x.value === "boolean") return x;
  if (x.type === "Int53" && Number.isSafeInteger(x.value) && !Object.is(x.value, -0)) return x;
  if (x.type === "String" && typeof x.value === "string"
      && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x.value)) return x;
  fail("INVALID_TYPED_VALUE", path, "Expected Bool2, bounded Int53, or a Unicode scalar String; no coercion");
}

// The registry is fixed for this version. Requests cannot register host code.
const signature = (args, method) => Object.freeze({ args: Object.freeze(args), method });
const functions = Object.freeze({
  "bool.not": signature(["Bool2"], (a) => ({ type: "Bool2", value: !a })),
});
const predicates = Object.freeze({
  "int.le": signature(["Int53", "Int53"], (a, b) => a <= b),
  "string.equal": signature(["String", "String"], (a, b) => a === b),
  "bool.equal": signature(["Bool2", "Bool2"], (a, b) => a === b),
  "claim.supported": signature(["String"], null),
});

export function contribution(completion, constraintStatus) {
  if (completion === "INVALID") return "DENY";
  if (["INDETERMINATE", "INCOMPLETE_CONTEXT"].includes(completion)) return "DEFER";
  if (completion !== "COMPLETE" || !logic.STATUSES.includes(constraintStatus)) {
    throw new TypeError("Invalid completion/status combination");
  }
  return constraintStatus === "SATISFIED" ? "CONTINUE" : constraintStatus === "VIOLATED" ? "DENY" : "DEFER";
}

// Experimental RFC-0006 subset. Inputs are a caller-supplied immutable snapshot
// and an ALREADY ELIGIBLE support view, not raw or authenticated evidence.
export function evaluate(request) {
  const base = { profile: PROFILE, vocabulary_id: VOCABULARY_ID, evaluator_id: EVALUATOR_ID };
  const observations = [];
  const stats = { nodes: 0, atoms: 0 };
  try {
    record(request, "$", ["profile", "vocabulary_id", "subject_id", "snapshot_id", "evidence_view_id",
      "scope", "context", "bindings", "claims", "constraint"], ["limits"]);
    if (request.profile !== PROFILE || request.vocabulary_id !== VOCABULARY_ID) fail("UNSUPPORTED_PROFILE", "$", "Unknown evaluator profile or vocabulary");
    if (request.scope !== "state") fail("UNSUPPORTED_SCOPE", "$.scope", "This subset supports only state scope");
    for (const key of ["subject_id", "snapshot_id", "evidence_view_id"]) {
      text(request[key], `$.${key}`); base[key] = request[key];
    }
    base.scope = request.scope;
    const limits = { ...DEFAULT_LIMITS };
    if (own(request, "limits")) {
      record(request.limits, "$.limits", [], Object.keys(limits));
      for (const [key, value] of Object.entries(request.limits)) {
        if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) fail("INVALID_LIMIT", `$.limits.${key}`, `Limit must be in [1, ${limits[key]}]`);
        limits[key] = value;
      }
    }
    base.limits = limits;
    record(request.context, "$.context", ["complete", "missing_dependencies"]);
    if (typeof request.context.complete !== "boolean") fail("INVALID_CONTEXT", "$.context.complete", "Expected Bool2");
    ids(request.context.missing_dependencies, "$.context.missing_dependencies");
    if (request.context.complete === (request.context.missing_dependencies.length > 0)) fail("INVALID_CONTEXT", "$.context", "Closure marker and missing dependencies disagree");
    record(request.bindings, "$.bindings", [], Object.keys(request.bindings ?? {}));
    for (const [path, value] of Object.entries(request.bindings)) {
      if (!/^state\.[A-Za-z0-9_.-]+$/.test(path)) fail("INVALID_SCOPE_PATH", `$.bindings.${path}`, "Binding must be an explicit state path");
      typed(value, `$.bindings.${path}`);
    }
    record(request.claims, "$.claims", [], Object.keys(request.claims ?? {}));
    for (const [id, support] of Object.entries(request.claims)) {
      text(id, "$.claims");
      record(support, `$.claims.${id}`, ["positive_support_ids", "negative_support_ids"]);
      ids(support.positive_support_ids, `$.claims.${id}.positive_support_ids`);
      ids(support.negative_support_ids, `$.claims.${id}.negative_support_ids`);
    }
    const constraint = request.constraint;
    record(constraint, "$.constraint", ["id", "form"], ["expr", "activation", "requirement"]);
    text(constraint.id, "$.constraint.id"); base.constraint_id = constraint.id;
    if (["require", "forbid"].includes(constraint.form)) record(constraint, "$.constraint", ["id", "form", "expr"]);
    else if (constraint.form === "when_require") record(constraint, "$.constraint", ["id", "form", "activation", "requirement"]);
    else fail("UNSUPPORTED_CONSTRAINT", "$.constraint.form", "Expected require, forbid, or when_require");
    if (!request.context.complete) fail("MISSING_DEPENDENCY", "$.context", `Missing: ${request.context.missing_dependencies.join(", ")}`, "INCOMPLETE_CONTEXT");

    function tick(path, depth) {
      stats.nodes += 1;
      if (depth > limits.max_depth || stats.nodes > limits.max_nodes) fail("RESOURCE_LIMIT", path, "Expression depth or node budget exhausted", "INDETERMINATE");
    }
    function argumentsFor(entry, args, path, depth) {
      if (!Array.isArray(args) || args.length !== entry.args.length) fail("ARITY_MISMATCH", path, "Wrong argument count");
      return args.map((arg, i) => {
        const value = term(arg, `${path}[${i}]`, depth + 1);
        if (value.type !== entry.args[i]) fail("TYPE_MISMATCH", `${path}[${i}]`, `Expected ${entry.args[i]}; received ${value.type}`);
        return value.value;
      });
    }
    function term(node, path, depth) {
      tick(path, depth);
      record(node, path, [], ["type", "value", "ref", "call", "args"]);
      if (own(node, "ref")) {
        record(node, path, ["ref"]); text(node.ref, `${path}.ref`);
        if (!node.ref.startsWith("state.")) fail("INVALID_SCOPE_PATH", path, "Reference is outside state scope");
        if (!own(request.bindings, node.ref)) fail("UNBOUND_REFERENCE", path, "Required reference is unresolved");
        return request.bindings[node.ref];
      }
      if (own(node, "call")) {
        record(node, path, ["call", "args"]);
        text(node.call, `${path}.call`);
        if (!own(functions, node.call)) fail("UNKNOWN_FUNCTION", path, "Unknown value function");
        const entry = functions[node.call];
        return entry.method(...argumentsFor(entry, node.args, `${path}.args`, depth));
      }
      return typed(node, path);
    }
    function expr(node, path, depth) {
      tick(path, depth);
      record(node, path, ["op"], ["predicate", "args", "expr", "items"]);
      if (node.op === "atom") {
        record(node, path, ["op", "predicate", "args"]);
        text(node.predicate, `${path}.predicate`);
        if (!own(predicates, node.predicate)) fail("UNKNOWN_PREDICATE", path, "Unknown predicate");
        if (++stats.atoms > limits.max_atoms) fail("RESOURCE_LIMIT", path, "Atom budget exhausted", "INDETERMINATE");
        const entry = predicates[node.predicate];
        const args = argumentsFor(entry, node.args, `${path}.args`, depth);
        let information_value;
        let support;
        if (node.predicate === "claim.supported") {
          text(args[0], `${path}.args[0]`);
          support = own(request.claims, args[0]) ? request.claims[args[0]] : { positive_support_ids: [], negative_support_ids: [] };
          information_value = logic.fromSupport(support.positive_support_ids.length > 0, support.negative_support_ids.length > 0);
          observations.push({ path, predicate_id: node.predicate, claim_id: args[0], information_value,
            positive_support_ids: [...support.positive_support_ids].sort(), negative_support_ids: [...support.negative_support_ids].sort(),
            missing_support: information_value === "UNKNOWN" ? ["NO_ELIGIBLE_SUPPORT"] : [],
            conflicting_support: information_value === "CONFLICTING", assumptions: [] });
        } else {
          information_value = entry.method(...args) ? "SUPPORTED_TRUE" : "SUPPORTED_FALSE";
          observations.push({ path, predicate_id: node.predicate, information_value, derivation: {
            method_id: `${VOCABULARY_ID}#${node.predicate}`, snapshot_id: request.snapshot_id, arguments: args,
          }, assumptions: [] });
        }
        return { path, information_value, strict_status: logic.atomicStatus(information_value) };
      }
      if (node.op === "not") {
        record(node, path, ["op", "expr"]);
        const child = expr(node.expr, `${path}.expr`, depth + 1);
        return { path, information_value: logic.not(child.information_value), strict_status: logic.strictNot(child.strict_status), children: [child] };
      }
      if (["all", "any"].includes(node.op)) {
        record(node, path, ["op", "items"]);
        if (!Array.isArray(node.items)) fail("EXPECTED_LIST", `${path}.items`, "Expected expression list");
        // Always visit every operand; truth witnesses do not mask invalidity.
        const children = node.items.map((x, i) => expr(x, `${path}.items[${i}]`, depth + 1));
        const all = node.op === "all";
        return { path, information_value: children.reduce((v, x) => (all ? logic.and : logic.or)(v, x.information_value), all ? "SUPPORTED_TRUE" : "SUPPORTED_FALSE"),
          strict_status: children.reduce((v, x) => (all ? logic.strictAll : logic.strictAny)(v, x.strict_status), all ? "SATISFIED" : "VIOLATED"), children };
      }
      fail("UNKNOWN_OPERATOR", `${path}.op`, "Unsupported expression operator");
    }
    let details, constraintStatus;
    if (constraint.form === "when_require") {
      const activation = expr(constraint.activation, "$.constraint.activation", 1);
      const requirement = expr(constraint.requirement, "$.constraint.requirement", 1);
      details = { activation, requirement };
      constraintStatus = logic.whenRequire(activation.strict_status, requirement.strict_status);
    } else {
      const expression = expr(constraint.expr, "$.constraint.expr", 1);
      details = { expression };
      constraintStatus = constraint.form === "forbid" ? logic.strictNot(expression.strict_status) : expression.strict_status;
      if (constraint.form === "forbid") details.normalized = {
        information_value: logic.not(expression.information_value), strict_status: constraintStatus,
      };
    }
    return { ...base, completion: "COMPLETE", constraint_status: constraintStatus,
      effectful_gate_contribution: contribution("COMPLETE", constraintStatus), ...details, observations, stats };
  } catch (error) {
    if (!(error instanceof EvaluationError)) throw error;
    return { ...base, completion: error.completion, effectful_gate_contribution: contribution(error.completion),
      diagnostics: [{ code: error.code, path: error.path, message: error.message }], observations, stats };
  }
}
