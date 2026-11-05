/**
 * CT-115-155 (T036, IR-55, F115-FR-010) — the handling of the checkpoint
 * file: the port of T003 is implemented by the edge package, refuses
 * without throwing, and moves the claim into the control plane.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createCheckpointClaimReader,
  readClaimSync,
  checkpointPath,
  logicalCheckpointName,
  type CheckpointReaderOptions,
} from "../../src/checkpoint/read.ts";
import type { CheckpointClaimResult } from "@specstride/contracts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ct115-155-"));
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

test("CT-115-155: the reader is the port of T003, and an absent checkpoint is not a refusal", async () => {
  const { options } = setup();
  const reader = createCheckpointClaimReader(options);
  const read: CheckpointClaimResult = await reader.readClaim("u1");
  assert.deepEqual(read, { ok: false, absent: true });
});

test("CT-115-155: a foreign schema or a non-JSON file is refused as empty, without throwing", () => {
  for (const content of [
    "not json at all",
    JSON.stringify({ schema: "specstride.other/9", tasks: ["T010"] }),
    JSON.stringify({ schema: "specstride.checkpoint/1", tasks: [] }),
  ]) {
    const { outbox, options } = setup();
    writeFileSync(checkpointPath(outbox, "u1"), content);
    const read = readClaimSync(options, "u1");
    assert.ok(!read.ok);
    assert.equal(
      read.ok ? undefined : (read as { refusal: { reason: string } }).refusal.reason,
      "empty",
    );
    rmSync(outbox, { recursive: true, force: true });
  }
});

test("CT-115-155: the read claim moves into the control plane byte for byte", () => {
  const { outbox, control, options } = setup();
  const content = JSON.stringify({
    schema: "specstride.checkpoint/1",
    tasks: ["T010", "T011"],
    note: "ok",
  });
  writeFileSync(checkpointPath(outbox, "u1"), content);
  const read = readClaimSync(options, "u1");
  assert.ok(read.ok);
  const moved = join(control, logicalCheckpointName("u1"));
  assert.equal(readFileSync(moved, "utf8"), content);
  assert.equal(existsSync(checkpointPath(outbox, "u1")), false);
  rmSync(outbox, { recursive: true, force: true });
  rmSync(control, { recursive: true, force: true });
});

test("CT-115-155: every other field of the file is ignored", () => {
  const { outbox, options } = setup();
  writeFileSync(
    checkpointPath(outbox, "u1"),
    JSON.stringify({
      schema: "specstride.checkpoint/1",
      tasks: ["T010"],
      note: "n",
      verdict: "approved", // a claim is never a verdict
      summary: "long text",
    }),
  );
  const read = readClaimSync(options, "u1");
  assert.ok(read.ok);
  assert.deepEqual(Object.keys(read.claim).sort(), ["note", "schema", "tasks"]);
  rmSync(outbox, { recursive: true, force: true });
});
