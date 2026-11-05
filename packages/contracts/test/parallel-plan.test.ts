/**
 * T173 — contract tests CT-100-226, CT-100-227 and CT-100-228 for the parallel
 * plan (annex D, §D.3): a valid sample passes, a different major is refused, an
 * unknown field follows the rule of the schema, and every required field is
 * required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/parallel-plan.schema.json" with { type: "json" };
import {
  ANNEX_SECTION,
  A_WORKER_TREE_EXISTS_WHEN_A_CRITIC_CLASS_CALL_STARTS,
  AN_INTEGRATED_GROUP_IS_ONE_UNIT_IN_THE_FACT_BLOCK,
  COMPUTED_AT,
  CONTENT_OWNER,
  DERIVED_FROM,
  GROUP_MINIMUM_TASKS,
  KEY_DEFAULTS,
  LOGICAL_NAME,
  NEUTRAL_INTEGRITY_KINDS,
  NEVER_IN_A_CRITIC_CLASS_CALL,
  ON_A_DIFFERENT_PLAN_AT_RELAUNCH,
  ON_A_HASH_THAT_DOES_NOT_MATCH,
  PARITY_ROW,
  PRINTED_ONLY_WITH_THE_OPTION_ON,
  RECOMPUTED_INSIDE_A_RUN,
  REPORTED_WITH_A_COUNT,
  SCHEMA_ID,
  SCOPE_SOURCES,
  STORED_WITH_ITS_HASH,
  WIDENING_KEYS,
  WORKERS_CEILING_KEY,
  WORKERS_MAX_MINIMUM,
  ceilingInForce,
  decideStoredPlan,
  groupSizeIsAllowed,
  isParallelPlan,
  mayReachACriticClassCall,
  readParallelPlan,
  tryReadParallelPlan,
  workersAboveTheCeilingIsAConfigurationError,
} from "../src/records/parallel-plan.ts";
import { RecordRefusedError } from "../src/records/validate.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

const sample = sampleOf(SCHEMA_ID);

test("CT-100-226: a valid sample of the parallel plan passes (annex D, §D.3)", () => {
  assert.equal(SCHEMA_ID, "specstride.parallel-plan/1");
  assert.equal(LOGICAL_NAME, "run:<runId>:parallel-plan");
  assert.equal(ANNEX_SECTION, "annex D, §D.3");
  assert.equal(CONTENT_OWNER, "142");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.ok(isParallelPlan(sample));
  assert.deepEqual(readParallelPlan(sample, LOGICAL_NAME), sample);
  assert.equal(tryReadParallelPlan(sample, LOGICAL_NAME).ok, true);
});

test("CT-100-226: a different major of the parallel plan is refused with both majors", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.throws(
    () => readParallelPlan({ ...sample, schema: next }, LOGICAL_NAME),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LOGICAL_NAME);
      assert.match(err.message, /the major found is/);
      assert.match(err.message, /the major supported is/);
      return true;
    },
  );
  assert.equal(tryReadParallelPlan({ ...sample, schema: next }, LOGICAL_NAME).ok, false);
});

test("CT-100-226: an unknown field follows the rule of the schema (annex D, §D.3)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...sample, aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isParallelPlan(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isParallelPlan(withExtra), `the reader ignores a field it does not know: ${rule}`);
    assert.doesNotThrow(() => readParallelPlan(withExtra, LOGICAL_NAME));
  }
});

test("CT-100-226: every required field of the parallel plan is required (annex D, §D.3)", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    ["schema", "runId", "hash", "workers", "phases", "fallback"],
    "the six required rows of the table of §D.3",
  );
  for (const field of required) {
    const without: Record<string, unknown> = { ...sample };
    delete without[field];
    assert.equal(isParallelPlan(without), false, `${field} must be required`);
  }
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field], undefined, field);
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
  // `phases[]` holds groups, tasks and serial, each required (§D.3).
  const phases = properties["phases"] as { items?: { required?: string[] } } | undefined;
  assert.deepEqual([...(phases?.items?.required ?? [])].sort(), ["groups", "serial", "tasks"]);
});

test("CT-100-226: F100-FR-126 — the plan is derived at launch and stored with its hash", () => {
  assert.deepEqual(
    [...DERIVED_FROM],
    ["the task list as read at launch", "configuration"],
    "a pure function of the task list at launch and of configuration",
  );
  assert.equal(COMPUTED_AT, "launch");
  assert.equal(RECOMPUTED_INSIDE_A_RUN, false);
  assert.equal(STORED_WITH_ITS_HASH, true);
  assert.equal(PRINTED_ONLY_WITH_THE_OPTION_ON, true);
  assert.equal(PARITY_ROW, 20);

  // The hash matches and the relaunch derives the same plan: use it.
  assert.equal(
    decideStoredPlan({ storedHash: "h", hashOfTheStoredPlan: "h", derivedHash: "h" }),
    "use",
  );
  // A relaunch that derives a different plan announces the difference and uses
  // the stored plan.
  assert.equal(
    decideStoredPlan({ storedHash: "h", hashOfTheStoredPlan: "h", derivedHash: "other" }),
    "announce-and-use-stored",
  );
  assert.equal(ON_A_DIFFERENT_PLAN_AT_RELAUNCH.announceTheDifference, true);
  assert.equal(ON_A_DIFFERENT_PLAN_AT_RELAUNCH.useTheStoredPlan, true);
  // A stored plan whose hash does not match switches the layer off for the run
  // with an integrity event.
  assert.equal(
    decideStoredPlan({ storedHash: "h", hashOfTheStoredPlan: "other" }),
    "layer-off-for-run",
  );
  assert.equal(ON_A_HASH_THAT_DOES_NOT_MATCH.layerOffForRun, true);
  assert.equal(ON_A_HASH_THAT_DOES_NOT_MATCH.integrityEvent, true);
  assert.deepEqual([...SCOPE_SOURCES], ["consumer-declaration", "task-text-at-launch"]);
});

test("CT-100-227: F100-FR-127 — the defaults, the ceiling and the widening keys", () => {
  assert.equal(KEY_DEFAULTS["loop.parallel.units"], "off");
  assert.equal(KEY_DEFAULTS["loop.parallel.workers"], 2);
  assert.equal(KEY_DEFAULTS["loop.parallel.workersMax"], 4);
  assert.equal(KEY_DEFAULTS["loop.parallel.quota_headroom"], 70);
  assert.equal(KEY_DEFAULTS["loop.parallel.allow_detect"], "off");
  assert.equal(WORKERS_CEILING_KEY, "loop.parallel.workersMax");
  assert.equal(WORKERS_MAX_MINIMUM, 1);
  assert.deepEqual([...WIDENING_KEYS], ["loop.parallel.workersMax", "loop.parallel.allow_detect"]);

  // Project configuration may LOWER the ceiling.
  const lowered = ceilingInForce({ fromLowerRanks: 4, fromProjectConfiguration: 2 });
  assert.equal(lowered.value, 2);
  assert.equal(lowered.ignored, false);
  // It may never RAISE it: the higher value is ignored, with a launch message
  // and a doctor warning (F100-FR-202).
  const raised = ceilingInForce({ fromLowerRanks: 4, fromProjectConfiguration: 8 });
  assert.equal(raised.value, 4);
  assert.equal(raised.ignored, true);
  assert.match(String(raised.launchMessage), /widens the run/);
  assert.match(String(raised.doctorWarning), /widening key/);

  // A value of `loop.parallel.workers` above the ceiling in force is an error.
  assert.equal(workersAboveTheCeilingIsAConfigurationError(5, 4), true);
  assert.equal(workersAboveTheCeilingIsAConfigurationError(4, 4), false);

  // A group holds at least 2 tasks and at most `workers` (§D.3).
  assert.equal(GROUP_MINIMUM_TASKS, 2);
  assert.equal(groupSizeIsAllowed(1, 4), false);
  assert.equal(groupSizeIsAllowed(2, 4), true);
  assert.equal(groupSizeIsAllowed(5, 4), false);
});

test("CT-100-228: F100-FR-128 — nothing of groups or workers reaches a critic-class call", () => {
  assert.equal(NEVER_IN_A_CRITIC_CLASS_CALL.length, 6);
  for (const field of NEVER_IN_A_CRITIC_CLASS_CALL) {
    assert.equal(mayReachACriticClassCall(field), false, field);
  }
  assert.equal(mayReachACriticClassCall("workerId"), false);
  assert.equal(mayReachACriticClassCall("groupId"), false);
  assert.equal(mayReachACriticClassCall("treeFingerprint"), true);
  assert.equal(AN_INTEGRATED_GROUP_IS_ONE_UNIT_IN_THE_FACT_BLOCK, true);
  assert.deepEqual(
    [...NEUTRAL_INTEGRITY_KINDS],
    ["tree-changed-outside-pass", "protected-change-not-applied"],
  );
  assert.equal(REPORTED_WITH_A_COUNT, false);
  assert.equal(A_WORKER_TREE_EXISTS_WHEN_A_CRITIC_CLASS_CALL_STARTS, false);
});
