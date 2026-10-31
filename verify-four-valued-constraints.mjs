#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const vectorUrl = new URL("./four-valued-constraint-vectors.json", import.meta.url);
const vectors = JSON.parse(await readFile(vectorUrl, "utf8"));
const names = vectors.order;
const strictNames = vectors.strict_status_order;
const bits = new Map(Object.entries(vectors.values));
const nameByBits = new Map(
  [...bits].map(([name, pair]) => [pair.join(","), name]),
);

const pair = (name) => {
  assert(bits.has(name), `unknown value name: ${name}`);
  return bits.get(name);
};

const named = (result) => {
  const name = nameByBits.get(result.join(","));
  assert(name, `invalid result pair: ${result}`);
  return name;
};

const not = (x) => {
  const [t, f] = pair(x);
  return named([f, t]);
};

const binary = {
  and: (x, y) => {
    const [tx, fx] = pair(x);
    const [ty, fy] = pair(y);
    return named([tx & ty, fx | fy]);
  },
  or: (x, y) => {
    const [tx, fx] = pair(x);
    const [ty, fy] = pair(y);
    return named([tx | ty, fx & fy]);
  },
  information_meet: (x, y) => {
    const [tx, fx] = pair(x);
    const [ty, fy] = pair(y);
    return named([tx & ty, fx & fy]);
  },
  information_join: (x, y) => {
    const [tx, fx] = pair(x);
    const [ty, fy] = pair(y);
    return named([tx | ty, fx | fy]);
  },
};

const leInformation = (x, y) => {
  const [tx, fx] = pair(x);
  const [ty, fy] = pair(y);
  return tx <= ty && fx <= fy;
};

const leTruth = (x, y) => {
  const [tx, fx] = pair(x);
  const [ty, fy] = pair(y);
  return tx <= ty && fy <= fx;
};

const atomicStatus = (value) => vectors.atomic_status[value];

const strictNot = (value) => {
  if (value === "SATISFIED") return "VIOLATED";
  if (value === "VIOLATED") return "SATISFIED";
  return value;
};

const strictAll = (left, right) => {
  if (left === "VIOLATED" || right === "VIOLATED") return "VIOLATED";
  if (left === "CONFLICTING" || right === "CONFLICTING") return "CONFLICTING";
  if (left === "UNKNOWN" || right === "UNKNOWN") return "UNKNOWN";
  return "SATISFIED";
};

const strictAny = (left, right) => {
  if (left === "SATISFIED" || right === "SATISFIED") return "SATISFIED";
  if (left === "CONFLICTING" || right === "CONFLICTING") return "CONFLICTING";
  if (left === "UNKNOWN" || right === "UNKNOWN") return "UNKNOWN";
  return "VIOLATED";
};

const whenRequire = (activation, requirement) => {
  if (requirement === "SATISFIED") return "SATISFIED";
  if (activation === "VIOLATED") return "SATISFIED";
  if (activation === "SATISFIED") return requirement;
  if (activation === "UNKNOWN") return "UNKNOWN";
  if (activation === "CONFLICTING") return "CONFLICTING";
  assert.fail(`unhandled activation: ${activation}`);
};

const expectedAtomicStatus = {
  UNKNOWN: "UNKNOWN",
  SUPPORTED_TRUE: "SATISFIED",
  SUPPORTED_FALSE: "VIOLATED",
  CONFLICTING: "CONFLICTING",
};

const expectedConstraintGate = {
  SATISFIED: "CONTINUE",
  VIOLATED: "DENY",
  UNKNOWN: "DEFER",
  CONFLICTING: "DEFER",
};

const expectedCompletionGate = {
  COMPLETE: "USE_CONSTRAINT_STATUS",
  INVALID: "DENY",
  INDETERMINATE: "DEFER",
  INCOMPLETE_CONTEXT: "DEFER",
};

const expectedProperties = [
  "negation_involution",
  "negation_truth_order_reversal",
  "negation_information_order_preservation",
  "truth_lattice_commutativity",
  "truth_lattice_associativity",
  "truth_lattice_idempotence",
  "truth_lattice_absorption",
  "truth_lattice_distributivity",
  "de_morgan",
  "information_lattice_commutativity",
  "information_lattice_associativity",
  "information_lattice_idempotence",
  "information_lattice_absorption",
  "information_lattice_distributivity",
  "bilattice_interlacing",
  "strict_status_negation_involution",
  "strict_status_commutativity",
  "strict_status_associativity",
  "strict_status_de_morgan",
  "strict_status_decisive_witness",
  "strict_status_conflict_preservation",
  "non_explosion_counterexample",
  "excluded_middle_counterexample",
];

let checks = 0;
const checkEqual = (actual, expected, message) => {
  checks += 1;
  assert.equal(actual, expected, message);
};

assert.deepEqual(names, [
  "UNKNOWN",
  "SUPPORTED_TRUE",
  "SUPPORTED_FALSE",
  "CONFLICTING",
]);
assert.deepEqual(strictNames, [
  "UNKNOWN",
  "SATISFIED",
  "VIOLATED",
  "CONFLICTING",
]);
assert.deepEqual(vectors.when_require.requirement_order, strictNames);
assert.equal(vectors.profile, "aicore.constraint-core/0.1");
assert.equal(new Set(nameByBits.keys()).size, 4, "value pairs must be unique");
for (const value of names) {
  assert(pair(value).every((bit) => bit === 0 || bit === 1), `${value} must contain two support bits`);
  assert.equal(pair(value).length, 2, `${value} must contain exactly two support bits`);
}
assert.deepEqual(vectors.atomic_status, expectedAtomicStatus);
assert.deepEqual(vectors.default_effectful_gate.constraint_status, expectedConstraintGate);
assert.deepEqual(vectors.default_effectful_gate.evaluation_completion, expectedCompletionGate);
assert.deepEqual(vectors.designated_for_fde_consequence, ["SUPPORTED_TRUE", "CONFLICTING"]);
assert.deepEqual(vectors.strict_hard_constraint_acceptance, ["SATISFIED"]);
assert.deepEqual(vectors.required_properties, expectedProperties);
assert.deepEqual(vectors.orders.information_cover_relations, [
  ["UNKNOWN", "SUPPORTED_TRUE"],
  ["UNKNOWN", "SUPPORTED_FALSE"],
  ["SUPPORTED_TRUE", "CONFLICTING"],
  ["SUPPORTED_FALSE", "CONFLICTING"],
]);
assert.deepEqual(vectors.orders.truth_cover_relations, [
  ["SUPPORTED_FALSE", "UNKNOWN"],
  ["SUPPORTED_FALSE", "CONFLICTING"],
  ["UNKNOWN", "SUPPORTED_TRUE"],
  ["CONFLICTING", "SUPPORTED_TRUE"],
]);

for (const value of names) {
  checkEqual(not(value), vectors.unary.not[value], `not(${value})`);
}

for (const [operator, implementation] of Object.entries(binary)) {
  for (const left of names) {
    const expectedRow = vectors.binary[operator][left];
    assert.equal(expectedRow.length, names.length, `${operator}.${left} row width`);
    for (const [index, right] of names.entries()) {
      checkEqual(
        implementation(left, right),
        expectedRow[index],
        `${operator}(${left}, ${right})`,
      );
    }
  }
}

for (const value of strictNames) {
  checkEqual(strictNot(value), vectors.strict_unary.not[value], `strict not(${value})`);
}

for (const [operator, implementation] of Object.entries({ all: strictAll, any: strictAny })) {
  for (const left of strictNames) {
    const expectedRow = vectors.strict_binary[operator][left];
    assert.equal(expectedRow.length, strictNames.length, `strict ${operator}.${left} row width`);
    for (const [index, right] of strictNames.entries()) {
      checkEqual(
        implementation(left, right),
        expectedRow[index],
        `strict ${operator}(${left}, ${right})`,
      );
    }
  }
}

for (const activation of strictNames) {
  const expectedRow = vectors.when_require.activation_rows[activation];
  for (const [index, requirement] of strictNames.entries()) {
    checkEqual(
      whenRequire(activation, requirement),
      expectedRow[index],
      `when_require(${activation}, ${requirement})`,
    );
  }
}

for (const value of strictNames) {
  checkEqual(strictNot(strictNot(value)), value, `strict double negation: ${value}`);
  checkEqual(strictAll(value, value), value, `strict all idempotence: ${value}`);
  checkEqual(strictAny(value, value), value, `strict any idempotence: ${value}`);
  for (const other of strictNames) {
    checkEqual(strictAll(value, other), strictAll(other, value), `strict all commutativity: ${value}, ${other}`);
    checkEqual(strictAny(value, other), strictAny(other, value), `strict any commutativity: ${value}, ${other}`);
    checkEqual(strictNot(strictAll(value, other)), strictAny(strictNot(value), strictNot(other)), `strict De Morgan all: ${value}, ${other}`);
    checkEqual(strictNot(strictAny(value, other)), strictAll(strictNot(value), strictNot(other)), `strict De Morgan any: ${value}, ${other}`);
    for (const third of strictNames) {
      checkEqual(strictAll(strictAll(value, other), third), strictAll(value, strictAll(other, third)), `strict all associativity: ${value}, ${other}, ${third}`);
      checkEqual(strictAny(strictAny(value, other), third), strictAny(value, strictAny(other, third)), `strict any associativity: ${value}, ${other}, ${third}`);
    }
  }
}

const AND = binary.and;
const OR = binary.or;
const KMEET = binary.information_meet;
const KJOIN = binary.information_join;

for (const x of names) {
  checkEqual(not(not(x)), x, `double negation: ${x}`);
  checkEqual(AND(x, x), x, `and idempotence: ${x}`);
  checkEqual(OR(x, x), x, `or idempotence: ${x}`);
  checkEqual(KMEET(x, x), x, `information meet idempotence: ${x}`);
  checkEqual(KJOIN(x, x), x, `information join idempotence: ${x}`);

  for (const y of names) {
    checkEqual(AND(x, y), AND(y, x), `and commutativity: ${x}, ${y}`);
    checkEqual(OR(x, y), OR(y, x), `or commutativity: ${x}, ${y}`);
    checkEqual(KMEET(x, y), KMEET(y, x), `k-meet commutativity: ${x}, ${y}`);
    checkEqual(KJOIN(x, y), KJOIN(y, x), `k-join commutativity: ${x}, ${y}`);
    checkEqual(AND(x, OR(x, y)), x, `truth absorption 1: ${x}, ${y}`);
    checkEqual(OR(x, AND(x, y)), x, `truth absorption 2: ${x}, ${y}`);
    checkEqual(KMEET(x, KJOIN(x, y)), x, `knowledge absorption 1: ${x}, ${y}`);
    checkEqual(KJOIN(x, KMEET(x, y)), x, `knowledge absorption 2: ${x}, ${y}`);
    checkEqual(not(AND(x, y)), OR(not(x), not(y)), `De Morgan and: ${x}, ${y}`);
    checkEqual(not(OR(x, y)), AND(not(x), not(y)), `De Morgan or: ${x}, ${y}`);

    if (leInformation(x, y)) {
      assert(leInformation(not(x), not(y)), `not must preserve information order: ${x}, ${y}`);
    }
    if (leTruth(x, y)) {
      assert(leTruth(not(y), not(x)), `not must reverse truth order: ${x}, ${y}`);
    }

    for (const z of names) {
      checkEqual(AND(AND(x, y), z), AND(x, AND(y, z)), `and associativity: ${x}, ${y}, ${z}`);
      checkEqual(OR(OR(x, y), z), OR(x, OR(y, z)), `or associativity: ${x}, ${y}, ${z}`);
      checkEqual(KMEET(KMEET(x, y), z), KMEET(x, KMEET(y, z)), `k-meet associativity: ${x}, ${y}, ${z}`);
      checkEqual(KJOIN(KJOIN(x, y), z), KJOIN(x, KJOIN(y, z)), `k-join associativity: ${x}, ${y}, ${z}`);
      checkEqual(AND(x, OR(y, z)), OR(AND(x, y), AND(x, z)), `truth distributivity 1: ${x}, ${y}, ${z}`);
      checkEqual(OR(x, AND(y, z)), AND(OR(x, y), OR(x, z)), `truth distributivity 2: ${x}, ${y}, ${z}`);
      checkEqual(KMEET(x, KJOIN(y, z)), KJOIN(KMEET(x, y), KMEET(x, z)), `knowledge distributivity 1: ${x}, ${y}, ${z}`);
      checkEqual(KJOIN(x, KMEET(y, z)), KMEET(KJOIN(x, y), KJOIN(x, z)), `knowledge distributivity 2: ${x}, ${y}, ${z}`);
    }
  }
}

for (const operation of Object.values(binary)) {
  for (const a of names) {
    for (const b of names) {
      for (const c of names) {
        if (leInformation(a, b)) {
          assert(leInformation(operation(a, c), operation(b, c)), "bilattice information interlacing");
        }
        if (leTruth(a, b)) {
          assert(leTruth(operation(a, c), operation(b, c)), "bilattice truth interlacing");
        }
      }
    }
  }
}

const designated = new Set(vectors.designated_for_fde_consequence);
const contradiction = AND("CONFLICTING", not("CONFLICTING"));
assert(designated.has(contradiction), "non-explosion premise must be designated");
assert(!designated.has("SUPPORTED_FALSE"), "non-explosion conclusion must not be designated");
checkEqual(
  OR("UNKNOWN", not("UNKNOWN")),
  "UNKNOWN",
  "excluded middle counterexample",
);

checkEqual(vectors.variadic_identities.information_all_empty, "SUPPORTED_TRUE", "information all empty identity");
checkEqual(vectors.variadic_identities.information_any_empty, "SUPPORTED_FALSE", "information any empty identity");
checkEqual(vectors.variadic_identities.strict_all_empty, "SATISFIED", "strict all empty identity");
checkEqual(vectors.variadic_identities.strict_any_empty, "VIOLATED", "strict any empty identity");
checkEqual(strictAny("CONFLICTING", "UNKNOWN"), "CONFLICTING", "strict any preserves unresolved conflict");
checkEqual(strictAll("CONFLICTING", "UNKNOWN"), "CONFLICTING", "strict all preserves unresolved conflict");
checkEqual(strictAny("SATISFIED", "UNKNOWN"), "SATISFIED", "strict any accepts a decisive witness");
checkEqual(strictAll("VIOLATED", "UNKNOWN"), "VIOLATED", "strict all accepts a decisive counterexample");

console.log(`RFC-0006 conformance vectors verified: ${checks} exact checks plus order/interlacing assertions.`);
