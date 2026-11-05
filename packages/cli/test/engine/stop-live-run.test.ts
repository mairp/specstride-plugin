/**
 * THE LIVE RUN `STOP` SEES IN THE ENGINE'S OWN RECORDS (step 5, part B item
 * 3 — owed item 3 of par-4; F102-FR-002 as the reviewer ruling reads it,
 * F143-FR-026).
 *
 * THE GAP THE ITEM NAMES. The engine of this build takes no workspace lock
 * and writes no workspace record, so `stop`'s as-is live-run check — the
 * owner file of `workspace:lock` — never fired on a real run: on a LIVE run
 * the command printed `no run appears to be active … (lock is free)` and
 * exited 1 (reproduced in the par-4 drive). The command now reads the run
 * from WHAT THE ENGINE REALLY WRITES (`run-control/live-run-evidence.ts`):
 *
 *  - THE SUPERVISION REGISTRY (`<control>/procs.json`, `specstride.procs/1`):
 *    any entry is a pass in flight — live, whatever the event file says;
 *  - THE NEWEST RUN'S EVENT FILE: a run whose newest event stream does not
 *    end in the terminal event (`run.ended`) stands OPEN in the records —
 *    live, or cut without a clean end.
 *
 * WHERE THE RECORDS SHOW A RUN the two as-is warnings are absent, one
 * sentence names the file the answer came from, and the run's own records
 * count as state for the exit: 0. Exit 1 keeps its as-is meaning — NO state
 * of any kind stood — so the empty-control-tree pin (`c111`) and the
 * `runAppearedActive` pins stand untouched. Where the records name nothing,
 * every compatibility line is byte for byte what it always was.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { layoutVersion } from "@specstride/contracts/ids/logical-names";
import {
  NO_LIVE_RUN,
  aRunStandsOpenLine,
  theLiveRunOfTheEngineRecords,
} from "../../src/run-control/live-run-evidence.ts";
import { runStop } from "../../src/commands/stop.ts";

/** An empty control tree, as a workspace with no state of any kind. */
function anEmptyControl(): string {
  return mkdtempSync(join(tmpdir(), "stop-live-empty-"));
}

/**
 * A control tree with the workspace record the layout table defines — the
 * state a host whose engine writes the record has (`stop-mount.test.ts`
 * stands the same one to hold the command's own contract).
 */
function aControlWithARecord(): { control: string; recordRoot: string } {
  const control = mkdtempSync(join(tmpdir(), "stop-live-record-"));
  const recordRoot = join(control, "workspaces", "w1");
  mkdirSync(recordRoot, { recursive: true });
  writeFileSync(
    join(recordRoot, "workspace.json"),
    JSON.stringify({
      schema: "specstride.layout/1",
      layoutVersion,
      workspaceId: "w1",
      realPath: control,
      createdAt: new Date().toISOString(),
      productVersion: "test",
      lockProvider: { id: "test", version: "1" },
    }),
  );
  return { control, recordRoot };
}

test("the reader: an empty control tree names nothing", () => {
  const control = anEmptyControl();
  try {
    assert.deepEqual(theLiveRunOfTheEngineRecords(control), NO_LIVE_RUN);
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the reader: an entry in the supervision registry is a live run, named by the registry", () => {
  const control = anEmptyControl();
  try {
    writeFileSync(
      join(control, "procs.json"),
      JSON.stringify({
        "run:run-abc:pass-in-flight": {
          logicalName: "run:run-abc:pass-in-flight",
          pid: 4242,
          startedAt: "2026-11-04T12:00:00.000Z",
        },
      }),
    );
    const reading = theLiveRunOfTheEngineRecords(control);
    assert.equal(reading.live, true);
    assert.equal(reading.where, join(control, "procs.json"));
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the reader: the newest run whose events do not end in run.ended stands open", () => {
  const control = anEmptyControl();
  try {
    const run = join(control, "runs", "run-open-1");
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, "events.jsonl"),
      [
        JSON.stringify({ type: "run.started", runId: "run-open-1" }),
        JSON.stringify({ type: "phase.started", phase: 1 }),
      ].join("\n") + "\n",
    );
    const reading = theLiveRunOfTheEngineRecords(control);
    assert.equal(reading.live, true);
    assert.equal(reading.where, join(run, "events.jsonl"));
    assert.equal(reading.runId, "run-open-1");
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the reader: the terminal event closes the run; an older open run beside a closed newest run is not shown", () => {
  const control = anEmptyControl();
  try {
    const older = join(control, "runs", "run-older");
    const closed = join(control, "runs", "run-closed");
    mkdirSync(older, { recursive: true });
    mkdirSync(closed, { recursive: true });
    writeFileSync(
      join(older, "events.jsonl"),
      `${JSON.stringify({ type: "run.started", runId: "run-older" })}\n`,
    );
    // The newest run by modification time ends cleanly.
    writeFileSync(
      join(closed, "events.jsonl"),
      [
        JSON.stringify({ type: "run.started", runId: "run-closed" }),
        JSON.stringify({ type: "run.ended", exit: 0 }),
      ].join("\n") + "\n",
    );
    assert.deepEqual(theLiveRunOfTheEngineRecords(control), NO_LIVE_RUN);
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the reader: a torn events tail is a cut, not an absence; a broken registry is no evidence; nothing throws", () => {
  const control = anEmptyControl();
  try {
    writeFileSync(join(control, "procs.json"), "{ not json");
    const run = join(control, "runs", "run-torn");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "events.jsonl"), "{ torn\n");
    // The file STANDS and no clean end stands in it: the run it names was
    // cut, and the records show it open. A read that cannot answer never
    // throws — it only ever declines to name a live run where it must.
    const reading = theLiveRunOfTheEngineRecords(control);
    assert.equal(reading.live, true);
    assert.equal(reading.runId, "run-torn");
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the module exports one answer for no live run", () => {
  assert.equal(NO_LIVE_RUN.where, "");
  assert.equal(NO_LIVE_RUN.live, false);
});

/* ------------------------------------------------------------------ *
 * THE COMMAND. The workspace record is absent in every fixture here — the
 * engine of this build writes none — so every exit the command gives is the
 * live-run reading's doing, and the pins of `c108`/`c111` hold: exit 1 only
 * where NO state of any kind stood.
 * ------------------------------------------------------------------ */

test("`stop` on a live run shown by the registry: exit 0, no warnings, the sentence names the registry", () => {
  const control = anEmptyControl();
  try {
    writeFileSync(
      join(control, "procs.json"),
      JSON.stringify({ "run:run-abc:pass-in-flight": { pid: 4242 } }),
    );
    const result = runStop({
      controlRoot: control,
      workspaceRealPath: control,
      workdir: "/ws/live",
    });
    assert.equal(result.exitCode, 0, "the run's own records are state for the exit");
    assert.equal(result.stateExists, false, "no workspace record stands");
    assert.equal(result.liveRun.live, true);
    assert.equal(result.runAppearedActive, true);
    const warnings = result.lines.filter((l) => l.stream === "stderr").map((l) => l.text);
    assert.deepEqual(warnings, [], "the as-is warnings are absent where a run stands open");
    const stdout = result.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
    assert.equal(
      stdout.some((text) => text === aRunStandsOpenLine(result.liveRun)),
      true,
      `the sentence is missing: ${JSON.stringify(stdout)}`,
    );
    assert.ok(
      stdout.some((text) => text.includes(join(control, "procs.json"))),
      "the sentence does not name the file the answer came from",
    );
    // The request was written anyway — the surface's own contract.
    assert.equal(result.requestPath, join(control, "inbox", "stop.request"));
    assert.equal(readFileSync(result.requestPath, "utf8").includes(`"now": false`), true);
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("`stop` on a run standing open in the events: exit 0, and the sentence names the event file", () => {
  const control = anEmptyControl();
  try {
    const run = join(control, "runs", "run-open-9");
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, "events.jsonl"),
      `${JSON.stringify({ type: "pass.started", pass: 3 })}\n`,
    );
    const result = runStop({
      controlRoot: control,
      workspaceRealPath: control,
      workdir: "/ws/live",
      profile: "default",
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.runAppearedActive, true);
    assert.equal(result.liveRun.runId, "run-open-9");
    const stdout = result.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
    assert.ok(
      stdout.some((text) => text.includes(join(run, "events.jsonl"))),
      `the sentence does not name the event file: ${JSON.stringify(stdout)}`,
    );
    assert.deepEqual(
      result.lines.filter((l) => l.stream === "stderr").map((l) => l.text),
      [],
    );
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("`stop` where the records name nothing and no record stands: exit 1, the two as-is warnings byte for byte", () => {
  const control = anEmptyControl();
  try {
    const result = runStop({
      controlRoot: control,
      workspaceRealPath: control,
      workdir: "/ws/f102",
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stateExists, false);
    assert.equal(result.runAppearedActive, false);
    const warnings = result.lines.filter((l) => l.stream === "stderr").map((l) => l.text);
    assert.equal(warnings.length, 2);
    assert.equal(warnings[0], `no run appears to be active on /ws/f102 (lock is free).`);
    assert.equal(warnings[1], "writing stop.flag anyway (a starting run will honor it).");
    const stdout = result.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
    assert.equal(
      stdout.some((text) => text.includes("a run stands open")),
      false,
      "no sentence where nothing stands open",
    );
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("`stop` where the records name nothing but the workspace record stands: exit 0, the as-is warnings", () => {
  const { control, recordRoot } = aControlWithARecord();
  try {
    const result = runStop({
      controlRoot: recordRoot,
      workspaceRealPath: control,
      workdir: "/ws/f102",
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stateExists, true);
    assert.equal(result.runAppearedActive, false);
    const warnings = result.lines.filter((l) => l.stream === "stderr").map((l) => l.text);
    assert.equal(warnings.length, 2, "the as-is warnings keep their place");
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});

test("the sentence is silent under the parity profile, with the warnings kept", () => {
  const control = anEmptyControl();
  try {
    writeFileSync(
      join(control, "procs.json"),
      JSON.stringify({ "run:run-abc:pass-in-flight": { pid: 4242 } }),
    );
    const result = runStop({
      controlRoot: control,
      workspaceRealPath: control,
      workdir: "/ws/live",
      profile: "parity",
    });
    assert.equal(result.exitCode, 0);
    const stdout = result.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
    assert.equal(
      stdout.some((text) => text.includes("a run stands open")),
      false,
      "the sentence is a product line: silent under parity",
    );
    assert.deepEqual(
      result.lines.filter((l) => l.stream === "stderr").map((l) => l.text),
      [],
    );
  } finally {
    rmSync(control, { recursive: true, force: true });
  }
});
