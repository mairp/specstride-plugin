/**
 * The own test of the seam the baseline run of 2026-11-02 exposed
 * (`results/baseline.md`, bug 3): the final line of F101-FR-018 (B-0232)
 * carried the START time of a 62-minute resumed run, because the
 * composition root baked `new Date().toISOString()` into the engine
 * services before the first phase ran, and the loop printed that string
 * at the end.
 *
 * Pins: the run loop reads its clock WHEN the final line is written, after
 * the last phase of the run ended — never before the phases run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runLoop } from "../src/engine/run-loop.ts";
import type { StartPosition } from "../src/engine/start-position.ts";

const position: StartPosition = Object.freeze({
  startPhase: 2,
  origin: "derived",
  phasesToRun: Object.freeze([2, 3]),
  everyPhaseWasApprovedBefore: false,
  approvedBefore: Object.freeze([1]),
  integrityEvents: Object.freeze([]),
});

test("the final line reads the clock at the end of the run, not at its start", async () => {
  let phasesEnded = 0;
  let clockReads = 0;
  const lines: string[] = [];
  const end = await runLoop(
    {
      position,
      phaseCount: 3,
      time: (): string => {
        clockReads += 1;
        return phasesEnded === 2 ? "05:51:31" : "04:49:04";
      },
    },
    {
      releaseVerification: async () => ({
        passed: true,
        notRequired: true,
        summary: "not required",
      }),
      runOnePhase: async () => {
        phasesEnded += 1;
        return { outcome: "approved" as const, ordinal: phasesEnded };
      },
      emitRunEnd: () => undefined,
      writeLine: (line: string) => {
        lines.push(line);
      },
      logReleaseVerification: () => undefined,
    },
  );
  assert.equal(end.ended, "all-approved");
  assert.equal(clockReads, 1);
  assert.deepEqual(lines, ["# DONE — all 3 phase(s) approved. 05:51:31"]);
});
