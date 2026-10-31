# Roadmap

## Phase 0 — Semantic hypotheses (drafts available)

- Stabilize terminology.
- Challenge the three-concept State / Transition / Constraint hypothesis.
- Define precise action composition semantics.
- Define effects and capabilities.
- Decide canonical IR requirements.

RFC-0001 through RFC-0006 are research drafts, not a stabilized standard. The
Phase 0 retrospective remains a design constraint: avoid turning every audit
detail into mandatory AI context.

## Phase 1 — Executable semantic experiments (in progress)

- [x] Restore the standalone four-valued conformance checker.
- [x] Add a fixed typed predicate vocabulary and bounded pure evaluator.
- [x] Evaluate `require`, `forbid`, and guarded requirements as JSON.
- [x] Separate information value, strict status, completion, and gate contribution.
- [x] Compare the logical layer against an independent Python implementation.
- [x] Add machine-readable diagnostics and CI for the reference subset.
- [x] Add typed, immutable, content-identified finite closed-domain quantification.
- [x] Require closure support for exact domain content and check empty bodies statically.
- [x] Qualify signed test reports against caller-owned trust, manifest, code version, time, and revocation inputs.
- [x] Replay a recorded real test run, preserving exclusion, unresolved verification, and conflicting evidence separately.
- [ ] Extend independent language coverage to type and evidence boundaries.
- [ ] Extend test-report qualification to general evidence dependencies and domain closure attestations.
- [ ] Integrate a production CI producer and externally maintained trust/revocation views.
- [ ] Extend domain content bindings to full semantic content identities.
- [ ] Experiment with compact projection, deterministic expansion, and identity verification.
- [ ] Measure representation size, context cost, and correctness before freezing a wire format.

A human-syntax parser follows evidence that the typed representation is useful.
A general executor is not the current milestone.

## Phase 2 — Verifier

- Extend the reference subset's type checks to graph and transition contracts.
- Effect checking.
- Rule/invariant checking.
- Semantic dependency graph.

## Phase 3 — AI benchmark

Evaluate multiple model families on the same programming tasks using conventional source code and AI Native Core representations.

## Phase 4 — Interop

- TypeScript target or bindings.
- Python interop.
- WASM/component integration exploration.

## Phase 5 — Semantic patching

Allow AI systems to propose semantic edits against typed program nodes instead of line-oriented diffs.
