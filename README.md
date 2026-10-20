# AI Native Core

> Few primitives. Clear semantics. Open composition. Verifiable behavior.

AI Native Core is an open-source experiment in designing a **model-agnostic programming semantic core** for AI-assisted and AI-generated software.

The project is not trying to replace Python, TypeScript, Rust, or other implementation languages. Its goal is to define a small, explicit, human-readable semantic layer that AI systems can understand, compose, modify, and verify with minimal ambiguity and minimal hidden context.

> **AI Native Core is a minimal, model-agnostic semantic IR that represents software as typed, constrained state transitions, enabling humans and AI to compose, verify, and implement behavior without inventing missing meaning.**

## Why

Most programming languages were designed primarily for human authors and conventional compilers. AI systems can read them, but they still spend substantial effort reconstructing implicit state, side effects, invariants, permissions, and cross-file dependencies.

AI Native Core asks a different question:

> What is the smallest set of explicit programming primitives that lets humans and AI describe software behavior clearly, compose it openly, and verify it reliably?

## Design goals

1. **Model-agnostic** — no syntax or semantics optimized for one vendor, model, tokenizer, or agent framework.
2. **Human-readable** — a developer should understand the intent and state transitions without learning a large language.
3. **Few primitives** — the semantic core should remain intentionally small and stable.
4. **Explicit semantics** — inputs, outputs, state transitions, effects, and invariants should be visible rather than inferred.
5. **Open composition** — new behavior should emerge from composing stable primitives, not by endlessly adding special-case keywords.
6. **Verifiable behavior** — programs should expose enough structure for static checking, testing, and formal verification.
7. **Implementation-language neutral** — the semantic layer should be able to target or interoperate with existing languages and runtimes.
8. **Open source and open specification** — the core language, IR, tests, and benchmark should remain public.

## Working semantic core

The current Phase 0 hypothesis uses three kernel concepts:

- `State` — a typed, possibly partial description of what may be true;
- `Transition` — a named typed relation between possible before and after states;
- `Constraint` — a validity condition over a state, step, trace, or semantic graph.

Human-facing forms are derived from this kernel:

- `data` — a state or value schema;
- `transform` — a transition with no observable external effect;
- `action` — an effectful transition;
- `rule` — a named constraint;
- `goal` — a desired state or trace constraint;
- `flow` — transition composition;
- `block` — an interface-closed semantic subgraph.

These definitions are a falsifiable research hypothesis, not a stable language standard. See [RFC-0001](RFC-0001-core-model.md).

## Run the first executable experiment

The reference evaluator implements a small typed subset of
[RFC-0006](RFC-0006-four-valued-constraint-core.md). It keeps four-valued logical
support separate from strict constraint status, evaluation completion, and
execution policy.

With Node.js 22+ and Python 3.12+ installed, no package installation is needed:

```bash
npm test
node bin/aicore.mjs evaluate examples/payment-receipt.request.json
node bin/aicore.mjs evaluate examples/all-receipts.request.json
```

The payment example returns `COMPLETE`, constraint `UNKNOWN`, and gate
contribution `DEFER`: capture is supported, but an accepted receipt has no
eligible support yet. The evaluator does not execute a payment or authorize an
action. Its only gate contributions are `CONTINUE`, `DENY`, and `DEFER`.

See the [reference evaluator guide](docs/REFERENCE-EVALUATOR.md) for the typed
vocabulary, request format, limits, diagnostics, and cross-language test scope.
Profile `0.2` adds [finite-domain quantifiers](docs/FINITE-DOMAINS.md): complete
body type checking, lexical bindings, content-verified domains, and closure
support tied to each exact domain digest. Profile `0.1` requests still work.
The [validation report](docs/VALIDATION-2026-10-20.md) records independent and
adversarial checks, including a fixed diagnostic-expansion defect and its
resource ceilings.

## Example

```text
data Order
  id: OrderId
  total: Money
  status: pending | paid

rule NonNegativeTotal
  Order.total >= 0

rule AtMostOneSuccessfulCharge trace
  successful_charge(Order.id) <= 1

action SubmitCharge
  in
    Order.pending

  outcomes
    succeeded(Receipt)
    declined(Reason)
    unknown(AttemptId)

  effects
    PaymentGateway.charge

  capabilities
    payment.charge

  preserves
    AtMostOneSuccessfulCharge
```

The point is not the final syntax. The point is that success, failure, unknown
outcomes, effects, authority, and preserved constraints are visible before an
implementation is chosen.

## Specification and implementation

| File | Purpose |
|---|---|
| [RFC-0001](RFC-0001-core-model.md) | State, Transition, Constraint, and closed Block boundaries |
| [RFC-0002](RFC-0002-knowledge-and-evidence.md) | Knowledge, evidence, eligibility, and execution gates |
| [RFC-0003](RFC-0003-composition-concurrency-failure.md) | Composition, concurrency, uncertain outcomes, and compensation |
| [RFC-0004](RFC-0004-canonical-ir-and-deterministic-encoding.md) | Canonical IR and deterministic encoding |
| [Phase 0 retrospective](PHASE-0-RETROSPECTIVE.md) | Critique of representation growth and layered context |
| [RFC-0005](RFC-0005-semantic-blocks-and-context-projections.md) | Semantic Blocks, layered IR, and Context projections |
| [RFC-0006](RFC-0006-four-valued-constraint-core.md) | Four-valued information logic and typed constraints |
| [Reference evaluator](docs/REFERENCE-EVALUATOR.md) | Executable subset, wire profile, and limitations |
| [Related work](RELATED-WORK.md) | Prior art and research boundaries |

`src/` contains the pure JS logic, evaluator, and strict JSON boundary; `bin/`
contains the CLI. `test/` contains integration and differential tests, and
`tools/logic_oracle.py` independently checks the logical layer. The original
standalone checker remains `verify-four-valued-constraints.mjs` at the root.

The root `.aicore` examples are provisional human projections; the CLI accepts
the JSON request under `examples/`, not that unfinished surface syntax. The
Foundations v0.1 document is historical context; later RFCs amend it.

## Status

**Pre-alpha / Phase 1 reference constraint experiment.**

Nothing in this repository should yet be considered stable. The executable
subset supports state-scoped typed predicates, four-valued expressions, three
constraint forms, finite closed-domain quantifiers, and bounded evaluation. It does not yet implement a full
verifier, canonicalizer, parser for `.aicore`, or general runtime. Python/JS
differential agreement covers the logical layer, quantifier denotation, and
restricted domain identities; evidence eligibility remains caller-supplied.

## Open questions

- Do State, Transition, and Constraint remain sufficient under asynchronous,
  concurrent, and partially observed behavior?
- Can the bounded constraint fragment express useful finite-trace properties?
- Which effect-footprint rules make parallel composition safe?
- What is the smallest explicit capability model?
- How should evidence eligibility and provenance connect to the executable fragment?
- What observation boundary defines contract equivalence?
- Can deterministic typed graph IR improve AI retrieval and semantic patching?
- How should AI friendliness be benchmarked across heterogeneous models?

## License

License selection is intentionally left open during the initial design phase. Apache-2.0 is a strong candidate because it is permissive and includes an explicit patent grant.
