/**
 * CT-115-10 (T015, F115-FR-010) — checkpoint file handling: regular file,
 * no links, newer than the pass, size, two reads, stale removal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
  utimesSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  readClaimSync,
  removeStaleCheckpoint,
  checkpointPath,
  logicalCheckpointName,
  CHECKPOINT_MAX_BYTES,
  NOTE_MAX_BYTES,
  CHECKPOINT_REMOVED_EVENT,
  type CheckpointReaderOptions,
} from "../../src/checkpoint/read.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ct115-10-"));
  const outbox = join(root, "outbox");
  const control = join(root, "control");
  mkdirSync(outbox, { recursive: true });
  const options: CheckpointReaderOptions = {
    outboxPath: outbox,
    controlPlanePath: control,
    passStartedAtMs: 1_000,
  };
  return { root, outbox, control, options };
}

const CLAIM = JSON.stringify({
  schema: "specstride.checkpoint/1",
  tasks: ["T010"],
  note: "n",
  somethingElse: "ignored",
});

test("CT-115-10: a regular checkpoint file newer than the pass is read as a claim", () => {
  const { outbox, control, options } = setup();
  const path = checkpointPath(outbox, "u1");
  writeFileSync(path, CLAIM);
  const read = readClaimSync(options, "u1");
  assert.ok(read.ok);
  assert.deepEqual(read.claim.tasks, ["T010"]);
  assert.equal(read.claim.note, "n");
  // Moved into the control plane under the logical name, outbox emptied.
  const moved = join(control, logicalCheckpointName("u1"));
  assert.ok(existsSync(moved));
  assert.equal(existsSync(path), false);
  rmSync(outbox, { recursive: true, force: true });
  rmSync(control, { recursive: true, force: true });
});

test("CT-115-10: no links — a symlink is refused, never followed", () => {
  const { outbox, options } = setup();
  const target = join(outbox, "real.json");
  writeFileSync(target, CLAIM);
  symlinkSync(target, checkpointPath(outbox, "u1"));
  const read = readClaimSync(options, "u1");
  assert.deepEqual(read, {
    ok: false,
    refusal: { reason: "not-regular", path: checkpointPath(outbox, "u1") },
  });
  rmSync(outbox, { recursive: true, force: true });
});

test("CT-115-10: newer than the pass — an older file is stale", () => {
  const { outbox, options } = setup();
  const path = checkpointPath(outbox, "u1");
  writeFileSync(path, CLAIM);
  utimesSync(path, new Date(500), new Date(500));
  const read = readClaimSync(options, "u1");
  assert.ok(!read.ok);
  assert.equal(
    read.ok ? undefined : (read as { refusal: { reason: string } }).refusal.reason,
    "stale",
  );
  rmSync(options.outboxPath, { recursive: true, force: true });
});

test("CT-115-10: size — a file larger than 16 kilobytes is too-large", () => {
  const { outbox, options } = setup();
  const path = checkpointPath(outbox, "u1");
  writeFileSync(
    path,
    JSON.stringify({
      schema: "specstride.checkpoint/1",
      tasks: ["T010"],
      note: "x".repeat(17 * 1024),
    }),
  );
  assert.ok(statSync(path).size > CHECKPOINT_MAX_BYTES);
  const read = readClaimSync(options, "u1");
  assert.ok(!read.ok);
  assert.equal(
    read.ok ? undefined : (read as { refusal: { reason: string } }).refusal.reason,
    "too-large",
  );
  rmSync(outbox, { recursive: true, force: true });
});

test("CT-115-10: two reads — a file that changes between them is refused", () => {
  const { outbox, options } = setup();
  const path = checkpointPath(outbox, "u1");
  writeFileSync(path, CLAIM);
  let n = 0;
  const read = readClaimSync(
    {
      ...options,
      readBytes: () => {
        n += 1;
        return Buffer.from(
          n === 1 ? CLAIM : JSON.stringify({ schema: "specstride.checkpoint/1", tasks: ["T011"] }),
        );
      },
    },
    "u1",
  );
  assert.ok(!read.ok);
  assert.equal(
    read.ok ? undefined : (read as { refusal: { reason: string } }).refusal.reason,
    "changed-while-read",
  );
  // Not moved: the outbox file stays where it was.
  assert.ok(existsSync(path));
  rmSync(outbox, { recursive: true, force: true });
});

test("CT-115-10: the note is cut to at most 512 bytes", () => {
  const { outbox, control, options } = setup();
  writeFileSync(
    checkpointPath(outbox, "u1"),
    JSON.stringify({ schema: "specstride.checkpoint/1", tasks: ["T010"], note: "ä".repeat(600) }),
  );
  const read = readClaimSync(options, "u1");
  assert.ok(read.ok);
  assert.ok(Buffer.byteLength(read.claim.note ?? "", "utf8") <= NOTE_MAX_BYTES);
  rmSync(outbox, { recursive: true, force: true });
  rmSync(control, { recursive: true, force: true });
});

test("CT-115-10: a checkpoint present when a pass starts is removed with an event", () => {
  const { outbox } = setup();
  const path = checkpointPath(outbox, "u1");
  writeFileSync(path, CLAIM);
  const event = removeStaleCheckpoint(outbox, "u1");
  assert.ok(event);
  assert.equal(event.type, CHECKPOINT_REMOVED_EVENT);
  assert.equal(event.type, "checkpoint.removed");
  assert.equal(existsSync(path), false);
  assert.equal(removeStaleCheckpoint(outbox, "u1"), undefined);
  rmSync(outbox, { recursive: true, force: true });
});
