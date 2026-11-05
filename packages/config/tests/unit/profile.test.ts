/**
 * T010 — CT-110-107 and CT-110-112 (F110-FR-008, F110-FR-013).
 *
 * CT-110-107 (F110-FR-008): the schema holds the spelling of every key of annex
 * X §X.7 as §K.9 decided, and every switch of the product has a value under
 * `parity`. The five reserved literals are the only non-value entries. A test
 * fails when a switch of the schema has no row in the profile, and when a row
 * names a key that is not in the schema.
 *
 * CT-110-112 (F110-FR-013): the profile is selected by the key `profile`, at
 * flag, environment or user rank. Selecting `parity` supplies the value of every
 * switch of the profile as the default of that switch, at rank 8, and does
 * nothing else; an explicit setting at ranks 1 to 7 beats it; a project file
 * cannot select it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankOfLayer, resolveKey, type Offer } from "@specstride/contracts/envelope/config";
import { profileRows as annexRows } from "@specstride/contracts/profile/parity";

import { CATALOGUE, SWITCH_KEYS, catalogueEntry, isKnownKey } from "../../src/schema/catalogue.ts";
import {
  PROFILE_KEY,
  PROFILE_NAME,
  PROFILE_RANK,
  PROFILE_ROWS,
  PROFILE_SCHEMA_ID,
  PROFILE_SWITCH_COUNT,
  SHIPPED_SCHEMA_ID,
  UnknownProfileError,
  keysThatAreNotSwitches,
  literalsInUse,
  profileMayBeSelectedBy,
  profileRowOfKey,
  rowsWithAnUnknownLiteral,
  rowsWithoutAKey,
  selectProfile,
  switchesWithoutARow,
  type ProfileParityRow,
} from "../../src/schema/profile.ts";
import { RESERVED_PARITY_LITERALS } from "../../src/schema/types.ts";
import { parseParity, parseValueSpec } from "../../src/schema/type-parse.ts";
import { validateKeyValue } from "../../src/schema/validate.ts";
import { check as checkProfileData } from "../../tools/profile-parity-gen.ts";

/** A row of the shipped profile, for a negative case to break in one place. */
const SOUND_ROW: ProfileParityRow = Object.freeze({
  key: "loop.strategy",
  annexRows: [1],
  annexParity: ["`classic`"],
  cell: "classic",
  sets: true,
  value: "classic",
  default: "micro",
  owners: ["115"],
});

describe("CT-110-107 — every switch has a profile row, and no row is without a key (F110-FR-008)", () => {
  it("the shipped profile is `specstride.profile/1`, named `parity`", () => {
    assert.equal(SHIPPED_SCHEMA_ID, PROFILE_SCHEMA_ID);
    assert.equal(PROFILE_SCHEMA_ID, "specstride.profile/1");
    assert.equal(PROFILE_NAME, "parity");
  });

  it("the shipped profile data equals the catalogue it belongs to", () => {
    assert.deepEqual(checkProfileData(), []);
  });

  it("holds one row per switch of the schema, and nothing else", () => {
    assert.equal(PROFILE_ROWS.length, PROFILE_SWITCH_COUNT);
    assert.equal(PROFILE_ROWS.length, SWITCH_KEYS.length);
    assert.equal(new Set(PROFILE_ROWS.map((r) => r.key)).size, PROFILE_ROWS.length);
    assert.deepEqual([...PROFILE_ROWS].map((r) => r.key).sort(), [...SWITCH_KEYS].sort());
  });

  it("fails when a switch of the schema has no row in the profile", () => {
    assert.deepEqual(switchesWithoutARow(), []);
    // The negative case: a profile that is missing one row reports exactly it.
    const short = PROFILE_ROWS.filter((r) => r.key !== "loop.strategy");
    assert.deepEqual(switchesWithoutARow(short), ["loop.strategy"]);
  });

  it("fails when a row names a key that is not in the schema", () => {
    assert.deepEqual(rowsWithoutAKey(), []);
    const invented = [...PROFILE_ROWS, { ...SOUND_ROW, key: "loop.strategyy" }];
    assert.deepEqual(rowsWithoutAKey(invented), ["loop.strategyy"]);
  });

  it("the five reserved literals are the only non-value entries", () => {
    assert.deepEqual(
      [...RESERVED_PARITY_LITERALS],
      ["off", "not used", "baseline", "as-is", "(fixture)"],
    );
    assert.deepEqual(rowsWithAnUnknownLiteral(), []);
    for (const literal of literalsInUse().keys()) {
      assert.ok(
        (RESERVED_PARITY_LITERALS as readonly string[]).includes(literal),
        `\`${literal}\` is no reserved literal of closed set 239`,
      );
    }
    const strange = [
      ...PROFILE_ROWS,
      { ...SOUND_ROW, key: "loop.escalation", sets: false, literal: "sometimes" },
    ];
    assert.deepEqual(rowsWithAnUnknownLiteral(strange), ["loop.escalation"]);
  });

  it("an entry that is neither a value of the key's type nor a reserved literal makes the profile invalid", () => {
    const spec = parseValueSpec("on, off");
    const deferred = { kind: "deferred" as const, text: "on" };
    assert.equal(parseParity("off", spec, deferred)?.kind, "value");
    assert.equal(parseParity("not used", spec, deferred)?.kind, "literal");
    assert.equal(parseParity("whenever the mood takes it", spec, deferred), undefined);
  });

  it("a literal stands only where the key's type cannot hold it as a value", () => {
    // `off` under a key of the cell `on, off` is the value; `off` under a key that
    // holds a list of fallbacks is the reserved literal that says the run never
    // reaches it.
    assert.equal(catalogueEntry("loop.escalation")?.parity.kind, "value");
    assert.equal(profileRowOfKey("loop.escalation")?.sets, true);
    assert.equal(profileRowOfKey("loop.escalation")?.value, false);
    assert.equal(profileRowOfKey("roles.<role>.fallback")?.sets, false);
    assert.equal(profileRowOfKey("roles.<role>.fallback")?.literal, "off");
    assert.equal(profileRowOfKey("state.dir")?.literal, "(fixture)");
    assert.equal(profileRowOfKey("loop.parallel.workers")?.literal, "not used");
  });

  it("every row carries the rows of annex X §X.7 it came from, and the annex names the key", () => {
    const withRows = PROFILE_ROWS.filter((r) => r.annexRows.length > 0);
    assert.ok(withRows.length > 150, "nearly every switch has a row of the annex");
    for (const row of withRows) {
      for (const number of row.annexRows) {
        const annex = annexRows.find((a) => a.number === number);
        assert.ok(annex !== undefined, `${row.key}: annex X §X.7 has no row ${number}`);
        assert.ok(
          annex.keys.includes(row.key),
          `${row.key}: row ${number} of the annex names \`${annex.keys.join("`, `")}\``,
        );
      }
    }
  });

  it("the spelling of every key of annex X §X.7 is in the schema, as §K.9 decided", () => {
    const keys = [...new Set(annexRows.flatMap((r) => r.keys))];
    assert.deepEqual(
      keys.filter((k) => !isKnownKey(k)),
      [],
    );
  });

  it("a key that is not a switch has, under `parity`, the value it has at the baseline", () => {
    const notSwitches = keysThatAreNotSwitches();
    assert.equal(notSwitches.length + SWITCH_KEYS.length, CATALOGUE.length);
    for (const key of notSwitches) {
      assert.equal(profileRowOfKey(key), undefined, `${key} is not a switch but has a row`);
      assert.equal(catalogueEntry(key)?.parity.kind, "as-default");
    }
    // The keys the specification names as not switches, each with its reason.
    for (const key of [
      "status.staleEventSec",
      "status.timelineRows",
      "wait.pollSec",
      "wait.timeoutSec",
      "harnesses.claude.label",
      "roles.critic.provider",
      "harnesses.<id>.tiers",
    ]) {
      assert.ok(notSwitches.includes(key), `${key} should not be a switch`);
    }
  });
});

describe("CT-110-112 — selecting `parity` sets only switches, and every explicit setting beats it (F110-FR-013)", () => {
  it("the profile is selected by the key `profile`, at flag, environment or user rank", () => {
    assert.equal(PROFILE_KEY, "profile");
    assert.deepEqual(catalogueEntry(PROFILE_KEY)?.layers, ["F", "E", "U"]);
    assert.equal(profileMayBeSelectedBy("F"), true);
    assert.equal(profileMayBeSelectedBy("E"), true);
    assert.equal(profileMayBeSelectedBy("U"), true);
    for (const layer of ["F", "E", "U"] as const) {
      assert.equal(validateKeyValue(PROFILE_KEY, "parity", layer).ok, true);
    }
  });

  it("a project file cannot select the profile", () => {
    assert.equal(profileMayBeSelectedBy("P"), false);
    const verdict = validateKeyValue(PROFILE_KEY, "parity", "P", {
      place: "/work/specstride.yaml",
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.ok === false);
    assert.match(verdict.error.message, /may not be set by the layer `project-configuration`/);
    assert.match(verdict.error.message, /\/work\/specstride\.yaml/);
  });

  it("an unknown profile is refused", () => {
    assert.throws(() => selectProfile("turbo"), UnknownProfileError);
  });

  it("supplies a value for every switch whose row names one, at the rank of the default", () => {
    const selection = selectProfile("parity");
    assert.equal(selection.profile, "parity");
    assert.equal(PROFILE_RANK, rankOfLayer["default"]);
    assert.equal(PROFILE_RANK, 8);
    assert.ok(selection.offers.size > 0);
    for (const [key, offer] of selection.offers) {
      assert.equal(offer.layer, "default", `${key}: the profile offered the layer ${offer.layer}`);
      const row = profileRowOfKey(key);
      assert.ok(row !== undefined && row.sets, `${key}: the profile offered a value with no row`);
      assert.deepEqual(offer.value, row.value);
    }
  });

  it("and does nothing else: no key outside the profile's rows is touched", () => {
    const selection = selectProfile("parity");
    const switches = new Set(SWITCH_KEYS);
    for (const key of selection.offers.keys()) {
      assert.ok(switches.has(key), `${key} is not a switch of the schema`);
    }
    for (const key of selection.leftAtDefault.keys()) {
      assert.ok(switches.has(key), `${key} is not a switch of the schema`);
    }
    assert.equal(selection.offers.size + selection.leftAtDefault.size, SWITCH_KEYS.length);
    for (const key of keysThatAreNotSwitches()) {
      assert.equal(selection.offers.has(key), false, `${key} was set by the profile`);
      assert.equal(selection.leftAtDefault.has(key), false, `${key} was named by the profile`);
    }
  });

  it("a switch whose row carries a reserved literal is left at its default", () => {
    const selection = selectProfile("parity");
    assert.equal(selection.offers.has("loop.parallel.workers"), false);
    assert.equal(selection.leftAtDefault.get("loop.parallel.workers"), "not used");
    assert.equal(selection.leftAtDefault.get("state.dir"), "(fixture)");
    assert.equal(selection.leftAtDefault.get("roles.<role>.fallback"), "off");
  });

  it("an explicit setting at ranks 1 to 7 beats the profile", () => {
    const selection = selectProfile("parity");
    const fromProfile = selection.offers.get("loop.strategy");
    assert.ok(fromProfile !== undefined);
    assert.equal(fromProfile.value, "classic");
    // Rank 7 (a learned value) through rank 1 (the contract pin): each wins.
    const higher: readonly Offer[] = [
      { layer: "learned-value", value: "micro" },
      { layer: "user-configuration", value: "micro" },
      { layer: "project-configuration", value: "micro" },
      { layer: "environment", value: "micro" },
      { layer: "flag", value: "micro" },
      { layer: "launch-contract-pin", value: "micro" },
    ];
    for (const offer of higher) {
      const resolved = resolveKey("loop.strategy", [fromProfile, offer], { class: "pinned" });
      assert.ok(resolved !== undefined);
      assert.equal(resolved.value, "micro", `the profile beat the layer ${offer.layer}`);
      assert.equal(resolved.source, offer.layer);
      assert.ok(resolved.rank < PROFILE_RANK);
    }
    // With nothing above it, the profile's value stands, at rank 8.
    const alone = resolveKey("loop.strategy", [fromProfile], { class: "pinned" });
    assert.equal(alone?.value, "classic");
    assert.equal(alone?.source, "default");
    assert.equal(alone?.rank, 8);
  });

  it("so a fixture that names a role, and the second suite that sets row 1 to `micro`, work", () => {
    const selection = selectProfile("parity");
    // A fixture names the proposer's harness; the profile leaves that switch to it.
    assert.equal(selection.leftAtDefault.get("roles.proposer.harness"), "(fixture)");
    const named = resolveKey("roles.proposer.harness", [{ layer: "flag", value: "claude" }], {
      class: "pinned",
    });
    assert.equal(named?.value, "claude");
    assert.equal(named?.source, "flag");
    // Row 1 of annex X §X.7 is `loop.strategy`; the second suite sets it to `micro`.
    assert.deepEqual(annexRows.find((r) => r.number === 1)?.keys, ["loop.strategy"]);
    assert.equal(profileRowOfKey("loop.strategy")?.annexRows[0], 1);
  });
});
