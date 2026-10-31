# Signed test-evidence adapter (experimental)

This is a small executable slice of [RFC-0002](../RFC-0002-knowledge-and-evidence.md):
filter recorded test evidence into an eligible support view, then evaluate a
typed constraint. It supports one fixed test-report method, not arbitrary
attestations, a CI service, or a complete authorization decision.

## Run the recorded example

```bash
node bin/aicore.mjs evaluate-evidence examples/test-evidence.request.json examples/test-evidence.trust.json
```

The fixture records an actual successful `npm test` run from a clean Git archive
of commit `6028225c0b31b455ed4f96f577a13af77a6ed9a6`: 37 Node test groups passed,
along with the standalone JS/Python checks. The report was signed with a fresh
local demonstration key. Only the public key and signature are stored; no
private key is committed. It is a recorded local run, not an attestation from
GitHub Actions or a production signing authority.

The trusted file pins the replay time, repository, commit, environment, suite,
expected evidence IDs, public key, and revocation view. The command returns
`COMPLETE / CONTINUE` with an inner `SATISFIED` result. It verifies this recorded
snapshot, not the current branch. Time is explicit replay input; the evaluator
does not consult the host clock or make network calls.

Use a caller-selected production trust context for real integrations. The
published demo public key is only for this fixture.

## Trust boundary and request shape

API: `evaluateEvidence(request, trustedContext)`.

- Request profile: `aicore.evidence-evaluation/0.1`.
- Record profile: `aicore.test-evidence/0.1`.
- Trusted-context profile: `aicore.test-evidence-trust/0.1`.
- Filter implementation: `aicore.test-evidence-filter/0.1`.
- Only accepted method: `aicore.test-run/0.1`.

The request contains exactly `profile`, `evaluation`, and `evidence`.
`evaluation` uses core profile/vocabulary `0.2`, but omits `claims` and
`evidence_view_id`: the adapter derives them. It accepts state bindings, Context,
one constraint, and optional core limits. Caller-authored support sets, domains,
embedded trust configuration, and time overrides are rejected.

The second argument is trusted application input, supplied independently of the
model/request. It includes the evaluation time, maximum age, public-key registry,
suite policies, revocations, and a scoped evidence manifest. The CLI requires a
separate caller-selected trusted file; it cannot read trust from request stdin.
The application must prevent the model from selecting or editing this authority.

The bare `evaluate` command remains an evaluator of caller-preselected support
sets. It does not automatically run this evidence adapter.

## Preventing omission and substitution

`evidence_manifest` contains `subject_id`, `snapshot_id`, `scope`, `complete`,
and `evidence_ids`. It must bind the exact requested subject, full Git commit,
and state scope. A mismatched trusted target is `INVALID / DENY`.

The manifest is supplied by the trusted collector, not computed from the model's
submitted list. Otherwise a model could omit a signed failure report while
retaining a passing report. Missing expected records or a non-complete manifest
produce `INCOMPLETE_CONTEXT / DEFER`, with no inner constraint result. Extra
unlisted records are known exclusions and cannot change the trusted view.

This checks materialization of the caller's declared evidence snapshot. The
collector remains responsible for declaring an adequate complete view; a hash
or signature cannot prove that it has collected every relevant external fact.

## Test reports and signed records

A report has exactly four fields:

| Field | Meaning |
|---|---|
| `suite_id` | Stable suite identifier |
| `outcome` | `PASSED`, `FAILED`, or `INDETERMINATE` |
| `tests_run` | Exact nonnegative integer count |
| `tests_failed` | Exact nonnegative count, no greater than `tests_run` |

A pass requires at least one test and zero failures. A failure requires at least
one failed test. An indeterminate report has zero known failures and contributes
neither positive nor negative support. An observed failure remains a
counterexample even when execution stops before the minimum passing test count.

Each signed record binds `key_id`, `producer_id`, `subject_id`, full
`snapshot_id`, `scope`, `method_id`, `environment_id`, `observed_at_ms`,
`expires_at_ms`, and `artifact_digest`, plus its report and signature. Snapshot
IDs are exactly `git-commit-sha1:<40 lowercase hex>` or
`git-commit-sha256:<64 lowercase hex>`; branch labels and trailing line
terminators are rejected.

The report digest identifies the normalized four-field report, not the raw test
log or repository bytes. The signature additionally binds its asserted code
version and other metadata. Relabeling a report to a new commit invalidates its
signature. A valid signature establishes origin/integrity under the caller's
trust anchor; it does not independently prove truthful execution or software
correctness.

The adapter derives the local claim locator `test-suite.passed:<suite_id>` in
the result's subject/snapshot scope. It does not accept arbitrary claim IDs or
stances from evidence. This is not the universal content-derived Claim identity
envisioned by the full RFC-0002 model.

## Qualification and four-valued support

Qualification checks exact subject/version/environment, manifest membership,
accepted method/producer/key, Ed25519 signature, report digest, freshness,
validity interval, minimum passing test count, and revocations.

Eligibility is separate from proposition truth:

```text
any definite failed check       -> INELIGIBLE
otherwise any unresolved check  -> UNRESOLVED
otherwise                      -> ELIGIBLE
```

Unknown keys in the closed trusted registry are known exclusions. A registered
key with `UNKNOWN` status, or an incomplete revocation view, is unresolved.
Failed checks dominate unresolved checks: an expired or wrong-version record
cannot block an independent valid pass merely because its key status is unknown.
Both sets of diagnostic reasons remain visible.

| Evidence situation | Contribution / resulting behavior |
|---|---|
| Eligible passing report | Positive support |
| Eligible failed report | Negative support |
| Eligible indeterminate report | Neither side |
| Expired, revoked, wrong-version, bad-signature or other excluded report | Neither side; never implicit refutation |
| Eligible pass and fail for the same scoped claim | FDE `CONFLICTING`; strict constraint defers |
| Unresolved eligibility for a used claim | `INCOMPLETE_CONTEXT / DEFER`, no inner completed result |
| Missing required record | `INCOMPLETE_CONTEXT / DEFER` |

All records and all expression operands are checked. Unresolved eligibility for
a visited claim is a missing verification dependency, even if an `any` branch
has another true witness or a guard is inactive. This conservative evidence
profile is stricter than applying the bare FDE fold alone. Unrelated unresolved
claims do not taint an unreferenced claim. Existing `INVALID / DENY` and resource
failures are preserved.

Age is inclusive: `evaluated_at_ms - observed_at_ms <= max_age_ms`. Future
observations are excluded. Expiry is exclusive: `evaluated_at_ms < expires_at_ms`.
All times are exact nonnegative epoch-millisecond integers; expiry must follow
observation time. The trusted caller chooses replay versus live evaluation time.

## Deterministic encoding and identities

All identity/signature projections are fixed tuples encoded as compact UTF-8
JSON with exact integers and Unicode scalar strings, as in the restricted
[domain encoding](FINITE-DOMAINS.md). There is no general JCS implementation.

Report tuple:

```text
[suite_id, outcome, tests_run, tests_failed]
```

Report digest is SHA-256 of `UTF8("ai-native-core/test-report/0.1") || byte(0)`
followed by that tuple, labeled `aicore-test-report-sha256:<hex>`.

Ed25519 signs these exact bytes:

```text
UTF8("ai-native-core/test-evidence-signature/0.1") || byte(0) || JSON_UTF8([
  profile, key_id, producer_id, subject_id, snapshot_id, scope,
  method_id, environment_id, observed_at_ms, expires_at_ms, artifact_digest
])
```

Signatures are canonical base64 for exactly 64 bytes. Evidence identity hashes
`UTF8("ai-native-core/test-evidence-id/0.1") || byte(0)` followed by compact
JSON of `[base64(signed_bytes), signature_base64, actual_report_digest]`, labeled
`aicore-evidence-sha256:<hex>`. The last field is recomputed from the embedded
report, not copied from its asserted digest. Corrupting that report therefore
changes the manifest identity even when signed metadata is retained. Duplicate
identities are invalid.

The trusted-context digest binds the time, age policy, revocation closure/IDs,
key registry, suite policies, and evidence manifest. Registry/suite entries and
set-valued ID lists are sorted by UTF-16 code units. Public keys normalize to
SPKI DER. The exact tuple is implemented by `prepareTrust` in
[test-evidence.mjs](../src/test-evidence.mjs). Its domain separator is
`ai-native-core/test-evidence-trust/0.1` plus a zero byte; the label is
`aicore-test-trust-sha256:<hex>`.

The view digest binds that trusted-context digest, subject, snapshot, scope,
and sorted decision tuples `[evidence_id, status, contribution, failed_checks,
unresolved_checks]`, using separator `ai-native-core/test-evidence-view/0.1` plus
a zero byte and label `aicore-test-view-sha256:<hex>`. Decision reasons retain
the check order in the implementation. Changing trust, time, target, signature,
or qualification changes the view identity; record order does not.

Helpers `testReportDigest`, `testEvidenceBytes`, and `testEvidenceId` expose these
restricted projections for trusted producers. Signing keys are not loaded by
the evaluator. Ed25519 verification uses the [Node standard crypto API](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).

## Bounds, validation, and remaining work

The profile allows at most 256 records/manifest entries, 32 public keys, 128 suite
policies, and 1,024 explicit revocations. Each evidence identifier is at most
1,024 UTF-8 bytes. The CLI applies the existing 1 MiB strict JSON/UTF-8 boundary
separately to request and trusted context. Aggregate output retains the 4 MiB
diagnostic ceiling; oversize results never return partial satisfaction or weaken
a known `INVALID / DENY` result.

`npm test` covers actual signatures and tampering, time boundaries, partial
failures, pass/fail conflicts, 48 qualification combinations, unknown verification,
manifest omission/substitution, frozen inputs, order invariance, malformed
encodings, canonical IDs, output limits, and CLI behavior. Python independently
recomputes report/payload/evidence identity projections, including Unicode and
escaping. It does not implement the full cryptographic/qualification policy.
The recorded fixture was also verified locally with the OpenSSL CLI using the
Python-encoded payload; OpenSSL is not required by the test suite.

This iteration adds no production CI signer, private-key management, external
revocation resolver, general evidence dependency graph, or capability system.
Finite-domain closure attestations are not supported by this test-only adapter.
Raw state bindings and the requested constraint remain caller assertions; the
embedding application must pin the intended contract and actual target version.
`CONTINUE` still means only that other assurance and authorization checks may
continue. It never means an action is authorized or that the software is correct.
