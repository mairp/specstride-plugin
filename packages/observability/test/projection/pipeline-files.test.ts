/**
 * CT-144-110 (T015) — the four pipeline files, and `[MOL-RELAUNCH]` under
 * `relaunch.owner: root`.
 *
 * proves: F144-FR-010
 *
 * F144-FR-010: *The projection MUST write the compared logs and records of the
 * pipeline runtime and the supervisor, named by F100-FR-054, from the events
 * `pipeline.*`, `stage.*`, `launch.checked`, `supervisor.*` and
 * `digest.written`, with the text of the lines of annex G §G.3. With
 * `relaunch.owner: root` it MUST render `[MOL-RELAUNCH]` from the root's
 * `supervisor.relaunch` event. The text of each line belongs to the feature
 * that prints it.*
 *
 * The four files are read from the layout table of feature 100 and not from a
 * list of this feature's own: `COMPARED_PIPELINE_NAMES` of F100-FR-054 holds
 * five names, and the four whose writer the table gives as "Compatibility
 * projection" are these; the fifth is the engine log, which the halt rail of
 * F144-FR-007 appends to.
 *
 * The TEXT of each line comes from `printLine` over the key tables of annex G
 * §G.3, which refuses a key the table of the label does not hold — so this
 * feature cannot add a field to a line of feature 123. That refusal is tested
 * here as the mechanism it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENGINE_LOG,
  HARNESS_RUN,
  LABEL_OF_TYPE,
  LAUNCHER_LOG,
  LAUNCH_LOG,
  PIPELINE_FILES,
  PIPELINE_FILE_COUNT,
  PIPELINE_FILES_ARE_THE_NAMES_OF_F100_FR_054,
  REPORT_LOG,
  TYPE_PREFIXES,
  WHOLE_TYPES,
  backendLabelOf,
  createCompatibilityProjection,
  isAPipelineFileType,
  projectionRows,
  relaunchLineIsRendered,
  writesOfEvent,
  type EventContext,
} from "../../src/projection/index.ts";
import {
  COMPARED_PIPELINE_NAMES,
  holdsLogicalName,
  resolve,
  writerOf,
} from "@specstride/contracts/ids/logical-names";
import { parseLine, parsePairs } from "@specstride/contracts/grammar/lines";
import { printLine, UnknownLineKeyError } from "@specstride/contracts/grammar/line-keys";
import {
  DEFAULT as DEFAULT_RELAUNCH_OWNER,
  KEY as RELAUNCH_OWNER_KEY,
  RELAUNCH_OWNERS,
} from "@specstride/contracts/state/relaunch-owner";

const PIPELINE_ID = "pl-20261002";

const CONTEXT: EventContext = Object.freeze({
  runId: "20261002-181527-42",
  project: "a-working-directory",
  backendLabel: backendLabelOf("claude", "claude"),
  featureSlug: "144-compatibility-projection",
  traceId: "0af7651916cd43dd8448eb211c80319c",
});

function sink(relaunchOwner: (typeof RELAUNCH_OWNERS)[number] = DEFAULT_RELAUNCH_OWNER) {
  const control = mkdtempSync(join(tmpdir(), "ct-144-110-"));
  const projection = createCompatibilityProjection({
    context: CONTEXT,
    layout: { runId: "run-1", slug: CONTEXT.featureSlug, engineStart: 1 },
    roots: { control },
    switches: { profile: "parity" },
    pipeline: { pipelineId: PIPELINE_ID, relaunchOwner, fromTheRoot: true },
  });
  projection.startEngineStart();
  return { projection, control };
}

const envelope = (seq: number, type: string, data: Record<string, unknown>) =>
  ({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: "2026-10-02T18:15:27.500Z",
    type,
    runId: "run-1",
    launchId: "launch-1",
    data,
  }) as const;

const pathOf = (logicalName: string, control: string): string =>
  resolve(logicalName, { "<pipelineId>": PIPELINE_ID }, { "<control>": control });

/* ------------------------------------------------------------------ *
 * The four files are the names of F100-FR-054.
 * ------------------------------------------------------------------ */

test("CT-144-110: the four files are the names of F100-FR-054 whose writer is this sink", () => {
  assert.equal(PIPELINE_FILES.length, PIPELINE_FILE_COUNT);
  assert.equal(PIPELINE_FILE_COUNT, 4);
  assert.equal(PIPELINE_FILES_ARE_THE_NAMES_OF_F100_FR_054, true);
  assert.equal(COMPARED_PIPELINE_NAMES.length, 5, "F100-FR-054 names five");
  assert.deepEqual(
    COMPARED_PIPELINE_NAMES.filter((name) => name !== ENGINE_LOG),
    [...PIPELINE_FILES],
  );
  assert.deepEqual([...PIPELINE_FILES], [LAUNCHER_LOG, REPORT_LOG, LAUNCH_LOG, HARNESS_RUN]);
  for (const name of PIPELINE_FILES) {
    assert.equal(holdsLogicalName(name), true, `${name} is a row of annex B §B.5`);
    assert.equal(writerOf(name), "Compatibility projection", `the one writer of ${name}`);
  }
  // The fifth name is the engine log, and its writer is this sink too — it is
  // the file the halt rail of F144-FR-007 appends to, not a pipeline file.
  assert.equal(holdsLogicalName(ENGINE_LOG), true);
});

test("CT-144-110: the types of F144-FR-010 are the types whose rows name a file", () => {
  for (const type of [...TYPE_PREFIXES].map((prefix) => `${prefix}x`)) {
    assert.equal(isAPipelineFileType(type), true, type);
  }
  for (const type of WHOLE_TYPES) assert.equal(isAPipelineFileType(type), true, type);
  assert.equal(isAPipelineFileType("run.started"), false);
  // The table's own marking: a row of shape `none` whose target names a FILE.
  const marked = projectionRows.filter((row) => row.writesAPipelineFile).map((row) => row.type);
  assert.deepEqual([...marked].sort(), [
    "digest.written",
    "launch.checked",
    "pipeline.ended",
    "pipeline.started",
    "stage.ended",
    "stage.started",
    "supervisor.observed",
    "supervisor.relaunch",
    "supervisor.stopped",
  ]);
  for (const type of marked) assert.equal(isAPipelineFileType(type), true, type);
  // Such a row writes no as-is event line: it is the mechanism of F144-FR-010.
  for (const type of marked) {
    const row = projectionRows.find((candidate) => candidate.type === type);
    assert.equal(row?.writesNothing, false, `${type} is not a row that writes nothing`);
    assert.deepEqual([...(row?.targets ?? [])], [], `${type} targets no old event name`);
  }
});

/* ------------------------------------------------------------------ *
 * The four files are written, each from the events F144-FR-010 names.
 * ------------------------------------------------------------------ */

test("CT-144-110: a run of the pipeline writes all four files, each from its own events", () => {
  const { projection, control } = sink();
  const script: readonly (readonly [string, Record<string, unknown>])[] = [
    [
      "pipeline.started",
      { pipelineId: PIPELINE_ID, mode: "detached", stages: 2, launcherRef: "a-launcher" },
    ],
    ["launch.checked", { check: "lock", status: "pass", reason: null, detail: null }],
    ["launch.checked", { decision: "go", reason: "every check passed", detail: null }],
    ["stage.started", { stageId: "s1", kind: "run" }],
    ["stage.ended", { outcome: "completed", reason: null, exitCode: 0 }],
    ["supervisor.observed", { exitCode: 0, childExit: null, stopReason: null, budgetLeft: 2 }],
    [
      "supervisor.relaunch",
      {
        attempt: 1,
        reason: "exit",
        exit: 23,
        childExit: 1,
        stage: "s1",
        stopReason: null,
        budgetRemaining: 1,
        detail: null,
      },
    ],
    ["supervisor.stopped", { sent: "TERM", detail: null }],
    [
      "digest.written",
      { state: "failed", exit: 23, lastStage: "s1", childExit: 1, evidencePath: "a-digest" },
    ],
    [
      "pipeline.ended",
      {
        state: "failed",
        exitReason: "stage",
        exitCode: 23,
        lastStage: "s1",
        childExit: 1,
        evidencePath: "a-digest",
      },
    ],
  ];
  script.forEach(([type, data], index) => projection.receive(envelope(index + 1, type, data)));
  assert.equal(projection.failures, 0);

  // All four files exist, read back from the resolver's paths.
  for (const name of PIPELINE_FILES) {
    const file = pathOf(name, control);
    assert.equal(existsSync(file), true, `${name} was written to ${file}`);
    assert.ok(readFileSync(file, "utf8").length > 0, `${name} holds content`);
  }
  // And no as-is event line was written: these events project to no old name.
  assert.deepEqual([...projection.lines], []);
  assert.equal(readFileSync(projection.eventsFile, "utf8"), "");

  // Each file holds the labels F144-FR-010 assigns to it.
  const labelsOf = (name: string): string[] =>
    readFileSync(pathOf(name, control), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => parseLine(line).label);
  assert.deepEqual(labelsOf(LAUNCHER_LOG), [
    "MOL-LAUNCH",
    "MOL-STATE",
    "MOL-STATE",
    "DIGEST",
    "MOL-DIGEST",
  ]);
  assert.deepEqual(labelsOf(REPORT_LOG), [
    "MOL-GATE",
    "MOL-GATE",
    "MOL-STATE",
    "MOL-RELAUNCH",
    "MOL-STOP",
  ]);
  assert.deepEqual(labelsOf(LAUNCH_LOG), ["MOL-GATE", "MOL-GATE"]);
  // The record is a record, not a log of labelled lines.
  const records = readFileSync(pathOf(HARNESS_RUN, control), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(records.length, 2, "one at the start of the pipeline and one at its end");
  assert.equal(records[0]?.pipeline, PIPELINE_ID);
  assert.equal(records[1]?.state, "failed");
});

test("CT-144-110: the text of every line is the grammar of annex G §G.3", () => {
  const { projection, control } = sink();
  projection.receive(
    envelope(1, "digest.written", {
      state: "completed",
      exit: 0,
      lastStage: "s2",
      childExit: null,
      evidencePath: "a-digest",
    }),
  );
  const line = readFileSync(pathOf(LAUNCHER_LOG, control), "utf8").trim();
  const parsed = parseLine(line);
  assert.equal(parsed.label, "DIGEST");
  assert.deepEqual(
    parsePairs(parsed.body).map(([key]) => key),
    ["state", "exit", "last-stage", "evidence"],
    "the keys and their order are the annex's",
  );
  // The keys of a line are the annex's: `printLine` refuses one it does not
  // hold, so this feature cannot invent a field of a line of feature 123.
  assert.throws(
    () => printLine("MOL-STOP", { pipeline: "p", invented_by_144: "x" }),
    UnknownLineKeyError,
  );
  // And every label this feature renders is a label the grammar knows.
  for (const label of Object.values(LABEL_OF_TYPE)) {
    assert.doesNotThrow(() => parseLine(`[${label}] a=b`));
    assert.notEqual(parseLine(`[${label}] a=b`).family, undefined, `${label} has a family`);
  }
});

/* ------------------------------------------------------------------ *
 * `[MOL-RELAUNCH]` under `relaunch.owner: root`.
 * ------------------------------------------------------------------ */

test("CT-144-110: under `relaunch.owner: root` the root's event renders `[MOL-RELAUNCH]`", () => {
  assert.equal(RELAUNCH_OWNER_KEY, "relaunch.owner");
  assert.deepEqual([...RELAUNCH_OWNERS], ["root", "supervise"]);
  assert.equal(DEFAULT_RELAUNCH_OWNER, "root");
  const { projection, control } = sink("root");
  projection.receive(
    envelope(1, "supervisor.relaunch", {
      attempt: 2,
      reason: "child-exit",
      exit: 23,
      childExit: 6,
      stage: "s1",
      stopReason: null,
      budgetRemaining: 1,
      detail: null,
    }),
  );
  const line = readFileSync(pathOf(REPORT_LOG, control), "utf8").trim();
  assert.ok(line.startsWith("[MOL-RELAUNCH] "), line);
  const pairs = new Map(parsePairs(parseLine(line).body));
  assert.equal(pairs.get("pipeline"), PIPELINE_ID);
  assert.equal(pairs.get("attempt"), "2");
  assert.equal(pairs.get("reason"), "child-exit");
  assert.equal(pairs.get("exit"), "23");
  assert.equal(pairs.get("child-exit"), "6");
  assert.equal(pairs.get("budget-remaining"), "1");
  assert.equal(relaunchLineIsRendered({ pipelineId: PIPELINE_ID, relaunchOwner: "root" }), true);
});

test("CT-144-110: under `relaunch.owner: supervise` the projection renders no such line", () => {
  const { projection, control } = sink("supervise");
  projection.receive(
    envelope(1, "supervisor.relaunch", { attempt: 2, reason: "child-exit", exit: 23 }),
  );
  assert.equal(
    relaunchLineIsRendered({ pipelineId: PIPELINE_ID, relaunchOwner: "supervise" }),
    false,
  );
  assert.equal(existsSync(pathOf(REPORT_LOG, control)), false, "no report log was created");
  assert.deepEqual(
    writesOfEvent(
      "supervisor.relaunch",
      { attempt: 2 },
      { pipelineId: PIPELINE_ID, relaunchOwner: "supervise" },
    ),
    [],
  );
  // The default of §F.4 is `root`, so a context that names no owner renders it.
  assert.equal(relaunchLineIsRendered({ pipelineId: PIPELINE_ID }), true);
});

test("CT-144-110: a line that is not the root's is not rendered by the root's projection", () => {
  // F144-FR-010 names the ROOT's `supervisor.relaunch` event.
  assert.equal(
    relaunchLineIsRendered({ pipelineId: PIPELINE_ID, relaunchOwner: "root", fromTheRoot: false }),
    false,
  );
  assert.equal(
    relaunchLineIsRendered({ pipelineId: PIPELINE_ID, relaunchOwner: "root", fromTheRoot: true }),
    true,
  );
});

test("CT-144-110: with the projection off not one of the four files exists", () => {
  const control = mkdtempSync(join(tmpdir(), "ct-144-110-off-"));
  const projection = createCompatibilityProjection({
    context: CONTEXT,
    layout: { runId: "run-1", slug: CONTEXT.featureSlug, engineStart: 1 },
    roots: { control },
    switches: { profile: "default" },
    pipeline: { pipelineId: PIPELINE_ID, relaunchOwner: "root", fromTheRoot: true },
  });
  projection.receive(
    envelope(1, "pipeline.started", { pipelineId: PIPELINE_ID, mode: "detached", stages: 2 }),
  );
  projection.receive(
    envelope(2, "digest.written", {
      state: "completed",
      exit: 0,
      lastStage: "s1",
      evidencePath: "d",
    }),
  );
  for (const name of PIPELINE_FILES) {
    assert.equal(existsSync(pathOf(name, control)), false, `${name} does not exist`);
  }
  assert.equal(projection.failures, 0);
});
