import { fail } from "./validation.mjs";

// Implementation ceilings, separate from the language's AST/atom budgets.
export const DIAGNOSTIC_LIMITS = Object.freeze({ max_support_references: 10000, max_result_bytes: 4 * 1024 * 1024 });

// Count compact UTF-8 JSON incrementally. Do not construct a potentially huge
// complete JSON string just to discover that it exceeds the result ceiling.
export function assertResultBudget(result, maxBytes = DIAGNOSTIC_LIMITS.max_result_bytes) {
  let bytes = 0;
  const add = n => {
    bytes += n;
    if (bytes > maxBytes) fail("DIAGNOSTIC_LIMIT", "$", "Compact result exceeds diagnostic byte budget", "INDETERMINATE");
  };
  function visit(value) {
    if (value === null || typeof value !== "object") {
      add(Buffer.byteLength(JSON.stringify(value), "utf8"));
    } else if (Array.isArray(value)) {
      add(2);
      value.forEach((item, i) => { if (i) add(1); visit(item); });
    } else {
      add(2);
      Object.entries(value).forEach(([key, item], i) => {
        if (i) add(1);
        add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        visit(item);
      });
    }
  }
  visit(result);
  return bytes;
}
