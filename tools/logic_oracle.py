#!/usr/bin/env python3
"""Independent set-based RFC-0006 oracle; standard library only.

Default: verify the published vectors and finite algebraic laws.
--batch: evaluate reduced logical ASTs from JSON on stdin for differential tests.
This oracle does not implement the JS evaluator's type or evidence boundary.
"""
import itertools
import json
from pathlib import Path
import sys

VALUES = {
    "UNKNOWN": frozenset(),
    "SUPPORTED_TRUE": frozenset({"+"}),
    "SUPPORTED_FALSE": frozenset({"-"}),
    "CONFLICTING": frozenset({"+", "-"}),
}
NAMES = {support: name for name, support in VALUES.items()}
ATOMIC = dict(zip(VALUES, ["UNKNOWN", "SATISFIED", "VIOLATED", "CONFLICTING"]))


def negate(x):
    return NAMES[frozenset("-" if s == "+" else "+" for s in VALUES[x])]


def combine(op, left, right):
    x, y = VALUES[left], VALUES[right]
    if op == "information_join":
        support = x | y
    elif op == "information_meet":
        support = x & y
    else:
        positive = all("+" in s for s in (x, y)) if op == "and" else any("+" in s for s in (x, y))
        negative = any("-" in s for s in (x, y)) if op == "and" else all("-" in s for s in (x, y))
        support = frozenset((["+"] if positive else []) + (["-"] if negative else []))
    return NAMES[support]


def strict_not(x):
    return {"SATISFIED": "VIOLATED", "VIOLATED": "SATISFIED"}.get(x, x)


def strict_fold(op, statuses):
    decisive, identity = ("VIOLATED", "SATISFIED") if op == "all" else ("SATISFIED", "VIOLATED")
    if decisive in statuses:
        return decisive
    if "CONFLICTING" in statuses:
        return "CONFLICTING"
    if "UNKNOWN" in statuses:
        return "UNKNOWN"
    return identity


def guarded(a, r):
    # A satisfied requirement and a false activation independently discharge it.
    if r == "SATISFIED" or a == "VIOLATED":
        return "SATISFIED"
    return r if a == "SATISFIED" else a


def expr(node):
    op = node["op"]
    if op == "atom":
        value = node["value"]
        return {"information_value": value, "strict_status": ATOMIC[value]}
    if op == "not":
        child = expr(node["expr"])
        return {"information_value": negate(child["information_value"]), "strict_status": strict_not(child["strict_status"])}
    if op not in ("all", "any"):
        raise ValueError("unsupported oracle operator")
    children = [expr(x) for x in node["items"]]
    value = "SUPPORTED_TRUE" if op == "all" else "SUPPORTED_FALSE"
    for child in children:
        value = combine("and" if op == "all" else "or", value, child["information_value"])
    return {"information_value": value, "strict_status": strict_fold(op, [x["strict_status"] for x in children])}


def constraint(node):
    form = node["form"]
    if form == "when_require":
        activation, requirement = expr(node["activation"]), expr(node["requirement"])
        return {"constraint_status": guarded(activation["strict_status"], requirement["strict_status"]),
                "activation": activation, "requirement": requirement}
    expression = expr(node["expr"])
    result = {"constraint_status": expression["strict_status"], "expression": expression}
    if form == "forbid":
        result["normalized"] = {"information_value": negate(expression["information_value"]), "strict_status": strict_not(expression["strict_status"])}
        result["constraint_status"] = result["normalized"]["strict_status"]
    elif form != "require":
        raise ValueError("unsupported oracle constraint")
    return result


def verify():
    vectors = json.loads((Path(__file__).resolve().parents[1] / "four-valued-constraint-vectors.json").read_text())
    checks = 0

    def equal(actual, expected):
        nonlocal checks
        checks += 1
        if actual != expected:
            raise AssertionError((actual, expected))

    equal(vectors["profile"], "aicore.constraint-core/0.1")
    equal(vectors["order"], list(VALUES))
    equal(vectors["strict_status_order"], list(ATOMIC.values()))
    equal(vectors["values"], {n: [int("+" in v), int("-" in v)] for n, v in VALUES.items()})
    equal(vectors["atomic_status"], ATOMIC)
    equal(vectors["designated_for_fde_consequence"], ["SUPPORTED_TRUE", "CONFLICTING"])
    equal(vectors["strict_hard_constraint_acceptance"], ["SATISFIED"])
    for x in VALUES:
        equal(negate(x), vectors["unary"]["not"][x])
        for op in ("and", "or", "information_meet", "information_join"):
            for i, y in enumerate(VALUES):
                equal(combine(op, x, y), vectors["binary"][op][x][i])
    statuses = list(ATOMIC.values())
    for x in statuses:
        equal(strict_not(x), vectors["strict_unary"]["not"][x])
        for i, y in enumerate(statuses):
            for op in ("all", "any"):
                equal(strict_fold(op, [x, y]), vectors["strict_binary"][op][x][i])
            equal(guarded(x, y), vectors["when_require"]["activation_rows"][x][i])
    equal(expr({"op": "all", "items": []}), {"information_value": vectors["variadic_identities"]["information_all_empty"], "strict_status": vectors["variadic_identities"]["strict_all_empty"]})
    equal(expr({"op": "any", "items": []}), {"information_value": vectors["variadic_identities"]["information_any_empty"], "strict_status": vectors["variadic_identities"]["strict_any_empty"]})
    equal(vectors["default_effectful_gate"]["constraint_status"], {"SATISFIED": "CONTINUE", "VIOLATED": "DENY", "UNKNOWN": "DEFER", "CONFLICTING": "DEFER"})
    equal(vectors["default_effectful_gate"]["evaluation_completion"], {"COMPLETE": "USE_CONSTRAINT_STATUS", "INVALID": "DENY", "INDETERMINATE": "DEFER", "INCOMPLETE_CONTEXT": "DEFER"})
    for x, y, z in itertools.product(VALUES, repeat=3):
        for op in ("and", "or", "information_meet", "information_join"):
            equal(combine(op, combine(op, x, y), z), combine(op, x, combine(op, y, z)))
        equal(negate(combine("and", x, y)), combine("or", negate(x), negate(y)))
        equal(negate(combine("or", x, y)), combine("and", negate(x), negate(y)))
        # Both lattice pairs are monotone in both declared orders.
        truth_le = lambda a, b: ("+" not in VALUES[a] or "+" in VALUES[b]) and ("-" not in VALUES[b] or "-" in VALUES[a])
        for op in ("and", "or", "information_meet", "information_join"):
            if VALUES[x] <= VALUES[y]:
                equal(VALUES[combine(op, x, z)] <= VALUES[combine(op, y, z)], True)
            if truth_le(x, y):
                equal(truth_le(combine(op, x, z), combine(op, y, z)), True)
    # Atomic contradiction is designated but cannot entail an unrelated false q.
    equal(combine("and", "CONFLICTING", negate("CONFLICTING")), "CONFLICTING")
    equal(combine("or", "UNKNOWN", negate("UNKNOWN")), "UNKNOWN")
    print(f"Python independent logic oracle: {checks} checks passed.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--batch"]:
        print(json.dumps([constraint(x) for x in json.load(sys.stdin)]))
    elif sys.argv[1:]:
        raise SystemExit("Usage: logic_oracle.py [--batch]")
    else:
        verify()
