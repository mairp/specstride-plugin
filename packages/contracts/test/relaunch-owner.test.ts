/**
 * T185 — contract tests CT-100-262 and CT-100-263 for who relaunches (annex F,
 * §F.4; F100-FR-162, F100-FR-163), read from the key `relaunchOwner` of
 * `data/process-model.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import processModelData from "../data/process-model.json" with { type: "json" };
import {
  ANNEX_SECTION,
  A_QUOTA_PAUSE_GIVES_THE_CLASSIFIER_NOTHING,
  A_RELAUNCH_CARRIES_FROM_THE_LEDGER,
  A_RELAUNCH_STARTS_A_FRESH_SESSION,
  CLASSIFIER_TABLES,
  CONTENT_OWNER,
  DATA_KEY,
  DEFAULT,
  EVALUATED_BY,
  KEY,
  NEVER_RELAUNCHED,
  O_33_IS_ACTIVE_UNDER_EVERY_PROFILE,
  O_34_IS_INACTIVE_UNDER_PARITY,
  PARITY_ROW,
  PARITY_ROW_OF_O_34,
  RELAUNCH_OWNERS,
  ROW_THAT_REFUSES_A_BLOCKED_RUN,
  ROW_THAT_REFUSES_A_STOP_THAT_IS_NOT_RETRYABLE,
  TABLES_ARE_PURE,
  TRUST_CLASS,
  UNDER_PARITY,
  isRelaunchOwner,
  loadRelaunchOwners,
  mayRelaunch,
  refusalOf,
  relaunchOwnerRow,
  relaunchOwnerRows,
  tableOf,
} from "../src/state/relaunch-owner.ts";

test("CT-100-262: `relaunch.owner` has two values and the default `root` (F100-FR-162)", () => {
  assert.equal(ANNEX_SECTION, "annex F, §F.4");
  assert.equal(DATA_KEY, "relaunchOwner");
  assert.equal(KEY, "relaunch.owner");
  assert.equal(CONTENT_OWNER, "123");
  assert.equal(TRUST_CLASS, "ordinary");
  const raw = (processModelData as { relaunchOwner: unknown[] }).relaunchOwner;
  assert.equal(relaunchOwnerRows.length, raw.length);
  assert.equal(relaunchOwnerRows.length, 2);
  assert.deepEqual(loadRelaunchOwners(), relaunchOwnerRows);
  assert.deepEqual([...RELAUNCH_OWNERS], ["root", "supervise"]);
  assert.equal(DEFAULT, "root");
  assert.equal(relaunchOwnerRow("root")?.isDefault, true);
  assert.equal(relaunchOwnerRow("supervise")?.isDefault, false);
  assert.equal(isRelaunchOwner("root"), true);
  assert.equal(isRelaunchOwner("host"), false);
  assert.equal(relaunchOwnerRow("host"), undefined);
  // The behaviour of each value, as the table states it.
  assert.match(relaunchOwnerRow("root")?.behaviour ?? "", /stays alive/);
  assert.match(relaunchOwnerRow("root")?.behaviour ?? "", /hold-relaunch/);
  assert.match(relaunchOwnerRow("supervise")?.behaviour ?? "", /exits with the pipeline code/);
  assert.equal(relaunchOwnerRow("root")?.where, "Normal runs");
  assert.match(relaunchOwnerRow("supervise")?.where ?? "", /parity/);
  // The value under the `parity` profile.
  assert.equal(UNDER_PARITY, "supervise");
  assert.equal(PARITY_ROW, 14);
});

test("CT-100-262: F100-FR-162 — both tables are pure, and a relaunch is fresh", () => {
  assert.deepEqual([...CLASSIFIER_TABLES], ["relaunch-observe", "relaunch-root"]);
  assert.equal(EVALUATED_BY, "the table evaluator");
  assert.equal(TABLES_ARE_PURE, true);
  assert.equal(A_RELAUNCH_STARTS_A_FRESH_SESSION, true);
  assert.deepEqual([...A_RELAUNCH_CARRIES_FROM_THE_LEDGER], ["counts", "ids"]);
  assert.equal(tableOf("root"), "relaunch-root");
  assert.equal(tableOf("supervise"), "relaunch-observe");
});

test("CT-100-263: F100-FR-163 — what is never relaunched", () => {
  assert.equal(NEVER_RELAUNCHED.length, 4);
  assert.equal(A_QUOTA_PAUSE_GIVES_THE_CLASSIFIER_NOTHING, true);

  // A run in `blocked-on-human` is never relaunched, under ANY profile.
  assert.equal(refusalOf({ state: "blocked-on-human" }), "blocked-on-human");
  assert.equal(refusalOf({ state: "blocked-on-human" }, "parity"), "blocked-on-human");
  assert.equal(mayRelaunch({ state: "blocked-on-human" }, "parity"), false);
  assert.equal(O_33_IS_ACTIVE_UNDER_EVERY_PROFILE, true);
  assert.equal(ROW_THAT_REFUSES_A_BLOCKED_RUN, "O-33");

  // A stop that is not retryable is refused outside `parity` and classified
  // under it (row 132 of annex X §X.7; DV-114).
  assert.equal(refusalOf({ state: "failed", retryable: false }), "not-retryable");
  assert.equal(refusalOf({ state: "failed", retryable: false }, "parity"), undefined);
  assert.equal(mayRelaunch({ state: "failed", retryable: false }, "parity"), true);
  assert.equal(O_34_IS_INACTIVE_UNDER_PARITY, true);
  assert.equal(ROW_THAT_REFUSES_A_STOP_THAT_IS_NOT_RETRYABLE, "O-34");
  assert.equal(PARITY_ROW_OF_O_34, 132);

  // A run that was stopped on request, and one under `hold-relaunch`.
  assert.equal(refusalOf({ state: "stopped", stoppedOnRequest: true }), "stopped-on-request");
  assert.equal(refusalOf({ state: "failed", holdRelaunchInForce: true }), "hold-relaunch");
  // A quota pause gives the classifier nothing to classify.
  assert.equal(refusalOf({ state: "paused-quota", pausedOnQuota: true }), "nothing-to-classify");
  // A plain failed run with `retryable: true` may be relaunched.
  assert.equal(refusalOf({ state: "failed", retryable: true }), undefined);
  assert.equal(mayRelaunch({ state: "failed", retryable: true }), true);
});
