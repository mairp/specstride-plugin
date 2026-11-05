/**
 * T267 — contract tests CT-100-243, CT-100-244, CT-100-245, CT-100-246 and
 * CT-100-247 for the run record, the blocked reasons, the refusal on a
 * changed source, the quota pause and the lease check (annex E, §E.2;
 * F100-FR-143 to F100-FR-147).
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/run-record.schema.json" with { type: "json" };
import machine from "../data/run-state-machine.json" with { type: "json" };
import {
  AFTER_A_REBOOT,
  ANNEX_SECTION,
  AT_THE_CEILING,
  COUNTERS_A_QUOTA_PAUSE_NEVER_SPENDS,
  FIELDS_THE_REQUIREMENT_NAMES,
  LEASE_IS_VERIFIED_AT_EVERY_BOUNDARY_THAT_READS_THE_STOP_REQUEST,
  LOGICAL_NAME,
  OWNER_LOST,
  PAUSE_HOLDS_WHILE_THE_RUNTIME_LIVES,
  PAUSE_MAX_TOTAL_DEFAULT_HOURS,
  PAUSE_MAX_TOTAL_MS_DEFAULT,
  PAUSE_MAX_TOTAL_MS_KEY,
  PRODUCT_VERSIONS_FIELD,
  PRODUCT_VERSIONS_IS_ONE_LIST,
  QUOTA_PAUSE_SPENDS,
  READERS,
  SCHEMA_ID,
  WRITER,
  WRITERS_COUNT,
  atTheCeiling,
  isRunRecord,
  leaseCheck,
  pauseRecordIsPresent,
  productVersionOfEngineStart,
  quotaPauseSpends,
  readRunRecord,
  stateIsWritable,
  tryReadRunRecord,
} from "../src/records/run-record.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import {
  BLOCKED_REASONS,
  SOURCE_CHANGED,
  SOURCE_CHANGED_REFUSAL,
  WHAT_A_BLOCKED_RUN_DOES,
  blockedEvent,
  blockedReasonRow,
  blockedReasonRows,
  blockedReasonSet,
  engineExitOf,
  mayRelaunch,
  sourceChangedRefusal,
  stopReasonOf,
} from "../src/state/blocked-reasons.ts";
import { isStopReason } from "../src/codes/stop-reasons.ts";
import { engineExitRow, isEngineExitCode } from "../src/codes/engine.ts";
import { loadProfile } from "../src/profile/parity.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

/** A valid sample: the generic one, with `state` set to a written state. */
const sample = { ...sampleOf(SCHEMA_ID), state: "created", transition: "T1" };

test("CT-100-243: a valid sample of the run record passes (annex E, §E.2)", () => {
  assert.equal(SCHEMA_ID, "specstride.run-state/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:record");
  assert.equal(ANNEX_SECTION, "annex E, §E.2");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.equal((schema as { "x-annex": string })["x-annex"], ANNEX_SECTION);
  assert.ok(isRunRecord(sample));
  assert.deepEqual(readRunRecord(sample, LOGICAL_NAME), sample);
  assert.equal(tryReadRunRecord(sample, LOGICAL_NAME).ok, true);
});

test("CT-100-243: a different major of the run record is refused (F100-FR-049)", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readRunRecord({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadRunRecord({ ...sample, schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-243: an unknown field follows the rule of the schema (annex B, §B.4)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isRunRecord(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isRunRecord(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readRunRecord(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-243: every required field of the run record is required (annex E, §E.2)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0);
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isRunRecord(without), false, `${field} must be required`);
  }
  // Each field has a meaning and a type in words, as the annex gives it.
  const properties = (
    schema as { properties: Record<string, { description?: string; "x-type-in-words"?: string }> }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
});

test("CT-100-243: the fields F100-FR-143 names, `productVersions`, and one writer", () => {
  // The containment level, the result of the critic proof, the version of
  // the redaction pattern set: each is a required field of the schema.
  const required = requiredOf(SCHEMA_ID);
  for (const field of FIELDS_THE_REQUIREMENT_NAMES) {
    assert.ok(required.includes(field), `${field} is required`);
  }
  const properties = (schema as { properties: Record<string, { description?: string }> })
    .properties;
  assert.match(String(properties.containment?.description), /Level in force per role/);
  assert.match(String(properties.criticProof?.description), /proof of the form/);
  assert.match(String(properties.redaction?.description), /pattern set of the redactor/);

  // `productVersions` is one list: the version that started the run, then
  // the version of every later engine start (F100-FR-050).
  assert.equal(PRODUCT_VERSIONS_FIELD, "productVersions");
  assert.equal(PRODUCT_VERSIONS_IS_ONE_LIST, true);
  assert.ok(required.includes(PRODUCT_VERSIONS_FIELD));
  const record = { ...sample, productVersions: ["1.0.0", "1.1.0", "1.2.0"] };
  assert.ok(isRunRecord(record));
  assert.equal(productVersionOfEngineStart(record as never, 1), "1.0.0");
  assert.equal(productVersionOfEngineStart(record as never, 3), "1.2.0");
  assert.equal(productVersionOfEngineStart(record as never, 4), undefined);

  // One writer (F100-FR-143).
  assert.equal(WRITERS_COUNT, 1);
  assert.equal(WRITER, "Runtime root; the engine in start mode `standalone`");
  assert.equal(READERS, "All");

  // `state` is a state of the machine and never a derived condition.
  assert.ok(stateIsWritable("running"));
  assert.equal(stateIsWritable("dead"), false);
  assert.equal(stateIsWritable("stale"), false);
});

test("CT-100-244: every blocked reason has a stop reason and an exit code", () => {
  const raw = (machine as { blockedReasons: Record<string, string>[] }).blockedReasons;
  assert.equal(raw.length, 6);
  assert.equal(BLOCKED_REASONS.length, 6);
  assert.equal(blockedReasonRows.length, 6);
  assert.deepEqual([...blockedReasonSet.members], [...BLOCKED_REASONS]);
  assert.equal(blockedReasonSet.number, 4);

  for (const row of blockedReasonRows) {
    // A stop reason of §E.3, and an exit code of the engine table of §E.4.
    assert.ok(isStopReason(row.stopReason), `${row.reason} names a stop reason of §E.3`);
    assert.ok(isEngineExitCode(row.engineExit), `${row.reason} names an engine code`);
    // The code of the row carries that stop reason in §E.4.
    const engineRow = engineExitRow(row.engineExit);
    assert.ok(
      (engineRow?.stopReasons ?? []).includes(row.stopReason as never),
      `${row.reason}: the engine code ${row.engineExit} carries \`${row.stopReason}\``,
    );
    // `retryable` is No for every row (F100-FR-144).
    assert.equal(row.retryable, false, `${row.reason} is not retryable`);
    assert.notEqual(row.when.trim(), "", `${row.reason} says when it happens`);
    assert.equal(stopReasonOf(row.reason), row.stopReason);
    assert.equal(engineExitOf(row.reason), row.engineExit);
  }
  assert.equal(blockedReasonRow("invented"), undefined);
  assert.equal(stopReasonOf("invented"), undefined);
});

test("CT-100-244: a blocked run ends, releases the lock, and is never relaunched", () => {
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.emitsTheEvent, "blocked");
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.writesTheTerminalRecord, true);
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.releasesTheLock, true);
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.ends, true);
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.restsIn, "blocked-on-human");
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.relaunchedByEitherClassifierTable, false);
  assert.deepEqual(
    [...WHAT_A_BLOCKED_RUN_DOES.classifierTables],
    ["relaunch-observe", "relaunch-root"],
  );
  for (const reason of BLOCKED_REASONS) {
    for (const table of WHAT_A_BLOCKED_RUN_DOES.classifierTables) {
      assert.equal(mayRelaunch(reason, table), false, `${reason} is not relaunched by ${table}`);
    }
  }

  // The event `blocked` carries the reason and what the run needs.
  const event = blockedEvent("auth", "sign in again");
  assert.equal(event.event, "blocked");
  assert.equal(event.reason, "auth");
  assert.equal(event.needs, "sign in again");
  assert.equal(event.stopReason, "proposer_consecutive_errors");
  assert.equal(event.engineExit, 4);
  assert.equal(event.synthesized, undefined);
  assert.throws(() => blockedEvent("invented" as never, "x"), /not a blocked reason/);
});

test("CT-100-245: a changed source hash is refused with exit 3, names the file, records T3", () => {
  assert.equal(SOURCE_CHANGED, "source-changed");
  assert.ok(blockedReasonSet.has(SOURCE_CHANGED));
  assert.equal(SOURCE_CHANGED_REFUSAL.exitCode, 3);
  assert.equal(SOURCE_CHANGED_REFUSAL.namesTheFileThatChanged, true);
  assert.equal(SOURCE_CHANGED_REFUSAL.recordedInTheLaunchRecordAs, "T3");
  assert.equal(SOURCE_CHANGED_REFUSAL.launchRecordOutcome, "refused");
  assert.equal(SOURCE_CHANGED_REFUSAL.readersShowTheState, "blocked-on-human");
  assert.equal(SOURCE_CHANGED_REFUSAL.attentionItem, "source-changed");
  assert.equal(SOURCE_CHANGED_REFUSAL.eventIsMarkedSynthesized, true);
  assert.match(SOURCE_CHANGED_REFUSAL.eventWrittenBy, /next process that becomes the writer/);

  // The row of the blocked reason agrees: exit 3, `critic_config`.
  const row = blockedReasonRow(SOURCE_CHANGED);
  assert.equal(row?.engineExit, 3);
  assert.equal(row?.stopReason, "critic_config");

  // The refusal for one file.
  const refusal = sourceChangedRefusal("specs/100-specstride/plan.md");
  assert.equal(refusal.exitCode, 3);
  assert.equal(refusal.file, "specs/100-specstride/plan.md");
  assert.equal(refusal.transition, "T3");
  assert.equal(refusal.outcome, "refused");
  assert.equal(refusal.state, "blocked-on-human");
  assert.equal(refusal.attentionItem, "source-changed");
  assert.equal(refusal.event.synthesized, true);
  assert.match(refusal.event.needs, /specs\/100-specstride\/plan\.md/);

  // T3 of the machine writes exactly that (annex E §E.2).
  const raw = (machine as { transitions: Record<string, string>[] }).transitions;
  const t3 = raw.find((t) => t["#"] === "T3");
  assert.notEqual(t3, undefined);
  assert.equal(t3?.To, "`blocked-on-human`");
  assert.equal(t3?.Owner, "CLI");
  assert.match(String(t3?.Written), /outcome `refused` and the file named/);
  assert.match(String(t3?.Written), /exits 3/);
});

test("CT-100-246: a quota pause spends no count and no budget, and has a 24-hour ceiling", () => {
  // Nothing is spent.
  assert.deepEqual(
    [...COUNTERS_A_QUOTA_PAUSE_NEVER_SPENDS].sort(),
    [
      "errorCount",
      "malformedCount",
      "passes",
      "rejects",
      "relaunchBudget",
      "wallClockBudget",
    ].sort(),
  );
  for (const counter of COUNTERS_A_QUOTA_PAUSE_NEVER_SPENDS) {
    assert.equal(quotaPauseSpends(counter), 0, `a pause spends no ${counter}`);
  }
  assert.equal(
    Object.values(QUOTA_PAUSE_SPENDS).every((value) => value === 0),
    true,
  );
  assert.equal(PAUSE_HOLDS_WHILE_THE_RUNTIME_LIVES, true);

  // The ceiling: the key, and the default of 24 hours.
  assert.equal(PAUSE_MAX_TOTAL_MS_KEY, "pause.maxTotalMs");
  assert.equal(PAUSE_MAX_TOTAL_DEFAULT_HOURS, 24);
  assert.equal(PAUSE_MAX_TOTAL_MS_DEFAULT, 24 * 60 * 60 * 1000);
  // The key is the switch of row 39 of the parity profile (annex X §X.7).
  const row39 = loadProfile().find((row) => row.number === 39);
  assert.notEqual(row39, undefined);
  assert.ok([...(row39?.keys ?? [])].includes(PAUSE_MAX_TOTAL_MS_KEY));
  assert.match(String(row39?.default), /ceiling 24 hours/);

  // At the ceiling the run rests in `blocked-on-human` with
  // `paused_quota_ceiling`.
  assert.equal(AT_THE_CEILING.state, "blocked-on-human");
  assert.equal(AT_THE_CEILING.stopReason, "paused_quota_ceiling");
  assert.equal(AT_THE_CEILING.blockedReason, "quota-wait-ceiling");
  assert.equal(AT_THE_CEILING.engineExit, 4);
  assert.equal(AT_THE_CEILING.retryable, false);
  assert.equal(atTheCeiling(PAUSE_MAX_TOTAL_MS_DEFAULT - 1), undefined);
  assert.deepEqual(atTheCeiling(PAUSE_MAX_TOTAL_MS_DEFAULT), AT_THE_CEILING);
  assert.deepEqual(atTheCeiling(60_000, 60_000), AT_THE_CEILING);
  // The row of `quota-wait-ceiling` agrees with the constant.
  const row = blockedReasonRow("quota-wait-ceiling");
  assert.equal(row?.stopReason, AT_THE_CEILING.stopReason);
  assert.equal(row?.engineExit, AT_THE_CEILING.engineExit);

  // The pause record is present exactly while the run is paused.
  assert.equal(pauseRecordIsPresent("paused-quota"), true);
  for (const state of ["running", "blocked-on-human", "finished", "stopping"] as const) {
    assert.equal(pauseRecordIsPresent(state), false, `no pause record in ${state}`);
  }

  // After a reboot nothing relaunches by itself; `resume` enters it again.
  assert.equal(AFTER_A_REBOOT.relaunchesByItself, false);
  assert.equal(AFTER_A_REBOOT.resumeEntersThePauseAgain, true);
});

test("CT-100-247: a lost lease ends with `owner-lost`, `stop_flag`, `causedBy: crash`, exit 6", () => {
  assert.equal(LEASE_IS_VERIFIED_AT_EVERY_BOUNDARY_THAT_READS_THE_STOP_REQUEST, true);
  assert.equal(OWNER_LOST.cause, "owner-lost");
  assert.equal(OWNER_LOST.stopReason, "stop_flag");
  assert.equal(OWNER_LOST.causedBy, "crash");
  assert.equal(OWNER_LOST.exitCode, 6);
  assert.equal(OWNER_LOST.finishesTheCurrentPass, true);
  assert.equal(OWNER_LOST.runsThePhaseGate, false);
  assert.equal(OWNER_LOST.retryable, false);

  // The lease check at one boundary.
  assert.equal(leaseCheck(true), undefined);
  assert.deepEqual(leaseCheck(false), OWNER_LOST);

  // `stop_flag` is the member the engine code 6 carries (§E.3, §E.4).
  assert.ok(isStopReason(OWNER_LOST.stopReason));
  const six = engineExitRow(6);
  assert.deepEqual([...(six?.stopReasons ?? [])], ["stop_flag"]);
  assert.match(String(six?.meaning), /the owner of the lease was lost/);
});
