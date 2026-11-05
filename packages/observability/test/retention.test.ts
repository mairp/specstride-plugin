/**
 * T039 — PT-111-C-167-retention: the parity test of C-167 / B-2219 to B-2223 on
 * the fixture family FX-01 (the core loop), surface `state`.
 *
 * F111-FR-028: *The retention policy MUST be kept as at the baseline: the version
 * string `specstride-retention/v1`; raw capture disabled by default; raw
 * retention 7 days; metadata retention 30 days; the tool result limit 4096
 * bytes. A metadata retention shorter than the raw retention MUST be refused
 * with `metadata retention must not be shorter than raw retention`; a negative
 * or non-integer number of days MUST be refused with `<name> must be a
 * non-negative integer`. The metadata of the policy MUST be `policy_version`,
 * `raw_capture_enabled`, `raw_retention_days` and `metadata_retention_days`. The
 * decision MUST be a pure function: raw content is removed when its age in days
 * is greater than the raw retention, metadata when greater than the metadata
 * retention, and the removal of metadata MUST force the removal of raw content.
 * Applying the decision to files is not part of this feature.*
 *
 * The decision function is tested AS A PURE FUNCTION: the same age gives the same
 * answer on every call, the answer depends on nothing but the age and the policy,
 * and no file is read or written — the test runs with no temporary directory at
 * all, which is the whole of the surface `state` that this feature owns here.
 * Applying the decision to files is the invocation-retention feature's.
 *
 * The REFERENCE side is the oracle of feature 141, which is not built: that half
 * reports a SKIP with its reason and never a pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLYING_THE_DECISION_IS_NOT_PART_OF_THIS_FEATURE,
  METADATA_SHORTER_MESSAGE,
  RETENTION_DEFAULTS,
  RETENTION_METADATA_FIELDS,
  RETENTION_POLICY_VERSION,
  nonNegativeMessage,
  resolveRetentionPolicy,
  retentionActions,
  retentionMetadata,
} from "../src/ingress/retention.ts";

const ROOT = resolve(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

function referenceHalf(): { skip: string | false } {
  const present =
    existsSync(join(ROOT, "tests", "parity", "reference")) &&
    existsSync(join(ROOT, "packages", "oracle", "src"));
  if (present) return { skip: false };
  return {
    skip:
      `prerequisite missing: the parity oracle of feature 141 (\`packages/oracle\` and ` +
      `\`tests/parity/reference\`) is not built, so the fixture family FX-01 cannot be run ` +
      `against the reference. This is a SKIP with its reason and never a pass (the ` +
      `constitution, principle XVII).`,
  };
}

test(
  "PT-111-C-167: the retention of the reference on FX-01 equals the port's",
  referenceHalf(),
  () => {
    assert.fail("the oracle is present: compare the reference trees here");
  },
);

/* ------------------------------------------------------------------ *
 * The version string (B-2219).
 * ------------------------------------------------------------------ */

test("the version string is `specstride-retention/v1`", () => {
  assert.equal(RETENTION_POLICY_VERSION, "specstride-retention/v1");
});

test("the version travels with the policy's metadata", () => {
  assert.equal(
    retentionMetadata(resolveRetentionPolicy()).policy_version,
    RETENTION_POLICY_VERSION,
  );
});

/* ------------------------------------------------------------------ *
 * The defaults (B-2220).
 * ------------------------------------------------------------------ */

test("the defaults are the baseline's four", () => {
  assert.deepEqual(
    { ...RETENTION_DEFAULTS },
    {
      rawCaptureEnabled: false,
      rawRetentionDays: 7,
      metadataRetentionDays: 30,
      toolResultMaxBytes: 4096,
    },
  );
});

test("raw capture is DISABLED by default", () => {
  assert.equal(resolveRetentionPolicy().rawCaptureEnabled, false);
  assert.equal(retentionMetadata(resolveRetentionPolicy()).raw_capture_enabled, false);
});

test("`resolveRetentionPolicy` with nothing given is the defaults, with the version", () => {
  const policy = resolveRetentionPolicy();
  assert.equal(policy.rawRetentionDays, 7);
  assert.equal(policy.metadataRetentionDays, 30);
  assert.equal(policy.toolResultMaxBytes, 4096);
  assert.equal(policy.policyVersion, RETENTION_POLICY_VERSION);
});

/* ------------------------------------------------------------------ *
 * The refusals, with their messages (B-2221).
 * ------------------------------------------------------------------ */

test("a metadata retention shorter than the raw retention is refused, with its message", () => {
  assert.equal(
    METADATA_SHORTER_MESSAGE,
    "metadata retention must not be shorter than raw retention",
  );
  assert.throws(
    () => resolveRetentionPolicy({ rawRetentionDays: 30, metadataRetentionDays: 7 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, METADATA_SHORTER_MESSAGE);
      return true;
    },
  );
  // Equal is allowed: "not shorter" and not "longer".
  const equal = resolveRetentionPolicy({ rawRetentionDays: 7, metadataRetentionDays: 7 });
  assert.equal(equal.metadataRetentionDays, 7);
});

test("the message of a negative or non-integer number of days names the field", () => {
  assert.equal(
    nonNegativeMessage("raw_retention_days"),
    "raw_retention_days must be a non-negative integer",
  );
  for (const [name, option] of [
    ["raw_retention_days", "rawRetentionDays"],
    ["metadata_retention_days", "metadataRetentionDays"],
    ["tool_result_max_bytes", "toolResultMaxBytes"],
  ] as const) {
    for (const value of [-1, 1.5, Number.NaN, "7", null, true, Infinity]) {
      assert.throws(
        () => resolveRetentionPolicy({ [option]: value } as Record<string, never>),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, nonNegativeMessage(name));
          return true;
        },
        `${option} = ${String(value)}`,
      );
    }
  }
});

test("zero days is accepted for a retention, and refused for the byte limit", () => {
  // The baseline validates `>= 0` for the three, then `> 0` for the byte limit.
  const zero = resolveRetentionPolicy({ rawRetentionDays: 0 });
  assert.equal(zero.rawRetentionDays, 0);
  assert.throws(
    () => resolveRetentionPolicy({ toolResultMaxBytes: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "tool_result_max_bytes must be a positive integer");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * The metadata of the policy (B-2222).
 * ------------------------------------------------------------------ */

test("the metadata of the policy is exactly the four fields of the requirement", () => {
  assert.deepEqual(
    [...RETENTION_METADATA_FIELDS],
    ["policy_version", "raw_capture_enabled", "raw_retention_days", "metadata_retention_days"],
  );
  const metadata = retentionMetadata(resolveRetentionPolicy());
  assert.deepEqual(Object.keys(metadata), [...RETENTION_METADATA_FIELDS]);
  assert.deepEqual(metadata, {
    policy_version: "specstride-retention/v1",
    raw_capture_enabled: false,
    raw_retention_days: 7,
    metadata_retention_days: 30,
  });
});

/* ------------------------------------------------------------------ *
 * The decision function (B-2223).
 * ------------------------------------------------------------------ */

test("raw content is removed when its age is GREATER than the raw retention", () => {
  const policy = resolveRetentionPolicy();
  assert.deepEqual(retentionActions(policy, { ageDays: 7 }), {
    remove_raw: false,
    remove_metadata: false,
  });
  assert.deepEqual(retentionActions(policy, { ageDays: 8 }), {
    remove_raw: true,
    remove_metadata: false,
  });
});

test("metadata is removed when its age is GREATER than the metadata retention", () => {
  const policy = resolveRetentionPolicy();
  assert.deepEqual(retentionActions(policy, { ageDays: 30 }), {
    remove_raw: true,
    remove_metadata: false,
  });
  assert.deepEqual(retentionActions(policy, { ageDays: 31 }), {
    remove_raw: true,
    remove_metadata: true,
  });
});

test("the removal of metadata FORCES the removal of raw content", () => {
  // A policy whose metadata retention is the shorter of the two cannot be
  // built, so the force is shown where the two are equal: at the age that
  // removes metadata, raw goes with it and never stays behind.
  const policy = resolveRetentionPolicy({ rawRetentionDays: 5, metadataRetentionDays: 5 });
  assert.deepEqual(retentionActions(policy, { ageDays: 6 }), {
    remove_raw: true,
    remove_metadata: true,
  });
  for (let age = 0; age <= 60; age += 1) {
    const action = retentionActions(resolveRetentionPolicy(), { ageDays: age });
    if (action.remove_metadata) {
      assert.equal(action.remove_raw, true, `age ${age}: metadata goes, so raw goes`);
    }
  }
});

test("the decision is PURE: the same age gives the same answer, and nothing is read", () => {
  const policy = resolveRetentionPolicy();
  const first = retentionActions(policy, { ageDays: 42 });
  for (let repeat = 0; repeat < 5; repeat += 1) {
    assert.deepEqual(retentionActions(policy, { ageDays: 42 }), first);
  }
  // The answer depends on the age and the policy and on nothing else: two
  // policies that differ only in their retentions answer differently for the
  // same age, and a third that equals the first answers as the first.
  assert.deepEqual(retentionActions(resolveRetentionPolicy(), { ageDays: 42 }), first);
  assert.notDeepEqual(
    retentionActions(resolveRetentionPolicy({ rawRetentionDays: 60, metadataRetentionDays: 90 }), {
      ageDays: 42,
    }),
    first,
  );
});

test("applying the decision to files is NOT part of this feature, and is recorded as such", () => {
  assert.equal(APPLYING_THE_DECISION_IS_NOT_PART_OF_THIS_FEATURE, true);
  // The decision function returns a decision and touches no file: its answer is
  // two flags and no path.
  const action = retentionActions(resolveRetentionPolicy(), { ageDays: 99 });
  assert.deepEqual(Object.keys(action), ["remove_raw", "remove_metadata"]);
});
