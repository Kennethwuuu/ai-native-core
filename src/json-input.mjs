import { EvaluationError } from "./validation.mjs";

// JSON.parse alone silently overwrites duplicate keys. Keep that ambiguity out
// of the CLI boundary, without interpreting source text as executable code.
export function parseInput(source) {
  if (typeof source !== "string") throw new EvaluationError("INVALID", "INVALID_JSON", "$", "Expected JSON text");
  let offset = 0, nodes = 0;
  const error = (code, message, completion = "INVALID") => {
    throw new EvaluationError(completion, code, `$@${offset}`, message);
  };
  const whitespace = () => { while (/[ \t\r\n]/.test(source[offset] ?? "!")) offset++; };
  function string() {
    const start = offset++;
    while (offset < source.length) {
      const ch = source[offset++];
      if (ch === "\\") { offset++; continue; }
      if (ch === '"') {
        try {
          const value = JSON.parse(source.slice(start, offset));
          if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) error("INVALID_UNICODE", "Unpaired surrogate");
          return value;
        } catch (e) {
          if (e instanceof EvaluationError) throw e;
          error("INVALID_JSON", "Malformed JSON string");
        }
      }
    }
    error("INVALID_JSON", "Unterminated string");
  }
  function value(depth) {
    whitespace();
    if (depth > 160 || ++nodes > 50000) error("INPUT_LIMIT", "JSON structural limit exhausted", "INDETERMINATE");
    const ch = source[offset];
    if (ch === '"') return string();
    if (ch === "{" || ch === "[") {
      const object = ch === "{";
      const result = object ? Object.create(null) : [];
      const closing = object ? "}" : "]";
      offset++; whitespace();
      if (source[offset] === closing) { offset++; return result; }
      while (true) {
        whitespace();
        let key;
        if (object) {
          if (source[offset] !== '"') error("INVALID_JSON", "Expected an object key");
          key = string(); whitespace();
          if (Object.hasOwn(result, key)) error("DUPLICATE_JSON_KEY", `Duplicate key: ${key}`);
          if (source[offset++] !== ":") error("INVALID_JSON", "Expected colon");
        }
        const item = value(depth + 1);
        if (object) result[key] = item; else result.push(item);
        whitespace();
        if (source[offset] === closing) { offset++; return result; }
        if (source[offset++] !== ",") error("INVALID_JSON", "Expected comma or closing delimiter");
      }
    }
    for (const [token, item] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, offset)) { offset += token.length; return item; }
    }
    const number = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (number) {
      offset += number[0].length;
      const parsed = Number(number[0]);
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(number[0]) || !Number.isSafeInteger(parsed) || Object.is(parsed, -0)) {
        error("INVALID_JSON_NUMBER", "This profile permits only exact Int53 integer tokens, excluding -0");
      }
      return parsed;
    }
    error("INVALID_JSON", "Expected a JSON value");
  }
  const result = value(0);
  whitespace();
  if (offset !== source.length) error("INVALID_JSON", "Trailing input");
  return result;
}
