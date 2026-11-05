/**
 * F115-FR-027 — the give-back in the classic loop: a pass whose `afterPass`
 * hook returns `{ givenBack: true }` is given back AFTER the evidence check
 * (evidence still wins outright) and BEFORE the classic accounting: it emits
 * `iter_done`, and the next pass carries the SAME pass number, so it costs the
 * phase attempt none of its pass limit.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { runPassLoop, type PassLoopResult } from "../../src/pass-loop/loop.ts";
import type { Announcement } from "../../src/pass-loop/announce.ts";

type Harness = {
  /** Phase evidence appears once this many passes have run. */
  readonly evidenceAfter: number;
  /** Whether the layer gives the pass back. */
  readonly givenBack: (pass: number) => boolean;
};

type Run = {
  readonly result: PassLoopResult;
  readonly passes: readonly number[];
  readonly iterDone: readonly number[];
};

const run = async (harness: Harness): Promise<Run> => {
  const passes: number[] = [];
  const iterDone: number[] = [];
  let ran = 0;
  const result = await runPassLoop(
    {
      workdir: "/tmp",
      evidence: "/tmp/evidence.md",
      standingPrompt: "work",
      harness: "claude",
      role: "proposer",
      passLimit: 3,
      pauseSec: 0,
      feature: "default",
      phase: 1,
      phaseAttempt: 1,
      debug: false,
      help: false,
    },
    {
      port: {
        startPass: () => ({}) as never,
        betweenPasses: async () => ({ outcome: "continue" }),
      },
      evidenceExists: () => ran >= harness.evidenceAfter,
      runPass: async (pass) => {
        passes.push(pass);
        ran += 1;
        return {
          handle: { pid: 1, startTime: "", stream: (async function* () {})(), sessionId: "" },
          result: { exit_code: 0 },
          outcome: { path: "legacy" as const, madeProgress: true },
        };
      },
      now: () => "",
      pause: async () => undefined,
      print: () => undefined,
      emit: (announcement: Announcement) => {
        if (announcement.asIsName === "iter_done") {
          iterDone.push(Number((announcement.asIsFields as { iter: number }).iter));
        }
      },
      hooks: {
        afterPass: (pass: number) => ({ givenBack: harness.givenBack(pass) }),
      },
    },
  );
  return { result, passes, iterDone };
};

test("a given-back pass keeps its pass number, emits iter_done and touches no counter", async () => {
  const { result, passes, iterDone } = await run({
    evidenceAfter: 3,
    givenBack: (pass) => pass < 3,
  });
  // The pass number never rose while the passes were given back.
  assert.deepEqual(passes, [1, 1, 1]);
  // The two given-back passes each ended their turn with `iter_done`; the
  // third ends at the evidence check, which closes the loop with
  // `evidence_written` instead — exactly as the classic order reads it.
  assert.deepEqual(iterDone, [1, 1]);
  assert.equal(result.exit_code, 0);
  assert.equal(result.counters?.errorCount, 0);
});

test("evidence wins over the give-back: a pass with a checkpoint AND evidence ends the loop", async () => {
  const { result, passes } = await run({
    evidenceAfter: 1,
    givenBack: () => true,
  });
  assert.deepEqual(passes, [1]);
  assert.equal(result.exit_code, 0);
});

test("a hook that returns nothing behaves exactly as before", async () => {
  const passes: number[] = [];
  const result = await runPassLoop(
    {
      workdir: "/tmp",
      evidence: "/tmp/evidence.md",
      standingPrompt: "work",
      harness: "claude",
      role: "proposer",
      passLimit: 2,
      pauseSec: 0,
      feature: "default",
      phase: 1,
      phaseAttempt: 1,
      debug: false,
      help: false,
    },
    {
      port: {
        startPass: () => ({}) as never,
        betweenPasses: async () => ({ outcome: "continue" }),
      },
      evidenceExists: () => passes.length >= 2,
      runPass: async (pass) => {
        passes.push(pass);
        return {
          handle: { pid: 1, startTime: "", stream: (async function* () {})(), sessionId: "" },
          result: { exit_code: 0 },
          outcome: { path: "legacy" as const, madeProgress: true },
        };
      },
      now: () => "",
      pause: async () => undefined,
      print: () => undefined,
      emit: () => undefined,
      hooks: { afterPass: () => undefined },
    },
  );
  assert.deepEqual(passes, [1, 2]);
  assert.equal(result.exit_code, 0);
});
