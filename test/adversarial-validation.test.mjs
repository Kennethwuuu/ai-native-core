import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluate, PROFILE, VOCABULARY_ID, LEGACY_PROFILE, LEGACY_VOCABULARY_ID } from "../src/evaluator.mjs";
import { parseInput } from "../src/json-input.mjs";
import { domainContentId, closureClaimId } from "../src/domains.mjs";
import { assertResultBudget, DIAGNOSTIC_LIMITS } from "../src/diagnostics.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const values = ["UNKNOWN", "SUPPORTED_TRUE", "SUPPORTED_FALSE", "CONFLICTING"];
const atom = (id = "p") => ({ op: "atom", predicate: "claim.supported", args: [{ type: "ClaimId", value: id }] });
const quant = (op, body, binding = "x") => ({ op, domain: "d", binding, body });
const variableAtom = (name = "x") => ({ op: "atom", predicate: "claim.supported", args: [{ var: name }] });
const negate = expr => ({ op: "not", expr });
function request(expr = atom()) {
  return { profile: PROFILE, vocabulary_id: VOCABULARY_ID, subject_id: "s", snapshot_id: "snap", evidence_view_id: "view", scope: "state",
    context: { complete: true, missing_dependencies: [] }, bindings: {}, claims: {},
    constraint: { id: "adversarial", form: "require", expr } };
}
function addDomain(input, members, type = "ClaimId") {
  const domain = { subject_id: input.subject_id, snapshot_id: input.snapshot_id, scope: "state", element_type: type, members };
  domain.content_id = domainContentId("d", domain);
  input.domains = { d: domain };
  input.claims[closureClaimId(domain.content_id)] = { positive_support_ids: ["closure:d"], negative_support_ids: [] };
}
function setValue(input, id, value) {
  input.claims[id] = { positive_support_ids: ["SUPPORTED_TRUE", "CONFLICTING"].includes(value) ? [`+:${id}`] : [],
    negative_support_ids: ["SUPPORTED_FALSE", "CONFLICTING"].includes(value) ? [`-:${id}`] : [] };
}
function summary(input) {
  const result = evaluate(input);
  assert.equal(result.completion, "COMPLETE", JSON.stringify(result));
  return [result.expression.information_value, result.constraint_status, result.effectful_gate_contribution];
}
function independent(mode, data, script = "tools/logic_oracle.py") {
  const child = spawnSync("python3", [script, ...mode], { cwd: root, input: JSON.stringify(data), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
function randomSource(seed) {
  let state = seed;
  return n => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
}

test("repeated evidence cannot expand a 62 KB request into an 11.5 MB result", () => {
  const input = request({ op: "all", items: Array.from({ length: 400 }, () => atom()) });
  input.claims.p = { positive_support_ids: Array.from({ length: 1500 }, (_, i) => `support:${String(i).padStart(8, "0")}`), negative_support_ids: [] };
  assert(Buffer.byteLength(JSON.stringify(input)) < 65000);
  const result = evaluate(input);
  assert.equal(result.completion, "INDETERMINATE");
  assert.equal(result.effectful_gate_contribution, "DEFER");
  assert.equal(result.diagnostics[0].code, "DIAGNOSTIC_LIMIT");
  assert(!Object.hasOwn(result, "constraint_status"));
  assert(result.stats.support_references <= DIAGNOSTIC_LIMITS.max_support_references);
  assert.deepEqual(result.observations, []);
  assert(Buffer.byteLength(JSON.stringify(result)) < 2000);
});

test("exact support-reference ceiling succeeds and its first excess defers", () => {
  const input = request();
  input.claims.p = { positive_support_ids: Array.from({ length: DIAGNOSTIC_LIMITS.max_support_references }, (_, i) => `e:${i}`), negative_support_ids: [] };
  assert.equal(evaluate(input).constraint_status, "SATISFIED");
  input.claims.p.positive_support_ids.push("e:excess");
  assert.equal(evaluate(input).completion, "INDETERMINATE");
});

test("few references with large strings still respect the compact byte ceiling", () => {
  const input = request({ op: "all", items: Array.from({ length: 80 }, () => atom()) });
  input.claims.p = { positive_support_ids: ["e:" + "x".repeat(65536)], negative_support_ids: [] };
  const child = spawnSync(process.execPath, ["bin/aicore.mjs", "evaluate", "-"], { cwd: root, input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(child.status, 3, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.completion, "INDETERMINATE");
  assert.equal(result.diagnostics[0].code, "DIAGNOSTIC_LIMIT");
  assert(result.stats.support_references < DIAGNOSTIC_LIMITS.max_support_references);
  assert(Buffer.byteLength(child.stdout) < 2000);
  assert(!Object.hasOwn(result, "constraint_status"));
});

test("failure-size fallback preserves INVALID/DENY rather than weakening it to DEFER", () => {
  const input = request();
  input.subject_id = "s".repeat(DIAGNOSTIC_LIMITS.max_result_bytes + 1);
  input.constraint.expr = { op: "invalid" };
  const result = evaluate(input);
  assert.equal(result.completion, "INVALID");
  assert.equal(result.effectful_gate_contribution, "DENY");
  assert.equal(result.diagnostics[0].code, "DIAGNOSTIC_LIMIT");
  assert.equal(result.diagnostics[0].cause_code, "UNKNOWN_OPERATOR");
  assert(!Object.hasOwn(result, "subject_id"));
  assert(Buffer.byteLength(JSON.stringify(result)) < 2000);
});

test("compact UTF-8 size accounting is exact, including escaping and nested values", () => {
  for (const sample of [null, true, 17, "🐱\n\u0000\\\"", [], {}, ["é", "é", { "\u2028": [0, false, null] }]]) {
    const bytes = Buffer.byteLength(JSON.stringify(sample));
    assert.equal(assertResultBudget(sample, bytes), bytes);
    assert.throws(() => assertResultBudget(sample, bytes - 1), e => e.code === "DIAGNOSTIC_LIMIT");
  }
});

test("legacy 0.1 requests also respect implementation diagnostic ceilings", () => {
  const input = request({ op: "all", items: Array.from({ length: 20 }, () => ({ op: "atom", predicate: "claim.supported", args: [{ type: "String", value: "p" }] })) });
  input.profile = LEGACY_PROFILE; input.vocabulary_id = LEGACY_VOCABULARY_ID;
  input.claims.p = { positive_support_ids: Array.from({ length: 1000 }, (_, i) => `e:${i}`), negative_support_ids: [] };
  assert.equal(evaluate(input).completion, "INDETERMINATE");
});

test("quantifier De Morgan, alpha renaming and reordering hold for all 341 valuations of up to four members", () => {
  let count = 0;
  for (let size = 0; size <= 4; size++) for (let encoding = 0; encoding < 4 ** size; encoding++) {
    const members = Array.from({ length: size }, (_, i) => `p:${i}`);
    const input = request();
    let digits = encoding;
    for (const id of members) { setValue(input, id, values[digits % 4]); digits = Math.floor(digits / 4); }
    addDomain(input, members);
    for (const [op, dual] of [["forall", "exists"], ["exists", "forall"]]) {
      input.constraint.expr = negate(quant(op, variableAtom()));
      const left = summary(input);
      input.constraint.expr = quant(dual, negate(variableAtom()));
      assert.deepEqual(summary(input), left);
    }
    input.constraint.expr = quant("forall", variableAtom());
    const original = summary(input);
    input.constraint.expr = quant("forall", variableAtom("renamed"), "renamed");
    assert.deepEqual(summary(input), original);
    addDomain(input, [...members].reverse());
    assert.deepEqual(summary(input), original);
    count++;
  }
  assert.equal(count, 341);
});

test("quantifier nesting order is not silently interchanged", () => {
  const ref = name => ({ var: name });
  const le = (a, b) => ({ op: "atom", predicate: "int.le", args: [ref(a), ref(b)] });
  const equal = { op: "all", items: [le("x", "y"), le("y", "x")] };
  const input = request(quant("forall", quant("exists", equal, "y")));
  addDomain(input, [0, 1], "Int53");
  assert.equal(evaluate(input).constraint_status, "SATISFIED");
  input.constraint.expr = quant("exists", quant("forall", equal), "y");
  assert.equal(evaluate(input).constraint_status, "VIOLATED");
});

test("unrelated contradictions cannot change an unresolved required claim", () => {
  const input = request(atom("target"));
  const original = summary(input);
  for (let i = 0; i < 100; i++) setValue(input, `unrelated:${i}`, "CONFLICTING");
  input.bindings["state.unrelated"] = { type: "Bool2", value: true };
  assert.deepEqual(summary(input), original);
  assert.deepEqual(original, ["UNKNOWN", "UNKNOWN", "DEFER"]);
});

test("AST, atom and instantiation budgets accept their exact boundary and reject the first excess", () => {
  const input = request(quant("forall", variableAtom()));
  addDomain(input, ["a", "b", "c"]);
  for (const id of ["a", "b", "c"]) setValue(input, id, "SUPPORTED_TRUE");
  input.limits = { max_nodes: 7, max_atoms: 3, max_instantiations: 3, max_depth: 3 };
  const result = evaluate(input);
  assert.equal(result.completion, "COMPLETE");
  assert.equal(result.stats.nodes, 7);
  assert.equal(result.stats.validation_nodes, 3);
  assert.equal(result.stats.atoms, 3);
  assert.equal(result.stats.instantiations, 3);
  for (const key of ["max_nodes", "max_atoms", "max_instantiations", "max_depth"]) {
    const reduced = structuredClone(input); reduced.limits[key]--;
    assert.equal(evaluate(reduced).completion, "INDETERMINATE", key);
  }
});

test("4096 generated JSON sources plus explicit edge cases agree with the independent Python decoder", () => {
  const random = randomSource(93211);
  const strings = ["", "🐱", "é", "é", "\u0000", "\b", "\t", 'quote"', "\\", "line\n", "\u2028", "\u2029", "__proto__"];
  function value(depth) {
    const choice = random(depth ? 6 : 4);
    if (choice === 0) return null;
    if (choice === 1) return Boolean(random(2));
    if (choice === 2) return [-9007199254740991, -42, 0, 17, 9007199254740991][random(5)];
    if (choice === 3) return strings[random(strings.length)];
    if (choice === 4) return Array.from({ length: random(5) }, () => value(depth - 1));
    const object = Object.create(null);
    for (let i = 0; i < random(5); i++) object[strings[random(strings.length)] + i] = value(depth - 1);
    return object;
  }
  const valid = Array.from({ length: 2048 }, () => JSON.stringify(value(4), null, random(3) === 0 ? 2 : 0));
  const mutationChars = ["]", "}", ",", ":", "-", "0", "x", '"', "\\", "\u0000", "\n", "\ud800"];
  const mutants = valid.map(source => {
    const offset = random(source.length + 1), operation = random(3), ch = mutationChars[random(mutationChars.length)];
    return source.slice(0, offset) + (operation === 0 ? "" : ch) + source.slice(offset + (operation === 1 ? 0 : 1));
  });
  const edges = ['', '{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":1.0}', '1e0', '-0', '1e-400', '9007199254740993', '1.00000000000000001', 'NaN', 'Infinity', '[1,]', '[1,,2]', 'true false', '{"x":"\\ud800"}', '{"x":"\\udc00"}', '"\\ud83d\\udc31"', '{"__proto__":{"x":1}}', '\ufeff{}', '{"x":01}', '"\\u0000"', '"\\u2028"', 'null', 'false', '[]', '{}', '{"x":-9007199254740991}', '{"x":9007199254740991}'];
  const sources = [...valid, ...mutants, ...edges];
  const expected = independent([], sources, "tools/input_oracle.py");
  let accepted = 0, rejected = 0;
  for (const [i, source] of sources.entries()) {
    let actual;
    try { actual = { accepted: true, value: JSON.parse(JSON.stringify(parseInput(source))) }; }
    catch (error) { assert(["INVALID", "INDETERMINATE"].includes(error.completion)); actual = { accepted: false }; }
    assert.deepEqual(actual, expected[i], `source ${i}: ${JSON.stringify(source)}`);
    if (actual.accepted) accepted++; else rejected++;
    if (i < valid.length) assert(actual.accepted);
  }
  assert(accepted >= 2048 && rejected > 1000);
});

test("256 generated domain identities agree with Python across all supported primitive types", () => {
  const random = randomSource(81191), cases = [];
  const strings = ["", "🐱", "é", "é", "\u2028", "\u2029", "\u0085", '"', "\\", ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i))];
  for (let i = 0; i < 256; i++) {
    const type = ["Bool2", "Int53", "String", "ClaimId"][i % 4];
    let members;
    if (type === "Bool2") members = [false, true].filter(() => random(2));
    else if (type === "Int53") members = [...new Set([-9007199254740991, 9007199254740991, 0, random(1000000) - 500000])].slice(0, random(5));
    else members = [...new Set(Array.from({ length: random(6) }, () => (type === "ClaimId" ? "id:" : "") + strings[random(strings.length)]))];
    cases.push({ id: `domain:${i}:🐱`, domain: { subject_id: "subject:é", snapshot_id: `snapshot:${i}`, scope: "state", element_type: type, members } });
  }
  assert.deepEqual(cases.map(x => domainContentId(x.id, x.domain)), independent(["--domain-ids"], cases));
});
