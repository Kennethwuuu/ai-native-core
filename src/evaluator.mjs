import * as logic from "./logic.mjs";
import { EvaluationError, fail, own, record, text, ids, typed, list } from "./validation.mjs";
import { domainContentId, closureClaimId, validateDomain, MAX_DOMAIN_MEMBERS } from "./domains.mjs";
import { assertResultBudget, DIAGNOSTIC_LIMITS } from "./diagnostics.mjs";
export { EvaluationError } from "./validation.mjs";

export const PROFILE = "aicore.reference-evaluator/0.2";
export const LEGACY_PROFILE = "aicore.reference-evaluator/0.1";
export const VOCABULARY_ID = "aicore.reference-vocabulary/0.2";
export const LEGACY_VOCABULARY_ID = "aicore.reference-vocabulary/0.1";
export const EVALUATOR_ID = "aicore.js-reference/0.2.1";
const LEGACY_LIMITS = Object.freeze({ max_depth: 64, max_nodes: 5000, max_atoms: 1000 });
export const DEFAULT_LIMITS = Object.freeze({ ...LEGACY_LIMITS, max_domain_members: MAX_DOMAIN_MEMBERS, max_instantiations: 1000 });

// The registry is fixed for this version. Requests cannot register host code.
const signature = (args, method, result) => Object.freeze({ args: Object.freeze(args), method, result });
const functions = Object.freeze({
  "bool.not": signature(["Bool2"], (a) => ({ type: "Bool2", value: !a }), "Bool2"),
});
const legacyPredicates = Object.freeze({
  "int.le": signature(["Int53", "Int53"], (a, b) => a <= b),
  "string.equal": signature(["String", "String"], (a, b) => a === b),
  "bool.equal": signature(["Bool2", "Bool2"], (a, b) => a === b),
  "claim.supported": signature(["String"], null),
});
const predicates = Object.freeze({
  ...legacyPredicates,
  "claim.supported": signature(["ClaimId"], null),
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
  const base = { profile: PROFILE, vocabulary_id: VOCABULARY_ID, evaluator_id: EVALUATOR_ID, diagnostic_limits: DIAGNOSTIC_LIMITS };
  const observations = [];
  const domainChecks = [];
  const stats = { nodes: 0, atoms: 0, support_references: 0 };
  function reserveSupport(support, path) {
    const count = support.positive_support_ids.length + support.negative_support_ids.length;
    if (stats.support_references + count > DIAGNOSTIC_LIMITS.max_support_references) {
      fail("DIAGNOSTIC_LIMIT", path, "Diagnostic support-reference budget exhausted", "INDETERMINATE");
    }
    stats.support_references += count;
  }
  try {
    const quantified = request?.profile === PROFILE;
    if (quantified) { stats.validation_nodes = 0; stats.instantiations = 0; }
    record(request, "$", ["profile", "vocabulary_id", "subject_id", "snapshot_id", "evidence_view_id",
      "scope", "context", "bindings", "claims", "constraint"], quantified ? ["limits", "domains"] : ["limits"]);
    if (![PROFILE, LEGACY_PROFILE].includes(request.profile) || request.vocabulary_id !== (quantified ? VOCABULARY_ID : LEGACY_VOCABULARY_ID)) fail("UNSUPPORTED_PROFILE", "$", "Unknown evaluator profile or vocabulary");
    base.profile = request.profile;
    base.vocabulary_id = request.vocabulary_id;
    const registry = quantified ? predicates : legacyPredicates;
    function checkedTyped(value, path) {
      typed(value, path);
      if (!quantified && value.type === "ClaimId") fail("INVALID_TYPED_VALUE", path, "ClaimId requires vocabulary 0.2");
      return value;
    }
    if (request.scope !== "state") fail("UNSUPPORTED_SCOPE", "$.scope", "This subset supports only state scope");
    for (const key of ["subject_id", "snapshot_id", "evidence_view_id"]) {
      text(request[key], `$.${key}`); base[key] = request[key];
    }
    base.scope = request.scope;
    const limits = { ...(quantified ? DEFAULT_LIMITS : LEGACY_LIMITS) };
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
      checkedTyped(value, `$.bindings.${path}`);
    }
    record(request.claims, "$.claims", [], Object.keys(request.claims ?? {}));
    for (const [id, support] of Object.entries(request.claims)) {
      text(id, "$.claims");
      record(support, `$.claims.${id}`, ["positive_support_ids", "negative_support_ids"]);
      ids(support.positive_support_ids, `$.claims.${id}.positive_support_ids`);
      ids(support.negative_support_ids, `$.claims.${id}.negative_support_ids`);
    }
    const domains = quantified && own(request, "domains") ? request.domains : {};
    record(domains, "$.domains", [], Object.keys(domains ?? {}));
    for (const [id, domain] of Object.entries(domains)) {
      const path = `$.domains.${id}`;
      validateDomain(id, domain, path, limits.max_domain_members);
      if (domain.subject_id !== request.subject_id || domain.snapshot_id !== request.snapshot_id || domain.scope !== request.scope) {
        fail("DOMAIN_SCOPE_MISMATCH", path, "Domain must bind the exact request subject, snapshot, and scope");
      }
      if (typeof domain.content_id !== "string" || !/^aicore-domain-sha256:[0-9a-f]{64}$/.test(domain.content_id)) {
        fail("INVALID_DOMAIN_ID", `${path}.content_id`, "Expected a domain content identity");
      }
      if (domain.content_id !== domainContentId(id, domain)) fail("DOMAIN_HASH_MISMATCH", `${path}.content_id`, "Domain content identity does not match its contents");
    }
    const constraint = request.constraint;
    record(constraint, "$.constraint", ["id", "form"], ["expr", "activation", "requirement"]);
    text(constraint.id, "$.constraint.id"); base.constraint_id = constraint.id;
    if (["require", "forbid"].includes(constraint.form)) record(constraint, "$.constraint", ["id", "form", "expr"]);
    else if (constraint.form === "when_require") record(constraint, "$.constraint", ["id", "form", "activation", "requirement"]);
    else fail("UNSUPPORTED_CONSTRAINT", "$.constraint.form", "Expected require, forbid, or when_require");
    if (!request.context.complete) fail("MISSING_DEPENDENCY", "$.context", `Missing: ${request.context.missing_dependencies.join(", ")}`, "INCOMPLETE_CONTEXT");

    function tick(path, depth, checking = false) {
      const counter = checking ? "validation_nodes" : "nodes";
      stats[counter] += 1;
      if (depth > limits.max_depth || stats[counter] > limits.max_nodes) fail("RESOURCE_LIMIT", path, "Expression depth or node budget exhausted", "INDETERMINATE");
    }
    function argumentsFor(entry, args, path, depth, env, checking) {
      if (!Array.isArray(args) || args.length !== entry.args.length) fail("ARITY_MISMATCH", path, "Wrong argument count");
      list(args, path);
      return args.map((arg, i) => {
        const value = term(arg, `${path}[${i}]`, depth + 1, env, checking);
        if (value.type !== entry.args[i]) fail("TYPE_MISMATCH", `${path}[${i}]`, `Expected ${entry.args[i]}; received ${value.type}`);
        return value.value;
      });
    }
    function term(node, path, depth, env, checking) {
      tick(path, depth, checking);
      record(node, path, [], quantified ? ["type", "value", "ref", "call", "args", "var"] : ["type", "value", "ref", "call", "args"]);
      if (quantified && own(node, "var")) {
        record(node, path, ["var"]); text(node.var, `${path}.var`);
        if (!env.has(node.var)) fail("UNBOUND_VARIABLE", path, "Variable is outside its lexical quantifier scope");
        return env.get(node.var);
      }
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
        const args = argumentsFor(entry, node.args, `${path}.args`, depth, env, checking);
        return checking ? { type: entry.result } : entry.method(...args);
      }
      return checkedTyped(node, path);
    }
    function expr(node, path, depth, env = new Map(), checking = false) {
      tick(path, depth, checking);
      record(node, path, ["op"], quantified ? ["predicate", "args", "expr", "items", "binding", "domain", "body"] : ["predicate", "args", "expr", "items"]);
      if (node.op === "atom") {
        record(node, path, ["op", "predicate", "args"]);
        text(node.predicate, `${path}.predicate`);
        if (!own(registry, node.predicate)) fail("UNKNOWN_PREDICATE", path, "Unknown predicate");
        if (!checking && ++stats.atoms > limits.max_atoms) fail("RESOURCE_LIMIT", path, "Atom budget exhausted", "INDETERMINATE");
        const entry = registry[node.predicate];
        const args = argumentsFor(entry, node.args, `${path}.args`, depth, env, checking);
        if (checking) return;
        let information_value;
        let support;
        if (node.predicate === "claim.supported") {
          text(args[0], `${path}.args[0]`);
          support = own(request.claims, args[0]) ? request.claims[args[0]] : { positive_support_ids: [], negative_support_ids: [] };
          reserveSupport(support, path);
          information_value = logic.fromSupport(support.positive_support_ids.length > 0, support.negative_support_ids.length > 0);
          observations.push({ path, predicate_id: node.predicate, claim_id: args[0], information_value,
            positive_support_ids: [...support.positive_support_ids].sort(), negative_support_ids: [...support.negative_support_ids].sort(),
            missing_support: information_value === "UNKNOWN" ? ["NO_ELIGIBLE_SUPPORT"] : [],
            conflicting_support: information_value === "CONFLICTING", assumptions: [] });
        } else {
          information_value = entry.method(...args) ? "SUPPORTED_TRUE" : "SUPPORTED_FALSE";
          observations.push({ path, predicate_id: node.predicate, information_value, derivation: {
            method_id: `${request.vocabulary_id}#${node.predicate}`, snapshot_id: request.snapshot_id, arguments: args,
          }, assumptions: [] });
        }
        return { path, information_value, strict_status: logic.atomicStatus(information_value) };
      }
      if (node.op === "not") {
        record(node, path, ["op", "expr"]);
        const child = expr(node.expr, `${path}.expr`, depth + 1, env, checking);
        if (checking) return;
        return { path, information_value: logic.not(child.information_value), strict_status: logic.strictNot(child.strict_status), children: [child] };
      }
      if (["all", "any"].includes(node.op)) {
        record(node, path, ["op", "items"]);
        list(node.items, `${path}.items`);
        // Always visit every operand; truth witnesses do not mask invalidity.
        const children = node.items.map((x, i) => expr(x, `${path}.items[${i}]`, depth + 1, env, checking));
        if (checking) return;
        return fold(path, node.op === "all", children);
      }
      if (quantified && ["forall", "exists"].includes(node.op)) {
        record(node, path, ["op", "binding", "domain", "body"]);
        if (typeof node.binding !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.binding)) fail("INVALID_BINDING", `${path}.binding`, "Expected a lexical variable name");
        if (env.has(node.binding)) fail("SHADOWED_BINDING", `${path}.binding`, "Nested quantifiers must use distinct variable names");
        text(node.domain, `${path}.domain`);
        if (!own(domains, node.domain)) fail("MISSING_DOMAIN", `${path}.domain`, "Required finite domain is unavailable", "INCOMPLETE_CONTEXT");
        const domain = domains[node.domain];
        const nested = new Map(env);
        if (checking) {
          const claimId = closureClaimId(domain.content_id);
          const support = own(request.claims, claimId) ? request.claims[claimId] : { positive_support_ids: [], negative_support_ids: [] };
          reserveSupport(support, path);
          const value = logic.fromSupport(support.positive_support_ids.length > 0, support.negative_support_ids.length > 0);
          domainChecks.push({ path, domain_id: node.domain, content_id: domain.content_id, closure_claim_id: claimId,
            closure_information_value: value, positive_support_ids: [...support.positive_support_ids].sort(), negative_support_ids: [...support.negative_support_ids].sort() });
          if (value !== "SUPPORTED_TRUE") fail("DOMAIN_NOT_CLOSED", `${path}.domain`, `Domain closure has ${value} support`, "INCOMPLETE_CONTEXT");
          nested.set(node.binding, { type: domain.element_type });
          expr(node.body, `${path}.body`, depth + 1, nested, true);
          return;
        }
        const children = [];
        for (const [index, value] of domain.members.entries()) {
          if (++stats.instantiations > limits.max_instantiations) fail("INSTANTIATION_LIMIT", path, "Quantifier instantiation budget exhausted", "INDETERMINATE");
          nested.set(node.binding, { type: domain.element_type, value });
          children.push(expr(node.body, `${path}.members[${index}].body`, depth + 1, nested));
        }
        return { ...fold(path, node.op === "forall", children), domain_id: node.domain, domain_content_id: domain.content_id,
          binding: node.binding, members: [...domain.members] };
      }
      fail("UNKNOWN_OPERATOR", `${path}.op`, "Unsupported expression operator");
    }
    function fold(path, all, children) {
      return { path, information_value: children.reduce((v, x) => (all ? logic.and : logic.or)(v, x.information_value), all ? "SUPPORTED_TRUE" : "SUPPORTED_FALSE"),
        strict_status: children.reduce((v, x) => (all ? logic.strictAll : logic.strictAny)(v, x.strict_status), all ? "SATISFIED" : "VIOLATED"), children };
    }
    if (quantified) {
      // Validate the whole body even for empty domains; vacuity cannot hide an
      // unsupported predicate, ill-typed term, unbound variable, or missing cut.
      if (constraint.form === "when_require") {
        expr(constraint.activation, "$.constraint.activation", 1, new Map(), true);
        expr(constraint.requirement, "$.constraint.requirement", 1, new Map(), true);
      } else expr(constraint.expr, "$.constraint.expr", 1, new Map(), true);
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
    const result = { ...base, completion: "COMPLETE", constraint_status: constraintStatus,
      effectful_gate_contribution: contribution("COMPLETE", constraintStatus), ...details, observations, domain_checks: domainChecks, stats };
    assertResultBudget(result);
    return result;
  } catch (error) {
    if (!(error instanceof EvaluationError)) throw error;
    if (error.code === "DIAGNOSTIC_LIMIT") { observations.length = 0; domainChecks.length = 0; }
    const result = { ...base, completion: error.completion, effectful_gate_contribution: contribution(error.completion),
      diagnostics: [{ code: error.code, path: error.path, message: error.message }], observations, domain_checks: domainChecks, stats };
    try { assertResultBudget(result); return result; }
    catch (budgetError) {
      if (!(budgetError instanceof EvaluationError) || budgetError.code !== "DIAGNOSTIC_LIMIT") throw budgetError;
      // Even failure provenance or a caller-supplied identity may be too large.
      // Return an explicit incomplete diagnostic, never a truncated attestation.
      return { profile: base.profile, vocabulary_id: base.vocabulary_id, evaluator_id: EVALUATOR_ID,
        diagnostic_limits: DIAGNOSTIC_LIMITS, completion: error.completion, effectful_gate_contribution: contribution(error.completion),
        diagnostics: [{ code: "DIAGNOSTIC_LIMIT", path: "$", cause_code: error.code, message: "Failure payload exceeds diagnostic budget; payload omitted" }], stats };
    }
  }
}
