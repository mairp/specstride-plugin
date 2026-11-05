/**
 * CT-144-109 (T013) — the rows that project to nothing and the field filter.
 *
 * proves: F144-FR-009; F144-FR-012
 *
 * F144-FR-009: *An event with no as-is equivalent MUST project to nothing: the
 * layer events (DV-016), `blocked` (DV-067), the seven `parallel.*` types and
 * every `x.` type. A field of a projected event that the old vocabulary lacks
 * (`seq`, `passId`, `category`, `strategy`) MUST NOT be projected. The
 * projection MUST write no line that has no as-is equivalent.*
 *
 * F144-FR-012: the thirteen types the event catalogue gained when feature 111
 * completed it after the split each have a row that projects to nothing, and
 * the two types feature 111 retired have no row at all.
 *
 * "Projects to nothing" is read as an EFFECT: the event is handed to a real
 * sink over a real control root, and the file it would have written is read
 * back and found unchanged. Row 19 of the `parity` profile — "lines with no
 * as-is equivalent ... never printed" — is what that effect is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BLOCKED_TYPE,
  FIELDS_NEVER_PROJECTED,
  GROUPS_WITH_NO_AS_IS_EQUIVALENT,
  PARALLEL_PREFIX,
  PARALLEL_TYPE_COUNT,
  THIRD_PARTY_PREFIX,
  TYPES_ADDED_AFTER_THE_SPLIT,
  TYPES_ADDED_AFTER_THE_SPLIT_COUNT,
  TYPES_RETIRED_BEFORE_THE_CATALOGUE,
  backendLabelOf,
  createCompatibilityProjection,
  dataWithoutFieldsTheOldVocabularyLacks,
  fieldIsNeverProjected,
  keysOfRow,
  projectionRows,
  projectsToNothing,
  readCatalogueTypes,
  rowsThatWriteNothing,
  selectRow,
  typesOfGroup,
  typesThatAlwaysWriteNothing,
  withoutFieldsTheOldVocabularyLacks,
  type EventContext,
} from "../../src/projection/index.ts";
import { profileRow } from "@specstride/contracts/profile/parity";
import { isNeverProjected } from "@specstride/contracts/ep/event-sink";

const CONTEXT: EventContext = Object.freeze({
  runId: "20261002-181527-42",
  project: "a-working-directory",
  backendLabel: backendLabelOf("claude", "claude"),
  featureSlug: "144-compatibility-projection",
  traceId: "0af7651916cd43dd8448eb211c80319c",
});

function sink() {
  const control = mkdtempSync(join(tmpdir(), "ct-144-109-"));
  const projection = createCompatibilityProjection({
    context: CONTEXT,
    layout: { runId: "run-1", slug: CONTEXT.featureSlug, engineStart: 1 },
    roots: { control },
    switches: { profile: "parity" },
  });
  projection.startEngineStart();
  return projection;
}

const envelope = (seq: number, type: string, data: Record<string, unknown> = {}) =>
  ({
    schema: "specstride.event",
    v: 1,
    seq,
    ts: "2026-10-02T18:15:27.500Z",
    type,
    runId: "run-1",
    launchId: "launch-1",
    engineStartId: "e1",
    data,
  }) as const;

const digest = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/* ------------------------------------------------------------------ *
 * The groups F144-FR-009 names.
 * ------------------------------------------------------------------ */

test("CT-144-109: the groups of F144-FR-009 are read out of the table by their register row", () => {
  assert.deepEqual(Object.keys(GROUPS_WITH_NO_AS_IS_EQUIVALENT), ["DV-016", "DV-067", "DV-088"]);
  // The layer events (DV-016).
  const layer = typesOfGroup("DV-016");
  assert.ok(layer.length > 0, "the table marks the layer events with DV-016");
  assert.ok(layer.includes("microloop.unit"), "the unit of the micro layer is one of them");
  // `blocked` (DV-067).
  assert.deepEqual([...typesOfGroup("DV-067")], [BLOCKED_TYPE]);
  // The seven types of parallel units (DV-088).
  const parallel = typesOfGroup("DV-088");
  assert.equal(parallel.length, PARALLEL_TYPE_COUNT, "seven, as F144-FR-009 counts them");
  for (const type of parallel) assert.ok(type.startsWith(PARALLEL_PREFIX), type);
  // Every type of every group writes nothing, under every one of its rows.
  const nothing = new Set(typesThatAlwaysWriteNothing());
  for (const type of [...layer, ...typesOfGroup("DV-067"), ...parallel]) {
    assert.equal(nothing.has(type), true, `${type} projects to nothing`);
  }
});

test("CT-144-109: each group projects to nothing as an EFFECT, not as a flag", () => {
  const projection = sink();
  const before = digest(projection.eventsFile);
  const types = [...typesOfGroup("DV-016"), ...typesOfGroup("DV-067"), ...typesOfGroup("DV-088")];
  types.forEach((type, index) => projection.receive(envelope(index + 1, type)));
  assert.equal(digest(projection.eventsFile), before, "the file is byte-for-byte unchanged");
  assert.equal(readFileSync(projection.eventsFile, "utf8"), "", "and still empty");
  assert.deepEqual([...projection.lines], [], "no line was rendered");
  assert.equal(projection.failures, 0, "and nothing failed");
});

test("CT-144-109: every `x.` type of a third party projects to nothing", () => {
  const projection = sink();
  const before = digest(projection.eventsFile);
  for (const type of ["x.vendor.thing", "x.a", "x.deeply.nested.type"]) {
    assert.equal(type.startsWith(THIRD_PARTY_PREFIX), true);
    assert.equal(projectsToNothing(type), true, type);
    assert.equal(isNeverProjected(type), true, "feature 100's own reading agrees");
    projection.receive(envelope(1, type, { anything: "at all" }));
  }
  assert.equal(digest(projection.eventsFile), before);
  // And no `x.` type is a row of the table: the catalogue holds none.
  assert.deepEqual(
    projectionRows.filter((row) => row.type.startsWith(THIRD_PARTY_PREFIX)),
    [],
  );
  assert.deepEqual(
    readCatalogueTypes().filter((type) => type.startsWith(THIRD_PARTY_PREFIX)),
    [],
  );
});

/* ------------------------------------------------------------------ *
 * No new line under `parity` (row 19 of annex X §X.7).
 * ------------------------------------------------------------------ */

/**
 * The `data` that makes the FIRST row of a type the selected one, built from
 * that row's own compiled condition. A conditioned type selects no row at all
 * when none of its conditions holds — a `job.ended` with no `kind`, say — and
 * then the projection writes nothing and fails nothing; this helper is how the
 * sweep below reaches the row each type actually has.
 */
function dataForFirstRowOf(type: string): Readonly<Record<string, unknown>> {
  const row = projectionRows.find((candidate) => candidate.type === type);
  if (row === undefined) return {};
  const condition = row.condition_;
  switch (condition.kind) {
    case "equals":
    case "one-of":
      return { [condition.field]: condition.values[0] };
    case "set":
      return { [condition.field]: "a-value" };
    case "writer-path":
      return condition.finalizer ? { status: "ok" } : {};
    case "always":
    case "otherwise":
      return {};
  }
}

test("CT-144-109: every type of the catalogue has a row some event of it selects", () => {
  for (const type of readCatalogueTypes()) {
    const data = dataForFirstRowOf(type);
    assert.notEqual(selectRow(type, data), undefined, `${type} selects a row`);
  }
  // And a conditioned type whose condition does not hold selects none, which
  // writes nothing rather than guessing: `job.ended` with no `kind`.
  assert.equal(selectRow("job.ended", {}), undefined);
  assert.equal(projectsToNothing("job.ended", {}), true);
  assert.notEqual(selectRow("job.ended", { kind: "long" }), undefined);
});

test("CT-144-109: no new line under `parity` — row 19 of the profile is what that is", () => {
  const row = profileRow(19);
  assert.ok(row !== undefined);
  assert.equal(row.switch, "Lines with no as-is equivalent, `[LOOP]` included");
  assert.equal(row.parity, "never printed");
  // The whole catalogue, event by event: a type whose row writes nothing never
  // puts a byte in the file, and a type whose row writes a line always does.
  const projection = sink();
  let seq = 0;
  let expected = 0;
  const types = readCatalogueTypes();
  for (const type of types) {
    seq += 1;
    const data = dataForFirstRowOf(type);
    const selected = selectRow(type, data);
    assert.notEqual(selected, undefined, `${type} has a row`);
    if (selected !== undefined && !selected.writesNothing && !selected.writesAPipelineFile) {
      expected += 1;
    }
    projection.receive(envelope(seq, type, { ...data }));
  }
  const written = readFileSync(projection.eventsFile, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  assert.equal(projection.failures, 0, "the whole catalogue projected without a failure");
  assert.equal(
    written.length,
    expected,
    "exactly the types whose row writes a line put a line in the file",
  );
  assert.ok(expected > 0 && expected < types.length, "both kinds are present");
  // And the count of the rows that write nothing is the count of the table.
  assert.equal(
    rowsThatWriteNothing().length,
    projectionRows.filter((candidate) => candidate.writesNothing).length,
  );
});

/* ------------------------------------------------------------------ *
 * The four fields the old vocabulary lacks.
 * ------------------------------------------------------------------ */

test("CT-144-109: `seq`, `passId`, `category` and `strategy` are in NO projected line", () => {
  assert.deepEqual([...FIELDS_NEVER_PROJECTED], ["seq", "passId", "category", "strategy"]);
  for (const field of FIELDS_NEVER_PROJECTED) assert.equal(fieldIsNeverProjected(field), true);
  assert.equal(fieldIsNeverProjected("iter"), false, "an as-is key is not filtered");

  // The whole catalogue again, this time with all four fields present in the
  // `data` of every event and in the envelope: not one of them reaches a line.
  const projection = sink();
  let seq = 0;
  for (const type of readCatalogueTypes()) {
    seq += 1;
    projection.receive({
      ...envelope(seq, type, {
        seq: 999,
        passId: "pass-999",
        category: "a-category",
        strategy: "micro",
        phase: 1,
        attempt: 1,
        iter: 1,
      }),
      passId: "pass-999",
      strategy: "micro",
    });
  }
  const text = readFileSync(projection.eventsFile, "utf8");
  assert.ok(text.length > 0, "there are lines to check");
  for (const field of FIELDS_NEVER_PROJECTED) {
    assert.equal(text.includes(`"${field}"`), false, `no line holds the key ${field}`);
  }
  assert.equal(text.includes("pass-999"), false, "and no line holds its value either");
  assert.equal(text.includes("a-category"), false);

  // The filter itself, over the pairs of a line and over a `data`.
  assert.deepEqual(
    withoutFieldsTheOldVocabularyLacks([
      ["seq", "1"],
      ["iter", "2"],
      ["passId", "p"],
      ["category", "c"],
      ["strategy", "micro"],
      ["phase", "1"],
    ]).map(([key]) => key),
    ["iter", "phase"],
  );
  assert.deepEqual(
    Object.keys(
      dataWithoutFieldsTheOldVocabularyLacks({
        seq: 1,
        passId: "p",
        category: "c",
        strategy: "s",
        iter: 2,
      }),
    ),
    ["iter"],
  );
  // No field map of the table names one of them, in either reading of the cell.
  for (const row of projectionRows) {
    for (const key of keysOfRow(row, {})) {
      assert.equal(fieldIsNeverProjected(key), false, `${row.type} names ${key}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * F144-FR-012 — the thirteen types added after the split.
 * ------------------------------------------------------------------ */

test("CT-144-109: the thirteen types of F144-FR-012 are included, each writing nothing", () => {
  assert.equal(TYPES_ADDED_AFTER_THE_SPLIT.length, TYPES_ADDED_AFTER_THE_SPLIT_COUNT);
  assert.equal(TYPES_ADDED_AFTER_THE_SPLIT_COUNT, 13);
  const types = readCatalogueTypes();
  const nothing = new Set(typesThatAlwaysWriteNothing());
  for (const type of TYPES_ADDED_AFTER_THE_SPLIT) {
    assert.equal(types.includes(type), true, `${type} is a type of the catalogue`);
    assert.notEqual(selectRow(type, {}), undefined, `${type} has a row`);
    assert.equal(nothing.has(type), true, `${type} projects to nothing`);
    assert.equal(projectsToNothing(type), true);
  }
  // The two types feature 111 retired have no row, and that is not a gap.
  for (const type of TYPES_RETIRED_BEFORE_THE_CATALOGUE) {
    assert.equal(types.includes(type), false, `${type} is no type of the catalogue`);
    assert.equal(selectRow(type, {}), undefined, `${type} has no row`);
    assert.equal(projectsToNothing(type), true, "and so it projects to nothing");
  }
  // The effect: the thirteen leave the file untouched.
  const projection = sink();
  const before = digest(projection.eventsFile);
  TYPES_ADDED_AFTER_THE_SPLIT.forEach((type, index) =>
    projection.receive(envelope(index + 1, type, { anything: 1 })),
  );
  assert.equal(digest(projection.eventsFile), before);
  assert.deepEqual([...projection.lines], []);
});

test("CT-144-109: none of the thirteen is named by a requirement of this feature", () => {
  // F144-FR-012's last sentence. The rows of the thirteen carry the note "type
  // added after the split" and no old name; a later feature that gives one of
  // them an as-is equivalent changes the row, and this test with it.
  for (const type of TYPES_ADDED_AFTER_THE_SPLIT) {
    const rows = projectionRows.filter((row) => row.type === type);
    assert.equal(rows.length, 1, `${type} has one row`);
    const row = rows[0];
    assert.ok(row !== undefined);
    assert.equal(row.legacyTarget, "-", `${type} targets no old name`);
    assert.equal(row.shapeOfRow, "none");
    assert.deepEqual([...row.targets], []);
  }
});
