/**
 * T002 — the three closed sets of feature 149 (rows 9, 253 and 254 of annex X
 * §X.6; F100-FR-208, F100-FR-209).
 *
 * The sets are owned by this feature and defined once, by feature 100's batch
 * module `src/enums/sets-145-149.ts` (its T256). This test checks that they are
 * exported from there, that each carries the members and the unknown-value rule
 * of the section "Closed sets" of
 * `specs/149-attempt-planner-and-seams/spec.md`, and that no module of the
 * package defines any of the three a second time.
 *
 * | Row | Set | Members | Unknown value |
 * |---|---|---|---|
 * | 9 | Kinds of phase attempt | `plain`, `diagnosed`, `accelerated`, `bumped` | `plain` |
 * | 253 | Outcomes of the bump rule | `bump`, `skip`, `none` | `none` |
 * | 254 | Reasons of a skipped bump | `critic-model`, `quota-exhausted`, `ladder-top` | Shown as text; the bump is skipped |
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  kindsOfPhaseAttempt,
  outcomesOfTheBumpRule,
  reasonsOfASkippedBump,
} from "../src/enums/sets-145-149.ts";
import {
  ClosedSetRegistrationError,
  closedSetRows,
  defineClosedSet,
  registeredSets,
  rowOf,
  type ClosedSet,
} from "../src/enums/index.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = join(PACKAGE_ROOT, "..", "..");
const BATCH_MODULE = "src/enums/sets-145-149.ts";
const SPEC_FILE =
  process.env.SPECSTRIDE_149_SPEC ??
  join(REPOSITORY_ROOT, "specs", "149-attempt-planner-and-seams", "spec.md");

/** The three sets of this feature, as the section "Closed sets" of the spec gives them. */
const THE_THREE = [
  {
    number: 9,
    name: "Kinds of phase attempt",
    members: ["plain", "diagnosed", "accelerated", "bumped"],
    unknownValue: "`plain`",
    set: kindsOfPhaseAttempt as ClosedSet,
    exportName: "kindsOfPhaseAttempt",
  },
  {
    number: 253,
    name: "Outcomes of the bump rule",
    members: ["bump", "skip", "none"],
    unknownValue: "`none`",
    set: outcomesOfTheBumpRule as ClosedSet,
    exportName: "outcomesOfTheBumpRule",
  },
  {
    number: 254,
    name: "Reasons of a skipped bump",
    members: ["critic-model", "quota-exhausted", "ladder-top"],
    unknownValue: "Shown as text; the bump is skipped",
    set: reasonsOfASkippedBump as ClosedSet,
    exportName: "reasonsOfASkippedBump",
  },
] as const;

test("T002: the three sets are exported by src/enums/sets-145-149.ts, with the owner 149", async () => {
  const batch = (await import("../src/enums/sets-145-149.ts")) as Record<string, unknown>;
  for (const row of THE_THREE) {
    assert.ok(row.exportName in batch, `${BATCH_MODULE} exports ${row.exportName}`);
    assert.equal(
      batch[row.exportName],
      row.set,
      `${row.exportName} of ${BATCH_MODULE} is the set this test reads`,
    );
    assert.equal(row.set.number, row.number);
    assert.equal(row.set.name, row.name);
    assert.equal(row.set.owner, "149", `the owner of row ${row.number} is feature 149`);
  }
});

test("T002: each set holds the members of the section Closed sets of the spec", () => {
  for (const row of THE_THREE) {
    assert.deepEqual([...row.set.members], [...row.members], `row ${row.number}`);
    for (const member of row.members) assert.equal(row.set.has(member), true, member);
    assert.equal(row.set.has("not-a-member"), false, `row ${row.number} is closed`);
    // The members come from the table of §X.6, so the set and the table agree.
    assert.deepEqual([...(rowOf(row.number)?.literals ?? [])], [...row.members]);
  }
});

test("T002: each set carries the unknown-value rule of the section Closed sets of the spec", () => {
  for (const row of THE_THREE) {
    assert.equal(rowOf(row.number)?.unknownValue, row.unknownValue, `row ${row.number}`);
    const outcome = row.set.onUnknown("not-a-member");
    // The rule carries the cell of the annex verbatim, and the value it saw.
    assert.equal(outcome.cell, row.unknownValue, `row ${row.number} carries its cell`);
    assert.equal(outcome.value, "not-a-member");
    assert.equal(outcome.set, row.name);
    assert.match(outcome.message, /not-a-member/, "the reader can show the value as text");
  }
  // Rows 9 and 253 name a member: an unknown value is read as it.
  assert.equal(kindsOfPhaseAttempt.onUnknown("x").kind, "default");
  assert.equal(kindsOfPhaseAttempt.onUnknown("x").treatedAs, "plain");
  assert.equal(outcomesOfTheBumpRule.onUnknown("x").kind, "default");
  assert.equal(outcomesOfTheBumpRule.onUnknown("x").treatedAs, "none");
  // Row 254 names no member: the cell says the reason is shown as text and the
  // bump is skipped, so the rule substitutes no member.
  assert.equal(reasonsOfASkippedBump.onUnknown("x").treatedAs, undefined);
});

test("T002: no module of the package defines any of the three sets a second time", () => {
  // One registration per number in the map of T070, and it is the export above.
  const registry = registeredSets();
  for (const row of THE_THREE) {
    assert.equal(registry.get(row.number), row.set, `row ${row.number} is registered once`);
  }
  // One definition site in the source: only the batch module of T256 names them.
  const enums = join(PACKAGE_ROOT, "src", "enums");
  const sites: Record<number, string[]> = { 9: [], 253: [], 254: [] };
  for (const name of readdirSync(enums)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(enums, name), "utf8");
    for (const number of [9, 253, 254]) {
      const pattern = new RegExp(`define(ClosedSet|ByReference)\\(\\s*${number}\\s*,`, "g");
      for (const _match of text.matchAll(pattern)) sites[number].push(`src/enums/${name}`);
    }
  }
  for (const number of [9, 253, 254]) {
    assert.deepEqual(sites[number], [BATCH_MODULE], `row ${number} has one definition site`);
  }
  // The mechanism of T070 refuses a second definition, so a later module cannot
  // add one without the check failing.
  for (const row of THE_THREE) {
    assert.throws(
      () => defineClosedSet(row.number, [...row.members] as unknown as readonly string[]),
      (error: unknown) =>
        error instanceof ClosedSetRegistrationError &&
        error.message.includes(`${row.number}`) &&
        error.message.includes("registered twice"),
      `row ${row.number} cannot be defined a second time`,
    );
  }
  // Nothing was replaced by the refused definitions.
  for (const row of THE_THREE) assert.equal(registeredSets().get(row.number), row.set);
});

test("T002: the rows of the spec and the rows of the table of §X.6 agree", (t) => {
  if (!existsSync(SPEC_FILE)) {
    t.skip(
      `the specification ${relative(REPOSITORY_ROOT, SPEC_FILE) || SPEC_FILE} is not present in ` +
        `this workdir, so its section "Closed sets" is not read`,
    );
    return;
  }
  const spec = readFileSync(SPEC_FILE, "utf8");
  const section = spec.split(/^## Closed sets$/m)[1];
  assert.ok(section !== undefined, "the spec has a section `## Closed sets`");
  for (const row of THE_THREE) {
    // The row of the section: name | members | owner | closed by | unknown value | row of §X.6.
    const line = section
      .split("\n")
      .find((l) => l.startsWith(`| ${row.name} |`) || l.startsWith(`| ${row.name}|`));
    assert.ok(line !== undefined, `the section names "${row.name}"`);
    const cells = line.split("|").map((c) => c.trim());
    const members = cells[2].split(",").map((m) => m.trim().replace(/^`|`$/g, ""));
    assert.deepEqual(members, [...row.members], `members of "${row.name}" in the spec`);
    assert.equal(cells[3], "149", `the spec gives 149 as the owner of "${row.name}"`);
    assert.equal(cells[5], row.unknownValue, `unknown value of "${row.name}" in the spec`);
    assert.equal(cells[6], String(row.number), `row of §X.6 of "${row.name}" in the spec`);
    // And the table of §X.6 the package reads holds the same row.
    const annex = closedSetRows.find((r) => r.number === row.number);
    assert.equal(annex?.name, row.name);
    assert.equal(annex?.unknownValue, row.unknownValue);
  }
});
