/**
 * CT-127-1 (T059) — the characterization test of LISA'S BUDGET EVALUATION AS
 * EXTRACTED, through the mapping to budgets per role and per run.
 *
 * Proves 002 FR-041, which the baseline states as:
 *
 *   "Budget evaluation MUST check four ceilings: tokens, cost, wall clock and
 *    attempts. A ceiling that is 0 or non-finite is off. Reaching any active
 *    ceiling MUST yield `BUDGET_EXCEEDED`."
 *   (`old/002-as-is-lisa/spec.md:205`; `packages/scheduler/src/budgets.ts` at
 *    `363e6a3`, whose `BudgetUsage` fields are `tokens`, `costUsd`,
 *    `wallClockMin` and `attempts`, `old/002-as-is-lisa/data-model.md:253-259`)
 *
 * F127-FR-024 is the translation. What this test holds, clause by clause:
 *
 *  1. the FOUR ceilings of the baseline map to the five dimensions of §Q.3,
 *     with Lisa's "attempts" renamed `phaseAttempts` (its "job attempt"
 *     belonged to the scheduler, which is not taken) and `calls` added at role
 *     scope — the mapping table below is asserted, not described;
 *  2. the four are checked AT ROLE AND AT RUN SCOPE, with the dimensions §Q.3
 *     gives each scope, and a dimension at a scope that cannot carry it is a
 *     configuration error;
 *  3. a ceiling of 0, absent, not a number or not finite is OFF — Lisa's rule,
 *     unchanged;
 *  4. reaching any active ceiling gives the event `budget.exceeded` naming
 *     which ceiling tripped and BY HOW MUCH — Lisa's single `BUDGET_EXCEEDED`
 *     becomes a named event with the fields of feature 111;
 *  5. the run stays RESUMABLE: raising the ceiling and running `resume`
 *     continues where it stopped, and the spend figure is the same one;
 *  6. the evaluation of several ceilings reports EVERY exhausted one, where
 *     Lisa's returned the first.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_DIMENSIONS,
  BUDGET_SCOPES,
  BudgetDimensionError,
  CAPS_OF_SPEND,
  CEILING_OF_TIME,
  DIMENSIONS_BY_SCOPE,
  budgetExceededPayload,
  evaluateCeilings,
  isActive,
  isOff,
  keyOf,
  readCeiling,
  readDimension,
  scopeCarries,
  type Ceiling,
  type UsageSnapshot,
} from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger, type SpendLedger } from "../src/budget/ledger.ts";
import { budgetExceeded } from "../src/quota/events.ts";
import { capStop, resumeAfterRaising } from "../src/budget/cap-stop.ts";
import { testPorts } from "./support/index.ts";

/* ------------------------------------------------------------------ *
 * The mapping of the baseline's four ceilings to the dimensions of §Q.3.
 * ------------------------------------------------------------------ */

/**
 * `old/002-as-is-lisa/data-model.md:255-257` — the `BudgetUsage` fields and
 * the budget dimensions of the baseline, against the dimension of §Q.3 each
 * became. The column "scopes" is what §Q.3 gives the dimension.
 */
const MAPPING = [
  { lisaDimension: "tokens", lisaField: "tokens", here: "tokens", scopes: ["role", "run"] },
  { lisaDimension: "cost", lisaField: "costUsd", here: "costUsd", scopes: ["role", "run"] },
  { lisaDimension: "wallClock", lisaField: "wallClockMin", here: "wallClock", scopes: ["run"] },
  { lisaDimension: "attempts", lisaField: "attempts", here: "phaseAttempts", scopes: ["run"] },
] as const;

/** `calls` is the one dimension §Q.3 adds that the baseline had not. */
const ADDED_HERE = { here: "calls", scopes: ["role", "run"] } as const;

function ledgerWith(
  figures: Readonly<{
    readonly role?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly costUsd?: number;
    readonly phaseAttempts?: number;
    readonly calls?: number;
  }>,
): SpendLedger {
  const role = figures.role ?? "proposer";
  let ledger = emptyLedger("run-ct-127-1");
  const calls = figures.calls ?? 1;
  for (let index = 0; index < calls; index += 1) {
    ledger = applyUsageRecord(ledger, {
      usageId: `u-${index}`,
      role,
      billingMode: "api",
      inputTokens: index === 0 ? (figures.inputTokens ?? null) : null,
      outputTokens: index === 0 ? (figures.outputTokens ?? null) : null,
      costUsd: index === 0 ? (figures.costUsd ?? null) : null,
      isCall: true,
      closesAPass: true,
    }).ledger;
  }
  ledger.run.phaseAttempts = figures.phaseAttempts ?? 0;
  return ledger;
}

function snapshot(ledger: SpendLedger, wallClockMinutes?: number): UsageSnapshot {
  return { ledger, ...(wallClockMinutes === undefined ? {} : { wallClockMinutes }) };
}

/* ------------------------------------------------------------------ *
 * 1. The four ceilings of the baseline are all present here.
 * ------------------------------------------------------------------ */

test("CT-127-1: each of the baseline's four dimensions maps to a dimension of §Q.3", () => {
  for (const row of MAPPING) {
    assert.ok(
      (BUDGET_DIMENSIONS as readonly string[]).includes(row.here),
      `the baseline dimension ${row.lisaDimension} maps to ${row.here}, which must be one of ` +
        `the five of §Q.3`,
    );
    assert.equal(readDimension(row.here), row.here);
  }
});

test("CT-127-1: Lisa's `attempts` is renamed `phaseAttempts` and nothing is lost", () => {
  const attempts = MAPPING.find((row) => row.lisaDimension === "attempts");
  assert.ok(attempts !== undefined);
  assert.equal(attempts.here, "phaseAttempts");
  // The old name is NOT a dimension here: the scheduler's "job attempt" is not taken.
  assert.ok(!(BUDGET_DIMENSIONS as readonly string[]).includes("attempts"));
  assert.throws(() => readDimension("attempts"), BudgetDimensionError);
});

test("CT-127-1: the five dimensions are the four of the baseline plus `calls`", () => {
  const mapped = MAPPING.map((row) => row.here);
  assert.deepEqual([...BUDGET_DIMENSIONS].sort(), [...mapped, ADDED_HERE.here].sort());
});

test("CT-127-1: four of the five are the caps of spend; `wallClock` is the ceiling of time", () => {
  assert.deepEqual([...CAPS_OF_SPEND].sort(), ["calls", "costUsd", "phaseAttempts", "tokens"]);
  assert.equal(CEILING_OF_TIME, "wallClock");
  assert.ok(!CAPS_OF_SPEND.includes(CEILING_OF_TIME));
});

/* ------------------------------------------------------------------ *
 * 2. Role scope and run scope.
 * ------------------------------------------------------------------ */

test("CT-127-1: the mapping's scopes are the ones §Q.3 gives each dimension", () => {
  for (const row of [...MAPPING, ADDED_HERE]) {
    for (const scope of BUDGET_SCOPES) {
      const expected = (row.scopes as readonly string[]).includes(scope);
      assert.equal(
        scopeCarries(scope, row.here as (typeof BUDGET_DIMENSIONS)[number]),
        expected,
        `${row.here} at the scope ${scope}`,
      );
    }
  }
});

test("CT-127-1: a role has `tokens`, `costUsd` and `calls`; the run has all five", () => {
  assert.deepEqual([...DIMENSIONS_BY_SCOPE.role], ["tokens", "costUsd", "calls"]);
  assert.deepEqual([...DIMENSIONS_BY_SCOPE.run], [...BUDGET_DIMENSIONS]);
});

test("CT-127-1: a dimension at a scope that cannot carry it is a configuration error", () => {
  const usage = snapshot(ledgerWith({}));
  assert.throws(
    () =>
      evaluateCeilings(
        [{ scope: "role", role: "proposer", dimension: "wallClock", limit: 30 }],
        usage,
      ),
    BudgetDimensionError,
  );
  assert.throws(
    () =>
      evaluateCeilings(
        [{ scope: "role", role: "proposer", dimension: "phaseAttempts", limit: 3 }],
        usage,
      ),
    BudgetDimensionError,
  );
});

test("CT-127-1: the keys of §Q.3 are the ones each scope writes", () => {
  assert.equal(
    keyOf({ scope: "role", role: "proposer", dimension: "costUsd", limit: 10 }),
    "budget.role.proposer.costUsd",
  );
  assert.equal(keyOf({ scope: "run", dimension: "tokens", limit: 1 }), "budget.run.tokens");
  assert.equal(
    keyOf({ scope: "run", dimension: "phaseAttempts", limit: 1 }),
    "budget.run.phaseAttempts",
  );
  // The wall clock keeps the key of the Specstride baseline, at either scope.
  assert.equal(keyOf({ scope: "run", dimension: "wallClock", limit: 30 }), "loop.maxWallMin");
});

/* ------------------------------------------------------------------ *
 * 3. 0 or non-finite is off — the baseline's rule, unchanged.
 * ------------------------------------------------------------------ */

test("CT-127-1: a ceiling of 0, absent, NaN or Infinity is off and never trips", () => {
  for (const limit of [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
    assert.equal(isOff(limit as number | null | undefined), true, `limit ${String(limit)}`);
    assert.equal(isActive(limit as number | null | undefined), false);
  }
  // A ledger far past any sensible figure still trips nothing while the ceiling is off.
  const usage = snapshot(ledgerWith({ costUsd: 1_000_000, inputTokens: 10_000_000 }), 10_000);
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 0 },
      { scope: "run", dimension: "tokens", limit: Number.NaN },
      { scope: "run", dimension: "wallClock", limit: null },
      { scope: "run", dimension: "phaseAttempts", limit: undefined },
    ],
    usage,
  );
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(
    evaluation.readings.every((reading) => !reading.active),
    true,
  );
});

test("CT-127-1: a ceiling that is set and not reached does not trip either", () => {
  const usage = snapshot(ledgerWith({ costUsd: 4 }));
  const evaluation = evaluateCeilings([{ scope: "run", dimension: "costUsd", limit: 10 }], usage);
  assert.equal(evaluation.exhausted.length, 0);
  assert.equal(evaluation.readings[0].active, true);
  assert.equal(evaluation.readings[0].used, 4);
});

/* ------------------------------------------------------------------ *
 * 4. `BUDGET_EXCEEDED` becomes the event `budget.exceeded`.
 * ------------------------------------------------------------------ */

test("CT-127-1: reaching an active ceiling gives `budget.exceeded` with the fields of 111", () => {
  const ports = testPorts();
  const usage = snapshot(ledgerWith({ costUsd: 12 }));
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, usage);
  assert.equal(reading.exhausted, true);
  const payload = budgetExceededPayload(reading);
  // The baseline's one outcome, as the catalogue of feature 111 holds it.
  assert.deepEqual(Object.keys(payload).sort(), [
    "dimension",
    "key",
    "limit",
    "over",
    "resumable",
    "role",
    "scope",
    "used",
  ]);
  assert.equal(payload.dimension, "costUsd");
  assert.equal(payload.limit, 10);
  assert.equal(payload.used, 12);
  assert.equal(payload.resumable, true);
  budgetExceeded(ports.eventWriter, {
    dimension: String(payload.dimension),
    limit: reading.limit,
    used: reading.used,
    role: reading.role,
    resumable: reading.resumable,
  });
  assert.deepEqual(ports.eventWriter.types(), ["budget.exceeded"]);
});

test("CT-127-1: the event names BY HOW MUCH the ceiling was passed", () => {
  const usage = snapshot(ledgerWith({ costUsd: 12 }));
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, usage);
  assert.equal(reading.over, 2);
  assert.equal(budgetExceededPayload(reading).over, 2);
});

test("CT-127-1: each of the four baseline dimensions trips on its own figure", () => {
  const cases: readonly { readonly ceiling: Ceiling; readonly usage: UsageSnapshot }[] = [
    {
      ceiling: { scope: "run", dimension: "tokens", limit: 100 },
      usage: snapshot(ledgerWith({ inputTokens: 60, outputTokens: 60 })),
    },
    {
      ceiling: { scope: "run", dimension: "costUsd", limit: 10 },
      usage: snapshot(ledgerWith({ costUsd: 10 })),
    },
    {
      ceiling: { scope: "run", dimension: "wallClock", limit: 30 },
      usage: snapshot(ledgerWith({}), 31),
    },
    {
      ceiling: { scope: "run", dimension: "phaseAttempts", limit: 3 },
      usage: snapshot(ledgerWith({ phaseAttempts: 3 })),
    },
  ];
  for (const { ceiling, usage } of cases) {
    const evaluation = evaluateCeilings([ceiling], usage);
    assert.equal(evaluation.exhausted.length, 1, `${ceiling.dimension} must trip`);
    assert.equal(evaluation.exhausted[0].dimension, ceiling.dimension);
  }
});

test("CT-127-1: `calls`, the dimension added here, trips at role and at run scope", () => {
  const usage = snapshot(ledgerWith({ calls: 5 }));
  for (const ceiling of [
    { scope: "role", role: "proposer", dimension: "calls", limit: 5 },
    { scope: "run", dimension: "calls", limit: 5 },
  ] as const) {
    const evaluation = evaluateCeilings([ceiling], usage);
    assert.equal(evaluation.exhausted.length, 1, `${ceiling.scope} scope`);
    assert.equal(evaluation.exhausted[0].used, 5);
  }
});

/* ------------------------------------------------------------------ *
 * 5. Resumable — raise the ceiling and `resume`.
 * ------------------------------------------------------------------ */

test("CT-127-1: every reading of this feature is resumable", () => {
  const usage = snapshot(ledgerWith({ costUsd: 12, calls: 4, phaseAttempts: 9 }), 99);
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "calls", limit: 2 },
      { scope: "run", dimension: "phaseAttempts", limit: 3 },
      { scope: "run", dimension: "wallClock", limit: 30 },
    ],
    usage,
  );
  assert.equal(
    evaluation.readings.every((reading) => reading.resumable),
    true,
  );
});

test("CT-127-1: raising the ceiling and `resume` continues with the SAME spend figure", () => {
  const ports = testPorts();
  const usage = snapshot(ledgerWith({ costUsd: 12 }));
  const reading = readCeiling({ scope: "run", dimension: "costUsd", limit: 10 }, usage);
  const stop = capStop(ports.eventWriter, { reading, role: "proposer" });
  assert.equal(stop.resumable, true);

  const resumed = resumeAfterRaising(reading, 25);
  assert.equal(resumed.resumes, true);
  assert.equal(resumed.from, 10);
  assert.equal(resumed.to, 25);
  // The spend of the run is ONE figure: the `resume` does not reset it.
  assert.equal(resumed.used, 12);

  // Raised to a figure the run has already passed: it stops again.
  assert.equal(resumeAfterRaising(reading, 11).resumes, false);
  // Raised to 0, which is "off" in configuration terms: not a resume of this ceiling.
  assert.equal(resumeAfterRaising(reading, 0).resumes, false);
});

/* ------------------------------------------------------------------ *
 * 6. Every exhausted ceiling is reported, not the first.
 * ------------------------------------------------------------------ */

test("CT-127-1: the evaluation of several ceilings reports EVERY exhausted one", () => {
  const usage = snapshot(ledgerWith({ costUsd: 12, inputTokens: 500, calls: 4 }), 60);
  const evaluation = evaluateCeilings(
    [
      { scope: "run", dimension: "costUsd", limit: 10 },
      { scope: "run", dimension: "tokens", limit: 100 },
      { scope: "run", dimension: "calls", limit: 2 },
      { scope: "run", dimension: "wallClock", limit: 30 },
      { scope: "run", dimension: "phaseAttempts", limit: 100 },
    ],
    usage,
  );
  assert.deepEqual(evaluation.exhausted.map((reading) => reading.dimension).sort(), [
    "calls",
    "costUsd",
    "tokens",
    "wallClock",
  ]);
  // The four caps of spend are kept apart from the ceiling of time (CQ-192).
  assert.deepEqual(evaluation.exhaustedCapsOfSpend.map((reading) => reading.dimension).sort(), [
    "calls",
    "costUsd",
    "tokens",
  ]);
  assert.equal(evaluation.wallClockTripped?.dimension, "wallClock");
  assert.equal(evaluation.readings.length, 5);
});

test("CT-127-1: role and run ceilings of the same dimension are both reported", () => {
  const usage = snapshot(ledgerWith({ role: "critic", costUsd: 7 }));
  const evaluation = evaluateCeilings(
    [
      { scope: "role", role: "critic", dimension: "costUsd", limit: 5 },
      { scope: "run", dimension: "costUsd", limit: 6 },
    ],
    usage,
  );
  assert.equal(evaluation.exhausted.length, 2);
  assert.deepEqual(
    evaluation.exhausted.map((reading) => reading.key),
    ["budget.role.critic.costUsd", "budget.run.costUsd"],
  );
});
