#!/usr/bin/env node
// Static representation experiment only: bytes are not model tokens or proof
// that an AI will understand or modify the representation more accurately.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseInput } from "../src/json-input.mjs";
import { canonicalJson } from "../src/canonical-json.mjs";
import { normalizeBlock, expandBlock, compactBlock, projectBlock } from "../src/blocks.mjs";

const file = process.argv[2] ?? new URL("../examples/review-readiness.block.json", import.meta.url);
const focus = process.argv[3] ?? "prepare_review";
const compact = normalizeBlock(parseInput(await readFile(file, "utf8")));
const audit = expandBlock(compact), context = projectBlock(compact, focus);
assert.equal(canonicalJson(compactBlock(audit)), canonicalJson(compact));
const bytes = value => Buffer.byteLength(canonicalJson(value), "utf8");
console.log(JSON.stringify({
  profile: "aicore.block-measurement/0.1", block_content_id: compact.block_content_id,
  scope: "Static data for one example; no token or model-performance claim", focus_export: focus,
  compact: { canonical_bytes: bytes(compact), constraints: Object.keys(compact.constraints).length },
  audit: { canonical_bytes: bytes(audit), constraints: Object.keys(audit.nodes).length },
  static_context: { canonical_bytes: bytes(context), completeness: context.completeness,
    constraints: Object.keys(context.constraints ?? {}).length, cuts: context.cuts?.length ?? 0 },
  round_trip_verified: true,
}, null, 2));
