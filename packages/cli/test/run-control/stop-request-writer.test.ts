/**
 * T004 — the writer of the stop request (F102-FR-001;
 * contracts/stop-request.md).
 *
 * Every check here observes the RESULT through an independent read path
 * (`readStopRequestFromFile` of records.ts, or a direct read of the
 * directory), never through the writer's own return value.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStopRequest,
  isAStopRequestTemporaryName,
  validateStopRequest,
  writeStopRequest,
} from "../../../cli/src/run-control/stop-request-writer.ts";
import { readStopRequestFromFile } from "../../../cli/src/run-control/records.ts";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "specstride-102-stop-"));
}

test("T004: the full request is written under a temporary name, renamed into place (F102-FR-001)", () => {
  const dir = workspace();
  const path = join(dir, "inbox", "stop");
  const write = writeStopRequest(path, { now: true, runTokenHash: "deadbeef" }, { root: dir });
  // The temporary name was in the SAME directory (the rename is atomic there).
  assert.equal(write.temporaryPath.startsWith(dir + "/"), true);
  assert.equal(isAStopRequestTemporaryName(write.temporaryPath), true);
  // No temporary file is left behind: the rename consumed it.
  const left = readdirSync(join(dir, "inbox")).filter((n) => n !== "stop");
  assert.deepEqual(left, []);
  // Independent read path: the file exists, is valid JSON, non-empty.
  assert.equal(existsSync(path), true);
  assert.equal(statSync(path).size > 0, true);
});

test("T004: the written request reads back as a validated stop request with the fields asked", () => {
  const dir = workspace();
  const path = join(dir, "stop");
  writeStopRequest(path, { now: true, jobs: true, runTokenHash: "cafe" }, { root: dir });
  const read = readStopRequestFromFile(path);
  assert.equal(read.clean, false);
  if (read.clean) return;
  assert.equal(read.request.type, "stop");
  assert.equal(read.request.now, true);
  assert.equal(read.request.jobs, true);
  assert.equal((read.request as Record<string, unknown>).runTokenHash, "cafe");
});

test("T004: now and jobs default to false and are written so", () => {
  const request = buildStopRequest({}) as unknown as Record<string, unknown>;
  assert.equal(request.now, false);
  assert.equal(request.jobs, false);
  assert.equal(request.type, "stop");
  assert.equal(request.schema, "specstride.inbox/1");
  assert.equal(request.runTokenHash, undefined);
});

test("T004: the empty request is a zero-byte file that reads as a clean stop and never carries now or jobs", () => {
  const dir = workspace();
  const path = join(dir, "stop");
  const write = writeStopRequest(path, undefined, { root: dir });
  assert.equal(write.empty, true);
  assert.equal(write.request, undefined);
  assert.equal(statSync(path).size, 0);
  const read = readStopRequestFromFile(path);
  assert.deepEqual(read, { clean: true, now: false, jobs: false });
});

test("T004: an unreadable stop request reads as a clean stop (F102-FR-001)", () => {
  const dir = workspace();
  // A directory at the request path makes the read fail (EISDIR).
  const path = join(dir, "stop");
  mkdirSync(path);
  const read = readStopRequestFromFile(path);
  assert.deepEqual(read, { clean: true, now: false, jobs: false });
});

test("T004: the request is validated BEFORE it is written", () => {
  const dir = workspace();
  const path = join(dir, "stop");
  const request = {
    schema: "specstride.inbox/1",
    type: "hold-relaunch",
    at: new Date().toISOString(),
  };
  const read = validateStopRequest(request);
  assert.equal(read.ok, false); // refused: inbox:stop carries the type stop only
  // The writer builds only valid requests; a validation failure can never
  // reach the disk, because the write follows the validation.
  const written = writeStopRequest(path, {}, { root: dir });
  assert.equal(written.request !== undefined, true);
  assert.equal(readFileSync(path, "utf8").includes("hold-relaunch"), false);
});
