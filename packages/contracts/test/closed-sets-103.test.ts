/**
 * T002 of feature 103 — the six closed sets of the pass loop, each with its
 * rule for an unknown value (`specs/103-proposer-pass/spec.md`, the section
 * "Closed sets"; annex X §X.6, rows 57, 58, 121, 126, 132 and 133;
 * F100-FR-208, F100-FR-209; F103-FR-022, F103-FR-025, F103-FR-039,
 * F103-FR-042).
 *
 * | Row | Set | Members | Unknown value |
 * |---|---|---|---|
 * | 57 | Directives of a loop layer | the eleven of annex D §D.1 | the layer is refused at registration |
 * | 58 | Returns of `afterPass` | `accept`, `refuse`, `none` | read as `none`; the layer is off for the phase attempt |
 * | 132 | Kinds of record of the namespace `core` | `attempt-open`, `attempt-closed`, `pass-closed`, `counts-reset` | the record stays in the check of the chain; its content is ignored |
 * | 133 | Reasons for a fresh session | the twelve of the row and `layer-requested` of clarification U5 | read as `new-attempt` |
 * | 121 | Block sets of the proposer's prompt | `current`, `as-is` | configuration error |
 * | 126 | Values of the session directive | `fresh`, `continue` | read as `fresh` |
 *
 * The sets are REGISTERED once each, by feature 100's batch modules
 * `src/enums/sets-100-104.ts` (rows 57, 58, 121, 132, 133) and
 * `src/enums/sets-105-109.ts` (row 126). `src/enums/pass-loop.ts`, which T002
 * adds, registers nothing: it reads the registered sets and adds what a reader
 * of the pass loop needs and the table alone does not give — the member type,
 * the type guard, the unknown-value rule as a function, the members of row 57
 * (which the table states by reference to annex D §D.1), and the thirteenth
 * reason for a fresh session that this feature's specification states.
 *
 * The thirteenth member is the one place where this feature's specification and
 * the row of the annex differ, and the test pins the difference in both
 * directions: the ROW holds twelve, the SPECIFICATION holds thirteen, and
 * `data/closed-sets-103.json` — delivered from
 * `specs/103-proposer-pass/contracts/closed-sets.json` — records the addition
 * with the clarification that made it, as the correction annex X §X.6 is asked
 * for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_FRESH_REASONS,
  AFTER_PASS_RETURNS,
  AFTER_PASS_RETURN_WHEN_UNKNOWN,
  BLOCK_IDS_ARE_OPEN,
  CLOSED_SET_ROWS,
  CORE_LEDGER_KINDS,
  DIRECTIVES_OF_A_LOOP_LAYER,
  FRESH_SESSION_DROP_RULES,
  FRESH_SESSION_REASONS,
  FRESH_SESSION_REASONS_ADDED_BY_103,
  FRESH_SESSION_REASONS_OF_ROW_133,
  FRESH_SESSION_REASON_WHEN_UNKNOWN,
  OWNER,
  PROMPT_BLOCK_SETS,
  SESSION_DIRECTIVES,
  SESSION_DIRECTIVE_WHEN_UNKNOWN,
  afterPassReturns,
  closedSetsOfThePassLoop,
  coreLedgerKinds,
  freshSessionReasons,
  isAfterPassReturn,
  isCoreLedgerKind,
  isFreshSessionReason,
  isLoopLayerDirective,
  isPromptBlockSet,
  isSessionDirective,
  loopLayerDirectives,
  membersOfRow103,
  promptBlockSets,
  sessionDirectiveValues,
  unknownValueOfRow103,
} from "../src/enums/pass-loop.ts";
import {
  blockSetsOfAPromptProposerAndCritic,
  directivesOfALoopLayer,
  kindsOfRecordOfTheLedgerNamespaceCore,
  reasonsForAFreshSession,
  returnsOfAfterpass,
} from "../src/enums/sets-100-104.ts";
import { sessionDirectives } from "../src/enums/sets-105-109.ts";
import { DIRECTIVES } from "../src/ep/loop-layer.ts";
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
const SPEC_FILE =
  process.env.SPECSTRIDE_103_SPEC ?? join(REPOSITORY_ROOT, "specs", "103-proposer-pass", "spec.md");

/** The six sets, as the section "Closed sets" of `spec.md` gives them. */
const THE_SIX = [
  {
    number: 57,
    name: "Directives of a loop layer",
    specName: "Directives of a loop layer (row 57 of annex X §X.6)",
    members: [...DIRECTIVES],
    unknownValue: "The layer is refused at registration",
    unknownKind: "refuse",
    treatedAs: undefined,
    registeredIn: "src/enums/sets-100-104.ts",
    registered: directivesOfALoopLayer as ClosedSet,
    set: loopLayerDirectives as ClosedSet,
    owner: "103",
  },
  {
    number: 58,
    name: "Returns of `afterPass`",
    specName: "Returns of `afterPass` (row 58)",
    members: ["accept", "refuse", "none"],
    unknownValue: "`none`; the layer is off for the phase attempt",
    unknownKind: "default",
    treatedAs: "none",
    registeredIn: "src/enums/sets-100-104.ts",
    registered: returnsOfAfterpass as ClosedSet,
    set: afterPassReturns as ClosedSet,
    owner: "103",
  },
  {
    number: 121,
    name: "Block sets of a prompt (proposer and critic)",
    specName: "Block sets of the proposer's prompt",
    members: ["current", "as-is"],
    unknownValue: "Configuration error",
    unknownKind: "refuse",
    treatedAs: undefined,
    registeredIn: "src/enums/sets-100-104.ts",
    registered: blockSetsOfAPromptProposerAndCritic as ClosedSet,
    set: promptBlockSets as ClosedSet,
    owner: "103; 117",
  },
  {
    number: 126,
    name: "Session directives",
    specName: "Values of the session directive",
    members: ["fresh", "continue"],
    unknownValue: "Read as `fresh`",
    unknownKind: "default",
    treatedAs: "fresh",
    registeredIn: "src/enums/sets-105-109.ts",
    registered: sessionDirectives as ClosedSet,
    set: sessionDirectiveValues as ClosedSet,
    owner: "109",
  },
  {
    number: 132,
    name: "Kinds of record of the ledger namespace `core`",
    specName: "Kinds of record of the namespace `core`",
    members: ["attempt-open", "attempt-closed", "pass-closed", "counts-reset"],
    unknownValue: "The record stays in the check of the chain; its content is ignored",
    unknownKind: "ignore",
    treatedAs: undefined,
    registeredIn: "src/enums/sets-100-104.ts",
    registered: kindsOfRecordOfTheLedgerNamespaceCore as ClosedSet,
    set: coreLedgerKinds as ClosedSet,
    owner: "103",
  },
  {
    number: 133,
    name: "Reasons for a fresh session",
    specName: "Reasons for a fresh session",
    members: [
      "new-attempt",
      "watchdog-kill",
      "repeated-failure",
      "context-fill",
      "age",
      "configuration-change",
      "relaunch",
      "session-unavailable",
      "continuation-cap",
      "profile-parity",
      "group-applied",
      "no-continuation",
      "layer-requested",
    ],
    unknownValue: "Read as `new-attempt`",
    unknownKind: "default",
    treatedAs: "new-attempt",
    registeredIn: "src/enums/sets-100-104.ts",
    registered: reasonsForAFreshSession as ClosedSet,
    set: freshSessionReasons as ClosedSet,
    owner: "103",
  },
] as const;

test("T002: the module is about the six rows of §X.6 the feature uses", () => {
  assert.deepEqual([...CLOSED_SET_ROWS], [57, 58, 121, 126, 132, 133]);
  assert.equal(OWNER, "103");
  assert.deepEqual(
    [...closedSetsOfThePassLoop.keys()],
    [57, 58, 121, 126, 132, 133],
    "the module exports one set per row",
  );
  for (const row of THE_SIX) {
    assert.equal(closedSetsOfThePassLoop.get(row.number), row.set, `row ${row.number}`);
    assert.equal(row.set.number, row.number);
    assert.equal(row.set.name, rowOf(row.number)?.name, `row ${row.number} keeps its annex name`);
    assert.equal(row.set.owner, row.owner, `the owner of row ${row.number}`);
  }
});

test("T002: each set holds the members the section Closed sets of the spec gives", () => {
  for (const row of THE_SIX) {
    assert.deepEqual([...row.set.members], [...row.members], `members of row ${row.number}`);
    for (const member of row.members) {
      assert.equal(row.set.has(member), true, `${member} is a member of row ${row.number}`);
    }
    assert.equal(row.set.has("not-a-member"), false, `row ${row.number} is closed`);
  }
  // The named exports, each in the order of the specification.
  assert.deepEqual([...DIRECTIVES_OF_A_LOOP_LAYER], [...DIRECTIVES]);
  assert.equal(DIRECTIVES_OF_A_LOOP_LAYER.length, 11, "eleven directives");
  assert.deepEqual([...AFTER_PASS_RETURNS], ["accept", "refuse", "none"]);
  assert.deepEqual(
    [...CORE_LEDGER_KINDS],
    ["attempt-open", "attempt-closed", "pass-closed", "counts-reset"],
  );
  assert.deepEqual([...PROMPT_BLOCK_SETS], ["current", "as-is"]);
  assert.deepEqual([...SESSION_DIRECTIVES], ["fresh", "continue"]);
  assert.equal(FRESH_SESSION_REASONS.length, 13);
  // The type guards agree with the sets.
  assert.equal(isLoopLayerDirective("requestPassGroup"), true);
  assert.equal(isLoopLayerDirective("requestPassGroups"), false);
  assert.equal(isAfterPassReturn("refuse"), true);
  assert.equal(isAfterPassReturn("accepted"), false);
  assert.equal(isCoreLedgerKind("counts-reset"), true);
  assert.equal(isCoreLedgerKind("pass-open"), false);
  assert.equal(isPromptBlockSet("as-is"), true);
  assert.equal(isPromptBlockSet("asis"), false);
  assert.equal(isSessionDirective("continue"), true);
  assert.equal(isSessionDirective("resume"), false);
  assert.equal(isFreshSessionReason("layer-requested"), true);
  assert.equal(isFreshSessionReason("layer-asked"), false);
  // Block IDS stay open; only the block SETS are closed (row 121).
  assert.equal(BLOCK_IDS_ARE_OPEN, true);
});

test("T002: each set carries the rule for an unknown value the spec states", () => {
  for (const row of THE_SIX) {
    const outcome = row.set.onUnknown("not-a-member");
    assert.equal(outcome.kind, row.unknownKind, `the kind of the rule of row ${row.number}`);
    assert.equal(outcome.treatedAs, row.treatedAs, `the default of row ${row.number}`);
    assert.equal(outcome.value, "not-a-member");
    assert.equal(outcome.set, row.set.name);
    assert.match(outcome.message, /not-a-member/, "the reader can show the value as text");
    // The cell of the annex, verbatim.
    assert.equal(outcome.cell, rowOf(row.number)?.unknownValue, `the cell of row ${row.number}`);
  }
  // The three rules that name a member.
  assert.equal(AFTER_PASS_RETURN_WHEN_UNKNOWN, "none");
  assert.equal(FRESH_SESSION_REASON_WHEN_UNKNOWN, "new-attempt");
  assert.equal(SESSION_DIRECTIVE_WHEN_UNKNOWN, "fresh");
  // A directive the engine does not offer refuses the LAYER, not the record.
  assert.equal(loopLayerDirectives.onUnknown("requestWorld").kind, "refuse");
  assert.match(loopLayerDirectives.onUnknown("requestWorld").message, /refused/);
  // An unknown kind of a `core` record is ignored, never refused: the record
  // stays in the check of the chain (F103-FR-039).
  assert.equal(coreLedgerKinds.onUnknown("attempt-paused").kind, "ignore");
  // A block set outside the two is a configuration error: no pass starts.
  assert.equal(promptBlockSets.onUnknown("legacy").kind, "refuse");
});

test("T002: the thirteenth reason for a fresh session is the spec's, not the row's", () => {
  // The ROW of annex X §X.6 holds twelve.
  assert.equal(FRESH_SESSION_REASONS_OF_ROW_133.length, 12);
  assert.equal(
    FRESH_SESSION_REASONS_OF_ROW_133.includes("layer-requested" as never),
    false,
    "the row of the annex does not hold `layer-requested` yet",
  );
  assert.deepEqual([...(rowOf(133)?.literals ?? [])], [...FRESH_SESSION_REASONS_OF_ROW_133]);
  // The SPECIFICATION of this feature holds thirteen (clarification U5).
  assert.deepEqual([...FRESH_SESSION_REASONS_ADDED_BY_103], ["layer-requested"]);
  assert.deepEqual(
    [...FRESH_SESSION_REASONS],
    [...FRESH_SESSION_REASONS_OF_ROW_133, "layer-requested"],
  );
  // The eleven drop rules, and the two reasons of a session that is always fresh.
  assert.equal(FRESH_SESSION_DROP_RULES.length, 11, "eleven drop rules (F103-FR-042)");
  assert.deepEqual([...ALWAYS_FRESH_REASONS], ["no-continuation", "layer-requested"]);
  for (const always of ALWAYS_FRESH_REASONS) {
    assert.equal(
      FRESH_SESSION_DROP_RULES.includes(always),
      false,
      `${always} is no drop rule: the session is fresh whatever the rules say`,
    );
  }
  // The data file of the feature records the addition and the clarification.
  const data = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "data", "closed-sets-103.json"), "utf8"),
  ) as { owner: string; sets: { row: string; addedMembers?: string; addedBy?: string }[] };
  assert.equal(data.owner, "103");
  const row133 = data.sets.find((s) => s.row === "133");
  assert.ok(row133 !== undefined);
  assert.equal(row133.addedMembers, "layer-requested");
  assert.match(String(row133.addedBy), /clarification U5/);
  assert.deepEqual([...membersOfRow103(133)], [...FRESH_SESSION_REASONS]);
  assert.equal(unknownValueOfRow103(133), "Read as `new-attempt`");
  // And every one of the six rows of the data file agrees with the module.
  for (const row of THE_SIX) {
    assert.deepEqual(
      [...membersOfRow103(row.number)],
      [...row.members],
      `data/closed-sets-103.json row ${row.number}`,
    );
  }
});

test("T002: src/enums/pass-loop.ts registers nothing; each set is defined once", () => {
  // The registered set of a row is the batch module's, not this module's copy
  // of row 57 or row 133; the assembly of T257 keeps holding exactly the rows
  // of the table.
  const registry = registeredSets();
  for (const row of THE_SIX) {
    const registered = registry.get(row.number);
    assert.ok(registered !== undefined, `row ${row.number} is registered`);
    assert.equal(registered.number, row.number, `row ${row.number} is registered under its number`);
    assert.equal(
      registered.name,
      row.set.name,
      `row ${row.number} is registered under the name of its row of §X.6`,
    );
    if (row.number === 57) {
      // Row 57 states its members by reference, so `defineByReference` of T070
      // registers the inner set and exports a frozen copy with `byReference`.
      assert.notEqual(registered, row.registered, "row 57 registers its inner set");
      assert.deepEqual([...registered.members], [], "and the registered set carries no member");
    } else {
      assert.equal(
        registered,
        row.registered,
        `row ${row.number} is registered by ${row.registeredIn}`,
      );
    }
    // The module of T002 never replaces a registration with its own set.
    if (row.number === 57 || row.number === 133) {
      assert.notEqual(
        registered,
        row.set,
        `the set src/enums/pass-loop.ts exports for row ${row.number} is not the registered one`,
      );
    }
  }
  // One definition site in the source, and it is the batch module of the row.
  const enums = join(PACKAGE_ROOT, "src", "enums");
  for (const row of THE_SIX) {
    const sites: string[] = [];
    for (const name of readdirSync(enums)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(enums, name), "utf8");
      const pattern = new RegExp(`define(ClosedSet|ByReference)\\(\\s*${row.number}\\s*,`, "g");
      for (const _match of text.matchAll(pattern)) sites.push(`src/enums/${name}`);
    }
    assert.deepEqual(sites, [row.registeredIn], `row ${row.number} has one definition site`);
  }
  // The mechanism of T070 refuses a second definition.
  for (const row of THE_SIX) {
    assert.throws(
      () => defineClosedSet(row.number, [...row.members] as unknown as readonly string[]),
      (error: unknown) =>
        error instanceof ClosedSetRegistrationError &&
        error.message.includes(`${row.number}`) &&
        error.message.includes("registered twice"),
      `row ${row.number} cannot be defined a second time`,
    );
    assert.equal(registeredSets().get(row.number)?.name, row.set.name, "nothing was replaced");
  }
});

test("T002: row 57 takes its eleven members from the table of annex D §D.1", () => {
  // The row states its members by reference, so the registered set carries none
  // and the module fills them from the table the annex owns.
  assert.deepEqual([...directivesOfALoopLayer.members], [], "the row gives no literals");
  assert.deepEqual([...(rowOf(57)?.literals ?? [])], []);
  assert.equal(rowOf(57)?.members, "The eleven of annex D §D.1");
  const table = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "data", "loop-layer-tables.json"), "utf8"),
  ) as { directives: { Directive: string }[] };
  const fromTheTable = table.directives.map((r) => /`([^`]+)`/.exec(r.Directive)?.[1]);
  assert.deepEqual([...DIRECTIVES_OF_A_LOOP_LAYER], fromTheTable);
  assert.deepEqual(
    [...DIRECTIVES_OF_A_LOOP_LAYER],
    [...DIRECTIVES],
    "and with src/ep/loop-layer.ts",
  );
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
  assert.match(section, /Owner of each: 103\./, "the section names the owner");
  const lines = section.split("\n");
  for (const row of THE_SIX) {
    // The row of the section: set | members | closed by | unknown value.
    const line = lines.find((l) => l.startsWith(`| ${row.specName} |`));
    assert.ok(line !== undefined, `the section names "${row.specName}"`);
    const cells = line.split("|").map((c) => c.trim());
    assert.match(cells[3], /^Design/, `"${row.specName}" is closed by design`);
    // The members, as the cell writes them. Row 57 points at the annex; the
    // other five give literals, row 133 with two trailing clauses.
    if (row.number === 57) {
      assert.match(cells[2], /`keep`/);
      for (const member of row.members) {
        assert.ok(cells[2].includes(`\`${member}\``), `the cell names \`${member}\``);
      }
    } else {
      for (const member of row.members) {
        assert.ok(cells[2].includes(`\`${member}\``), `the cell names \`${member}\``);
      }
    }
    // The unknown-value cell of the spec and the cell of the annex say the same
    // thing; the spec writes it in words, the annex in the form the rule reads.
    assert.ok(cells[4].length > 0, `"${row.specName}" states its unknown value`);
    const annex = closedSetRows.find((r) => r.number === row.number);
    assert.equal(annex?.name, row.set.name);
    assert.equal(annex?.unknownValue, rowOf(row.number)?.unknownValue);
  }
  // The open set the section names: block ids.
  assert.match(section, /Open sets: block ids/);
});
