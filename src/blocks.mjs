import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { EvaluationError, fail, ids, list, own, record, text, typed } from "./validation.mjs";
import { PROFILE as CORE_PROFILE, VOCABULARY_ID, contribution } from "./evaluator.mjs";
import { valueFunctions, predicates } from "./vocabulary.mjs";
import { evaluateEvidence, EVALUATION_PROFILE, FILTER_ID, TRUST_PROFILE, EVIDENCE_PROFILE } from "./test-evidence.mjs";
import { assertResultBudget } from "./diagnostics.mjs";

export const BLOCK_PROFILE = "aicore.constraint-block/0.1";
export const AUDIT_PROFILE = "aicore.constraint-block-audit/0.1";
export const CONTEXT_PROFILE = "aicore.constraint-context/0.1";
export const RUNTIME_PROFILE = "aicore.constraint-block-runtime/0.1";
export const AUTHORITY_PROFILE = "aicore.constraint-block-authority/0.1";
export const ASSESSMENT_PROFILE = "aicore.constraint-block-assessment/0.1";
export const BLOCK_LIMITS = Object.freeze({ max_constraints: 16, max_exports: 8, max_export_constraints: 8, max_imports: 32, max_ast_nodes: 5000, max_depth: 32 });

const exact = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
const sortedMap = object => Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
const semantic = block => Object.fromEntries(Object.entries(block).filter(([key]) => !["annotations", "block_content_id"].includes(key)));
function localId(value, path) {
  if (!exact(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, value)) fail("INVALID_LOCAL_ID", path, "Expected a stable ASCII identifier of 1 to 64 characters");
}
function blockId(value, path) {
  if (!exact(/^aicore-block-sha256:[0-9a-f]{64}$/, value)) fail("INVALID_BLOCK_CONTENT_ID", path, "Expected an exact Block content ID");
}
function statePath(value, path) {
  if (!exact(/^state\.[A-Za-z0-9_.-]+$/, value) || value.length > 256) fail("INVALID_STATE_PATH", path, "Expected an explicit state path of at most 256 characters");
}
function map(value, path, maximum) {
  record(value, path, [], Object.keys(value ?? {}));
  if (Object.keys(value).length > maximum) fail("BLOCK_LIMIT", path, "Block cardinality budget exhausted", "INDETERMINATE");
}
function annotations(value) {
  record(value, "$.annotations", [], ["label", "description"]);
  for (const [key, data] of Object.entries(value)) {
    typed({ type: "String", value: data }, `$.annotations.${key}`);
    if (Buffer.byteLength(data, "utf8") > (key === "label" ? 256 : 2048)) fail("BLOCK_LIMIT", "$.annotations", "Annotation budget exhausted", "INDETERMINATE");
  }
  return sortedMap(value);
}

function inspectConstraint(definition, inputs, path, budget) {
  const states = new Set(), claims = new Set();
  const tick = depth => {
    if (++budget.nodes > BLOCK_LIMITS.max_ast_nodes || depth > BLOCK_LIMITS.max_depth) fail("BLOCK_LIMIT", path, "Block AST budget exhausted", "INDETERMINATE");
  };
  function args(entry, items, depth) {
    if (!Array.isArray(items) || items.length !== entry.args.length) fail("ARITY_MISMATCH", path, "Wrong argument count");
    list(items, path);
    return items.map((item, i) => {
      const result = term(item, depth + 1);
      if (result.type !== entry.args[i]) fail("TYPE_MISMATCH", path, `Expected ${entry.args[i]}, received ${result.type}`);
      return result.node;
    });
  }
  function term(node, depth) {
    tick(depth); record(node, path, [], ["type", "value", "ref", "call", "args"]);
    if (own(node, "ref")) {
      record(node, path, ["ref"]); statePath(node.ref, path);
      if (!own(inputs, node.ref)) fail("UNDECLARED_STATE_INPUT", path, `Missing input declaration: ${node.ref}`);
      states.add(node.ref);
      return { type: inputs[node.ref], node: { ref: node.ref } };
    }
    if (own(node, "call")) {
      record(node, path, ["call", "args"]); text(node.call, path);
      if (!own(valueFunctions, node.call)) fail("UNKNOWN_FUNCTION", path, "Unknown fixed value function");
      const entry = valueFunctions[node.call];
      return { type: entry.result, node: { call: node.call, args: args(entry, node.args, depth) } };
    }
    typed(node, path);
    return { type: node.type, node: { type: node.type, value: node.value } };
  }
  function expr(node, depth) {
    tick(depth); record(node, path, ["op"], ["predicate", "args", "expr", "items"]);
    if (node.op === "atom") {
      record(node, path, ["op", "predicate", "args"]); text(node.predicate, path);
      if (!own(predicates, node.predicate)) fail("UNKNOWN_PREDICATE", path, "Unknown fixed predicate");
      const items = args(predicates[node.predicate], node.args, depth);
      if (node.predicate === "claim.supported") {
        if (!own(items[0], "type") || items[0].type !== "ClaimId") fail("DYNAMIC_CLAIM_UNSUPPORTED", path, "Block claim dependencies must be exact literals");
        claims.add(items[0].value);
      }
      return { op: "atom", predicate: node.predicate, args: items };
    }
    if (node.op === "not") { record(node, path, ["op", "expr"]); return { op: "not", expr: expr(node.expr, depth + 1) }; }
    if (["all", "any"].includes(node.op)) {
      record(node, path, ["op", "items"]); list(node.items, path);
      if (node.items.length > BLOCK_LIMITS.max_ast_nodes) fail("BLOCK_LIMIT", path, "Operand budget exhausted", "INDETERMINATE");
      return { op: node.op, items: node.items.map(item => expr(item, depth + 1)) };
    }
    fail("UNSUPPORTED_BLOCK_OPERATOR", path, "This Block profile supports atom/not/all/any only");
  }
  record(definition, path, ["form"], ["expr", "activation", "requirement"]);
  let result;
  if (["require", "forbid"].includes(definition.form)) {
    record(definition, path, ["form", "expr"]);
    if (definition.form === "forbid") {
      tick(1); result = { form: "require", expr: { op: "not", expr: expr(definition.expr, 2) } };
    } else result = { form: "require", expr: expr(definition.expr, 1) };
  } else if (definition.form === "when_require") {
    record(definition, path, ["form", "activation", "requirement"]);
    result = { form: "when_require", activation: expr(definition.activation, 1), requirement: expr(definition.requirement, 1) };
  } else fail("UNSUPPORTED_CONSTRAINT", path, "Unsupported Constraint form");
  return { definition: result, states: [...states].sort(), claims: [...claims].sort() };
}

function inspectBlock(input) {
  record(input, "$", ["profile", "block_id", "imports", "constraints", "exports"], ["block_content_id", "annotations"]);
  if (input.profile !== BLOCK_PROFILE) fail("UNSUPPORTED_BLOCK_PROFILE", "$.profile", "Unknown compact Block profile");
  canonicalJson(input, 1024 * 1024); // Same source budget for API and CLI.
  localId(input.block_id, "$.block_id");
  record(input.imports, "$.imports", ["state", "claims"]);
  map(input.imports.state, "$.imports.state", BLOCK_LIMITS.max_imports);
  for (const [path, type] of Object.entries(input.imports.state)) {
    statePath(path, "$.imports.state");
    if (!["Bool2", "Int53", "String"].includes(type)) fail("UNSUPPORTED_INPUT_TYPE", "$.imports.state", "State inputs use exact Bool2/Int53/String types");
  }
  ids(input.imports.claims, "$.imports.claims");
  if (input.imports.claims.length > BLOCK_LIMITS.max_imports) fail("BLOCK_LIMIT", "$.imports.claims", "Import budget exhausted", "INDETERMINATE");
  for (const claim of input.imports.claims) {
    if (!claim.startsWith("test-suite.passed:") || claim.length <= 18 || Buffer.byteLength(claim, "utf8") > 1042) fail("UNSUPPORTED_CLAIM_IMPORT", "$.imports.claims", "Expected a test-suite.passed claim locator");
  }
  map(input.constraints, "$.constraints", BLOCK_LIMITS.max_constraints);
  map(input.exports, "$.exports", BLOCK_LIMITS.max_exports);
  if (!Object.keys(input.constraints).length || !Object.keys(input.exports).length) fail("EMPTY_BLOCK", "$", "At least one constraint and export are required");
  const nodes = Object.create(null), constraints = Object.create(null), exported = new Set();
  const usedStates = new Set(), usedClaims = new Set(), budget = { nodes: 0 };
  for (const key of Object.keys(input.constraints).sort()) {
    localId(key, "$.constraints");
    const info = inspectConstraint(input.constraints[key], input.imports.state, `$.constraints.${key}`, budget);
    nodes[key] = info; constraints[key] = info.definition;
    info.states.forEach(value => usedStates.add(value)); info.claims.forEach(value => usedClaims.add(value));
  }
  const exports = Object.create(null);
  for (const key of Object.keys(input.exports).sort()) {
    localId(key, "$.exports"); ids(input.exports[key], `$.exports.${key}`);
    if (!input.exports[key].length) fail("EMPTY_EXPORT", `$.exports.${key}`, "An export cannot vacuously omit every hard constraint");
    if (input.exports[key].length > BLOCK_LIMITS.max_export_constraints) fail("BLOCK_LIMIT", `$.exports.${key}`, "Export constraint budget exhausted", "INDETERMINATE");
    exports[key] = [...input.exports[key]].sort();
    for (const id of exports[key]) {
      if (!own(nodes, id)) fail("UNRESOLVED_CONSTRAINT", `$.exports.${key}`, `Unknown constraint: ${id}`);
      exported.add(id);
    }
  }
  for (const key of Object.keys(nodes)) if (!exported.has(key)) fail("UNEXPORTED_CONSTRAINT", "$.constraints", `Constraint has no export: ${key}`);
  for (const value of usedClaims) if (!input.imports.claims.includes(value)) fail("UNDECLARED_CLAIM_IMPORT", "$.imports.claims", `Missing claim declaration: ${value}`);
  if (Object.keys(input.imports.state).some(key => !usedStates.has(key)) || input.imports.claims.some(key => !usedClaims.has(key))) {
    fail("UNUSED_IMPORT", "$.imports", "This exact-boundary profile rejects unused imports");
  }
  const compact = { profile: BLOCK_PROFILE, block_id: input.block_id,
    imports: { state: sortedMap(input.imports.state), claims: [...input.imports.claims].sort() }, constraints, exports };
  const contentId = `aicore-block-sha256:${createHash("sha256").update("AI-NATIVE-CORE\0BLOCK\0").update(canonicalJson(compact), "utf8").digest("hex")}`;
  if (own(input, "block_content_id")) { blockId(input.block_content_id, "$.block_content_id"); if (input.block_content_id !== contentId) fail("BLOCK_ID_MISMATCH", "$.block_content_id", "Block content does not match its claimed identity"); }
  compact.block_content_id = contentId;
  if (own(input, "annotations")) compact.annotations = annotations(input.annotations);
  return { compact, nodes };
}

export const normalizeBlock = input => inspectBlock(input).compact;

export function expandBlock(input) {
  const { compact, nodes } = inspectBlock(input), expandedNodes = Object.create(null), edges = [];
  const stateInputs = Object.fromEntries(Object.entries(compact.imports.state).map(([path, type]) => [path, { type, required: true }]));
  const evidenceInputs = Object.fromEntries(compact.imports.claims.map(claim => [claim, { type: "ClaimId", required: true }]));
  const outputs = Object.fromEntries(Object.entries(compact.exports).map(([name, requirements]) => [name, { type: "ConstraintAssessment", required_constraints: requirements }]));
  for (const [id, node] of Object.entries(nodes)) {
    expandedNodes[id] = { node_id: [compact.block_id, "constraint", id], kernel_kind: "Constraint", scope: "state",
      definition: { id, ...node.definition }, state_dependencies: node.states, evidence_dependencies: node.claims, effects: [], capabilities: [] };
    node.states.forEach(path => edges.push(["state-input", path, id]));
    node.claims.forEach(claim => edges.push(["claim-input", claim, id]));
  }
  for (const [name, requirements] of Object.entries(compact.exports)) requirements.forEach(id => edges.push(["export", id, name]));
  edges.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
  const audit = { profile: AUDIT_PROFILE, block_id: compact.block_id, block_content_id: compact.block_content_id,
    boundary: { state_inputs: stateInputs, evidence_inputs: evidenceInputs, outputs, effects: [], capabilities: [], delegated_capabilities: [],
      vocabularies: [VOCABULARY_ID], evidence_adapter: FILTER_ID, runtime_dependencies: { evidence: EVIDENCE_PROFILE, trust: TRUST_PROFILE },
      observation_boundary: "pure-constraint-assessment", unresolved_dependencies: [] },
    nodes: expandedNodes, exports: compact.exports, edges };
  if (compact.annotations) audit.annotations = compact.annotations;
  assertResultBudget(audit);
  return audit;
}

export function compactBlock(audit) {
  record(audit, "$", ["profile", "block_id", "block_content_id", "boundary", "nodes", "exports", "edges"], ["annotations"]);
  if (audit.profile !== AUDIT_PROFILE) fail("UNSUPPORTED_BLOCK_PROFILE", "$.profile", "Expected the expanded audit profile");
  canonicalJson(audit);
  const constraints = Object.create(null);
  map(audit.nodes, "$.nodes", BLOCK_LIMITS.max_constraints);
  record(audit.boundary, "$.boundary", ["state_inputs", "evidence_inputs", "outputs", "effects", "capabilities", "delegated_capabilities",
    "vocabularies", "evidence_adapter", "runtime_dependencies", "observation_boundary", "unresolved_dependencies"]);
  map(audit.boundary.state_inputs, "$.boundary.state_inputs", BLOCK_LIMITS.max_imports);
  map(audit.boundary.evidence_inputs, "$.boundary.evidence_inputs", BLOCK_LIMITS.max_imports);
  for (const [id, node] of Object.entries(audit.nodes)) {
    record(node, "$.nodes[]", ["node_id", "kernel_kind", "scope", "definition", "state_dependencies", "evidence_dependencies", "effects", "capabilities"]);
    record(node.definition, "$.nodes[].definition", ["id", "form"], ["expr", "activation", "requirement"]);
    constraints[id] = Object.fromEntries(Object.entries(node.definition).filter(([key]) => key !== "id"));
  }
  const candidate = { profile: BLOCK_PROFILE, block_id: audit.block_id, block_content_id: audit.block_content_id,
    imports: { state: Object.fromEntries(Object.entries(audit.boundary.state_inputs).map(([path, port]) => {
      record(port, "$.boundary.state_inputs[]", ["type", "required"]); return [path, port.type];
    })), claims: Object.keys(audit.boundary.evidence_inputs) }, constraints, exports: audit.exports };
  if (own(audit, "annotations")) candidate.annotations = audit.annotations;
  const compact = normalizeBlock(candidate), expected = expandBlock(compact);
  if (canonicalJson(semantic(audit)) !== canonicalJson(semantic(expected))) fail("AUDIT_MISMATCH", "$", "Audit fields must exactly match deterministic expansion");
  return compact;
}

function focus(input, exportName) {
  const info = inspectBlock(input?.profile === AUDIT_PROFILE ? compactBlock(input) : input); localId(exportName, "$.export_name");
  if (!own(info.compact.exports, exportName)) fail("UNKNOWN_EXPORT", "$.export_name", "Block export does not exist");
  const required = info.compact.exports[exportName], states = new Set(), claims = new Set();
  for (const id of required) { info.nodes[id].states.forEach(x => states.add(x)); info.nodes[id].claims.forEach(x => claims.add(x)); }
  return { ...info, required, states: [...states].sort(), claims: [...claims].sort() };
}

// Non-executable static slice. Assessment always reloads/rechecks the full Block.
export function projectBlock(input, exportName, maxBytes = 65536) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) fail("INVALID_CONTEXT_BUDGET", "$", "Context byte budget must be 1..1048576");
  const { compact, required, states, claims } = focus(input, exportName);
  const cuts = [
    ...Object.keys(compact.constraints).filter(id => !required.includes(id)).map(id => ({ kind: "constraint", id, mandatory_for_static_export: false, reason: "outside-selected-export" })),
    { kind: "runtime", id: RUNTIME_PROFILE, mandatory_for_assessment: true, reason: "runtime-not-supplied" },
    { kind: "authority", id: AUTHORITY_PROFILE, mandatory_for_assessment: true, reason: "authority-not-supplied" },
  ];
  const result = { profile: CONTEXT_PROFILE, source_block_content_id: compact.block_content_id, purpose: "understand-export", export_name: exportName,
    completeness: "COMPLETE", dependencies: { vocabulary_id: VOCABULARY_ID, evidence_filter_id: FILTER_ID },
    imports: { state: Object.fromEntries(states.map(path => [path, compact.imports.state[path]])), claims },
    constraints: Object.fromEntries(required.map(id => [id, compact.constraints[id]])), required_constraints: required, cuts };
  const encoded = canonicalJson(result);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) return { profile: CONTEXT_PROFILE, source_block_content_id: compact.block_content_id,
    purpose: "understand-export", export_name: exportName, completeness: "INCOMPLETE", budget: { max_bytes: maxBytes, required_bytes: Buffer.byteLength(encoded, "utf8") },
    diagnostics: [{ code: "CONTEXT_BUDGET", message: "Required static dependency closure does not fit; no partial slice is returned" }] };
  return result;
}

export function assessBlock(input, runtime, authority) {
  const base = { profile: ASSESSMENT_PROFILE };
  let knownDeny = false;
  try {
    record(authority, "$.authority", ["profile", "block_content_id", "export_name", "evidence_trust"]);
    if (authority.profile !== AUTHORITY_PROFILE) fail("UNSUPPORTED_AUTHORITY_PROFILE", "$.authority.profile", "Unknown caller-authority profile");
    blockId(authority.block_content_id, "$.authority.block_content_id");
    const { compact, required, nodes, states } = focus(input, authority.export_name);
    if (compact.block_content_id !== authority.block_content_id) fail("BLOCK_AUTHORITY_MISMATCH", "$.authority.block_content_id", "Supplied Block differs from the caller-pinned contract");
    base.block_content_id = compact.block_content_id; base.export_name = authority.export_name;
    record(runtime, "$.runtime", ["profile", "subject_id", "snapshot_id", "context", "bindings", "evidence"]);
    if (runtime.profile !== RUNTIME_PROFILE) fail("UNSUPPORTED_RUNTIME_PROFILE", "$.runtime.profile", "Unknown Block runtime profile");
    map(runtime.bindings, "$.runtime.bindings", BLOCK_LIMITS.max_imports);
    for (const [path, value] of Object.entries(runtime.bindings)) {
      if (!own(compact.imports.state, path)) fail("UNDECLARED_RUNTIME_INPUT", "$.runtime.bindings", `Unknown state input: ${path}`);
      typed(value, `$.runtime.bindings.${path}`);
      if (value.type !== compact.imports.state[path]) fail("TYPE_MISMATCH", `$.runtime.bindings.${path}`, "Runtime input differs from the declared port type");
    }
    const missing = states.filter(path => !own(runtime.bindings, path));
    const assessments = Object.create(null);
    for (const id of required) {
      const missingForConstraint = nodes[id].states.filter(path => !own(runtime.bindings, path));
      if (missingForConstraint.length) {
        assessments[id] = { constraint_id: id, completion: "INCOMPLETE_CONTEXT", effectful_gate_contribution: "DEFER", missing_inputs: missingForConstraint,
          diagnostics: [{ code: "MISSING_BLOCK_INPUT", path: "$.runtime.bindings", message: "A required constraint input is missing" }] };
        continue;
      }
      const result = evaluateEvidence({ profile: EVALUATION_PROFILE, evaluation: { profile: CORE_PROFILE, vocabulary_id: VOCABULARY_ID,
        subject_id: runtime.subject_id, snapshot_id: runtime.snapshot_id, scope: "state", context: runtime.context, bindings: runtime.bindings,
        constraint: { id, ...compact.constraints[id] } }, evidence: runtime.evidence }, authority.evidence_trust);
      assessments[id] = result;
      if (result.effectful_gate_contribution === "DENY") knownDeny = true;
    }
    const results = Object.values(assessments);
    const completion = ["INVALID", "INDETERMINATE", "INCOMPLETE_CONTEXT"].find(x => results.some(r => r.completion === x)) ?? "COMPLETE";
    const result = { ...base, completion, effectful_gate_contribution: knownDeny ? "DENY" : results.some(r => r.effectful_gate_contribution === "DEFER") ? "DEFER" : "CONTINUE", assessments };
    if (missing.length) result.missing_inputs = missing;
    try { assertResultBudget(result); return result; }
    catch (budgetError) {
      if (!(budgetError instanceof EvaluationError) || budgetError.code !== "DIAGNOSTIC_LIMIT") throw budgetError;
      return { ...base, completion: completion === "COMPLETE" ? "INDETERMINATE" : completion,
        effectful_gate_contribution: knownDeny ? "DENY" : "DEFER",
        diagnostics: [{ code: "DIAGNOSTIC_LIMIT", path: "$", message: "Combined assessment exceeds output budget; no partial result is returned" }] };
    }
  } catch (error) {
    if (!(error instanceof EvaluationError)) throw error;
    return { ...base, completion: error.completion, effectful_gate_contribution: knownDeny ? "DENY" : contribution(error.completion),
      diagnostics: [{ code: error.code, path: error.path, message: error.message }] };
  }
}
