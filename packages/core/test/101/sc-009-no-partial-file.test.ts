/**
 * T101 of feature 101 — the OWN TEST of F101-SC-009.
 *
 * The success criterion, stated once:
 *
 *   ENDING THE ENGINE AT RANDOM MOMENTS WHILE IT WRITES LEAVES NO PARTIAL FILE
 *   UNDER THE LOGICAL NAMES OF THIS FEATURE.
 *
 * Proves F101-FR-028: every file this feature writes goes to a temporary name
 * in the SAME directory and is renamed into place, through the atomic write of
 * the kernel, so that a reader never sees a part of such a file.
 *
 * Fixture FX-02 (`reject-approve`), PORT SIDE ONLY: the run is the real engine
 * over the ports of `run-harness.ts`, and nothing of the reference tree is
 * needed, so this test never skips.
 *
 * How the moment of the ending is reached, and why the test is not circular:
 *
 *  1. The real engine runs FX-02 once. `operations` of the observation is the
 *     ORDERED LOG of every operation the engine made on the tree, with the
 *     BYTES of each write (T101's addition to the harness).
 *  2. That log is then REPLAYED into a real directory through the REAL atomic
 *     write of the kernel (`@specstride/kernel/atomic-write`, F100-FR-036) —
 *     not through the tree in memory. The replay stops at one operation and at
 *     one moment INSIDE it: before the temporary name exists, after a part of
 *     the bytes reached it, or after all of them reached it and before the
 *     rename. That is what an engine ended at that moment leaves behind.
 *  3. The directory is then read back through an INDEPENDENT path
 *     (`readdirSync`, `readFileSync`), never through the writer, and judged.
 *
 * The judgement, for every moment: every file that stands under a LOGICAL NAME
 * of this feature holds exactly the bytes of the last COMPLETED write of that
 * name — so it is whole, and never a part — and every part that was left
 * behind stands under a TEMPORARY name, which is no logical name of anything.
 *
 * The last test of the file is the NEGATIVE CONTROL: the same judgement over a
 * part written straight to the logical name, which it must reject. Without it
 * every claim above could be vacuous.
 */
import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { atomicWrite, isTemporaryName, temporaryNameFor } from "@specstride/kernel/atomic-write";
import {
  A_READER_SEES_A_PART_OF_A_RECORD,
  ATOMIC_WRITE_STEPS,
  RECORDS_OF_THE_PHASE_GATE,
  WRITERS,
} from "../../src/gate/writers.ts";
import {
  FX_02_REJECT_APPROVE,
  runFixture,
  type RunObservation,
  type TreeOperation,
} from "./run-harness.ts";

/* ------------------------------------------------------------------ *
 * The seed. The run prints it, and a failing case names it, so that any
 * failure is replayed with `SC_009_SEED=<seed>` and never hunted for.
 * ------------------------------------------------------------------ */

const SEED = Number(process.env["SC_009_SEED"] ?? 20_261_003);

/** A small deterministic generator; the seed is the whole state. */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/* ------------------------------------------------------------------ *
 * The logical names of this feature, as `data/layout.json` writes their
 * paths. The engine of the harness writes relative to the control root,
 * so each pattern below is the path of the layout row with `<control>/`
 * dropped and every parameter made a group.
 * ------------------------------------------------------------------ */

const SLUG = "101-gate-and-verdict";

/** One logical name of this feature, with the shape of its path. */
type LogicalNameOfTheFeature = {
  /** The logical name, as `data-model.md` and `data/layout.json` carry it. */
  readonly name: string;
  /** Which record of F101-FR-028 stands there, where it is one of them. */
  readonly record: (typeof RECORDS_OF_THE_PHASE_GATE)[number] | undefined;
  /** The shape of the path, relative to the control root. */
  readonly shape: RegExp;
};

const ATTEMPT = `features/${SLUG}/runs/[^/]+/phases/\\d+/attempts/e\\d+-a\\d+`;
const PHASE = `features/${SLUG}/runs/[^/]+/phases/\\d+`;
const RUN = `features/${SLUG}/runs/[^/]+`;

const LOGICAL_NAMES_OF_THE_FEATURE: readonly LogicalNameOfTheFeature[] = Object.freeze([
  {
    name: "gate:<N>:approved",
    record: "approval record",
    shape: new RegExp(`^features/${SLUG}/approvals/phase-\\d+\\.json$`),
  },
  {
    name: "feature:<slug>:approval-key",
    record: "approval key",
    shape: new RegExp(`^features/${SLUG}/keys/approval\\.key$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:record",
    record: "record of a phase attempt",
    shape: new RegExp(`^${ATTEMPT}/attempt\\.json$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:verdict",
    record: "verdict record",
    shape: new RegExp(`^${ATTEMPT}/critic/verdict\\.json$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:feedback",
    record: "feedback",
    shape: new RegExp(`^${ATTEMPT}/feedback\\.md$`),
  },
  { name: "attempt:<N>:<k>:<n>:hint", record: "hint", shape: new RegExp(`^${ATTEMPT}/hint\\.md$`) },
  {
    name: "attempt:<N>:<k>:<n>:acceleration",
    record: "acceleration note",
    shape: new RegExp(`^${ATTEMPT}/acceleration\\.md$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:accelerator-snapshot",
    record: "accelerator snapshot",
    shape: new RegExp(`^${ATTEMPT}/accelerator-snapshot\\.json$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:evidence",
    record: "archived phase evidence",
    shape: new RegExp(`^${ATTEMPT}/gate/evidence\\.md$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:verification",
    record: undefined,
    shape: new RegExp(`^${ATTEMPT}/(gate/)?verification\\.json$`),
  },
  {
    name: "attempt:<N>:<k>:<n>:critic-invocation",
    record: undefined,
    shape: new RegExp(`^${ATTEMPT}/critic/invocation\\.json$`),
  },
  {
    name: "phase:<N>:recovery-markers",
    record: "recovery markers",
    shape: new RegExp(`^${PHASE}/recovery-markers\\.json$`),
  },
  {
    name: "phase:<N>:approved-archive",
    record: "the archive at approval",
    shape: new RegExp(`^${PHASE}/approved/[^/]+$`),
  },
  {
    name: "run:<runId>:terminal",
    record: "terminal record",
    shape: new RegExp(`^${RUN}/engine\\.terminal\\.json$`),
  },
  // Compatibility output: the as-is transcript of a critic call (B-0876). It is
  // written through the same single writer, so F101-SC-009 covers it too.
  {
    name: "attempt:<N>:<k>:<n>:verdict (as-is transcript)",
    record: "verdict record",
    shape: new RegExp(`^${RUN}/verdicts/phase\\d+\\.attempt\\d+\\.txt$`),
  },
]);

/**
 * The logical name a path stands under, or `undefined` for a path of the
 * WORKING TREE, which the pass writes and this feature does not: the three
 * files of the proposer, the phase evidence the proposer delivers and the
 * record of the prompt of an accelerated phase attempt.
 */
function logicalNameOf(path: string): LogicalNameOfTheFeature | undefined {
  return LOGICAL_NAMES_OF_THE_FEATURE.find((n) => n.shape.test(path));
}

/** True for a path of the working tree, which no logical name of ours covers. */
function isOfTheWorkingTree(path: string): boolean {
  return path.startsWith(".specstride/");
}

/* ------------------------------------------------------------------ *
 * The replay: the log of the run, through the REAL atomic write.
 * ------------------------------------------------------------------ */

/** Where inside one write the engine was ended. */
const MOMENTS = [
  "before the temporary name exists",
  "after a part of the bytes reached the temporary name",
  "after every byte reached the temporary name, before the rename",
] as const;
type Moment = (typeof MOMENTS)[number];

/** What a replay left behind, as an independent reader sees it. */
type Leftover = {
  /** Every file of the sandbox, by its path relative to the sandbox. */
  readonly onDisk: ReadonlyMap<string, string>;
  /** What the tree SHOULD hold: the last completed write of each path. */
  readonly completed: ReadonlyMap<string, string>;
  /** The paths that were written at all, completed or not. */
  readonly touched: ReadonlySet<string>;
};

function sandbox(): { dir: string; done(): void } {
  const dir = mkdtempSync(join(tmpdir(), "sc-009-"));
  return { dir, done: (): void => rmSync(dir, { recursive: true, force: true }) };
}

/** Every file under a directory, at any depth, read independently. */
function readTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return out;
}

/**
 * Replay the log of the run into a real directory through the REAL atomic
 * write, and END at operation `endAt` (one-based) at the moment `moment`.
 *
 * Every operation before `endAt` is carried out whole. The ending operation is
 * carried only as far as the moment says: a write leaves a part of its bytes
 * under the TEMPORARY NAME of the kernel and is never renamed, which is what a
 * killed engine leaves; a move and a copy are single steps of the kernel, so
 * for them the moment before means nothing happened at all.
 */
function replayAndEnd(
  operations: readonly TreeOperation[],
  endAt: number,
  moment: Moment,
  cutAt: (bytes: number) => number,
  dir: string,
): Leftover {
  const completed = new Map<string, string>();
  const touched = new Set<string>();
  const inSandbox = (path: string): string => join(dir, path);
  const ensure = (path: string): void => {
    mkdirSync(dirname(inSandbox(path)), { recursive: true });
  };

  for (const [index, op] of operations.entries()) {
    const ordinal = index + 1;
    if (ordinal > endAt) break;
    const ending = ordinal === endAt;
    touched.add(op.path);
    if (op.op === "write") {
      ensure(op.path);
      if (!ending) {
        atomicWrite(inSandbox(op.path), op.content);
        completed.set(op.path, op.content);
        continue;
      }
      if (moment === MOMENTS[0]) break;
      const bytes = Buffer.from(op.content, "utf8");
      const upTo = moment === MOMENTS[1] ? cutAt(bytes.length) : bytes.length;
      // The three steps of the kernel, carried only as far as the moment: the
      // temporary name in the SAME directory, the bytes, and NO rename.
      const temporary = temporaryNameFor(inSandbox(op.path), 0);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeSync(fd, bytes.subarray(0, upTo));
      } finally {
        closeSync(fd);
      }
      break;
    }
    touched.add(op.to);
    const held = completed.get(op.path);
    if (held === undefined) continue; // the source was never completed
    if (ending && moment === MOMENTS[0]) break;
    ensure(op.to);
    if (op.op === "move") {
      renameSync(inSandbox(op.path), inSandbox(op.to));
      completed.delete(op.path);
    } else {
      copyFileSync(inSandbox(op.path), inSandbox(op.to));
    }
    completed.set(op.to, held);
    if (ending) break;
  }
  return { onDisk: readTree(dir), completed, touched };
}

/**
 * The judgement of F101-SC-009 over what one ending left behind.
 *
 * It returns the complaints it found, so that the negative control can show
 * the same judgement REJECTING a part written straight to a logical name.
 */
function complaintsAbout(left: Leftover, where: string): string[] {
  const complaints: string[] = [];
  for (const [path, body] of left.onDisk) {
    if (isTemporaryName(path)) continue; // a part is allowed HERE and nowhere else
    const name = logicalNameOf(path);
    if (name === undefined) {
      if (!isOfTheWorkingTree(path))
        complaints.push(`${where}: ${path} stands under no logical name`);
      continue;
    }
    const whole = left.completed.get(path);
    if (whole === undefined) {
      complaints.push(
        `${where}: ${path} (${name.name}) stands there with no completed write behind it`,
      );
      continue;
    }
    if (body !== whole) {
      complaints.push(
        `${where}: ${path} (${name.name}) holds ${body.length} bytes, ` +
          `and the last completed write of it was ${whole.length} bytes: a PART of a record`,
      );
    }
  }
  for (const [path, whole] of left.completed) {
    const body = left.onDisk.get(path);
    if (body === undefined) {
      complaints.push(`${where}: ${path} was written whole and is gone`);
      continue;
    }
    if (body !== whole)
      complaints.push(`${where}: ${path} does not hold the bytes it was written with`);
  }
  return complaints;
}

/** Every part left behind stands under a temporary name of the kernel. */
function partsLeftBehind(left: Leftover): readonly string[] {
  return [...left.onDisk.keys()].filter((p) => isTemporaryName(p));
}

/* ------------------------------------------------------------------ *
 * The run of FX-02, made once and read by every test.
 * ------------------------------------------------------------------ */

let run: RunObservation | undefined;
async function theRun(): Promise<RunObservation> {
  run ??= await runFixture(FX_02_REJECT_APPROVE);
  return run;
}

test("T101 setup: FX-02 runs on the port side alone and writes records of the phase gate", async () => {
  const o = await theRun();
  assert.equal(o.exitCode, 0, "FX-02 approves the second phase attempt and ends 0");
  assert.equal(o.runSet.family, "FX-02");
  assert.ok(o.operations.length > 10, `the run made ${o.operations.length} operations on the tree`);
  const writes = o.operations.filter((op) => op.op === "write");
  assert.ok(writes.length > 5, `${writes.length} writes, each with its bytes`);
  // F101-FR-028 states the claim this file proves, and names the two writers.
  assert.equal(A_READER_SEES_A_PART_OF_A_RECORD, false);
  assert.deepEqual(
    [...ATOMIC_WRITE_STEPS],
    ["write-temporary-in-the-same-directory", "fsync", "rename"],
  );
  assert.equal(WRITERS.length, 2, "two writers of records of the phase gate, and no third");
});

test("T101: every write of the run of FX-02 stands under a logical name of this feature or in the working tree", async () => {
  const o = await theRun();
  const unknown: string[] = [];
  const covered = new Set<string>();
  for (const op of o.operations) {
    for (const path of op.op === "write" ? [op.path] : [op.path, op.to]) {
      const name = logicalNameOf(path);
      if (name !== undefined) covered.add(name.name);
      else if (!isOfTheWorkingTree(path)) unknown.push(path);
    }
  }
  assert.deepEqual(unknown, [], "no path of the control plane stands outside the logical names");
  // The records F101-FR-028 names that THIS fixture produces are all reached.
  for (const expected of [
    "gate:<N>:approved",
    "feature:<slug>:approval-key",
    "attempt:<N>:<k>:<n>:verdict",
    "attempt:<N>:<k>:<n>:feedback",
    "attempt:<N>:<k>:<n>:hint",
    "attempt:<N>:<k>:<n>:acceleration",
    "attempt:<N>:<k>:<n>:accelerator-snapshot",
    "attempt:<N>:<k>:<n>:evidence",
    "phase:<N>:recovery-markers",
    "phase:<N>:approved-archive",
  ]) {
    assert.ok(covered.has(expected), `the run of FX-02 wrote ${expected}`);
  }
});

test("T101 (F101-SC-009): the engine ended at EVERY operation, at every moment, leaves no partial file under a logical name", async () => {
  const o = await theRun();
  const half = (bytes: number): number => Math.max(1, Math.floor(bytes / 2));
  let endings = 0;
  let partsSeen = 0;
  for (let endAt = 1; endAt <= o.operations.length; endAt += 1) {
    for (const moment of MOMENTS) {
      const box = sandbox();
      try {
        const left = replayAndEnd(o.operations, endAt, moment, half, box.dir);
        const where = `ended at operation ${endAt} (${o.operations[endAt - 1]?.op}) ${moment}`;
        assert.deepEqual(complaintsAbout(left, where), [], where);
        const parts = partsLeftBehind(left);
        partsSeen += parts.length;
        for (const part of parts) {
          // A part lies in the SAME DIRECTORY as its target, under a name that
          // is no logical name of anything (F101-FR-028).
          assert.equal(isTemporaryName(part), true, `${part} is a temporary name`);
          assert.equal(logicalNameOf(part), undefined, `${part} is no logical name`);
          const target = o.operations[endAt - 1]?.path ?? "";
          assert.equal(dirname(part), dirname(target), `${part} lies beside ${target}`);
        }
        endings += 1;
      } finally {
        box.done();
      }
    }
  }
  assert.equal(endings, o.operations.length * MOMENTS.length, "every ending was judged");
  assert.ok(partsSeen > 0, `${partsSeen} parts were left behind, every one under a temporary name`);
});

test("T101 (F101-SC-009): the engine ended at RANDOM moments, from a printed seed, leaves no partial file", async () => {
  const o = await theRun();
  const next = generator(SEED);
  process.stdout.write(`# SC-009: the seed of this run is ${SEED}\n`);
  const rounds = 60;
  for (let round = 0; round < rounds; round += 1) {
    const endAt = 1 + Math.floor(next() * o.operations.length);
    const moment = MOMENTS[Math.floor(next() * MOMENTS.length)] ?? MOMENTS[1];
    const share = next();
    const cutAt = (bytes: number): number =>
      Math.max(1, Math.min(bytes, Math.floor(bytes * share)));
    const box = sandbox();
    try {
      const left = replayAndEnd(o.operations, endAt, moment, cutAt, box.dir);
      const where =
        `SC_009_SEED=${SEED}, round ${round}: ended at operation ${endAt} ` +
        `(${o.operations[endAt - 1]?.op}) ${moment}, cut at ${Math.round(share * 100)}%`;
      assert.deepEqual(complaintsAbout(left, where), [], where);
      for (const part of partsLeftBehind(left)) {
        assert.equal(isTemporaryName(part), true, `${where}: ${part} is a temporary name`);
        assert.equal(logicalNameOf(part), undefined, `${where}: ${part} is no logical name`);
      }
    } finally {
      box.done();
    }
  }
});

test("T101: every file the whole run leaves under a logical name is whole, not a part", async () => {
  const o = await theRun();
  let judged = 0;
  for (const [path, body] of o.files) {
    const name = logicalNameOf(path);
    if (name === undefined) continue;
    judged += 1;
    assert.ok(body.length > 0, `${path} (${name.name}) is not empty`);
    if (path.endsWith(".json")) {
      assert.doesNotThrow(
        () => JSON.parse(body) as unknown,
        `${path} (${name.name}) is whole JSON`,
      );
    } else if (path.endsWith(".md") || path.endsWith(".txt")) {
      assert.equal(body.endsWith("\n"), true, `${path} (${name.name}) ends in a line end`);
    }
    assert.equal(isTemporaryName(path), false, `${path} is no leftover temporary name`);
  }
  assert.ok(judged >= 10, `${judged} files under a logical name of this feature were judged whole`);
});

test("T101: no record of a logical name is written IN TWO PARTS — no write of a name is a strict prefix of a later write of it", async () => {
  const o = await theRun();
  // A record written in two goes — first a part of the bytes, then the whole —
  // would leave a reader with a partial record BETWEEN the two writes, even
  // though each write of itself landed through a rename. F101-FR-028 asks for
  // one write per record, so this is the second half of the claim: not only is
  // every write atomic, every record is written ONCE and whole.
  const perPath = new Map<string, string[]>();
  for (const op of o.operations) {
    if (op.op !== "write") continue;
    if (logicalNameOf(op.path) === undefined) continue; // the pass writes the working tree
    perPath.set(op.path, [...(perPath.get(op.path) ?? []), op.content]);
  }
  assert.ok(perPath.size >= 10, `${perPath.size} records of a logical name were written`);
  for (const [path, bodies] of perPath) {
    for (let i = 1; i < bodies.length; i += 1) {
      const earlier = bodies[i - 1] as string;
      const later = bodies[i] as string;
      assert.equal(
        later.startsWith(earlier) && later.length > earlier.length,
        false,
        `${path} (${logicalNameOf(path)?.name ?? ""}) was written in two parts: ` +
          `${earlier.length} bytes, then the same bytes plus ${later.length - earlier.length} more`,
      );
    }
  }
});

test("T101 negative control: the same judgement REJECTS a part written straight to a logical name", async () => {
  const o = await theRun();
  const write = o.operations.find(
    (op): op is Extract<TreeOperation, { op: "write" }> =>
      op.op === "write" && logicalNameOf(op.path) !== undefined && op.content.length > 20,
  );
  assert.ok(write !== undefined, "the run wrote at least one record of a logical name");
  const box = sandbox();
  try {
    // NOT through the atomic write: a part of the bytes straight onto the
    // logical name, which is exactly what F101-FR-028 forbids.
    const path = join(box.dir, write.path);
    mkdirSync(dirname(path), { recursive: true });
    const part = write.content.slice(0, Math.floor(write.content.length / 2));
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, Buffer.from(part, "utf8"));
    } finally {
      closeSync(fd);
    }
    const left: Leftover = {
      onDisk: readTree(box.dir),
      completed: new Map([[write.path, write.content]]),
      touched: new Set([write.path]),
    };
    const complaints = complaintsAbout(left, "the negative control");
    assert.ok(
      complaints.some((c) => c.includes("a PART of a record")),
      `the judgement names the part; it said: ${complaints.join(" | ")}`,
    );
  } finally {
    box.done();
  }
});
