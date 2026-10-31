import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as logic from "../src/logic.mjs";
import { evaluate, PROFILE, LEGACY_PROFILE, VOCABULARY_ID, LEGACY_VOCABULARY_ID } from "../src/evaluator.mjs";
import { domainContentId, closureClaimId } from "../src/domains.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const literal = (type, value) => ({ type, value });
const atom = (predicate, ...args) => ({ op: "atom", predicate, args });
const claim = (term) => atom("claim.supported", term);
const quantifier = (op, domain, binding, body) => ({ op, domain, binding, body });
const support = (positive_support_ids = [], negative_support_ids = []) => ({ positive_support_ids, negative_support_ids });
function request(expr) {
  return { profile: PROFILE, vocabulary_id: VOCABULARY_ID, subject_id: "order:42", snapshot_id: "snapshot:1", evidence_view_id: "eligible-view:1", scope: "state",
    context: { complete: true, missing_dependencies: [] }, bindings: {}, domains: {},
    claims: { SUPPORTED_TRUE: support(["e:positive"]), SUPPORTED_FALSE: support([], ["e:negative"]), CONFLICTING: support(["e:positive"], ["e:negative"]) },
    constraint: { id: "test", form: "require", expr } };
}
function addDomain(input, id, type, members) {
  const domain = { subject_id: input.subject_id, snapshot_id: input.snapshot_id, scope: input.scope, element_type: type, members };
  domain.content_id = domainContentId(id, domain);
  input.domains[id] = domain;
  input.claims[closureClaimId(domain.content_id)] = support([`closure:${id}`]);
  return domain;
}
function expectFailure(input, completion, code) {
  const result = evaluate(input);
  assert.equal(result.completion, completion, JSON.stringify(result));
  assert.equal(result.diagnostics[0].code, code);
  assert(!Object.hasOwn(result, "constraint_status"));
  assert.notEqual(result.effectful_gate_contribution, "CONTINUE");
  return result;
}
function oracle(mode, data) {
  const child = spawnSync("python3", ["tools/logic_oracle.py", mode], { cwd: root, input: JSON.stringify(data), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("finite quantifiers fold both FDE values and strict statuses for every closed subset", () => {
  for (let mask = 0; mask < 16; mask++) for (const op of ["forall", "exists"]) {
    const members = logic.VALUES.filter((_, i) => mask & (1 << i));
    const input = request(quantifier(op, "claims", "x", claim({ var: "x" })));
    addDomain(input, "claims", "ClaimId", members);
    const result = evaluate(input);
    assert.equal(result.completion, "COMPLETE");
    const all = op === "forall";
    assert.equal(result.expression.information_value, members.reduce(all ? logic.and : logic.or, all ? "SUPPORTED_TRUE" : "SUPPORTED_FALSE"));
    assert.equal(result.constraint_status, members.map(logic.atomicStatus).reduce(all ? logic.strictAll : logic.strictAny, all ? "SATISFIED" : "VIOLATED"));
    assert.equal(result.stats.atoms, members.length);
    assert.equal(result.stats.instantiations, members.length);
    assert.equal(result.observations.length, members.length);
    assert.equal(result.domain_checks.length, 1);
    assert.deepEqual(result.expression.members, members);
  }
});

test("quantification cannot turn unresolved conflict into a strict witness", () => {
  for (const [op, value] of [["forall", "SUPPORTED_FALSE"], ["exists", "SUPPORTED_TRUE"]]) {
    const input = request(quantifier(op, "claims", "x", claim({ var: "x" })));
    addDomain(input, "claims", "ClaimId", ["CONFLICTING", "UNKNOWN"]);
    const result = evaluate(input);
    assert.equal(result.expression.information_value, value);
    assert.equal(result.constraint_status, "CONFLICTING");
    assert.equal(result.effectful_gate_contribution, "DEFER");
    assert.equal(result.observations[0].conflicting_support, true);
  }
});

test("domain closure must have only positive support, including empty domains", () => {
  for (const value of logic.VALUES) for (const members of [[], ["SUPPORTED_TRUE"]]) {
    const input = request(quantifier("forall", "claims", "x", claim({ var: "x" })));
    const domain = addDomain(input, "claims", "ClaimId", members);
    const evidence = value === "UNKNOWN" ? support() : input.claims[value];
    input.claims[closureClaimId(domain.content_id)] = structuredClone(evidence);
    if (value === "SUPPORTED_TRUE") assert.equal(evaluate(input).completion, "COMPLETE");
    else {
      const result = expectFailure(input, "INCOMPLETE_CONTEXT", "DOMAIN_NOT_CLOSED");
      assert.equal(result.domain_checks[0].closure_information_value, value);
      assert.deepEqual(result.domain_checks[0].negative_support_ids, evidence.negative_support_ids);
    }
  }
});

test("content identity binds subject, snapshot, enumeration order, type and members", () => {
  const input = request(quantifier("forall", "numbers", "x", atom("int.le", literal("Int53", 0), { var: "x" })));
  const domain = addDomain(input, "numbers", "Int53", [1, 2]);
  const original = domain.content_id;
  domain.members.pop();
  expectFailure(input, "INVALID", "DOMAIN_HASH_MISMATCH");
  domain.content_id = domainContentId("numbers", domain);
  assert.notEqual(domain.content_id, original);
  // Rehashing a truncated domain cannot reuse a closure claim for the full set.
  expectFailure(input, "INCOMPLETE_CONTEXT", "DOMAIN_NOT_CLOSED");
  domain.snapshot_id = "snapshot:other";
  domain.content_id = domainContentId("numbers", domain);
  expectFailure(input, "INVALID", "DOMAIN_SCOPE_MISMATCH");
  const base = { subject_id: "s", snapshot_id: "snap", scope: "state", element_type: "Int53", members: [1, 2] };
  assert.notEqual(domainContentId("d", base), domainContentId("d", { ...base, members: [2, 1] }));
  assert.notEqual(domainContentId("d", base), domainContentId("other", base));
  assert.notEqual(domainContentId("d", base), domainContentId("d", { ...base, subject_id: "other" }));
  assert.notEqual(domainContentId("d", base), domainContentId("d", { ...base, snapshot_id: "other" }));
  assert.notEqual(domainContentId("d", base), domainContentId("d", { ...base, element_type: "String", members: ["1", "2"] }));
});

test("empty quantifiers still statically reject malformed, untyped and unbound bodies", () => {
  const cases = [
    [{ op: "implies", items: [] }, "UNKNOWN_OPERATOR"],
    [atom("int.le", { var: "x" }, literal("Int53", 1)), "TYPE_MISMATCH"],
    [claim({ var: "outside" }), "UNBOUND_VARIABLE"],
    [atom("int.le", { ref: "state.missing" }, literal("Int53", 1)), "UNBOUND_REFERENCE"],
    [claim(literal("ClaimId", "")), "INVALID_TYPED_VALUE"],
    [claim(literal("String", "x")), "TYPE_MISMATCH"],
    [atom("bool.equal", { call: "eval", args: [] }, literal("Bool2", true)), "UNKNOWN_FUNCTION"],
  ];
  for (const op of ["forall", "exists"]) for (const [body, code] of cases) {
    const input = request(quantifier(op, "empty", "x", body));
    addDomain(input, "empty", "ClaimId", []);
    expectFailure(input, "INVALID", code);
  }
  const missing = request(quantifier("forall", "empty", "x", quantifier("exists", "missing", "y", claim({ var: "y" }))));
  addDomain(missing, "empty", "ClaimId", []);
  expectFailure(missing, "INCOMPLETE_CONTEXT", "MISSING_DOMAIN");
});

test("lexical bindings preserve outer values, do not leak, and reject shadowing", () => {
  const input = request(quantifier("forall", "outer", "n", quantifier("exists", "inner", "m", atom("int.le", { var: "n" }, { var: "m" }))));
  addDomain(input, "outer", "Int53", [0, 2]);
  addDomain(input, "inner", "Int53", [0, 1]);
  const result = evaluate(input);
  assert.equal(result.constraint_status, "VIOLATED");
  assert.deepEqual(result.observations.map(x => x.derivation.arguments), [[0, 0], [0, 1], [2, 0], [2, 1]]);
  assert.equal(new Set(result.observations.map(x => x.path)).size, 4);
  input.constraint.expr.body.binding = "n";
  expectFailure(input, "INVALID", "SHADOWED_BINDING");
  input.constraint.expr = { op: "all", items: [quantifier("forall", "outer", "n", atom("int.le", { var: "n" }, literal("Int53", 3))), atom("int.le", { var: "n" }, literal("Int53", 3))] };
  expectFailure(input, "INVALID", "UNBOUND_VARIABLE");
  input.constraint.expr = { op: "all", items: ["outer", "inner"].map(domain => quantifier("forall", domain, "n", atom("int.le", { var: "n" }, literal("Int53", 3)))) };
  assert.equal(evaluate(input).constraint_status, "SATISFIED");
});

test("domain shape, cardinality, global instantiation and atom budgets are enforced", () => {
  const input = request(quantifier("forall", "claims", "x", claim({ var: "x" })));
  const domain = addDomain(input, "claims", "ClaimId", ["SUPPORTED_TRUE", "SUPPORTED_FALSE"]);
  input.limits = { max_domain_members: 1 };
  expectFailure(input, "INDETERMINATE", "DOMAIN_LIMIT");
  input.limits = { max_instantiations: 1 };
  expectFailure(input, "INDETERMINATE", "INSTANTIATION_LIMIT");
  input.limits = { max_atoms: 1 };
  expectFailure(input, "INDETERMINATE", "RESOURCE_LIMIT");
  delete input.limits;
  domain.members.push("SUPPORTED_TRUE");
  expectFailure(input, "INVALID", "DUPLICATE_MEMBER");
  domain.members = [""];
  expectFailure(input, "INVALID", "INVALID_TYPED_VALUE");
  domain.members = [true];
  expectFailure(input, "INVALID", "INVALID_TYPED_VALUE");
  domain.element_type = "any";
  expectFailure(input, "INVALID", "UNKNOWN_TYPE");

  // No atoms: a separate global instantiation bound must still limit nested work.
  const nested = request(quantifier("exists", "numbers", "x", quantifier("forall", "numbers", "y", { op: "all", items: [] })));
  addDomain(nested, "numbers", "Int53", [0, 1, 2]);
  nested.limits = { max_instantiations: 3 };
  expectFailure(nested, "INDETERMINATE", "INSTANTIATION_LIMIT");
});

test("the API rejects sparse arrays instead of skipping missing operands or support IDs", () => {
  const input = request({ op: "all", items: new Array(1) });
  expectFailure(input, "INVALID", "SPARSE_LIST");
  input.constraint.expr = claim(literal("ClaimId", "SUPPORTED_TRUE"));
  input.claims.SUPPORTED_TRUE.positive_support_ids = new Array(1);
  expectFailure(input, "INVALID", "SPARSE_LIST");
  input.claims.SUPPORTED_TRUE = support(["e:positive"]);
  input.constraint.expr = { op: "atom", predicate: "int.le", args: new Array(2) };
  expectFailure(input, "INVALID", "SPARSE_LIST");
  input.constraint.expr = quantifier("forall", "bad", "x", { op: "all", items: [] });
  input.domains.bad = { subject_id: input.subject_id, snapshot_id: input.snapshot_id, scope: "state", element_type: "Int53", members: new Array(1) };
  expectFailure(input, "INVALID", "SPARSE_LIST");
});

test("profile 0.1 keeps its original vocabulary and rejects 0.2 constructs", () => {
  const input = request(claim(literal("String", "SUPPORTED_TRUE")));
  delete input.domains;
  input.profile = LEGACY_PROFILE; input.vocabulary_id = LEGACY_VOCABULARY_ID;
  assert.equal(evaluate(input).constraint_status, "SATISFIED");
  input.constraint.expr = claim(literal("ClaimId", "SUPPORTED_TRUE"));
  expectFailure(input, "INVALID", "INVALID_TYPED_VALUE");
  input.constraint.expr = { op: "forall", binding: "x", domain: "d", body: { op: "all", items: [] } };
  expectFailure(input, "INVALID", "UNKNOWN_FIELD");
  input.vocabulary_id = VOCABULARY_ID;
  expectFailure(input, "INVALID", "UNSUPPORTED_PROFILE");
});

test("frozen input remains unchanged and domain identity vectors agree with Python", () => {
  const vectors = JSON.parse(readFileSync(new URL("../finite-domain-vectors.json", import.meta.url), "utf8"));
  const actual = vectors.cases.map(({ id, domain }) => domainContentId(id, domain));
  assert.deepEqual(actual, vectors.cases.map(x => x.content_id));
  assert.deepEqual(oracle("--domain-ids", vectors.cases), actual);
  const input = request(quantifier("forall", "claims", "x", claim({ var: "x" })));
  addDomain(input, "claims", "ClaimId", ["SUPPORTED_TRUE"]);
  const before = JSON.stringify(input);
  const freeze = x => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(input);
  assert.deepEqual(evaluate(input), evaluate(input));
  assert.equal(JSON.stringify(input), before);
});

test("Python independently agrees on 384 quantified constraints, including nested guards", () => {
  let seed = 4297, variableIndex = 0;
  const random = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  function generate(depth, variables = []) {
    if (!depth || random(5) === 0) return variables.length && random(2)
      ? { op: "atom", variable: variables[random(variables.length)] }
      : { op: "atom", value: logic.VALUES[random(4)] };
    const choice = random(5);
    if (choice === 0) return { op: "not", expr: generate(depth - 1, variables) };
    if (choice <= 2) {
      const binding = `v${variableIndex++}`;
      const members = [...logic.VALUES];
      for (let i = members.length - 1; i > 0; i--) { const j = random(i + 1); [members[i], members[j]] = [members[j], members[i]]; }
      return { op: choice === 1 ? "forall" : "exists", binding, members: members.slice(0, random(5)), body: generate(depth - 1, [...variables, binding]) };
    }
    return { op: choice === 3 ? "all" : "any", items: Array.from({ length: random(4) }, () => generate(depth - 1, variables)) };
  }
  const cases = Array.from({ length: 384 }, (_, i) => i % 3 === 0
    ? { form: "when_require", activation: generate(4), requirement: generate(4) }
    : { form: i % 3 === 1 ? "require" : "forbid", expr: generate(4) });
  const expected = oracle("--batch", cases);
  let quantifiedCount = 0;
  for (const [index, source] of cases.entries()) {
    const input = request(null);
    function project(node) {
      if (node.op === "atom") return claim(node.variable ? { var: node.variable } : literal("ClaimId", node.value));
      if (node.op === "not") return { op: "not", expr: project(node.expr) };
      if (["forall", "exists"].includes(node.op)) {
        quantifiedCount++;
        const id = `domain:${node.binding}`;
        addDomain(input, id, "ClaimId", node.members);
        return quantifier(node.op, id, node.binding, project(node.body));
      }
      return { op: node.op, items: node.items.map(project) };
    }
    input.constraint = source.form === "when_require" ? { id: `q:${index}`, form: source.form, activation: project(source.activation), requirement: project(source.requirement) }
      : { id: `q:${index}`, form: source.form, expr: project(source.expr) };
    const result = evaluate(input);
    assert.equal(result.completion, "COMPLETE", `case ${index}: ${JSON.stringify(result)}`);
    const actual = { constraint_status: result.constraint_status };
    for (const key of ["expression", "normalized", "activation", "requirement"]) if (result[key]) actual[key] = { information_value: result[key].information_value, strict_status: result[key].strict_status };
    assert.deepEqual(actual, expected[index], `case ${index}`);
  }
  assert(quantifiedCount > 200, "Differential corpus must exercise quantifiers");
});

test("CLI evaluates the finite receipt example and computes its domain identity", () => {
  const sample = "examples/all-receipts.request.json";
  const child = spawnSync(process.execPath, ["bin/aicore.mjs", "evaluate", sample], { cwd: root, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.constraint_status, "UNKNOWN");
  assert.equal(result.effectful_gate_contribution, "DEFER");
  const digest = spawnSync(process.execPath, ["bin/aicore.mjs", "domain-id", sample, "receipts"], { cwd: root, encoding: "utf8" });
  assert.equal(digest.status, 0, digest.stderr);
  const metadata = JSON.parse(digest.stdout);
  assert.equal(metadata.content_id, result.expression.domain_content_id);
  assert.equal(metadata.closure_claim_id, result.domain_checks[0].closure_claim_id);
});
