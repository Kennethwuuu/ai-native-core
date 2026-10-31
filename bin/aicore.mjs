#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { evaluate, EvaluationError, PROFILE } from "../src/evaluator.mjs";
import { parseInput } from "../src/json-input.mjs";
import { domainContentId, closureClaimId } from "../src/domains.mjs";
import { evaluateEvidence, EVALUATION_PROFILE } from "../src/test-evidence.mjs";
import { canonicalJson } from "../src/canonical-json.mjs";
import { normalizeBlock, expandBlock, compactBlock, projectBlock, assessBlock, AUDIT_PROFILE, ASSESSMENT_PROFILE } from "../src/blocks.mjs";

async function readJson(path, maximum = 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  const stream = path === "-" ? process.stdin : createReadStream(path);
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maximum) throw new EvaluationError("INDETERMINATE", "INPUT_LIMIT", "$", `Input exceeds ${maximum / 1048576} MiB`);
    chunks.push(chunk);
  }
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new EvaluationError("INVALID", "INVALID_UTF8", "$", "Input must be UTF-8"); }
  return parseInput(source);
}

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(`Commands:
  evaluate <request|->
  domain-id <request|-> <id>
  evaluate-evidence <request|-> <trust-file>
  block-id <block|->
  expand-block <compact|->
  compact-block <audit|->
  project-block <block|-> <export> [max-bytes]
  assess-block <block|-> <runtime|-> <authority-file>
Pure experimental assessment; no external actions or authorization.`);
} else {
  try {
    const counts = { evaluate: [2], "domain-id": [3], "evaluate-evidence": [3], "block-id": [2], "expand-block": [2], "compact-block": [2], "project-block": [3, 4], "assess-block": [4] };
    if (!Object.hasOwn(counts, args[0]) || !counts[args[0]].includes(args.length)) {
      throw new EvaluationError("INVALID", "USAGE", "$", "Use --help for supported command forms");
    }
    if ((args[0] === "evaluate-evidence" && args[2] === "-") || (args[0] === "assess-block" && args[3] === "-")) throw new EvaluationError("INVALID", "TRUST_SOURCE_REQUIRED", "$", "Trusted context must come from a separate caller-selected file");
    if (args[0] === "assess-block" && args[1] === "-" && args[2] === "-") throw new EvaluationError("INVALID", "AMBIGUOUS_STDIN", "$", "Only one Block/runtime input may use stdin");
    const codec = ["block-id", "expand-block", "compact-block", "project-block"].includes(args[0]);
    const request = await readJson(args[1], codec || args[0] === "assess-block" ? 4 * 1024 * 1024 : 1024 * 1024);
    if (codec) {
      let result;
      if (args[0] === "block-id") {
        const compact = request?.profile === AUDIT_PROFILE ? compactBlock(request) : normalizeBlock(request);
        result = { block_id: compact.block_id, block_content_id: compact.block_content_id };
      } else if (args[0] === "expand-block") result = expandBlock(request);
      else if (args[0] === "compact-block") result = compactBlock(request);
      else result = projectBlock(request, args[2], args[3] === undefined ? 65536 : parseInput(args[3]));
      console.log(canonicalJson(result));
      process.exitCode = result.completeness === "INCOMPLETE" ? 3 : 0;
    } else if (args[0] === "domain-id") {
      if (!request?.domains || !Object.hasOwn(request.domains, args[2])) throw new EvaluationError("INVALID", "MISSING_DOMAIN", "$.domains", "Requested domain is unavailable");
      const content_id = domainContentId(args[2], request.domains[args[2]]);
      console.log(JSON.stringify({ domain_id: args[2], content_id, closure_claim_id: closureClaimId(content_id) }, null, 2));
    } else {
      const result = args[0] === "assess-block" ? assessBlock(request, await readJson(args[2]), await readJson(args[3]))
        : args[0] === "evaluate-evidence" ? evaluateEvidence(request, await readJson(args[2])) : evaluate(request);
      console.log(JSON.stringify(result));
      process.exitCode = result.completion === "COMPLETE" ? 0 : result.completion === "INVALID" ? 2 : 3;
    }
  } catch (error) {
    const known = error instanceof EvaluationError;
    const io = !known && typeof error.code === "string";
    const completion = known ? error.completion : io ? "INVALID" : "INDETERMINATE";
    console.log(JSON.stringify({ profile: args[0] === "assess-block" ? ASSESSMENT_PROFILE : args[0] === "evaluate-evidence" ? EVALUATION_PROFILE : PROFILE, completion,
      effectful_gate_contribution: completion === "INVALID" ? "DENY" : "DEFER",
      diagnostics: [{ code: known ? error.code : io ? "INPUT_ERROR" : "INTERNAL_ERROR", path: known ? error.path : "$", message: error.message }],
    }, null, 2));
    process.exitCode = completion === "INVALID" ? 2 : 3;
  }
}
