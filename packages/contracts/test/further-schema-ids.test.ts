/**
 * T211 — contract tests CT-100-327 and CT-100-329 for the further schema ids
 * and the names added to the layout (annex B, §B.20 and §B.5; F100-FR-227,
 * F100-FR-229).
 *
 * CT-100-327: every record of the table of §B.20 carries its schema id and
 * follows the common rules of §B.4; the fields are with the owner, which also
 * delivers the schema file; a reader reads such a record by its logical name and
 * through its schema; and the as-is name of a record is written where the
 * baseline writes it.
 *
 * CT-100-329: the as-is event file is written once per engine start, under
 * `run:<runId>:events-legacy:<k>`; the consumer's comment is kept verbatim after
 * redaction under `launch:<launchId>:comment`, and the launch record holds only
 * its hash; `workspace:current:status-line` is placed by the real path of the
 * workspace only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANNEX_SECTION as B20,
  AS_IS_NAMES,
  AS_IS_NAME_IS_WRITTEN_IN,
  COMMON_RULES_SECTION,
  EVERY_RECORD_CARRIES_ITS_SCHEMA_ID,
  FEATURE_100_FIXES,
  FEATURE_100_FIXES_NO_FIELD,
  FIELDS_ARE_LISTED_BY,
  FURTHER_SCHEMA_IDS,
  FURTHER_SCHEMA_ID_COUNT,
  INTERNAL_ID_PREFIX,
  OWNER_DELIVERS_THE_SCHEMA_FILE,
  PRODUCT_ID_PREFIX,
  UnknownFurtherSchemaIdError,
  asIsNameOfSchemaId,
  followsTheCommonRulesOfB4,
  furtherSchemaIdRows,
  holdsSchemaId,
  logicalNameOfSchemaId,
  logicalNamesAreOfTheLayout,
  majorOfSchemaId,
  ownerOf,
  readByLogicalName,
  recordOf,
  rowOfLogicalName,
  rowOfSchemaId,
  rowsOfOwner,
} from "../src/ids/further-schema-ids.ts";
import {
  AMENDED_LOGICAL_NAMES,
  AMENDED_LOGICAL_NAME_COUNT,
  COMMENT_HASH_FIELD,
  COMMENT_NAME,
  COMMENT_RULE,
  EVENTS_LEGACY_BARE,
  EVENTS_LEGACY_PER_START,
  EVENT_FILE_IS_WRITTEN_ONCE_PER_ENGINE_START,
  FIRST_AMENDED_NAME,
  LAST_AMENDED_NAME,
  LAUNCH_RECORD_HOLDS_ONLY_THE_HASH,
  RULES_OF_THE_AMENDMENT,
  STATUS_LINE_NAME,
  STATUS_LINE_RULE,
  STATUS_LINE_TARGET,
  bareNameResolvesThroughThePerStartName,
  isAmendedLogicalName,
  launchRecordMayCarry,
  parametersOfTheStatusLine,
  resolveAmended,
  resolveComment,
  resolveEventsLegacy,
  resolveNewestEventsLegacy,
  resolveStatusLine,
  rowNumberOf,
  rowsOfTheAmendment,
  statusLineDependsOnTheWorkspaceOnly,
  writerOfTheEventFile,
} from "../src/ids/logical-names-amendments.ts";
import { holdsLogicalName, layoutVersion, resolve, rowOf } from "../src/ids/logical-names.ts";

const ROOTS = Object.freeze({ "<control>": "/state/workspaces/W1" });

/** The data file the registry reads, read again here as the test's own source. */
const DATA = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "data", "further-schema-ids.json"), "utf8"),
) as { annex: string; schemaIds: { "Schema id": string; Owner: string; "Logical name": string }[] };

/* ------------------------------------------------------------------ *
 * CT-100-327 — the further schema ids (annex B, §B.20; F100-FR-227).
 * ------------------------------------------------------------------ */

test("CT-100-327: the registry is the table of §B.20, row for row (F100-FR-227)", () => {
  assert.equal(B20, "annex B, §B.20");
  assert.equal(DATA.annex, "annex B, §B.20");
  assert.equal(FURTHER_SCHEMA_ID_COUNT, DATA.schemaIds.length);
  assert.equal(FURTHER_SCHEMA_ID_COUNT, 21);
  assert.deepEqual(
    [...FURTHER_SCHEMA_IDS],
    DATA.schemaIds.map((r) => r["Schema id"].replace(/`/g, "").trim()),
    "the ids are those of the data file, in the order of the annex",
  );
  // Feature 100 fixes three things and no more: the schema id, the logical
  // name and the owner.
  assert.deepEqual([...FEATURE_100_FIXES], ["schema id", "logical name", "owner"]);
  assert.equal(FEATURE_100_FIXES_NO_FIELD, true);
  assert.equal(FIELDS_ARE_LISTED_BY, "the feature named as owner");
  assert.equal(OWNER_DELIVERS_THE_SCHEMA_FILE, true);
});

test("CT-100-327: every record carries its schema id, with a major, and follows §B.4 (F100-FR-227)", () => {
  assert.equal(EVERY_RECORD_CARRIES_ITS_SCHEMA_ID, true);
  assert.equal(COMMON_RULES_SECTION, "annex B, §B.4");
  for (const row of furtherSchemaIdRows) {
    assert.ok(
      row.schemaId.startsWith(PRODUCT_ID_PREFIX) || row.schemaId.startsWith(INTERNAL_ID_PREFIX),
      `${row.schemaId} carries neither the product form nor the internal form`,
    );
    assert.ok(Number.isFinite(row.major), `${row.schemaId} carries no major`);
    assert.equal(row.major, majorOfSchemaId(row.schemaId));
    assert.equal(followsTheCommonRulesOfB4(row.schemaId), true, row.schemaId);
    assert.notEqual(row.record, "", `${row.schemaId} names no record`);
    assert.match(row.owner, /^\d{3}$/, `${row.schemaId} has no owner feature number`);
  }
  // The two records of feature 130 carry the internal form and hold no logical
  // name; every other row carries the product form (§B.20, the note).
  const internal = furtherSchemaIdRows.filter((r) => r.internal);
  assert.equal(internal.length, 2);
  for (const row of internal) {
    assert.equal(row.owner, "130");
    assert.equal(row.logicalName, undefined);
    assert.ok(row.schemaId.startsWith("urn:specstride:schema:internal:130:"));
    assert.equal(followsTheCommonRulesOfB4(row.schemaId), true, "§B.4 holds for them too");
  }
});

test("CT-100-327: a reader reads a record by its logical name, and the name is a row of §B.5 (F100-FR-227)", () => {
  // Every logical name of the table is a name of the one table of §B.5, so a
  // reader resolves it through the resolver of T034.
  assert.deepEqual([...logicalNamesAreOfTheLayout()], [], "every logical name is a row of §B.5");
  const withNames = furtherSchemaIdRows.filter((r) => r.logicalName !== undefined);
  assert.ok(withNames.length >= 17, `${String(withNames.length)} rows carry a logical name`);
  for (const row of withNames) {
    const name = readByLogicalName(row.schemaId);
    assert.equal(name, row.logicalName);
    assert.equal(holdsLogicalName(name), true, `${name} is a row of §B.5`);
    assert.equal(logicalNameOfSchemaId(row.schemaId), name);
    assert.equal(rowOfLogicalName(name)?.schemaId, row.schemaId);
  }
  // A row without a logical name is read by no other feature: asking for one
  // is refused rather than answered with a guess.
  for (const row of furtherSchemaIdRows.filter((r) => r.logicalName === undefined)) {
    assert.throws(() => readByLogicalName(row.schemaId), UnknownFurtherSchemaIdError, row.schemaId);
  }
});

test("CT-100-327: the owner, the record and the as-is name of a row are those of the annex (F100-FR-227)", () => {
  // Three rows of feature 126, the four of the invocation, and the owner of each.
  assert.equal(ownerOf("specstride.invocation/1"), "126");
  assert.equal(ownerOf("specstride.protected-set/1"), "116");
  assert.equal(ownerOf("specstride.task-list/1"), "104");
  assert.equal(ownerOf("specstride.spend/1"), "127");
  assert.equal(rowsOfOwner("126").length, 4);
  assert.equal(rowsOfOwner("106").length, 4);
  assert.equal(rowsOfOwner("130").length, 2);
  assert.match(recordOf("specstride.task-list/1"), /^The task list as read at launch/);

  // The as-is name is written where the baseline writes it, in compatibility
  // output and in the compatibility projection.
  assert.deepEqual(
    [...AS_IS_NAME_IS_WRITTEN_IN],
    ["compatibility output", "the compatibility projection"],
  );
  assert.equal(asIsNameOfSchemaId("specstride.invocation/1"), "specstride-invocation/v1");
  assert.equal(asIsNameOfSchemaId("specstride.producer-status/1"), "specstride-producer-status/v1");
  assert.equal(
    asIsNameOfSchemaId("specstride.provider-terminal/1"),
    "specstride-provider-terminal/v1",
  );
  assert.equal(asIsNameOfSchemaId("specstride.retrospective/1"), "mol.retrospective/1");
  // Three ids of learning are the same as-is: the cell says "as-is id the same".
  for (const id of [
    "specstride.learn.applied/2",
    "specstride.learn.summary/7",
    "specstride.learn.observation/1",
  ]) {
    assert.equal(asIsNameOfSchemaId(id), id, `${id} is its own as-is name`);
  }
  // A row with no as-is name has none, and is absent from the map.
  assert.equal(asIsNameOfSchemaId("specstride.task-list/1"), undefined);
  assert.equal("specstride.task-list/1" in AS_IS_NAMES, false);
  // The decision log of learning is written as /2 and entries of /1 are read.
  assert.equal(rowOfSchemaId("specstride.learn.applied/2").alsoReadsMajor, 1);
});

test("CT-100-327: a schema id the table does not hold is refused, and names the requirement", () => {
  assert.equal(holdsSchemaId("specstride.invented/1"), false);
  assert.throws(
    () => rowOfSchemaId("specstride.invented/1"),
    (error: unknown) => {
      assert.ok(error instanceof UnknownFurtherSchemaIdError);
      assert.equal(error.schemaId, "specstride.invented/1");
      assert.match(error.message, /annex B, §B\.20/);
      assert.match(error.message, /F100-FR-227/);
      return true;
    },
  );
  assert.equal(followsTheCommonRulesOfB4("specstride.invented/1"), false);
});

/* ------------------------------------------------------------------ *
 * CT-100-329 — the names added to the layout (annex B, §B.5; F100-FR-229).
 * ------------------------------------------------------------------ */

test("CT-100-329: the sixteen names of the amendment are rows of the one table of §B.5 (F100-FR-229)", () => {
  assert.equal(AMENDED_LOGICAL_NAME_COUNT, 16);
  assert.equal(AMENDED_LOGICAL_NAMES.length, 16);
  assert.equal(FIRST_AMENDED_NAME, "run:<runId>:events-legacy:<k>");
  assert.equal(LAST_AMENDED_NAME, "workspace:current:status-line");
  assert.equal(AMENDED_LOGICAL_NAMES[0], FIRST_AMENDED_NAME);
  assert.equal(AMENDED_LOGICAL_NAMES[15], LAST_AMENDED_NAME);
  // Every one is a row of the table, with a root, one writer and a path.
  const rows = rowsOfTheAmendment();
  assert.equal(rows.length, 16);
  for (const row of rows) {
    assert.equal(holdsLogicalName(row.logicalName), true);
    assert.notEqual(row.path, "");
    assert.notEqual(row.writer, "");
    assert.ok(
      ["user", "control", "workspace", "worker-root", "temp", "package", "harness-home"].includes(
        row.root,
      ),
      `${row.logicalName} has the root ${row.root}`,
    );
  }
  // They are a contiguous group of the amended table, and the two the
  // amendment cites by name are its ends.
  const numbers = AMENDED_LOGICAL_NAMES.map((n) => rowNumberOf(n));
  assert.equal(numbers[0], 111, `the group opens at row 111 of layout ${layoutVersion}`);
  assert.equal(numbers[15], 127, "and closes at the last row of the table");
  for (const n of numbers) assert.ok(n > 0, "every name is in the table");
  // The group is the amended rows only: `isAmendedLogicalName` refuses a name
  // of the table that the amendment did not add.
  assert.equal(isAmendedLogicalName("run:<runId>:events-legacy:<k>"), true);
  assert.equal(isAmendedLogicalName("run:<runId>:engine-log:<k>"), false, "that is T303's");
  assert.equal(isAmendedLogicalName("run:<runId>:events"), false);
  assert.throws(() => resolveAmended("run:<runId>:events" as never, {}, ROOTS));
});

test("CT-100-329: the as-is event file is written once per engine start (F100-FR-229)", () => {
  assert.equal(EVENT_FILE_IS_WRITTEN_ONCE_PER_ENGINE_START, true);
  assert.equal(EVENTS_LEGACY_PER_START, "run:<runId>:events-legacy:<k>");
  assert.equal(holdsLogicalName(EVENTS_LEGACY_PER_START), true);
  // One file per start: the ordinal of the start is in the path, so two starts
  // of the same run never write one file.
  const parameters = { "<slug>": "100-specstride", "<runId>": "R1" };
  const first = resolveEventsLegacy(1, parameters, ROOTS);
  const second = resolveEventsLegacy(2, parameters, ROOTS);
  assert.notEqual(first, second);
  assert.equal(
    first,
    "/state/workspaces/W1/features/100-specstride/runs/R1/compat/events.legacy.e1.jsonl",
  );
  assert.equal(
    second,
    "/state/workspaces/W1/features/100-specstride/runs/R1/compat/events.legacy.e2.jsonl",
  );
  // The bare name is the file of the newest start, through the per-start name.
  assert.equal(EVENTS_LEGACY_BARE, "run:<runId>:events-legacy");
  assert.equal(bareNameResolvesThroughThePerStartName(), true);
  assert.equal(resolveNewestEventsLegacy(2, parameters, ROOTS), second);
  assert.equal(resolve(EVENTS_LEGACY_BARE, { ...parameters, "<k>": 2 }, ROOTS), second);
  // One writer, as §B.5 requires of every name.
  assert.equal(writerOfTheEventFile(), "Compatibility projection");
  assert.equal(rowOf(EVENTS_LEGACY_PER_START).writer, writerOfTheEventFile());
});

test("CT-100-329: the comment is kept verbatim after redaction and the launch record holds only its hash (F100-FR-229)", () => {
  assert.equal(COMMENT_NAME, "launch:<launchId>:comment");
  assert.equal(holdsLogicalName(COMMENT_NAME), true);
  assert.equal(COMMENT_RULE.keptVerbatim, true);
  assert.equal(COMMENT_RULE.afterRedaction, true);
  assert.equal(COMMENT_RULE.launchRecordHolds, "hash");
  assert.equal(COMMENT_RULE.launchRecordHoldsTheText, false);
  assert.equal(LAUNCH_RECORD_HOLDS_ONLY_THE_HASH, true);
  // The record may carry the hash and nothing else of the comment.
  assert.equal(launchRecordMayCarry(COMMENT_HASH_FIELD), true);
  assert.equal(launchRecordMayCarry("comment"), false);
  assert.equal(launchRecordMayCarry("commentText"), false);
  // The comment sits beside the launch record, under the launch id.
  assert.equal(resolveComment("L7", {}, ROOTS), "/state/workspaces/W1/launches/L7/comment.txt");
  assert.match(rowOf(COMMENT_NAME).content, /verbatim and redacted/);
});

test("CT-100-329: the status line of the workspace is placed by the real path of the workspace only (F100-FR-229)", () => {
  assert.equal(STATUS_LINE_NAME, "workspace:current:status-line");
  assert.equal(holdsLogicalName(STATUS_LINE_NAME), true);
  // Its path carries no parameter at all: no run id, no feature slug, no
  // launch id. That is what "placed by the real path of the workspace only"
  // means, and it is why a shell shim finds it without starting the product.
  assert.deepEqual([...parametersOfTheStatusLine()], []);
  assert.equal(statusLineDependsOnTheWorkspaceOnly(), true);
  assert.equal(STATUS_LINE_RULE.dependsOnTheRunId, false);
  assert.equal(STATUS_LINE_RULE.dependsOnTheFeatureSlug, false);
  assert.equal(STATUS_LINE_RULE.placedBy, "the real path of the workspace");
  assert.equal(STATUS_LINE_RULE.foundWithoutStartingTheProduct, true);
  assert.equal(resolveStatusLine(ROOTS), "/state/workspaces/W1/status.line");
  // It points at the status line of the current run, which does carry the run id.
  assert.equal(STATUS_LINE_RULE.pointsAt, STATUS_LINE_TARGET);
  assert.equal(holdsLogicalName(STATUS_LINE_TARGET), true);
  assert.ok(rowOf(STATUS_LINE_TARGET).parameters.includes("<runId>"));
});

test("CT-100-329: the three rules of the amendment are stated once each, on the name they hold for", () => {
  assert.equal(RULES_OF_THE_AMENDMENT.length, 3);
  assert.deepEqual(
    RULES_OF_THE_AMENDMENT.map((r) => r.logicalName),
    [EVENTS_LEGACY_PER_START, COMMENT_NAME, STATUS_LINE_NAME],
  );
  for (const rule of RULES_OF_THE_AMENDMENT) {
    assert.equal(isAmendedLogicalName(rule.logicalName), true);
    assert.notEqual(rule.rule, "");
  }
});
