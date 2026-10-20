import { createHash } from "node:crypto";
import { fail, record, text, typed, list, VALUE_TYPES } from "./validation.mjs";

export const MAX_DOMAIN_MEMBERS = 1000;
export const DOMAIN_HASH_LABEL = "ai-native-core/finite-domain/0.1\0";

export function validateDomain(id, domain, path = "$.domain", maxMembers = MAX_DOMAIN_MEMBERS) {
  text(id, path);
  record(domain, path, ["subject_id", "snapshot_id", "scope", "element_type", "members"], ["content_id"]);
  text(domain.subject_id, `${path}.subject_id`);
  text(domain.snapshot_id, `${path}.snapshot_id`);
  if (domain.scope !== "state") fail("UNSUPPORTED_SCOPE", `${path}.scope`, "Domain scope must be state");
  if (!VALUE_TYPES.includes(domain.element_type)) fail("UNKNOWN_TYPE", `${path}.element_type`, "Unsupported domain element type");
  if (!Array.isArray(domain.members)) fail("EXPECTED_LIST", `${path}.members`, "Expected finite ordered members");
  if (domain.members.length > maxMembers) fail("DOMAIN_LIMIT", `${path}.members`, "Domain cardinality budget exhausted", "INDETERMINATE");
  list(domain.members, `${path}.members`);
  const seen = new Set();
  domain.members.forEach((value, index) => {
    typed({ type: domain.element_type, value }, `${path}.members[${index}]`);
    const identity = JSON.stringify(value);
    if (seen.has(identity)) fail("DUPLICATE_MEMBER", `${path}.members[${index}]`, "Domain is a set with a declared enumeration order");
    seen.add(identity);
  });
}

// A deliberately restricted tuple encoding, not a general JCS implementation
// or a Program/Block content identity. Order is part of the enumeration snapshot.
export function domainContentId(id, domain) {
  validateDomain(id, domain);
  const tuple = [id, domain.subject_id, domain.snapshot_id, domain.scope, domain.element_type, domain.members];
  const hex = createHash("sha256").update(DOMAIN_HASH_LABEL, "utf8").update(JSON.stringify(tuple), "utf8").digest("hex");
  return `aicore-domain-sha256:${hex}`;
}

export const closureClaimId = (contentId) => `domain.closed:${contentId}`;
