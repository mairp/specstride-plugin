/**
 * T102 of feature 101 — the OWN TEST of F101-SC-008.
 *
 * The success criterion, stated once:
 *
 *   A person is asked in time. NO PHASE GETS MORE JUDGED PHASE ATTEMPTS THAN
 *   THE REJECT LIMIT IN ONE COUNT, and NO SIGNATURE GETS MORE THAN ONE
 *   DIAGNOSIS AND ONE ACCELERATED PHASE ATTEMPT, in 100 per cent of the
 *   fixtures of FX-03 and FX-08.
 *
 * Proves F101-FR-014 (at most as many phase attempts as the limit are judged
 * per phase, and the count comes from the ledger, so it is ONE count across a
 * resume), F101-FR-021 (at most one call of the diagnostician per signature and
 * phase) and F101-FR-024 (at most one accelerated phase attempt per diagnosed
 * signature).
 *
 * Fixtures FX-03 and FX-08, PORT SIDE ONLY: the runs are the real engine over
 * the ports of `run-harness.ts`, so nothing of the reference tree is needed and
 * this test never skips.
 *
 * SURFACES: the TRANSCRIPT and the COUNTERS, as the task names them, and never
 * an internal of the port.
 *
 *  - the transcript: one as-is transcript file per JUDGED phase attempt
 *    (`<run>/verdicts/phase<N>.attempt<M>.txt`, B-0876). Counting those files
 *    per phase counts the judged phase attempts of that phase.
 *  - the counters: the counts of the ledger of the run (`rejectCount`,
 *    `phaseAttemptOrdinal`), with the counts an earlier engine start left
 *    (`countsBefore`) added, which is what "in one count" means.
 *
 * "100 per cent of the fixtures" is not a list written out by hand: the run
 * sets are COLLECTED from the harness by their family, so a run set of FX-03 or
 * FX-08 added later is judged by this test without it being touched.
 *
 * The last test of the file is the NEGATIVE CONTROL: the same judgement over a
 * fabricated reading that breaks each of the three limits, which it must
 * reject. Without it every claim above could be vacuous.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MALFORMED_LIMIT_DEFAULT,
  REJECT_LIMIT_DEFAULT,
  type Counts,
} from "../../src/gate/limits.ts";
import * as harness from "./run-harness.ts";
import { RUN_SETS_OF_FX_08, runFixture, type RunObservation, type RunSet } from "./run-harness.ts";

/* ------------------------------------------------------------------ *
 * 100 per cent of the fixtures: every run set of FX-03 and FX-08 the
 * harness holds, collected by family.
 * ------------------------------------------------------------------ */

/** The two families F101-SC-008 names. */
const FAMILIES = ["FX-03", "FX-08"] as const;

/** True for an export of the harness that is a run set. */
function isARunSet(value: unknown): value is RunSet {
  const candidate = value as Partial<RunSet> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.family === "string" &&
    typeof candidate.scenario === "string" &&
    typeof candidate.reply === "function"
  );
}

/** Every run set of the two families, in the order of the exports. */
function runSetsOfTheFamilies(): readonly RunSet[] {
  const out: RunSet[] = [];
  for (const value of Object.values(harness as Readonly<Record<string, unknown>>)) {
    if (isARunSet(value) && (FAMILIES as readonly string[]).includes(value.family)) out.push(value);
  }
  return Object.freeze(out);
}

/**
 * The reject limit of FX-03 swept across its whole usable range, as run sets of
 * the SAME family: the claim "no phase gets more judged phase attempts than the
 * reject limit" is only worth something when the limit itself moves.
 */
function sweepOfFx03(): readonly RunSet[] {
  const base = harness.FX_03_REJECT_LIMIT;
  return Object.freeze(
    [1, 2, 3, 4, 5, 6].map((limit) =>
      Object.freeze({ ...base, scenario: `reject-limit-of-${limit}`, rejectLimit: limit }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * The two surfaces, read off a run.
 * ------------------------------------------------------------------ */

/** The path of the as-is transcript of one judged phase attempt (B-0876). */
const TRANSCRIPT = /\/verdicts\/phase(\d+)\.attempt(\d+)\.txt$/;

/** THE TRANSCRIPT — the judged phase attempts of each phase, by their ordinals. */
function judgedFromTheTranscript(run: RunObservation): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const path of run.files.keys()) {
    const found = TRANSCRIPT.exec(path);
    if (found === null) continue;
    const phase = Number(found[1]);
    const ordinal = Number(found[2]);
    const held = out.get(phase) ?? new Set<number>();
    held.add(ordinal);
    out.set(phase, held);
  }
  return out;
}

/** THE COUNTERS — the counts of the ledger as the run left them. */
function countersOf(run: RunObservation): ReadonlyMap<number, Counts> {
  return run.counts;
}

/** The counts an earlier engine start left, which this one continues. */
function countsBefore(set: RunSet, phase: number): Counts | undefined {
  return set.countsBefore?.[phase];
}

/**
 * One reading of a run: the three limits of F101-SC-008 and what the two
 * surfaces say about them. The judgement below is a pure function of this
 * record, so the negative control can hand it a fabricated one.
 */
type Reading = {
  readonly where: string;
  readonly rejectLimit: number;
  /** Per phase: the ordinals of the judged phase attempts, from the transcript. */
  readonly judged: ReadonlyMap<number, ReadonlySet<number>>;
  /** Per phase: the counters of the ledger. */
  readonly counters: ReadonlyMap<number, Counts>;
  /** Per phase: the reject count an earlier engine start left. */
  readonly before: ReadonlyMap<number, number>;
  /** Per phase: the signature of every diagnostician call that was MADE. */
  readonly diagnosed: ReadonlyMap<number, readonly string[]>;
  /** Per phase: the signature of every accelerated phase attempt. */
  readonly accelerated: ReadonlyMap<number, readonly string[]>;
};

function readingOf(run: RunObservation): Reading {
  const set = run.runSet;
  const judged = judgedFromTheTranscript(run);
  const before = new Map<number, number>();
  for (const phase of new Set([...judged.keys(), ...countersOf(run).keys()])) {
    before.set(phase, countsBefore(set, phase)?.rejectCount ?? 0);
  }
  const diagnosed = new Map<number, string[]>();
  for (const diagnosis of run.diagnoses) {
    if (!diagnosis.called) continue;
    const held = diagnosed.get(diagnosis.phase) ?? [];
    held.push(diagnosis.signature);
    diagnosed.set(diagnosis.phase, held);
  }
  const accelerated = new Map<number, string[]>();
  for (const acceleration of run.accelerations) {
    const held = accelerated.get(acceleration.phase) ?? [];
    held.push(String(acceleration.outcome.markers.accelerated ?? ""));
    accelerated.set(acceleration.phase, held);
  }
  return {
    where: `${set.family}/${set.scenario}`,
    rejectLimit: set.rejectLimit ?? REJECT_LIMIT_DEFAULT,
    judged,
    counters: countersOf(run),
    before,
    diagnosed,
    accelerated,
  };
}

/* ------------------------------------------------------------------ *
 * The judgement of F101-SC-008 over one reading.
 * ------------------------------------------------------------------ */

function complaintsAbout(reading: Reading): string[] {
  const out: string[] = [];
  const where = reading.where;
  const phases = new Set([
    ...reading.judged.keys(),
    ...reading.counters.keys(),
    ...reading.diagnosed.keys(),
    ...reading.accelerated.keys(),
  ]);
  for (const phase of [...phases].sort((a, b) => a - b)) {
    /* --- F101-FR-014: the reject limit, IN ONE COUNT ----------------- */
    const judged = reading.judged.get(phase)?.size ?? 0;
    const carried = reading.before.get(phase) ?? 0;
    if (judged + carried > reading.rejectLimit) {
      out.push(
        `${where}: phase ${phase} got ${judged} judged phase attempts in the transcript ` +
          `and carried ${carried} from an earlier engine start, which is more than the ` +
          `reject limit ${reading.rejectLimit} in one count`,
      );
    }
    const counts = reading.counters.get(phase);
    if (counts !== undefined) {
      if (counts.rejectCount > reading.rejectLimit) {
        out.push(
          `${where}: phase ${phase} has the counter rejectCount=${counts.rejectCount}, ` +
            `above the reject limit ${reading.rejectLimit}`,
        );
      }
      if (counts.phaseAttemptOrdinal > reading.rejectLimit) {
        out.push(
          `${where}: phase ${phase} has the counter phaseAttemptOrdinal=` +
            `${counts.phaseAttemptOrdinal}, above the reject limit ${reading.rejectLimit}`,
        );
      }
      // The two surfaces must agree: a rejection the counter counted stands in
      // the transcript as a judged phase attempt of the same phase.
      if (counts.rejectCount - carried > judged) {
        out.push(
          `${where}: phase ${phase} counted ${counts.rejectCount - carried} rejections of ` +
            `this engine start and the transcript holds only ${judged} judged phase attempts`,
        );
      }
    }

    /* --- F101-FR-021: one diagnosis per signature -------------------- */
    const diagnosed = reading.diagnosed.get(phase) ?? [];
    for (const signature of new Set(diagnosed)) {
      const made = diagnosed.filter((s) => s === signature).length;
      if (made > 1) {
        out.push(
          `${where}: phase ${phase} made ${made} diagnostician calls for the signature ` +
            `${signature}; at most one is allowed per signature and phase`,
        );
      }
    }

    /* --- F101-FR-024: one accelerated phase attempt per signature ---- */
    const accelerated = reading.accelerated.get(phase) ?? [];
    for (const signature of new Set(accelerated)) {
      const made = accelerated.filter((s) => s === signature).length;
      if (made > 1) {
        out.push(
          `${where}: phase ${phase} ran ${made} accelerated phase attempts for the signature ` +
            `${signature}; at most one is allowed per diagnosed signature`,
        );
      }
      if (signature !== "" && !diagnosed.includes(signature)) {
        out.push(
          `${where}: phase ${phase} accelerated the signature ${signature}, which was never ` +
            `diagnosed; F101-FR-024 makes a diagnosis the condition of an acceleration`,
        );
      }
    }
    if (accelerated.length > diagnosed.length) {
      out.push(
        `${where}: phase ${phase} ran ${accelerated.length} accelerated phase attempts after ` +
          `${diagnosed.length} diagnoses`,
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The tests.
 * ------------------------------------------------------------------ */

test("T102 setup: the run sets of FX-03 and FX-08 are collected by family, so the test covers 100 per cent of them", () => {
  const sets = runSetsOfTheFamilies();
  const byFamily = new Map<string, number>();
  for (const set of sets) byFamily.set(set.family, (byFamily.get(set.family) ?? 0) + 1);
  assert.ok((byFamily.get("FX-03") ?? 0) >= 4, `FX-03 run sets: ${byFamily.get("FX-03") ?? 0}`);
  assert.ok((byFamily.get("FX-08") ?? 0) >= 15, `FX-08 run sets: ${byFamily.get("FX-08") ?? 0}`);
  // The four scenarios of FX-08 the catalogue of feature 141 declares are in.
  for (const declared of RUN_SETS_OF_FX_08) {
    assert.ok(
      sets.some((s) => s.scenario === declared.scenario),
      `the catalogue scenario FX-08/${declared.scenario} is collected`,
    );
  }
  assert.equal(REJECT_LIMIT_DEFAULT, 3, "the default of the reject limit (F101-FR-014)");
  assert.equal(MALFORMED_LIMIT_DEFAULT, 3, "the default of the MALFORMED limit (F101-FR-015)");
});

test("T102 (F101-SC-008): in 100 per cent of the fixtures of FX-03 and FX-08, no phase gets more judged phase attempts than the reject limit and no signature more than one diagnosis and one accelerated phase attempt", async () => {
  const sets = runSetsOfTheFamilies();
  const complaints: string[] = [];
  let judgedPhases = 0;
  let diagnoses = 0;
  let accelerations = 0;
  for (const set of sets) {
    const run = await runFixture(set);
    const reading = readingOf(run);
    complaints.push(...complaintsAbout(reading));
    judgedPhases += reading.judged.size;
    for (const made of reading.diagnosed.values()) diagnoses += made.length;
    for (const made of reading.accelerated.values()) accelerations += made.length;
  }
  assert.deepEqual(complaints, [], complaints.join("\n"));
  // The claim is not vacuous: the runs really did judge, diagnose and accelerate.
  assert.ok(
    judgedPhases >= sets.length,
    `${judgedPhases} phases were judged across ${sets.length} runs`,
  );
  assert.ok(diagnoses > 0, `${diagnoses} diagnostician calls were made in these runs`);
  assert.ok(accelerations > 0, `${accelerations} accelerated phase attempts ran in these runs`);
});

test("T102 (F101-FR-014): the reject limit of FX-03 swept from 1 to 6 bounds the judged phase attempts every time", async () => {
  for (const set of sweepOfFx03()) {
    const run = await runFixture(set);
    const reading = readingOf(run);
    assert.deepEqual(complaintsAbout(reading), [], `${reading.where}`);
    // The limit is REACHED, not merely respected: the run halts at it, so the
    // bound is tight and the person is asked in time.
    const judged = reading.judged.get(1)?.size ?? 0;
    assert.equal(
      judged,
      reading.rejectLimit,
      `${reading.where}: ${judged} judged phase attempts for the limit ${reading.rejectLimit}`,
    );
    assert.equal(run.exitCode, 2, `${reading.where}: the run halts`);
    assert.equal(run.stopReason, "max_rejects", `${reading.where}: with max_rejects`);
    assert.equal(
      run.counts.get(1)?.rejectCount,
      reading.rejectLimit,
      `${reading.where}: the counter`,
    );
  }
});

test("T102 (F101-FR-014): the count is ONE count across a resume, and the limit is reached by the phase attempt that crosses it", async () => {
  // The counts of this feature live in the ledger, so a run that resumes a
  // phase continues the count of the earlier engine start instead of starting
  // a new one. FX-13 reads the same phase from that side: two rejections are
  // already counted, so the FIRST judged phase attempt of this run reaches the
  // limit of 3 — three judged phase attempts in ONE count, and no fourth.
  const run = await runFixture(harness.FX_13_RESUME_TO_THE_REJECT_LIMIT);
  const reading = readingOf(run);
  assert.deepEqual(complaintsAbout(reading), [], reading.where);
  assert.equal(reading.before.get(1), 2, "two rejections were carried into this run");
  assert.equal(reading.judged.get(1)?.size, 1, "one phase attempt was judged in this run");
  assert.deepEqual([...(reading.judged.get(1) ?? [])], [3], "and it was the third of the count");
  assert.equal(run.counts.get(1)?.rejectCount, 3, "the counter holds the whole count");
  assert.equal(run.exitCode, 2);
  assert.equal(run.stopReason, "max_rejects");
});

test("T102 (F101-FR-021, F101-FR-024): FX-08 with three rejections of the SAME signature makes one diagnosis and one accelerated phase attempt", async () => {
  const run = await runFixture(harness.FX_08_SAME_SIGNATURE);
  const reading = readingOf(run);
  assert.deepEqual(complaintsAbout(reading), [], reading.where);
  assert.deepEqual(reading.diagnosed.get(1), ["T001"], "one diagnosis, for the one signature");
  assert.deepEqual(reading.accelerated.get(1), ["T001"], "one accelerated phase attempt for it");
  // The transcript shows FOUR judged phase attempts of the phase: the signature
  // came back twice more and neither brought a second diagnosis.
  assert.equal(reading.judged.get(1)?.size, 4);
  assert.equal(run.markers.get(1)?.diagnosed, "T001");
  assert.equal(run.markers.get(1)?.accelerated, "T001");
});

test("T102 negative control: the same judgement REJECTS a reading that breaks each of the three limits", () => {
  const broken: Reading = {
    where: "the negative control",
    rejectLimit: 3,
    judged: new Map([[1, new Set([1, 2, 3, 4])]]),
    counters: new Map([[1, { rejectCount: 4, phaseAttemptOrdinal: 4, malformedStreak: 0 }]]),
    before: new Map([[1, 0]]),
    diagnosed: new Map([[1, ["T001", "T001"]]]),
    accelerated: new Map([[1, ["T001", "T001", "T002"]]]),
  };
  const complaints = complaintsAbout(broken);
  assert.ok(
    complaints.some((c) => c.includes("more than the")),
    `the judgement names the fourth judged phase attempt: ${complaints.join(" | ")}`,
  );
  assert.ok(
    complaints.some((c) => c.includes("diagnostician calls for the signature")),
    `the judgement names the second diagnosis: ${complaints.join(" | ")}`,
  );
  assert.ok(
    complaints.some((c) => c.includes("accelerated phase attempts for the signature")),
    `the judgement names the second acceleration: ${complaints.join(" | ")}`,
  );
  assert.ok(
    complaints.some((c) => c.includes("which was never")),
    `the judgement names the acceleration of an undiagnosed signature: ${complaints.join(" | ")}`,
  );
  // And it is silent about a reading that keeps all three limits.
  assert.deepEqual(
    complaintsAbout({
      ...broken,
      where: "the reading that keeps every limit",
      judged: new Map([[1, new Set([1, 2, 3])]]),
      counters: new Map([[1, { rejectCount: 3, phaseAttemptOrdinal: 3, malformedStreak: 0 }]]),
      diagnosed: new Map([[1, ["T001"]]]),
      accelerated: new Map([[1, ["T001"]]]),
    }),
    [],
  );
});
