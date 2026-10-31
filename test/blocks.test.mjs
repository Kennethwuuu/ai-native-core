import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalJson } from "../src/canonical-json.mjs";
import { normalizeBlock, expandBlock, compactBlock, projectBlock, assessBlock, BLOCK_LIMITS } from "../src/blocks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => JSON.parse(readFileSync(new URL(`../examples/review-readiness.${name}.json`, import.meta.url), "utf8"));
const unpinned = () => { const block = read("block"); delete block.block_content_id; return block; };
function invalid(fn, code) { assert.throws(fn, e => e.completion === "INVALID" && e.code === code); }
const summary = result => [result.completion, result.effectful_gate_contribution];
function python(value, mode = []) {
  const result = spawnSync("python3", ["tools/block_oracle.py", ...mode], { cwd: root, input: JSON.stringify(value), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}

test("compact normalization, expansion and compaction have exact round trips and the same content ID", () => {
  const block = normalizeBlock(read("block")), audit = expandBlock(block);
  assert.deepEqual(compactBlock(audit), block);
  assert.equal(audit.block_content_id, block.block_content_id);
  assert.deepEqual(expandBlock(compactBlock(audit)), audit);
  assert.deepEqual(normalizeBlock(block), block);
  assert.deepEqual(audit.boundary.effects, []);
  assert.deepEqual(audit.boundary.capabilities, []);
  for (const kind of ["claim-input", "state-input", "export"]) assert(audit.edges.some(edge => edge[0] === kind));
});

test("canonical bytes and Block hash agree with an independent Python encoding", () => {
  const compact = normalizeBlock(read("block")), expected = python(compact);
  const semantic = Object.fromEntries(Object.entries(compact).filter(([key]) => !["block_content_id", "annotations"].includes(key)));
  assert.equal(canonicalJson(semantic), expected.canonical_identity_json);
  assert.equal(compact.block_content_id, expected.block_content_id);
  for (const value of [{ "10": 0, "2": 1, "a": true }, { "\ue000": "é", "🐱": "é", "\r": "\u2028", "x": "\u0000" }, [0, -9007199254740991, 9007199254740991, false, null]]) {
    assert.equal(canonicalJson(value), python(value, ["--canonical"]));
  }
});

test("display annotations and map/set order do not change identity; semantic edits do", () => {
  const baseline = read("block"), reordered = structuredClone(baseline);
  reordered.annotations = { label: "Another display name", description: "Another comment" };
  reordered.constraints = Object.fromEntries(Object.entries(reordered.constraints).reverse());
  reordered.imports.state = Object.fromEntries(Object.entries(reordered.imports.state).reverse());
  reordered.exports.prepare_review.reverse();
  assert.equal(normalizeBlock(reordered).block_content_id, baseline.block_content_id);
  for (const mutate of [
    block => { block.block_id = "OtherBlock"; },
    block => { block.constraints.ReviewRequested.expr.args[1].value = false; },
    block => { block.exports.prepare_review = ["ReviewRequested"]; block.exports.inspect_tests = ["TestsPassed"]; },
  ]) {
    const changed = unpinned(); mutate(changed);
    assert.notEqual(normalizeBlock(changed).block_content_id, baseline.block_content_id);
    changed.block_content_id = baseline.block_content_id;
    invalid(() => normalizeBlock(changed), "BLOCK_ID_MISMATCH");
  }
});

test("deterministic audit expansion cannot conceal an effect, capability, dependency or node identity", () => {
  for (const mutate of [
    audit => { audit.boundary.effects = ["payment.charge"]; },
    audit => { audit.nodes.TestsPassed.capabilities = ["publish"]; },
    audit => { audit.nodes.TestsPassed.definition.id = "Other"; },
    audit => { audit.nodes.TestsPassed.evidence_dependencies = []; },
    audit => { audit.edges.pop(); },
    audit => { audit.boundary.evidence_inputs["test-suite.passed:reference-conformance"].required = false; },
  ]) {
    const audit = expandBlock(read("block")); mutate(audit);
    invalid(() => compactBlock(audit), "AUDIT_MISMATCH");
  }
});

test("forbid is canonically normalized to require-not without classical implication rewrites", () => {
  const authored = unpinned(), explicit = unpinned();
  authored.constraints.ReviewRequested.form = "forbid";
  explicit.constraints.ReviewRequested.expr = { op: "not", expr: explicit.constraints.ReviewRequested.expr };
  assert.equal(normalizeBlock(authored).block_content_id, normalizeBlock(explicit).block_content_id);
  const normalized = normalizeBlock(authored);
  assert.equal(normalized.constraints.ReviewRequested.form, "require");
  assert.equal(normalized.constraints.ReviewRequested.expr.op, "not");
});

test("undeclared imports, unused boundaries, unresolved exports and vacuous exports are rejected", () => {
  const missingClaim = unpinned(); missingClaim.imports.claims = [];
  invalid(() => normalizeBlock(missingClaim), "UNDECLARED_CLAIM_IMPORT");
  const missingState = unpinned(); delete missingState.imports.state["state.review_requested"];
  invalid(() => normalizeBlock(missingState), "UNDECLARED_STATE_INPUT");
  const extra = unpinned(); extra.imports.state["state.unused"] = "Bool2";
  invalid(() => normalizeBlock(extra), "UNUSED_IMPORT");
  const unresolved = unpinned(); unresolved.exports.prepare_review.push("Missing");
  invalid(() => normalizeBlock(unresolved), "UNRESOLVED_CONSTRAINT");
  const empty = unpinned(); empty.exports.prepare_review = [];
  invalid(() => normalizeBlock(empty), "EMPTY_EXPORT");
  const orphan = unpinned(); delete orphan.exports.inspect_changes;
  invalid(() => normalizeBlock(orphan), "UNEXPORTED_CONSTRAINT");
});

test("Block definitions preserve types, vocabulary boundaries and exact local identities", () => {
  const wrongType = unpinned(); wrongType.imports.state["state.review_requested"] = "String";
  invalid(() => normalizeBlock(wrongType), "TYPE_MISMATCH");
  const unknown = unpinned(); unknown.constraints.ReviewRequested.expr.predicate = "eval";
  invalid(() => normalizeBlock(unknown), "UNKNOWN_PREDICATE");
  const quantifier = unpinned(); quantifier.constraints.ReviewRequested.expr = { op: "forall", binding: "x", domain: "d", body: { op: "all", items: [] } };
  invalid(() => normalizeBlock(quantifier), "UNKNOWN_FIELD");
  const malformed = unpinned(); malformed.block_id += "\n";
  invalid(() => normalizeBlock(malformed), "INVALID_LOCAL_ID");
  const unsafe = unpinned(); unsafe.effects = ["network.write"];
  invalid(() => normalizeBlock(unsafe), "UNKNOWN_FIELD");
  const sparse = unpinned(); sparse.constraints.ReviewRequested.expr.args = new Array(2);
  invalid(() => normalizeBlock(sparse), "SPARSE_LIST");
  for (const value of [1.01, -0, "\ud800"]) invalid(() => canonicalJson({ x: value }), "INVALID_TYPED_VALUE");
});

test("static export context preserves mandatory dependencies and declares runtime cuts", () => {
  const block = read("block"), context = projectBlock(block, "prepare_review");
  assert.equal(context.completeness, "COMPLETE");
  assert.equal(context.purpose, "understand-export");
  assert.equal(context.source_block_content_id, block.block_content_id);
  assert.deepEqual(Object.keys(context.constraints), ["ReviewRequested", "TestsPassed"]);
  assert.deepEqual(context.imports.state, { "state.review_requested": "Bool2" });
  assert.deepEqual(context.imports.claims, ["test-suite.passed:reference-conformance"]);
  assert(context.cuts.some(cut => cut.kind === "constraint" && cut.id === "NonNegativeChanges"));
  assert(context.cuts.some(cut => cut.kind === "authority" && cut.mandatory_for_assessment));
  const incomplete = projectBlock(block, "prepare_review", 1);
  assert.equal(incomplete.completeness, "INCOMPLETE");
  assert(!Object.hasOwn(incomplete, "constraints"));
  assert(incomplete.budget.required_bytes > incomplete.budget.max_bytes);
});

test("caller-pinned Block and export assess compact/audit representations identically", () => {
  const block = read("block"), runtime = read("runtime"), authority = read("authority");
  const compact = assessBlock(block, runtime, authority);
  assert.deepEqual(summary(compact), ["COMPLETE", "CONTINUE"]);
  assert.deepEqual(assessBlock(expandBlock(block), runtime, authority), compact);
  assert.deepEqual(Object.keys(compact.assessments), ["ReviewRequested", "TestsPassed"]);
  assert.equal(compact.assessments.TestsPassed.evaluation.constraint_status, "SATISFIED");
  assert(!JSON.stringify(compact).includes('"ALLOW"'));
  assert(!Object.hasOwn(compact, "constraint_status"));
});

test("changing hard constraints and rehashing cannot replace the caller's pinned contract", () => {
  const changed = unpinned(); changed.exports.prepare_review = ["ReviewRequested"]; changed.exports.inspect_tests = ["TestsPassed"];
  const block = normalizeBlock(changed), result = assessBlock(block, read("runtime"), read("authority"));
  assert.deepEqual(summary(result), ["INVALID", "DENY"]);
  assert.equal(result.diagnostics[0].code, "BLOCK_AUTHORITY_MISMATCH");
  const runtime = read("runtime"); runtime.export_name = "inspect_changes";
  assert.equal(assessBlock(read("block"), runtime, read("authority")).diagnostics[0].code, "UNKNOWN_FIELD");
});

test("a known violated constraint denies even beside an incomplete evidence dependency", () => {
  const runtime = read("runtime"), authority = read("authority");
  runtime.bindings["state.review_requested"].value = false;
  authority.evidence_trust.keys["local-demo:key-1"].status = "UNKNOWN";
  const result = assessBlock(read("block"), runtime, authority);
  assert.deepEqual(summary(result), ["INCOMPLETE_CONTEXT", "DENY"]);
  assert.equal(result.assessments.ReviewRequested.evaluation.constraint_status, "VIOLATED");
  assert.equal(result.assessments.TestsPassed.completion, "INCOMPLETE_CONTEXT");
});

test("missing input ports defer; wrong types/extra ports deny; unrelated ports can be omitted", () => {
  const block = read("block"), runtime = read("runtime"), authority = read("authority");
  delete runtime.bindings["state.change_count"];
  assert.deepEqual(summary(assessBlock(block, runtime, authority)), ["COMPLETE", "CONTINUE"]);
  delete runtime.bindings["state.review_requested"];
  assert.deepEqual(summary(assessBlock(block, runtime, authority)), ["INCOMPLETE_CONTEXT", "DEFER"]);
  runtime.bindings["state.review_requested"] = { type: "String", value: "true" };
  assert.deepEqual(summary(assessBlock(block, runtime, authority)), ["INVALID", "DENY"]);
  runtime.bindings = { "state.extra": { type: "Bool2", value: true } };
  assert.equal(assessBlock(block, runtime, authority).diagnostics[0].code, "UNDECLARED_RUNTIME_INPUT");
});

test("missing data for one hard constraint cannot hide a known violation in another", () => {
  const block = unpinned(); block.exports.prepare_review.push("NonNegativeChanges");
  const compact = normalizeBlock(block), runtime = read("runtime"), authority = read("authority");
  authority.block_content_id = compact.block_content_id;
  runtime.bindings["state.change_count"].value = -1;
  delete runtime.bindings["state.review_requested"];
  const result = assessBlock(compact, runtime, authority);
  assert.deepEqual(summary(result), ["INCOMPLETE_CONTEXT", "DENY"]);
  assert.equal(result.assessments.NonNegativeChanges.evaluation.constraint_status, "VIOLATED");
  assert.deepEqual(result.assessments.ReviewRequested.missing_inputs, ["state.review_requested"]);
});

test("a Context slice cannot be assessed as an executable contract", () => {
  assert.deepEqual(summary(assessBlock(projectBlock(read("block"), "prepare_review"), read("runtime"), read("authority"))), ["INVALID", "DENY"]);
});

test("static checking preserves guarded constraints, total value calls and empty logical operands", () => {
  const authored = unpinned();
  authored.constraints.ReviewRequested = { form: "when_require",
    activation: { op: "atom", predicate: "bool.equal", args: [{ ref: "state.review_requested" }, { call: "bool.not", args: [{ type: "Bool2", value: false }] }] },
    requirement: { op: "all", items: [{ op: "any", items: [] }, { op: "not", expr: { op: "any", items: [] } }] } };
  const block = normalizeBlock(authored), runtime = read("runtime"), authority = read("authority");
  authority.block_content_id = block.block_content_id;
  const active = assessBlock(block, runtime, authority);
  assert.deepEqual(summary(active), ["COMPLETE", "DENY"]);
  assert.equal(active.assessments.ReviewRequested.evaluation.constraint_status, "VIOLATED");
  runtime.bindings["state.review_requested"].value = false;
  const inactive = assessBlock(block, runtime, authority);
  assert.deepEqual(summary(inactive), ["COMPLETE", "CONTINUE"]);
  assert.equal(inactive.assessments.ReviewRequested.evaluation.constraint_status, "SATISFIED");
  assert.equal(inactive.assessments.ReviewRequested.evaluation.activation.strict_status, "VIOLATED");
});

test("combined diagnostic exhaustion preserves known denial and otherwise defers without a partial payload", () => {
  for (const reject of [true, false]) {
    const authored = unpinned();
    authored.imports = { state: { "state.payload": "String" }, claims: [] };
    authored.constraints = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`C${i}`, { form: "require", expr: {
      op: "atom", predicate: "string.equal", args: [{ ref: "state.payload" }, reject && i === 0 ? { type: "String", value: "different" } : { ref: "state.payload" }],
    } }]));
    authored.exports = { check: Object.keys(authored.constraints) };
    const block = normalizeBlock(authored), runtime = read("runtime"), authority = read("authority");
    runtime.bindings = { "state.payload": { type: "String", value: "x".repeat(600000) } };
    authority.block_content_id = block.block_content_id; authority.export_name = "check";
    const result = assessBlock(block, runtime, authority);
    assert.deepEqual(summary(result), ["INDETERMINATE", reject ? "DENY" : "DEFER"]);
    assert.equal(result.diagnostics[0].code, "DIAGNOSTIC_LIMIT");
    assert(!Object.hasOwn(result, "assessments"));
    assert(Buffer.byteLength(JSON.stringify(result)) < 1024);
  }
});

test("Block limits and frozen-input purity are enforced", () => {
  const large = unpinned();
  large.constraints.ReviewRequested.expr = { op: "all", items: new Array(BLOCK_LIMITS.max_ast_nodes + 1).fill({ op: "all", items: [] }) };
  assert.throws(() => normalizeBlock(large), e => e.completion === "INDETERMINATE" && e.code === "BLOCK_LIMIT");
  const global = unpinned(); global.imports = { state: {}, claims: [] };
  global.constraints = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`C${i}`, { form: "require", expr: {
    op: "all", items: Array.from({ length: 500 }, () => ({ op: "all", items: [] })),
  } }]));
  global.exports = { first: Object.keys(global.constraints).slice(0, 8), second: Object.keys(global.constraints).slice(8) };
  assert.throws(() => normalizeBlock(global), e => e.completion === "INDETERMINATE" && e.code === "BLOCK_LIMIT");
  const block = read("block"), runtime = read("runtime"), authority = read("authority"), before = JSON.stringify([block, runtime, authority]);
  const freeze = x => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(block); freeze(runtime); freeze(authority);
  assert.deepEqual(assessBlock(block, runtime, authority), assessBlock(block, runtime, authority));
  assert.equal(JSON.stringify([block, runtime, authority]), before);
});

test("CLI codecs and the pinned assessment run the review example", () => {
  const run = (args, input) => spawnSync(process.execPath, ["bin/aicore.mjs", ...args], { cwd: root, input, encoding: "utf8" });
  const blockPath = "examples/review-readiness.block.json", expanded = run(["expand-block", blockPath]);
  assert.equal(expanded.status, 0, expanded.stderr);
  const compacted = run(["compact-block", "-"], expanded.stdout);
  assert.equal(compacted.status, 0, compacted.stderr);
  assert.equal(canonicalJson(JSON.parse(compacted.stdout)), canonicalJson(normalizeBlock(read("block"))));
  assert.equal(JSON.parse(run(["block-id", blockPath]).stdout).block_content_id, read("block").block_content_id);
  const context = run(["project-block", blockPath, "prepare_review", "1"]);
  assert.equal(context.status, 3); assert.equal(JSON.parse(context.stdout).completeness, "INCOMPLETE");
  const assessment = run(["assess-block", blockPath, "examples/review-readiness.runtime.json", "examples/review-readiness.authority.json"]);
  assert.equal(assessment.status, 0, assessment.stderr); assert.deepEqual(summary(JSON.parse(assessment.stdout)), ["COMPLETE", "CONTINUE"]);
  assert.equal(run(["assess-block", blockPath, "-", "-"]).status, 2);
});
