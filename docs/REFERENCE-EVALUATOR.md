# Experimental reference evaluator

This is the first executable subset of
[RFC-0006](../RFC-0006-four-valued-constraint-core.md). Its purpose is to test the
constraint semantics against executable counterexamples. It is not a general
executor, an evidence verifier, or a claim of full RFC-0006 conformance.

## Run it

Requirements: Node.js 22 or later; Python 3.12 or later for the independent
oracle and test suite. No package installation is needed.

```bash
npm test
node bin/aicore.mjs evaluate examples/payment-receipt.request.json
node bin/aicore.mjs evaluate examples/all-receipts.request.json
```

The payment example supplies positive capture support but no eligible receipt
support. Its completed result is `UNKNOWN` with a `DEFER` gate contribution.
That missing receipt is an open-world claim, not a negative receipt observation.

To use stdin:

```bash
node bin/aicore.mjs evaluate - < examples/payment-receipt.request.json
```

The CLI emits one JSON result. Exit codes describe evaluation completion:

| Exit | Completion |
|---|---|
| `0` | `COMPLETE`, including a violated or unresolved constraint |
| `2` | `INVALID`, including malformed input or a file read error |
| `3` | `INDETERMINATE` or `INCOMPLETE_CONTEXT` |

Exit `0` is not authorization. Consumers must read both completion and constraint
status. `effectful_gate_contribution` is only `CONTINUE`, `DENY`, or `DEFER`;
`CONTINUE` means that other policy, assurance, and capability checks still need
evaluation. This implementation never returns `ALLOW` or performs an action.

## Supported language

The current wire profile is `aicore.reference-evaluator/0.2`; the original
`0.1` profile remains supported with vocabulary `0.1`. The current profile has a
different identity from the full RFC-0006 semantic profile. Field names remain
experimental.

```text
Term = {type, value}
     | {ref}
     | {call, args: [Term...]}
     | {var}                                  # profile 0.2

Expr = {op: "atom", predicate, args: [Term...]}
     | {op: "not", expr: Expr}
     | {op: "all", items: [Expr...]}
     | {op: "any", items: [Expr...]}
     | {op: "forall", binding, domain, body}   # profile 0.2
     | {op: "exists", binding, domain, body}   # profile 0.2

Constraint = {id, form: "require", expr: Expr}
           | {id, form: "forbid", expr: Expr}
           | {id, form: "when_require", activation: Expr, requirement: Expr}
```

There is no implicit truthiness conversion, general implication, host code,
user-defined registry, or recursion in this subset. Finite quantifiers require
typed, content-identified domains with eligible closure support; see
[the finite-domain profile](FINITE-DOMAINS.md). Unsupported
forms return `INVALID`. Trace, step, graph, and program scopes are deferred;
the current scope must be `state`.

Exact values:

| Type | Domain |
|---|---|
| `Bool2` | JSON `true` or `false` |
| `Int53` | Integers from `-9007199254740991` through `9007199254740991`, excluding negative zero |
| `String` | Unicode scalar strings; no normalization or locale comparison |
| `ClaimId` | Nonempty Unicode scalar strings; vocabulary 0.2 only |

The current fixed vocabulary is `aicore.reference-vocabulary/0.2`:

| ID | Signature | Evaluation |
|---|---|---|
| `int.le` | `(Int53, Int53) -> Proposition` | Exact integer comparison |
| `string.equal` | `(String, String) -> Proposition` | Exact string equality |
| `bool.equal` | `(Bool2, Bool2) -> Proposition` | Exact boolean equality |
| `claim.supported` | `(ClaimId) -> Proposition` | Independent positive and negative eligible support for a claim ID |
| `bool.not` | `(Bool2) -> Bool2` | Total pure value function |

The registry is code-defined and immutable for this profile. Changing a signature
or evaluation method requires a vocabulary version change. `bool.not` computes
an exact value; expression `not` operates on four-valued support and strict
status. They are distinct operations.

Legacy profile/vocabulary `0.1` retains the original `String` argument for
`claim.supported` and runtime rejection of empty IDs. Profile `0.2` represents
that precondition in the `ClaimId` type and checks it statically. Profile and
vocabulary versions must match; neither accepts the other's new types silently.

## Request environment

See the [complete request](../examples/payment-receipt.request.json). All these
fields are mandatory:

| Field | Meaning |
|---|---|
| `profile`, `vocabulary_id` | Exact supported version identities |
| `subject_id` | Semantic subject of this evaluation |
| `snapshot_id` | Identity of the supplied state snapshot |
| `evidence_view_id` | Identity of the caller's already eligible support view |
| `scope` | `state` |
| `context` | Explicit closure marker and missing dependency list |
| `bindings` | Flat map from explicit `state.*` paths to typed exact values |
| `claims` | Map from claim ID to `positive_support_ids` and `negative_support_ids` |
| `constraint` | One named constraint |

Profile `0.2` additionally accepts an optional `domains` map. Referenced domains
must be present, scoped to the same subject and snapshot, content-verified,
typed, and closed under eligible support. Closure claims name the exact domain
digest. The original payment example intentionally remains a `0.1` request;
the finite-receipt example demonstrates `0.2`.

For a complete Context:

```json
{"complete": true, "missing_dependencies": []}
```

For a missing mandatory dependency:

```json
{"complete": false, "missing_dependencies": ["snapshot:missing"]}
```

An absent claim in a declared complete eligible view has no support, so its
value is `UNKNOWN`. An absent required binding is `INVALID`. A missing mandatory
dependency is `INCOMPLETE_CONTEXT`. The closure marker and list must agree.
Snapshot, view, and subject identities are caller assertions in this
experiment; they are not cryptographically authenticated. Finite-domain member
content is hash-checked, but the real-world completeness of a domain still
depends on caller-supplied eligible closure support.

The caller is responsible for evidence eligibility, freshness, provenance
authentication, and subject/polarity normalization under RFC-0002. This module
does not decide whether raw tool output deserves support. Supplying invented
support IDs does not create verified evidence or authority.

Every term reference must exactly match a supplied binding. Paths are not
JavaScript property traversal and cannot read ambient state. Unknown fields,
extra arguments, duplicate support IDs within a polarity, unknown vocabulary,
and type mismatches are rejected.

## Results and evaluation order

Every expression computes both `information_value` and `strict_status`.
`require` uses the strict status. `forbid` also returns a `normalized` negated
result. `when_require` returns separate activation and requirement results and
uses the guarded table from RFC-0006; it has no fabricated implication value.

Compound results retain child results and their diagnostic paths. The
`observations` list preserves each visited atom's support IDs, missing support,
conflict flag, or exact derivation with method and snapshot identity. These are
atom-local observations, not a flattened list claiming to prove the compound
expression. A decisive `T` witness can satisfy `any` while a different child's
conflict remains visible.

All operands are evaluated left to right, including requirements under inactive
guards. No short circuit can mask malformed syntax, invalid types, missing
context, or exhausted resources. On failure, partial observations and counters
remain diagnostic only; no `constraint_status` or partial satisfaction is
returned.

Boundary validation precedes the Context check. Profile `0.2` then runs a
bounded static pass, checking the complete expression tree, lexical types, and
all referenced domain closures before member evaluation. This includes bodies
of empty domains. Profile `0.1` retains its single traversal. The first failure
is returned; this is not an all-errors compiler. An incomplete Context can
defer static checking. Support IDs are sorted, operands retain source order,
and repeated evaluation of the same request has the same output.

## Resource and JSON boundary

Optional `limits` can lower, but cannot raise, the profile maxima:

```json
{"max_depth": 64, "max_nodes": 5000, "max_atoms": 1000, "max_domain_members": 1000, "max_instantiations": 1000}
```

Depth includes both expressions and value terms. Node count includes each term
and expression, with separate static and runtime counters in profile `0.2`.
Atom count includes each evaluated predicate application. Instantiations count
every member binding across all nested quantifiers. The two domain-related
limits apply only to `0.2`. Exceeding any limit produces `INDETERMINATE`, never
a partial truth value.

The CLI accepts at most 1 MiB of valid UTF-8, at most 160 JSON container levels,
and at most 50,000 JSON values. It rejects duplicate object keys (including
escaped spellings), unpaired Unicode surrogates, trailing input, and unknown
semantic fields. All JSON numeric tokens must be exact `Int53` integer tokens.
Decimal, exponent, negative-zero, and out-of-range tokens are rejected before
floating-point parsing can silently round a value. Use future versioned decimal
types rather than approximate numbers for money.

The exported synchronous `evaluate(request)` API expects a JSON-compatible
plain object already parsed without loss or duplicate keys. It does not mutate
the request. The CLI supplies the stricter byte boundary; the API's caller owns
input-size limits and must not pass arbitrary host objects or accessors.

## Verification and limits of the experiment

`npm test` runs:

1. The restored, standalone RFC-0006 checker: 1,025 exact assertions and
   order/interlacing assertions.
2. An independent Python oracle using sets of positive/negative support:
   805 vector and algebra assertions.
3. Tests of the actual JS modules against every published operator/guard row,
   typed predicates, hostile JSON, resource limits, Context failures, provenance,
   and CLI behavior.
4. A fixed-seed differential corpus of 576 nested logical constraints comparing
   both information values and strict statuses with Python.
5. Another 384 quantified constraints, plus domain identity vectors computed
   independently in Python and JS, and boundary tests for closure, scope,
   lexical bindings, empty-domain typing, and resource limits.

The Python oracle independently covers logical/guarded denotation, finite
quantifier folds, and the restricted domain encoding. It does not implement the
JS registry type checker, evidence eligibility, or JSON boundary. Passing these
tests is evidence of agreement on this fragment, not proof of the whole system.
The test runner uses the [Node standard library](https://nodejs.org/api/test.html);
the oracle uses the [Python standard library](https://docs.python.org/3/library/json.html).

Full evidence eligibility, capability checks, general Program/Block canonical
content IDs, temporal properties, execution, compact IR, and token or
correctness benchmarks remain future work. Results are experimental diagnostic
records, not reusable verification attestations under RFC-0004.
