/**
 * CT-127-35 (T052) — the characterization test of the THRESHOLDS, the LEVELS,
 * the DEDUPLICATION and the REDACTION (F127-FR-037, §Q.4).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_KINDS,
  ALERT_KIND_BUDGET_THRESHOLD,
  ALERT_KIND_SET,
  ALERT_KIND_WHEN_UNKNOWN,
  ALERT_LEVELS,
  ALERT_LEVEL_SET,
  ALERT_LEVEL_WHEN_UNKNOWN,
  DEDUPE_KEY_PARTS,
  DEFAULT_THRESHOLDS,
  FIXED_LEVELS,
  LEVEL_CASES,
  LEVEL_TABLE,
  ONE_HUNDRED_PER_CENT_IS_AN_EVENT_NOT_AN_ALERT,
  PARITY_SETS_NO_CEILING,
  THRESHOLDS_KEY,
  alertStateOf,
  decideThresholdAlerts,
  dedupeKeyOf,
  emptyAlertState,
  fixedLevelOf,
  hasFired,
  highestThresholdCrossed,
  isAlertKind,
  levelCaseOf,
  levelForThreshold,
  markFired,
  percentOf,
  raiseFixedAlert,
  raiseThresholdAlerts,
  readAlertLevel,
  readThresholds,
  rearm,
  rearmKey,
  thresholdsCrossed,
} from "../src/budget/alerts.ts";
import { readCeiling, type Ceiling } from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger } from "../src/budget/ledger.ts";
import { PROFILE_NAME, rowOfKey } from "@specstride/contracts/profile/parity";
import { testPorts } from "./support/index.ts";

/** A redactor that removes a key-looking token and cuts to the cap. */
const fakeRedact = (text: string, cap: number) => ({
  text: text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]").slice(0, cap),
  replacements: 1,
  patternSetVersion: "test",
});

/** A ledger whose proposer has spent `costUsd` on an API key. */
function spent(costUsd: number) {
  return applyUsageRecord(emptyLedger("run-1"), {
    usageId: `u-${costUsd}`,
    role: "proposer",
    billingMode: "api",
    costUsd,
    isCall: true,
  }).ledger;
}

const COST_CEILING: Ceiling = { scope: "role", role: "proposer", dimension: "costUsd", limit: 100 };

test("CT-127-35: the three levels and the five kinds are rows 48 and 205", () => {
  assert.deepEqual([...ALERT_LEVELS], ["info", "warn", "loud"]);
  assert.deepEqual([...(ALERT_LEVEL_SET?.members ?? [])], ["info", "warn", "loud"]);
  assert.equal(ALERT_LEVEL_SET?.owner, "127");
  assert.deepEqual(
    [...ALERT_KINDS],
    [
      "budget-threshold",
      "provider-warning",
      "billing-mode-change",
      "spend-unmeasurable",
      "ledger-unreadable",
    ],
  );
  assert.deepEqual([...(ALERT_KIND_SET?.members ?? [])], [...ALERT_KINDS]);
});

test("CT-127-35: the unknown-value rules of rows 48 and 205", () => {
  assert.equal(ALERT_LEVEL_WHEN_UNKNOWN, "warn");
  assert.equal(readAlertLevel("shouting"), "warn");
  assert.equal(readAlertLevel(null), "warn");
  assert.equal(readAlertLevel("loud"), "loud");
  assert.equal(ALERT_KIND_WHEN_UNKNOWN.shownAs, "text");
  assert.equal(ALERT_KIND_WHEN_UNKNOWN.level, "warn");
  assert.equal(isAlertKind("budget-threshold"), true);
  assert.equal(isAlertKind("a-kind-row-205-does-not-hold"), false);
});

test("CT-127-35: the thresholds default to 50, 75 and 90 per cent", () => {
  assert.equal(THRESHOLDS_KEY, "budget.alerts.thresholds");
  assert.deepEqual([...DEFAULT_THRESHOLDS], [50, 75, 90]);
  assert.deepEqual([...readThresholds(undefined)], [50, 75, 90]);
  assert.deepEqual([...readThresholds("not a list")], [50, 75, 90]);
  assert.deepEqual([...readThresholds([])], [50, 75, 90]);
  assert.deepEqual([...readThresholds([80, 60])], [60, 80], "sorted");
  assert.deepEqual(
    [...readThresholds([0, 100, 120, -5, 70])],
    [70],
    "0, 100 and beyond are dropped",
  );
});

test("CT-127-35: a crossing raises every threshold passed, and 100 per cent raises none", () => {
  assert.deepEqual([...thresholdsCrossed(49)], []);
  assert.deepEqual([...thresholdsCrossed(50)], [50]);
  assert.deepEqual([...thresholdsCrossed(76)], [50, 75]);
  assert.deepEqual([...thresholdsCrossed(95)], [50, 75, 90]);
  assert.deepEqual([...thresholdsCrossed(100)], [], "100 per cent is `budget.exceeded`");
  assert.deepEqual([...thresholdsCrossed(140)], []);
  assert.deepEqual([...thresholdsCrossed(null)], []);
  assert.equal(highestThresholdCrossed(76), 75);
  assert.equal(highestThresholdCrossed(10), null);
  assert.equal(ONE_HUNDRED_PER_CENT_IS_AN_EVENT_NOT_AN_ALERT, "budget.exceeded");
});

test("CT-127-35: the LEVELS by billing mode, as §Q.4 states them", () => {
  assert.deepEqual([...LEVEL_CASES], ["api-key", "soft-on-a-subscription", "any-other-ceiling"]);
  assert.deepEqual(LEVEL_TABLE["api-key"], { "50": "info", "75": "loud", "90": "loud" });
  assert.deepEqual(LEVEL_TABLE["soft-on-a-subscription"], {
    "50": "info",
    "75": "warn",
    "90": "warn",
  });
  assert.deepEqual(LEVEL_TABLE["any-other-ceiling"], { "50": "info", "75": "warn", "90": "warn" });

  // With an API key: 50 is `info`, 75 and 90 are `loud`.
  const api = {
    billingMode: "api" as const,
    scope: "role" as const,
    dimension: "costUsd" as const,
  };
  assert.equal(levelForThreshold(50, api), "info");
  assert.equal(levelForThreshold(75, api), "loud");
  assert.equal(levelForThreshold(90, api), "loud");

  // A soft budget on a subscription: 50 is `info`, 75 and 90 are `warn`.
  const soft = {
    billingMode: "subscription" as const,
    scope: "role" as const,
    dimension: "softTokens" as const,
  };
  assert.equal(levelCaseOf(soft), "soft-on-a-subscription");
  assert.equal(levelForThreshold(50, soft), "info");
  assert.equal(levelForThreshold(75, soft), "warn");
  assert.equal(levelForThreshold(90, soft), "warn");

  // Any other ceiling: a subscription or unknown role, or a run ceiling while
  // no role is on an API key.
  for (const billingMode of ["subscription", "unknown"] as const) {
    const other = { billingMode, scope: "role" as const, dimension: "costUsd" as const };
    assert.equal(levelCaseOf(other), "any-other-ceiling", billingMode);
    assert.equal(levelForThreshold(90, other), "warn", billingMode);
  }
  const runNoKey = {
    scope: "run" as const,
    dimension: "tokens" as const,
    anyRoleOnAnApiKey: false,
  };
  assert.equal(levelCaseOf(runNoKey), "any-other-ceiling");
  assert.equal(levelForThreshold(90, runNoKey), "warn");
  const runWithKey = {
    scope: "run" as const,
    dimension: "tokens" as const,
    anyRoleOnAnApiKey: true,
  };
  assert.equal(levelCaseOf(runWithKey), "api-key");
  assert.equal(levelForThreshold(90, runWithKey), "loud");
});

test("CT-127-35: a threshold a consumer configured follows the same shape", () => {
  const api = {
    billingMode: "api" as const,
    scope: "role" as const,
    dimension: "costUsd" as const,
  };
  const thresholds = readThresholds([60, 95]);
  assert.equal(levelForThreshold(60, api, thresholds), "info", "the lowest is `info`");
  assert.equal(levelForThreshold(95, api, thresholds), "loud");
  const soft = {
    billingMode: "subscription" as const,
    scope: "role" as const,
    dimension: "softTokens" as const,
  };
  assert.equal(levelForThreshold(95, soft, thresholds), "warn");
});

test("CT-127-35: the FIXED levels of §Q.4", () => {
  assert.equal(FIXED_LEVELS["billing-mode-change"], "loud");
  assert.equal(FIXED_LEVELS["provider-warning"], "warn");
  assert.equal(FIXED_LEVELS["spend-unmeasurable"], "warn");
  assert.equal(fixedLevelOf("billing-mode-change"), "loud");
  assert.equal(fixedLevelOf("provider-warning"), "warn");
  assert.equal(fixedLevelOf("spend-unmeasurable"), "warn");
  // `ledger-unreadable` is `loud` where any hard ceiling is set, else `warn`.
  assert.equal(fixedLevelOf("ledger-unreadable", { anyHardCeilingSet: true }), "loud");
  assert.equal(fixedLevelOf("ledger-unreadable", { anyHardCeilingSet: false }), "warn");
  assert.equal(fixedLevelOf("ledger-unreadable"), "warn");
  assert.equal(fixedLevelOf("budget-threshold"), null, "a threshold has no fixed level");
});

test("CT-127-35: the deduplication key is (kind, role, threshold)", () => {
  assert.deepEqual([...DEDUPE_KEY_PARTS], ["kind", "role", "threshold"]);
  assert.equal(
    dedupeKeyOf({ kind: "budget-threshold", role: "proposer", threshold: 75 }),
    "budget-threshold:proposer:75",
  );
  assert.equal(dedupeKeyOf({ kind: "ledger-unreadable" }), "ledger-unreadable:-:-");
  assert.equal(
    dedupeKeyOf({ kind: "budget-threshold", role: null, threshold: 50 }),
    "budget-threshold:-:50",
  );
});

test("CT-127-35: a threshold fires ONCE per key", () => {
  const ports = testPorts();
  const reading = readCeiling(COST_CEILING, { ledger: spent(80) });
  assert.equal(Math.round(percentOf(reading) ?? 0), 80);
  const context = {
    billingMode: "api" as const,
    scope: "role" as const,
    dimension: "costUsd" as const,
  };

  const first = raiseThresholdAlerts(ports.eventWriter, {
    reading,
    state: emptyAlertState(),
    context,
  });
  assert.deepEqual(
    first.raised.map((item) => [item.threshold, item.level]),
    [
      [50, "info"],
      [75, "loud"],
    ],
  );
  assert.equal(ports.eventWriter.countOf("alert"), 2);
  assert.equal(first.budgetLevel, "75");

  const second = raiseThresholdAlerts(ports.eventWriter, { reading, state: first.state, context });
  assert.deepEqual([...second.raised], [], "nothing fires a second time");
  assert.equal(ports.eventWriter.countOf("alert"), 2, "and nothing was written");
});

test("CT-127-35: the alert payload names the kind, the level, the role, the threshold, the value and the limit", () => {
  const ports = testPorts();
  const reading = readCeiling(COST_CEILING, { ledger: spent(55) });
  raiseThresholdAlerts(ports.eventWriter, {
    reading,
    state: emptyAlertState(),
    context: { billingMode: "api", scope: "role", dimension: "costUsd" },
  });
  const payload = ports.eventWriter.of("alert")[0].payload;
  assert.equal(payload.kind, ALERT_KIND_BUDGET_THRESHOLD);
  assert.equal(payload.level, "info");
  assert.equal(payload.role, "proposer");
  assert.equal(payload.threshold, 50);
  assert.equal(payload.value, 55);
  assert.equal(payload.limit, 100);
  assert.equal(payload.dedupeKey, "budget-threshold:proposer:50");
});

test("CT-127-35: a RESET RE-ARMS the key, and the same threshold fires again", () => {
  const ports = testPorts();
  const reading = readCeiling(COST_CEILING, { ledger: spent(60) });
  const context = {
    billingMode: "api" as const,
    scope: "role" as const,
    dimension: "costUsd" as const,
  };
  const first = raiseThresholdAlerts(ports.eventWriter, {
    reading,
    state: emptyAlertState(),
    context,
  });
  assert.equal(ports.eventWriter.countOf("alert"), 1);
  assert.equal(hasFired(first.state, "budget-threshold:proposer:50"), true);

  const rearmed = rearm(first.state, "proposer");
  assert.equal(hasFired(rearmed, "budget-threshold:proposer:50"), false);
  const again = raiseThresholdAlerts(ports.eventWriter, { reading, state: rearmed, context });
  assert.equal(again.raised.length, 1);
  assert.equal(ports.eventWriter.countOf("alert"), 2);
});

test("CT-127-35: the re-arm touches one role only, and `rearmKey` one key only", () => {
  let state = emptyAlertState();
  state = markFired(state, "budget-threshold:proposer:50");
  state = markFired(state, "budget-threshold:critic:50");
  state = markFired(state, "ledger-unreadable:-:-");
  const afterProposer = rearm(state, "proposer");
  assert.equal(hasFired(afterProposer, "budget-threshold:proposer:50"), false);
  assert.equal(hasFired(afterProposer, "budget-threshold:critic:50"), true);
  assert.equal(hasFired(afterProposer, "ledger-unreadable:-:-"), true);
  const afterRun = rearm(state);
  assert.equal(hasFired(afterRun, "ledger-unreadable:-:-"), false, "a run-scope key");
  assert.equal(
    hasFired(rearmKey(state, "budget-threshold:critic:50"), "budget-threshold:critic:50"),
    false,
  );
  // `markFired` twice keeps one entry.
  assert.equal(
    markFired(markFired(state, "a:b:c"), "a:b:c").fired.filter((key) => key === "a:b:c").length,
    1,
  );
});

test("CT-127-35: the keys of a ledger can be loaded, so the dedup survives a relaunch", () => {
  const state = alertStateOf(["budget-threshold:proposer:50"]);
  assert.equal(hasFired(state, "budget-threshold:proposer:50"), true);
  assert.equal(hasFired(state, "budget-threshold:proposer:75"), false);
  assert.deepEqual([...emptyAlertState().fired], []);
});

test("CT-127-35: every free-text field of an alert passes the REDACTOR", () => {
  const ports = testPorts();
  const result = raiseFixedAlert(
    ports.eventWriter,
    {
      kind: "spend-unmeasurable",
      role: "proposer",
      state: emptyAlertState(),
      message: "the harness sk-ABCDEF1234567890 reports no cost",
    },
    { redact: fakeRedact },
  );
  const message = String(result.event?.payload.message);
  assert.ok(!message.includes("sk-ABCDEF1234567890"), "the token is gone");
  assert.match(message, /\[REDACTED\]/);
  assert.equal(result.level, "warn");
});

test("CT-127-35: with NO redactor a free-text field is dropped, never carried in the clear", () => {
  const ports = testPorts();
  const result = raiseFixedAlert(ports.eventWriter, {
    kind: "ledger-unreadable",
    state: emptyAlertState(),
    message: "the ledger at sk-SECRETTOKEN0001 would not parse",
    anyHardCeilingSet: true,
  });
  assert.equal(result.event?.payload.message, "[dropped: redactor-unavailable]");
  assert.equal(result.event?.payload.level, "loud", "a hard ceiling is set");
});

test("CT-127-35: a fixed alert fires once per key too", () => {
  const ports = testPorts();
  const first = raiseFixedAlert(ports.eventWriter, {
    kind: "spend-unmeasurable",
    role: "proposer",
    state: emptyAlertState(),
  });
  assert.notEqual(first.event, null);
  const second = raiseFixedAlert(ports.eventWriter, {
    kind: "spend-unmeasurable",
    role: "proposer",
    state: first.state,
  });
  assert.equal(second.event, null);
  assert.equal(ports.eventWriter.countOf("alert"), 1);
});

test("CT-127-35: an inactive ceiling and unknown spend raise nothing", () => {
  const off: Ceiling = { scope: "role", role: "proposer", dimension: "costUsd", limit: 0 };
  const reading = readCeiling(off, { ledger: spent(500) });
  assert.equal(reading.active, false);
  assert.equal(percentOf(reading), null);
  assert.deepEqual(
    [
      ...decideThresholdAlerts({
        reading,
        state: emptyAlertState(),
        context: { billingMode: "api", scope: "role", dimension: "costUsd" },
      }),
    ],
    [],
  );
  // Spend the harness never reported is unknown, and unknown raises nothing.
  const unknown = readCeiling(COST_CEILING, { ledger: emptyLedger("run-2") });
  assert.equal(unknown.used, null);
  assert.equal(percentOf(unknown), null);
});

test("CT-127-35: under the `parity` profile no ceiling is set, so no threshold is reached", () => {
  assert.equal(PARITY_SETS_NO_CEILING, true);
  assert.equal(PROFILE_NAME.length > 0, true, "the profile is readable");
  // Row 108 of annex X §X.7 is the ceiling row; its parity value is not set.
  const row = rowOfKey("budget.run.costUsd");
  assert.equal(row?.number, 108, "row 108 of annex X §X.7 is the ceiling row");
  assert.equal(row?.parity, "none", "under `parity` no ceiling is set");
  const thresholds = rowOfKey("budget.alerts.thresholds");
  assert.equal(thresholds?.parity, "not used", "so no threshold is reached");
  // The ceilings of a parity run are off, and an off ceiling raises nothing.
  for (const limit of [0, null, undefined]) {
    const ceiling: Ceiling = { scope: "run", dimension: "tokens", limit };
    const reading = readCeiling(ceiling, { ledger: spent(999) });
    assert.equal(reading.active, false, String(limit));
    assert.deepEqual(
      [
        ...decideThresholdAlerts({
          reading,
          state: emptyAlertState(),
          context: { scope: "run", dimension: "tokens" },
        }),
      ],
      [],
      String(limit),
    );
  }
});
