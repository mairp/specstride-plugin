/**
 * T138 (F115-FR-008; F115-FR-038) — the byte budgets of the build: the
 * `[LOOP]` line is at most 300 bytes, the checkpoint contract block at most
 * 1,500 bytes. Both are measured on what the build actually emits: the
 * rendered line for the widest report the layer can produce, and the block
 * as the prompt provider contributes it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLoopLine } from "../../src/callpoints/report.ts";
import { checkpointContractBlock } from "../../src/callpoints/contribute-prompt.ts";
import { FALLBACK_REASONS } from "../../src/strategy/fallback.ts";

/** The limit of F115-FR-038 for the `[LOOP]` line. */
const LOOP_LINE_BUDGET = 300;
/** The limit of F115-FR-008 for the checkpoint contract block. */
const CHECKPOINT_BLOCK_BUDGET = 1_500;

test("T138: the [LOOP] line is at most 300 bytes, for the widest report there is", () => {
  let widest = "";
  let widestBytes = 0;
  // Every containment level, every fallback reason, `,basic` protection and
  // the largest counts that fit the counters: the widest line the layer
  // could ever print must still fit the budget.
  for (const containment of ["C0", "C1", "C2", "C3"] as const) {
    for (const fallback of ["none", ...FALLBACK_REASONS] as const) {
      const line = renderLoopLine({
        containment,
        protection: "detect",
        protectionBasic: true,
        units: 999,
        pass: 999,
        fail: 999,
        unchecked: 999,
        tainted: 999,
        cycles: 99999,
        disengaged: 999,
        escalations: 999,
        failfastStops: 999,
        fallback,
      });
      assert.ok(line !== undefined);
      const bytes = Buffer.byteLength(line, "utf8");
      if (bytes > widestBytes) {
        widestBytes = bytes;
        widest = line;
      }
      assert.ok(
        bytes <= LOOP_LINE_BUDGET,
        `the [LOOP] line is ${bytes} bytes, over the budget of ${LOOP_LINE_BUDGET}: ${line}`,
      );
    }
  }
  assert.ok(widestBytes > 0);
  assert.match(widest, /^\[LOOP\] /);
});

test("T138: the checkpoint contract block is at most 1,500 bytes", () => {
  const block = checkpointContractBlock();
  assert.equal(block.bytes, Buffer.byteLength(block.text, "utf8"));
  assert.ok(
    block.bytes <= CHECKPOINT_BLOCK_BUDGET,
    `the checkpoint contract block is ${block.bytes} bytes, over the budget of ${CHECKPOINT_BLOCK_BUDGET}`,
  );
  // The hash travels with the block, and the block is byte-stable (F115-FR-008).
  assert.equal(block.bytes, checkpointContractBlock().bytes);
  assert.equal(block.hash, checkpointContractBlock().hash);
});
