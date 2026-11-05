/**
 * T001 — the layout witness of the inspect directory (F119-FR-056).
 *
 * Phase 1 creates the module layout only: the inspect directory exists, is
 * importable, and carries its layout marker. The verbs (`tail`, `events`,
 * `verdicts`, `feedback`, `phases`, `watch`) land with the later phases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { INSPECT_LAYOUT } from "../../src/inspect/index.ts";

test("T001: the inspect directory of the layout is importable and marked", () => {
  assert.equal(INSPECT_LAYOUT, "119-front-door-and-presenter/inspect");
});
