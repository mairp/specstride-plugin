/**
 * T001 — the layout witness of the output directory (F119-FR-056).
 *
 * Phase 1 creates the module layout only: the output directory exists, is
 * importable, and carries its layout marker. The two output modes (the
 * compatibility writer and the default writer of closed fields) land with
 * T004 to T006.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_LAYOUT } from "../../src/output/index.ts";

test("T001: the output directory of the layout is importable and marked", () => {
  assert.equal(OUTPUT_LAYOUT, "119-front-door-and-presenter/output");
});
