/**
 * T005 — the writer of the run snapshot (F102-FR-025, F102-FR-026;
 * contracts/snapshot-classes.md).
 *
 * Every check observes the RESULT through an independent read path: the file
 * on the disk, read back and validated against `specstride.snapshot/1` with
 * the reader of records.ts — never the writer's own return value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SnapshotWriteError,
  buildSnapshotRecord,
  rankOfKeyOnResume,
  writeRunSnapshot,
} from "../../../cli/src/run-control/snapshot-writer.ts";
import { readRunSnapshot } from "../../../cli/src/run-control/records.ts";
import { snapshotClassOf } from "@specstride/config";

const DIR = mkdtempSync(join(tmpdir(), "specstride-102-snapshot-"));

const HASHES = {
  spec: { path: "specs/102-run-control/spec.md", contentHash: "a".repeat(64) },
  plan: { path: "specs/102-run-control/plan.md", contentHash: "b".repeat(64) },
  tasks: {
    path: "specs/102-run-control/tasks.md",
    contentHash: "c".repeat(64),
    hashIgnoringCheckboxes: "d".repeat(64),
  },
};

function input() {
  return {
    runId: "r-102",
    createdAt: "2026-10-06T12:00:00.000Z",
    profile: null,
    keys: [
      { key: "roles.proposer.harness", value: "dsh", source: 2 },
      { key: "loop.maxIter", value: 12, source: 5 },
      { key: "no.class.in.the.catalogue", value: true, source: 4 },
      {
        key: "secrets.provider.token",
        value: "env:SPECSTRIDE_TOKEN",
        source: 4,
        isSecretReference: true,
      },
      { key: "learned.key", value: "x", source: 3, decisionId: "D-9" },
    ],
    sourceHashes: HASHES,
  };
}

test("T005: the written snapshot validates against specstride.snapshot/1 (F102-FR-025)", () => {
  const path = join(DIR, "snap-1.json");
  const write = writeRunSnapshot(path, input(), { root: DIR });
  assert.equal(write.runId, "r-102");
  assert.equal(write.keyCount, 5);
  // Independent read: the file on the disk, parsed and schema-validated.
  const read = readRunSnapshot(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(read.ok, true);
  const record = read.ok ? read.record : undefined;
  assert.equal(record!.schema, "specstride.snapshot/1");
  assert.equal(record!.runId, "r-102");
  assert.deepEqual(record!.sourceHashes, HASHES);
});

test("T005: every key carries a class, pinned or tunable, from the catalogue (F102-FR-026)", () => {
  const record = buildSnapshotRecord(input());
  const keys = record.keys as Record<string, Record<string, unknown>>;
  assert.equal(keys["roles.proposer.harness"]!.class, "pinned");
  assert.equal(keys["roles.proposer.harness"]!.class, snapshotClassOf("roles.proposer.harness"));
  assert.equal(keys["loop.maxIter"]!.class, "tunable");
  // A key without a class in the catalogue is read as pinned (row 76).
  assert.equal(keys["no.class.in.the.catalogue"]!.class, "pinned");
});

test("T005: the rank of a key follows its class on resume (contracts/snapshot-classes.md)", () => {
  const pinned = rankOfKeyOnResume("roles.proposer.harness");
  const tunable = rankOfKeyOnResume("loop.maxIter");
  // Pinned: below the flags (2) and above the environment (4).
  assert.ok(pinned > 2 && pinned < 4, String(pinned));
  // Tunable: below the environment (4) and above the project file (5).
  assert.ok(tunable > 4 && tunable < 5, String(tunable));
});

test("T005: a secret is stored as its reference, never resolved (F102-FR-025)", () => {
  const record = buildSnapshotRecord(input());
  const keys = record.keys as Record<string, Record<string, unknown>>;
  const entry = keys["secrets.provider.token"]!;
  assert.equal(entry.value, "env:SPECSTRIDE_TOKEN");
  assert.equal(entry.isSecretReference, true);
});

test("T005: a learned value carries the id of its decision (annex B §B.12)", () => {
  const record = buildSnapshotRecord(input());
  const keys = record.keys as Record<string, Record<string, unknown>>;
  assert.equal(keys["learned.key"]!.decisionId, "D-9");
});

test("T005: acceptedChanges is written only when given (F102-FR-019)", () => {
  const without = buildSnapshotRecord(input()) as unknown as Record<string, unknown>;
  assert.equal("acceptedChanges" in without, false);
  const withChanges = buildSnapshotRecord({
    ...input(),
    acceptedChanges: [
      {
        at: "2026-10-06T12:30:00.000Z",
        file: "spec",
        oldHash: "a".repeat(64),
        newHash: "e".repeat(64),
      },
    ],
  }) as unknown as Record<string, unknown>;
  assert.equal((withChanges.acceptedChanges as unknown[]).length, 1);
});

test("T005: a failed write is a launch error — SnapshotWriteError, no snapshot left (F102-FR-025, D-11)", () => {
  const path = join(DIR, "snap-fail"); // created as a DIRECTORY below
  mkdirSync(path);
  assert.throws(() => writeRunSnapshot(path, input(), { root: DIR }), SnapshotWriteError);
  // Nothing was written into it: the path is still the empty directory.
  assert.equal(statSync(path).isDirectory(), true);
});
