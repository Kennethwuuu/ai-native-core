#!/usr/bin/env python3
"""Independent primitive-tuple encoding oracle for well-formed test evidence.

This checks serialization/content identities, not signature verification,
trust-policy validity, revocation, or the evaluator's typed boundary.
"""
import base64
import hashlib
import json
import sys


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def signature_payload(evidence):
    fields = ["profile", "key_id", "producer_id", "subject_id", "snapshot_id", "scope",
              "method_id", "environment_id", "observed_at_ms", "expires_at_ms", "artifact_digest"]
    return b"ai-native-core/test-evidence-signature/0.1\x00" + compact([evidence[key] for key in fields])


def identities(evidence):
    report = evidence["report"]
    report_tuple = [report[key] for key in ("suite_id", "outcome", "tests_run", "tests_failed")]
    artifact = hashlib.sha256(b"ai-native-core/test-report/0.1\x00" + compact(report_tuple)).hexdigest()
    signature = base64.b64decode(evidence["signature"], validate=True)
    if len(signature) != 64 or base64.b64encode(signature).decode("ascii") != evidence["signature"]:
        raise ValueError("noncanonical Ed25519 signature")
    payload = signature_payload(evidence)
    identity_tuple = [base64.b64encode(payload).decode("ascii"), evidence["signature"], "aicore-test-report-sha256:" + artifact]
    identity = hashlib.sha256(b"ai-native-core/test-evidence-id/0.1\x00" + compact(identity_tuple)).hexdigest()
    return {"artifact_digest": "aicore-test-report-sha256:" + artifact,
            "signature_payload_sha256": hashlib.sha256(payload).hexdigest(),
            "evidence_id": "aicore-evidence-sha256:" + identity}


if __name__ == "__main__":
    print(json.dumps([identities(record) for record in json.load(sys.stdin)["evidence"]]))
