/**
 * T008 — the closed sets of rows 53, 54, 233, 235 and 236 of annex X §X.6 are
 * registered with their unknown-value branches
 * (`packages/check-runner/src/result/closed-sets.ts`).
 *
 * Every assertion reads the row of the annex through `@specstride/contracts`
 * and compares it with the registration, so the test fails when either side
 * moves: it does not restate the table.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowOf } from "@specstride/contracts/enums";
import {
  ADMISSION_REASONS,
  OPEN_SETS,
  REGISTERED_ROWS,
  RESULT_CONDITIONS,
  RESULT_SIGNALS,
  RUNNER_ERRORS,
  RunnerClosedSetError,
  SIGNAL_OF_ANOTHER_FEATURE,
  STEP_RUN_STATES,
  TAINTED_REASONS,
  UNCHECKED_REASONS,
  admissionReasons,
  registeredRunnerSets,
  resultConditions,
  resultSignals,
  runnerErrors,
  runnerSet,
  runnerSetsOfRow,
  stepRunStates,
  taintedReasons,
  uncheckedReasons,
} from "../src/result/closed-sets.ts";
import * as resultIndex from "../src/result/index.ts";

/** The five rows T008 names, in the order of the task. */
const ROWS = [53, 54, 233, 235, 236] as const;

describe("T008 the five rows of annex X §X.6 are registered", () => {
  it("registers exactly rows 53, 54, 233, 235 and 236", () => {
    assert.deepEqual([...REGISTERED_ROWS], [...ROWS]);
    const numbers = [...new Set([...registeredRunnerSets().values()].map((s) => s.number))].sort(
      (a, b) => a - b,
    );
    assert.deepEqual(numbers, [53, 54, 233, 235, 236]);
  });

  it("every registered row exists in annex X §X.6 and names feature 148 as its owner", () => {
    for (const number of ROWS) {
      const row = rowOf(number);
      assert.ok(row !== undefined, `annex X §X.6 holds row ${number}`);
      assert.match(row.owner, /\b148\b/, `row ${number} is owned by feature 148`);
      const sets = runnerSetsOfRow(number);
      assert.ok(sets.length >= 1, `row ${number} has at least one registered set`);
      for (const set of sets) {
        assert.equal(set.row.number, number);
        assert.equal(set.owner, row.owner);
        assert.equal(set.unknownValue, row.unknownValue);
      }
    }
  });

  it("row 53 is three sets: the conditions, the reasons of `tainted`, the reasons of `unchecked`", () => {
    assert.deepEqual(
      runnerSetsOfRow(53).map((s) => s.name),
      ["result-conditions", "tainted-reasons", "unchecked-reasons"],
    );
    assert.deepEqual(
      [...RESULT_CONDITIONS],
      ["tainted", "cached", "flaky", "interrupted", "unchecked"],
    );
    assert.deepEqual(
      [...TAINTED_REASONS],
      ["changed-during-check", "protected-set-changed", "pin-mismatch"],
    );
    assert.deepEqual(
      [...UNCHECKED_REASONS],
      [
        "no-command",
        "slow",
        "budget",
        "flaky-excluded",
        "gate-not-executing",
        "partial",
        "unknown-condition",
      ],
    );
    // The three together are exactly the literals of row 53.
    const row = rowOf(53);
    assert.ok(row !== undefined);
    assert.deepEqual(
      [...RESULT_CONDITIONS, ...TAINTED_REASONS, ...UNCHECKED_REASONS],
      [...row.literals],
    );
  });

  it("row 54 is the errors of the runner", () => {
    assert.equal(runnerErrors.number, 54);
    assert.deepEqual([...RUNNER_ERRORS], ["cannot-start", "timeout", "interrupted"]);
    assert.deepEqual([...runnerErrors.members], [...rowOf(54)!.literals]);
  });

  it("row 233 holds the two members the check runner may set, `TIMEOUT` and `EXEC_ERROR`", () => {
    assert.equal(resultSignals.number, 233);
    assert.deepEqual([...RESULT_SIGNALS], ["TIMEOUT", "EXEC_ERROR"]);
    assert.deepEqual([...resultSignals.members], ["TIMEOUT", "EXEC_ERROR"]);
    assert.ok(resultSignals.has("TIMEOUT"));
    assert.ok(resultSignals.has("EXEC_ERROR"));
    // `DEADLINE` is a member of the row, and of feature 105, not of this set.
    const row = rowOf(233);
    assert.ok(row !== undefined);
    assert.deepEqual([...row.literals], ["TIMEOUT", "EXEC_ERROR", "DEADLINE"]);
    assert.equal(SIGNAL_OF_ANOTHER_FEATURE.member, "DEADLINE");
    assert.equal(SIGNAL_OF_ANOTHER_FEATURE.owner, "105");
    assert.equal(resultSignals.has("DEADLINE"), false);
    assert.equal(resultSignals.branch("DEADLINE").ownedByAnotherFeature, "105");
  });

  it("row 235 is the state of a run of steps", () => {
    assert.equal(stepRunStates.number, 235);
    assert.deepEqual([...STEP_RUN_STATES], ["full", "partial"]);
    assert.deepEqual([...stepRunStates.members], [...rowOf(235)!.literals]);
  });

  it("row 236 is the reasons of an admission to a batch", () => {
    assert.equal(admissionReasons.number, 236);
    assert.deepEqual(
      [...ADMISSION_REASONS],
      [
        "disjoint",
        "undeclared",
        "reads-written",
        "writes-overlap",
        "follows-writer",
        "exclusive",
        "steps",
        "demoted",
      ],
    );
    assert.deepEqual([...admissionReasons.members], [...rowOf(236)!.literals]);
  });

  it("the sets are reachable through src/result/index.ts", () => {
    assert.equal(resultIndex.resultConditions, resultConditions);
    assert.equal(resultIndex.resultSignals, resultSignals);
    assert.equal(resultIndex.admissionReasons, admissionReasons);
    assert.deepEqual([...resultIndex.REGISTERED_ROWS], [...ROWS]);
  });
});

describe("T008 each set has a branch for the unknown value", () => {
  const sets = [
    resultConditions,
    taintedReasons,
    uncheckedReasons,
    runnerErrors,
    resultSignals,
    stepRunStates,
    admissionReasons,
  ];

  it("every set answers an unknown value without throwing (F100-FR-209)", () => {
    for (const set of sets) {
      const branch = set.branch("a-value-no-row-holds");
      assert.ok(branch.outcome.kind.length > 0, `${set.name} returns an outcome`);
      assert.equal(branch.outcome.value, "a-value-no-row-holds");
      assert.equal(branch.outcome.set, set.row.name);
      assert.equal(branch.outcome.cell, set.unknownValue);
      assert.doesNotThrow(() => set.read("a-value-no-row-holds"));
    }
  });

  it("row 53: an unknown condition makes the result `unchecked`, reason `unknown-condition`", () => {
    const branch = resultConditions.branch("sideways");
    assert.equal(branch.member, "unchecked");
    assert.equal(branch.condition, "unchecked");
    assert.equal(branch.reason, "unknown-condition");
    assert.equal(resultConditions.read("sideways"), "unchecked");
    // The cell of the annex says exactly this.
    assert.match(resultConditions.unknownValue, /unchecked.+unknown-condition/s);
  });

  it("row 53: an unknown reason is shown as text and keeps its condition", () => {
    const tainted = taintedReasons.branch("some-new-reason");
    assert.equal(tainted.member, undefined);
    assert.equal(tainted.condition, "tainted");
    assert.equal(tainted.reason, "some-new-reason");
    assert.equal(tainted.shownAsText, true);

    const unchecked = uncheckedReasons.branch("some-new-reason");
    assert.equal(unchecked.member, undefined);
    assert.equal(unchecked.condition, "unchecked");
    assert.equal(unchecked.reason, "some-new-reason");
    assert.equal(unchecked.shownAsText, true);
    assert.match(uncheckedReasons.unknownValue, /shown as text/);
  });

  it("row 54: an unknown error is read as `cannot-start`", () => {
    assert.equal(runnerErrors.branch("boom").member, "cannot-start");
    assert.equal(runnerErrors.read("boom"), "cannot-start");
    assert.equal(runnerErrors.unknownValue.includes("cannot-start"), true);
  });

  it("row 233: an unknown signal makes the command count as failed and names no member", () => {
    const branch = resultSignals.branch("SIGHUP");
    assert.equal(branch.member, undefined);
    assert.equal(branch.countsAsFailed, true);
    assert.equal(branch.ownedByAnotherFeature, undefined);
    assert.equal(resultSignals.read("SIGHUP"), undefined);
    assert.equal(resultSignals.unknownValue, "The command counts as failed");
  });

  it("row 235: an unknown state is read as `partial`", () => {
    assert.equal(stepRunStates.branch("half").member, "partial");
    assert.equal(stepRunStates.read("half"), "partial");
    assert.equal(stepRunStates.unknownValue, "`partial`");
  });

  it("row 236: an unknown reason makes the command run alone, which is `exclusive`", () => {
    const branch = admissionReasons.branch("maybe");
    assert.equal(branch.runsAlone, true);
    assert.equal(branch.member, "exclusive");
    assert.ok(admissionReasons.has("exclusive"));
    assert.equal(admissionReasons.unknownValue, "The command runs alone");
  });

  it("a member is returned unchanged, so the branch is only for the unknown value", () => {
    for (const set of sets) {
      for (const member of set.members) {
        assert.equal(set.read(member), member, `${set.name} reads its member ${member}`);
        assert.ok(set.has(member));
      }
    }
  });
});

describe("T008 the registration cannot drift from the annex", () => {
  it("names the set of this feature's data file and refuses an unknown name", () => {
    for (const set of registeredRunnerSets().values()) {
      assert.equal(runnerSet(set.name), set);
    }
    assert.equal(runnerSet("not-a-set"), undefined);
  });

  it("the open set of this feature is not registered as a closed set", () => {
    assert.deepEqual([...OPEN_SETS], ["kinds of identity of the check runner"]);
    for (const open of OPEN_SETS) assert.equal(runnerSet(open), undefined);
  });

  it("RunnerClosedSetError carries the name of the set it refused", () => {
    const error = new RunnerClosedSetError("a-set", "a message");
    assert.equal(error.name, "RunnerClosedSetError");
    assert.equal(error.setName, "a-set");
    assert.ok(error instanceof Error);
  });
});
