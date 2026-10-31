# Finite-domain constraint experiment

Profile `aicore.reference-evaluator/0.2` implements the optional finite
quantifiers from [RFC-0006 Section 15](../RFC-0006-four-valued-constraint-core.md).
This document fixes the experimental wire representation and its limits.

## A runnable example

```bash
node bin/aicore.mjs evaluate examples/all-receipts.request.json
node bin/aicore.mjs domain-id examples/all-receipts.request.json receipts
```

The first command checks that every receipt in a closed shipment ledger has
eligible acceptance support. One receipt has support; another has none. The
result is `COMPLETE / UNKNOWN`, contributing `DEFER`.

The second command computes the domain's digest and exact closure claim ID. It
does not modify the request, issue closure evidence, or validate that the ledger
is complete in the real world.

## Expression and typing rules

```json
{
  "op": "forall",
  "binding": "receipt",
  "domain": "receipts",
  "body": {
    "op": "atom",
    "predicate": "claim.supported",
    "args": [{"var": "receipt"}]
  }
}
```

Use `exists` for an existential fold. `domain` names a fixed domain in the
request's `domains` map. `binding` is a lexical variable, with a name matching
`[A-Za-z_][A-Za-z0-9_]*`. `{var: name}` is a value term, distinct from a state
reference. Variables do not become propositions through implicit truthiness.

The typing rule for both quantifiers is:

```text
D : FiniteDomain<T> for the exact subject, snapshot, and scope
x is not already bound in Gamma
Gamma, x:T |- body : Proposition
---------------------------------------------------------
Gamma |- ForAll(x, D, body) : Proposition
Gamma |- Exists(x, D, body) : Proposition
```

The complete body is checked before any member is evaluated. Empty domains
therefore cannot conceal unknown operators, type mismatches, missing state
references, missing nested domains, or unbound variables. Shadowing a live
variable is rejected; reusing a name in separate sibling scopes is permitted.
Nested domains are fixed snapshots, not functions of the current binding.

Vocabulary `aicore.reference-vocabulary/0.2` adds `ClaimId`, a nonempty Unicode
scalar string type. `claim.supported` takes `ClaimId`, so its nonempty-ID
precondition is represented by its input type. An arbitrary `String` requires
an explicit future conversion profile; there is no implicit cast. Exact string
comparison still takes `String`.

Profile and vocabulary `0.1` remain accepted together with their original
signatures. They do not accept `ClaimId`, quantifiers, or `domains`. The type
and vocabulary version changes are explicit because registry signatures are
identity-bearing.

## Domain records

Each map entry has these fields:

| Field | Meaning |
|---|---|
| map key | Stable local domain ID |
| `subject_id` | Must equal the request's exact subject |
| `snapshot_id` | Must equal the request's state snapshot |
| `scope` | Must be `state`, matching the request |
| `element_type` | `Bool2`, `Int53`, `String`, or `ClaimId` |
| `members` | Dense, homogeneous, finite enumeration with no duplicate values |
| `content_id` | Verified domain digest |

The domain is a set with an explicitly ordered enumeration. Array order controls
diagnostics and is part of the content identity; reordering requires a new
digest and a closure claim for that digest. No Unicode normalization, sorting,
deduplication, or coercion happens implicitly. Empty sets still declare their
element type.

All supplied domain records are shape-, scope-, type-, cardinality-, and
hash-checked. Closure support is required for every syntactically referenced
domain, including nested domains under an empty outer quantifier. Missing
domains return `INCOMPLETE_CONTEXT`. Invalid records return `INVALID`;
cardinality exhaustion returns `INDETERMINATE`.

## Content identity

The limited primitive domain profile is `aicore.finite-domain/0.1`. It hashes
this ordered tuple:

```text
[domain_id, subject_id, snapshot_id, scope, element_type, members]
```

Encoding is compact JSON with no spaces, exact `Int53` integer tokens, JSON
string escaping of quotes/backslashes/control characters, and UTF-8 encoding
of Unicode scalar strings. Characters outside ASCII are emitted directly;
`/`, U+2028, and U+2029 are not escaped. There are no object-key ordering rules
because the identity projection consists only of arrays and primitive values.

```text
payload = UTF8(compact_json(tuple))
prefix  = UTF8("ai-native-core/finite-domain/0.1") || byte(0)
digest  = SHA256(prefix || payload)
content_id = "aicore-domain-sha256:" || lowercase_hex(digest)
```

The record's `content_id` field is excluded from the projection. Closure support
belongs to the evidence view and is also excluded. The domain identity is
separate from the request's evidence-view identity; every result retains both.

This is not a general JCS canonicalizer or a Program/Block identity under
RFC-0004. The fixed [identity vectors](../finite-domain-vectors.json) cover
integer boundaries, Unicode, control characters, booleans, empty sets, and
claim IDs. JS and Python independently compute the same identities.

The exported `domainContentId(id, domain)` helper validates the record and
computes a digest. The CLI's `domain-id` command uses that helper and accepts
records without an existing `content_id`. An existing digest is ignored by the
hashing utility so callers can calculate a replacement after editing. The
evaluator, in contrast, requires and checks the supplied digest.

## Closed-domain evidence boundary

The required closure proposition has the exact claim ID:

```text
domain.closed:<domain.content_id>
```

Its support comes from the request's already eligible `claims` view. Evaluation
requires precisely `SUPPORTED_TRUE`: at least one positive support ID and no
negative support IDs.

| Closure information | Quantifier handling |
|---|---|
| `SUPPORTED_TRUE` | Continue static checking and bounded evaluation |
| `UNKNOWN` | `INCOMPLETE_CONTEXT` |
| `SUPPORTED_FALSE` | `INCOMPLETE_CONTEXT` |
| `CONFLICTING` | `INCOMPLETE_CONTEXT` |

No non-true closure value is converted into a predicate's false/unknown truth
value or a completed constraint status. `domain_checks` preserves the actual
closure information value and both support sets. Domain closure is a necessary
evaluation precondition, not a logical operand that a decisive witness can
mask. An `exists` witness in an unclosed domain is deferred by this profile.

Content hashing checks integrity; eligible closure support is an additional
requirement. Deleting members without updating the digest is `INVALID`.
Rehashing a truncated domain does not carry the old closure support to the new
digest, so it returns `INCOMPLETE_CONTEXT` until the new closure proposition has
eligible support.

The caller still owns evidence eligibility, authentication, freshness, and the
real-world assertion that this enumeration is complete. The evaluator cannot
establish those facts from caller-authored support IDs. It checks their exact
binding and polarity under the supplied view, not their external trustworthiness.

## Denotation, diagnostics, and bounds

For a well-typed body and a domain whose closure is accepted:

```text
info(ForAll(x, [a1,...,an], P)) = and(info(P[a1/x]), ..., info(P[an/x]))
info(Exists(x, [a1,...,an], P)) = or(info(P[a1/x]), ..., info(P[an/x]))

strict(ForAll(...)) = strict_all(status(P[a1/x]), ..., status(P[an/x]))
strict(Exists(...)) = strict_any(status(P[a1/x]), ..., status(P[an/x]))
```

The empty folds are `T / SATISFIED` for `forall` and `F / VIOLATED` for
`exists`. Conflict preservation and decisive witnesses use the existing
RFC-0006 tables, not classical rewrites. All members are evaluated in declared
order. Results retain member values, domain digest, child results, and unique
member-index diagnostic paths; atom observations retain their original support.

Profile `0.2` performs one bounded static pass and one bounded evaluation pass.
Each pass has its own `max_nodes` allowance, at most 5,000; their counters are
`validation_nodes` and `nodes`. `max_depth` is at most 64, including terms.
`max_atoms` is at most 1,000 actual predicate evaluations. Static checking does
not consult atom support or execute predicate/value methods. It separately
checks closure support as a required domain dependency.

Additional maxima are `max_domain_members: 1000` per domain and
`max_instantiations: 1000` across the whole constraint, including both guarded
branches and all nested quantifiers. Every member binding consumes one
instantiation even if its body has no atoms. Limits may be lowered, never
raised. Any exhausted bound returns `INDETERMINATE` without a partial
`constraint_status`.

The implementation also enforces the shared
[diagnostic output ceilings](REFERENCE-EVALUATOR.md): repeated closure/atom
support cannot expand an otherwise bounded request into an unbudgeted result.

The differential corpus adds 384 quantified constraints to the original 576
logical cases. It includes empty domains, nested bindings, negation, strict
folds, and guarded requirements. Python independently evaluates the denotation
and domain encoding; JS tests separately cover the type, closure, identity,
budget, and CLI boundaries. This remains an executable research fragment, not
a full verification or authorization system.
