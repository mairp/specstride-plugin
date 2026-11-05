/**
 * T004 — the product-line writer: JSON-quoted text values and the byte cap
 * with the `[SPECSTRIDE-TRUNCATED]` line (F119-FR-030, F119-FR-031).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SUCCESS_BYTE_LIMIT,
  FAILURE_BYTE_LIMIT,
  quoteValue,
  productLine,
  errorLine,
  byteLimitOf,
  capOutput,
  openLineWriter,
} from "../../src/output/lines.ts";

test("T004: a text value is quoted as in JSON (annex G §G.3)", () => {
  assert.equal(quoteValue("run the engine once"), '"run the engine once"');
  assert.equal(quoteValue('say "hello"'), '"say \\"hello\\""');
  assert.equal(quoteValue("new\nline"), '"new\\nline"');
  assert.equal(quoteValue(3), "3");
  assert.equal(quoteValue(true), "true");
});

test("T004: a product line carries the label and the pairs in order", () => {
  assert.equal(
    productLine("[SPECSTRIDE-TAIL]", [
      ["name", "engine-log"],
      ["bytes", 12],
      ["lines", 2],
    ]),
    '[SPECSTRIDE-TAIL] name="engine-log" bytes=12 lines=2',
  );
});

test("T004: the failure line has the closed fix text (F119-FR-030)", () => {
  assert.equal(
    errorLine("events", "no-state"),
    '[SPECSTRIDE-ERROR] cmd="events" reason="no-state" fix="run the engine once, or pass --feature to name the run"',
  );
});

test("T004: the byte limits are 1,120 and 2,240 (F119-FR-031)", () => {
  assert.equal(SUCCESS_BYTE_LIMIT, 1120);
  assert.equal(FAILURE_BYTE_LIMIT, 2240);
  assert.equal(byteLimitOf({ failure: false }), 1120);
  assert.equal(byteLimitOf({ failure: true }), 2240);
  assert.equal(byteLimitOf({ failure: false, verbose: true }), Number.POSITIVE_INFINITY);
  assert.equal(byteLimitOf({ failure: true, verbose: true }), 2240);
  assert.equal(byteLimitOf({ failure: false, follows: true }), Number.POSITIVE_INFINITY);
});

test("T004: output under the limit is untouched", () => {
  const out = capOutput("[SPECSTRIDE-TAIL] name=x\n", SUCCESS_BYTE_LIMIT);
  assert.equal(out.truncated, false);
  assert.equal(out.left, 0);
  assert.equal(out.text, "[SPECSTRIDE-TAIL] name=x\n");
});

test("T004: output over the limit is cut and ends with the truncation line", () => {
  const big = `${"x".repeat(2000)}\n`;
  const out = capOutput(big, SUCCESS_BYTE_LIMIT);
  assert.equal(out.truncated, true);
  const lines = out.text.trimEnd().split("\n");
  assert.match(lines[lines.length - 1], /^\[SPECSTRIDE-TRUNCATED\] left=\d+ more="--verbose"$/);
  assert.ok(Buffer.byteLength(out.text) <= SUCCESS_BYTE_LIMIT);
  // left counts what was cut: kept + left = original bytes.
  const kept = Buffer.byteLength(out.text) - Buffer.byteLength(`${lines[lines.length - 1]}\n`);
  const left = Number(lines[lines.length - 1].match(/left=(\d+)/)?.[1]);
  assert.equal(kept + left, Buffer.byteLength(big));
});

test("T004: the writer caps stdout and stderr together (F119-FR-031)", () => {
  const writer = openLineWriter({ failure: false });
  writer.line(productLine("[SPECSTRIDE-PHASES]", [["phases", 4]]));
  for (let i = 0; i < 40; i += 1) {
    writer.line(`[SPECSTRIDE-EVENT] seq=${i} type="milestone" phase=${i} attempt=1`);
  }
  writer.error("phases", "no-state");
  const out = writer.finish();
  assert.equal(out.truncated, true);
  assert.ok(Buffer.byteLength(out.text) <= SUCCESS_BYTE_LIMIT);
  assert.match(out.text, /\[SPECSTRIDE-TRUNCATED\]/);
});

test("T004: a failure call keeps up to 2,240 bytes", () => {
  const writer = openLineWriter({ failure: true });
  for (let i = 0; i < 40; i += 1) {
    writer.line(`[SPECSTRIDE-EVENT] seq=${i} type="milestone" phase=${i} attempt=1`);
  }
  const out = writer.finish();
  assert.ok(Buffer.byteLength(out.text) <= FAILURE_BYTE_LIMIT);
});

test("T004: --verbose lifts the cap on a success", () => {
  const writer = openLineWriter({ failure: false, verbose: true });
  writer.line("x".repeat(5000));
  const out = writer.finish();
  assert.equal(out.truncated, false);
});
