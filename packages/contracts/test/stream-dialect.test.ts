/**
 * T165 — contract tests CT-100-190 and CT-100-191 for the stream readers and
 * the dialect table (annex C, §C.5; F100-FR-090, F100-FR-091): a valid sample
 * passes, a different major is refused, an unknown field follows the rule of
 * the schema, every required field is required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/stream-dialect-row.schema.json" with { type: "json" };
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import closedSetsData from "../data/closed-sets.json" with { type: "json" };
import {
  ANNEX_SECTION,
  CONTENT_OWNER,
  DUPLICATE_TERMINAL_REASON,
  NORMALIZED_RECORD_KINDS,
  NORMALIZED_STREAM_RECORDS,
  READER_RULES,
  RECORD_WHEN_THE_KIND_IS_UNKNOWN,
  ROW_THAT_SETS_TRACK_TERMINAL,
  SCHEMA_ID,
  SHARE_ONE_JSONL_READER,
  SYNTHESIZED_FOR_A_TEXT_STREAM,
  StreamDialectRefusedError,
  dropsASecondTerminalRecord,
  isNormalizedRecordKind,
  isStreamDialectRow,
  outcomeIsTakenFrom,
  readSessionHeaderVersion,
  readStreamDialectRow,
  tryReadStreamDialectRow,
  type StreamDialectRow,
} from "../src/records/stream-dialect-row.ts";
import { requiredOf, sampleOf, withNextMajor } from "./samples.ts";

/** A valid row of the dialect table: every field §C.5 requires. */
function validRow(): Record<string, unknown> {
  return {
    dialect: "prime-v3",
    schemaVersions: [3],
    providerFormat: "a-provider-format",
    telemetryOff: { vars: { A_HARNESS_TELEMETRY: "0" }, flags: [] },
    sessionControl: { off: [], directoryVar: "A_HARNESS_SESSION_DIR", continueFlag: "--continue" },
    extraRecords: {},
    usageNames: { input: "input_tokens", output: "output_tokens", cache: "cache_read", cost: null },
    terminalDecides: true,
    trackTerminal: true,
  };
}

test("CT-100-190: a valid sample of a row of the dialect table passes (annex C, §C.5)", () => {
  assert.equal(SCHEMA_ID, "specstride.stream-dialect/1");
  assert.equal(ANNEX_SECTION, "annex C, §C.5");
  assert.match(CONTENT_OWNER, /138/);
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);

  const sample = validRow();
  assert.ok(isStreamDialectRow(sample));
  const row = readStreamDialectRow(sample);
  assert.deepEqual(row, sample);
  assert.equal(tryReadStreamDialectRow(sample).ok, true);
  assert.ok(isStreamDialectRow(sampleOf(SCHEMA_ID)));
});

test("CT-100-190: a different major of a row of the dialect table is refused", () => {
  const next = withNextMajor(SCHEMA_ID);
  assert.equal(next, "specstride.stream-dialect/2");
  assert.throws(
    () => readStreamDialectRow(validRow(), next),
    (err: unknown) => {
      assert.ok(err instanceof StreamDialectRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.majorFound, "2");
      assert.equal(err.majorSupported, "1");
      assert.match(err.message, /the major found is 2/);
      assert.match(err.message, /the major supported is 1/);
      return true;
    },
  );
  const refused = tryReadStreamDialectRow(validRow(), next);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.reason, "different-major");
  assert.throws(
    () => readStreamDialectRow("not a record"),
    (err: unknown) => err instanceof StreamDialectRefusedError && err.reason === "not-a-record",
  );
});

test("CT-100-190: an unknown field follows the rule of the schema (annex C, §C.5)", () => {
  const rule = (schema as { "x-unknown-field"?: string })["x-unknown-field"] ?? "";
  const withExtra = { ...validRow(), aFieldAWriterOfALaterMinorAdded: 1 };
  if (/refus/i.test(rule)) {
    assert.equal(isStreamDialectRow(withExtra), false, `the schema is closed: ${rule}`);
  } else {
    assert.ok(isStreamDialectRow(withExtra), `the reader ignores what it does not know: ${rule}`);
    assert.doesNotThrow(() => readStreamDialectRow(withExtra));
  }
  // `trackTerminal` is such a field: §C.5 names it in prose, and the schema of
  // the table does not list it, so an open schema carries it.
  assert.equal(
    (schema as { properties: Record<string, unknown> }).properties["trackTerminal"],
    undefined,
  );
  assert.ok(isStreamDialectRow(validRow()));
});

test("CT-100-190: every required field of a row of the dialect table is required", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.deepEqual(
    [...required],
    [
      "dialect",
      "schemaVersions",
      "providerFormat",
      "telemetryOff",
      "sessionControl",
      "extraRecords",
      "usageNames",
      "terminalDecides",
    ],
  );
  for (const field of required) {
    const without: Record<string, unknown> = validRow();
    delete without[field];
    assert.equal(isStreamDialectRow(without), false, `${field} must be required`);
    assert.throws(() => readStreamDialectRow(without), StreamDialectRefusedError);
  }
  // The two fields the annex marks "No" are optional.
  for (const field of ["limits", "endWords"]) {
    assert.notEqual(
      (schema as { properties: Record<string, unknown> }).properties[field],
      undefined,
    );
    assert.equal(required.includes(field), false, `${field} is optional`);
  }
  const properties = (
    schema as {
      properties: Record<string, { description?: string; "x-type-in-words"?: string }>;
    }
  ).properties;
  for (const field of required) {
    assert.notEqual(properties[field]?.description, undefined, `${field} has a meaning`);
    assert.notEqual(properties[field]?.["x-type-in-words"], undefined, `${field} has a type`);
  }
});

test("CT-100-190: the six normalized records and the rules of a reader (F100-FR-090)", () => {
  // The kinds of normalized record are the closed set of §C.5, and the data
  // file of the package holds exactly them.
  assert.deepEqual(
    [...NORMALIZED_RECORD_KINDS],
    ["init", "text", "tool", "usage", "error", "terminal"],
  );
  assert.deepEqual(
    [...NORMALIZED_STREAM_RECORDS],
    [...(harnessTables as { normalizedStreamRecords: string[] }).normalizedStreamRecords],
  );
  assert.deepEqual([...NORMALIZED_STREAM_RECORDS], [...NORMALIZED_RECORD_KINDS]);
  // Row 38 of annex X §X.6 names the same six, and its unknown-value rule.
  const row38 = (
    closedSetsData as { closedSets: { number: number; literals: string[]; unknownValue: string }[] }
  ).closedSets.find((r) => r.number === 38);
  assert.deepEqual([...(row38?.literals ?? [])], [...NORMALIZED_RECORD_KINDS]);
  assert.match(String(row38?.unknownValue), /dropped/);
  assert.equal(RECORD_WHEN_THE_KIND_IS_UNKNOWN.dropped, true);
  assert.equal(RECORD_WHEN_THE_KIND_IS_UNKNOWN.diagnosticEvent, true);
  assert.ok(isNormalizedRecordKind("usage"));
  assert.equal(isNormalizedRecordKind("thought"), false);

  // For a text stream the reader synthesizes `init` and `terminal`.
  assert.deepEqual([...SYNTHESIZED_FOR_A_TEXT_STREAM], ["init", "terminal"]);

  // The rules of F100-FR-090, as data.
  assert.equal(READER_RULES.oneRegistryFrom, "stream.format");
  assert.deepEqual([...READER_RULES.producesOnly], [...NORMALIZED_RECORD_KINDS]);
  assert.equal(READER_RULES.parsesOnlyTheHarnessesOwnFraming, true);
  assert.equal(READER_RULES.neverReadsToolOutputAsAStreamRecord, true);
  assert.equal(READER_RULES.enforcesACapOnLineSize, true);
  assert.equal(READER_RULES.enforcesACapOnLineRate, true);
  assert.equal(READER_RULES.reportsAStreamWithoutATerminalRecord, true);
  assert.equal(READER_RULES.newFormatIsAddableAsDataThrough, "stream.mapping");
  assert.equal(READER_RULES.newFormatNeedsNoCode, true);
});

test("CT-100-191: the dialect table decides the session header and the outcome", () => {
  // The two harness adapters of the family share one JSONL reader.
  assert.deepEqual([...SHARE_ONE_JSONL_READER], ["pi", "prime"]);

  const row = readStreamDialectRow(validRow()) as StreamDialectRow;
  // A session header whose version is inside `schemaVersions` passes.
  assert.equal(readSessionHeaderVersion(row, 3), 3);
  // One outside it is refused, with the version found and those accepted.
  assert.throws(
    () => readSessionHeaderVersion(row, 4),
    (err: unknown) => {
      assert.ok(err instanceof StreamDialectRefusedError);
      assert.equal(err.reason, "schema-version");
      assert.match(err.message, /names the version 4/);
      assert.match(err.message, /the row accepts 3/);
      return true;
    },
  );
  assert.throws(() => readSessionHeaderVersion(row, "3"), StreamDialectRefusedError);

  // Where `terminalDecides` is true the outcome comes from the terminal record.
  assert.equal(outcomeIsTakenFrom(row), "terminal-record");
  const byExit = readStreamDialectRow({
    ...validRow(),
    terminalDecides: false,
  }) as StreamDialectRow;
  assert.equal(outcomeIsTakenFrom(byExit), "exit-code");

  // `trackTerminal`: a second terminal record of one stream is dropped with
  // the reason `duplicate_terminal`, and the first decides.
  assert.equal(ROW_THAT_SETS_TRACK_TERMINAL, "prime-v3");
  assert.equal(row.dialect, ROW_THAT_SETS_TRACK_TERMINAL);
  assert.equal(dropsASecondTerminalRecord(row), true);
  assert.equal(DUPLICATE_TERMINAL_REASON, "duplicate_terminal");
  const without = readStreamDialectRow({
    ...validRow(),
    dialect: "another-dialect",
    trackTerminal: false,
  }) as StreamDialectRow;
  assert.equal(dropsASecondTerminalRecord(without), false);
});
