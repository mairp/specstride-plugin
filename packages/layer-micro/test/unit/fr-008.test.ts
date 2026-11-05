/**
 * CT-115-8 (T013, F115-FR-008) — the checkpoint contract block: protected,
 * byte-stable, content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkpointContractBlock,
  blockIsByteStable,
} from "../../src/callpoints/contribute-prompt.ts";
import { registerLayerMicro } from "../../src/register.ts";

test("CT-115-8: the block is protected and stable", () => {
  const block = checkpointContractBlock();
  assert.equal(block.protected, true);
  assert.equal(block.stability, "stable");
  assert.equal(block.writer, "layer-micro");
  assert.ok(registerLayerMicro().promptBlocks.includes(block.id));
});

test("CT-115-8: the block is byte-stable inside a run", () => {
  assert.equal(blockIsByteStable(), true);
  const first = checkpointContractBlock();
  const second = checkpointContractBlock();
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.hash, second.hash);
  assert.equal(first.text, second.text);
});

test("CT-115-8: the block says how a unit is declared and how the pass ends", () => {
  const text = checkpointContractBlock().text;
  assert.match(text, /task ids of the current phase/);
  assert.match(text, /criterion indexes/);
  assert.match(text, /5 to 15 minutes/);
  assert.match(text, /group tasks/);
  assert.match(text, /pass ends after the checkpoint/);
});
