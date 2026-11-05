/**
 * T181 — contract tests CT-100-255, CT-100-256, CT-100-257 and CT-100-258 for
 * the process model (annex F, §F.1; F100-FR-155 to F100-FR-158).
 *
 * The table is read from the key `processes` of `data/process-model.json` and
 * the class of every registered process is the closed set of §B.10 that T044
 * exports.
 */
import test from "node:test";
import assert from "node:assert/strict";
import processModelData from "../data/process-model.json" with { type: "json" };
import {
  ADOPTABLE_ROWS,
  ANNEX_SECTION,
  A_CHILD_TAKES_A_SECOND_LOCK,
  A_RUN_NEVER_DEPENDS_ON,
  AN_EDITED_LAUNCHER_IS_REFUSED,
  DATA_KEY,
  ENGINE_CODES,
  FOREGROUND_RUN_ON_A_HELD_WORKSPACE,
  F100_FR_155_STATUS,
  HANDED_DOWN_TO_THE_ENGINE_AS,
  LAUNCHER_CALLS,
  LOCK_SCOPE,
  LOCK_TAKEN_BY,
  NEVER_AFTER_THE_HANDSHAKE,
  NO_CLASS_CELL,
  ONE_RUNTIME_ROOT_PER_LAUNCH,
  ON_A_CRASH_OF_THE_ENGINE,
  ON_A_DEAD_RUNTIME_ROOT,
  PROCESS_CLASSES,
  REGISTERED_ROWS,
  SECOND_PIPELINE_ON_A_HELD_WORKSPACE,
  THE_ENGINE_IS_A_CHILD_OF_THE_ROOT,
  VERIFIED_AT,
  VERIFIED_HASHES,
  engineCrashed,
  exitCodeOnAHeldWorkspace,
  loadProcessModel,
  processModelRows,
  processRow,
  registryClassOf,
  resumeRefusesWithSurvivors,
} from "../src/state/process-model.ts";
import { PROCESS_CLASSES as CLASSES_OF_B10 } from "../src/records/process-registry.ts";

test("CT-100-255: the eight processes of §F.1 with their class in the registry", () => {
  assert.equal(ANNEX_SECTION, "annex F, §F.1");
  assert.equal(DATA_KEY, "processes");
  const raw = (processModelData as { processes: unknown[] }).processes;
  assert.equal(processModelRows.length, raw.length);
  assert.equal(processModelRows.length, 8, "the eight rows of the table of §F.1");
  assert.deepEqual(loadProcessModel(), processModelRows);

  // Every row has its cells, and its class is a member of the closed set of
  // §B.10 or `null` where the cell is the dash.
  assert.deepEqual([...PROCESS_CLASSES], [...CLASSES_OF_B10]);
  for (const row of processModelRows) {
    assert.notEqual(row.process, "");
    assert.notEqual(row.startedBy, "");
    assert.notEqual(row.lifetime, "");
    if (row.registryClass !== null) {
      assert.ok((PROCESS_CLASSES as readonly string[]).includes(row.registryClass), row.process);
    }
  }

  // The two rows that have no class: the CLI command and the runtime root.
  assert.equal(registryClassOf("CLI command"), null);
  assert.equal(registryClassOf("Runtime root"), null);
  assert.equal(NO_CLASS_CELL, "—");
  // The six rows the registry holds, and the one that is `adoptable`.
  assert.equal(REGISTERED_ROWS.length, 6);
  assert.equal(ADOPTABLE_ROWS.length, 1);
  assert.match(ADOPTABLE_ROWS[0]?.process ?? "", /^Detached job of a yield/);
  assert.equal(registryClassOf("Detached job of a yield"), "adoptable");
  for (const name of [
    "Stage child",
    "Engine (stage kind",
    "Harness process",
    "Check command",
    "Worker pass of a parallel group",
  ]) {
    assert.equal(registryClassOf(name), "owned", name);
  }
  // The row of a process the table does not hold.
  assert.equal(processRow("A process the table does not hold"), undefined);
  assert.equal(registryClassOf("A process the table does not hold"), undefined);
});

test("CT-100-255: F100-FR-155 — a run is a detached tree of processes", () => {
  assert.equal(ONE_RUNTIME_ROOT_PER_LAUNCH, true);
  assert.equal(THE_ENGINE_IS_A_CHILD_OF_THE_ROOT, true);
  assert.deepEqual(
    [...NEVER_AFTER_THE_HANDSHAKE],
    ["a pipe", "a socket the host must keep", "a parent that waits"],
  );
  assert.deepEqual([...A_RUN_NEVER_DEPENDS_ON], ["a host hook", "a monitor", "a host process"]);
  // The requirement carries a `status` of `unverified` until the spike runs.
  assert.equal(F100_FR_155_STATUS, "unverified");
  // The runtime root is the leader of a process session of its own (§F.1).
  assert.match(processRow("Runtime root")?.lifetime ?? "", /process session of its own/);
  // The engine is started by the runtime root, or by the consumer in the
  // foreground, and one runs at a time per workspace.
  const engine = processRow("Engine (stage kind");
  assert.match(engine?.startedBy ?? "", /Runtime root/);
  assert.match(engine?.lifetime ?? "", /one at a time per workspace/);
});

test("CT-100-256: F100-FR-156 — one lock per workspace, handed down as a lease", () => {
  assert.equal(LOCK_SCOPE, "workspace");
  assert.equal(LOCK_TAKEN_BY, "the runtime root");
  assert.equal(HANDED_DOWN_TO_THE_ENGINE_AS, "a lease");
  assert.equal(A_CHILD_TAKES_A_SECOND_LOCK, false);
  assert.equal(SECOND_PIPELINE_ON_A_HELD_WORKSPACE, 24);
  assert.equal(FOREGROUND_RUN_ON_A_HELD_WORKSPACE, 5);
  assert.equal(exitCodeOnAHeldWorkspace("pipeline"), 24);
  assert.equal(exitCodeOnAHeldWorkspace("foreground-run"), 5);
});

test("CT-100-257: F100-FR-157 — the launcher and the two hashes", () => {
  assert.equal(LAUNCHER_CALLS, "the pipeline entry with the hash of the launch bundle");
  assert.deepEqual([...VERIFIED_HASHES], ["the launch bundle", "the launcher itself"]);
  assert.deepEqual([...VERIFIED_AT], ["launch", "every relaunch"]);
  assert.equal(AN_EDITED_LAUNCHER_IS_REFUSED, true);
});

test("CT-100-258: F100-FR-158 — a crash of the engine and a dead runtime root", () => {
  assert.deepEqual([...ENGINE_CODES], [0, 1, 2, 3, 4, 5, 6]);
  // A code inside 0 to 6 is no crash.
  for (const code of ENGINE_CODES) {
    assert.equal(engineCrashed({ code }), false, String(code));
  }
  // A code outside it, or a signal, is a crash.
  assert.equal(engineCrashed({ code: 7 }), true);
  assert.equal(engineCrashed({ code: 70 }), true);
  assert.equal(engineCrashed({ code: null, signal: "SIGKILL" }), true);
  assert.equal(engineCrashed({ code: 0, signal: "SIGTERM" }), true);
  assert.equal(engineCrashed({}), true, "no code and no signal is read as a crash");

  assert.equal(ON_A_CRASH_OF_THE_ENGINE.writesASynthesizedTerminalRecord, true);
  assert.equal(ON_A_CRASH_OF_THE_ENGINE.cause, "crash");
  assert.equal(ON_A_CRASH_OF_THE_ENGINE.endsEveryOwnedProcess, true);
  assert.equal(ON_A_CRASH_OF_THE_ENGINE.consultsTheRelaunchClassifier, true);

  assert.equal(ON_A_DEAD_RUNTIME_ROOT.relaunchesByItselfInWave1, false);
  assert.equal(ON_A_DEAD_RUNTIME_ROOT.theRunReadsAs, "dead");
  assert.equal(ON_A_DEAD_RUNTIME_ROOT.resumeReclaimsTheLock, true);
  assert.equal(ON_A_DEAD_RUNTIME_ROOT.resumeClosesTheDeadLaunchWith, "a synthesized end event");
  assert.equal(
    ON_A_DEAD_RUNTIME_ROOT.resumeContinuesAt,
    "the first phase without a valid approval record",
  );

  // The owner is dead and an `owned` group is alive: `resume` refuses and names
  // the survivors.
  const refused = resumeRefusesWithSurvivors({ ownerDead: true, ownedGroupAlive: ["4711"] });
  assert.equal(refused.refused, true);
  assert.deepEqual([...refused.survivors], ["4711"]);
  assert.equal(resumeRefusesWithSurvivors({ ownerDead: true, ownedGroupAlive: [] }).refused, false);
  assert.equal(
    resumeRefusesWithSurvivors({ ownerDead: false, ownedGroupAlive: ["4711"] }).refused,
    false,
  );
});
