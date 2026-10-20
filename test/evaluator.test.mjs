import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as logic from "../src/logic.mjs";
import { evaluate, PROFILE, VOCABULARY_ID, contribution } from "../src/evaluator.mjs";
import { parseInput } from "../src/json-input.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const vectors = JSON.parse(readFileSync(new URL("../four-valued-constraint-vectors.json", import.meta.url), "utf8"));
const lit = (type, value) => ({ type, value });
const atom = (predicate, ...args) => ({ op: "atom", predicate, args });
const claim = (id) => atom("claim.supported", lit("String", id));
const valueExpr = (value) => claim(value);
const requireExpr = (expr) => ({ id: "test", form: "require", expr });
const support = (positive_support_ids = [], negative_support_ids = []) => ({ positive_support_ids, negative_support_ids });
function request(constraint = requireExpr(valueExpr("SUPPORTED_TRUE"))) {
  return { profile: PROFILE, vocabulary_id: VOCABULARY_ID, scope: "state", subject_id: "order:42", snapshot_id: "snapshot:1", evidence_view_id: "eligible-view:1",
    context: { complete: true, missing_dependencies: [] }, bindings: {},
    claims: { SUPPORTED_TRUE: support(["e:positive"]), SUPPORTED_FALSE: support([], ["e:negative"]), CONFLICTING: support(["e:positive"], ["e:negative"]) }, constraint };
}
function invalid(input, completion, code) {
  const result = evaluate(input);
  assert.equal(result.completion, completion, JSON.stringify(result));
  assert.equal(result.diagnostics[0].code, code);
  assert(!Object.hasOwn(result, "constraint_status"));
  assert.notEqual(result.effectful_gate_contribution, "CONTINUE");
  return result;
}

test("production algebra matches every normative unary, binary, strict and guard row", () => {
  assert.deepEqual(logic.VALUES, vectors.order);
  assert.deepEqual(logic.STATUSES, vectors.strict_status_order);
  for (const value of logic.VALUES) {
    assert.equal(logic.not(value), vectors.unary.not[value]);
    assert.equal(logic.atomicStatus(value), vectors.atomic_status[value]);
    for (const other of logic.VALUES) {
      const [t, f] = vectors.values[value], [u, g] = vectors.values[other];
      assert.equal(logic.leInformation(value, other), t <= u && f <= g);
      assert.equal(logic.leTruth(value, other), t <= u && g <= f);
    }
  }
  const operators = { and: logic.and, or: logic.or, information_meet: logic.informationMeet, information_join: logic.informationJoin };
  for (const [op, impl] of Object.entries(operators)) for (const left of logic.VALUES) for (const [i, right] of logic.VALUES.entries()) {
    assert.equal(impl(left, right), vectors.binary[op][left][i]);
  }
  for (const left of logic.STATUSES) {
    assert.equal(logic.strictNot(left), vectors.strict_unary.not[left]);
    for (const [i, right] of logic.STATUSES.entries()) {
      assert.equal(logic.strictAll(left, right), vectors.strict_binary.all[left][i]);
      assert.equal(logic.strictAny(left, right), vectors.strict_binary.any[left][i]);
      assert.equal(logic.whenRequire(left, right), vectors.when_require.activation_rows[left][i]);
    }
  }
});

test("open-world support, denial and conflict retain scoped provenance", () => {
  for (const [value, status] of Object.entries(vectors.atomic_status)) {
    const result = evaluate(request(requireExpr(valueExpr(value))));
    assert.equal(result.completion, "COMPLETE");
    assert.equal(result.expression.information_value, value);
    assert.equal(result.constraint_status, status);
    assert.equal(result.effectful_gate_contribution, vectors.default_effectful_gate.constraint_status[status]);
    assert.equal(result.observations[0].conflicting_support, value === "CONFLICTING");
    assert.deepEqual(result.observations[0].missing_support, value === "UNKNOWN" ? ["NO_ELIGIBLE_SUPPORT"] : []);
    assert.equal(result.subject_id, "order:42");
    assert.equal(result.snapshot_id, "snapshot:1");
  }
});

test("FDE values cannot launder conflict into a strict witness", () => {
  for (const [op, value] of [["any", "SUPPORTED_TRUE"], ["all", "SUPPORTED_FALSE"]]) {
    const result = evaluate(request(requireExpr({ op, items: [valueExpr("CONFLICTING"), valueExpr("UNKNOWN")] })));
    assert.equal(result.expression.information_value, value);
    assert.equal(result.constraint_status, "CONFLICTING");
    assert.equal(result.effectful_gate_contribution, "DEFER");
    assert.equal(result.observations.length, 2);
  }
});

test("strict decisive witnesses preserve all nondecisive diagnostics", () => {
  const result = evaluate(request(requireExpr({ op: "any", items: logic.VALUES.map(valueExpr) })));
  assert.equal(result.constraint_status, "SATISFIED");
  assert.equal(result.observations.length, 4);
  assert.equal(result.observations[0].information_value, "UNKNOWN");
  assert.equal(result.observations[3].conflicting_support, true);
  assert.equal(result.effectful_gate_contribution, "CONTINUE");
  assert(!JSON.stringify(result).includes('"ALLOW"'));
});

test("forbid and guarded requirements use structural status, including inactive guard", () => {
  const forbidden = evaluate(request({ id: "forbid", form: "forbid", expr: valueExpr("CONFLICTING") }));
  assert.equal(forbidden.constraint_status, "CONFLICTING");
  assert.equal(forbidden.normalized.information_value, "CONFLICTING");
  for (const a of logic.VALUES) for (const r of logic.VALUES) {
    const result = evaluate(request({ id: "guard", form: "when_require", activation: valueExpr(a), requirement: valueExpr(r) }));
    assert.equal(result.constraint_status, logic.whenRequire(logic.atomicStatus(a), logic.atomicStatus(r)));
    assert.equal(result.observations.length, 2);
  }
});

test("exact typed predicates and total value functions have explicit derivations", () => {
  const input = request(requireExpr({ op: "all", items: [
    atom("int.le", lit("Int53", 0), { ref: "state.total" }),
    atom("bool.equal", { call: "bool.not", args: [lit("Bool2", false)] }, lit("Bool2", true)),
    atom("string.equal", lit("String", "🐱"), lit("String", "🐱")),
  ] }));
  input.bindings["state.total"] = lit("Int53", 1000);
  const result = evaluate(input);
  assert.equal(result.constraint_status, "SATISFIED");
  assert.equal(result.observations[0].derivation.snapshot_id, input.snapshot_id);
  assert(result.observations[0].derivation.method_id.includes("int.le"));
  assert.equal(evaluate(request(requireExpr({ op: "all", items: [] }))).constraint_status, "SATISFIED");
  assert.equal(evaluate(request(requireExpr({ op: "any", items: [] }))).constraint_status, "VIOLATED");
});

test("no coercion, unbound references, malformed fields or unsupported vocabulary", () => {
  const cases = [
    [atom("int.le", lit("Bool2", true), lit("Int53", 1)), "TYPE_MISMATCH"],
    [atom("int.le", lit("Int53", true), lit("Int53", 1)), "INVALID_TYPED_VALUE"],
    [atom("int.le", lit("Int53", 2 ** 53), lit("Int53", 1)), "INVALID_TYPED_VALUE"],
    [atom("int.le", lit("Int53", -0), lit("Int53", 1)), "INVALID_TYPED_VALUE"],
    [atom("int.le", lit("Int53", 1.1), lit("Int53", 1)), "INVALID_TYPED_VALUE"],
    [atom("int.le", lit("Int53", "1"), lit("Int53", 1)), "INVALID_TYPED_VALUE"],
    [atom("int.le", { ref: "state.missing" }, lit("Int53", 1)), "UNBOUND_REFERENCE"],
    [atom("int.le", { ref: "trace.total" }, lit("Int53", 1)), "INVALID_SCOPE_PATH"],
    [atom("string.equal", lit("String", "\ud800"), lit("String", "")), "INVALID_TYPED_VALUE"],
    [atom("int.le", lit("Int53", 1)), "ARITY_MISMATCH"],
    [atom("eval", lit("String", "process.exit()")), "UNKNOWN_PREDICATE"],
    [atom(["int.le"], lit("Int53", 0), lit("Int53", 1)), "EXPECTED_ID"],
    [atom("bool.equal", { call: ["bool.not"], args: [lit("Bool2", true)] }, lit("Bool2", true)), "EXPECTED_ID"],
    [atom("bool.equal", { call: "eval", args: [] }, lit("Bool2", true)), "UNKNOWN_FUNCTION"],
    [{ op: "implies", items: [] }, "UNKNOWN_OPERATOR"],
    [{ op: "all", items: [], fallback: true }, "UNKNOWN_FIELD"],
    [lit("Bool2", true), "MISSING_FIELD"],
  ];
  for (const [expr, code] of cases) invalid(request(requireExpr(expr)), "INVALID", code);
  const input = request(); input.vocabulary_id = "unknown";
  invalid(input, "INVALID", "UNSUPPORTED_PROFILE");
});

test("invalidity and resource exhaustion cannot be masked by a true branch or inactive guard", () => {
  for (const op of ["all", "any"]) {
    invalid(request(requireExpr({ op, items: [valueExpr("SUPPORTED_TRUE"), { op: "unknown" }] })), "INVALID", "UNKNOWN_OPERATOR");
  }
  invalid(request({ id: "g", form: "when_require", activation: valueExpr("SUPPORTED_FALSE"), requirement: { op: "unknown" } }), "INVALID", "UNKNOWN_OPERATOR");
  const budget = request(requireExpr({ op: "any", items: [valueExpr("SUPPORTED_TRUE"), valueExpr("UNKNOWN")] }));
  budget.limits = { max_atoms: 1 };
  invalid(budget, "INDETERMINATE", "RESOURCE_LIMIT");
  budget.limits = { max_nodes: 1 };
  invalid(budget, "INDETERMINATE", "RESOURCE_LIMIT");
  budget.limits = { max_depth: 1 };
  invalid(budget, "INDETERMINATE", "RESOURCE_LIMIT");
});

test("incomplete Context is separate from an unsupported claim and cannot continue", () => {
  const input = request();
  input.context = { complete: false, missing_dependencies: ["snapshot:missing"] };
  invalid(input, "INCOMPLETE_CONTEXT", "MISSING_DEPENDENCY");
  input.context.complete = true;
  invalid(input, "INVALID", "INVALID_CONTEXT");
});

test("deterministic results preserve input immutability and support IDs", () => {
  const input = request(); input.claims.SUPPORTED_TRUE.positive_support_ids = ["z", "a"];
  const before = JSON.stringify(input);
  const freeze = (x) => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(input);
  const first = evaluate(input), second = evaluate(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first.observations[0].positive_support_ids, ["a", "z"]);
  assert.throws(() => contribution("COMPLETE", "true"), TypeError);
  assert.throws(() => logic.not("false"), TypeError);
  assert.throws(() => logic.fromSupport(1, 0), TypeError);
});

test("strict JSON boundary rejects duplicate keys and malformed JSON", () => {
  for (const source of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":{"y":1,"y":2}}']) {
    assert.throws(() => parseInput(source), (e) => e.code === "DUPLICATE_JSON_KEY");
  }
  for (const source of ['{"x":1,}', '[1,]', 'true false', '{"x":01}', '{"x":NaN}', '{"x":"\\q"}', '\ufeff{}']) {
    assert.throws(() => parseInput(source), (e) => e.completion === "INVALID");
  }
  assert.throws(() => parseInput('{"x":1e999}'), (e) => e.code === "INVALID_JSON_NUMBER");
  for (const token of ["1e0", "1.0", "-0", "1e-400", "1.00000000000000001", "9007199254740990.1", "9007199254740993"]) {
    assert.throws(() => parseInput(`{"x":${token}}`), (e) => e.code === "INVALID_JSON_NUMBER");
  }
  assert.throws(() => parseInput('{"x":"\\ud800"}'), (e) => e.code === "INVALID_UNICODE");
  assert.equal(parseInput('{"emoji":"🐱", "empty": []}').emoji, "🐱");
  const prototype = parseInput('{"__proto__":{"polluted":true}}');
  assert(Object.hasOwn(prototype, "__proto__"));
  assert.equal({}.polluted, undefined);
  invalid(prototype, "INVALID", "MISSING_FIELD");
});

test("CLI reports complete/deferred, invalid, resource and file failures as JSON", () => {
  function cli(args, input) {
    const child = spawnSync(process.execPath, ["bin/aicore.mjs", ...args], { cwd: root, input, encoding: "utf8" });
    assert.equal(child.stderr, "");
    return { code: child.status, result: JSON.parse(child.stdout) };
  }
  const example = cli(["evaluate", "examples/payment-receipt.request.json"]);
  assert.equal(example.code, 0); assert.equal(example.result.constraint_status, "UNKNOWN");
  assert.equal(example.result.effectful_gate_contribution, "DEFER");
  const good = cli(["evaluate", "-"], JSON.stringify(request()));
  assert.equal(good.code, 0); assert.equal(good.result.constraint_status, "SATISFIED");
  assert.equal(cli(["evaluate", "-"], '{"op":').code, 2);
  assert.equal(cli(["evaluate", "missing-file.json"]).result.diagnostics[0].code, "INPUT_ERROR");
  assert.equal(cli([], "").result.diagnostics[0].code, "USAGE");
  const large = cli(["evaluate", "-"], " ".repeat(1024 * 1024 + 1));
  assert.equal(large.code, 3); assert.equal(large.result.completion, "INDETERMINATE");
  assert.equal(cli(["evaluate", "-"], Buffer.from([0xff])).result.diagnostics[0].code, "INVALID_UTF8");
  assert.equal(cli(["evaluate", "-"], "[".repeat(162) + "0" + "]".repeat(162)).code, 3);
});

test("Python independently agrees on 576 nested logical constraints", () => {
  let seed = 94721;
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  function generate(depth) {
    if (!depth || random(4) === 0) return { op: "atom", value: logic.VALUES[random(4)] };
    if (random(3) === 0) return { op: "not", expr: generate(depth - 1) };
    return { op: random(2) ? "all" : "any", items: Array.from({ length: random(4) }, () => generate(depth - 1)) };
  }
  function project(node) {
    if (node.op === "atom") return valueExpr(node.value);
    if (node.op === "not") return { op: "not", expr: project(node.expr) };
    return { op: node.op, items: node.items.map(project) };
  }
  const cases = [];
  for (const a of logic.VALUES) for (const r of logic.VALUES) {
    cases.push({ form: "when_require", activation: { op: "atom", value: a }, requirement: { op: "atom", value: r } });
  }
  for (let i = 0; i < 560; i++) cases.push(i % 3 === 0
    ? { form: "when_require", activation: generate(4), requirement: generate(4) }
    : { form: i % 3 === 1 ? "require" : "forbid", expr: generate(4) });
  const oracle = spawnSync("python3", ["tools/logic_oracle.py", "--batch"], { cwd: root, input: JSON.stringify(cases), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(oracle.status, 0, oracle.stderr);
  const expected = JSON.parse(oracle.stdout);
  assert.equal(expected.length, cases.length);
  const summary = (x) => ({ information_value: x.information_value, strict_status: x.strict_status });
  for (const [i, c] of cases.entries()) {
    const constraint = c.form === "when_require" ? { id: `case:${i}`, form: c.form, activation: project(c.activation), requirement: project(c.requirement) }
      : { id: `case:${i}`, form: c.form, expr: project(c.expr) };
    const result = evaluate(request(constraint));
    assert.equal(result.completion, "COMPLETE", `case ${i}`);
    const actual = { constraint_status: result.constraint_status };
    for (const key of ["expression", "normalized", "activation", "requirement"]) if (result[key]) actual[key] = summary(result[key]);
    assert.deepEqual(actual, expected[i], `case ${i}: ${JSON.stringify(c)}`);
  }
});
