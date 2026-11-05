/**
 * T175 — contract tests CT-100-233 and CT-100-234 for the yield artifact
 * (annex D, §D.6): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/yield-artifact.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  CLAIM_RULES,
  CONTENT_OWNER,
  CONTINUE_AND_NOTIFY_AS_THE_DEFAULT_IS_ON,
  FAILFAST_DEFAULT,
  FAILFAST_RIDES_ON_A_LOOP_LAYER,
  FAILFAST_SWITCH,
  JOB_MODES,
  LOGICAL_NAME,
  MOVED_TO_WHEN_READ,
  ON_FIRST_FAILURE_DEFAULT,
  ON_FIRST_FAILURE_VALUES,
  PARITY_ROWS,
  POLITE_STOP_DEFAULT,
  POLITE_STOP_SWITCH,
  PREDICATE_NEEDS,
  READ_AS_A_CLAIM,
  REQUIRED_ALWAYS,
  REQUIRED_BY_CONDITION,
  RESUME_WHEN_KINDS,
  SCHEMA_FIELD,
  SCHEMA_ID,
  YieldRefusedError,
  isYieldArtifact,
  readYieldArtifact,
  stopsTheJob,
  tryReadYieldArtifact,
} from "../src/records/yield-artifact.ts";
import { requiredOf, withNextMajor } from "./samples.ts";

/** A valid sample of §D.6: the three fields the table requires always. */
const sample = Object.freeze({
  contract: SCHEMA_ID,
  reason: "the build of the release takes ninety minutes",
  deadline_sec: 7200,
});

test("CT-100-233: a valid sample of the yield artifact passes (annex D, §D.6)", () => {
  assert.equal(SCHEMA_ID, "specstride-pass-yield/v1");
  assert.equal(SCHEMA_FIELD, "contract");
  assert.equal(LOGICAL_NAME, "feature:<slug>:outbox");
  assert.equal(MOVED_TO_WHEN_READ, "job:<jobId>:yield");
  assert.equal(ANNEX_SECTION, "annex D, §D.6");
  assert.equal(CONTENT_OWNER, "118");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isYieldArtifact(sample));
  assert.deepEqual(readYieldArtifact(sample), sample);
  assert.equal(tryReadYieldArtifact(sample).ok, true);
  // The artifact is read as a claim under the rules of annex B §B.2.
  assert.equal(READ_AS_A_CLAIM, true);
  assert.equal(CLAIM_RULES, "annex B, §B.2");
});

test("CT-100-233: a different major of the yield artifact is refused with both majors", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.notEqual(next, SCHEMA_ID);
  assert.throws(
    () => readYieldArtifact({ ...sample, contract: next }),
    (err: unknown) => {
      assert.ok(err instanceof YieldRefusedError);
      assert.equal(err.reason, "different-major");
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadYieldArtifact({ ...sample, contract: next }).ok, false);
  // A record without the field `contract` is refused too.
  const withoutContract = { reason: "x", deadline_sec: 1 };
  const result = tryReadYieldArtifact(withoutContract);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reason, "missing-contract");
});

test("CT-100-233: an unknown field follows the rule of the schema (annex D, §D.6)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldANewMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isYieldArtifact(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isYieldArtifact(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readYieldArtifact(withExtra));
  }
});

test("CT-100-233: every required field of the yield artifact is required (annex D, §D.6)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual([...required], [...REQUIRED_ALWAYS]);
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isYieldArtifact(without), false, `${field} must be required`);
  }
  // The conditional cells of §D.6: `job.mode` and `resume_when.kind` are
  // required inside their record; the rest are required by their condition.
  const properties = (
    schema as {
      properties: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    }
  ).properties;
  assert.deepEqual([...(properties["job"]?.required ?? [])], ["mode"]);
  assert.deepEqual([...(properties["resume_when"]?.required ?? [])], ["kind"]);
  assert.equal(REQUIRED_BY_CONDITION["job.argv"], "With `launch`");
  assert.equal(REQUIRED_BY_CONDITION["job.pid"], "With `adopt`");
  assert.equal(REQUIRED_BY_CONDITION["resume_when.stable_sec"], "With `file_stable`");
  assert.equal(REQUIRED_BY_CONDITION["resume_when.pid"], "With `pid`");
  assert.equal(REQUIRED_BY_CONDITION["resume_when.argv"], "With `command`");
  assert.equal(REQUIRED_BY_CONDITION["on_first_failure"], "With `first_failure`");
  // The two closed sets of §D.6.
  assert.deepEqual([...JOB_MODES], ["launch", "adopt"]);
  assert.deepEqual(
    [...RESUME_WHEN_KINDS],
    ["pid", "exit_code_file", "file_exists", "file_stable", "grep", "command", "first_failure"],
  );
  for (const kind of RESUME_WHEN_KINDS) {
    assert.notEqual(PREDICATE_NEEDS[kind], undefined, kind);
  }
  assert.deepEqual([...PREDICATE_NEEDS["file_stable"]], ["path", "stable_sec"]);
  assert.deepEqual([...PREDICATE_NEEDS["grep"]], ["path", "pattern"]);
});

test("CT-100-233: the predicate `command` and a worker of a group are refused", () => {
  const withCommand = {
    ...sample,
    resume_when: { kind: "command", argv: ["/usr/bin/true"] },
  };
  // Without the consumer's permission the predicate `command` is refused.
  const refused = tryReadYieldArtifact(withCommand);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.reason, "command-not-allowed");
  // With it, the record is read.
  const allowed = tryReadYieldArtifact(withCommand, { consumerAllowedCommandPredicate: true });
  assert.equal(allowed.ok, true);
  // A worker of a parallel group never yields: its artifact is refused.
  const worker = tryReadYieldArtifact(sample, { writtenByAWorkerOfAParallelGroup: true });
  assert.equal(worker.ok, false);
  if (!worker.ok) assert.equal(worker.error.reason, "worker-of-a-parallel-group");
});

test("CT-100-234: F100-FR-134 — the two switches and the rule of stopping a job", () => {
  assert.equal(FAILFAST_SWITCH, "verification.failfast");
  assert.equal(FAILFAST_DEFAULT, true);
  assert.equal(FAILFAST_RIDES_ON_A_LOOP_LAYER, false);
  assert.equal(POLITE_STOP_SWITCH, "carry.polite_stop");
  assert.equal(POLITE_STOP_DEFAULT, true);
  assert.deepEqual([...ON_FIRST_FAILURE_VALUES], ["stop", "continue-and-notify"]);
  assert.equal(ON_FIRST_FAILURE_DEFAULT, "stop");
  assert.equal(CONTINUE_AND_NOTIFY_AS_THE_DEFAULT_IS_ON, false);
  assert.deepEqual([...PARITY_ROWS], [4, 5, 11]);

  // The runtime stops a job only if it launched it AND the yield declared stop.
  assert.equal(stopsTheJob({ launchedByTheRuntime: true, onFirstFailure: "stop" }), true);
  assert.equal(stopsTheJob({ launchedByTheRuntime: true }), true, "the default is `stop`");
  assert.equal(
    stopsTheJob({ launchedByTheRuntime: false, onFirstFailure: "stop" }),
    false,
    "an adopted job runs on: the wait ends and the job is left alone",
  );
  assert.equal(
    stopsTheJob({ launchedByTheRuntime: true, onFirstFailure: "continue-and-notify" }),
    false,
  );
});
