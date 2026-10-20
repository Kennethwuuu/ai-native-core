#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { evaluate, EvaluationError, PROFILE } from "../src/evaluator.mjs";
import { parseInput } from "../src/json-input.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: node bin/aicore.mjs evaluate <request.json|->\nPure experimental constraint evaluation; no external actions or authorization.");
} else {
  try {
    if (args.length !== 2 || args[0] !== "evaluate") throw new EvaluationError("INVALID", "USAGE", "$", "Usage: aicore evaluate <request.json|->");
    const chunks = [];
    let bytes = 0;
    const stream = args[1] === "-" ? process.stdin : createReadStream(args[1]);
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new EvaluationError("INDETERMINATE", "INPUT_LIMIT", "$", "Input exceeds 1 MiB");
      chunks.push(chunk);
    }
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new EvaluationError("INVALID", "INVALID_UTF8", "$", "Input must be UTF-8"); }
    const result = evaluate(parseInput(source));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.completion === "COMPLETE" ? 0 : result.completion === "INVALID" ? 2 : 3;
  } catch (error) {
    const known = error instanceof EvaluationError;
    const io = !known && typeof error.code === "string";
    const completion = known ? error.completion : io ? "INVALID" : "INDETERMINATE";
    console.log(JSON.stringify({ profile: PROFILE, completion,
      effectful_gate_contribution: completion === "INVALID" ? "DENY" : "DEFER",
      diagnostics: [{ code: known ? error.code : io ? "INPUT_ERROR" : "INTERNAL_ERROR", path: known ? error.path : "$", message: error.message }],
    }, null, 2));
    process.exitCode = completion === "INVALID" ? 2 : 3;
  }
}
