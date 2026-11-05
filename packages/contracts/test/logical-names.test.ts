/**
 * T033 — contract tests CT-100-153, CT-100-154 and CT-100-156 for Logical
 * names (annex B, §B.5; F100-FR-053, F100-FR-054, F100-FR-056).
 */
import test from "node:test";
import assert from "node:assert/strict";
import layout from "../data/layout.json" with { type: "json" };
import {
  COMPARED_PIPELINE_NAMES,
  CURRENT_RUN_NAMES,
  LOGICAL_NAMES,
  MissingParameterError,
  UnknownLogicalNameError,
  holdsLogicalName,
  layoutVersion,
  logicalNameRows,
  namesOfFeature,
  parametersOfName,
  readersOf,
  resolve,
  resolveCurrent,
  rootOf,
  rowOf,
  writerOf,
} from "../src/ids/logical-names.ts";
import { APPROVAL_MARKER_LOGICAL_NAME, comparedRows } from "../src/profile/layout-old-side.ts";

const ROOTS = {
  "<user-config>": "/cfg",
  "<user-state>": "/state",
  "<user-cache>": "/cache",
  "<control>": "/state/ws",
  "<workspace>": "/repo",
  "<workspace-part>": "/repo/.specstride",
  "<worker-root>": "/cache/workers",
  "<temp>": "/tmp",
  "<package>": "/pkg",
  "<harness-home>": "/hh",
};

const EVERY_PARAMETER = {
  "<workspaceId>": "ws",
  "<slug>": "100-specstride",
  "<runId>": "run-1",
  "<N>": 3,
  "<k>": 1,
  "<n>": 2,
  "<launchId>": "l-1",
  "<pipelineId>": "p-1",
  "<hash>": "h",
  "<id>": "claude",
  "<jobId>": "j-1",
  "<passId>": "pa-1",
  "<unitId>": "u-1",
  "<unit-key>": "uk",
  "<i>": 0,
  "<name>": "nm",
  "<NNN>": "001",
  "<opaque>": "o",
  "<profile>": "parity",
  "<random>": "r",
  "<writer>": "engine",
  "<path chosen at rendering>": "x",
};

test("CT-100-153: the table is the complete list of logical names, each with a root, one writer and readers (F100-FR-053)", () => {
  const raw = (layout as { logicalNames: { logicalName: string }[] }).logicalNames;
  assert.equal(LOGICAL_NAMES.length, raw.length);
  assert.equal(new Set(LOGICAL_NAMES).size, LOGICAL_NAMES.length, "each name once");
  assert.match(layoutVersion, /^\d+\.\d+$/);
  for (const row of logicalNameRows) {
    assert.notEqual(row.root, undefined);
    assert.notEqual(row.writer, "");
    assert.ok(Array.isArray(row.readers));
    assert.notEqual(row.path, "");
  }
  // A name the table does not hold is refused; a feature reports the need.
  assert.ok(!holdsLogicalName("feature:<slug>:invented"));
  assert.throws(
    () => rowOf("feature:<slug>:invented"),
    (err: unknown) => {
      assert.ok(err instanceof UnknownLogicalNameError);
      assert.match(err.message, /a feature that needs one reports the need/);
      assert.match(err.message, new RegExp(layoutVersion.replace(".", "\\.")));
      return true;
    },
  );
  assert.equal(rootOf("workspace:record"), "control");
  assert.equal(writerOf("gate:<N>:approved"), "Engine");
  assert.ok(readersOf("workspace:record").includes("All"));
});

test("CT-100-153: every name resolves with its parameters, and a missing parameter is refused", () => {
  for (const name of LOGICAL_NAMES) {
    const path = resolve(name, EVERY_PARAMETER, ROOTS);
    assert.doesNotMatch(path, /<[^>]+>/, `${name} left a placeholder in ${path}`);
    assert.ok(path.startsWith("/"), `${name} resolved to ${path}`);
  }
  assert.equal(
    resolve("gate:<N>:approved", EVERY_PARAMETER, ROOTS),
    "/state/ws/features/100-specstride/approvals/phase-3.json",
  );
  assert.throws(() => resolve("gate:<N>:approved", {}, ROOTS), MissingParameterError);
  assert.ok(parametersOfName("pipeline:<pipelineId>:bundle:<hash>").includes("<hash>"));
  // The state of a feature is reachable under the feature slug (F100-FR-055).
  const ofFeature = namesOfFeature("100-specstride");
  assert.ok(ofFeature.length > 0);
  for (const name of ofFeature) assert.match(name, /^feature:100-specstride:/);
});

test("CT-100-154: the five compared names of the pipeline and the engine log (F100-FR-054)", () => {
  assert.deepEqual(
    [...COMPARED_PIPELINE_NAMES],
    [
      "pipeline:<pipelineId>:launcher-log",
      "pipeline:<pipelineId>:report-log",
      "pipeline:<pipelineId>:launch-log",
      "pipeline:<pipelineId>:harness-run",
      "run:<runId>:engine-log",
    ],
  );
  for (const name of COMPARED_PIPELINE_NAMES) {
    assert.ok(holdsLogicalName(name), `${name} must be in §B.5`);
    // The compatibility projection writes the four of the pipeline as files.
    if (name.startsWith("pipeline:")) {
      assert.match(writerOf(name), /Compatibility projection/);
    }
  }
  assert.equal(writerOf("run:<runId>:engine-log"), "Engine");
});

test("CT-100-155: the two names that resolve to the current run (F100-FR-055)", () => {
  assert.deepEqual(
    [...CURRENT_RUN_NAMES],
    ["workspace:current:events", "workspace:current:engine-log"],
  );
  assert.equal(
    resolveCurrent("workspace:current:events", "run-9", EVERY_PARAMETER, ROOTS),
    resolve("run:<runId>:events", { ...EVERY_PARAMETER, "<runId>": "run-9" }, ROOTS),
  );
  assert.equal(
    resolveCurrent("workspace:current:engine-log", "run-9", EVERY_PARAMETER, ROOTS),
    resolve("run:<runId>:engine-log", { ...EVERY_PARAMETER, "<runId>": "run-9" }, ROOTS),
  );
});

test("CT-100-156: the old side maps the as-is approval marker to gate:<N>:approved (F100-FR-056)", () => {
  assert.equal(APPROVAL_MARKER_LOGICAL_NAME, "gate:<N>:approved");
  assert.ok(holdsLogicalName(APPROVAL_MARKER_LOGICAL_NAME));
  assert.ok(comparedRows.length > 0);
  const approval = comparedRows.find((r) => r.logicalName === APPROVAL_MARKER_LOGICAL_NAME);
  assert.ok(approval !== undefined, "the old side maps the as-is approval marker");
  // Every compared row of the old side names a logical name the table holds.
  for (const row of comparedRows) {
    assert.ok(
      holdsLogicalName(row.logicalName),
      `${row.logicalName} (from "${row.asIsPath}") must be in §B.5`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * T303 — the logical names added on 2026-09-30 (layout 1.2): the
 * per-start form of the engine log, the legacy learning event file of a
 * feature, and the bare `run:<runId>:engine-log` resolving to the file of
 * the newest engine start, as `run:<runId>:events-legacy` does
 * (annex B, §B.5; F100-FR-054, F100-FR-226).
 * ------------------------------------------------------------------ */

test("T303: the layout of the amendment is 1.2 and holds the two names added (F100-FR-226)", () => {
  assert.equal(layoutVersion, "1.2");
  assert.equal(LOGICAL_NAMES.length, 127);
  // The per-start form of the engine log, and the legacy learning event file.
  assert.ok(holdsLogicalName("run:<runId>:engine-log:<k>"));
  assert.ok(holdsLogicalName("feature:<slug>:learning:events-legacy"));
});

test("T303: the per-start engine log carries <k> and resolves to the file of that start", () => {
  const row = rowOf("run:<runId>:engine-log:<k>");
  assert.equal(row.root, "control");
  assert.equal(row.writer, "Compatibility projection");
  assert.ok(parametersOfName("run:<runId>:engine-log:<k>").includes("<k>"));
  assert.equal(
    resolve("run:<runId>:engine-log:<k>", { ...EVERY_PARAMETER, "<k>": 4 }, ROOTS),
    "/state/ws/features/100-specstride/runs/run-1/compat/run.e4.log",
  );
  // A different start is a different file: the name is per start, not per run.
  assert.notEqual(
    resolve("run:<runId>:engine-log:<k>", { ...EVERY_PARAMETER, "<k>": 4 }, ROOTS),
    resolve("run:<runId>:engine-log:<k>", { ...EVERY_PARAMETER, "<k>": 5 }, ROOTS),
  );
});

test("T303: the legacy learning event file of a feature has one writer and its own path", () => {
  const row = rowOf("feature:<slug>:learning:events-legacy");
  assert.equal(row.root, "control");
  assert.equal(row.writer, "Compatibility projection");
  assert.equal(
    resolve("feature:<slug>:learning:events-legacy", EVERY_PARAMETER, ROOTS),
    "/state/ws/features/100-specstride/compat/learning-events.jsonl",
  );
  // It is the feature's file, not the run's: it carries <slug> and no <runId>.
  assert.deepEqual([...parametersOfName("feature:<slug>:learning:events-legacy")], ["<slug>"]);
  // It is a name of the feature, so it is reachable under the slug.
  assert.ok(
    namesOfFeature("100-specstride").includes("feature:100-specstride:learning:events-legacy"),
  );
});

test("T303: the bare engine log resolves to the newest start, as events-legacy does", async () => {
  const { NEWEST_ENGINE_START_NAMES, MissingEngineStartError, perStartNameOf, resolveEngineStart } =
    await import("../src/ids/logical-names.ts");
  // Both bare names resolve through their per-start form (annex B, §B.5).
  assert.deepEqual([...NEWEST_ENGINE_START_NAMES].sort(), [
    "run:<runId>:engine-log",
    "run:<runId>:events-legacy",
  ]);
  assert.equal(perStartNameOf("run:<runId>:engine-log"), "run:<runId>:engine-log:<k>");
  assert.equal(perStartNameOf("run:<runId>:events-legacy"), "run:<runId>:events-legacy:<k>");
  assert.equal(perStartNameOf("run:<runId>:events"), undefined);
  // The bare name with the ordinal of the newest start gives that start's file,
  // and never the prose of the cell ("the file of the newest engine start").
  for (const bare of NEWEST_ENGINE_START_NAMES) {
    const viaBare = resolve(bare, { ...EVERY_PARAMETER, "<k>": 7 }, ROOTS);
    const viaPerStart = resolve(
      perStartNameOf(bare) as string,
      { ...EVERY_PARAMETER, "<k>": 7 },
      ROOTS,
    );
    assert.equal(viaBare, viaPerStart);
    assert.equal(resolveEngineStart(bare, 7, EVERY_PARAMETER, ROOTS), viaPerStart);
    assert.ok(!viaBare.includes("newest"), `${bare} resolves to a path, not to the prose`);
    assert.ok(!viaBare.endsWith("/"), `${bare} resolves to a file, not to the directory`);
  }
  assert.equal(
    resolve("run:<runId>:engine-log", { ...EVERY_PARAMETER, "<k>": 7 }, ROOTS),
    "/state/ws/features/100-specstride/runs/run-1/compat/run.e7.log",
  );
  assert.equal(
    resolve("run:<runId>:events-legacy", { ...EVERY_PARAMETER, "<k>": 7 }, ROOTS),
    "/state/ws/features/100-specstride/runs/run-1/compat/events.legacy.e7.jsonl",
  );
  // Without the ordinal of a start the bare name is refused, and the message
  // names the per-start form.
  const withoutK = { ...EVERY_PARAMETER } as Record<string, string | number>;
  delete withoutK["<k>"];
  assert.throws(
    () => resolve("run:<runId>:engine-log", withoutK, ROOTS),
    (error: unknown) =>
      error instanceof MissingEngineStartError &&
      /run:<runId>:engine-log:<k>/.test((error as Error).message),
  );
});
