#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { evaluate, EvaluationError, PROFILE } from "../src/evaluator.mjs";
import { parseInput } from "../src/json-input.mjs";
import { domainContentId, closureClaimId } from "../src/domains.mjs";
import { evaluateEvidence, EVALUATION_PROFILE } from "../src/test-evidence.mjs";

async function readJson(path) {
  const chunks = [];
  let bytes = 0;
  const stream = path === "-" ? process.stdin : createReadStream(path);
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new EvaluationError("INDETERMINATE", "INPUT_LIMIT", "$", "Input exceeds 1 MiB");
    chunks.push(chunk);
  }
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new EvaluationError("INVALID", "INVALID_UTF8", "$", "Input must be UTF-8"); }
  return parseInput(source);
}

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: node bin/aicore.mjs evaluate <request.json|->\n       node bin/aicore.mjs domain-id <request.json|-> <domain-id>\n       node bin/aicore.mjs evaluate-evidence <request.json|-> <trusted-context.json>\nPure experimental constraint evaluation; no external actions or authorization.");
} else {
  try {
    if (!((args.length === 2 && args[0] === "evaluate") || (args.length === 3 && ["domain-id", "evaluate-evidence"].includes(args[0])))) {
      throw new EvaluationError("INVALID", "USAGE", "$", "Use evaluate <request|->, domain-id <request|-> <id>, or evaluate-evidence <request|-> <trusted-context.json>");
    }
    if (args[0] === "evaluate-evidence" && args[2] === "-") throw new EvaluationError("INVALID", "TRUST_SOURCE_REQUIRED", "$", "Trusted context must come from a separate caller-selected file");
    const request = await readJson(args[1]);
    if (args[0] === "domain-id") {
      if (!request?.domains || !Object.hasOwn(request.domains, args[2])) throw new EvaluationError("INVALID", "MISSING_DOMAIN", "$.domains", "Requested domain is unavailable");
      const content_id = domainContentId(args[2], request.domains[args[2]]);
      console.log(JSON.stringify({ domain_id: args[2], content_id, closure_claim_id: closureClaimId(content_id) }, null, 2));
    } else {
      const result = args[0] === "evaluate-evidence" ? evaluateEvidence(request, await readJson(args[2])) : evaluate(request);
      console.log(JSON.stringify(result));
      process.exitCode = result.completion === "COMPLETE" ? 0 : result.completion === "INVALID" ? 2 : 3;
    }
  } catch (error) {
    const known = error instanceof EvaluationError;
    const io = !known && typeof error.code === "string";
    const completion = known ? error.completion : io ? "INVALID" : "INDETERMINATE";
    console.log(JSON.stringify({ profile: args[0] === "evaluate-evidence" ? EVALUATION_PROFILE : PROFILE, completion,
      effectful_gate_contribution: completion === "INVALID" ? "DENY" : "DEFER",
      diagnostics: [{ code: known ? error.code : io ? "INPUT_ERROR" : "INTERNAL_ERROR", path: known ? error.path : "$", message: error.message }],
    }, null, 2));
    process.exitCode = completion === "INVALID" ? 2 : 3;
  }
}
