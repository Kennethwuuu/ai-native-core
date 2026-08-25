# RFC-0001: Minimal Semantic Core

- Status: Draft
- Version: 0.2
- Type: Foundational
- Discussion target: Phase 0 semantic-core review

## Abstract

This RFC proposes a minimal semantic kernel for AI Native Core:

```text
STATE
TRANSITION
CONSTRAINT
```

The proposal is intentionally representational rather than syntactic. It does
not claim that these three concepts are the smallest possible mathematical
axioms. It claims that they are a candidate for the smallest **useful and
reviewable semantic interface** through which humans, AI systems, verifiers,
and runtimes can exchange executable meaning.

Human-facing forms such as `data`, `transform`, `action`, `rule`, `goal`, and
`flow` are derived projections over the kernel. A Semantic Block is a bounded
subgraph with an explicit contract; it is not a fourth kernel primitive.

The RFC also defines minimum requirements for effects, capabilities, unknown
information, evidence, composition, identity, and canonical serialization. A
payment workflow is used as the first adversarial validation case.

## 1. Decision proposed

Adopt the following as the Phase 0 working hypothesis:

```text
Core = (S, T, C)

S = possible typed states
T = named typed transition relations
C = constraints over states, steps, traces, or semantic graphs
```

Adoption means that subsequent RFCs and examples MUST first attempt to express
new concepts as compositions or scoped forms of `S`, `T`, and `C` before
proposing another primitive.

Adoption does not make the hypothesis permanent. Section 16 defines conditions
that would falsify it.

## 2. Scope

This RFC defines:

- the denotation of State, Transition, and Constraint;
- the minimum contract of an executable transition;
- how human semantic forms derive from the kernel;
- the boundary rule for Semantic Blocks;
- the distinction between effects and capabilities;
- the minimum treatment of unknown and conflicting information;
- the initial meaning of composition operators;
- identity and evidence requirements;
- requirements for a future canonical IR.

This RFC does not define:

- a final surface syntax;
- a parser or compiler implementation;
- a complete type theory;
- a full temporal logic;
- an effect-handler language;
- an authorization runtime;
- a universal procedure for proving program equivalence;
- a general-purpose virtual machine.

## 3. Normative language

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY describe requirements of
this proposal.

Examples use a provisional human projection. Their whitespace and keywords are
non-normative unless stated otherwise.

## 4. Semantic kernel

### 4.1 State

A **State** is a typed description of what may be true at one semantic instant.

A state MAY be partial. Missing information MUST remain missing; it MUST NOT be
completed with a plausible value merely to make a transition executable.

Conceptually:

```text
s in S
```

where `S` is the set of states permitted by the program's schemas and
constraints.

A state is not the same thing as a schema:

```text
Order.state: pending | paid      # schema
Order.state = pending            # state claim
```

State may include:

- typed values;
- resource identities;
- lifecycle states;
- observations about an external system;
- explicit unknown or conflicting claims;
- provenance references.

State MUST NOT imply global mutability. A pure computation may use input and
output states without changing any externally observable resource.

### 4.2 Transition

A **Transition** is a named, typed relation between possible before and after
states.

It is a relation rather than necessarily a deterministic function because one
valid input may permit multiple valid outcomes.

For a transition `t`:

```text
[[t]] subseteq (S x I_t) x (S x O_t x E_t*)
```

where:

- `S` is the state space;
- `I_t` is the explicit input space;
- `O_t` is the explicit output space;
- `E_t*` is a finite sequence of observable events associated with the step.

`E_t*` records semantic observations such as a payment request or receipt. It
does not require the canonical IR to store raw runtime logs.

A transition MUST expose all outcomes that can materially change subsequent
behavior. Failure, timeout, cancellation, and indeterminate external results
MUST NOT be hidden behind an assumed success path.

A transition MAY be:

- deterministic or nondeterministic;
- pure or effectful;
- implemented directly or refined into a subgraph;
- selected by a human, an AI planner, a runtime, or the environment.

The selector is not part of the transition's meaning unless selection policy is
itself constrained.

### 4.3 Constraint

A **Constraint** defines which semantic objects are admissible.

Every constraint MUST declare its scope:

```text
state constraint
step constraint
trace constraint
subgraph constraint
program constraint
```

Examples:

```text
state
  Account.balance >= 0

step
  Charge.amount == Order.total

trace
  successful_charge(order) <= 1

subgraph
  every Payment.write requires Payment.charge capability
```

Constraints in the kernel are hard validity conditions. Preferences, scores,
and optimization objectives MAY be added by a later planning profile, but MUST
NOT silently weaken a hard constraint.

Under partial information, a verifier MAY return `unknown` or `conflicting`
instead of forcing a Boolean answer. Execution policy decides which verification
outcomes are acceptable for a particular boundary.

## 5. Program model

A program is a constrained space of behaviors:

```text
Program P = (Init, T, C)
```

where:

- `Init` is a constraint describing permitted initial states;
- `T` is the set of available named transition relations;
- `C` is the set of state, step, trace, and graph constraints.

A behavior is a trace:

```text
s0 --t1--> s1 --t2--> ... --tn--> sn
```

annotated with inputs, outputs, and observable events.

A behavior is valid only when:

1. `s0` satisfies `Init`;
2. every step belongs to the selected transition relation;
3. all applicable constraints are satisfied to the assurance level required by
   the execution policy.

This definition makes safety and progress properties possible without adding
`goal` as a primitive.

## 6. Derived human semantic forms

The following forms are projections over the kernel:

| Human form | Kernel interpretation |
|---|---|
| `data` | A state schema or typed value schema |
| `transform` | A transition with no observable external effect |
| `action` | A transition with one or more declared external effects |
| `rule` | A named constraint |
| `goal` | A desired state or trace constraint |
| `flow` | A composition of transitions |
| `capability` | An authority requirement attached to an effectful transition |
| `block` | An interface-closed semantic subgraph |
| `gene` | A reusable, versioned Semantic Block |

Keeping `transform` and `action` distinct in the human projection preserves an
important review boundary without making them separate kernel primitives.

The initial goal profile is reachability:

```text
goal G = eventually predicate G holds
```

Optimization goals, soft goals, and competing preferences are deferred.

## 7. Transition contract

Every executable transition MUST have a machine-readable contract.

The contract contains:

```text
identity
inputs
outputs
preconditions
possible outcomes
postconditions
effect footprint
required capabilities
preserved constraints
evidence obligations
```

Fields with no members MUST be represented as explicitly empty in the canonical
IR rather than omitted and inferred.

Example human projection:

```text
action SubmitCharge

in
  Order.pending
  PaymentAttempt.prepared

outcomes
  succeeded(Receipt)
  declined(Reason)
  unknown(AttemptId)

requires
  amount > 0
  idempotency_key.present

effects
  PaymentGateway.charge

capabilities
  payment.charge

preserves
  AtMostOneSuccessfulCharge

evidence
  gateway_response | reconciliation_record
```

### 7.1 Failure

Failure is not a hidden control channel. A failure that affects valid future
behavior MUST appear as an outcome, output, state claim, or observable event.

An implementation MAY use exceptions internally. Its semantic projection MUST
still map relevant exceptions to declared outcomes.

### 7.2 Refinement

A transition MAY be implemented by a Semantic Block containing multiple
transitions. The refinement is valid only if the block preserves the public
contract and supplies evidence for the refinement claim.

## 8. Effects and capabilities

Effects and capabilities are related but not interchangeable.

An **effect** answers:

> What may this transition observe or change outside its local value boundary?

A **capability** answers:

> What explicit authority must the executor possess to attempt that effect?

Examples:

```text
effect
  Database.orders.write

capability
  orders.write
```

The effect footprint SHOULD distinguish at least:

```text
read
write
emit
invoke
allocate
```

Pure transitions have an explicitly empty external effect footprint.

An effectful transition MUST NOT inherit ambient authority merely because the
runtime happens to possess it. Required authority must be named in the semantic
contract and checked at the execution boundary.

The exact capability representation is deferred to a later RFC.

## 9. Partial, ambiguous, and conflicting meaning

The core MUST preserve incomplete information.

For a proposition `p`, the minimum information model can be represented as
independent support for `p` and for `not p`:

| true support | false support | information state |
|---:|---:|---|
| 0 | 0 | `UNKNOWN` |
| 1 | 0 | supported true |
| 0 | 1 | supported false |
| 1 | 1 | `CONFLICTING` |

`AMBIGUOUS` is different. It means that multiple candidate semantic
interpretations remain possible, for example two possible meanings of "small
discount". Ambiguity is represented as an explicit candidate set or unresolved
choice, not as a truth value.

`VERIFIED` is also different. It is an assurance claim backed by evidence. It is
orthogonal to completeness: a verifier may establish that a value is genuinely
unknown, or that two sources genuinely conflict.

Therefore the system MUST NOT model these concepts as a single linear enum:

```text
information: unknown | supported | conflicting | ambiguous(...)
assurance:   unverified | checked | proven | observed
```

The complete knowledge calculus and propagation rules are deferred to
RFC-0002.

## 10. Semantic Block

A **Semantic Block** is an interface-closed subgraph of states, transitions, and
constraints.

A block boundary is defined by a graph cut, not by source-file location.

Anything crossing that boundary MUST be declared as one of:

```text
input
output
effect
capability
constraint dependency
evidence dependency
```

A block is locally closed when every semantic dependency is either:

1. contained inside the block; or
2. declared in its boundary contract.

Undeclared external dependencies make the block invalid.

This yields a practical definition:

> A Semantic Block is the smallest bounded subgraph that can be understood and
> verified from its contract plus explicitly named dependencies.

Whether a chosen block is *usefully small* is an ergonomic question to be
measured, not a kernel rule.

## 11. Composition

Composition operates on transition relations and their contracts.

### 11.1 Sequence

```text
A >> B
```

denotes relational composition. Every output/state admitted by `A` that flows
to `B` MUST satisfy `B`'s input type and preconditions, or be handled by an
explicit branch.

Sequence is expected to be associative when interfaces and effects are valid:

```text
(A >> B) >> C == A >> (B >> C)
```

### 11.2 Choice

```text
A | B
```

denotes the union of candidate relations. A complete use MUST declare whether
the branch is selected by:

```text
environment
executor
planner
policy
```

Choice policy affects guarantees and MUST NOT remain implicit at an execution
boundary.

### 11.3 Guard

```text
when P -> A
```

restricts the domain of `A` to states satisfying `P` at the required assurance
level.

### 11.4 Parallel composition

```text
A & B
```

is not yet a universally valid operator. It MAY be accepted only when:

- the declared read/write/effect footprints are independent; or
- an explicit synchronization relation resolves interference.

A sufficient initial independence check is:

```text
writes(A) intersect (reads(B) union writes(B)) = empty
writes(B) intersect reads(A) = empty
```

External effects may require stronger domain-specific commutativity evidence.
The complete concurrency algebra is deferred to RFC-0003.

## 12. Identity and equivalence

The project MUST distinguish representation identity from behavioral
equivalence.

```text
content_id
  hash of versioned canonical IR bytes

contract_id
  hash of the normalized exported contract

implementation_id
  hash of a concrete implementation artifact

equivalence_claim
  assertion that two artifacts satisfy a stated equivalence relation,
  accompanied by evidence
```

A display-name change may preserve `contract_id` if display names are excluded
from the normalized contract. An internal rewrite may preserve `contract_id`
while changing `implementation_id`.

The system MUST NOT claim to compute a universal hash of program meaning.
General behavioral equivalence is not automatically decidable. Equivalence is
always relative to a declared observation boundary and verification method.

## 13. Canonical IR and codecs

The canonical IR MUST be:

- typed;
- versioned;
- deterministic to serialize;
- explicit about empty and unknown fields;
- independent of source-file layout;
- capable of representing graph structure directly;
- capable of retaining source and provenance links without making them identity;
- suitable for local semantic addressing and patching.

For meaning `M`, encoder `E`, decoder `D`, and semantic equivalence `~`:

```text
D(E(M)) ~ M
```

For an accepted external representation `R`:

```text
E(D(R)) = canonicalize(R)
```

The first law preserves meaning. The second provides deterministic
normalization. Neither law implies byte equality between different human
projections.

No codec may introduce executable defaults that are absent from canonical
semantics.

## 14. Verification and evidence

Verification produces claims about semantic objects. Evidence supports those
claims.

An evidence record SHOULD bind at least:

```text
subject_id
claim
method
verifier_id
verifier_version
environment_or_assumptions
result
artifact_or_receipt
```

Examples include:

- a type-check result;
- a model-checking trace;
- a proof object;
- a property-test report;
- an integration-test result;
- an external receipt or signed observation.

Evidence does not become permanently true merely because it once existed. A
change of subject, contract, verifier assumptions, or environment may invalidate
its applicability.

The execution boundary MUST evaluate required evidence claims against policy.
Different effects MAY require different assurance levels.

## 15. Adversarial validation: payment

Payment is the first validation case because it combines external effects,
failure, partial knowledge, evidence, idempotency, and irreversible outcomes.

### 15.1 State schemas

```text
Order.status = pending | paid | cancelled

PaymentAttempt.status =
  prepared
  | submitted
  | succeeded
  | declined
  | unknown

PaymentAttempt
  order_id: OrderId
  attempt_id: AttemptId
  idempotency_key: IdempotencyKey
  amount: Money
  status: PaymentAttempt.status
  receipt: Receipt?
```

### 15.2 Transitions

```text
PrepareCharge
  Order.pending
    -> PaymentAttempt.prepared

SubmitCharge
  PaymentAttempt.prepared
    -> succeeded(Receipt)
     | declined(Reason)
     | unknown(AttemptId)

ReconcileCharge
  PaymentAttempt.unknown
    -> succeeded(Receipt)
     | declined(Reason)
     | unknown(AttemptId)

MarkPaid
  Order.pending + PaymentAttempt.succeeded(Receipt)
    -> Order.paid
```

`SubmitCharge` and `ReconcileCharge` require explicit payment capabilities and
produce observable payment-gateway events. `PrepareCharge` is pure with respect
to the external gateway.

### 15.3 Constraints

```text
PositiveAmount
  PaymentAttempt.amount > 0

StableChargeIntent
  one order uses one stable amount and idempotency key per attempt

AtMostOneSuccessfulCharge
  successful_charge(order_id) <= 1

NoNewAttemptWhileUnknown
  exists attempt(order_id, status = unknown)
    => no new payment intent for order_id

PaidRequiresReceipt
  Order.paid
    => exists verified Receipt for the successful attempt
```

### 15.4 Required behavior under timeout

If the gateway receives a request but the caller times out, the system MUST NOT
invent either success or failure:

```text
PaymentAttempt.status = unknown
```

The next valid path is reconciliation or an explicitly proven idempotent replay,
not an unconstrained new charge.

This case is considered representable by the three-part kernel because:

- payment and order facts are State;
- attempts, reconciliation, and completion are Transitions;
- idempotency, receipt, and trace safety requirements are Constraints;
- effects, capabilities, and evidence are explicit transition-contract and
  verification-layer information.

It remains an open question whether this representation stays natural when
compensation, asynchronous webhooks, cancellation races, and partial failure are
added.

## 16. Falsification criteria

The three-part hypothesis is weakened or falsified if a validation case shows
that:

1. an executable semantic distinction cannot be represented as State,
   Transition, Constraint, or explicit metadata on one of them without loss;
2. deriving a common concept repeatedly produces unsafe or materially ambiguous
   encodings;
3. the same semantic object cannot support deterministic canonicalization;
4. local block verification requires undeclared global context by design;
5. unknown information cannot propagate without either blocking all useful work
   or permitting invented semantics;
6. the representation performs worse than ordinary typed source code on the
   agreed AI and human comprehension benchmarks.

If a fourth primitive is proposed, its RFC MUST provide a counterexample that
cannot be represented cleanly by this model.

## 17. Minimum conformance for an experimental IR

An implementation claiming experimental RFC-0001 conformance MUST:

1. represent typed states;
2. represent named transitions with multiple outcomes;
3. represent constraint scope;
4. distinguish pure and effectful transitions;
5. distinguish effects from required capabilities;
6. preserve explicit unknown information;
7. serialize deterministically under a declared IR version;
8. produce machine-readable verification diagnostics;
9. model the payment timeout case without assuming success or failure;
10. expose enough identity information to bind evidence to the checked subject.

No implementation is conformant merely because it parses the provisional human
syntax.

## 18. Open questions

1. Is State best represented as typed records, logical claims, resources, or a
   combination?
2. Which constraint language is small enough for verification but expressive
   enough for useful trace properties?
3. Should events be first-class state facts, transition observations, or both
   through an explicit projection?
4. What is the minimum capability model that prevents ambient authority?
5. Which effect-footprint rules are sufficient for safe parallel composition?
6. How should asynchronous callbacks correlate with earlier attempts?
7. What observation boundaries should define contract equivalence?
8. Which evidence formats can be verified independently across runtimes?
9. How should semantic neighborhoods be selected and benchmarked?
10. Can the payment model be refined into TypeScript, Python, and a workflow
    engine without semantic loss?

## 19. Consequences of adoption

If accepted for Phase 0:

- documentation will use State, Transition, and Constraint for the kernel;
- `data`, `transform`, `action`, and `rule` will be described as human forms;
- syntax work will remain non-normative until the payment case is stable;
- RFC-0002 will define knowledge and evidence propagation;
- RFC-0003 will define composition and concurrency;
- the first reference IR will target deterministic representation of this RFC,
  not execution performance.

## 20. Current conclusion

The current evidence supports, but does not prove, the working thesis:

> A useful AI-native semantic core can remain small if programs are represented
> as typed states, named transition relations, and explicit constraints, while
> complexity emerges through verified topology rather than keyword growth.
