/**
 * T064 — own test CT-101-18: the paths of the phase gate that rest BLOCKED ON
 * A HUMAN emit `blocked` with a reason of the closed set and end with the stop
 * reason of the table of blocked reasons; and a halt by a LIMIT is not
 * relaunched.
 *
 * proves: F101-FR-041.
 * fixtures: FX-06 and FX-07, port side only. The third blocked reason the
 * requirement names — a source that changed, found when the critic STARTS
 * under the `parity` profile — belongs to no scenario of those two families,
 * so it is exercised on FX-01 with that one fact added, and at the unit level
 * besides.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  A_QUOTA_CLASS_IS_SCORED,
  BLOCKED_REASONS_OF_THE_PHASE_GATE,
  DETAIL_OF_A_FAILED_CALL,
  QUOTA_CLASSES_THAT_ARE_SCORED,
  QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE,
  QUOTA_CLASSES_THAT_PAUSE,
  QUOTA_CLASSIFIER_POINT_ID,
  SOURCE_CHANGED_IS_FOUND,
  THE_EVENT_BLOCKED_PROJECTS_TO_AN_AS_IS_EVENT,
  blockedPath,
  blockedReasonOfAQuotaClass,
  classifyAFailedCriticCall,
  criticCallBlockedBy,
} from "../../src/gate/critic-call.ts";
import {
  A_HALT_BY_A_LIMIT_IS_RELAUNCHED,
  HALTS_BY_A_LIMIT,
  haltOf,
  isAHaltByALimit,
  mayBeRelaunched,
} from "../../src/gate/halts.ts";
import { EVENTS_THAT_PROJECT_TO_NOTHING, projectsToAnAsIsEvent } from "../../src/gate/events.ts";
import { retryableFor } from "../../src/engine/terminal.ts";
import {
  BLOCKED_REASONS,
  WHAT_A_BLOCKED_RUN_DOES,
  blockedReasonRow,
  isBlockedReason,
  mayRelaunch,
  RELAUNCH_CLASSIFIER_TABLES,
} from "@specstride/contracts/state/blocked-reasons";
import { CLASSES as QUOTA_CLASSES } from "@specstride/contracts/ep/quota-classifier";
import {
  runFixture,
  FX_01_SOURCE_CHANGED,
  FX_03_REJECT_LIMIT,
  FX_04_OSCILLATION_HALT,
  FX_05_MALFORMED_LIMIT,
  FX_06_AUTH,
  FX_06_HTTP_ERROR,
  FX_06_QUOTA_CREDIT,
  FX_07_PHASE_NOT_FOUND,
} from "./run-harness.ts";

const CLASSIFIER = (quotaClass: (typeof QUOTA_CLASSES)[number]) => ({
  classify: () => ({ quotaClass, confidence: "status" as const, resetsAt: null, retryable: true }),
});

test("CT-101-18: the phase gate has three blocked reasons, all of the closed set of §E.2", () => {
  assert.deepEqual(
    [...BLOCKED_REASONS_OF_THE_PHASE_GATE],
    ["source-changed", "quota-credit", "auth"],
  );
  for (const reason of BLOCKED_REASONS_OF_THE_PHASE_GATE) {
    assert.equal(isBlockedReason(reason), true, `${reason} is a member of §E.2`);
    assert.equal((BLOCKED_REASONS as readonly string[]).includes(reason), true, reason);
  }
  assert.equal(SOURCE_CHANGED_IS_FOUND, "when the critic starts under the `parity` profile");
  // The event `blocked` projects to NOTHING.
  assert.equal(THE_EVENT_BLOCKED_PROJECTS_TO_AN_AS_IS_EVENT, false);
  assert.equal(EVENTS_THAT_PROJECT_TO_NOTHING.includes("blocked"), true);
  assert.equal(projectsToAnAsIsEvent("blocked"), false);
  // A blocked run writes its terminal record, releases the lock, ends and is
  // relaunched by NEITHER classifier table (F100-FR-144).
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.writesTheTerminalRecord, true);
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.releasesTheLock, true);
  assert.equal(WHAT_A_BLOCKED_RUN_DOES.relaunchedByEitherClassifierTable, false);
  for (const table of RELAUNCH_CLASSIFIER_TABLES) {
    for (const reason of BLOCKED_REASONS_OF_THE_PHASE_GATE) {
      assert.equal(mayRelaunch(reason, table), false, `${reason} in ${table}`);
    }
  }
});

test("CT-101-18: the end of each blocked path comes from the table of feature 100", () => {
  for (const reason of BLOCKED_REASONS_OF_THE_PHASE_GATE) {
    const row = blockedReasonRow(reason);
    assert.notEqual(row, undefined, reason);
    const path = blockedPath(reason, "a person is needed");
    assert.equal(path.stopReason, row?.stopReason, reason);
    assert.equal(path.exitCode, row?.engineExit, reason);
    assert.equal(path.retryable, false, reason);
    assert.equal(path.event.reason, reason);
    assert.equal(path.event.needs, "a person is needed");
    assert.equal(path.event.event, "blocked");
  }
  // The two of a failed critic-class call end with exit 4, the changed source
  // with exit 3, exactly as §E.2 states.
  assert.equal(blockedPath("quota-credit", "x").exitCode, 4);
  assert.equal(blockedPath("quota-credit", "x").stopReason, "proposer_consecutive_errors");
  assert.equal(blockedPath("auth", "x").exitCode, 4);
  assert.equal(blockedPath("source-changed", "x").exitCode, 3);
  assert.equal(blockedPath("source-changed", "x").stopReason, "critic_config");
  // A reason outside the closed set is refused and never guessed.
  assert.throws(() => blockedPath("no-such-reason" as never, "x"));
});

test("CT-101-18: the quota classifier decides, and this feature classifies nothing itself", () => {
  assert.equal(QUOTA_CLASSIFIER_POINT_ID, "specstride.quota-classifier/1");
  assert.deepEqual([...QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE], ["quota_credit", "auth"]);
  assert.equal(blockedReasonOfAQuotaClass("quota_credit"), "quota-credit");
  assert.equal(blockedReasonOfAQuotaClass("auth"), "auth");
  assert.equal(blockedReasonOfAQuotaClass("agent_failure"), undefined);
  // Every class of the closed set falls in exactly one of the three groups.
  for (const quotaClass of QUOTA_CLASSES) {
    const groups = [
      QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE.includes(quotaClass),
      QUOTA_CLASSES_THAT_PAUSE.includes(quotaClass),
      QUOTA_CLASSES_THAT_ARE_SCORED.includes(quotaClass),
    ].filter(Boolean);
    assert.equal(groups.length, 1, `${quotaClass} falls in exactly one group`);
  }
  // Where the classifier gives a quota class, NOTHING is scored.
  assert.equal(A_QUOTA_CLASS_IS_SCORED, false);
  for (const quotaClass of [
    ...QUOTA_CLASSES_THAT_BLOCK_THE_PHASE_GATE,
    ...QUOTA_CLASSES_THAT_PAUSE,
  ]) {
    const outcome = classifyAFailedCriticCall({ errorText: "x" }, CLASSIFIER(quotaClass));
    assert.equal(outcome.scored, false, quotaClass);
  }
  // And every other failure IS scored MALFORMED with the detail `call-failed`.
  for (const quotaClass of QUOTA_CLASSES_THAT_ARE_SCORED) {
    const outcome = classifyAFailedCriticCall({ errorText: "x" }, CLASSIFIER(quotaClass));
    assert.equal(outcome.scored, true, quotaClass);
    assert.equal(outcome.outcome === "scored" ? outcome.detail : "", DETAIL_OF_A_FAILED_CALL);
  }
  // A classifier that THROWS takes the scored path: a broken classifier may
  // never turn a rejection into a wait.
  const threw = classifyAFailedCriticCall(
    { errorText: "x" },
    {
      classify: () => {
        throw new Error("the table is gone");
      },
    },
  );
  assert.equal(threw.outcome, "scored");
  assert.equal(threw.classification.quotaClass, "provider_other");
});

test("CT-101-18 (FX-06): a failed call classed `quota_credit` or `auth` leaves the run blocked", async () => {
  for (const [set, reason] of [
    [FX_06_QUOTA_CREDIT, "quota-credit"],
    [FX_06_AUTH, "auth"],
  ] as const) {
    const run = await runFixture(set);
    // The classifier was asked, and the run rests blocked.
    assert.equal(run.classifyCalls.length, 1, reason);
    assert.notEqual(run.blocked, undefined, reason);
    assert.equal(run.blocked?.reason, reason);
    assert.equal(isBlockedReason(run.blocked?.reason ?? ""), true, reason);
    // The event `blocked` was emitted, with the reason and what is needed.
    const events = run.events.filter((event) => event.type === "blocked");
    assert.equal(events.length, 1, reason);
    assert.equal(events[0]?.data["reason"], reason);
    assert.equal(typeof events[0]?.data["needs"], "string");
    // The end is the table's: exit 4 and `proposer_consecutive_errors`.
    assert.equal(run.exitCode, 4, reason);
    assert.equal(run.stopReason, "proposer_consecutive_errors", reason);
    assert.equal(run.exitCode, blockedReasonRow(reason)?.engineExit);
    assert.equal(run.stopReason, blockedReasonRow(reason)?.stopReason);
    // NOTHING was scored: no count changed, no verdict record, no archive.
    assert.deepEqual([...run.ledgerWrites], [], reason);
    assert.deepEqual([...run.decisions], [], reason);
    assert.deepEqual([...run.archived], [], reason);
    assert.deepEqual(
      [...run.files.keys()].filter((k) => k.endsWith("/critic/verdict.json")),
      [],
      reason,
    );
    // And the same failure, classed otherwise, IS scored: the classifier is
    // what decides, and this is the control of the case.
    const scored = await runFixture(FX_06_HTTP_ERROR);
    assert.equal(scored.blocked, undefined);
    assert.equal(scored.exitCode, 1);
  }
});

test("CT-101-18 (FX-01 under `parity`): a source that changed blocks when the critic starts", async () => {
  const run = await runFixture(FX_01_SOURCE_CHANGED);
  assert.equal(run.blocked?.reason, "source-changed");
  assert.equal(run.exitCode, 3);
  assert.equal(run.stopReason, "critic_config");
  // The critic was never called: the hash is compared as it STARTS.
  assert.deepEqual([...run.calls], []);
  const events = run.events.filter((event) => event.type === "blocked");
  assert.equal(events.length, 1);
  assert.match(String(events[0]?.data["needs"]), /changed since launch/);
  // Nothing was scored.
  assert.deepEqual([...run.ledgerWrites], []);
  // The same path, at the unit level.
  const outcome = criticCallBlockedBy("source-changed", "the file `tasks.md` changed since launch");
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.verdict, undefined);
  assert.equal(outcome.path.exitCode, 3);
  assert.equal(outcome.failed, undefined, "no call was made, so nothing was classified");
});

test("CT-101-18 (FX-03, FX-04, FX-05): a halt by a LIMIT is not blocked and is not relaunched", async () => {
  // DV-067 — a halt by the reject limit, the MALFORMED limit or oscillation is
  // NOT the state `blocked-on-human`: the closed set of §E.2 holds none of
  // them. It is a stop that is not retryable, and it is never relaunched.
  assert.deepEqual([...HALTS_BY_A_LIMIT], ["reject-limit", "malformed-limit", "oscillation"]);
  assert.equal(A_HALT_BY_A_LIMIT_IS_RELAUNCHED, false);
  for (const cause of HALTS_BY_A_LIMIT) {
    assert.equal(isAHaltByALimit(cause), true, cause);
    assert.equal(mayBeRelaunched(cause), false, cause);
    const halt = haltOf(cause);
    assert.equal(halt.retryable, false, cause);
    assert.equal(retryableFor(halt.stopReason, true), false, cause);
    // And the stop reason of the halt is NO stop reason of a blocked reason.
    for (const reason of BLOCKED_REASONS) {
      if (blockedReasonRow(reason)?.stopReason !== halt.stopReason) continue;
      assert.fail(`the halt \`${cause}\` shares its stop reason with the blocked reason ${reason}`);
    }
  }
  for (const set of [FX_03_REJECT_LIMIT, FX_04_OSCILLATION_HALT, FX_05_MALFORMED_LIMIT]) {
    const run = await runFixture(set);
    assert.equal(run.blocked, undefined, `${set.scenario}: not blocked`);
    assert.equal(
      run.events.some((event) => event.type === "blocked"),
      false,
      `${set.scenario}: no event \`blocked\``,
    );
    assert.equal(mayBeRelaunched(run.haltCause ?? ""), false, `${set.scenario}: not relaunched`);
  }
  // A configuration error of the critic is no blocked path either: it is a
  // halt of the engine, with the row `critic-config` of the table of halts.
  const configError = await runFixture(FX_07_PHASE_NOT_FOUND);
  assert.equal(configError.blocked, undefined);
  assert.equal(
    configError.events.some((event) => event.type === "blocked"),
    false,
  );
});
