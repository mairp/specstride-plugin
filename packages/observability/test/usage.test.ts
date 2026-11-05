/**
 * T021 — CT-111-106: usage (F111-FR-006).
 *
 * F111-FR-006: *Usage MUST be counted for every model call. `usage.reported`
 * MUST be written as each call completes, not only at the terminal record of a
 * pass. A record MUST carry a `usageId` (a replay is deduplicated by it), a
 * `scope`, a `cumulative` flag, the counts of input, output, cache-read,
 * cache-write and reasoning tokens (null when the harness did not report),
 * `costUsd` or null, `costSource`, `billing` (`api`, `subscription`,
 * `unknown`), and the harness, provider, model and role. An adapter MUST
 * convert a cumulative report to an increment. A reader MUST sum increments
 * only. Cost under a subscription MUST be labelled notional. A killed pass
 * MUST end with `usageComplete` false and the last partial usage, or with
 * `usage.unavailable` naming the reason; a harness that reports nothing MUST
 * give `usage.unavailable` with the reason `harness-does-not-report` for each
 * pass.*
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE_BY_TYPE } from "../src/catalogue/index.ts";
import {
  BILLINGS,
  COUNT_FIELDS,
  HARNESS_DOES_NOT_REPORT,
  NOTIONAL,
  USAGE_REPORTED,
  USAGE_UNAVAILABLE,
  dedupeByUsageId,
  isNotional,
  sumOfIncrements,
  toIncrement,
  usageFindings,
} from "../src/catalogue/types/usage.ts";
import { checkRefinedData, refinedDataSchemaOf } from "../src/catalogue/types/index.ts";

const FULL = {
  usageId: "u-1",
  scope: "call",
  cumulative: false,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: null,
  costUsd: 0.004,
  costSource: "provider",
  billing: "api",
};

/* ------------------------------------------------------------------ *
 * The record of one call.
 * ------------------------------------------------------------------ */

test("CT-111-106 `usage.reported` carries every field F111-FR-006 names", () => {
  const schema = refinedDataSchemaOf(USAGE_REPORTED);
  assert.ok(schema);
  for (const field of [
    "usageId",
    "scope",
    "cumulative",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "costUsd",
    "costSource",
    "billing",
  ]) {
    assert.ok(schema.required.includes(field), `${field} is required`);
    assert.ok(Object.hasOwn(schema.properties, field), `${field} is a property`);
  }
  assert.deepEqual(schema.properties.billing?.enum, BILLINGS);
  assert.deepEqual([...BILLINGS], ["api", "subscription", "unknown"]);
  assert.deepEqual(checkRefinedData(USAGE_REPORTED, FULL), []);
});

test("CT-111-106 a record that leaves a required field out is refused", () => {
  const { costSource: _dropped, ...without } = FULL;
  const findings = checkRefinedData(USAGE_REPORTED, without);
  assert.ok(findings.some((f) => f.path.includes("costSource")));
});

test("CT-111-106 a count the harness did not report is NULL, never absent and never 0", () => {
  assert.deepEqual(
    [...COUNT_FIELDS],
    ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"],
  );
  assert.deepEqual(checkRefinedData(USAGE_REPORTED, { ...FULL, reasoningTokens: null }), []);
  assert.deepEqual(checkRefinedData(USAGE_REPORTED, { ...FULL, costUsd: null }), []);
  const bad = checkRefinedData(USAGE_REPORTED, { ...FULL, inputTokens: "many" });
  assert.ok(bad.length > 0, "a count is a whole number or null, never text");
});

test("CT-111-106 usage is PER CALL: the scope says so and the id deduplicates a replay", () => {
  const records = [
    { ...FULL, usageId: "u-1" },
    { ...FULL, usageId: "u-2", inputTokens: 50 },
    { ...FULL, usageId: "u-1" }, // the same call, delivered twice
  ];
  assert.deepEqual(
    dedupeByUsageId(records).map((r) => r.usageId),
    ["u-1", "u-2"],
    "a replay is deduplicated by `usageId`",
  );
  assert.equal(sumOfIncrements(dedupeByUsageId(records)).inputTokens, 150);
});

/* ------------------------------------------------------------------ *
 * Increments.
 * ------------------------------------------------------------------ */

test("CT-111-106 an adapter converts a CUMULATIVE report to an increment", () => {
  const first = toIncrement(null, {
    ...FULL,
    cumulative: true,
    inputTokens: 100,
    outputTokens: 10,
  });
  assert.equal(first.cumulative, false, "what the adapter hands on is an increment");
  assert.equal(first.inputTokens, 100);

  const second = toIncrement(
    { ...FULL, cumulative: true, inputTokens: 100, outputTokens: 10 },
    { ...FULL, cumulative: true, inputTokens: 260, outputTokens: 35 },
  );
  assert.equal(second.inputTokens, 160, "the increment is the difference");
  assert.equal(second.outputTokens, 25);
  assert.equal(second.cumulative, false);
  // A count the harness did not report stays null through the conversion.
  assert.equal(second.reasoningTokens, null);
  // A report that is already an increment passes through unchanged.
  const plain = toIncrement({ ...FULL, inputTokens: 999 }, { ...FULL, inputTokens: 7 });
  assert.equal(plain.inputTokens, 7);
});

test("CT-111-106 a reader sums INCREMENTS ONLY", () => {
  const records = [
    { ...FULL, usageId: "u-1", cumulative: false, inputTokens: 100 },
    { ...FULL, usageId: "u-2", cumulative: false, inputTokens: 60 },
    // A cumulative record that slipped through: it is NOT added, or the total
    // would count the first two a second time.
    { ...FULL, usageId: "u-3", cumulative: true, inputTokens: 160 },
  ];
  const total = sumOfIncrements(records);
  assert.equal(total.inputTokens, 160, "160, not 320");
  assert.equal(total.outputTokens, 40);
  // A null count does not make the total null: it adds nothing and is marked.
  const withNulls = sumOfIncrements([
    { ...FULL, inputTokens: 10, reasoningTokens: null },
    { ...FULL, inputTokens: 5, reasoningTokens: 3 },
  ]);
  assert.equal(withNulls.inputTokens, 15);
  assert.equal(withNulls.reasoningTokens, 3);
  assert.equal(sumOfIncrements([]).inputTokens, 0);
});

/* ------------------------------------------------------------------ *
 * Subscription cost is notional.
 * ------------------------------------------------------------------ */

test("CT-111-106 cost under a SUBSCRIPTION is labelled notional", () => {
  const subscription = { ...FULL, billing: "subscription", costSource: NOTIONAL, costUsd: 0.02 };
  assert.equal(NOTIONAL, "notional");
  assert.deepEqual(usageFindings(subscription), []);
  assert.equal(isNotional(subscription), true);
  assert.equal(isNotional({ ...FULL, billing: "api" }), false);

  const unlabelled = { ...FULL, billing: "subscription", costSource: "provider" };
  assert.ok(
    usageFindings(unlabelled).some((f) => f.includes("notional")),
    "a cost under a subscription that is not labelled notional is a finding",
  );
  // A cost of null under a subscription needs no label: there is no cost.
  assert.deepEqual(
    usageFindings({ ...FULL, billing: "subscription", costUsd: null, costSource: NOTIONAL }),
    [],
  );
});

/* ------------------------------------------------------------------ *
 * A killed pass, and a harness that reports nothing.
 * ------------------------------------------------------------------ */

test("CT-111-106 a KILLED pass ends with `usageComplete` false and the last partial usage", () => {
  const schema = refinedDataSchemaOf("pass.ended");
  assert.ok(schema);
  assert.ok(schema.required.includes("usageComplete"));
  assert.deepEqual(
    checkRefinedData("pass.ended", {
      endCause: "killed",
      usageComplete: false,
      timeBreakdown: { model: 10, tool: 2, wait: 1, idle: 0 },
      firstEditAt: null,
      transcriptRef: { logicalName: "run:r:transcript", hash: "a".repeat(64), size: 10 },
      reason: "hang",
      killClass: "hang",
      consec: 1,
    }),
    [],
  );
  const stillComplete = checkRefinedData("pass.ended", {
    endCause: "killed",
    usageComplete: true,
    timeBreakdown: { model: 10, tool: 2, wait: 1, idle: 0 },
    firstEditAt: null,
    transcriptRef: { logicalName: "run:r:transcript", hash: "a".repeat(64), size: 10 },
  });
  assert.ok(
    stillComplete.some((f) => f.keyword === "rule" && f.message.includes("usageComplete")),
    "a killed pass cannot claim its usage is complete",
  );
});

test("CT-111-106 a harness that reports nothing gives `usage.unavailable` per pass", () => {
  assert.equal(HARNESS_DOES_NOT_REPORT, "harness-does-not-report");
  assert.ok(CATALOGUE_BY_TYPE.has(USAGE_UNAVAILABLE));
  const schema = refinedDataSchemaOf(USAGE_UNAVAILABLE);
  assert.ok(schema);
  assert.ok(schema.required.includes("reason"));
  assert.ok(schema.required.includes("scope"));
  assert.deepEqual(
    checkRefinedData(USAGE_UNAVAILABLE, {
      reason: HARNESS_DOES_NOT_REPORT,
      scope: "pass",
      iter: 3,
    }),
    [],
  );
  assert.deepEqual(checkRefinedData(USAGE_UNAVAILABLE, { reason: "killed", scope: "pass" }), []);
  assert.ok(
    checkRefinedData(USAGE_UNAVAILABLE, { scope: "pass" }).some((f) => f.path.includes("reason")),
    "the record names the reason",
  );
});

test("CT-111-106 usage holds no text of a prompt or a reply", () => {
  const entry = CATALOGUE_BY_TYPE.get(USAGE_REPORTED);
  assert.ok(entry);
  assert.deepEqual([...entry.freeTextFields], [], "no field of `usage.reported` is free text");
});
