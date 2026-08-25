# Related Work and Research Boundaries

AI Native Core does not begin from a blank theoretical slate. Its working model
combines ideas from formal specification, concurrency models, type-and-effect
systems, capability security, non-classical information logic, and
evidence-bearing verification.

The project's research question is narrower:

> Can these ideas be exposed through one small, model-agnostic semantic IR that
> humans and heterogeneous AI systems can read, compose, patch, verify, and
> refine into ordinary implementations?

This document records the closest foundations and the boundaries of the
project's claims.

## Comparison

| Foundation | Relevant contribution | What AI Native Core adopts | What remains different |
|---|---|---|---|
| TLA+ / Temporal Logic of Actions | Systems described through initial-state predicates, next-state actions, and temporal properties | State-transition relations and state/trace constraints | AI Native Core targets a typed semantic interchange layer, local blocks, explicit effects/capabilities, semantic patching, and implementation refinement |
| Petri nets | Graphical and mathematical models for concurrent, asynchronous, distributed, and nondeterministic systems | Simple transition units, rich topology, multi-input/multi-output behavior, concurrency analysis | The canonical IR is not assumed to use token-flow semantics; typed contracts, unknown meaning, authority, and evidence remain explicit concerns |
| Type-and-effect systems | Static tracking of computational effects and separation of pure from effectful computations | Pure-by-default human forms and machine-visible effect footprints | Effects are integrated with state transitions, graph constraints, capabilities, and external evidence rather than only function types |
| Object-capability security | Explicit authority, least privilege, composable delegation, avoidance of ambient authority | Required capabilities are named on effectful transitions and checked at execution boundaries | RFC-0001 does not yet select a concrete token, object-reference, delegation, or revocation mechanism |
| Belnap–Dunn information logic | Independent support for truth and falsity, allowing incomplete and inconsistent information | `UNKNOWN` and `CONFLICTING` are represented without forcing classical truth; verification is kept separate | Ambiguous candidate meanings, provenance, assurance levels, and execution gates require an AI Native Core-specific knowledge profile |
| Proof-Carrying Code | A producer supplies evidence that a program satisfies a safety policy; the consumer checks that evidence | Verification results are bound to subject, claim, method, verifier, and assumptions | Evidence may include formal proofs, tests, traces, signatures, or external receipts and can apply to semantic transformations as well as code |
| Computability limits / Rice's theorem | Non-trivial semantic properties of arbitrary programs are undecidable in general | Universal semantic hashing and automatic equivalence are rejected | The project uses scoped contracts, restricted profiles, proofs, tests, and evidence-bearing equivalence claims |

## 1. TLA+ and action-based specification

Lamport and collaborators describe a typical TLA+ specification using an
initial-state predicate, a next-state relation, and liveness properties. An
action relates the first and second states of a step.

This strongly supports treating State, Transition, and state/trace Constraint as
the current kernel candidate.

AI Native Core should not reproduce the full TLA+ language. It should determine
whether an AI-oriented typed IR can project selected semantics into TLA+ or a
similar verifier when appropriate.

Primary source:

- Leslie Lamport, John Matthews, Mark Tuttle, and Yuan Yu,
  [Specifying and Verifying Systems with TLA+](https://lamport.azurewebsites.net/pubs/spec-and-verifying.pdf).

## 2. Petri nets and rich topology

Petri nets provide a mature mathematical and graphical model for systems with
concurrency, synchronization, resource flow, nondeterminism, and asynchronous
behavior.

Their bipartite structure is a serious candidate for one projection of the AI
Native Core graph. In particular, a transition consuming multiple typed inputs
and producing multiple outputs can be represented as a transition node with
input and output arcs, avoiding the need for visually awkward hyperedges.

The project should compare at least two canonical graph candidates:

```text
typed attributed hypergraph
typed attributed bipartite transition graph
```

The decision should be based on canonicalization, verification, semantic
neighborhood retrieval, and patch ergonomics rather than visual preference.

Primary source:

- Tadao Murata,
  [Petri Nets: Properties, Analysis and Applications](https://doi.org/10.1109/5.24143),
  Proceedings of the IEEE, 1989.

## 3. Type-and-effect systems

Effect systems demonstrate that purity and possible computational effects can
be tracked explicitly and compositionally. Koka is a concrete research language
whose types distinguish pure and effectful computations and track effect rows.

AI Native Core should reuse this distinction rather than treating every state
transition as an external side effect.

The unresolved research question is whether the minimum IR should describe:

```text
effect names
resource read/write footprints
algebraic operations
or a layered combination
```

Primary source:

- Daan Leijen,
  [Koka: Programming with Row-Polymorphic Effect Types](https://arxiv.org/abs/1406.2061).

## 4. Capability security

A description of possible effects does not grant authority to perform them.
Object-capability research distinguishes explicitly selected authority from
ambient authority and shows how authority relationships can compose.

AI Native Core therefore keeps:

```text
effect != capability
```

The execution boundary should receive an explicit capability set and check it
against the selected transition contract.

Primary source:

- Mark S. Miller, Ka-Ping Yee, and Jonathan S. Shapiro,
  [Capability Myths Demolished](https://classpages.cselabs.umn.edu/Fall-2021/csci5271/papers/SRL2003-02.pdf).

## 5. Incomplete and conflicting information

Belnap–Dunn logic is designed for information that may be incomplete or
inconsistent. Independent support for a proposition and its negation yields four
informational cases, including neither and both.

This is a better starting point than a linear enum that places `UNKNOWN`,
`CONFLICTING`, and `VERIFIED` on one axis.

AI Native Core additionally needs:

- candidate-set ambiguity for unresolved meanings;
- provenance for each supporting claim;
- assurance claims and evidence;
- propagation rules across transitions;
- effect-specific execution gates.

Research bridge:

- [First-order extensions of Belnap–Dunn four-valued logic](https://arxiv.org/abs/2412.19767).

## 6. Proof-carrying verification

Proof-Carrying Code separates an untrusted producer from a consumer that checks
evidence against a safety policy. The important architectural idea is that the
consumer need not trust the producer's assertion of safety.

AI Native Core generalizes this boundary:

```text
AI proposes a semantic object or transaction
        ↓
producer attaches evidence
        ↓
consumer verifies evidence against policy
        ↓
runtime may execute
```

The evidence need not always be a formal proof, but its assurance level and
assumptions must be explicit.

Primary source:

- George C. Necula,
  [Proof-Carrying Code](https://doi.org/10.1145/263699.263712),
  POPL 1997.

## 7. Limits of semantic identity

Rice's theorem places a fundamental limit on deciding non-trivial semantic
properties of arbitrary programs. General program equivalence cannot be reduced
to a universal automatic hash procedure.

The project should therefore use several identities:

```text
content identity
contract identity
implementation identity
scoped equivalence claim + evidence
```

Primary source:

- H. G. Rice,
  [Classes of Recursively Enumerable Sets and Their Decision Problems](https://doi.org/10.1090/S0002-9947-1953-0053041-6),
  Transactions of the American Mathematical Society, 1953.

## 8. Current research novelty claim

AI Native Core should not claim novelty for state machines, constraints,
hypergraphs, effect systems, capabilities, four-valued logic, or
evidence-carrying verification independently.

The candidate contribution is their deliberately small integration around five
requirements:

1. canonical meaning independent of human syntax;
2. explicit preservation of missing and disputed meaning;
3. interface-closed semantic neighborhoods suitable for AI retrieval;
4. semantic graph transactions instead of only textual patches;
5. evidence-bearing refinement into existing languages and runtimes.

This novelty claim must ultimately be supported by working IR, conformance
cases, cross-language refinement, and controlled human/AI benchmarks.
