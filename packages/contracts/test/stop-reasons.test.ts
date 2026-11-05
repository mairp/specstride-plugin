/**
 * T079 — contract tests CT-100-248, CT-100-249 and CT-100-250 for the
 * stop-reason enumeration (annex E, §E.3; F100-FR-148, F100-FR-149,
 * F100-FR-150).
 *
 * The tests bind T080 and T270 to `data/stop-reasons.json` and to rows 3,
 * 10, 11, 12, 13 and 14 of `data/closed-sets.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import data from "../data/stop-reasons.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import { closedSetRows } from "../src/enums/index.ts";
import {
  ANNEX_SECTION,
  EXITS_WITHOUT_A_MEMBER,
  EXITS_WITH_A_MEMBER,
  NEVER_MEMBERS,
  RETRYABLE_FAILURE_CLASSES,
  SCHEMA_ID,
  STOP_REASONS,
  STOP_REASON_COUNT,
  engineExitOf,
  isStopReason,
  isTransient,
  onUnknownStopReason,
  retryableFor,
  stopReasonOfNumber,
  stopReasonRow,
  stopReasonRows,
  stopReasonSet,
  terminalStopFields,
} from "../src/codes/stop-reasons.ts";
import {
  ALL_APPROVED,
  APPROVAL_CLASSIFIED_TRANSIENT,
  ARBITRATION_LITERALS,
  AS_IS_END_LINE_OUTCOME_LITERALS,
  DELIBERATE_STAGE_REASONS,
  KILL_CLASSES,
  KILL_REASONS,
  KILL_REASON_CLASSES,
  LAUNCH_CHECK_REFUSALS,
  MEMBERS_WITH_AN_AS_IS_LITERAL,
  MEMBERS_WITH_TWO_LINES,
  MEMBER_WITHOUT_AN_AS_IS_LITERAL,
  OTHER_CLOSED_FAMILIES,
  PIPELINE_EXIT_REASONS,
  RELAUNCH_REFUSALS,
  STAGE_REASONS,
  TRANSIENT_STAGE_REASONS,
  TWO_LINE_RULE,
  asIsLiteralOf,
  asIsStopLines,
  closedSetOfFamily,
  execErrorDetail,
  isArbitrationLiteral,
  killClassOf,
  killReasonSet,
  pipelineExitReasonSet,
  stageReasonIsTransient,
  stageReasonSet,
} from "../src/codes/stop-reason-literals.ts";
import { engineExitRow, isEngineExitCode } from "../src/codes/engine.ts";

const RAW = (data as { schema: string; stopReasons: Record<string, unknown>[] }).stopReasons;

test("CT-100-248: the enumeration holds exactly the 15 members of §E.3", () => {
  assert.equal(SCHEMA_ID, "specstride.stop-reason/1");
  assert.equal((data as { schema: string }).schema, SCHEMA_ID);
  assert.equal(ANNEX_SECTION, "annex E, §E.3");
  assert.equal(RAW.length, 15);
  assert.equal(STOP_REASON_COUNT, 15);
  assert.equal(STOP_REASONS.length, 15);
  assert.deepEqual(
    [...STOP_REASONS],
    RAW.map((row) => String(row.literal)),
  );

  // The numbers are 1 to 15, each once.
  assert.deepEqual(
    stopReasonRows.map((r) => r.number),
    Array.from({ length: 15 }, (_unused, index) => index + 1),
  );

  // Row 3 of §X.6 holds the same 15, registered through T070.
  assert.equal(stopReasonSet.number, 3);
  assert.equal(stopReasonSet.byReference, true);
  assert.deepEqual([...stopReasonSet.members], [...STOP_REASONS]);
  assert.deepEqual([...(closedSets.get(3)?.members ?? [])], [...STOP_REASONS]);
  assert.equal(closedSetRows.find((r) => r.number === 3)?.closedBy, "Owner decision");

  for (const literal of STOP_REASONS) assert.ok(isStopReason(literal), literal);
  assert.equal(isStopReason("paused-quota"), false);
  assert.equal(stopReasonRow("invented"), undefined);
});

test("CT-100-248: every member carries its engine exit code and its `transient`", () => {
  for (const raw of RAW) {
    const row = stopReasonRow(String(raw.literal));
    assert.notEqual(row, undefined, String(raw.literal));
    if (row === undefined) continue;
    assert.equal(row.number, raw.number);
    assert.equal(row.engineExit, raw.engineExit);
    assert.equal(row.transient, raw.transient);
    assert.equal(row.transientNote, raw.transientNote);
    assert.equal(row.retryableRule, raw.retryable);
    assert.equal(row.writtenBy, raw.writtenBy);
    assert.equal(engineExitOf(row.literal), raw.engineExit);
    assert.equal(isTransient(row.literal), raw.transient);
    assert.equal(stopReasonOfNumber(row.number)?.literal, row.literal);

    // The code is a code of the engine table, and that code's column
    // "Stop reasons" names this member (§E.4).
    assert.ok(isEngineExitCode(row.engineExit), `${row.literal}: ${row.engineExit}`);
    const engine = engineExitRow(row.engineExit);
    assert.ok(
      (engine?.stopReasons ?? []).includes(row.literal),
      `the engine code ${row.engineExit} carries \`${row.literal}\``,
    );
  }
  // Only two members are transient: `wall_budget` and
  // `proposer_consecutive_errors` (§E.3).
  assert.deepEqual(
    stopReasonRows.filter((r) => r.transient).map((r) => r.literal),
    ["wall_budget", "proposer_consecutive_errors"],
  );
});

test("CT-100-248: `retryable` is never true for a member that is not transient", () => {
  for (const row of stopReasonRows) {
    if (row.transient) continue;
    assert.equal(retryableFor(row.literal), false, `${row.literal} is not transient`);
    assert.equal(
      retryableFor(row.literal, { failureClass: "agent_failure" }),
      false,
      `${row.literal} stays false whatever the class`,
    );
  }
  // `wall_budget`: true, except false when blocked on a human (`budget-cap`).
  assert.equal(retryableFor("wall_budget"), true);
  assert.equal(retryableFor("wall_budget", { blockedReason: "budget-cap" }), false);
  // `proposer_consecutive_errors`: true for the three classes, `overload`
  // only after its cap; false when blocked on a human.
  assert.deepEqual([...RETRYABLE_FAILURE_CLASSES], ["agent_failure", "provider_other", "overload"]);
  assert.equal(
    retryableFor("proposer_consecutive_errors", { failureClass: "agent_failure" }),
    true,
  );
  assert.equal(
    retryableFor("proposer_consecutive_errors", { failureClass: "provider_other" }),
    true,
  );
  assert.equal(retryableFor("proposer_consecutive_errors", { failureClass: "overload" }), false);
  assert.equal(
    retryableFor("proposer_consecutive_errors", {
      failureClass: "overload",
      overloadCapReached: true,
    }),
    true,
  );
  for (const blocked of ["quota-credit", "auth"] as const) {
    assert.equal(
      retryableFor("proposer_consecutive_errors", {
        failureClass: "agent_failure",
        blockedReason: blocked,
      }),
      false,
      `blocked on a human (${blocked})`,
    );
  }
  assert.equal(retryableFor("invented"), false);
});

test("CT-100-248: on an exit with no member the field is null and nothing is written", () => {
  assert.deepEqual([...EXITS_WITH_A_MEMBER], [1, 2, 3, 4, 6]);
  assert.deepEqual([...EXITS_WITHOUT_A_MEMBER], [0, 5, 70]);
  // The engine table of §E.4 marks exactly those three "—".
  for (const code of EXITS_WITHOUT_A_MEMBER) {
    assert.equal(engineExitRow(code)?.noMember, true, `the code ${code} has no member`);
  }
  for (const code of EXITS_WITH_A_MEMBER) {
    assert.equal(engineExitRow(code)?.noMember, false, `the code ${code} has a member`);
  }
  // An exit without a member: null, false, no as-is stop line.
  for (const code of EXITS_WITHOUT_A_MEMBER) {
    const fields = terminalStopFields(code, null);
    assert.equal(fields.stopReason, null);
    assert.equal(fields.retryable, false);
    assert.equal(fields.writeTheAsIsStopLine, false);
  }
  // A cause of 1 or 3 with no member reads the same way.
  assert.deepEqual(terminalStopFields(1, null), terminalStopFields(3, null));
  // An exit with a member carries it.
  const withMember = terminalStopFields(4, "wall_budget");
  assert.equal(withMember.stopReason, "wall_budget");
  assert.equal(withMember.retryable, true);
  assert.equal(withMember.writeTheAsIsStopLine, true);
  // A value outside the set reads as null, never as a member.
  assert.equal(terminalStopFields(4, "invented").stopReason, null);
});

test("CT-100-248: a reader that finds another value treats the stop as not retryable", () => {
  const outcome = onUnknownStopReason("something_else");
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.reported, true);
  assert.equal(outcome.outcome.value, "something_else");
  assert.equal(outcome.outcome.set, "Stop reasons");
  assert.match(outcome.outcome.cell, /not retryable/i);
  assert.match(outcome.outcome.cell, /reported/i);
  // The five things the annex says are never members.
  assert.equal(NEVER_MEMBERS.length, 5);
  for (const item of NEVER_MEMBERS) assert.notEqual(item.trim(), "");
});

test("CT-100-249: the as-is literal of every member 1 to 14, and the rule of two lines", () => {
  assert.equal(MEMBERS_WITH_AN_AS_IS_LITERAL.length, 14);
  assert.equal(MEMBER_WITHOUT_AN_AS_IS_LITERAL, "paused_quota_ceiling");
  for (const row of stopReasonRows) {
    const asIs = asIsLiteralOf(row.literal);
    if (row.number <= 14) {
      assert.equal(asIs, row.literal, `${row.literal} keeps its as-is literal`);
      assert.ok(MEMBERS_WITH_AN_AS_IS_LITERAL.includes(row.literal));
    } else {
      assert.equal(asIs, null, `${row.literal} is new and has no as-is literal`);
      assert.equal(row.matchedByStringAtBaseline, "— (new)");
    }
  }
  // The two members the baseline matched by string.
  assert.deepEqual(
    stopReasonRows.filter((r) => /^yes$/i.test(r.matchedByStringAtBaseline)).map((r) => r.literal),
    ["wall_budget", "proposer_consecutive_errors"],
  );

  // The rule of two lines, where the engine and the pass loop both write.
  assert.equal(TWO_LINE_RULE.lines, 2);
  assert.equal(TWO_LINE_RULE.newerLineWrittenBy, "engine");
  assert.equal(TWO_LINE_RULE.olderLineWrittenBy, "pass loop");
  assert.equal(TWO_LINE_RULE.theLineOfThePassLoopCarries, "the as-is iteration field");
  assert.equal(TWO_LINE_RULE.fieldsDiffer, true);
  assert.deepEqual(
    [...MEMBERS_WITH_TWO_LINES],
    stopReasonRows
      .filter((r) => r.writtenByTheEngine && r.writtenByThePassLoop)
      .map((r) => r.literal),
  );
  for (const literal of MEMBERS_WITH_TWO_LINES) {
    const lines = asIsStopLines(literal);
    assert.equal(lines.length, 2, `${literal} has two lines`);
    assert.equal(lines[0]?.writtenBy, "pass loop");
    assert.equal(lines[0]?.iterationField, true);
    assert.equal(lines[0]?.newer, false);
    assert.equal(lines[1]?.writtenBy, "engine");
    assert.equal(lines[1]?.newer, true);
    assert.equal(lines[1]?.iterationField, undefined);
  }
  // A member only the engine writes has one line.
  assert.equal(asIsStopLines("max_rejects").length, 1);
  // Member 7 is written by the pass loop only.
  const seven = asIsStopLines("proposer_yield_timeout");
  assert.equal(seven.length, 1);
  assert.equal(seven[0]?.writtenBy, "pass loop");
  assert.equal(seven[0]?.iterationField, true);
  // Member 15 has no as-is line at all.
  assert.deepEqual([...asIsStopLines("paused_quota_ceiling")], []);
});

test("CT-100-249: `all_approved` is the only outcome literal, and the four arbitration ones hold", () => {
  assert.equal(ALL_APPROVED, "all_approved");
  assert.deepEqual([...AS_IS_END_LINE_OUTCOME_LITERALS], ["all_approved"]);
  assert.equal(AS_IS_END_LINE_OUTCOME_LITERALS.length, 1);
  // T15 of the machine writes `run.ended` with that outcome (annex E §E.2).
  assert.deepEqual(
    [...ARBITRATION_LITERALS],
    ["max_rejects", "gate_oscillation", "critic_config", "proposer_no_progress"],
  );
  for (const literal of ARBITRATION_LITERALS) {
    assert.ok(isStopReason(literal), `${literal} is a member of §E.3`);
    assert.ok(isArbitrationLiteral(literal));
    // Unchanged in meaning: the row of §E.3 still carries its own code.
    assert.equal(engineExitOf(literal), stopReasonRow(literal)?.engineExit);
  }
  assert.equal(isArbitrationLiteral("stop_flag"), false);
});

test("CT-100-250: the closed families that are not stop reasons keep their as-is literals", () => {
  // The five families, each with the row of §X.6 that lists it.
  assert.deepEqual(
    OTHER_CLOSED_FAMILIES.map((f) => f.row),
    [10, 11, 12, 13, 14],
  );
  for (const family of OTHER_CLOSED_FAMILIES) {
    const row = closedSetRows.find((r) => r.number === family.row);
    assert.notEqual(row, undefined, `row ${family.row} exists`);
    assert.ok(family.members.length > 0, `row ${family.row} has members`);
    // The registered set of the row holds the same members.
    const registered = closedSetOfFamily(family.row);
    assert.notEqual(registered, undefined, `row ${family.row} is registered`);
    assert.deepEqual([...(registered?.members ?? [])], [...family.members]);
    assert.deepEqual([...(closedSets.get(family.row)?.members ?? [])], [...family.members]);
  }

  // The kill reasons of the watchdogs, with their class.
  assert.deepEqual(
    [...KILL_REASONS],
    ["idle_timeout", "repeat_stall", "progress_stall", "hard_cap"],
  );
  assert.deepEqual([...KILL_CLASSES], ["hang", "futility", "budget"]);
  assert.equal(KILL_REASON_CLASSES.idle_timeout, "hang");
  assert.equal(KILL_REASON_CLASSES.repeat_stall, "futility");
  assert.equal(KILL_REASON_CLASSES.progress_stall, "futility");
  assert.equal(KILL_REASON_CLASSES.hard_cap, "budget");
  assert.equal(killReasonSet.number, 10);
  // Row 10's unknown value is the class `futility`, as at the baseline.
  assert.equal(killClassOf("something_else"), "futility");
  assert.match(String(closedSetRows.find((r) => r.number === 10)?.unknownValue), /futility/);

  // The stage reasons, transient and deliberate.
  assert.deepEqual(
    [...TRANSIENT_STAGE_REASONS],
    ["exit", "timeout", "recovery-deadline", "recovery-exhausted"],
  );
  assert.deepEqual(
    [...DELIBERATE_STAGE_REASONS],
    [
      "postcondition",
      "stage-precondition",
      "setup-required",
      "interrupted",
      "existing-prerequisite",
      "completed",
      "exec-error:",
    ],
  );
  assert.equal(STAGE_REASONS.length, 11);
  assert.equal(stageReasonSet.number, 11);
  for (const reason of TRANSIENT_STAGE_REASONS) assert.ok(stageReasonIsTransient(reason), reason);
  for (const reason of DELIBERATE_STAGE_REASONS) {
    assert.equal(stageReasonIsTransient(reason), false, reason);
  }
  // Row 11's unknown value is "Not transient".
  assert.equal(stageReasonIsTransient("something_else"), false);
  assert.equal(execErrorDetail("exec-error:no such file"), "no such file");
  assert.equal(execErrorDetail("timeout"), undefined);

  // The pipeline exit reasons: `preflight`, `all-stages-complete`, or a
  // stage reason.
  assert.equal(PIPELINE_EXIT_REASONS[0], "preflight");
  assert.equal(PIPELINE_EXIT_REASONS[1], "all-stages-complete");
  assert.deepEqual([...PIPELINE_EXIT_REASONS].slice(2), [...STAGE_REASONS]);
  assert.equal(pipelineExitReasonSet.number, 12);

  // The launch-check refusals (row 13) and the relaunch refusals with the
  // approval `classified-transient` (row 14).
  assert.equal(LAUNCH_CHECK_REFUSALS.length, 11);
  assert.ok(LAUNCH_CHECK_REFUSALS.includes("stale-sources"));
  assert.ok(RELAUNCH_REFUSALS.includes(APPROVAL_CLASSIFIED_TRANSIENT));
  assert.equal(APPROVAL_CLASSIFIED_TRANSIENT, "classified-transient");
  assert.ok(RELAUNCH_REFUSALS.includes("relaunch-observe"));
  assert.ok(RELAUNCH_REFUSALS.includes("relaunch-root"));

  // None of these families is a stop reason (§E.3: never to be added).
  for (const family of OTHER_CLOSED_FAMILIES) {
    for (const member of family.members) {
      assert.equal(
        isStopReason(member),
        false,
        `\`${member}\` of row ${family.row} is not a stop reason`,
      );
    }
  }
});
