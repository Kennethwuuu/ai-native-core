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

These definitions are a falsifiable research hypothesis, not a stable language standard. See [RFC-0001](rfcs/RFC-0001-core-model.md).

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

## Repository layout

- `docs/PRINCIPLES.md` — project philosophy and constraints
- `docs/RELATED-WORK.md` — prior art and research boundaries
- `rfcs/RFC-0001-core-model.md` — first semantic-core proposal
- `spec/grammar.ebnf` — intentionally small syntax sketch
- `examples/` — readable examples
- `AI Native Core — Foundations v0.1.md` — extended research foundations
- `CONTRIBUTING.md` — how to propose changes

## Status

**Pre-alpha / Phase 0 semantic design.**

Nothing in this repository should yet be considered stable. The first milestone
is not a compiler. It is a compact semantic model that survives adversarial
review across payment workflows, AI-agent tasks, pure computation, concurrency,
and multiple implementation languages.

## Open questions

- Do State, Transition, and Constraint remain sufficient under asynchronous,
  concurrent, and partially observed behavior?
- What constraint language is both verifiable and useful for trace properties?
- Which effect-footprint rules make parallel composition safe?
- What is the smallest explicit capability model?
- How should unknown and conflicting claims propagate?
- What observation boundary defines contract equivalence?
- Can deterministic typed graph IR improve AI retrieval and semantic patching?
- How should AI friendliness be benchmarked across heterogeneous models?

## License

License selection is intentionally left open during the initial design phase. Apache-2.0 is a strong candidate because it is permissive and includes an explicit patent grant.
