/**
 * `endProcessGroup` refuses a group id that would reach beyond one group: `kill(0)`
 * signals the caller's own group and `kill(-1)` every process the caller may signal,
 * which as root is the whole host (2026-10-02). The refusal sends no signal at all.
 * The test runs in a PID namespace as root (tests/isolate.ts), so a regression that
 * signals 1 or 0 here ends only this run, never the host.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endProcessGroup } from "../src/command/kind-command.ts";

describe("endProcessGroup refuses a group id that is not an integer above one", () => {
  for (const group of [1, 0, -1, -2, 1.5, Number.NaN]) {
    it(`refuses ${group} without a signal`, () => {
      assert.equal(endProcessGroup(group, "SIGCONT"), false);
    });
  }
});
