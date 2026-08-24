# AI Native Core

> Few primitives. Clear semantics. Open composition. Verifiable behavior.

AI Native Core is an open-source experiment in designing a **model-agnostic programming semantic core** for AI-assisted and AI-generated software.

The project is not trying to replace Python, TypeScript, Rust, or other implementation languages. Its goal is to define a small, explicit, human-readable semantic layer that AI systems can understand, compose, modify, and verify with minimal ambiguity and minimal hidden context.

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

The current v0.1 discussion starts from four fundamental semantic categories:

- `data` — what exists / what state is represented
- `transform` — pure transformation without external effects
- `action` — an explicit state transition that may affect the outside world
- `rule` — an invariant or predicate that valid programs must preserve

`goal` is currently treated as a desired predicate rather than a mandatory primitive.

## Example

```text

data Order
  id: OrderId
  total: Money
  state: pending | charged | paid

rule NonNegativeTotal
  Order.total >= 0

rule NoDoubleCharge
  one Order -> at_most_one successful Charge

action Charge
  Order.pending -> Order.charged
  effect Payment.write

action Complete
  Order.charged -> Order.paid
  effect Order.write

flow PayOrder =
  Charge >> Complete
```

The point is not the final syntax. The point is that the program exposes its semantic shape directly.

## Repository layout

- `docs/PRINCIPLES.md` — project philosophy and constraints
- `rfcs/RFC-0001-core-model.md` — first semantic-core proposal
- `spec/grammar.ebnf` — intentionally small syntax sketch
- `examples/` — readable examples
- `CONTRIBUTING.md` — how to propose changes

## Status

**Pre-alpha / design phase.**

Nothing in this repository should yet be considered stable. The first milestone is not a compiler. It is a compact semantic model that survives adversarial design review across different AI models, programming paradigms, and real software tasks.

## Open questions

- What is the minimum irreducible primitive set?
- Should `goal` be primitive or derived from predicates?
- Which action-composition operators are truly fundamental?
- What should be canonical: text, typed AST, graph IR, or another representation?
- How should effects and capabilities relate?
- What information should be optimized for AI retrieval and semantic patching?
- How do we benchmark “AI friendliness” across different models?

## License

License selection is intentionally left open during the initial design phase. Apache-2.0 is a strong candidate because it is permissive and includes an explicit patent grant.
