import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PROFILE, VOCABULARY_ID } from "../src/evaluator.mjs";
import { EVIDENCE_PROFILE, EVALUATION_PROFILE, TRUST_PROFILE, METHOD_ID, EVIDENCE_LIMITS,
  evaluateEvidence, testClaimId, testReportDigest, testEvidenceBytes, testEvidenceId } from "../src/test-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const current = `git-commit-sha1:${"a".repeat(40)}`, old = `git-commit-sha1:${"b".repeat(40)}`;
const keys = generateKeyPairSync("ed25519"), otherKeys = generateKeyPairSync("ed25519");
const now = 1793404800000;
const claim = suite => ({ op: "atom", predicate: "claim.supported", args: [{ type: "ClaimId", value: testClaimId(suite) }] });
function input(expr = claim("unit")) {
  return { profile: EVALUATION_PROFILE, evaluation: { profile: PROFILE, vocabulary_id: VOCABULARY_ID,
    subject_id: "repository:demo", snapshot_id: current, scope: "state", context: { complete: true, missing_dependencies: [] }, bindings: {},
    constraint: { id: "TestsBeforeReview", form: "require", expr } }, evidence: [] };
}
function trust(request) {
  // The fixture harness plays the trusted collector. A production host must
  // obtain this manifest independently, never from the model's submitted list.
  return { profile: TRUST_PROFILE, evaluated_at_ms: now, max_age_ms: 60000, revocations_complete: true, revoked_evidence_ids: [],
    evidence_manifest: { subject_id: request.evaluation.subject_id, snapshot_id: request.evaluation.snapshot_id, scope: "state", complete: true, evidence_ids: [...new Set(request.evidence.map(testEvidenceId))] },
    keys: { "ci:key-1": { producer_id: "ci:runner", status: "ACTIVE", public_key_pem: keys.publicKey.export({ format: "pem", type: "spki" }) } },
    suites: { unit: { environment_id: "node:24/linux", min_tests: 37, accepted_producers: ["ci:runner"] } } };
}
function signed(changes = {}, reportChanges = {}, privateKey = keys.privateKey) {
  const report = { suite_id: "unit", outcome: "PASSED", tests_run: 37, tests_failed: 0, ...reportChanges };
  const evidence = { profile: EVIDENCE_PROFILE, key_id: "ci:key-1", producer_id: "ci:runner", subject_id: "repository:demo", snapshot_id: current,
    scope: "state", method_id: METHOD_ID, environment_id: "node:24/linux", observed_at_ms: now - 1000, expires_at_ms: now + 60000,
    artifact_digest: testReportDigest(report), report, ...changes };
  evidence.signature = sign(null, testEvidenceBytes(evidence), privateKey).toString("base64");
  return evidence;
}
function failure(result, completion, code) {
  assert.equal(result.completion, completion, JSON.stringify(result));
  assert.equal(result.diagnostics[0].code, code);
  assert(!Object.hasOwn(result, "evaluation"));
  assert.notEqual(result.effectful_gate_contribution, "CONTINUE");
}

test("a real Ed25519 signature and exact commit binding produce scoped support", () => {
  const request = input(); request.evidence.push(signed());
  const result = evaluateEvidence(request, trust(request));
  assert.equal(result.completion, "COMPLETE");
  assert.equal(result.effectful_gate_contribution, "CONTINUE");
  assert.equal(result.evaluation.constraint_status, "SATISFIED");
  assert.equal(result.evaluation.expression.information_value, "SUPPORTED_TRUE");
  assert.deepEqual(result.evaluation.observations[0].positive_support_ids, [testEvidenceId(request.evidence[0])]);
  assert.equal(result.evaluation.snapshot_id, current);
  assert.equal(result.evidence_decisions[0].status, "ELIGIBLE");
  assert(!JSON.stringify(result).includes('"ALLOW"'));
});

test("old code, wrong subject, wrong environment and unsupported methods are excluded, not refuted", () => {
  for (const [change, reason] of [
    [{ snapshot_id: old }, "CODE_VERSION_MISMATCH"], [{ subject_id: "repository:other" }, "SUBJECT_MISMATCH"],
    [{ environment_id: "node:22/windows" }, "ENVIRONMENT_MISMATCH"], [{ method_id: "model-prediction/1" }, "UNACCEPTED_METHOD"],
    [{ producer_id: "model:untrusted" }, "UNACCEPTED_PRODUCER"],
  ]) {
    const request = input(); request.evidence = [signed(change)];
    const result = evaluateEvidence(request, trust(request));
    assert.equal(result.completion, "COMPLETE");
    assert.equal(result.effectful_gate_contribution, "DEFER");
    assert.equal(result.evaluation.expression.information_value, "UNKNOWN");
    assert.equal(result.evidence_decisions[0].status, "INELIGIBLE");
    assert(result.evidence_decisions[0].failed_checks.includes(reason));
    assert.deepEqual(result.evaluation.observations[0].negative_support_ids, []);
  }
});

test("expiry is exclusive, freshness age inclusive, and the clock is trusted input", () => {
  const request = input(); request.evidence = [signed({ observed_at_ms: now - 60000, expires_at_ms: now + 1 })];
  assert.equal(evaluateEvidence(request, trust(request)).effectful_gate_contribution, "CONTINUE");
  const later = trust(request); later.evaluated_at_ms++;
  const expired = evaluateEvidence(request, later);
  assert(expired.evidence_decisions[0].failed_checks.includes("EVIDENCE_EXPIRED"));
  assert(expired.evidence_decisions[0].failed_checks.includes("EVIDENCE_TOO_OLD"));
  assert.equal(expired.evaluation.expression.information_value, "UNKNOWN");
  assert.notEqual(expired.trust_context_id, evaluateEvidence(request, trust(request)).trust_context_id);
  request.evidence = [signed({ observed_at_ms: now + 1 })];
  assert(evaluateEvidence(request, trust(request)).evidence_decisions[0].failed_checks.includes("OBSERVATION_IN_FUTURE"));
  request.evaluated_at_ms = now - 1000;
  failure(evaluateEvidence(request, trust(request)), "INVALID", "UNKNOWN_FIELD");
});

test("artifact mutation and a different signing key cannot become positive evidence", () => {
  for (const altered of ["report", "metadata", "signature"]) {
    const request = input(); request.evidence = [signed()];
    const record = request.evidence[0];
    if (altered === "report") record.report.tests_run++;
    if (altered === "metadata") record.observed_at_ms--;
    if (altered === "signature") record.signature = signed({}, {}, otherKeys.privateKey).signature;
    const result = evaluateEvidence(request, trust(request));
    assert.equal(result.evaluation.expression.information_value, "UNKNOWN");
    assert(result.evidence_decisions[0].failed_checks.includes(altered === "report" ? "ARTIFACT_DIGEST_MISMATCH" : "SIGNATURE_INVALID"));
  }
  const relabeled = input(); relabeled.evidence = [signed()];
  relabeled.evaluation.snapshot_id = old; relabeled.evidence[0].snapshot_id = old;
  const result = evaluateEvidence(relabeled, trust(relabeled));
  assert(result.evidence_decisions[0].failed_checks.includes("SIGNATURE_INVALID"));
  assert.equal(result.evaluation.expression.information_value, "UNKNOWN");
});

test("revoked keys/evidence are excluded while unknown verification defers even beside a valid pass", () => {
  const request = input(); request.evidence = [signed()];
  const revoked = trust(request); revoked.keys["ci:key-1"].status = "REVOKED";
  assert.equal(evaluateEvidence(request, revoked).evaluation.expression.information_value, "UNKNOWN");
  revoked.keys["ci:key-1"].status = "ACTIVE"; revoked.revoked_evidence_ids = [testEvidenceId(request.evidence[0])];
  assert(evaluateEvidence(request, revoked).evidence_decisions[0].failed_checks.includes("EVIDENCE_REVOKED"));
  const unknown = trust(request); unknown.keys["ci:key-1"].status = "UNKNOWN";
  failure(evaluateEvidence(request, unknown), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
  unknown.keys["ci:key-2"] = { ...unknown.keys["ci:key-1"], status: "ACTIVE" };
  request.evidence.push(signed({ key_id: "ci:key-2" }));
  unknown.evidence_manifest.evidence_ids = request.evidence.map(testEvidenceId);
  failure(evaluateEvidence(request, unknown), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
  unknown.keys["ci:key-1"].status = "ACTIVE"; unknown.revocations_complete = false;
  failure(evaluateEvidence(request, unknown), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
});

test("a definite exclusion dominates unresolved verification and cannot poison another valid result", () => {
  const request = input(); request.evidence = [signed({ snapshot_id: old })];
  const context = trust(request); context.keys["ci:key-1"].status = "UNKNOWN";
  context.keys["ci:key-2"] = { ...context.keys["ci:key-1"], status: "ACTIVE" };
  request.evidence.push(signed({ key_id: "ci:key-2" }));
  context.evidence_manifest.evidence_ids = request.evidence.map(testEvidenceId);
  const result = evaluateEvidence(request, context);
  assert.equal(result.evaluation.constraint_status, "SATISFIED");
  const excluded = result.evidence_decisions.find(x => x.status === "INELIGIBLE");
  assert(excluded.failed_checks.includes("CODE_VERSION_MISMATCH"));
  assert(excluded.unresolved_checks.includes("KEY_STATUS_UNKNOWN"));
});

test("eligible explicit failures refute a pass, and simultaneous pass/failure stays conflicting", () => {
  const request = input(); request.evidence = [signed({}, { outcome: "FAILED", tests_run: 1, tests_failed: 1 })];
  let result = evaluateEvidence(request, trust(request));
  assert.equal(result.evaluation.constraint_status, "VIOLATED");
  assert.equal(result.effectful_gate_contribution, "DENY");
  assert.equal(result.evidence_decisions[0].contribution, "REFUTE");
  request.evidence.push(signed());
  result = evaluateEvidence(request, trust(request));
  assert.equal(result.evaluation.expression.information_value, "CONFLICTING");
  assert.equal(result.effectful_gate_contribution, "DEFER");
});

test("zero/partial test passes do not establish success; an indeterminate run supports neither side", () => {
  const request = input(); request.evidence = [signed({}, { tests_run: 36 })];
  const partial = evaluateEvidence(request, trust(request));
  assert(partial.evidence_decisions[0].failed_checks.includes("INSUFFICIENT_TEST_COVERAGE"));
  assert.equal(partial.evaluation.expression.information_value, "UNKNOWN");
  assert.throws(() => signed({}, { tests_run: 0 }), e => e.code === "INVALID_TEST_REPORT");
  request.evidence = [signed({}, { outcome: "INDETERMINATE", tests_run: 0 })];
  const unknown = evaluateEvidence(request, trust(request));
  assert.equal(unknown.evidence_decisions[0].status, "ELIGIBLE");
  assert.equal(unknown.evidence_decisions[0].contribution, "NONE");
  assert.equal(unknown.evaluation.expression.information_value, "UNKNOWN");
});

test("unresolved eligibility cannot be hidden behind a decisive disjunction or inactive guard", () => {
  const request = input({ op: "any", items: [claim("unit"), { op: "all", items: [] }] });
  request.evidence = [signed()]; const context = trust(request); context.keys["ci:key-1"].status = "UNKNOWN";
  failure(evaluateEvidence(request, context), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
  request.evaluation.constraint = { id: "guard", form: "when_require", activation: { op: "any", items: [] }, requirement: claim("unit") };
  failure(evaluateEvidence(request, context), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
  request.evaluation.constraint = { id: "invalid", form: "require", expr: { op: "invalid" } };
  const invalid = evaluateEvidence(request, context);
  assert.equal(invalid.completion, "INVALID"); assert.equal(invalid.effectful_gate_contribution, "DENY");
});

test("unrelated unresolved evidence does not taint an unreferenced claim", () => {
  const request = input(claim("other")); request.evidence = [signed()];
  const context = trust(request); context.keys["ci:key-1"].status = "UNKNOWN";
  const result = evaluateEvidence(request, context);
  assert.equal(result.completion, "COMPLETE");
  assert.equal(result.evaluation.expression.information_value, "UNKNOWN");
});

test("caller-authored support sets, trust overrides and verified labels are rejected", () => {
  const request = input(); request.evidence = [signed()];
  for (const field of ["claims", "evidence_view_id", "domains"]) {
    const altered = structuredClone(request); altered.evaluation[field] = {};
    failure(evaluateEvidence(altered, trust(request)), "INVALID", "UNKNOWN_FIELD");
  }
  for (const field of ["verified", "stance", "claim_id", "public_key_pem", "confidence"]) {
    const altered = structuredClone(request); altered.evidence[0][field] = true;
    failure(evaluateEvidence(altered, trust(request)), "INVALID", "UNKNOWN_FIELD");
  }
  request.trust = trust(request); failure(evaluateEvidence(request, trust(request)), "INVALID", "UNKNOWN_FIELD");
});

test("unknown keys, producer/key mismatch and unregistered suites are known exclusions", () => {
  const request = input(); request.evidence = [signed({ key_id: "unknown" })];
  assert(evaluateEvidence(request, trust(request)).evidence_decisions[0].failed_checks.includes("UNTRUSTED_KEY"));
  request.evidence = [signed()]; const context = trust(request); context.keys["ci:key-1"].producer_id = "someone:else";
  assert(evaluateEvidence(request, context).evidence_decisions[0].failed_checks.includes("KEY_PRODUCER_MISMATCH"));
  request.evidence = [signed({}, { suite_id: "unregistered" })];
  assert(evaluateEvidence(request, trust(request)).evidence_decisions[0].failed_checks.includes("UNREGISTERED_SUITE"));
});

test("immutable identities and decisions are invariant to record/policy set order", () => {
  const request = input(); request.evidence = [signed(), signed({ observed_at_ms: now - 2000 }, { outcome: "FAILED", tests_failed: 1 })];
  const context = trust(request); context.keys["ci:key-2"] = { ...context.keys["ci:key-1"] };
  const first = evaluateEvidence(request, context);
  request.evidence.reverse(); context.keys = Object.fromEntries(Object.entries(context.keys).reverse()); context.evidence_manifest.evidence_ids.reverse();
  assert.deepEqual(evaluateEvidence(request, context), first);
  const bytes = JSON.stringify(request), trustBytes = JSON.stringify(context);
  const freeze = x => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(request); freeze(context);
  assert.deepEqual(evaluateEvidence(request, context), first);
  assert.equal(JSON.stringify(request), bytes); assert.equal(JSON.stringify(context), trustBytes);
});

test("malformed keys, bad signatures, duplicate records and evidence cardinality do not become unknown truth", () => {
  const request = input(); request.evidence = [signed()];
  const badKey = trust(request); badKey.keys["ci:key-1"].public_key_pem = "not a key";
  failure(evaluateEvidence(request, badKey), "INVALID", "INVALID_PUBLIC_KEY");
  for (const signature of ["", "A".repeat(86) + "==", "A".repeat(85) + "B=="]) {
    const altered = structuredClone(request); altered.evidence[0].signature = signature;
    const result = evaluateEvidence(altered, signature === "A".repeat(86) + "==" ? trust(altered) : trust(request));
    if (signature === "A".repeat(86) + "==") assert(result.evidence_decisions[0].failed_checks.includes("SIGNATURE_INVALID"));
    else failure(result, "INVALID", "INVALID_SIGNATURE_ENCODING");
  }
  request.evidence.push(structuredClone(request.evidence[0]));
  failure(evaluateEvidence(request, trust(request)), "INVALID", "DUPLICATE_EVIDENCE");
  request.evidence = new Array(EVIDENCE_LIMITS.max_records + 1).fill({});
  failure(evaluateEvidence(request, trust(input())), "INDETERMINATE", "EVIDENCE_LIMIT");
  request.evidence = new Array(1);
  failure(evaluateEvidence(request, trust(input())), "INVALID", "SPARSE_LIST");
});

test("eligibility failure/unknown precedence holds across key, signature, binding and revocation states", () => {
  const request = input();
  for (const status of ["ACTIVE", "REVOKED", "UNKNOWN"]) for (const badSignature of [false, true])
    for (const oldVersion of [false, true]) for (const revocationsComplete of [false, true]) {
      request.evidence = [signed({ snapshot_id: oldVersion ? old : current }, {}, badSignature ? otherKeys.privateKey : keys.privateKey)];
      const context = trust(request); context.keys["ci:key-1"].status = status; context.revocations_complete = revocationsComplete;
      const result = evaluateEvidence(request, context);
      const excluded = status === "REVOKED" || badSignature || oldVersion;
      const unresolved = !excluded && (status === "UNKNOWN" || !revocationsComplete);
      assert.equal(result.evidence_decisions[0].status, excluded ? "INELIGIBLE" : unresolved ? "UNRESOLVED" : "ELIGIBLE");
      assert.equal(result.completion, unresolved ? "INCOMPLETE_CONTEXT" : "COMPLETE");
      assert.equal(result.effectful_gate_contribution, excluded || unresolved ? "DEFER" : "CONTINUE");
    }
});

test("outer diagnostic limits preserve an embedded INVALID/DENY decision", () => {
  const request = input({ op: "invalid" });
  request.evaluation.constraint.id = "c".repeat(4 * 1024 * 1024 - 4096);
  request.evidence = Array.from({ length: 20 }, (_, i) => signed({ observed_at_ms: now - 1000 - i }));
  const result = evaluateEvidence(request, trust(request));
  failure(result, "INVALID", "DIAGNOSTIC_LIMIT");
  assert.equal(result.effectful_gate_contribution, "DENY");
  assert.equal(result.diagnostics[0].cause_code, "UNKNOWN_OPERATOR");
});

test("canonical commit, artifact and revocation identities reject trailing line terminators", () => {
  for (const ending of ["\n", "\r", "\u2028", "\u2029"]) {
    const request = input(); request.evidence = [signed()];
    const originalContext = trust(request);
    request.evaluation.snapshot_id += ending;
    failure(evaluateEvidence(request, trust(request)), "INVALID", "INVALID_CODE_VERSION");
    request.evaluation.snapshot_id = current;
    const context = trust(request); context.revoked_evidence_ids = [testEvidenceId(request.evidence[0]) + ending];
    failure(evaluateEvidence(request, context), "INVALID", "INVALID_EVIDENCE_ID");
    request.evidence[0].artifact_digest += ending;
    failure(evaluateEvidence(request, originalContext), "INVALID", "INVALID_ARTIFACT_DIGEST");
  }
});

test("a caller-owned complete manifest prevents omission of a failure report", () => {
  const request = input(); request.evidence = [signed(), signed({}, { outcome: "FAILED", tests_run: 1, tests_failed: 1 })];
  const context = trust(request);
  assert.equal(evaluateEvidence(request, context).evaluation.constraint_status, "CONFLICTING");
  const failedReport = structuredClone(request.evidence[1]);
  const failureId = testEvidenceId(failedReport);
  request.evidence.pop();
  const missing = evaluateEvidence(request, context);
  failure(missing, "INCOMPLETE_CONTEXT", "EVIDENCE_MANIFEST_INCOMPLETE");
  assert.deepEqual(missing.missing_evidence_ids, [failureId]);
  // The signed payload still asserts the original report digest. Corrupting
  // only the embedded report must also change its immutable record identity.
  failedReport.report.outcome = "PASSED"; failedReport.report.tests_failed = 0;
  request.evidence.push(failedReport);
  assert.notEqual(testEvidenceId(failedReport), failureId);
  const corrupted = evaluateEvidence(request, context);
  failure(corrupted, "INCOMPLETE_CONTEXT", "EVIDENCE_MANIFEST_INCOMPLETE");
  assert.deepEqual(corrupted.missing_evidence_ids, [failureId]);
  request.evidence.pop();
  context.evidence_manifest.complete = false;
  context.evidence_manifest.evidence_ids = [testEvidenceId(request.evidence[0])];
  failure(evaluateEvidence(request, context), "INCOMPLETE_CONTEXT", "EVIDENCE_MANIFEST_INCOMPLETE");
});

test("unlisted records cannot change the trusted view and transport tampering cannot replace an expected record", () => {
  const request = input(); request.evidence = [signed()];
  const context = trust(request);
  request.evidence.push(signed({}, { outcome: "FAILED", tests_run: 1, tests_failed: 1 }));
  const unlisted = evaluateEvidence(request, context);
  assert.equal(unlisted.evaluation.constraint_status, "SATISFIED");
  assert(unlisted.evidence_decisions.some(d => d.failed_checks.includes("EVIDENCE_OUTSIDE_MANIFEST")));
  request.evidence.pop(); request.evidence[0].observed_at_ms--;
  const tampered = evaluateEvidence(request, context);
  failure(tampered, "INCOMPLETE_CONTEXT", "EVIDENCE_MANIFEST_INCOMPLETE");
  assert(tampered.evidence_decisions[0].failed_checks.includes("SIGNATURE_INVALID"));
  request.evaluation.snapshot_id = old;
  failure(evaluateEvidence(request, context), "INVALID", "TRUST_SCOPE_MISMATCH");
});

test("checked-in signature fixture verifies and old-code/unknown-key examples defer", () => {
  const fixture = JSON.parse(readFileSync(new URL("../examples/test-evidence.request.json", import.meta.url), "utf8"));
  const context = JSON.parse(readFileSync(new URL("../examples/test-evidence.trust.json", import.meta.url), "utf8"));
  const result = evaluateEvidence(fixture, context);
  assert.equal(result.effectful_gate_contribution, "CONTINUE");
  const oldCode = structuredClone(fixture); oldCode.evaluation.snapshot_id = old;
  const replay = structuredClone(context); replay.evidence_manifest.snapshot_id = old;
  assert.equal(evaluateEvidence(oldCode, replay).evaluation.expression.information_value, "UNKNOWN");
  context.keys[fixture.evidence[0].key_id].status = "UNKNOWN";
  failure(evaluateEvidence(fixture, context), "INCOMPLETE_CONTEXT", "EVIDENCE_ELIGIBILITY_UNRESOLVED");
});

test("Python independently encodes report digests, signed payloads and immutable evidence identities", () => {
  const request = input();
  request.evidence = [signed(), signed({}, { suite_id: 'unit:猫\n\\"', outcome: "FAILED", tests_run: 1, tests_failed: 1 })];
  const oracle = spawnSync("python3", ["tools/evidence_projection_oracle.py"], { cwd: root, input: JSON.stringify(request), encoding: "utf8" });
  assert.equal(oracle.status, 0, oracle.stderr);
  assert.deepEqual(JSON.parse(oracle.stdout), request.evidence.map(record => ({
    artifact_digest: testReportDigest(record.report),
    signature_payload_sha256: createHash("sha256").update(testEvidenceBytes(record)).digest("hex"),
    evidence_id: testEvidenceId(record),
  })));
});

test("CLI keeps trusted context in a separate input and uses completion exit codes", () => {
  const args = ["bin/aicore.mjs", "evaluate-evidence", "examples/test-evidence.request.json", "examples/test-evidence.trust.json"];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).effectful_gate_contribution, "CONTINUE");
  const noTrust = spawnSync(process.execPath, ["bin/aicore.mjs", "evaluate-evidence", "-", "-"], { cwd: root, input: "{}", encoding: "utf8" });
  assert.equal(noTrust.status, 2); assert.equal(JSON.parse(noTrust.stdout).diagnostics[0].code, "TRUST_SOURCE_REQUIRED");
  const fixture = JSON.parse(readFileSync(new URL("../examples/test-evidence.request.json", import.meta.url), "utf8"));
  fixture.evaluation.snapshot_id = old;
  const stale = spawnSync(process.execPath, ["bin/aicore.mjs", "evaluate-evidence", "-", "examples/test-evidence.trust.json"], { cwd: root, input: JSON.stringify(fixture), encoding: "utf8" });
  assert.equal(stale.status, 2); assert.equal(JSON.parse(stale.stdout).diagnostics[0].code, "TRUST_SCOPE_MISMATCH");
});
