/**
 * CT-127-33 (T071) — the characterization test of A HARNESS THAT REPORTS NO
 * COST (F127-FR-035, R11 T-18).
 *
 * "Where a harness reports no cost, its spend cannot be measured." The four
 * clauses:
 *
 *  1. at launch the ANNOUNCEMENT says so for THAT ROLE;
 *  2. the DOCTOR says so;
 *  3. an alert of kind `spend-unmeasurable` and level `warn` is written ONCE;
 *  4. the ceilings `wallClock`, `phaseAttempts` and `calls` STILL APPLY, and a
 *     cost or token ceiling set on such a role is NOT reported as enforced.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_KIND_SPEND_UNMEASURABLE,
  CEILINGS_NOT_ENFORCED,
  CEILINGS_THAT_STILL_APPLY,
  DOCTOR_CHECK_ID,
  DOCTOR_IS_LAUNCH_BLOCKING,
  DOCTOR_SEVERITY,
  SPEND_UNMEASURABLE_LEVEL,
  WRITTEN_ONCE,
  announceUnmeasurable,
  announcementLine,
  ceilingReport,
  doctorFinding,
  enforcedAndNot,
  handleUnmeasurableSpend,
  markUnmeasurable,
  reportsNoCost,
  stillApplies,
  unmeasurableDedupeKey,
  type HarnessCostReport,
} from "../src/budget/unmeasurable.ts";
import { ALERT_KINDS, ALERT_LEVELS, emptyAlertState, hasFired } from "../src/budget/alerts.ts";
import { SPEND_CANNOT_BE_MEASURED, announce } from "../src/budget/announce.ts";
import { SOFT_DIMENSION, evaluateCeilings, type Ceiling } from "../src/budget/ceilings.ts";
import { applyUsageRecord, emptyLedger } from "../src/budget/ledger.ts";
import { entryOf, type RolePlan } from "../src/budget/fallback.ts";
import { testPorts } from "./support/index.ts";

const RUN = "run-ct-127-33";

/** A harness that reports no cost at all: the case of F127-FR-035. */
const NO_COST: HarnessCostReport = Object.freeze({
  harness: "stub-no-cost",
  reportsCost: false,
  reportsTokens: true,
  usageSource: null,
});

/** A harness that does report its cost. */
const REPORTS_COST: HarnessCostReport = Object.freeze({
  harness: "stub-api",
  reportsCost: true,
  reportsTokens: true,
  usageSource: "stream",
});

/** The ceilings a consumer set on the role: two that apply, three that cannot. */
const CEILINGS: readonly Ceiling[] = Object.freeze([
  { scope: "run", dimension: "wallClock", limit: 30 },
  { scope: "run", dimension: "phaseAttempts", limit: 5 },
  { scope: "role", role: "proposer", dimension: "calls", limit: 20 },
  { scope: "role", role: "proposer", dimension: "costUsd", limit: 10 },
  { scope: "role", role: "proposer", dimension: "tokens", limit: 1_000 },
]);

function planOf(harness: string, billingMode: string): RolePlan {
  return {
    role: "proposer",
    primary: entryOf(0, { harness, billingMode }),
    entries: [],
    resolvedHarnesses: [harness],
  };
}

/* ------------------------------------------------------------------ *
 * When spend cannot be measured.
 * ------------------------------------------------------------------ */

test("CT-127-33: a harness that reports no cost is the case; one that does is not", () => {
  assert.equal(reportsNoCost(NO_COST), true);
  assert.equal(reportsNoCost(REPORTS_COST), false);
});

/* ------------------------------------------------------------------ *
 * 1. The announcement says so for THAT ROLE.
 * ------------------------------------------------------------------ */

test("CT-127-33: the announcement at launch says so for the role", () => {
  const announcement = announceUnmeasurable(
    {
      at: "launch",
      roles: [
        { role: "proposer", plan: planOf("stub-no-cost", "subscription"), ceilings: [...CEILINGS] },
        { role: "critic", plan: planOf("stub-api", "api"), ceilings: [], configuredCapUsd: 5 },
      ],
    },
    ["proposer"],
  );
  assert.deepEqual([...announcement.unmeasurable], ["proposer"]);
  const text = announcement.lines.join("\n");
  assert.match(text, /spend cannot be measured/);
  assert.match(text, /the wallClock, phaseAttempts and calls ceilings still apply/);
  // The critic's lines carry no such claim: it is per role.
  const criticBlock = announcement.lines.slice(
    announcement.lines.findIndex((line) => line.startsWith("critic:")),
  );
  assert.equal(
    criticBlock.some((line) => line.includes("spend cannot be measured")),
    false,
  );
});

test("CT-127-33: `markUnmeasurable` sets the flag the announcement reads", () => {
  const roles = [
    { role: "proposer", plan: planOf("stub-no-cost", "subscription"), ceilings: [] },
    { role: "critic", plan: planOf("stub-api", "api"), ceilings: [] },
  ];
  const marked = markUnmeasurable(roles, ["proposer"]);
  assert.equal(marked[0].spendUnmeasurable, true);
  assert.equal(marked[1].spendUnmeasurable, undefined);
  // The announcement without the mark says nothing of the kind.
  const plain = announce({ at: "launch", roles });
  assert.equal(plain.unmeasurable.length, 0);
  assert.doesNotMatch(plain.lines.join("\n"), /spend cannot be measured/);
});

test("CT-127-33: the line is the one `./announce.ts` owns, with the role before it", () => {
  assert.equal(announcementLine("proposer"), `proposer: ${SPEND_CANNOT_BE_MEASURED}`);
  assert.match(SPEND_CANNOT_BE_MEASURED, /reports no cost/);
});

test("CT-127-33: the announcement says so again at `resume`", () => {
  const announcement = announceUnmeasurable(
    {
      at: "resume",
      roles: [{ role: "proposer", plan: planOf("stub-no-cost", "subscription"), ceilings: [] }],
    },
    ["proposer"],
  );
  assert.equal(announcement.at, "resume");
  assert.match(announcement.lines[0], /resume/);
  assert.match(announcement.lines.join("\n"), /spend cannot be measured/);
});

/* ------------------------------------------------------------------ *
 * 2. The doctor says so.
 * ------------------------------------------------------------------ */

test("CT-127-33: the doctor finding names the harness, the role and the remaining ceilings", () => {
  const finding = doctorFinding({
    role: "proposer",
    harness: "stub-no-cost",
    ceilings: [...CEILINGS],
  });
  assert.equal(finding.id, DOCTOR_CHECK_ID);
  assert.equal(finding.severity, DOCTOR_SEVERITY);
  assert.equal(finding.severity, "warn");
  assert.equal(finding.lb, DOCTOR_IS_LAUNCH_BLOCKING);
  assert.equal(finding.lb, false);
  assert.match(finding.message, /stub-no-cost/);
  assert.match(finding.message, /proposer/);
  assert.match(finding.message, /reports no cost/);
  assert.match(finding.message, /wallClock, phaseAttempts and calls ceilings still apply/);
  assert.match(finding.fix, /loop\.maxWallMin/);
  // The evidence names the ceilings that cannot be enforced.
  assert.match(finding.evidence, /budget\.role\.proposer\.costUsd/);
  assert.match(finding.evidence, /budget\.role\.proposer\.tokens/);
});

test("CT-127-33: the finding is not launch-blocking: an unmeasured run is allowed", () => {
  assert.equal(doctorFinding({ role: "proposer", harness: "stub-no-cost" }).lb, false);
});

/* ------------------------------------------------------------------ *
 * 3. The alert, once, at level `warn`.
 * ------------------------------------------------------------------ */

test("CT-127-33: the alert is of kind `spend-unmeasurable` and level `warn`", () => {
  const ports = testPorts();
  const outcome = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: NO_COST,
    state: emptyAlertState(),
    ceilings: [...CEILINGS],
  });
  assert.equal(outcome.unmeasurable, true);
  assert.equal(outcome.level, SPEND_UNMEASURABLE_LEVEL);
  assert.equal(outcome.level, "warn");
  assert.deepEqual(ports.eventWriter.types(), ["alert"]);
  const payload = ports.eventWriter.of("alert")[0].payload;
  assert.equal(payload.kind, ALERT_KIND_SPEND_UNMEASURABLE);
  assert.equal(payload.kind, "spend-unmeasurable");
  assert.equal(payload.level, "warn");
  assert.equal(payload.role, "proposer");
  assert.ok((ALERT_KINDS as readonly string[]).includes("spend-unmeasurable"));
  assert.ok((ALERT_LEVELS as readonly string[]).includes("warn"));
});

test("CT-127-33: the alert is written ONCE per role", () => {
  const ports = testPorts();
  let state = emptyAlertState();
  const first = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: NO_COST,
    state,
  });
  state = first.state;
  assert.notEqual(first.alert, null);
  assert.equal(hasFired(state, unmeasurableDedupeKey("proposer")), true);

  const second = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: NO_COST,
    state,
  });
  assert.equal(second.alert, null);
  assert.equal(ports.eventWriter.countOf("alert"), 1);
  assert.equal(WRITTEN_ONCE, true);
});

test("CT-127-33: another role's alert is its own", () => {
  const ports = testPorts();
  let state = emptyAlertState();
  state = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: NO_COST,
    state,
  }).state;
  const second = handleUnmeasurableSpend(ports.eventWriter, {
    role: "critic",
    report: NO_COST,
    state,
  });
  assert.notEqual(second.alert, null);
  assert.equal(ports.eventWriter.countOf("alert"), 2);
  assert.notEqual(unmeasurableDedupeKey("proposer"), unmeasurableDedupeKey("critic"));
});

test("CT-127-33: a harness that reports a cost raises no alert and no finding", () => {
  const ports = testPorts();
  const outcome = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: REPORTS_COST,
    state: emptyAlertState(),
    ceilings: [...CEILINGS],
  });
  assert.equal(outcome.unmeasurable, false);
  assert.equal(outcome.alert, null);
  assert.equal(outcome.finding, null);
  assert.equal(outcome.announcementLine, null);
  assert.deepEqual(ports.eventWriter.types(), []);
});

/* ------------------------------------------------------------------ *
 * 4. The remaining ceilings.
 * ------------------------------------------------------------------ */

test("CT-127-33: `wallClock`, `phaseAttempts` and `calls` still apply", () => {
  assert.deepEqual([...CEILINGS_THAT_STILL_APPLY], ["wallClock", "phaseAttempts", "calls"]);
  for (const dimension of CEILINGS_THAT_STILL_APPLY) assert.equal(stillApplies(dimension), true);
  assert.deepEqual([...CEILINGS_NOT_ENFORCED], ["tokens", "costUsd"]);
  for (const dimension of CEILINGS_NOT_ENFORCED) assert.equal(stillApplies(dimension), false);
  assert.equal(stillApplies(SOFT_DIMENSION), false);
});

test("CT-127-33: a cost or token ceiling on such a role is NOT reported as enforced", () => {
  const report = ceilingReport([...CEILINGS], { harness: "stub-no-cost" });
  const byKey = new Map(report.map((line) => [line.key, line]));
  assert.equal(byKey.get("loop.maxWallMin")?.reportedAsEnforced, true);
  assert.equal(byKey.get("budget.run.phaseAttempts")?.reportedAsEnforced, true);
  assert.equal(byKey.get("budget.role.proposer.calls")?.reportedAsEnforced, true);
  assert.equal(byKey.get("budget.role.proposer.costUsd")?.reportedAsEnforced, false);
  assert.equal(byKey.get("budget.role.proposer.tokens")?.reportedAsEnforced, false);
  // The ceiling IS set: the report says set and not enforced, which is honest.
  assert.equal(byKey.get("budget.role.proposer.costUsd")?.set, true);
  assert.match(byKey.get("budget.role.proposer.costUsd")?.note ?? "", /reports no cost/);
  assert.equal(byKey.get("loop.maxWallMin")?.note, null);
});

test("CT-127-33: `enforcedAndNot` names the two lists", () => {
  const lists = enforcedAndNot([...CEILINGS]);
  assert.deepEqual(
    [...lists.enforced],
    ["loop.maxWallMin", "budget.run.phaseAttempts", "budget.role.proposer.calls"],
  );
  assert.deepEqual(
    [...lists.notEnforced],
    ["budget.role.proposer.costUsd", "budget.role.proposer.tokens"],
  );
});

test("CT-127-33: the three that apply really do trip on an unmeasurable harness", () => {
  // The harness reports tokens but no cost; the engine counts calls, attempts
  // and wall clock itself, so those three hold.
  let ledger = emptyLedger(RUN);
  for (let index = 1; index <= 20; index += 1) {
    ledger = applyUsageRecord(ledger, {
      usageId: `u-${index}`,
      role: "proposer",
      billingMode: "unknown",
      inputTokens: 100,
      costUsd: null,
      isCall: true,
      closesAPass: true,
    }).ledger;
  }
  ledger.run.phaseAttempts = 5;
  const evaluation = evaluateCeilings([...CEILINGS], { ledger, wallClockMinutes: 31 });
  assert.deepEqual(evaluation.exhausted.map((reading) => reading.dimension).sort(), [
    "calls",
    "phaseAttempts",
    "wallClock",
  ]);
  // And the two that cannot be measured read as unknown, not as reached.
  const cost = evaluation.readings.find((reading) => reading.dimension === "costUsd");
  const tokens = evaluation.readings.find((reading) => reading.dimension === "tokens");
  assert.equal(cost?.used, null);
  assert.equal(cost?.exhausted, false);
  assert.equal(tokens?.used, null);
  assert.equal(tokens?.exhausted, false);
});

test("CT-127-33: the whole handling answers every part of F127-FR-035 at once", () => {
  const ports = testPorts();
  const outcome = handleUnmeasurableSpend(ports.eventWriter, {
    role: "proposer",
    report: NO_COST,
    state: emptyAlertState(),
    ceilings: [...CEILINGS],
  });
  assert.equal(outcome.unmeasurable, true);
  assert.notEqual(outcome.alert, null);
  assert.equal(outcome.announcementLine, `proposer: ${SPEND_CANNOT_BE_MEASURED}`);
  assert.equal(outcome.finding?.id, DOCTOR_CHECK_ID);
  assert.equal(outcome.ceilings.length, CEILINGS.length);
  assert.deepEqual([...outcome.stillApply], ["wallClock", "phaseAttempts", "calls"]);
});
