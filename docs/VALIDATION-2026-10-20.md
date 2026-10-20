# Constraint Core validation — 2026-10-20

Reviewed baseline: `d0c653cb5894fbc1a81bf8cc110da5be586820e9`.
Follow-up implementation: `aicore.js-reference/0.2.1`.

## Result

The bounded cases below produced no counterexample to the implemented FDE,
strict-status, or finite-quantifier denotation. They did reveal one concrete
resource-control gap: AST and atom limits did not constrain diagnostic expansion.
The follow-up patch fixes that gap and adds persistent regression tests.

This is executable validation of the stated fragment, not a proof of general
correctness, complete RFC-0006 conformance, or evidence authenticity.

## Measured finding: unbudgeted diagnostic expansion

A valid request repeated one supported claim 400 times. The claim had 1,500
eligible support IDs. The request stayed within every declared AST, atom,
depth, and input-size bound, but the baseline copied those IDs into 400 atom
observations: 600,000 diagnostic support references.

| Measurement | Baseline | Follow-up patch |
|---|---:|---:|
| Input bytes | 62,496 | 62,496 |
| Compact result bytes | 11,539,271 | 785 |
| Completion | `COMPLETE` | `INDETERMINATE` |
| Gate contribution | `CONTINUE` | `DEFER` |
| Copied support references before stopping | 600,000 | 9,000 |

The baseline computed the expected logical value; the defect was resource
accounting, not a truth-table error. The result was about 184.64 times the input
size despite using only 801 nodes and 400 atoms.

The implementation now declares two additional ceilings in `diagnostic_limits`:

- 10,000 copied positive/negative support-ID references across atom and closure
  diagnostics, checked before copying/sorting;
- 4 MiB for the compact UTF-8 JSON result, checked incrementally before creating
  a full serialized result string.

Both apply to accepted language profiles `0.1` and `0.2`. The language and
vocabulary profiles retain their meanings; the evaluator and package identities
advance to patch version `0.2.1` to identify the changed resource behavior.

On diagnostic exhaustion, no partial `constraint_status` is returned. Diagnostic
payload omission is explicit under `DIAGNOSTIC_LIMIT`. Oversized failure metadata
may also be omitted, with its original failure code retained as `cause_code`.
An already established `INVALID / DENY` remains `INVALID / DENY`; output limiting
does not weaken it to `DEFER`.

The CLI emits compact evaluation JSON, so its encoding matches the byte budget
(plus the terminating newline). Callers formatting returned API objects with
extra whitespace own that additional display size.

## Verification matrix

| Boundary | Method and corpus | Result |
|---|---|---|
| Four-valued algebra | Original 1,025 exact checks and order/interlacing assertions | Pass |
| Independent algebra | Python set-based oracle, 805 vector/algebra checks | Pass |
| Logical and guarded denotation | 576 JS/Python differential constraints | Agree |
| Finite quantifier denotation | 384 JS/Python differential constraints | Agree |
| Quantifier transformations | All 341 assignments of up to four distinct claim IDs to four support values | De Morgan, alpha renaming, and enumeration reversal preserve results |
| Scope sensitivity | `forall x exists y: x = y` versus `exists y forall x: x = y` on `{0,1}` | Correctly differ |
| Non-explosion/frame property | Add 100 unrelated contradictory claims to an unknown requirement | Remains `UNKNOWN / DEFER` |
| JSON boundary | 2,048 generated valid sources, 2,048 mutations, 28 explicit edge cases, checked against an independent Python native decoder | 4,124 acceptance/value results agree |
| Domain encoding | 256 generated domains plus five fixed identity vectors | JS/Python digests agree |
| Resource boundaries | Exact and first-excess AST, depth, atom, instantiation, support-reference, and byte budgets | Exact boundary accepted; exhaustion deferred |
| Closure and identity | Truncation, rehash with stale closure support, conflicting/negative/unknown closure, subject/snapshot mismatch | Rejected or deferred as specified |
| Empty-domain typing | Unsupported operators, bad argument types, unbound names and missing nested domains under empty quantifiers | No vacuity bypass |
| Input/API edge cases | Sparse arrays, duplicate keys, Unicode, integer rounding, invalid UTF-8, frozen input, and legacy profile checks | Pass |

`npm test` runs 37 JS test groups in addition to the two original standalone
checks. Corpus seeds are fixed in the tests for reproducibility.

## Independent oracles and limits

[The input oracle](../tools/input_oracle.py) uses Python's standard JSON decoder
with native duplicate-key, numeric-token, Unicode, and structural validation. It
imports neither the JS parser nor the evaluator. This checks a different
implementation path from the existing hand-written JS input parser.

[The logic oracle](../tools/logic_oracle.py) independently computes support as
sets and evaluates quantifier folds. Its domain encoding path independently uses
Python JSON and SHA-256. It is not a second complete typed/evidence evaluator.

Remaining limits:

- Evidence eligibility, authentication, freshness, and real-world completeness
  of a domain still depend on the caller's trusted support view.
- Generated and exhaustively bounded cases cannot establish correctness for all
  inputs or all future vocabulary extensions.
- The implementation is state-scoped. No unbounded liveness, general executor,
  capability authorization, or full Program/Block canonicalizer is validated.
- Diagnostic ceilings bound returned payloads and copied support references;
  they are not a general CPU/RSS or wall-clock sandbox. The direct API still
  requires caller-owned input-size limits and JSON-compatible plain data.

## Reproduce

```bash
npm test
node bin/aicore.mjs evaluate examples/all-receipts.request.json
```

The diagnostic-expansion reproduction, byte-limit cases, metamorphic corpus,
JSON differential corpus, and domain-identity corpus are retained in
[adversarial-validation.test.mjs](../test/adversarial-validation.test.mjs).
