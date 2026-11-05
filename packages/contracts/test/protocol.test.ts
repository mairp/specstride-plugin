/**
 * T187 — contract tests CT-100-270 to CT-100-274 for the CLI protocol,
 * version 1 (annex G, §G.1; F100-FR-170 to F100-FR-174), over the keys
 * `protocol` and `commands` of `data/cli-protocol.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import cliProtocol from "../data/cli-protocol.json" with { type: "json" };
import {
  ACTS_WHOSE_SPELLING_THE_OWNER_DECIDES,
  ANNEX_SECTION,
  CLOSED_SET_ROW,
  COMMANDS,
  JSON_FLAG,
  MISMATCH_EXIT_CODE,
  MISMATCH_LINE,
  MISMATCH_NAMES_THE_COMMAND,
  NEVER_IN_JSON_OUTPUT,
  NOT_COMMANDS,
  OPT_IN_FLAGS,
  OWNER_OF_THAT_ROW,
  ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES,
  ROWS_WITH_VERBS,
  PROTOCOL,
  PROTOCOL_EXIT_CODE,
  PROTOCOL_FLAG,
  PROTOCOL_PRINTS_NOTHING_ELSE,
  PUBLIC_BASELINE_CODES,
  PUBLIC_BASELINE_COMMANDS,
  RAISES_THE_INTEGER,
  UNKNOWN_VERB_EXIT_CODE,
  VERBOSE_FLAG,
  checkJsonRecord,
  commandRow,
  commandRows,
  compareProtocol,
  isCommand,
  loadCommands,
  ownerOf,
  protocolAfter,
  protocolHandler,
  raisesTheInteger,
} from "../src/grammar/protocol.ts";
import {
  ACCEPT_SOURCE_CHANGE,
  ACCEPT_SOURCE_CHANGE_COMMAND,
  ACCEPT_SOURCE_CHANGE_IS_DECLARED,
  ENFORCEMENTS_NO_FLAG_SWITCHES_OFF,
  FLAGS_OF_THE_ANNEX,
  PARITY_ROW as FLAGS_PARITY_ROW,
  SOURCES,
  THE_COMMENT_ONLY_SELECTS_AMONG_ACCEPTED_OPTIONS,
  WIDENING_IS_INFERRED_FROM_TEXT,
  WIDENING_NEEDS,
  WITHOUT_THE_FLAG,
  WITH_THE_FLAG,
  flagIsForbidden,
  forbiddenFlags,
  onASourceChange,
} from "../src/grammar/flags.ts";
import { closedSets } from "../src/enums/all-sets.ts";

test("CT-100-270: the protocol integer is 1 and `--protocol` prints it alone", () => {
  assert.equal(ANNEX_SECTION, "annex G, §G.1");
  assert.equal(PROTOCOL, 1);
  assert.equal(PROTOCOL, (cliProtocol as { protocol: number }).protocol);
  assert.equal(PROTOCOL_FLAG, "--protocol");
  assert.equal(PROTOCOL_EXIT_CODE, 0);
  assert.equal(PROTOCOL_PRINTS_NOTHING_ELSE, true);

  // The handler feature 119 mounts: the integer, and nothing else, exit 0.
  const outcome = protocolHandler();
  assert.deepEqual([...outcome.stdout], ["1"]);
  assert.deepEqual([...outcome.stderr], []);
  assert.equal(outcome.exitCode, 0);
});

test("CT-100-270: a host package compares the integer and refuses a mismatch in one line", () => {
  assert.equal(compareProtocol(1, { from: 1, to: 1 }).ok, true);
  const refused = compareProtocol(2, { from: 1, to: 1 });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.exitCode, 4);
    assert.equal(refused.line.split("\n").length, 1, "one line");
    assert.ok(refused.line.startsWith(MISMATCH_LINE));
    assert.match(refused.line, new RegExp(MISMATCH_NAMES_THE_COMMAND));
  }
  assert.equal(MISMATCH_EXIT_CODE, 4);
  assert.equal(MISMATCH_LINE, "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch");
});

test("CT-100-270: the rule that raises the integer (F100-FR-170)", () => {
  assert.equal(RAISES_THE_INTEGER.length, 8);
  for (const subject of ["command", "flag", "line", "json-field"] as const) {
    assert.equal(raisesTheInteger({ subject, kind: "removed" }), true, subject);
    assert.equal(raisesTheInteger({ subject, kind: "renamed" }), true, subject);
    assert.equal(raisesTheInteger({ subject, kind: "added" }), false, subject);
  }
  assert.equal(protocolAfter([{ subject: "flag", kind: "added" }]), 1);
  assert.equal(protocolAfter([{ subject: "flag", kind: "removed" }]), 2);
  assert.equal(
    protocolAfter([
      { subject: "json-field", kind: "added" },
      { subject: "line", kind: "renamed" },
    ]),
    2,
  );
});

test("CT-100-270: the commands of protocol 1 with their owners, as data", () => {
  const raw = (cliProtocol as { commands: unknown[] }).commands;
  assert.equal(commandRows.length, raw.length);
  assert.equal(commandRows.length, 21, "the 21 rows of the table of §G.1");
  assert.deepEqual(loadCommands(), commandRows);
  for (const row of commandRows) {
    assert.notEqual(row.cell, "");
    assert.notEqual(row.whatItDoes, "");
    assert.notEqual(row.owner, "", row.cell);
    assert.match(row.ownerFeature, /^\d{3}$/, row.cell);
    assert.equal(row.verbs.length > 0, !row.spellingIsTheOwners, row.cell);
  }
  // §G.1 leaves the spelling of exactly one row to its owner: the
  // launch-contract commands. Its four acts are named, its verbs are not.
  assert.equal(ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES.length, 1);
  assert.match(
    ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES[0]?.cell ?? "",
    /^The launch-contract commands/,
  );
  assert.equal(ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES[0]?.ownerFeature, OWNER_OF_THAT_ROW);
  assert.match(
    ROWS_WHOSE_SPELLING_THE_OWNER_DECIDES[0]?.whatItDoes ?? "",
    /The spelling of the commands is the owner's/,
  );
  assert.deepEqual(
    [...ACTS_WHOSE_SPELLING_THE_OWNER_DECIDES],
    ["derive", "validate", "promote", "render"],
  );
  assert.equal(ROWS_WITH_VERBS.length, commandRows.length - 1);
  // The owner of a few commands, as the table names it.
  assert.equal(ownerOf("--protocol"), "100");
  assert.match(String(ownerOf("launch")), /^107/);
  assert.match(String(ownerOf("resume")), /^102/);
  assert.match(String(ownerOf("tripwire clear")), /^115/);
  assert.equal(commandRow("a verb the table does not hold"), undefined);
  assert.equal(isCommand("doctor"), true);
  assert.equal(isCommand("nonsense"), false);
  assert.equal(UNKNOWN_VERB_EXIT_CODE, 1);
  // Row 157 of annex X §X.6 takes its members from the commands of §G.1.
  assert.equal(CLOSED_SET_ROW, 157);
  const row157 = closedSets.get(157);
  assert.notEqual(row157, undefined);
  assert.equal(row157?.name, "Verbs of the front door");
  assert.deepEqual([...(row157?.members ?? [])], [...COMMANDS]);
});

test("CT-100-271: exactly three module entry points of the baseline are commands", () => {
  assert.deepEqual([...PUBLIC_BASELINE_COMMANDS], ["spec", "verify", "learn"]);
  for (const command of PUBLIC_BASELINE_COMMANDS) {
    assert.equal(isCommand(command), true, command);
    assert.ok((PUBLIC_BASELINE_CODES[command] ?? []).includes(0), command);
  }
  // The codes of §G.4 of each of the three.
  assert.deepEqual([...PUBLIC_BASELINE_CODES["spec"]], [0, 1, 2, 3]);
  assert.deepEqual([...PUBLIC_BASELINE_CODES["verify"]], [0, 3, 10, 11]);
  assert.deepEqual([...PUBLIC_BASELINE_CODES["learn"]], [0, 1, 2, 3, 4]);
  // The pass loop and the critic are no commands.
  assert.deepEqual([...NOT_COMMANDS], ["the pass loop", "the critic"]);
  for (const name of ["pass-loop", "pass loop", "critic"]) {
    assert.equal(isCommand(name), false, name);
  }
});

test("CT-100-272: the shape of `--json` output (F100-FR-172)", () => {
  assert.equal(JSON_FLAG, "--json");
  assert.equal(VERBOSE_FLAG, "--verbose");
  assert.deepEqual([...OPT_IN_FLAGS], ["--json", "--verbose"]);
  assert.equal(NEVER_IN_JSON_OUTPUT.length, 4);

  // One record with a `schema` field, in a stable order of keys.
  const ok = checkJsonRecord({ schema: "specstride.view/1", run: "r-1", st: "running" }, [
    "schema",
    "run",
    "st",
  ]);
  assert.equal(ok.ok, true);
  // A list is no record.
  const list = checkJsonRecord([{ schema: "x" }]);
  assert.equal(list.ok, false);
  if (!list.ok) assert.equal(list.reason, "not-a-record");
  // A record without `schema` is refused.
  const bare = checkJsonRecord({ run: "r-1" });
  assert.equal(bare.ok, false);
  if (!bare.ok) assert.equal(bare.reason, "no-schema-field");
  // Keys out of the declared order are refused.
  const shuffled = checkJsonRecord({ st: "running", schema: "s", run: "r" }, [
    "schema",
    "run",
    "st",
  ]);
  assert.equal(shuffled.ok, false);
  if (!shuffled.ok) assert.equal(shuffled.reason, "keys-out-of-order");
  // Every command of the table that prints facts offers `--json`; the table
  // names the flag on the rows whose owner specifies the output.
  assert.ok(
    commandRows.some((row) => row.whatItDoes.includes("`--json`")),
    "the table names `--json`",
  );
});

test("CT-100-273: `--accept-source-change` of `resume` and what it does (F100-FR-173)", () => {
  assert.equal(ACCEPT_SOURCE_CHANGE, "--accept-source-change");
  assert.equal(ACCEPT_SOURCE_CHANGE_COMMAND, "resume");
  assert.equal(ACCEPT_SOURCE_CHANGE_IS_DECLARED, true, "the table of §G.1 names the flag");
  assert.ok(
    FLAGS_OF_THE_ANNEX.some(
      (f) => f.flag === ACCEPT_SOURCE_CHANGE && f.command === ACCEPT_SOURCE_CHANGE_COMMAND,
    ),
  );
  assert.deepEqual([...SOURCES], ["spec", "plan", "tasks"]);

  // WITH the flag: the plan and the manifest derived again, the new hashes in
  // the run snapshot, the counts and the evidence kept, an event every critic
  // receives as a fact.
  const accepted = onASourceChange({
    changed: [{ source: "plan", path: "specs/100-specstride/plan.md" }],
    flagGiven: true,
  });
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) {
    assert.deepEqual([...accepted.derivedAgain], ["verification-plan", "check-manifest"]);
    assert.equal(accepted.hashesRecordedIn, "run:<runId>:snapshot");
    assert.equal(accepted.countsKept, true);
    assert.equal(accepted.evidenceOfDeliveredPhasesKept, true);
    assert.equal(accepted.event.reachesEveryCriticAsAFact, true);
    assert.deepEqual([...accepted.event.files], ["specs/100-specstride/plan.md"]);
  }
  assert.equal(WITH_THE_FLAG.derivesTheVerificationPlanAgain, true);
  assert.equal(WITH_THE_FLAG.derivesTheCheckManifestAgain, true);
  assert.equal(WITH_THE_FLAG.keepsTheCounts, true);
  assert.equal(WITH_THE_FLAG.keepsThePhaseEvidenceOfDeliveredPhases, true);
  assert.equal(WITH_THE_FLAG.eventReachesEveryCriticOfTheRunAsAFact, true);

  // WITHOUT the flag: exit 3, and the changed file is named.
  const refused = onASourceChange({
    changed: [{ source: "tasks", path: "specs/100-specstride/tasks.md" }],
    flagGiven: false,
  });
  assert.equal(refused.accepted, false);
  if (!refused.accepted) {
    assert.equal(refused.exitCode, 3);
    assert.match(refused.message, /specs\/100-specstride\/tasks\.md/);
    assert.match(refused.message, /--accept-source-change/);
  }
  assert.equal(WITHOUT_THE_FLAG.exitCode, 3);
  assert.equal(WITHOUT_THE_FLAG.namesTheChangedFile, true);
  assert.equal(FLAGS_PARITY_ROW, 15);
});

test("CT-100-274: no command has a flag that switches off an enforcement (F100-FR-174)", () => {
  assert.deepEqual(
    [...ENFORCEMENTS_NO_FLAG_SWITCHES_OFF],
    ["a launch check", "the terms gate", "a budget cap"],
  );
  // The static test of the flags of every command: the flags of §G.1 hold none
  // that would switch off one of the three.
  assert.deepEqual([...forbiddenFlags(FLAGS_OF_THE_ANNEX)], []);
  // A flag that would is reported, with the command and the enforcement.
  const bad = forbiddenFlags([
    { command: "launch", flag: "--no-checks", what: "skips the launch checks" },
    { command: "run", flag: "--skip-terms", what: "skips the terms gate" },
    { command: "run", flag: "--no-budget", what: "lifts the budget cap" },
  ]);
  assert.equal(bad.length, 3);
  assert.deepEqual(
    bad.map((b) => b.enforcement),
    ["a launch check", "the terms gate", "a budget cap"],
  );
  for (const hit of bad) assert.match(hit.message, /F100-FR-174/);
  assert.equal(flagIsForbidden("--no-checks"), true);
  assert.equal(flagIsForbidden("--accept-source-change"), false);
  assert.equal(flagIsForbidden("--json"), false);

  assert.equal(THE_COMMENT_ONLY_SELECTS_AMONG_ACCEPTED_OPTIONS, true);
  assert.deepEqual([...WIDENING_NEEDS], ["a flag", "a configuration key set by the consumer"]);
  assert.equal(WIDENING_IS_INFERRED_FROM_TEXT, false);
});
