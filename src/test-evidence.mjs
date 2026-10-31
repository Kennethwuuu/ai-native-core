import { createHash, createPublicKey, verify } from "node:crypto";
import { evaluate, contribution, PROFILE as CORE_PROFILE, VOCABULARY_ID } from "./evaluator.mjs";
import { EvaluationError, fail, ids, list, own, record, text } from "./validation.mjs";
import { assertResultBudget, DIAGNOSTIC_LIMITS } from "./diagnostics.mjs";

export const EVIDENCE_PROFILE = "aicore.test-evidence/0.1";
export const TRUST_PROFILE = "aicore.test-evidence-trust/0.1";
export const EVALUATION_PROFILE = "aicore.evidence-evaluation/0.1";
export const FILTER_ID = "aicore.test-evidence-filter/0.1";
export const METHOD_ID = "aicore.test-run/0.1";
export const EVIDENCE_LIMITS = Object.freeze({ max_records: 256, max_keys: 32, max_suites: 128, max_revocations: 1024 });

const digest = (label, value) => createHash("sha256").update(`${label}\0`, "utf8").update(JSON.stringify(value), "utf8").digest("hex");
// JS '$' can match before a final line terminator. Canonical identities and
// encodings must match the entire string, including its actual last character.
const exact = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
function id(value, path) {
  text(value, path);
  if (Buffer.byteLength(value, "utf8") > 1024) fail("ID_LIMIT", path, "Evidence identifiers are limited to 1024 UTF-8 bytes", "INDETERMINATE");
}
function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum) fail("INVALID_INTEGER", path, `Expected an exact integer >= ${minimum}`);
}
function snapshot(value, path) {
  if (!exact(/^git-commit-(?:sha1:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/, value)) {
    fail("INVALID_CODE_VERSION", path, "Expected an immutable full Git commit identity");
  }
}
function boundedList(value, path, maximum) {
  if (!Array.isArray(value)) fail("EXPECTED_LIST", path, "Expected a dense list");
  if (value.length > maximum) fail("EVIDENCE_LIMIT", path, "Evidence profile cardinality exhausted", "INDETERMINATE");
  list(value, path);
}

export function testClaimId(suiteId) {
  id(suiteId, "$.suite_id");
  return `test-suite.passed:${suiteId}`;
}

export function testReportDigest(report) {
  record(report, "$.report", ["suite_id", "outcome", "tests_run", "tests_failed"]);
  id(report.suite_id, "$.report.suite_id");
  integer(report.tests_run, "$.report.tests_run");
  integer(report.tests_failed, "$.report.tests_failed");
  if (!["PASSED", "FAILED", "INDETERMINATE"].includes(report.outcome)
      || report.tests_failed > report.tests_run
      || (report.outcome === "PASSED" && (report.tests_run < 1 || report.tests_failed !== 0))
      || (report.outcome === "FAILED" && report.tests_failed < 1)
      || (report.outcome === "INDETERMINATE" && report.tests_failed !== 0)) {
    fail("INVALID_TEST_REPORT", "$.report", "Outcome and test counts disagree");
  }
  return `aicore-test-report-sha256:${digest("ai-native-core/test-report/0.1", [report.suite_id, report.outcome, report.tests_run, report.tests_failed])}`;
}

// Signature payload is a fixed primitive tuple. No host code or arbitrary JSON
// canonicalization is accepted. The signature field is omitted when signing.
export function testEvidenceBytes(evidence) {
  record(evidence, "$.evidence", ["profile", "key_id", "producer_id", "subject_id", "snapshot_id", "scope",
    "method_id", "environment_id", "observed_at_ms", "expires_at_ms", "artifact_digest", "report"], ["signature"]);
  if (evidence.profile !== EVIDENCE_PROFILE) fail("UNSUPPORTED_EVIDENCE_PROFILE", "$.evidence.profile", "Unknown evidence profile");
  for (const name of ["key_id", "producer_id", "subject_id", "method_id", "environment_id"]) id(evidence[name], `$.evidence.${name}`);
  snapshot(evidence.snapshot_id, "$.evidence.snapshot_id");
  if (evidence.scope !== "state") fail("UNSUPPORTED_SCOPE", "$.evidence.scope", "Only state-scoped test evidence is supported");
  integer(evidence.observed_at_ms, "$.evidence.observed_at_ms");
  integer(evidence.expires_at_ms, "$.evidence.expires_at_ms");
  if (evidence.expires_at_ms <= evidence.observed_at_ms) fail("INVALID_VALIDITY_INTERVAL", "$.evidence.expires_at_ms", "Expiry must follow observation time");
  if (!exact(/^aicore-test-report-sha256:[0-9a-f]{64}$/, evidence.artifact_digest)) {
    fail("INVALID_ARTIFACT_DIGEST", "$.evidence.artifact_digest", "Expected a test-report digest");
  }
  testReportDigest(evidence.report);
  const tuple = [evidence.profile, evidence.key_id, evidence.producer_id, evidence.subject_id, evidence.snapshot_id, evidence.scope,
    evidence.method_id, evidence.environment_id, evidence.observed_at_ms, evidence.expires_at_ms, evidence.artifact_digest];
  return Buffer.from(`ai-native-core/test-evidence-signature/0.1\0${JSON.stringify(tuple)}`, "utf8");
}

function signatureBytes(value) {
  if (!exact(/^[A-Za-z0-9+/]{86}==$/, value)) fail("INVALID_SIGNATURE_ENCODING", "$.evidence.signature", "Expected canonical base64 for a 64-byte Ed25519 signature");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) fail("INVALID_SIGNATURE_ENCODING", "$.evidence.signature", "Noncanonical signature encoding");
  return bytes;
}
export function testEvidenceId(evidence) {
  const payload = testEvidenceBytes(evidence), signature = signatureBytes(evidence.signature);
  // Bind the actual embedded report too. Otherwise a corrupted report could
  // keep its expected manifest identity while hiding an original failure.
  const projection = [payload.toString("base64"), signature.toString("base64"), testReportDigest(evidence.report)];
  return `aicore-evidence-sha256:${digest("ai-native-core/test-evidence-id/0.1", projection)}`;
}

function prepareTrust(trust) {
  record(trust, "$.trust", ["profile", "evaluated_at_ms", "max_age_ms", "keys", "suites", "revoked_evidence_ids", "revocations_complete", "evidence_manifest"]);
  if (trust.profile !== TRUST_PROFILE) fail("UNSUPPORTED_TRUST_PROFILE", "$.trust.profile", "Unknown trusted-context profile");
  integer(trust.evaluated_at_ms, "$.trust.evaluated_at_ms");
  integer(trust.max_age_ms, "$.trust.max_age_ms", 1);
  if (typeof trust.revocations_complete !== "boolean") fail("INVALID_REVOCATION_VIEW", "$.trust.revocations_complete", "Expected an explicit closure marker");
  boundedList(trust.revoked_evidence_ids, "$.trust.revoked_evidence_ids", EVIDENCE_LIMITS.max_revocations);
  ids(trust.revoked_evidence_ids, "$.trust.revoked_evidence_ids");
  for (const evidenceId of trust.revoked_evidence_ids) if (!exact(/^aicore-evidence-sha256:[0-9a-f]{64}$/, evidenceId)) fail("INVALID_EVIDENCE_ID", "$.trust.revoked_evidence_ids", "Unknown evidence identity format");
  const manifest = trust.evidence_manifest;
  record(manifest, "$.trust.evidence_manifest", ["subject_id", "snapshot_id", "scope", "complete", "evidence_ids"]);
  id(manifest.subject_id, "$.trust.evidence_manifest.subject_id"); snapshot(manifest.snapshot_id, "$.trust.evidence_manifest.snapshot_id");
  if (manifest.scope !== "state" || typeof manifest.complete !== "boolean") fail("INVALID_EVIDENCE_MANIFEST", "$.trust.evidence_manifest", "Expected a state-scoped manifest with an explicit closure marker");
  boundedList(manifest.evidence_ids, "$.trust.evidence_manifest.evidence_ids", EVIDENCE_LIMITS.max_records);
  ids(manifest.evidence_ids, "$.trust.evidence_manifest.evidence_ids");
  for (const evidenceId of manifest.evidence_ids) if (!exact(/^aicore-evidence-sha256:[0-9a-f]{64}$/, evidenceId)) fail("INVALID_EVIDENCE_ID", "$.trust.evidence_manifest.evidence_ids", "Unknown evidence identity format");
  const keys = new Map(), keyProjection = [], suiteProjection = [];
  record(trust.keys, "$.trust.keys", [], Object.keys(trust.keys ?? {}));
  if (Object.keys(trust.keys).length > EVIDENCE_LIMITS.max_keys) fail("EVIDENCE_LIMIT", "$.trust.keys", "Too many trust anchors", "INDETERMINATE");
  for (const keyId of Object.keys(trust.keys).sort()) {
    const anchor = trust.keys[keyId];
    id(keyId, "$.trust.keys");
    record(anchor, "$.trust.keys[]", ["producer_id", "status", "public_key_pem"]);
    id(anchor.producer_id, "$.trust.keys[].producer_id");
    if (!["ACTIVE", "REVOKED", "UNKNOWN"].includes(anchor.status)) fail("INVALID_KEY_STATUS", "$.trust.keys[].status", "Unknown trust-anchor status");
    if (typeof anchor.public_key_pem !== "string" || anchor.public_key_pem.length > 4096
        || !exact(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/, anchor.public_key_pem)) {
      fail("INVALID_PUBLIC_KEY", "$.trust.keys[].public_key_pem", "Expected a public SPKI PEM key");
    }
    let key;
    try { key = createPublicKey(anchor.public_key_pem); }
    catch { fail("INVALID_PUBLIC_KEY", "$.trust.keys[].public_key_pem", "Could not parse trust anchor"); }
    if (key.asymmetricKeyType !== "ed25519") fail("UNSUPPORTED_KEY_TYPE", "$.trust.keys[].public_key_pem", "Only Ed25519 trust anchors are supported");
    keys.set(keyId, { ...anchor, key });
    keyProjection.push([keyId, anchor.producer_id, anchor.status, key.export({ format: "der", type: "spki" }).toString("base64")]);
  }
  record(trust.suites, "$.trust.suites", [], Object.keys(trust.suites ?? {}));
  if (Object.keys(trust.suites).length > EVIDENCE_LIMITS.max_suites) fail("EVIDENCE_LIMIT", "$.trust.suites", "Too many suite policies", "INDETERMINATE");
  for (const suiteId of Object.keys(trust.suites).sort()) {
    const policy = trust.suites[suiteId];
    id(suiteId, "$.trust.suites");
    record(policy, "$.trust.suites[]", ["environment_id", "min_tests", "accepted_producers"]);
    id(policy.environment_id, "$.trust.suites[].environment_id");
    integer(policy.min_tests, "$.trust.suites[].min_tests", 1);
    boundedList(policy.accepted_producers, "$.trust.suites[].accepted_producers", EVIDENCE_LIMITS.max_keys);
    ids(policy.accepted_producers, "$.trust.suites[].accepted_producers");
    policy.accepted_producers.forEach(value => id(value, "$.trust.suites[].accepted_producers"));
    suiteProjection.push([suiteId, policy.environment_id, policy.min_tests, [...policy.accepted_producers].sort()]);
  }
  const projection = [TRUST_PROFILE, trust.evaluated_at_ms, trust.max_age_ms, trust.revocations_complete,
    [...trust.revoked_evidence_ids].sort(), keyProjection, suiteProjection,
    [manifest.subject_id, manifest.snapshot_id, manifest.scope, manifest.complete, [...manifest.evidence_ids].sort()]];
  return { keys, expected: new Set(manifest.evidence_ids), revoked: new Set(trust.revoked_evidence_ids), content_id: `aicore-test-trust-sha256:${digest("ai-native-core/test-evidence-trust/0.1", projection)}` };
}

// The second argument is trusted caller context. It is not part of the model's
// evidence request. Time, accepted identities and revocation state come from it.
export function evaluateEvidence(request, trustedContext) {
  const base = { profile: EVALUATION_PROFILE, evidence_filter_id: FILTER_ID, evidence_limits: EVIDENCE_LIMITS, diagnostic_limits: DIAGNOSTIC_LIMITS };
  try {
    record(request, "$", ["profile", "evaluation", "evidence"]);
    if (request.profile !== EVALUATION_PROFILE) fail("UNSUPPORTED_PROFILE", "$.profile", "Unknown evidence-evaluation profile");
    const input = request.evaluation;
    record(input, "$.evaluation", ["profile", "vocabulary_id", "subject_id", "snapshot_id", "scope", "context", "bindings", "constraint"], ["limits"]);
    if (input.profile !== CORE_PROFILE || input.vocabulary_id !== VOCABULARY_ID) fail("UNSUPPORTED_PROFILE", "$.evaluation", "Evidence adapter requires core profile and vocabulary 0.2");
    id(input.subject_id, "$.evaluation.subject_id"); snapshot(input.snapshot_id, "$.evaluation.snapshot_id");
    if (input.scope !== "state") fail("UNSUPPORTED_SCOPE", "$.evaluation.scope", "Test evidence supports only state scope");
    boundedList(request.evidence, "$.evidence", EVIDENCE_LIMITS.max_records);
    const trust = prepareTrust(trustedContext);
    base.trust_context_id = trust.content_id; base.evaluated_at_ms = trustedContext.evaluated_at_ms;
    const manifest = trustedContext.evidence_manifest;
    if (manifest.subject_id !== input.subject_id || manifest.snapshot_id !== input.snapshot_id || manifest.scope !== input.scope) {
      fail("TRUST_SCOPE_MISMATCH", "$.trust.evidence_manifest", "Trusted evidence view must bind the exact requested subject, commit and scope");
    }
    const claims = Object.create(null), decisions = [], seen = new Set();
    for (const evidence of request.evidence) {
      const payload = testEvidenceBytes(evidence), signature = signatureBytes(evidence.signature), evidenceId = testEvidenceId(evidence);
      if (seen.has(evidenceId)) fail("DUPLICATE_EVIDENCE", "$.evidence", "The same immutable evidence record occurs more than once");
      seen.add(evidenceId);
      const failed = [], unresolved = [];
      if (!trust.expected.has(evidenceId)) failed.push("EVIDENCE_OUTSIDE_MANIFEST");
      const policy = own(trustedContext.suites, evidence.report.suite_id) ? trustedContext.suites[evidence.report.suite_id] : null;
      const anchor = trust.keys.get(evidence.key_id);
      if (evidence.subject_id !== input.subject_id) failed.push("SUBJECT_MISMATCH");
      if (evidence.snapshot_id !== input.snapshot_id) failed.push("CODE_VERSION_MISMATCH");
      if (evidence.method_id !== METHOD_ID) failed.push("UNACCEPTED_METHOD");
      if (evidence.artifact_digest !== testReportDigest(evidence.report)) failed.push("ARTIFACT_DIGEST_MISMATCH");
      if (!policy) failed.push("UNREGISTERED_SUITE");
      else {
        if (policy.environment_id !== evidence.environment_id) failed.push("ENVIRONMENT_MISMATCH");
        if (!policy.accepted_producers.includes(evidence.producer_id)) failed.push("UNACCEPTED_PRODUCER");
        // A partial run cannot establish a pass. One observed failure can
        // refute it, even when execution stopped before the minimum test count.
        if (evidence.report.tests_run < policy.min_tests && evidence.report.outcome === "PASSED") failed.push("INSUFFICIENT_TEST_COVERAGE");
      }
      if (!anchor) failed.push("UNTRUSTED_KEY");
      else {
        if (anchor.producer_id !== evidence.producer_id) failed.push("KEY_PRODUCER_MISMATCH");
        if (anchor.status === "REVOKED") failed.push("KEY_REVOKED");
        if (anchor.status === "UNKNOWN") unresolved.push("KEY_STATUS_UNKNOWN");
        let valid;
        try { valid = verify(null, payload, anchor.key, signature); }
        catch { fail("SIGNATURE_METHOD_ERROR", "$.evidence", "Signature verification could not complete", "INDETERMINATE"); }
        if (!valid) failed.push("SIGNATURE_INVALID");
      }
      const at = trustedContext.evaluated_at_ms;
      if (evidence.observed_at_ms > at) failed.push("OBSERVATION_IN_FUTURE");
      if (at >= evidence.expires_at_ms) failed.push("EVIDENCE_EXPIRED");
      if (at >= evidence.observed_at_ms && at - evidence.observed_at_ms > trustedContext.max_age_ms) failed.push("EVIDENCE_TOO_OLD");
      if (trust.revoked.has(evidenceId)) failed.push("EVIDENCE_REVOKED");
      if (!trustedContext.revocations_complete) unresolved.push("REVOCATION_VIEW_INCOMPLETE");
      const status = failed.length ? "INELIGIBLE" : unresolved.length ? "UNRESOLVED" : "ELIGIBLE";
      const claimId = testClaimId(evidence.report.suite_id);
      const stance = evidence.report.outcome === "PASSED" ? "SUPPORT" : evidence.report.outcome === "FAILED" ? "REFUTE" : "NONE";
      decisions.push({ evidence_id: evidenceId, claim_id: claimId, status,
        contribution: status === "ELIGIBLE" ? stance : "NONE", failed_checks: failed, unresolved_checks: unresolved });
      if (status === "ELIGIBLE" && stance !== "NONE") {
        claims[claimId] ??= { positive_support_ids: [], negative_support_ids: [] };
        claims[claimId][stance === "SUPPORT" ? "positive_support_ids" : "negative_support_ids"].push(evidenceId);
      }
    }
    decisions.sort((a, b) => a.evidence_id < b.evidence_id ? -1 : a.evidence_id > b.evidence_id ? 1 : 0);
    const viewProjection = [trust.content_id, input.subject_id, input.snapshot_id, input.scope,
      decisions.map(d => [d.evidence_id, d.status, d.contribution, d.failed_checks, d.unresolved_checks])];
    const viewId = `aicore-test-view-sha256:${digest("ai-native-core/test-evidence-view/0.1", viewProjection)}`;
    const missing = [...trust.expected].filter(value => !seen.has(value)).sort();
    if (!manifest.complete || missing.length) {
      const result = { ...base, evidence_view_id: viewId, completion: "INCOMPLETE_CONTEXT", effectful_gate_contribution: "DEFER",
        evidence_decisions: decisions, missing_evidence_ids: missing,
        diagnostics: [{ code: "EVIDENCE_MANIFEST_INCOMPLETE", path: "$.evidence", message: "The trusted evidence manifest is incomplete or required evidence records are missing" }] };
      assertResultBudget(result);
      return result;
    }
    const evaluation = evaluate({ ...input, claims, evidence_view_id: viewId });
    const used = new Set((evaluation.observations ?? []).filter(x => x.claim_id).map(x => x.claim_id));
    const blocked = [...new Set(decisions.filter(d => d.status === "UNRESOLVED" && used.has(d.claim_id)).map(d => d.claim_id))].sort();
    let result;
    if (blocked.length && evaluation.completion === "COMPLETE") {
      result = { ...base, evidence_view_id: viewId, completion: "INCOMPLETE_CONTEXT", effectful_gate_contribution: "DEFER", evidence_decisions: decisions,
        blocked_claim_ids: blocked, diagnostics: [{ code: "EVIDENCE_ELIGIBILITY_UNRESOLVED", path: "$.evidence", message: "A used claim has unresolved evidence eligibility; no complete constraint result is returned" }] };
    } else {
      result = { ...base, evidence_view_id: viewId, completion: evaluation.completion, effectful_gate_contribution: evaluation.effectful_gate_contribution,
        evidence_decisions: decisions, evaluation };
    }
    try { assertResultBudget(result); return result; }
    catch (budgetError) {
      if (!(budgetError instanceof EvaluationError) || budgetError.code !== "DIAGNOSTIC_LIMIT") throw budgetError;
      const completion = result.completion === "COMPLETE" ? "INDETERMINATE" : result.completion;
      return { ...base, completion, effectful_gate_contribution: contribution(completion),
        diagnostics: [{ code: "DIAGNOSTIC_LIMIT", path: "$", cause_code: evaluation.diagnostics?.[0]?.code ?? "WRAPPER_RESULT_LIMIT",
          message: "Evidence/constraint result exceeds diagnostic budget; payload omitted" }] };
    }
  } catch (error) {
    if (!(error instanceof EvaluationError)) throw error;
    const result = { ...base, completion: error.completion, effectful_gate_contribution: contribution(error.completion),
      diagnostics: [{ code: error.code, path: error.path, message: error.message }] };
    try { assertResultBudget(result); return result; }
    catch (budgetError) {
      if (!(budgetError instanceof EvaluationError)) throw budgetError;
      return { profile: EVALUATION_PROFILE, evidence_filter_id: FILTER_ID, completion: error.completion, effectful_gate_contribution: contribution(error.completion),
        diagnostics: [{ code: "DIAGNOSTIC_LIMIT", path: "$", cause_code: error.code, message: "Failure payload exceeds diagnostic budget; payload omitted" }] };
    }
  }
}
