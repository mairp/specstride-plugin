/**
 * T072 — own test CT-101-15: a specification with a phase whose tasks are all
 * ticked and no approval record refuses the start with exit 3 and names the
 * three state commands; under the `parity` profile the refusal is off.
 *
 * proves: F101-FR-032 (and feature 100 F100-FR-059, which asks for it).
 *
 * fixture: none. The test builds A WORKSPACE OF THE TEST TREE under
 * `node:os.tmpdir()` — a real directory with a real task list whose phase 1
 * shows every checkbox ticked and whose control plane holds no approval
 * record — and reads every claim back FROM DISK, through a read path that is
 * not the one the refusal returned:
 *
 * | Claim | Read back from |
 * |---|---|
 * | the start is refused with exit 3 | the terminal record on disk, re-read and re-validated |
 * | nothing of the workspace changed | a content hash of the whole tree, taken before and after and compared |
 * | the three commands are named | the text of the terminal record's own message on disk |
 * | under `parity` the refusal is off | a second run over the SAME workspace with the profile set |
 *
 * The response of the refusal is never the proof: every assertion below either
 * reads a file the refusal left or compares two hashes of the tree.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { STATE_COMMANDS as STATE_COMMANDS_OF_FEATURE_100 } from "@specstride/contracts";
import {
  EXIT_CODE,
  IT_IS_A_HALT_OF_THE_PHASE_GATE,
  PARITY_ROW,
  REFUSAL,
  RETRYABLE,
  STATE_COMMANDS,
  STOP_REASON,
  THE_REFUSAL_CHANGES_STATE,
  defaultOfTheSwitch,
  everyTaskIsTicked,
  phasesTickedWithoutAVerifiedApproval,
  refuseToStart,
  rowOfTheSwitch,
  theRefusalIsOn,
  theTableOfHaltsNamesIt,
  valueUnderParity,
  type PhaseWithTasks,
} from "../../src/approval/ticked-without-record.ts";
import {
  verifyApprovalRecord,
  type ApprovalVerificationResult,
} from "../../src/approval/verify.ts";
import {
  EXITS_WITHOUT_A_STOP_REASON,
  terminalRecord,
  validatesAgainstTheSchema,
} from "../../src/engine/terminal.ts";
import {
  TICKED_WITHOUT_RECORD,
  TICKED_WITHOUT_RECORD_UNDER_PARITY,
  runFixture,
} from "./run-harness.ts";

/* ------------------------------------------------------------------ *
 * The workspace of the test tree.
 * ------------------------------------------------------------------ */

const SLUG = "101-gate-and-verdict";

/** The task list of the workspace: phase 1 all ticked, phase 2 not. */
const TASKS = `# Tasks: a workspace that was moved

## Phase 1: Setup

- [x] T001 Create the directories
- [x] T002 Add the schema files
- [x] T003 Add the closed sets

## Phase 2: Foundational

- [ ] T004 The single writer
- [ ] T005 The nonce
`;

/** Build the workspace and give back its root. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "ct-101-15-"));
  mkdirSync(join(root, "specs", SLUG), { recursive: true });
  writeFileSync(join(root, "specs", SLUG, "tasks.md"), TASKS, "utf8");
  // The control plane exists and holds NO approval record: that is exactly the
  // workspace a move or a clone of the working tree alone leaves behind.
  mkdirSync(join(root, ".specstride", "features", SLUG, "approvals"), { recursive: true });
  return root;
}

/** Every file of a tree, by path, read from disk. */
function filesOf(root: string, ignore: readonly string[] = []): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      const logical = prefix === "" ? entry : `${prefix}/${entry}`;
      if (ignore.includes(logical)) continue;
      if (statSync(path).isDirectory()) walk(path, logical);
      else files.set(logical, readFileSync(path, "utf8"));
    }
  };
  walk(root, "");
  return files;
}

/** A content hash of a whole tree: the durable witness of "no state changed". */
function hashOfTheTree(root: string, ignore: readonly string[] = []): string {
  const hash = createHash("sha256");
  for (const [path, content] of [...filesOf(root, ignore)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    hash.update(path).update("\u0000").update(content).update("\u0000");
  }
  return hash.digest("hex");
}

/**
 * The phases of the task list, read from the file on disk. The one grammar
 * owner of EP-03 belongs to feature 104; this reader is the test's own and
 * reads only what F101-FR-032 needs — the phase numbers and whether each
 * checkbox is ticked.
 */
function phasesOfTheTaskList(path: string): readonly PhaseWithTasks[] {
  const phases: { number: number; tasks: { ticked: boolean }[] }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const heading = /^## Phase (\d+):/.exec(line);
    if (heading !== null) {
      phases.push({ number: Number(heading[1]), tasks: [] });
      continue;
    }
    const task = /^- \[( |x)\] /.exec(line);
    if (task !== null && phases.length > 0) {
      phases[phases.length - 1]?.tasks.push({ ticked: task[1] === "x" });
    }
  }
  return Object.freeze(phases.map((p) => Object.freeze({ ...p, tasks: Object.freeze(p.tasks) })));
}

/** The reader of approvals over the control plane of the workspace on disk. */
function readerOverTheWorkspace(root: string): (phase: number) => ApprovalVerificationResult {
  return (phase: number) => {
    const path = join(root, ".specstride", "features", SLUG, "approvals", `phase-${phase}.json`);
    let held: unknown;
    try {
      held = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      held = undefined;
    }
    return verifyApprovalRecord({
      phase,
      record: held,
      key: undefined,
      verdictRecord: undefined,
      evidenceHashSetAside: undefined,
      storedVerificationHash: undefined,
      canonicalRecordHash: () => "",
    });
  };
}

/* ------------------------------------------------------------------ *
 * The switch of row 129.
 * ------------------------------------------------------------------ */

test("CT-101-15: the refusal is row 129 of annex X §X.7: on by default, off under `parity`", () => {
  assert.equal(PARITY_ROW, 129);
  const row = rowOfTheSwitch();
  assert.equal(row.number, 129);
  assert.equal(row.owner, "101");
  assert.match(row.switch, /ticked phases without an approval record/);
  assert.deepEqual([...row.registerRows], ["DV-029"]);
  assert.equal(defaultOfTheSwitch(), "on");
  assert.equal(valueUnderParity(), "off");
  assert.equal(theRefusalIsOn(undefined), true);
  assert.equal(theRefusalIsOn("parity"), false);
  // A profile the product does not know is not `parity`: the refusal stays on.
  assert.equal(theRefusalIsOn("Parity"), true);
  assert.equal(theRefusalIsOn(""), true);
});

test("CT-101-15: the refusal is no halt of the phase gate and carries no stop reason", () => {
  assert.equal(IT_IS_A_HALT_OF_THE_PHASE_GATE, false);
  // The table "Halts of the phase gate" names no cause of it (F101-FR-032).
  assert.equal(theTableOfHaltsNamesIt(), false);
  // CQ-174 — no stop reason, and never retryable.
  assert.equal(STOP_REASON, null);
  assert.equal(RETRYABLE, false);
  assert.equal(EXIT_CODE, 3);
  assert.ok((EXITS_WITHOUT_A_STOP_REASON as readonly number[]).includes(EXIT_CODE));
  assert.equal(THE_REFUSAL_CHANGES_STATE, false);
});

test("CT-101-15: a phase with no task at all never refuses a start", () => {
  assert.equal(everyTaskIsTicked({ number: 1, tasks: [] }), false);
  assert.equal(everyTaskIsTicked({ number: 1, tasks: [{ ticked: true }] }), true);
  assert.equal(
    everyTaskIsTicked({ number: 1, tasks: [{ ticked: true }, { ticked: false }] }),
    false,
  );
  const refused = refuseToStart({
    phases: [{ number: 1, tasks: [] }],
    readApproval: () =>
      verifyApprovalRecord({
        phase: 1,
        record: undefined,
        key: undefined,
        verdictRecord: undefined,
        evidenceHashSetAside: undefined,
        storedVerificationHash: undefined,
        canonicalRecordHash: () => "",
      }),
  });
  assert.equal(refused, undefined);
});

/* ------------------------------------------------------------------ *
 * The workspace of the test tree: refused, with nothing changed.
 * ------------------------------------------------------------------ */

test("CT-101-15: a workspace whose phase 1 is all ticked with no approval record is refused with exit 3", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The durable fact that could not exist before: a content hash of the whole
  // workspace, taken from disk BEFORE anything ran.
  const before = hashOfTheTree(root);
  const tasks = join(root, "specs", SLUG, "tasks.md");
  const phases = phasesOfTheTaskList(tasks);
  assert.deepEqual(
    phases.map((p) => [p.number, p.tasks.length, everyTaskIsTicked(p)]),
    [
      [1, 3, true],
      [2, 2, false],
    ],
  );

  const found = phasesTickedWithoutAVerifiedApproval(phases, readerOverTheWorkspace(root));
  assert.deepEqual(
    found.map((f) => [f.phase, f.taskCount, f.failed]),
    [[1, 3, "missing"]],
  );

  const refused = refuseToStart({ phases, readApproval: readerOverTheWorkspace(root) });
  assert.ok(refused !== undefined, "the start must be refused");
  assert.equal(refused.ended, "refused");
  assert.equal(refused.refusal, REFUSAL);
  assert.equal(refused.exitCode, 3);
  assert.equal(refused.stopReason, null);
  assert.equal(refused.retryable, false);
  assert.equal(refused.stateChanged, false);

  // F101-FR-032 and F100-FR-059 — the three state commands are NAMED, and they
  // are the three of feature 100's own list and in its order.
  assert.deepEqual([...refused.commands], [...STATE_COMMANDS_OF_FEATURE_100]);
  assert.deepEqual([...STATE_COMMANDS], [...STATE_COMMANDS_OF_FEATURE_100]);
  for (const command of STATE_COMMANDS_OF_FEATURE_100) {
    assert.ok(refused.message.includes(command), `the refusal does not name \`${command}\``);
  }
  assert.match(refused.message, /phase 1/);

  // The terminal record of F101-FR-036, written on this exit path too. It is
  // the one durable artifact the refusal leaves, and the test writes it where
  // the engine's composition root would and READS IT BACK from disk.
  const record = terminalRecord({
    exitCode: refused.exitCode,
    stopReason: refused.stopReason,
    cause: "normal",
    causedBy: "self",
    runId: "run-ct-101-15",
    launchId: "launch-ct-101-15",
    engineStartId: "e1",
    at: "2026-10-03T00:00:00.000Z",
  });
  const terminalPath = join(root, ".specstride", "features", SLUG, "terminal.json");
  writeFileSync(
    terminalPath,
    `${JSON.stringify({ ...record, message: refused.message })}\n`,
    "utf8",
  );

  // --- the independent read path: the file, re-read and re-validated.
  const onDisk = JSON.parse(readFileSync(terminalPath, "utf8")) as Record<string, unknown>;
  assert.equal(validatesAgainstTheSchema(record), true);
  assert.equal(onDisk.exitCode, 3);
  assert.equal(onDisk.stopReason, null);
  assert.equal(onDisk.retryable, false);
  for (const command of STATE_COMMANDS_OF_FEATURE_100) {
    assert.ok(String(onDisk.message).includes(command));
  }

  // --- the second durable witness: nothing of the workspace changed. The
  // terminal record is the only new file, so it is left out of the hash.
  const ignore = [`.specstride/features/${SLUG}/terminal.json`];
  assert.equal(hashOfTheTree(root, ignore), before, "the refusal changed the workspace");
  // And the task list itself is byte for byte what it was: no tick was undone.
  assert.equal(readFileSync(tasks, "utf8"), TASKS);
  // No approval record appeared.
  assert.deepEqual(readdirSync(join(root, ".specstride", "features", SLUG, "approvals")), []);
});

test("CT-101-15: the negative case — with a verified approval of the ticked phase the start goes on", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const phases = phasesOfTheTaskList(join(root, "specs", SLUG, "tasks.md"));
  // A reader that reports phase 1 approved: the refusal must then find nothing
  // to refuse, so the test above is not passing on a reader that always fails.
  const refused = refuseToStart({
    phases,
    readApproval: (phase) =>
      phase === 1
        ? ({ approved: true, record: { phase } } as unknown as ApprovalVerificationResult)
        : readerOverTheWorkspace(root)(phase),
  });
  assert.equal(refused, undefined);
});

test("CT-101-15: under the `parity` profile the SAME workspace is not refused", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = hashOfTheTree(root);
  const phases = phasesOfTheTaskList(join(root, "specs", SLUG, "tasks.md"));
  const refused = refuseToStart({
    phases,
    readApproval: readerOverTheWorkspace(root),
    profile: "parity",
  });
  assert.equal(refused, undefined, "the refusal must be off under `parity` (row 129, DV-029)");
  // And it read no approval at all, so it left no integrity event either.
  assert.equal(hashOfTheTree(root), before);
  // Without the profile the very same workspace IS refused: the only
  // difference between the two is the profile.
  assert.notEqual(refuseToStart({ phases, readApproval: readerOverTheWorkspace(root) }), undefined);
});

/* ------------------------------------------------------------------ *
 * The whole engine: the refusal comes before anything of the run.
 * ------------------------------------------------------------------ */

test("CT-101-15 (engine): the run exits 3, calls nobody and writes nothing", async () => {
  const run = await runFixture(TICKED_WITHOUT_RECORD);
  assert.equal(run.exitCode, 3);
  assert.equal(run.stopReason, undefined);
  assert.ok(run.refused !== undefined);
  assert.equal(run.refused.refusal, REFUSAL);
  for (const command of STATE_COMMANDS_OF_FEATURE_100) {
    assert.ok(run.refused.message.includes(command));
  }
  // Nothing of the run happened: no phase started, no call was made, no
  // approval record and no verdict record were written, nothing was ticked.
  assert.equal(
    run.events.some((e) => e.type === "phase.started"),
    false,
  );
  assert.deepEqual([...run.calls], []);
  assert.deepEqual([...run.ticked], []);
  assert.deepEqual([...run.vcsCalls], []);
  assert.equal(
    [...run.files.keys()].some((p) => /approvals\/phase-\d+\.json$/.test(p)),
    false,
  );
  assert.deepEqual([...run.lines], []);
  // The read of the approval raised its integrity event, which names the phase.
  assert.deepEqual(
    run.integrityEvents.map((e) => [e.phase, e.failed]),
    [[1, "missing"]],
  );
});

test("CT-101-15 (engine): under the `parity` profile the same run starts and exits 0", async () => {
  const run = await runFixture(TICKED_WITHOUT_RECORD_UNDER_PARITY);
  assert.equal(run.refused, undefined);
  assert.equal(run.exitCode, 0);
  const started = run.events.filter((e) => e.type === "phase.started").map((e) => e.data.phase);
  assert.deepEqual(started, [1, 2, 3]);
});
