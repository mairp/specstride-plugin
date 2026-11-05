/**
 * T062 — own test CT-101-16: every exit path of the engine leaves a TERMINAL
 * RECORD that validates, with `retryable` NEVER above the attribute of its
 * stop reason; and the counts that reach the reject limit ACROSS A RESUME.
 *
 * proves: F101-FR-036 (the terminal record on every exit path), F101-FR-037
 * (one exit code and one stop reason per halt) and F101-FR-014 (the reject
 * limit and its counts).
 * criterion: F101-SC-003.
 * fixtures: FX-03 to FX-07 and FX-13, port side only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXITS_WITHOUT_A_STOP_REASON,
  LOGICAL_NAME,
  SCHEMA_ID,
  WORK_OF_THE_END_OF_THE_RUN,
  WORK_RUNS_AFTER_THE_RECORD,
  WRITTEN_ON_EVERY_EXIT_PATH,
  endOfRunRegistry,
  endTheRun,
  isStopReason,
  retryableFor,
  terminalRecord,
  validatesAgainstTheSchema,
} from "../../src/engine/terminal.ts";
import { GATE_HALTS, haltOf } from "../../src/gate/halts.ts";
import { NO_COUNTS } from "../../src/gate/limits.ts";
import { STOP_REASONS, isTransient, engineExitOf } from "@specstride/contracts/codes/stop-reasons";
import {
  runFixture,
  runSetOfTheFixtureOfARow,
  FX_03_REJECT_LIMIT,
  FX_04_OSCILLATION_HALT,
  FX_05_MALFORMED_LIMIT,
  FX_06_HTTP_ERROR,
  FX_07_PHASE_NOT_FOUND,
  FX_13_RESUME,
  FX_13_RESUME_TO_THE_REJECT_LIMIT,
} from "./run-harness.ts";

const IDENTITY = {
  runId: "r1",
  launchId: "l1",
  engineStartId: "e1",
  at: "2026-10-03T00:00:00.000Z",
} as const;

test("CT-101-16: the record is written on every exit path, and the work of the end runs after it", () => {
  assert.equal(SCHEMA_ID, "specstride.terminal/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:terminal");
  assert.equal(WRITTEN_ON_EVERY_EXIT_PATH, true);
  assert.equal(WORK_RUNS_AFTER_THE_RECORD, true);
  assert.deepEqual(
    [...WORK_OF_THE_END_OF_THE_RUN],
    ["release-the-lock-in-standalone", "end-the-presenter", "summarize-learning"],
  );
});

test("CT-101-16: every row of the table of halts leaves a record that validates", () => {
  for (const row of GATE_HALTS) {
    const record = terminalRecord({
      ...IDENTITY,
      exitCode: row.exitCode,
      stopReason: row.stopReason,
      cause: row.cause === "owner-lost" ? "owner-lost" : "normal",
      causedBy: row.cause === "owner-lost" ? "crash" : "self",
      retryable: row.retryable,
      phase: 1,
      attemptId: "e1-a1",
    });
    assert.equal(validatesAgainstTheSchema(record), true, `the record of \`${row.cause}\``);
    assert.equal(record.exitCode, row.exitCode, row.cause);
    assert.equal(record.stopReason, row.stopReason, row.cause);
    // F101-FR-037 — one exit code and one stop reason, exactly the row's.
    assert.equal(haltOf(row.cause).exitCode, record.exitCode);
    assert.equal(haltOf(row.cause).stopReason, record.stopReason);
    assert.equal(record.retryable, row.retryable, row.cause);
  }
});

test("CT-101-16: the exits for which the enumeration has no member carry no stop reason (CQ-174)", () => {
  assert.deepEqual([...EXITS_WITHOUT_A_STOP_REASON], [1, 3, 5, 70]);
  for (const exitCode of EXITS_WITHOUT_A_STOP_REASON) {
    const record = terminalRecord({
      ...IDENTITY,
      exitCode,
      stopReason: null,
      cause: exitCode === 70 ? "crash" : "normal",
      causedBy: exitCode === 70 ? "crash" : "self",
      // Even where the caller ASKS for it, an exit with no stop reason is
      // never retryable.
      retryable: true,
    });
    assert.equal(validatesAgainstTheSchema(record), true, `exit ${String(exitCode)}`);
    assert.equal(record.stopReason, null);
    assert.equal(record.retryable, false, `exit ${String(exitCode)} is never retryable`);
  }
});

test("CT-101-16: `retryable` is never above the attribute of its stop reason", () => {
  for (const reason of STOP_REASONS) {
    assert.equal(isStopReason(reason), true, reason);
    // Asked for: it may be true only where the reason is transient.
    assert.equal(retryableFor(reason, true), isTransient(reason), reason);
    // Not asked for: never true, whatever the attribute says.
    assert.equal(retryableFor(reason, false), false, reason);
    assert.equal(retryableFor(reason, undefined), false, reason);
    // And the record never carries more than that.
    const record = terminalRecord({
      ...IDENTITY,
      exitCode: engineExitOf(reason) ?? 1,
      stopReason: reason,
      cause: "normal",
      causedBy: "self",
      retryable: true,
    });
    assert.equal(record.retryable, isTransient(reason), reason);
    assert.equal(validatesAgainstTheSchema(record), true, reason);
  }
  // Every stop reason of the table of halts is NOT transient, so no halt of
  // this feature can ever be retryable (F101-FR-041).
  for (const row of GATE_HALTS) {
    if (row.stopReason === null) continue;
    assert.equal(isTransient(row.stopReason), false, row.stopReason);
    assert.equal(retryableFor(row.stopReason, true), false, row.stopReason);
  }
});

test("CT-101-16: the work of the end of the run runs in the order of registration, and a failure stops nothing", async () => {
  const ran: string[] = [];
  const registry = endOfRunRegistry();
  registry.register({ name: "release-the-lock-in-standalone", run: () => void ran.push("lock") });
  registry.register({
    name: "end-the-presenter",
    run: () => {
      ran.push("presenter");
      throw new Error("the presenter could not be ended");
    },
  });
  registry.register({ name: "summarize-learning", run: () => void ran.push("learning") });

  const written: { path: string; body: string }[] = [];
  const outcome = await endTheRun(
    { ...IDENTITY, exitCode: 2, stopReason: "max_rejects", cause: "normal", causedBy: "self" },
    "features/f/runs/r1/terminal.json",
    {
      write: (path, body) => void written.push({ path, body: String(body) }),
      read: () => "",
      exists: () => false,
    },
    registry.steps,
  );
  assert.deepEqual(ran, ["lock", "presenter", "learning"], "every step ran, in order");
  assert.equal(outcome.everyStepRan, true);
  assert.equal(outcome.steps[1]?.failed, "the presenter could not be ended");
  assert.equal(outcome.steps[2]?.ran, true);
  // The record was written BEFORE the steps, through the single writer.
  assert.equal(written.length, 1);
  assert.equal(outcome.recordPath, "features/f/runs/r1/terminal.json");
  assert.equal(validatesAgainstTheSchema(outcome.record), true);
});

test("CT-101-16: every exit path of the fixtures of user story 2 leaves a record that validates", async () => {
  const sets = [
    FX_03_REJECT_LIMIT,
    FX_04_OSCILLATION_HALT,
    FX_05_MALFORMED_LIMIT,
    FX_06_HTTP_ERROR,
    FX_07_PHASE_NOT_FOUND,
    FX_13_RESUME,
  ];
  for (const set of sets) {
    const run = await runFixture(set);
    const reason = run.stopReason ?? null;
    const record = terminalRecord({
      ...IDENTITY,
      runId: run.runId,
      exitCode: run.exitCode,
      stopReason: reason === null ? null : isStopReason(reason) ? reason : null,
      cause: "normal",
      causedBy: "self",
      retryable: false,
      ...(typeof run.stopFields?.["phase"] === "number" ? { phase: run.stopFields["phase"] } : {}),
    });
    assert.equal(
      validatesAgainstTheSchema(record),
      true,
      `${set.family}/${set.scenario}: the terminal record validates`,
    );
    // F101-SC-003 — the end of the run is the exit code and the stop reason of
    // exactly one row of the table.
    const rows = GATE_HALTS.filter(
      (row) => row.exitCode === run.exitCode && row.stopReason === reason,
    );
    assert.ok(rows.length >= 1, `${set.family}/${set.scenario} ends in a row of the table`);
    assert.equal(record.retryable, false);
  }
});

test("CT-101-16: the counts reach the reject limit ACROSS A RESUME (F100-FR-069)", async () => {
  // The ledger of an earlier engine start already holds two rejected phase
  // attempts of phase 1. The reject limit of 3 is therefore reached by the
  // FIRST phase attempt of this run, and not by its third.
  const run = await runFixture(FX_13_RESUME_TO_THE_REJECT_LIMIT);
  assert.equal(run.calls.length, 1, "one phase attempt in this run");
  assert.equal(run.exitCode, 2);
  assert.equal(run.stopReason, "max_rejects");
  assert.deepEqual(run.stopFields, { phase: 1, attempts: 3 });
  assert.deepEqual(
    { ...(run.counts.get(1) ?? NO_COUNTS) },
    {
      rejectCount: 3,
      phaseAttemptOrdinal: 3,
      malformedStreak: 0,
    },
  );
  // The ordinal of that phase attempt is 3 and not 1: the loop went on where
  // the ledger said, which is what makes the limit mean the same thing.
  assert.deepEqual(
    run.decisions.map((decision) => decision.ordinal),
    [3],
  );
  assert.equal(run.calls[0]?.ordinal, 3);
  // Without the counts of the ledger the same run set would need three phase
  // attempts, which is the control of this test.
  const fresh = await runFixture({ ...FX_13_RESUME_TO_THE_REJECT_LIMIT, countsBefore: {} });
  assert.equal(fresh.calls.length, 3);
  assert.equal(fresh.exitCode, 2);

  // And the terminal record of the resumed run validates like any other.
  const record = terminalRecord({
    ...IDENTITY,
    runId: run.runId,
    exitCode: run.exitCode,
    stopReason: "max_rejects",
    cause: "normal",
    causedBy: "self",
    phase: 1,
  });
  assert.equal(validatesAgainstTheSchema(record), true);
  assert.equal(record.retryable, false);
});

test("CT-101-16: every fixture of every row of the table ends in that row", async () => {
  // F101-SC-003 over the rows that name a fixture, read from the contract.
  for (const row of GATE_HALTS) {
    for (const fixture of row.fixtures) {
      const set = runSetOfTheFixtureOfARow(fixture, row.cause);
      assert.notEqual(set, undefined, fixture);
      const run = await runFixture(set as NonNullable<typeof set>);
      assert.equal(run.exitCode, row.exitCode, `${fixture} of the row \`${row.cause}\``);
      assert.equal(
        run.stopReason ?? null,
        row.stopReason,
        `${fixture} of the row \`${row.cause}\``,
      );
    }
  }
});
