import { fail, list, record, typed } from "./validation.mjs";

// JCS-compatible serialization on the deliberately narrower Int53/scalar-string
// JSON domain. No floating-point, toJSON, Unicode normalization, or host values.
export function canonicalJson(value, maxBytes = 4 * 1024 * 1024) {
  const parts = [];
  let bytes = 0, nodes = 0;
  const append = part => {
    bytes += Buffer.byteLength(part, "utf8");
    if (bytes > maxBytes) fail("CANONICAL_LIMIT", "$", "Canonical byte budget exhausted", "INDETERMINATE");
    parts.push(part);
  };
  function visit(item, depth) {
    if (depth > 128 || ++nodes > 50000) fail("CANONICAL_LIMIT", "$", "Canonical structure budget exhausted", "INDETERMINATE");
    if (item === null || typeof item === "boolean") append(JSON.stringify(item));
    else if (typeof item === "string") { typed({ type: "String", value: item }, "$"); append(JSON.stringify(item)); }
    else if (typeof item === "number") { typed({ type: "Int53", value: item }, "$"); append(JSON.stringify(item)); }
    else if (Array.isArray(item)) {
      list(item, "$"); append("[");
      item.forEach((child, i) => { if (i) append(","); visit(child, depth + 1); });
      append("]");
    } else {
      record(item, "$", [], Object.keys(item ?? {})); append("{");
      Object.keys(item).sort().forEach((key, i) => {
        typed({ type: "String", value: key }, "$");
        if (i) append(","); append(JSON.stringify(key)); append(":"); visit(item[key], depth + 1);
      });
      append("}");
    }
  }
  visit(value, 0);
  return parts.join("");
}
