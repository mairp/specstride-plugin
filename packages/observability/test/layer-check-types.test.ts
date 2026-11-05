/**
 * T067 — CT-111-150: the ten types of the micro-loop layer and of the check
 * runner (F111-FR-050).
 *
 * F111-FR-050: *The catalogue MUST hold the types with which the micro-loop
 * layer and the check runner record their facts, each with the `data` of the
 * table "Types added on 2026-09-30": `strategy.selected` ..., `microloop.inert`
 * ..., `checkpoint.accepted`, `checkpoint.refused` (with a reason of annex X
 * §X.6 row 138), `checkpoint.removed`, `check.excluded` (with its reason),
 * `check.admission`, `check.parallelism_lowered`, `tripwire.raised` (with the
 * breach kind of annex X §X.6 row 141 and the rule id) and `tripwire.cleared`.
 * None of them MUST hold the output of a command, the note of a checkpoint or a
 * path beyond what the redactor allows. They MUST project to nothing. The
 * feature that owns the behaviour emits them.*
 *
 * FOUR CLAIMS, FOUR INDEPENDENT ORACLES.
 *
 *   1. *validate with the fields of the table* — the table "Types added on
 *      2026-09-30" is PARSED OUT OF `spec.md` by a parser written for this test
 *      alone, and the field list of each of the ten rows is held against the
 *      row of `data/event-catalogue.tsv` and against the refinement of
 *      `src/catalogue/types/layer-check.ts`. The three must name the same
 *      fields. Then one event of each type is written through the REAL
 *      `PrimaryWriter` into a temporary directory and read back from the bytes
 *      through `readEventLine` of `@specstride/contracts` — feature 100's
 *      reader, which knows nothing of this package. The durable witness is the
 *      file: its gapless `seq`, its byte length and the SHA-256 of its bytes.
 *   2. *a reason outside its closed set is refused* — every closed-set field of
 *      the ten is driven once with a member and once with a value of no set,
 *      and the refusal must name the keyword `enum`.
 *   3. *no output of a command and no note of a checkpoint* — the field names of
 *      the ten are held against the list of names that WOULD hold such a thing,
 *      and planting one in an event is refused. A value that is a path or holds
 *      a line end is a finding of its own.
 *   4. *each projects to nothing* — read from
 *      `specs/144-compatibility-projection/contracts/projection-table.tsv`,
 *      feature 144's own declaration, which this feature does not own and does
 *      not write. Every one of the ten must have `legacy_target` `-` and
 *      `shape` `none` there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE_BY_TYPE, dataSchemaForType } from "../src/catalogue/index.ts";
import { checkRefinedData, refinedDataSchemaOf } from "../src/catalogue/types/index.ts";
import {
  ADMISSION_REASONS,
  ADMISSION_RESULTS,
  CHECKPOINT_REFUSAL_REASONS,
  CHECK_EXCLUSION_REASONS,
  CHECK_EXCLUSION_SCOPES,
  FIELDS_THAT_WOULD_HOLD_FORBIDDEN_CONTENT,
  LAYER_CHECK_TYPES,
  LAYER_CHECK_TYPES_PROJECT_TO,
  LOOP_STRATEGIES,
  MICRO_FALLBACK_REASONS,
  MICRO_LEVELS,
  PARALLELISM_LOWERED_TO,
  TAINT_REASONS,
  TRIPWIRE_BREACH_KINDS,
  admissionFindings,
  checkpointLogicalNameOf,
  forbiddenFieldFindings,
  layerCheckContentFindings,
  parallelismFindings,
} from "../src/catalogue/types/layer-check.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";
import { validateBeforeWrite } from "../src/writer/validate.ts";
import {
  projectsToNothing,
  readAddedTypesTable,
  readProjectionTable,
} from "./support/spec-tables.ts";

/** The repository root: three levels up from `packages/observability/test`. */
const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const SPEC_FILE = join(ROOT, "specs/111-event-schema-and-projection/spec.md");

/** Feature 144's own projection table. Read only; never written by 111. */
const PROJECTION_TABLE = join(
  ROOT,
  "specs/144-compatibility-projection/contracts/projection-table.tsv",
);

const SPEC_TEXT = existsSync(SPEC_FILE) ? readFileSync(SPEC_FILE, "utf8") : "";
const ADDED_TYPES = SPEC_TEXT.length > 0 ? readAddedTypesTable(SPEC_TEXT) : [];

function addedRowOf(type: string) {
  const row = ADDED_TYPES.find((candidate) => candidate.type === type);
  assert.ok(row !== undefined, `${type} is a row of the table "Types added on 2026-09-30"`);
  return row;
}

/* ------------------------------------------------------------------ *
 * A real write target: the writer of T008 and an independent read path.
 * ------------------------------------------------------------------ */

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-150-"));
}

function readBack(file: string): { type: string; seq: number; data: Record<string, unknown> }[] {
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const read = readEventLine(line, index === lines.length - 1);
    assert.equal(read.ok, true, `line ${index + 1} is a well-formed event: ${line}`);
    assert.ok(read.ok);
    return {
      type: String(read.event.type),
      seq: Number(read.event.seq),
      data: (read.event.data ?? {}) as Record<string, unknown>,
    };
  });
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** One valid event of each of the ten, in the order of F111-FR-050. */
export function validEvents(): readonly { type: string; data: Record<string, unknown> }[] {
  return Object.freeze([
    {
      type: "strategy.selected",
      data: {
        strategy: LOOP_STRATEGIES[0] as string,
        level: null,
        manifestHashes: [{ logicalName: "feature:111:check-manifest", hash: "a".repeat(64) }],
        fallbackReason: null,
      },
    },
    { type: "microloop.inert", data: { phase: 7, attempt: 1 } },
    {
      type: "checkpoint.accepted",
      data: {
        unitId: "u-1",
        taskIds: ["T067", "T068"],
        checkpointRef: {
          logicalName: checkpointLogicalNameOf("u-1"),
          hash: "b".repeat(64),
          size: 211,
        },
      },
    },
    {
      type: "checkpoint.refused",
      data: { reason: CHECKPOINT_REFUSAL_REASONS[0] as string, bytes: 4096 },
    },
    { type: "checkpoint.removed", data: { bytes: 128 } },
    {
      type: "check.excluded",
      data: {
        checkId: "lint",
        reason: CHECK_EXCLUSION_REASONS[0] as string,
        scope: CHECK_EXCLUSION_SCOPES[0] as string,
        durationMs: 1200,
        ruleId: null,
      },
    },
    {
      type: "check.admission",
      data: {
        checkId: "typecheck",
        batch: 2,
        slot: 1,
        result: "admitted",
        reason: ADMISSION_REASONS[0] as string,
      },
    },
    {
      type: "check.parallelism_lowered",
      data: {
        from: 4,
        to: PARALLELISM_LOWERED_TO,
        batch: 2,
        phase: 7,
        attempt: 1,
        reason: "changed-during-check",
      },
    },
    {
      type: "tripwire.raised",
      data: { kind: TRIPWIRE_BREACH_KINDS[0] as string, ruleId: "gate.integrity" },
    },
    { type: "tripwire.cleared", data: { clearedAt: "2026-10-01T00:00:00.000Z" } },
  ]);
}

/* ------------------------------------------------------------------ *
 * 1. The ten types, with the fields of the table.
 * ------------------------------------------------------------------ */

test("CT-111-150: the ten types of F111-FR-050 are rows of the catalogue, instant and unpaired", () => {
  assert.equal(LAYER_CHECK_TYPES.length, 10, "F111-FR-050 names ten types");
  assert.deepEqual(
    [...LAYER_CHECK_TYPES],
    [
      "strategy.selected",
      "microloop.inert",
      "checkpoint.accepted",
      "checkpoint.refused",
      "checkpoint.removed",
      "check.excluded",
      "check.admission",
      "check.parallelism_lowered",
      "tripwire.raised",
      "tripwire.cleared",
    ],
    "in the order the requirement names them",
  );
  for (const type of LAYER_CHECK_TYPES) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry !== undefined, `${type} is a row of the catalogue`);
    // "all are of the kind `instant`, have no partner" (the table of spec.md).
    assert.equal(entry.kind, "instant", `${type} is an instant`);
    assert.equal(entry.partner, "", `${type} has no partner`);
    assert.ok(dataSchemaForType(type) !== undefined, `${type} has a data schema`);
    assert.ok(refinedDataSchemaOf(type) !== undefined, `${type} has a refined data schema`);
  }
});

test('CT-111-150: the fields of each type are the fields of the table "Types added on 2026-09-30"', () => {
  if (SPEC_TEXT.length === 0) {
    assert.ok(true, `skip: ${SPEC_FILE} is not in this checkout`);
    return;
  }
  for (const type of LAYER_CHECK_TYPES) {
    const fromTheTable = [...addedRowOf(type).fields];
    const fromTheCatalogue = [...(CATALOGUE_BY_TYPE.get(type)?.dataFields ?? [])];
    assert.deepEqual(fromTheCatalogue, fromTheTable, `${type}: the row and the table agree`);
    const schema = refinedDataSchemaOf(type);
    assert.ok(schema !== undefined);
    assert.deepEqual(
      Object.keys(schema.properties),
      fromTheTable,
      `${type}: the data schema holds exactly the fields of the table`,
    );
    assert.deepEqual(
      [...schema.required],
      fromTheTable,
      `${type}: every field of the table is required`,
    );
  }
});

test("CT-111-150: one event of each of the ten validates and reaches the primary file", () => {
  const dir = freshDir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({
    file,
    runId: "run-ct-111-150",
    launchId: "launch-ct-111-150",
    holder: "ct-111-150",
    now: () => new Date("2026-10-01T00:00:00.000Z"),
  });
  const events = validEvents();
  try {
    for (const event of events) {
      // The gate of T006 against the refined schema of T068.
      assert.deepEqual(
        [...checkRefinedData(event.type, event.data)],
        [],
        `${event.type} validates against its data schema`,
      );
      const verdict = validateBeforeWrite({ type: event.type, data: event.data });
      assert.equal(verdict.admitted, true, `${event.type} is admitted by the writer's gate`);
      writer.append({ type: event.type, data: event.data });
    }
  } finally {
    writer.close();
  }
  // The effect witness: the bytes on disk, read by feature 100's reader.
  const written = readBack(file);
  assert.equal(written.length, 10, "ten lines on disk");
  assert.deepEqual(
    written.map((line) => line.type),
    events.map((event) => event.type),
  );
  assert.deepEqual(
    written.map((line) => line.seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "`seq` rises by one without a gap",
  );
  for (const [index, line] of written.entries()) {
    assert.deepEqual(
      line.data,
      events[index]?.data,
      `${line.type}: the data survived the round trip`,
    );
  }
  // A durable identity that could not exist before the appends.
  const bytes = statSync(file).size;
  assert.ok(bytes > 1000, `the file holds ${bytes} bytes`);
  assert.match(sha256(file), /^[0-9a-f]{64}$/);
  assert.notEqual(sha256(file), createHash("sha256").update("").digest("hex"));
});

test("CT-111-150: a successful-looking check is no proof — the file is", () => {
  const dir = freshDir();
  const file = join(dir, "events.jsonl");
  // `checkRefinedData` says the data is fine and writes nothing at all: the
  // return value cannot stand in for the durable effect.
  assert.deepEqual([...checkRefinedData("microloop.inert", { phase: 1, attempt: 1 })], []);
  assert.equal(existsSync(file), false, "no file exists while only the check has run");
});

/* ------------------------------------------------------------------ *
 * 2. A reason outside its closed set is refused.
 * ------------------------------------------------------------------ */

test("CT-111-150: the closed sets of the ten come from annex X §X.6, never from a literal", () => {
  assert.deepEqual([...LOOP_STRATEGIES], [...(closedSet(55)?.members ?? [])], "row 55");
  assert.deepEqual(
    [...CHECKPOINT_REFUSAL_REASONS],
    [...(closedSet(138)?.members ?? [])],
    "row 138",
  );
  assert.deepEqual([...TRIPWIRE_BREACH_KINDS], [...(closedSet(141)?.members ?? [])], "row 141");
  assert.deepEqual([...ADMISSION_REASONS], [...(closedSet(236)?.members ?? [])], "row 236");
  assert.deepEqual([...TAINT_REASONS], [...(closedSet(53)?.members ?? [])], "row 53");
  assert.deepEqual([...MICRO_FALLBACK_REASONS], [...(closedSet(59)?.members ?? [])], "row 59");
  // The three exclusions of the decision point `tools`, row 67, without the
  // `exclude:` of the decision point.
  assert.deepEqual([...CHECK_EXCLUSION_REASONS], ["flaky", "slow", "budget"]);
  for (const reason of CHECK_EXCLUSION_REASONS) {
    assert.ok(
      (closedSet(67)?.members ?? []).includes(`exclude:${reason}`),
      `exclude:${reason} is a choice of row 67`,
    );
  }
  // Row 56 (`level`) and row 40 (auth tiers) hold no member yet; the field
  // stays text until its owner fills the row.
  assert.deepEqual([...MICRO_LEVELS], [...(closedSet(56)?.members ?? [])]);
  assert.ok(TRIPWIRE_BREACH_KINDS.length > 0, "row 141 gives its members");
  assert.ok(ADMISSION_REASONS.length > 0, "row 236 gives its members");
});

/**
 * WHERE EACH CLOSED SET LIVES, AND WHO REFUSES A VALUE OUTSIDE IT.
 *
 * A field whose set HAS a row of annex X §X.6 carries that set in the ROW's own
 * `data` schema (T004 reads it from `@specstride/contracts` by row number), so
 * the writer's gate of T006 refuses a value outside it before anything is
 * written. `gate: true` below marks those.
 *
 * Three fields of the ten have no row of their own: `check.excluded.reason` is
 * row 67 with the prefix of the decision point stripped off, and
 * `check.excluded.scope` and `check.admission.result` are named by the table
 * "Types added on 2026-09-30" and by no annex row at all. Their sets live in
 * the refined `data` schema of T068, which is the schema of the type; the
 * refusal is `checkRefinedData`'s. `strategy.selected.fallbackReason` is the
 * fourth: its members are row 59, but it is null while the layer is on, and a
 * row-derived `{enum}` admits no null — so it too carries its set in the
 * refined schema. `gate: false` marks these four, and the test says so rather
 * than claiming a refusal that does not happen.
 */
test("CT-111-150: a reason outside its closed set is refused", () => {
  const cases: readonly {
    type: string;
    field: string;
    member: string;
    members: readonly string[];
    gate: boolean;
  }[] = [
    {
      type: "checkpoint.refused",
      field: "reason",
      member: CHECKPOINT_REFUSAL_REASONS[0] as string,
      members: CHECKPOINT_REFUSAL_REASONS,
      gate: true,
    },
    {
      type: "check.excluded",
      field: "reason",
      member: CHECK_EXCLUSION_REASONS[0] as string,
      members: CHECK_EXCLUSION_REASONS,
      gate: false,
    },
    {
      type: "check.admission",
      field: "reason",
      member: ADMISSION_REASONS[0] as string,
      members: ADMISSION_REASONS,
      gate: true,
    },
    {
      type: "check.parallelism_lowered",
      field: "reason",
      member: "changed-during-check",
      members: TAINT_REASONS,
      gate: true,
    },
    {
      type: "strategy.selected",
      field: "strategy",
      member: LOOP_STRATEGIES[0] as string,
      members: LOOP_STRATEGIES,
      gate: true,
    },
    {
      type: "strategy.selected",
      field: "fallbackReason",
      member: MICRO_FALLBACK_REASONS[0] as string,
      members: MICRO_FALLBACK_REASONS,
      gate: false,
    },
    {
      type: "tripwire.raised",
      field: "kind",
      member: TRIPWIRE_BREACH_KINDS[0] as string,
      members: TRIPWIRE_BREACH_KINDS,
      gate: true,
    },
    {
      type: "check.admission",
      field: "result",
      member: "refused",
      members: ADMISSION_RESULTS,
      gate: false,
    },
    {
      type: "check.excluded",
      field: "scope",
      member: "phase",
      members: CHECK_EXCLUSION_SCOPES,
      gate: false,
    },
  ];
  const valid = new Map(validEvents().map((event) => [event.type, event.data]));
  for (const probe of cases) {
    const base = valid.get(probe.type);
    assert.ok(base !== undefined, `${probe.type} has a valid event above`);
    assert.ok(probe.members.includes(probe.member), `${probe.member} is a member of the set`);
    // The member passes.
    const good: Record<string, unknown> = { ...base, [probe.field]: probe.member };
    if (probe.type === "check.admission" && probe.field === "result") {
      // A refusal carries no slot (the table: "`slot`: null for a refusal").
      good.slot = probe.member === "refused" ? null : 1;
    }
    assert.deepEqual(
      [...checkRefinedData(probe.type, good)],
      [],
      `${probe.type}.${probe.field} = ${probe.member} is accepted`,
    );
    // A value of no set is refused by the `data` schema of the type, by the
    // keyword `enum`.
    const bad = { ...base, [probe.field]: "not-a-member-of-any-set" };
    const findings = checkRefinedData(probe.type, bad);
    assert.ok(findings.length > 0, `${probe.type}.${probe.field}: a value of no set is refused`);
    assert.ok(
      findings.some(
        (finding) => finding.keyword === "enum" && finding.path === `data.${probe.field}`,
      ),
      `${probe.type}.${probe.field}: the refusal names the keyword enum: ${JSON.stringify(findings)}`,
    );
    // Where the set has a row of annex X §X.6, the ROW's schema carries it, so
    // the writer's own gate refuses the event before it is written.
    const fromTheRow = dataSchemaForType(probe.type)?.properties[probe.field]?.enum;
    assert.equal(
      fromTheRow !== undefined,
      probe.gate,
      `${probe.type}.${probe.field}: the row ${probe.gate ? "carries" : "does not carry"} the set`,
    );
    if (probe.gate) {
      assert.deepEqual(
        [...(fromTheRow ?? [])],
        [...probe.members],
        `${probe.type}.${probe.field}: the row's set and the refinement's agree`,
      );
      assert.equal(
        validateBeforeWrite({ type: probe.type, data: bad }).admitted,
        false,
        `${probe.type}.${probe.field}: the writer's gate refuses it`,
      );
    }
  }
  // Every valid event of the ten passes the writer's gate as well, so the
  // refusals above are refusals of the value and not of the shape.
  for (const event of validEvents()) {
    assert.equal(
      validateBeforeWrite({ type: event.type, data: event.data }).admitted,
      true,
      `${event.type} is admitted`,
    );
  }
});

test("CT-111-150: a refusal of an admission carries no slot, and the lowering goes to 1", () => {
  assert.deepEqual([...ADMISSION_RESULTS], ["admitted", "refused"]);
  assert.deepEqual(
    [...admissionFindings({ result: "refused", slot: 3 })],
    ["check.admission: a refusal carries no slot; `slot` is null for a refusal, and reads 3"],
  );
  assert.deepEqual([...admissionFindings({ result: "refused", slot: null })], []);
  assert.deepEqual([...admissionFindings({ result: "admitted", slot: 3 })], []);
  assert.deepEqual(
    [...admissionFindings({ result: "admitted", slot: null })],
    ["check.admission: an admission names the slot it was admitted to; `slot` reads null"],
  );
  assert.equal(PARALLELISM_LOWERED_TO, 1, "the table: `to` is 1");
  assert.deepEqual([...parallelismFindings({ from: 4, to: 1 })], []);
  assert.deepEqual(
    [...parallelismFindings({ from: 4, to: 2 })],
    ["check.parallelism_lowered: `to` is 1; it reads 2"],
  );
  assert.deepEqual(
    [...parallelismFindings({ from: 1, to: 1 })],
    ["check.parallelism_lowered: the parallelism was lowered, so `from` is above `to`; 1 is not"],
  );
  // The rules are in the schema, not only in the helper.
  const findings = checkRefinedData("check.parallelism_lowered", {
    from: 4,
    to: 2,
    batch: 1,
    phase: 7,
    attempt: 1,
    reason: "changed-during-check",
  });
  assert.ok(
    findings.some((finding) => finding.keyword === "rule"),
    `the schema runs the rule: ${JSON.stringify(findings)}`,
  );
});

/* ------------------------------------------------------------------ *
 * 3. No output of a command and no note of a checkpoint.
 * ------------------------------------------------------------------ */

test("CT-111-150: no field of the ten would hold the output of a command or the note of a checkpoint", () => {
  assert.deepEqual([...forbiddenFieldFindings()], []);
  assert.ok(
    FIELDS_THAT_WOULD_HOLD_FORBIDDEN_CONTENT.includes("note"),
    "the note of a checkpoint is among the names",
  );
  for (const name of ["output", "stdout", "stderr", "log", "body", "text", "path"]) {
    assert.ok(
      (FIELDS_THAT_WOULD_HOLD_FORBIDDEN_CONTENT as readonly string[]).includes(name),
      `${name} is among the names that would hold it`,
    );
  }
  // Negative control: a row of the ten that carried `note` is a finding.
  const planted = [
    {
      type: "checkpoint.accepted",
      kind: "instant" as const,
      partner: "",
      dataFields: ["unitId", "note"],
      freeTextFields: [],
    },
  ];
  assert.deepEqual(
    [...forbiddenFieldFindings(planted)],
    [
      "checkpoint.accepted: the data field `note` would hold the output of a command, " +
        "the note of a checkpoint or a path; F111-FR-050 keeps none of them",
    ],
  );
});

test("CT-111-150: the note of a checkpoint cannot be written, and the reference is", () => {
  // `checkpoint.accepted` carries a REFERENCE: a logical name, a hash and a
  // size, and never the note (the table: "The note is never in the event").
  const entry = CATALOGUE_BY_TYPE.get("checkpoint.accepted");
  assert.ok(entry !== undefined);
  assert.ok(entry.dataFields.includes("checkpointRef"));
  assert.equal(checkpointLogicalNameOf("u-7"), "unit:u-7:checkpoint");
  const good = {
    unitId: "u-7",
    taskIds: ["T067"],
    checkpointRef: { logicalName: "unit:u-7:checkpoint", hash: "c".repeat(64), size: 42 },
  };
  assert.deepEqual([...checkRefinedData("checkpoint.accepted", good)], []);
  // The reference names the checkpoint of the unit the event is about.
  const foreign = {
    ...good,
    checkpointRef: { ...good.checkpointRef, logicalName: "unit:u-9:checkpoint" },
  };
  assert.ok(
    checkRefinedData("checkpoint.accepted", foreign).some((finding) => finding.keyword === "rule"),
    "a reference to another unit's checkpoint is a finding",
  );
  // A note in the event is refused: the catalogue has no such field.
  const withANote = { ...good, note: "the checkpoint says the unit is done" };
  const findings = checkRefinedData("checkpoint.accepted", withANote);
  assert.ok(
    findings.some(
      (finding) => finding.keyword === "additionalProperties" && finding.path === "data.note",
    ),
    `a note is refused: ${JSON.stringify(findings)}`,
  );
  assert.equal(
    validateBeforeWrite({ type: "checkpoint.accepted", data: withANote }).admitted,
    false,
    "the writer's gate refuses it as well",
  );
});

test("CT-111-150: the output of a command and a path in a value are findings", () => {
  // A value that holds a line end is the output of a command, whatever field
  // it came in through.
  assert.deepEqual(
    [...layerCheckContentFindings("check.excluded", { checkId: "lint\nsrc/a.ts:1:1 error\n" })],
    [
      "check.excluded.checkId: the value holds a line end, which is the output of a command; " +
        "F111-FR-050 keeps no output in these events",
    ],
  );
  // A path beyond what the redactor allows.
  assert.deepEqual(
    [...layerCheckContentFindings("checkpoint.accepted", { unitId: "/tmp/run/u-1" })],
    [
      "checkpoint.accepted.unitId: the value is a path (`/tmp/run/u-1`); F111-FR-050 keeps " +
        "no path beyond what the redactor allows",
    ],
  );
  // A nested value is reached too.
  assert.deepEqual(
    [
      ...layerCheckContentFindings("checkpoint.accepted", {
        checkpointRef: { logicalName: "./state/u-1.md", hash: "d".repeat(64), size: 1 },
      }),
    ],
    [
      "checkpoint.accepted.checkpointRef.logicalName: the value is a path (`./state/u-1.md`); " +
        "F111-FR-050 keeps no path beyond what the redactor allows",
    ],
  );
  // Every valid event of the ten is clean.
  for (const event of validEvents()) {
    assert.deepEqual(
      [...layerCheckContentFindings(event.type, event.data)],
      [],
      `${event.type} is clean`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 4. Each projects to nothing.
 * ------------------------------------------------------------------ */

test("CT-111-150: each of the ten projects to nothing", () => {
  assert.equal(LAYER_CHECK_TYPES_PROJECT_TO, null, "F111-FR-050: they project to nothing");
  if (!existsSync(PROJECTION_TABLE)) {
    assert.ok(true, `skip: ${PROJECTION_TABLE} is not in this checkout`);
    return;
  }
  const rows = readProjectionTable(readFileSync(PROJECTION_TABLE, "utf8"));
  for (const type of LAYER_CHECK_TYPES) {
    assert.ok(
      rows.some((row) => row.type === type),
      `${type} has a row in feature 144's projection table`,
    );
    assert.equal(projectsToNothing(rows, type), true, `${type} projects to nothing`);
  }
  // Negative control: a type that DOES project is not read as projecting to
  // nothing, so the check above is a check and not a tautology.
  assert.equal(projectsToNothing(rows, "run.started"), false, "run.started does project");
  assert.equal(projectsToNothing(rows, "no.such.type"), false, "an absent type is not a pass");
});
