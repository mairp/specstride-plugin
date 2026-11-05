/**
 * T092 — contract tests CT-100-282, CT-100-283, CT-100-285 and CT-100-286 for
 * the exit codes per command (annex G, §G.4; F100-FR-182, F100-FR-183,
 * F100-FR-184, F100-FR-185, F100-FR-186).
 *
 * The tests bind T093, T272 and T273 to the keys `perCommand` and
 * `collisions` of `data/exit-codes.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import exitCodes from "../data/exit-codes.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import { closedSetRows } from "../src/enums/index.ts";
import {
  ANNEX_SECTION,
  COMMANDS_OF_THE_TABLE,
  COMMAND_ROW_COUNT,
  FLAG_WITHOUT_ITS_VALUE_CODE,
  GENERAL_RULES,
  PROTOCOL_CODE,
  PROTOCOL_MISMATCH,
  UNCAUGHT_ERROR_CODE,
  UNKNOWN_VERB_CODE,
  codeOfEnding,
  codesOf,
  commandCodeRow,
  commandCodeRows,
  exitCodePerCommandSet,
  unknownSubcommandCodeOf,
  usageErrorCodeOf,
} from "../src/codes/commands.ts";
import {
  HASH_COMPARED_PER_SOURCE,
  RESUME_LOCK_HELD_CODE,
  RESUME_NOTHING_TO_RESUME_CODE,
  RESUME_REFUSALS,
  RESUME_SOURCE_CHANGED_CODE,
  SOURCES_COMPARED,
  SUPERVISION_DOUBLE_USES,
  SUPERVISION_INTERRUPTED,
  SUPERVISION_OUTCOMES,
  SUPERVISION_OUTCOME_ROWS,
  SUPERVISION_UNKNOWN_STATUS_CODE,
  TASK_LIST_HASH_IGNORES_CHECKBOXES,
  codeOfSupervisionStatus,
  ignoresCheckboxChanges,
  resumeRefusalCode,
  resumeRow,
  resumeSourceChanged,
  superviseRow,
  supervisionExitCode,
  supervisionOutcomeSet,
} from "../src/codes/resume-and-supervision.ts";
import {
  A_PROBE_THAT_TIMES_OUT,
  COLLIDING_VALUES,
  COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT,
  DOCTOR_CODES,
  DOCTOR_CODE_NUMBERS,
  ROWS_WITHOUT_AN_AS_IS_EQUIVALENT,
  STRICT_FLAG,
  STRICT_MAKES_A_WARNING_EXIT,
  codesWithoutAnAsIsEquivalent,
  collisionRows,
  collisionsOf,
  doctorExitCode,
  doctorRow,
  hasNoAsIsEquivalent,
  meaningsOf,
} from "../src/codes/doctor-and-collisions.ts";
import { resumeRefusals } from "../src/enums/sets-100-104.ts";

const RAW = (exitCodes as { perCommand: Record<string, string>[] }).perCommand;
const RAW_COLLISIONS = (exitCodes as { collisions: Record<string, string>[] }).collisions;

test("CT-100-282: every row of §G.4 is carried, with the numbers its cell names", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.4");
  assert.equal(RAW.length, 28);
  assert.equal(COMMAND_ROW_COUNT, 28);
  assert.equal(commandCodeRows.length, 28);
  for (const [index, raw] of RAW.entries()) {
    const row = commandCodeRows[index];
    assert.notEqual(row, undefined);
    assert.equal(row?.command, raw.Command);
    assert.equal(row?.codes, raw.Codes);
    assert.ok((row?.numbers.length ?? 0) > 0, `${raw.Command} names at least one code`);
  }
  // Every command the table names in back-ticks resolves to its row.
  assert.ok(COMMANDS_OF_THE_TABLE.length > 20);
  for (const command of COMMANDS_OF_THE_TABLE) {
    assert.notEqual(commandCodeRow(command), undefined, command);
    assert.ok(codesOf(command).length > 0, command);
  }
  assert.equal(commandCodeRow("invented"), undefined);
  assert.deepEqual([...codesOf("invented")], []);
  // The row of `run` is the engine table.
  assert.deepEqual([...codesOf("run")], [0, 1, 2, 3, 4, 5, 6]);

  // Row 7 of §X.6 holds the codes per command, registered through T070.
  assert.equal(exitCodePerCommandSet.number, 7);
  assert.equal(exitCodePerCommandSet.byReference, true);
  assert.deepEqual([...(closedSets.get(7)?.members ?? [])], [...exitCodePerCommandSet.members]);
  // Every number any row names is a member of row 7 (its literals are text).
  for (const row of commandCodeRows) {
    for (const number of row.numbers) {
      assert.ok(
        exitCodePerCommandSet.has(String(number)),
        `${row.command}: the code ${number} is a member of row 7 of §X.6`,
      );
    }
  }
  assert.match(String(closedSetRows.find((r) => r.number === 7)?.unknownValue), /gives 1/);
});

test("CT-100-282: the general rules — 70, 1, the as-is usage code, the unknown sub-command", () => {
  assert.equal(UNCAUGHT_ERROR_CODE, 70);
  assert.equal(UNKNOWN_VERB_CODE, 1);
  assert.equal(FLAG_WITHOUT_ITS_VALUE_CODE, 127);
  assert.equal(PROTOCOL_CODE, 0);
  assert.equal(PROTOCOL_MISMATCH.code, 4);
  assert.match(
    PROTOCOL_MISMATCH.line,
    /^\[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch$/,
  );
  assert.equal(PROTOCOL_MISMATCH.namesTheDoctor, true);
  assert.deepEqual(GENERAL_RULES, {
    uncaughtError: 70,
    unknownVerb: 1,
    flagWithoutItsValue: 127,
    protocol: 0,
    protocolMismatch: 4,
  });
  // The rows of the annex say the same.
  assert.deepEqual([...codesOf("--protocol")], [0]);
  assert.deepEqual(
    [...(commandCodeRows.find((r) => r.command === "Any command, uncaught error")?.numbers ?? [])],
    [70],
  );
  assert.deepEqual(
    [
      ...(commandCodeRows.find((r) => r.command === "Any command, unknown first argument (verb)")
        ?.numbers ?? []),
    ],
    [1],
  );
  assert.deepEqual(
    [
      ...(commandCodeRows.find(
        (r) => r.command === "A front-door command, a flag given without its value",
      )?.numbers ?? []),
    ],
    [127],
  );

  assert.equal(codeOfEnding({ kind: "uncaught-error" }), 70);
  assert.equal(codeOfEnding({ kind: "unknown-verb" }), 1);
  assert.equal(codeOfEnding({ kind: "flag-without-its-value" }), 127);
  assert.equal(codeOfEnding({ kind: "protocol-mismatch" }), 4);

  // A usage error keeps the as-is code of its command, and that code is one
  // of the codes of its row.
  for (const command of ["run", "learn", "spec", "reverse", "supervise", "doctor", "wait"]) {
    const code = usageErrorCodeOf(command);
    assert.notEqual(code, undefined, command);
    assert.ok(codesOf(command).includes(code as number), `${command}: ${String(code)}`);
    assert.equal(codeOfEnding({ kind: "usage-error", command }), code);
  }
  assert.equal(usageErrorCodeOf("learn"), 2);
  assert.equal(usageErrorCodeOf("doctor"), 3);
  assert.equal(usageErrorCodeOf("invented"), undefined);
  // An unknown sub-command exits as the table of its command states.
  assert.equal(unknownSubcommandCodeOf("learn"), 2);
  assert.equal(unknownSubcommandCodeOf("run"), 3);
  assert.equal(unknownSubcommandCodeOf("invented"), 1);
  assert.equal(codeOfEnding({ kind: "unknown-subcommand", command: "learn" }), 2);
});

test("CT-100-283: `resume` refuses with 5 on the lock, 3 with nothing to resume or a changed hash", () => {
  assert.notEqual(resumeRow, undefined);
  assert.deepEqual([...(resumeRow?.numbers ?? [])], [1, 5, 3]);
  assert.equal(RESUME_LOCK_HELD_CODE, 5);
  assert.equal(RESUME_NOTHING_TO_RESUME_CODE, 3);
  assert.equal(RESUME_SOURCE_CHANGED_CODE, 3);
  assert.equal(resumeRefusalCode("lock-held"), 5);
  assert.equal(resumeRefusalCode("owner-dead-group-survives"), 5);
  assert.equal(resumeRefusalCode("nothing-to-resume"), 3);
  assert.equal(resumeRefusalCode("source-changed"), 3);
  assert.equal(resumeRefusalCode("no-state"), 1);
  assert.equal(resumeRefusalCode("invented"), undefined);
  // Every refusal's code is a code of the row of `resume`.
  for (const refusal of RESUME_REFUSALS) {
    assert.ok(
      (resumeRow?.numbers ?? []).includes(refusal.code),
      `${refusal.refusal}: ${refusal.code}`,
    );
    assert.notEqual(refusal.meaning.trim(), "", refusal.refusal);
  }
  // The refusal for a changed source names the file.
  assert.equal(RESUME_REFUSALS.find((r) => r.refusal === "source-changed")?.namesTheFile, true);
  const refused = resumeSourceChanged({ source: "plan", file: "specs/x/plan.md" });
  assert.equal(refused?.code, 3);
  assert.equal(refused?.file, "specs/x/plan.md");
  assert.equal(refused?.refusal, "source-changed");

  // The three sources, and the hash compared for each.
  assert.deepEqual([...SOURCES_COMPARED], ["spec", "plan", "tasks"]);
  assert.equal(HASH_COMPARED_PER_SOURCE.spec, "the hash of the file");
  assert.equal(HASH_COMPARED_PER_SOURCE.plan, "the hash of the file");
  assert.equal(HASH_COMPARED_PER_SOURCE.tasks, "the hash that ignores checkbox changes");
  assert.equal(TASK_LIST_HASH_IGNORES_CHECKBOXES, true);
  assert.equal(ignoresCheckboxChanges("tasks"), true);
  assert.equal(ignoresCheckboxChanges("spec"), false);
  // A tick never refuses a resume.
  assert.equal(
    resumeSourceChanged({ source: "tasks", file: "tasks.md", onlyCheckboxesChanged: true }),
    undefined,
  );
  // A change of the task list beyond a tick still refuses.
  assert.equal(resumeSourceChanged({ source: "tasks", file: "tasks.md" })?.code, 3);
  // A change of the spec refuses even where only checkboxes moved there.
  assert.equal(
    resumeSourceChanged({ source: "spec", file: "spec.md", onlyCheckboxesChanged: true })?.code,
    3,
  );
  // Row 51 of §X.6 holds the refusals of `resume` as its own closed set.
  assert.equal(resumeRefusals.number, 51);
  assert.ok(resumeRefusals.members.length > 0);
});

test("CT-100-283, F100-FR-184: the seven supervision outcomes and their codes", () => {
  assert.equal(SUPERVISION_OUTCOMES.length, 7);
  assert.deepEqual(
    [...SUPERVISION_OUTCOMES],
    [
      "completed",
      "stopped",
      "unknown-terminal",
      "refused",
      "supervision-expired",
      "failed",
      "lock-conflict",
    ],
  );
  assert.equal(SUPERVISION_OUTCOME_ROWS.length, 7);
  assert.deepEqual(
    SUPERVISION_OUTCOME_ROWS.map((r) => [r.outcome, r.code]),
    [
      ["completed", 0],
      ["stopped", 2],
      ["unknown-terminal", 3],
      ["refused", 4],
      ["supervision-expired", 5],
      ["failed", 22],
      ["lock-conflict", 24],
    ],
  );
  // Row 16 of §X.6 holds the same seven, registered through T070.
  assert.equal(supervisionOutcomeSet.number, 16);
  assert.deepEqual([...supervisionOutcomeSet.members], [...SUPERVISION_OUTCOMES]);
  assert.deepEqual([...(closedSets.get(16)?.members ?? [])], [...SUPERVISION_OUTCOMES]);
  assert.match(String(closedSetRows.find((r) => r.number === 16)?.unknownValue), /Exit 1/);

  // Every code is a code of the row of `supervise`.
  assert.notEqual(superviseRow, undefined);
  for (const row of SUPERVISION_OUTCOME_ROWS) {
    assert.ok((superviseRow?.numbers ?? []).includes(row.code), `${row.outcome}: ${row.code}`);
    assert.equal(supervisionExitCode(row.outcome), row.code);
  }
  // 0 also covers a reading taken and a relaunch started.
  assert.match(String(SUPERVISION_OUTCOME_ROWS[0]?.meaning), /a reading taken, a relaunch started/);
  // A status the exit map does not know gives 1.
  assert.equal(SUPERVISION_UNKNOWN_STATUS_CODE, 1);
  assert.equal(codeOfSupervisionStatus("something-else"), 1);
  assert.equal(codeOfSupervisionStatus("failed"), 22);
  assert.equal(supervisionExitCode("invented"), undefined);
  // The double uses of the baseline are kept.
  assert.equal(SUPERVISION_DOUBLE_USES[2], "also the usage error");
  assert.equal(SUPERVISION_DOUBLE_USES[4], "also the launch decision `attach`");
  assert.equal(SUPERVISION_OUTCOME_ROWS.find((r) => r.code === 2)?.alsoMeans, "a usage error");
  assert.equal(
    SUPERVISION_OUTCOME_ROWS.find((r) => r.code === 4)?.alsoMeans,
    "the launch decision `attach`",
  );
  assert.equal(usageErrorCodeOf("supervise"), 2);
  // Interrupted exits 130 and leaves the run alone.
  assert.equal(SUPERVISION_INTERRUPTED.code, 130);
  assert.equal(SUPERVISION_INTERRUPTED.leavesTheRunAlone, true);
  assert.ok((superviseRow?.numbers ?? []).includes(130));
});

test("CT-100-285: the codes of the doctor, `--strict`, and a probe that times out", () => {
  assert.notEqual(doctorRow, undefined);
  assert.deepEqual([...DOCTOR_CODE_NUMBERS], [0, 1, 2, 3]);
  assert.deepEqual([...(doctorRow?.numbers ?? [])], [0, 1, 2, 3]);
  assert.deepEqual(
    DOCTOR_CODES.map((r) => [r.code, r.meaning]),
    [
      [0, "no `fail` finding"],
      [1, "the doctor could not run"],
      [2, "at least one `fail` finding"],
      [3, "usage error"],
    ],
  );
  assert.equal(doctorExitCode({}), 0);
  assert.equal(doctorExitCode({ aWarnFinding: true }), 0);
  assert.equal(doctorExitCode({ couldNotRun: true }), 1);
  assert.equal(doctorExitCode({ aFailFinding: true }), 2);
  assert.equal(doctorExitCode({ usageError: true }), 3);
  // With `--strict` a warning exits 2.
  assert.equal(STRICT_FLAG, "--strict");
  assert.equal(STRICT_MAKES_A_WARNING_EXIT, 2);
  assert.equal(doctorExitCode({ aWarnFinding: true, strict: true }), 2);
  assert.match(String(doctorRow?.codes), /--strict/);
  // A probe that times out never raises the code above that of a warning.
  assert.equal(A_PROBE_THAT_TIMES_OUT.severity, "warn");
  assert.equal(A_PROBE_THAT_TIMES_OUT.raisesTheCodeAboveAWarning, false);
  assert.equal(A_PROBE_THAT_TIMES_OUT.codeWithoutStrict, 0);
  assert.equal(A_PROBE_THAT_TIMES_OUT.codeWithStrict, 2);
  assert.equal(doctorExitCode({ aProbeTimedOut: true }), 0);
  assert.equal(doctorExitCode({ aProbeTimedOut: true, strict: true }), 2);
  assert.ok(doctorExitCode({ aProbeTimedOut: true, strict: true }) <= STRICT_MAKES_A_WARNING_EXIT);
});

test("CT-100-286: the nine commands without an as-is equivalent exit as their rows say", () => {
  assert.equal(COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT.length, 9);
  assert.deepEqual(
    [...COMMANDS_WITHOUT_AN_AS_IS_EQUIVALENT],
    [
      "launch",
      "wait",
      "state export",
      "state import",
      "state adopt",
      "harness verify",
      "config show",
      "config schema",
      "tripwire clear",
    ],
  );
  assert.equal(ROWS_WITHOUT_AN_AS_IS_EQUIVALENT.length, 9);
  for (const { command, row } of ROWS_WITHOUT_AN_AS_IS_EQUIVALENT) {
    assert.ok(hasNoAsIsEquivalent(command), command);
    assert.ok(row.commands.includes(command), `the row of §G.4 names ${command}`);
    assert.deepEqual([...(codesWithoutAnAsIsEquivalent(command) ?? [])], [...row.numbers]);
    assert.deepEqual([...codesOf(command)], [...row.numbers]);
  }
  assert.equal(hasNoAsIsEquivalent("run"), false);
  assert.equal(codesWithoutAnAsIsEquivalent("run"), undefined);
  // The codes the annex gives, row by row.
  assert.deepEqual([...codesOf("launch")], [0, 4, 20, 21, 23, 24]);
  assert.deepEqual([...codesOf("wait")], [0, 1, 3]);
  assert.deepEqual([...codesOf("state adopt")], [0, 1, 3, 5]);
  assert.deepEqual([...codesOf("harness verify")], [0, 2, 3]);
  assert.deepEqual([...codesOf("config schema")], [0, 3]);
  assert.deepEqual([...codesOf("tripwire clear")], [0, 1, 3]);
});

test("CT-100-286: the table of collisions — one value, its meanings per command", () => {
  assert.equal(RAW_COLLISIONS.length, 8);
  assert.equal(collisionRows.length, 8);
  for (const [index, raw] of RAW_COLLISIONS.entries()) {
    const row = collisionRows[index];
    assert.equal(row?.cell, raw.Value);
    assert.equal(row?.meaningsCell, raw.Meanings);
    assert.ok((row?.values.length ?? 0) > 0, `${raw.Value} names a number`);
    assert.ok((row?.meanings.length ?? 0) > 0, `${raw.Value} names a meaning`);
  }
  assert.deepEqual([...COLLIDING_VALUES], [1, 2, 3, 4, 5, 6, 10, 22, 24]);
  // Every colliding value carries more than one meaning, except the row that
  // pairs 22 and 24, whose one meaning covers both.
  for (const value of [1, 2, 3, 4, 5, 6, 10]) {
    assert.ok(meaningsOf(value).length >= 2, `the value ${value} collides`);
  }
  assert.equal(collisionsOf(22).length, 1);
  assert.deepEqual([...(collisionsOf(22)[0]?.values ?? [])], [22, 24]);
  assert.match(String(meaningsOf(22)[0]), /stage failed, lock conflict/);
  assert.deepEqual([...collisionsOf(99)], []);
  // The meanings name the processes the codes belong to.
  assert.ok(meaningsOf(1).some((m) => /Engine internal error/.test(m)));
  assert.ok(meaningsOf(5).some((m) => /`resume` lock held/.test(m)));
  assert.ok(meaningsOf(10).some((m) => /verification gate failed/.test(m)));
});
