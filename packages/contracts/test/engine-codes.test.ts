/**
 * T084 — contract tests CT-100-253 and CT-100-254 for the exit codes and the
 * result records of the engine (annex E, §E.4; F100-FR-153, F100-FR-154).
 *
 * The tests bind T085 and T271 to the five sub-tables of the key `engine` of
 * `data/exit-codes.json` and to row 19 of `data/closed-sets.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import exitCodes from "../data/exit-codes.json" with { type: "json" };
import { closedSets } from "../src/enums/all-sets.ts";
import { closedSetRows } from "../src/enums/index.ts";
import {
  ANNEX_SECTION,
  ENGINE_EXIT_CODES,
  MAPPING_APPLIES_ONLY_WHEN_PHASE_EVIDENCE_IS_ABSENT,
  PASS_LOOP_RESULT_TO_ENGINE_CODE,
  TERMINATION_CODES,
  TERMINATION_NAMES,
  UNCAUGHT_ERROR_CODE,
  UNCAUGHT_ERROR_IS_A_TERMINATION,
  codeOfEveryHaltIsUnique,
  engineCodeFor,
  engineExitRow,
  engineExitRows,
  engineExitCodeSet,
  engineTable,
  isEngineExitCode,
  isTerminationCode,
  stopReasonsOf,
  terminationNameOf,
} from "../src/codes/engine.ts";
import {
  COMPATIBILITY_PRINTS_THE_SAME_NUMBER,
  ENGINE_EXECUTABLE,
  ENGINE_TABLE_NAMES,
  LOCK_HELD_EXIT_IS_STANDALONE_ONLY,
  PASS_LOOP_EXIT_CODES,
  PASS_LOOP_SOURCE_CHANGED,
  PASS_STATUS_CODES,
  RESULT_RECORD_TABLES,
  START_MODES,
  START_MODE_FACTS,
  VERIFICATION_FAILURE_SUMMARY_CODES,
  VERIFICATION_GATE_EXIT_CODES,
  criticCallRows,
  criticResultOf,
  internalHelperCodes,
  internalHelperRows,
  passLoopRows,
  pinsTheExecutable,
  startModeFacts,
  startModeSet,
  verificationGateRows,
  type CriticCallResultRecord,
  type InternalHelperResultRecord,
  type PassLoopResultRecord,
  type VerificationGateResultRecord,
} from "../src/codes/result-records.ts";
import { STOP_REASONS, isStopReason } from "../src/codes/stop-reasons.ts";
import { loadProfile } from "../src/profile/parity.ts";
import { requiredOf } from "./samples.ts";

const RAW = (exitCodes as { engine: { process: string; rows: Record<string, string>[] }[] }).engine;

test("CT-100-253: the key `engine` holds the five sub-tables of §E.4", () => {
  assert.equal(ANNEX_SECTION, 'annex E, §E.4, "Engine"');
  assert.equal(RAW.length, 5);
  assert.equal(ENGINE_TABLE_NAMES.length, 5);
  assert.equal(ENGINE_TABLE_NAMES[0], "Engine");
  assert.deepEqual([...ENGINE_TABLE_NAMES].slice(1), [...RESULT_RECORD_TABLES]);
  for (const name of ENGINE_TABLE_NAMES) {
    assert.ok(engineTable(name).rows.length > 0, `${name} has rows`);
  }
  assert.throws(() => engineTable("Invented"), /holds no entry/);
});

test("CT-100-253: the engine exits with exactly the codes of the table Engine", () => {
  const raw = engineTable("Engine").rows as unknown as { Code: string }[];
  assert.deepEqual(
    engineExitRows.map((r) => String(r.code)),
    raw.map((r) => r.Code),
  );
  assert.deepEqual([...ENGINE_EXIT_CODES], [0, 1, 2, 3, 4, 5, 6, 70]);
  for (const code of ENGINE_EXIT_CODES) assert.ok(isEngineExitCode(code), String(code));
  assert.equal(isEngineExitCode(7), false);
  assert.equal(isEngineExitCode(22), false);
  // Every cause of a halt maps to exactly one code: no code twice.
  assert.equal(codeOfEveryHaltIsUnique(), true);

  // The column "Stop reasons" of each row names members of §E.3 and nothing
  // else, and every member of §E.3 appears in exactly one row.
  const named: string[] = [];
  for (const row of engineExitRows) {
    for (const literal of row.stopReasons) {
      assert.ok(isStopReason(literal), `${row.code}: \`${literal}\``);
      named.push(literal);
    }
    assert.equal(row.stopReasons.length === 0, row.noMember, `${row.code}: — means no member`);
  }
  assert.equal(new Set(named).size, named.length, "no member appears in two rows");
  assert.deepEqual([...named].sort(), [...STOP_REASONS].sort());
  assert.deepEqual([...stopReasonsOf(6)], ["stop_flag"]);
  assert.deepEqual([...stopReasonsOf(0)], []);
  assert.equal(engineExitRow(99), undefined);

  // Row 6 of §X.6 holds the eight codes, registered through T070.
  assert.equal(engineExitCodeSet.number, 6);
  assert.deepEqual(
    [...engineExitCodeSet.members],
    ENGINE_EXIT_CODES.map((c) => String(c)),
  );
  assert.deepEqual(
    [...(closedSets.get(6)?.members ?? [])],
    ENGINE_EXIT_CODES.map((c) => String(c)),
  );
});

test("CT-100-253: the seven codes 0 to 6 are the terminations; 70 is not", () => {
  assert.deepEqual([...TERMINATION_CODES], [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    [...TERMINATION_NAMES],
    ["done", "internal", "rejects", "spec", "budget", "lock", "stop"],
  );
  assert.equal(TERMINATION_NAMES.length, 7);
  assert.equal(TERMINATION_CODES.length, 7);
  for (const code of TERMINATION_CODES) {
    assert.ok(isTerminationCode(code), String(code));
    assert.notEqual(terminationNameOf(code), undefined, String(code));
    assert.equal(engineExitRow(code)?.termination, true);
  }
  assert.equal(UNCAUGHT_ERROR_CODE, 70);
  assert.equal(UNCAUGHT_ERROR_IS_A_TERMINATION, false);
  assert.equal(isTerminationCode(70), false);
  assert.equal(terminationNameOf(70), undefined);
  assert.equal(engineExitRow(70)?.termination, false);
});

test("CT-100-253: the mapping from the pass loop applies only without phase evidence", () => {
  assert.equal(MAPPING_APPLIES_ONLY_WHEN_PHASE_EVIDENCE_IS_ABSENT, true);
  // The results the annex names for code 4: 4, 7, 8, 9, 10.
  for (const result of [4, 7, 8, 9, 10]) {
    assert.equal(PASS_LOOP_RESULT_TO_ENGINE_CODE[result], 4, `the result ${result} maps to 4`);
    assert.equal(engineCodeFor({ exitCode: result, phaseEvidence: false }), 4);
  }
  assert.equal(engineCodeFor({ exitCode: 0, phaseEvidence: false }), 0);
  assert.equal(engineCodeFor({ exitCode: 3, phaseEvidence: false }), 3);
  assert.equal(engineCodeFor({ exitCode: 6, phaseEvidence: false }), 6);
  // With phase evidence present, every result except 6 is ignored.
  for (const result of [0, 1, 3, 4, 7, 8, 9, 10]) {
    assert.equal(
      engineCodeFor({ exitCode: result, phaseEvidence: true }),
      undefined,
      `the result ${result} is ignored with phase evidence`,
    );
  }
  assert.equal(engineCodeFor({ exitCode: 6, phaseEvidence: true }), 6);
  // A result with no mapping ends with 1 (`proposer_no_evidence`).
  assert.equal(engineCodeFor({ exitCode: 99, phaseEvidence: false }), 1);
  assert.ok((stopReasonsOf(1) as readonly string[]).includes("proposer_no_evidence"));
});

test("CT-100-253: the result records of the four inner tables carry their numbers", () => {
  assert.equal(COMPATIBILITY_PRINTS_THE_SAME_NUMBER, true);

  // Pass loop.
  const rawPassLoop = engineTable(RESULT_RECORD_TABLES[0]).rows;
  assert.equal(passLoopRows.length, rawPassLoop.length);
  assert.deepEqual(
    passLoopRows.map((r) => r.cell),
    rawPassLoop.map((r) => r["`exit_code`"]),
  );
  assert.deepEqual([...PASS_LOOP_EXIT_CODES], [0, 1, 3, 4, 6, 7, 8, 9, 10, 130, 143]);
  assert.deepEqual([...PASS_STATUS_CODES], [124, 127]);
  const passLoop: PassLoopResultRecord = { exit_code: 7 };
  assert.ok(PASS_LOOP_EXIT_CODES.includes(passLoop.exit_code));
  assert.equal(PASS_LOOP_SOURCE_CHANGED.exit_code, 3);
  assert.equal(PASS_LOOP_SOURCE_CHANGED.blocked, "source-changed");
  assert.match(String(passLoopRows.find((r) => r.cell === "3")?.meaning), /source changed/);

  // Critic call.
  const rawCritic = engineTable(RESULT_RECORD_TABLES[1]).rows;
  assert.equal(criticCallRows.length, rawCritic.length);
  assert.deepEqual(
    criticCallRows.map((r) => r.exitCode),
    [0, 1, 2, 3, 10],
  );
  assert.deepEqual([...(criticResultOf(0) ?? [])], ["approved"]);
  assert.deepEqual([...(criticResultOf(10) ?? [])], ["rejected", "malformed"]);
  assert.equal(criticResultOf(99), undefined);
  const critic: CriticCallResultRecord = { exit_code: 3, result: "config_error" };
  assert.ok((criticResultOf(critic.exit_code) ?? []).includes(critic.result));

  // Verification gate.
  const rawGate = engineTable(RESULT_RECORD_TABLES[2]).rows;
  assert.equal(verificationGateRows.length, rawGate.length);
  assert.deepEqual([...VERIFICATION_GATE_EXIT_CODES], [0, 3, 10, 11]);
  assert.deepEqual([...VERIFICATION_FAILURE_SUMMARY_CODES], [0, 2]);
  const gate: VerificationGateResultRecord = { exit_code: 10 };
  assert.ok(VERIFICATION_GATE_EXIT_CODES.includes(gate.exit_code));
  assert.match(String(verificationGateRows.find((r) => r.exitCode === 10)?.meaning), /gate failed/);

  // Internal helpers.
  const rawHelpers = engineTable(RESULT_RECORD_TABLES[3]).rows;
  assert.equal(internalHelperRows.length, rawHelpers.length);
  assert.deepEqual([...(internalHelperCodes("Overlay handling") ?? [])], [0, 1, 3]);
  assert.deepEqual([...(internalHelperCodes("Plugin requests of one harness") ?? [])], [0, 2]);
  const never = internalHelperRows.find((r) => r.neverBreaksTheLoop);
  assert.notEqual(never, undefined);
  assert.deepEqual([...(never?.codes ?? [])], [0]);
  assert.equal(internalHelperCodes("Invented"), undefined);
  const helper: InternalHelperResultRecord = { exit_code: 0 };
  assert.equal(helper.exit_code, 0);
});

test("CT-100-254: the two start modes, and what each one does", () => {
  assert.deepEqual([...START_MODES], ["standalone", "child"]);
  // Row 19 of §X.6 holds the same two.
  assert.equal(startModeSet.number, 19);
  assert.deepEqual([...startModeSet.members], [...START_MODES]);
  assert.deepEqual([...(closedSets.get(19)?.members ?? [])], [...START_MODES]);
  assert.match(String(closedSetRows.find((r) => r.number === 19)?.unknownValue), /refused/i);

  // `standalone`: the lock, the lease, the run record, the transitions.
  const standalone = START_MODE_FACTS.standalone;
  assert.equal(standalone.takesTheWorkspaceLock, true);
  assert.equal(standalone.writesTheLease, true);
  assert.equal(standalone.writesTheRunRecord, true);
  assert.equal(standalone.ownsTheTransitionsOfTheRoot, true);
  assert.equal(standalone.verifiesTheLeaseHandedDown, false);

  // `child`: verify the lease handed down, never take a lock.
  const child = START_MODE_FACTS.child;
  assert.equal(child.takesTheWorkspaceLock, false);
  assert.equal(child.verifiesTheLeaseHandedDown, true);
  assert.equal(child.writesTheLease, false);
  assert.equal(child.writesTheRunRecord, false);
  assert.equal(child.ownsTheTransitionsOfTheRoot, false);

  assert.equal(startModeFacts("standalone"), standalone);
  assert.equal(startModeFacts("child"), child);
  assert.equal(startModeFacts("invented"), undefined);

  // The engine code 5 is the lock, and only in `standalone` (§E.4).
  assert.equal(LOCK_HELD_EXIT_IS_STANDALONE_ONLY, true);
  assert.match(String(engineExitRow(5)?.meaning), /start mode `standalone`/);

  // The run record carries the start mode as a required field (annex E §E.2).
  assert.ok(requiredOf("specstride.run-state/1").includes("startMode"));
});

test("CT-100-254: the engine executable is pinned by path and hash in the launch record", () => {
  assert.equal(ENGINE_EXECUTABLE.resolvedAt, "launch");
  assert.deepEqual([...ENGINE_EXECUTABLE.pinnedBy], ["path", "hash"]);
  assert.equal(ENGINE_EXECUTABLE.pinnedIn, "launch record");
  assert.equal(ENGINE_EXECUTABLE.launchRecordField, "engineExecutable");
  assert.equal(ENGINE_EXECUTABLE.configurationKey, "engine.executable");
  assert.equal(ENGINE_EXECUTABLE.configurationDefault, "the product's own entry");

  // The field is required of the launch record (annex B §B.7).
  assert.ok(requiredOf("specstride.launch/1").includes("engineExecutable"));

  // The configuration key is the switch of row 41 of the profile (§X.7).
  const row41 = loadProfile().find((row) => row.number === 41);
  assert.notEqual(row41, undefined);
  assert.ok([...(row41?.keys ?? [])].includes(ENGINE_EXECUTABLE.configurationKey));
  assert.match(String(row41?.default), /product's own entry/);

  // A pin holds both a path and a hash.
  assert.ok(pinsTheExecutable({ path: "/usr/bin/specstride", hash: "sha256-…" }));
  assert.equal(pinsTheExecutable({ path: "/usr/bin/specstride" }), false);
  assert.equal(pinsTheExecutable({ hash: "sha256-…" }), false);
  assert.equal(pinsTheExecutable(undefined), false);
});
