/**
 * T008 — the closed sets of rows 52 and 228 to 234 of annex X §X.6 are
 * registered with their unknown-value branches
 * (`packages/verification/src/mode/closed-sets.ts`).
 *
 * Every assertion reads the row through `@specstride/contracts` and compares
 * it with the registration, so the test fails when either side moves. Of row
 * 233 only the member `DEADLINE` is this feature's, and the test proves that
 * too: `TIMEOUT` and `EXEC_ERROR` take the branch, with feature 148 named.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowOf } from "@specstride/contracts/enums";
import {
  AUTOMATION_STATUS,
  COMMAND_STAGES,
  CONFIGURATION_ERROR_CODE,
  DISCOVERY_VALUES,
  OBLIGATION_KINDS,
  OBLIGATION_KIND_LEVELS,
  OBLIGATION_LEVELS,
  OPEN_SETS,
  REGISTERED_ROWS,
  REUSE_POLICIES,
  SIGNALS_OF_THE_CHECK_RUNNER,
  STAGED_COMMAND_SIGNALS,
  STORED_COMMAND_STAGES,
  VERIFICATION_MODES,
  VERIFY_SUB_COMMANDS,
  VerificationClosedSetError,
  automationStatus,
  commandStages,
  declaredSet,
  discoveryValues,
  levelOfKind,
  normalizeStage,
  obligationKinds,
  registeredVerificationSets,
  reusePolicies,
  stagedCommandSignals,
  verificationSet,
  verificationSetsOfRow,
  verificationModes,
  verifySubCommands,
} from "../src/mode/closed-sets.ts";
import * as modeIndex from "../src/mode/index.ts";

/** The eight rows of §X.6 T008 registers, with the set and its members. */
const REGISTERED = [
  { number: 52, name: "verification-modes", members: VERIFICATION_MODES },
  { number: 228, name: "command-stages", members: COMMAND_STAGES },
  { number: 229, name: "reuse-policies", members: REUSE_POLICIES },
  { number: 230, name: "discovery-values", members: DISCOVERY_VALUES },
  { number: 231, name: "obligation-kinds", members: OBLIGATION_KIND_LEVELS },
  { number: 232, name: "automation-status", members: AUTOMATION_STATUS },
  { number: 233, name: "staged-command-signals", members: STAGED_COMMAND_SIGNALS },
  { number: 234, name: "verify-sub-commands", members: VERIFY_SUB_COMMANDS },
] as const;

describe("T008 the eight rows are registered", () => {
  it("registers rows 52 and 228 to 234, in the order of the annex", () => {
    assert.deepEqual([...REGISTERED_ROWS], [52, 228, 229, 230, 231, 232, 233, 234]);
    assert.deepEqual(
      REGISTERED.map((r) => r.number),
      [...REGISTERED_ROWS],
    );
    assert.equal(registeredVerificationSets().size, REGISTERED.length);
  });

  for (const entry of REGISTERED) {
    it(`row ${String(entry.number)} ("${entry.name}") carries the members of the annex`, () => {
      const set = verificationSet(entry.name);
      assert.ok(set !== undefined, `the set "${entry.name}" is registered`);
      assert.equal(set.number, entry.number);
      assert.deepEqual([...set.members], [...entry.members]);
      // Every part of every member is a literal of the row of §X.6. Row 231
      // writes a pair with a slash, so the parts are compared, not the pair.
      const row = rowOf(entry.number);
      assert.ok(row !== undefined, `annex X §X.6 holds row ${String(entry.number)}`);
      for (const member of entry.members) {
        for (const part of member.split("/")) {
          assert.ok(
            row.literals.includes(part),
            `\`${part}\` is a literal of row ${String(entry.number)}`,
          );
        }
      }
      // The cell "unknown value" is carried verbatim from the annex.
      assert.equal(set.unknownValue, row.unknownValue);
      // The data of `specs/105-verification/contracts/` holds the same members.
      const declared = declaredSet(entry.number, entry.name);
      assert.ok(declared !== undefined, "data/closed-sets.json holds the set");
      assert.deepEqual([...declared.members].sort(), [...entry.members].sort());
    });
  }

  it("names feature 105 in the owner cell of every row it registers", () => {
    for (const entry of REGISTERED) {
      const row = rowOf(entry.number);
      assert.ok(row !== undefined);
      assert.match(row.owner, /\b105\b/, `row ${String(entry.number)} is feature 105's`);
    }
  });

  it("gives one set per row, and the set of an unregistered row is empty", () => {
    for (const entry of REGISTERED) {
      assert.equal(verificationSetsOfRow(entry.number).length, 1);
    }
    assert.deepEqual([...verificationSetsOfRow(53)], []);
    assert.equal(verificationSet("result-conditions"), undefined);
  });

  it("re-exports the sets from the index of `mode/`", () => {
    assert.equal(modeIndex.verificationModes, verificationModes);
    assert.equal(modeIndex.stagedCommandSignals, stagedCommandSignals);
  });

  it("names the two open sets of this feature and registers neither", () => {
    assert.deepEqual([...OPEN_SETS], ["plan sources", "toolchains of discovery"]);
    for (const name of OPEN_SETS) assert.equal(verificationSet(name), undefined);
  });
});

describe("T008 row 52, the verification modes", () => {
  it("has the three members and recognises each", () => {
    assert.deepEqual([...VERIFICATION_MODES], ["required", "plan", "off"]);
    for (const mode of VERIFICATION_MODES) assert.ok(verificationModes.has(mode));
  });

  it("reads an unknown mode as a configuration error with the exit code 3", () => {
    const branch = verificationModes.branch("sometimes");
    assert.equal(branch.member, undefined, "no mode is guessed");
    assert.equal(branch.configurationError, true);
    assert.equal(branch.exitCode, CONFIGURATION_ERROR_CODE);
    assert.equal(CONFIGURATION_ERROR_CODE, 3);
    assert.equal(branch.outcome.kind, "refuse");
    assert.match(branch.outcome.message, /sometimes/);
    assert.equal(verificationModes.read("sometimes"), undefined);
  });

  it("never throws for a value outside the set (F100-FR-209)", () => {
    for (const value of ["", "REQUIRED", "plan ", "0", "__proto__"]) {
      const branch = verificationModes.branch(value);
      assert.equal(branch.exitCode, CONFIGURATION_ERROR_CODE);
    }
  });
});

describe("T008 row 228, the stages of a declared command", () => {
  it("has the four members and stores `pre` as `prestage`", () => {
    assert.deepEqual([...COMMAND_STAGES], ["gate", "pre", "prestage", "both"]);
    assert.deepEqual([...STORED_COMMAND_STAGES], ["gate", "prestage", "both"]);
    assert.equal(normalizeStage("pre"), "prestage");
    assert.equal(normalizeStage("prestage"), "prestage");
    assert.equal(normalizeStage("gate"), "gate");
    assert.equal(normalizeStage("both"), "both");
  });

  it("refuses the declaration for a stage outside the set, and folds nothing", () => {
    assert.equal(normalizeStage("PRE"), undefined);
    assert.equal(normalizeStage("after"), undefined);
    const branch = commandStages.branch("after");
    assert.equal(branch.member, undefined);
    assert.equal(branch.declarationRefused, true);
    assert.equal(branch.outcome.kind, "refuse");
  });
});

describe("T008 row 229, the reuse policies", () => {
  it("has the three members", () => {
    assert.deepEqual([...REUSE_POLICIES], ["per-attempt", "per-phase", "per-run"]);
  });

  it("refuses the declaration for a policy outside the set", () => {
    const branch = reusePolicies.branch("per-week");
    assert.equal(branch.member, undefined);
    assert.equal(branch.declarationRefused, true);
  });
});

describe("T008 row 230, the values of `discovery`", () => {
  it("has the one member `none`", () => {
    assert.deepEqual([...DISCOVERY_VALUES], ["none"]);
  });

  it("refuses the document for a value outside the set", () => {
    const branch = discoveryValues.branch("auto");
    assert.equal(branch.member, undefined);
    assert.equal(branch.documentRefused, true);
    assert.equal(branch.declarationRefused, undefined, "the document, not the declaration");
  });
});

describe("T008 row 231, the kinds and levels of an obligation", () => {
  it("pairs each kind with its level, as the row does", () => {
    assert.deepEqual(
      [...OBLIGATION_KIND_LEVELS],
      ["effect-witness/integration", "positive/contract"],
    );
    assert.deepEqual([...OBLIGATION_KINDS], ["effect-witness", "positive"]);
    assert.deepEqual([...OBLIGATION_LEVELS], ["integration", "contract"]);
    assert.equal(levelOfKind("effect-witness"), "integration");
    assert.equal(levelOfKind("positive"), "contract");
    assert.equal(levelOfKind("negative"), undefined);
  });

  it("refuses the plan for a pair outside the set", () => {
    const branch = obligationKinds.branch("positive/integration");
    assert.equal(branch.member, undefined);
    assert.equal(branch.planRefused, true);
  });
});

describe("T008 row 232, `automationStatus`", () => {
  it("has the two members and refuses the plan for anything else", () => {
    assert.deepEqual([...AUTOMATION_STATUS], ["planned", "manual"]);
    const branch = automationStatus.branch("automated");
    assert.equal(branch.member, undefined);
    assert.equal(branch.planRefused, true);
  });
});

describe("T008 row 233, of which this feature owns `DEADLINE`", () => {
  it("registers the one member `DEADLINE` and no other", () => {
    assert.deepEqual([...STAGED_COMMAND_SIGNALS], ["DEADLINE"]);
    assert.ok(stagedCommandSignals.has("DEADLINE"));
    assert.ok(!stagedCommandSignals.has("TIMEOUT"));
    assert.ok(!stagedCommandSignals.has("EXEC_ERROR"));
  });

  it("names feature 148 for the two members of the row it does not own", () => {
    assert.deepEqual([...SIGNALS_OF_THE_CHECK_RUNNER.members], ["TIMEOUT", "EXEC_ERROR"]);
    assert.equal(SIGNALS_OF_THE_CHECK_RUNNER.owner, "148");
    const row = rowOf(233);
    assert.ok(row !== undefined);
    // The row holds all three; the division of the row is the annex's own.
    assert.deepEqual([...row.literals], ["TIMEOUT", "EXEC_ERROR", "DEADLINE"]);
    assert.equal(row.owner, "148; `DEADLINE`: 105");
    for (const member of SIGNALS_OF_THE_CHECK_RUNNER.members) {
      const branch = stagedCommandSignals.branch(member);
      assert.equal(branch.countsAsFailed, true);
      assert.equal(branch.ownedByAnotherFeature, "148");
    }
  });

  it("counts a signal outside the row as a failed command, with no owner named", () => {
    const branch = stagedCommandSignals.branch("SIGKILL");
    assert.equal(branch.member, undefined);
    assert.equal(branch.countsAsFailed, true);
    assert.equal(branch.ownedByAnotherFeature, undefined);
  });
});

describe("T008 row 234, the sub-commands of `verify`", () => {
  it("has the seven names of the baseline", () => {
    assert.deepEqual(
      [...VERIFY_SUB_COMMANDS],
      ["create", "validate", "slice", "scaffold", "run", "prestage", "prestage-report"],
    );
  });

  it("answers an unknown sub-command with the exit code 3", () => {
    const branch = verifySubCommands.branch("explain");
    assert.equal(branch.member, undefined);
    assert.equal(branch.exitCode, 3);
  });
});

describe("T008 a set that drifts is refused at load, not at the first read", () => {
  it("exports the error type a drifting registration throws", () => {
    const error = new VerificationClosedSetError("a-set", "a message");
    assert.equal(error.name, "VerificationClosedSetError");
    assert.equal(error.setName, "a-set");
    assert.ok(error instanceof Error);
  });

  it("holds no set of a row of §X.6 that another feature owns", () => {
    // Rows 53 and 54 are the check runner's; row 231 is this feature's.
    for (const number of [53, 54, 235, 236]) {
      assert.deepEqual([...verificationSetsOfRow(number)], []);
    }
  });
});
