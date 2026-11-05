/**
 * T169 — contract tests CT-100-211 and CT-100-212 for the containment levels
 * (annex C, §C.15; F100-FR-111, F100-FR-112). The subject is the key
 * `containmentLevels` of `data/harness-tables.json`, row 26 of
 * `data/closed-sets.json`, the ceiling with its provenance, `protection`, and
 * the rule for parallel units.
 */
import test from "node:test";
import assert from "node:assert/strict";
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ANNEX_SECTION,
  ASSERTION_IS_SET_BY,
  ASSERTION_IS_SET_ONLY_UNDER_PARITY,
  CEILING_PROVENANCES,
  CLOSED_SET_ROW,
  CONTAINMENT_LEVELS,
  CONTAINMENT_LEVEL_ROWS,
  LEVEL_IS_ANNOUNCED,
  LEVEL_IS_RECORDED,
  LEVEL_THAT_NEEDS_AN_OPT_IN,
  LEVEL_UNVERIFIED_UNTIL_A_CAPTURE,
  LEVEL_WHEN_UNKNOWN,
  MARK_OF_AN_UNVERIFIED_CEILING,
  OPT_IN_RANK,
  PARALLEL_UNITS_FALLBACK_REASON,
  PARALLEL_UNITS_MINIMUM_LEVEL,
  PARALLEL_UNITS_OVERRIDE_KEY,
  PARALLEL_UNITS_OVERRIDE_RANK,
  PARALLEL_UNITS_UNDER_PARITY,
  PROTECTION_VALUES,
  RANKS_THAT_MUST_NOT_GIVE_THE_OPT_IN,
  RANKS_THAT_MUST_NOT_SET_THE_OVERRIDE,
  RUNTIME_NEVER_ASSERTS_A_SANDBOX,
  isContainmentCeiling,
  isContainmentLevel,
  meaningOfLevel,
  parallelUnitsDecision,
  proposerIsRefusedAtLaunch,
  protectionByLevel,
  protectionFor,
  readContainmentLevel,
  strengthOf,
  strongestOf,
} from "../src/enums/containment.ts";
import { closedSets } from "../src/enums/all-sets.ts";
import { containmentLevels } from "../src/enums/sets-105-109.ts";
import { CONTAINMENT_LEVELS as LEVELS_OF_THE_PORT } from "../src/ep/harness.ts";
import { RANK_LAYERS } from "../src/envelope/config.ts";

type RawLevel = { Level: string; Meaning: string };
const RAW = (harnessTables as { containmentLevels: RawLevel[] }).containmentLevels;

test("CT-100-211: containment has the four levels of §C.15, from the data file", () => {
  assert.equal(ANNEX_SECTION, "annex C, §C.15");
  assert.deepEqual([...CONTAINMENT_LEVELS], ["C0", "C1", "C2", "C3"]);
  assert.equal(CONTAINMENT_LEVELS.length, 4);
  // The table of the package is the table of `data/harness-tables.json`.
  assert.equal(CONTAINMENT_LEVEL_ROWS.length, RAW.length);
  CONTAINMENT_LEVEL_ROWS.forEach((row, i) => {
    assert.equal(row.level, RAW[i]?.Level);
    assert.equal(row.meaning, RAW[i]?.Meaning);
    assert.equal(row.strength, i);
  });
  assert.match(meaningOfLevel.C0, /No containment/);
  assert.match(meaningOfLevel.C1, /restriction at tool level/);
  assert.match(meaningOfLevel.C2, /sandbox of the operating system/);
  assert.match(meaningOfLevel.C3, /container or a virtual machine/);

  // The set is closed: row 26 of annex X §X.6, registered by reference to this
  // table through the mechanism of T070.
  assert.equal(CLOSED_SET_ROW, 26);
  const row26 = (
    closedSetsData as {
      closedSets: {
        number: number;
        name: string;
        members: string;
        literals: string[];
        unknownValue: string;
      }[];
    }
  ).closedSets.find((r) => r.number === 26);
  assert.equal(row26?.name, "Containment levels");
  assert.equal(row26?.members, "C0, C1, C2, C3");
  assert.deepEqual([...(row26?.literals ?? [])], [], "the row gives no literals: it refers here");
  assert.match(String(row26?.unknownValue), /Read as C0/);
  const registered = closedSets.get(26);
  assert.notEqual(registered, undefined);
  assert.equal(registered?.name, row26?.name);
  assert.deepEqual([...(registered?.members ?? [])], [...CONTAINMENT_LEVELS]);
  assert.deepEqual([...containmentLevels.members], [...CONTAINMENT_LEVELS]);
  assert.equal(containmentLevels.byReference, true);
  assert.ok(containmentLevels.has("C2"));
  assert.equal(containmentLevels.has("C4"), false);

  // The unknown-value rule of row 26: a level a reader does not know is C0.
  assert.equal(LEVEL_WHEN_UNKNOWN, "C0");
  assert.equal(readContainmentLevel("C3"), "C3");
  assert.equal(readContainmentLevel("C9"), "C0");
  assert.equal(readContainmentLevel(undefined), "C0");
  assert.ok(isContainmentLevel("C1"));
  assert.equal(isContainmentLevel("C4"), false);

  // The harness port of §C.1 names the same four levels.
  assert.deepEqual([...LEVELS_OF_THE_PORT], [...CONTAINMENT_LEVELS]);
});

test("CT-100-211: the ceiling with its provenance, the strongest level, `protection`", () => {
  // Every harness adapter declares its ceiling with provenance.
  assert.ok(CEILING_PROVENANCES.length >= 2);
  assert.ok(isContainmentCeiling({ level: "C2", provenance: "declared" }));
  assert.equal(isContainmentCeiling({ level: "C2" }), false, "a level without provenance is none");
  assert.equal(isContainmentCeiling({ provenance: "declared" }), false);
  assert.equal(isContainmentCeiling("C2"), false);
  // C2 is the level §C.15 marks unverified until a capture of that harness.
  assert.equal(LEVEL_UNVERIFIED_UNTIL_A_CAPTURE, "C2");
  assert.equal(MARK_OF_AN_UNVERIFIED_CEILING, "unverified");
  assert.ok(CEILING_PROVENANCES.includes(MARK_OF_AN_UNVERIFIED_CEILING));
  assert.match(meaningOfLevel.C2, /`unverified` until a capture/);

  // The runtime uses the strongest level available.
  assert.deepEqual(
    CONTAINMENT_LEVELS.map((l) => strengthOf(l)),
    [0, 1, 2, 3],
  );
  assert.equal(strongestOf(["C1", "C3", "C0"]), "C3");
  assert.equal(strongestOf([]), "C0");
  assert.equal(strongestOf(["C9"]), "C0");
  // The level in force is announced and recorded for every run.
  assert.equal(LEVEL_IS_ANNOUNCED, true);
  assert.equal(LEVEL_IS_RECORDED, true);

  // `protection` per level (SL-6 of annex B §B.2, named by §C.15).
  assert.deepEqual([...PROTECTION_VALUES], ["prevent", "detect"]);
  assert.equal(protectionFor("C0", true), "detect");
  assert.equal(protectionFor("C1", true), "detect");
  assert.equal(protectionFor("C2", false), "detect");
  assert.equal(protectionFor("C2", true), "prevent");
  assert.equal(protectionFor("C3", true), "prevent");
  assert.equal(protectionByLevel["C2"]?.confirmed, "prevent");
  assert.equal(protectionByLevel["C2"]?.unconfirmed, "detect");

  // C0 needs an opt-in in user configuration, which no other rank may give; a
  // proposer whose ceiling is C0 is refused at launch without it.
  assert.equal(LEVEL_THAT_NEEDS_AN_OPT_IN, "C0");
  assert.equal(OPT_IN_RANK, "user-configuration");
  assert.ok(RANK_LAYERS.includes(OPT_IN_RANK));
  assert.deepEqual(
    [...RANKS_THAT_MUST_NOT_GIVE_THE_OPT_IN],
    ["flag", "environment", "project-configuration"],
  );
  for (const rank of RANKS_THAT_MUST_NOT_GIVE_THE_OPT_IN) {
    assert.ok(RANK_LAYERS.includes(rank), rank);
    assert.notEqual(rank, OPT_IN_RANK);
  }
  assert.equal(proposerIsRefusedAtLaunch("C0", false), true);
  assert.equal(proposerIsRefusedAtLaunch("C0", true), false);
  assert.equal(proposerIsRefusedAtLaunch("C1", false), false);

  // The runtime never asserts a sandbox by itself; only under the `parity`
  // profile does the harness adapter set the as-is assertion variable.
  assert.equal(RUNTIME_NEVER_ASSERTS_A_SANDBOX, true);
  assert.equal(ASSERTION_IS_SET_ONLY_UNDER_PARITY, true);
  assert.equal(ASSERTION_IS_SET_BY, "the harness adapter");
});

test("CT-100-212: parallel units run only at C2 or above (F100-FR-112)", () => {
  assert.equal(PARALLEL_UNITS_MINIMUM_LEVEL, "C2");

  // At C2 and above the option may run, and `protection` follows the
  // confirmation of the harness adapter.
  const atC2 = parallelUnitsDecision("C2", { sandboxDeniesControlPlaneWrites: true });
  assert.equal(atC2.allowed, true);
  assert.equal(atC2.reason, "level-sufficient");
  assert.equal(atC2.protection, "prevent");
  assert.equal(atC2.offForTheWholeRun, false);
  assert.equal(parallelUnitsDecision("C3").allowed, true);
  assert.equal(parallelUnitsDecision("C2").protection, "detect");

  // Below C2 the option stays off for the whole run, with the reason stated.
  const atC1 = parallelUnitsDecision("C1");
  assert.equal(atC1.allowed, false);
  assert.equal(atC1.reason, PARALLEL_UNITS_FALLBACK_REASON);
  assert.equal(atC1.reason, "containment");
  assert.equal(atC1.offForTheWholeRun, true);
  assert.equal(parallelUnitsDecision("C0").allowed, false);
  // An unknown level is read as C0, so it is below the minimum.
  assert.equal(parallelUnitsDecision("C9").allowed, false);
  // The reason is the member `containment` of row 60 of annex X §X.6.
  const row60 = (
    closedSetsData as { closedSets: { number: number; literals: string[] }[] }
  ).closedSets.find((r) => r.number === 60);
  assert.ok((row60?.literals ?? []).includes(PARALLEL_UNITS_FALLBACK_REASON));

  // Unless the consumer set the key in user configuration; the run then says
  // `protection=detect`.
  assert.equal(PARALLEL_UNITS_OVERRIDE_KEY, "loop.parallel.allow_detect");
  assert.equal(PARALLEL_UNITS_OVERRIDE_RANK, "user-configuration");
  assert.ok(RANK_LAYERS.includes(PARALLEL_UNITS_OVERRIDE_RANK));
  assert.deepEqual(
    [...RANKS_THAT_MUST_NOT_SET_THE_OVERRIDE],
    ["flag", "environment", "project-configuration"],
  );
  const withOverride = parallelUnitsDecision("C1", { allowDetectInUserConfiguration: true });
  assert.equal(withOverride.allowed, true);
  assert.equal(withOverride.reason, "override");
  assert.equal(withOverride.protection, "detect");
  // The override does not turn `prevent` on: below C2 the run says `detect`,
  // even where the harness adapter confirmed the denial.
  const overrideConfirmed = parallelUnitsDecision("C1", {
    allowDetectInUserConfiguration: true,
    sandboxDeniesControlPlaneWrites: true,
  });
  assert.equal(overrideConfirmed.protection, "detect");

  // Off under the `parity` profile (rows 20 and 23 of annex X §X.7).
  assert.equal(PARALLEL_UNITS_UNDER_PARITY, "off");
});
