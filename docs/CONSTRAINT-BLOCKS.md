# Content-addressed constraint Blocks (experimental)

This is a deliberately small implementation experiment for
[RFC-0005](../RFC-0005-semantic-blocks-and-context-projections.md): an
interface-closed subgraph containing state-scoped `Constraint` nodes. It adds
deterministic compact/audit conversion, static dependency checks, Block content
identity, an advisory export slice, and assessment of a caller-pinned contract.
It does not claim full RFC-0005 conformance. Program manifests, cross-Block
bindings, cycles, Transitions, effectful execution, and general Context Bundle
identity/membership proofs remain future work.

## Run the example

```bash
node bin/aicore.mjs block-id examples/review-readiness.block.json
node bin/aicore.mjs expand-block examples/review-readiness.block.json > /tmp/review.audit.json
node bin/aicore.mjs compact-block /tmp/review.audit.json
node bin/aicore.mjs project-block examples/review-readiness.block.json prepare_review
node bin/aicore.mjs assess-block examples/review-readiness.block.json examples/review-readiness.runtime.json examples/review-readiness.authority.json
npm run measure:block
```

The assessment returns `COMPLETE / CONTINUE` for `prepare_review`. Its required
constraints are `ReviewRequested` and `TestsPassed`. A separate `inspect_changes`
export requires `NonNegativeChanges`. Exports are independent contracts; the
caller selects the intended contract in its authority input.

The runtime reuses the [recorded test-evidence fixture](TEST-EVIDENCE.md) from
commit `6028225`, with its 37 passing Node test groups and explicit replay time.
It does not attest to this branch. The review flag and change count are caller
assertions, not signed observations. No command publishes, merges, or performs
an external action.

## Compact boundary and supported nodes

The compact profile is `aicore.constraint-block/0.1`:

```text
{
  profile, block_id,
  imports: {state: {"state.path": "Bool2" | "Int53" | "String"}, claims: [ClaimId...]},
  constraints: {ConstraintId: ConstraintDefinition},
  exports: {ExportId: [ConstraintId...]},
  block_content_id?, annotations?
}
```

Map keys provide stable local identities. Block, constraint, and export IDs use
`[A-Za-z][A-Za-z0-9_-]{0,63}`. A state path starts with `state.` and has at most
256 ASCII characters; subsequent characters are letters, digits, `_`, `.`, or
`-`. Annotations contain only optional `label` and `description` scalar strings,
bounded to 256 and 2,048 UTF-8 bytes respectively. Unknown fields are rejected.

Constraint definitions use the [reference evaluator's](REFERENCE-EVALUATOR.md)
`require`, `forbid`, and `when_require` forms, without a repeated `id` field.
Expressions support `atom`, `not`, `all`, and `any`. Terms support exact typed
literals, explicit state references, and the fixed `bool.not` value function.
Predicates are `int.le`, `string.equal`, `bool.equal`, and `claim.supported`.
The last predicate requires a literal `ClaimId` in the `test-suite.passed:`
namespace. Dynamic claim lookup, finite quantifiers, arbitrary host functions,
and custom vocabularies are outside this initial Block profile; the bare
evaluator retains its existing finite-domain support.

Static checking visits every body and checks its complete type/dependency
boundary before computing identity. Every state reference and claim must be
declared, unused imports are rejected, every constraint must belong to an
export, and every export must require at least one existing constraint. Input
types use exact values without coercion. Imports and export constraint lists
are duplicate-free semantic sets; normalization sorts them. Expression argument
and operand order is preserved.

`forbid(E)` normalizes to `require(not(E))`, including the synthetic negation in
the AST budget. `when_require` stays structural: there is no classical
implication rewrite that could change four-valued or strict constraint results.

## Deterministic expansion and identity

The audit profile is `aicore.constraint-block-audit/0.1`. Expansion restores:

- qualified node identities, `Constraint` kind, and `state` scope;
- typed required input/output ports and each node's exact dependencies;
- sorted state-input, claim-input, and export edges;
- fixed vocabulary, evidence adapter, runtime dependencies, and observation boundary;
- explicit empty effects, capabilities, delegated capabilities, and unresolved dependencies.

These fields are omitted from compact input only because this versioned profile
uniquely determines them. Changing any such audit field is rejected during
compaction. Profiles with variable effects or capabilities would need explicit
semantic fields and a different contract. An annotation cannot add behavior.

For accepted compact input `C`, the codec guarantees:

```text
compactBlock(expandBlock(C)) = normalizeBlock(C)
expandBlock(compactBlock(expandBlock(C))) = expandBlock(C)
```

Equality includes annotations and uses canonical JSON bytes rather than host
object prototypes. Identity excludes annotations and the claimed content ID.
It includes the normalized profile, stable `block_id`, imports, constraints, and
exports. The digest input is:

```text
UTF8("AI-NATIVE-CORE\0BLOCK\0") || UTF8(canonicalJson(normalized semantic compact))
```

Here `\0` denotes one zero byte. SHA-256 is rendered as
`aicore-block-sha256:<64 lowercase hex>`. A supplied ID must exactly match.
Runtime bindings, evidence, time, and trust are excluded from this static identity.
A hash identifies content; it does not establish correctness or authority.

`canonicalJson` implements a restricted
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) compatible domain: null,
booleans, exact Int53 integers excluding negative zero, Unicode scalar strings,
dense arrays, and plain records. It sorts keys by UTF-16 code units, preserves
array order, and performs no Unicode normalization. It rejects floats, undefined,
and host objects rather than claiming a general JSON canonicalizer. CLI input
also rejects duplicate keys, malformed UTF-8, and inexact numeric tokens.

The independent Python oracle checks canonical bytes and Block hashes for valid
normalized inputs, including numeric-looking keys and supplementary Unicode
characters. It is not an independent implementation of Block validation,
dependency closure, or runtime assessment.

## Advisory static export context

`projectBlock(block, exportName, maxBytes = 65536)` returns profile
`aicore.constraint-context/0.1` for the fixed purpose `understand-export`.
It includes all constraints required by that export, their exact state/claim
imports, fixed vocabulary/adapter locators, and the source Block content ID.
Cuts name unrelated constraints and explicitly mark runtime and authority as
still required for assessment.

`COMPLETE` means complete only for this static understanding purpose. It does
not mean a complete runtime, verified evidence, or an execution-ready Context.
The slice has no independent content identity or membership proof. Consumers
must load and recheck the source Block; `assessBlock` rejects a Context slice as
its contract input.

If the entire mandatory static slice exceeds the requested canonical UTF-8 byte
budget, the result is `INCOMPLETE` with `CONTEXT_BUDGET`, required/max byte counts,
and no partial constraint payload. A small failure envelope may exceed an
extremely small requested budget, such as one byte. The requested budget bounds
the successful static slice, not the diagnostic envelope. Nothing silently
drops a mandatory constraint to fit.

## Caller-pinned assessment

API: `assessBlock(block, runtime, authority)`. Both compact and verified audit
Blocks are accepted. The runtime profile is
`aicore.constraint-block-runtime/0.1`, with exactly `profile`, `subject_id`,
`snapshot_id`, `context`, `bindings`, and `evidence`. The authority profile is
`aicore.constraint-block-authority/0.1`, with exactly `profile`,
`block_content_id`, `export_name`, and the caller's `evidence_trust` input.

The application owns the authority input independently of the model. Pinning
both Block content and export prevents a model from dropping a hard constraint,
rehashing the changed Block, or selecting an easier export. The CLI requires a
separate caller-selected authority file and rejects authority on stdin. A file
boundary alone is not isolation: the application must prevent untrusted code
from choosing or editing that file.

All supplied runtime ports must be declared and exactly typed. Missing ports
outside the selected export can be omitted. A missing required port marks its
constraint `INCOMPLETE_CONTEXT / DEFER`; independent constraints are still
assessed. Evidence support comes only from the existing signed test adapter,
using the caller's complete manifest and trust rules. The runtime cannot inject
support sets, trust overrides, constraints, or an export choice.

The result retains individual assessments and has no fabricated overall FDE
value or strict constraint status. Completion precedence is `INVALID`, then
`INDETERMINATE`, then `INCOMPLETE_CONTEXT`, then `COMPLETE`. Gate contributions
combine separately: any known `DENY` dominates, otherwise any `DEFER` defers,
otherwise the contribution is `CONTINUE`. Thus `INCOMPLETE_CONTEXT / DENY` is
valid when another required constraint is already violated. There is no `ALLOW`.
An oversized combined result omits its detailed payload, preserves known denial
and failure classifications, and cannot turn exhaustion into continuation.

CLI exit codes describe completion: `0` for complete assessment/codec success,
`2` for invalid input, and `3` for incomplete or indeterminate results. Read the
gate contribution as well; a complete violated assessment still exits `0`.
For projection, `INCOMPLETE` exits `3`. At most one Block/runtime argument can
use stdin.

## Limits and measured representation size

The initial ceilings are 16 constraints, 8 exports, 8 constraints per export,
32 state inputs, 32 claim imports, 5,000 AST nodes across the whole Block, and
AST depth 32. Compact source is bounded to 1 MiB of canonical bytes; audit input
and assessment output are bounded to 4 MiB. Canonical serialization also limits
structure to 50,000 values and depth 128. Existing evaluator/evidence limits
still apply. These are deterministic implementation ceilings, not a CPU/RSS
sandbox or a claim about production throughput.

`npm run measure:block` reproduces the checked-in
[measurement](../examples/review-readiness.measurement.json). All sizes count
canonical UTF-8 JSON without trailing whitespace, including each representation's
metadata; compact and audit both retain the same annotations and content ID.

| Representation | Constraints | Canonical bytes | Scope |
|---|---:|---:|---|
| Compact Block | 3 | 1,026 | Whole static Block |
| Expanded audit | 3 | 2,782 | Same whole static Block |
| Export context | 2 | 1,249 | Selected export, dependencies, and declared cuts |

Compact is about 63% smaller than audit for this example and round-trips exactly.
The export slice is about 22% larger than the whole compact Block: its metadata
cost exceeds the saving from omitting one small constraint. That is a useful
counterexample to assuming slicing always reduces context. Bytes are not tokens,
and these measurements establish no model comprehension, edit accuracy, or
inference-cost improvement. Larger examples and task-based comparisons remain
necessary before freezing the format.
