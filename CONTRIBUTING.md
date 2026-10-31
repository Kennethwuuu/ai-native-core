# Contributing

AI Native Core is an experimental semantic specification with a small pure
reference evaluator. The RFCs are drafts; implementation scope is documented in
[the evaluator guide](docs/REFERENCE-EVALUATOR.md).

## Local checks

Use Node.js 22+ and Python 3.12+. No dependencies need to be installed.

```bash
npm test
node bin/aicore.mjs evaluate examples/payment-receipt.request.json
npm run measure:block
```

For semantic fixes, include a counterexample that fails before the change and
passes afterward. Logical changes must be checked against the normative vectors
and independent Python oracle. Preserve the separation between unknown support,
invalid input, resource exhaustion, and incomplete Context.

Evidence changes must also preserve the [test-adapter trust boundary](docs/TEST-EVIDENCE.md):
the model's request cannot provide trust anchors, time, or the expected evidence
manifest. An excluded report does not imply negative support, and unknown
verification cannot be hidden by another true expression branch.

Block changes must preserve the [compact/audit contract](docs/CONSTRAINT-BLOCKS.md):
check exact round trips, canonical identity, static boundary closure, and
caller-pinned export requirements. A context budget must never silently remove
a mandatory constraint. Report byte measurements as bytes and retain
counterexamples; token or AI-performance claims require their own evidence.

## Before adding syntax

Please ask:

1. Can the use case already be represented by existing primitives?
2. Is the proposed concept semantic, or merely syntactic convenience?
3. Does it reduce ambiguity for both AI and humans?
4. Can it be verified mechanically?
5. Does it remain model-agnostic?

## RFC process

Substantial semantic changes should begin as an `RFC-NNNN-*.md` at the repository
root, alongside the current RFCs. Experimental implementation details belong in
`docs/`. Do not create a second conflicting RFC tree.

A good RFC should include:

- problem statement,
- proposed semantics,
- examples,
- alternatives considered,
- effect on human readability,
- effect on AI reasoning/context cost,
- verification strategy,
- unresolved questions.

## Current priority

The current priority is to falsify the RFC-0006 constraint semantics with small
executable cases, including typed finite domains, evidence boundaries, and
constraint Block identities. Avoid
a large compiler/runtime stack and do not call constraint satisfaction a full
authorization decision.
