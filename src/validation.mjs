export class EvaluationError extends Error {
  constructor(completion, code, path, message) {
    super(message);
    Object.assign(this, { completion, code, path });
  }
}
export const fail = (code, path, message, completion = "INVALID") => {
  throw new EvaluationError(completion, code, path, message);
};
export const own = (x, key) => Object.hasOwn(x, key);
export const VALUE_TYPES = Object.freeze(["Bool2", "Int53", "String", "ClaimId"]);
const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export function record(x, path, required, optional = []) {
  if (x === null || typeof x !== "object" || Array.isArray(x)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(x))) {
    fail("EXPECTED_RECORD", path, "Expected a plain record");
  }
  for (const key of required) if (!own(x, key)) fail("MISSING_FIELD", `${path}.${key}`, "Required field is missing");
  for (const key of Object.keys(x)) {
    if (!required.includes(key) && !optional.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "Unknown field");
  }
}
export function text(x, path) {
  if (typeof x !== "string" || !x.length || unpairedSurrogate.test(x)) {
    fail("EXPECTED_ID", path, "Expected a nonempty Unicode scalar string");
  }
}
export function ids(x, path) {
  list(x, path);
  x.forEach((id, i) => text(id, `${path}[${i}]`));
  if (new Set(x).size !== x.length) fail("DUPLICATE_ID", path, "Duplicate identifier");
}
export function list(x, path) {
  if (!Array.isArray(x)) fail("EXPECTED_LIST", path, "Expected a dense list");
  for (let i = 0; i < x.length; i++) {
    if (!own(x, i)) fail("SPARSE_LIST", `${path}[${i}]`, "Missing array slots are not JSON values");
  }
}
export function typed(x, path) {
  record(x, path, ["type", "value"]);
  if (x.type === "Bool2" && typeof x.value === "boolean") return x;
  if (x.type === "Int53" && Number.isSafeInteger(x.value) && !Object.is(x.value, -0)) return x;
  if (x.type === "String" && typeof x.value === "string" && !unpairedSurrogate.test(x.value)) return x;
  if (x.type === "ClaimId" && typeof x.value === "string" && x.value.length && !unpairedSurrogate.test(x.value)) return x;
  fail("INVALID_TYPED_VALUE", path, "Expected Bool2, bounded Int53, Unicode scalar String, or nonempty ClaimId; no coercion");
}
