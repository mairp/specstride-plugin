/**
 * T069 — CT-111-151: the three types of run control, fallback and the terms
 * gate (F111-FR-051).
 *
 * F111-FR-051: *The catalogue MUST hold the types `source.change_accepted` (an
 * intended change of a source that the consumer accepted, one event for each
 * file: which of `spec`, `plan` or `tasks`, its logical name, the old hash, the
 * new hash and the time), `fallback.skipped` (a fallback entry that was not
 * used, with the entry and a reason of the set of feature 127) and
 * `terms.override_used` (a use of an entry of `distribution.termsOverride`: the
 * provider whose row gates, the auth tier and the audience), each with the
 * `data` of the table "Types added on 2026-09-30". No count and no detail of
 * how a change was accepted MUST be in `source.change_accepted`. They MUST
 * project to nothing. The feature that owns the behaviour emits them.*
 *
 * ONE EVENT FOR EACH FILE is the claim this test spends most of its length on,
 * because it is the one a writer gets wrong: three accepted files are three
 * events, each naming ONE member of the set, and never one event with a list.
 * The three events are written through the REAL `PrimaryWriter` and counted
 * back off the bytes of the file by `readEventLine` of `@specstride/contracts`
 * — feature 100's reader, which knows nothing of this package. The durable
 * witness is the file: three gapless `seq`, its byte length, its SHA-256.
 *
 * NO TEXT OF THE SOURCE is checked twice over: the field names of the type are
 * held against the names that WOULD hold the body of a source or a count of
 * changes, and planting one in an event is refused by the catalogue itself.
 *
 * EACH PROJECTS TO NOTHING is read from
 * `specs/144-compatibility-projection/contracts/projection-table.tsv`, feature
 * 144's own declaration, which this feature does not own and does not write.
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
  ACCEPTED_SOURCE_FILES,
  AUDIENCES,
  AUTH_TIERS,
  AUTH_TIER_SET_ROW,
  CONTROL_FALLBACK_TERMS_TYPES,
  CONTROL_FALLBACK_TERMS_TYPES_PROJECT_TO,
  ENVELOPE_FIELDS_NOT_IN_DATA,
  FALLBACK_SKIP_REASONS,
  FIELDS_THAT_WOULD_HOLD_SOURCE_TEXT,
  fallbackSkippedFindings,
  oneEventForEachFile,
  sourceChangeFieldFindings,
  sourceChangeLogicalNameOf,
} from "../src/catalogue/types/control-fallback-terms.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";
import { validateBeforeWrite } from "../src/writer/validate.ts";
import {
  projectsToNothing,
  readAddedTypesTable,
  readProjectionTable,
} from "./support/spec-tables.ts";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SPEC_FILE = join(ROOT, "specs/111-event-schema-and-projection/spec.md");
const PROJECTION_TABLE = join(
  ROOT,
  "specs/144-compatibility-projection/contracts/projection-table.tsv",
);

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "ct-111-151-"));
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

/** The event of one accepted file, as F111-FR-051 describes it. */
function acceptedFile(file: string, index: number): Record<string, unknown> {
  return {
    file,
    changedRef: sourceChangeLogicalNameOf("111-event-schema-and-projection", file),
    oldHash: `${index}`.repeat(64).slice(0, 64),
    newHash: `${index + 5}`.repeat(64).slice(0, 64),
    acceptedAt: "2026-10-01T09:30:00.000Z",
  };
}

/* ------------------------------------------------------------------ *
 * The three types.
 * ------------------------------------------------------------------ */

test("CT-111-151: the three types of F111-FR-051 are rows of the catalogue, instant and unpaired", () => {
  assert.deepEqual(
    [...CONTROL_FALLBACK_TERMS_TYPES],
    ["source.change_accepted", "fallback.skipped", "terms.override_used"],
    "in the order the requirement names them",
  );
  for (const type of CONTROL_FALLBACK_TERMS_TYPES) {
    const entry = CATALOGUE_BY_TYPE.get(type);
    assert.ok(entry !== undefined, `${type} is a row of the catalogue`);
    assert.equal(entry.kind, "instant", `${type} is an instant`);
    assert.equal(entry.partner, "", `${type} has no partner`);
    assert.ok(dataSchemaForType(type) !== undefined, `${type} has a data schema`);
    assert.ok(refinedDataSchemaOf(type) !== undefined, `${type} has a refined data schema`);
  }
});

test('CT-111-151: the fields of each type are the fields of the table "Types added on 2026-09-30"', () => {
  if (!existsSync(SPEC_FILE)) {
    assert.ok(true, `skip: ${SPEC_FILE} is not in this checkout`);
    return;
  }
  const table = readAddedTypesTable(readFileSync(SPEC_FILE, "utf8"));
  for (const type of CONTROL_FALLBACK_TERMS_TYPES) {
    const row = table.find((candidate) => candidate.type === type);
    assert.ok(row !== undefined, `${type} is a row of the table`);
    const fromTheCatalogue = [...(CATALOGUE_BY_TYPE.get(type)?.dataFields ?? [])];
    assert.deepEqual(fromTheCatalogue, [...row.fields], `${type}: the row and the table agree`);
    const schema = refinedDataSchemaOf(type);
    assert.ok(schema !== undefined);
    assert.deepEqual(Object.keys(schema.properties), [...row.fields], `${type}: the schema`);
    assert.deepEqual([...schema.required], [...row.fields], `${type}: every field is required`);
  }
});

test("CT-111-151: the closed sets of the three come from annex X §X.6, never from a literal", () => {
  // `file`: rows 50 and 135, both `spec`, `plan`, `tasks`.
  assert.deepEqual([...ACCEPTED_SOURCE_FILES], ["spec", "plan", "tasks"]);
  assert.deepEqual([...(closedSet(50)?.members ?? [])], ["spec", "plan", "tasks"]);
  assert.deepEqual([...(closedSet(135)?.members ?? [])], ["spec", "plan", "tasks"]);
  // `reason`: the set "Reasons that skip a fallback entry" of feature 127.
  assert.deepEqual([...FALLBACK_SKIP_REASONS], [...(closedSet(208)?.members ?? [])]);
  assert.equal(closedSet(208)?.owner, "127", "the set is feature 127's");
  assert.deepEqual(
    [...FALLBACK_SKIP_REASONS],
    ["terms-refused", "no-cap", "not-in-plan", "limited"],
  );
  // `audience`: row 41.
  assert.deepEqual([...AUDIENCES], [...(closedSet(41)?.members ?? [])]);
  assert.ok(AUDIENCES.length > 0, "row 41 gives its members");
  // `authTier`: row 40, which holds no member yet; the field stays text until
  // feature 147 fills the row, and the schema says so rather than inventing it.
  assert.equal(AUTH_TIER_SET_ROW, 40);
  assert.deepEqual([...AUTH_TIERS], [...(closedSet(40)?.members ?? [])]);
  assert.equal(AUTH_TIERS.length, 0, "row 40 is empty today");
  assert.equal(refinedDataSchemaOf("terms.override_used")?.properties.authTier?.enum, undefined);
});

/* ------------------------------------------------------------------ *
 * `source.change_accepted`: one event for each file, no text of the source.
 * ------------------------------------------------------------------ */

test("CT-111-151: three accepted files are three events, one for each, on the primary file", () => {
  const dir = freshDir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({
    file,
    runId: "run-ct-111-151",
    launchId: "launch-ct-111-151",
    holder: "ct-111-151",
    now: () => new Date("2026-10-01T09:30:00.000Z"),
  });
  const accepted = ACCEPTED_SOURCE_FILES.map((name, index) => acceptedFile(name, index));
  try {
    for (const data of accepted) {
      assert.deepEqual([...checkRefinedData("source.change_accepted", data)], []);
      writer.append({ type: "source.change_accepted", data });
    }
  } finally {
    writer.close();
  }
  // The effect witness: the bytes of the file, through feature 100's reader.
  const written = readBack(file);
  assert.equal(written.length, 3, "three files accepted, three events written");
  assert.deepEqual(
    written.map((line) => line.data.file),
    ["spec", "plan", "tasks"],
    "one event for each file, each naming one member of the set",
  );
  assert.deepEqual(
    written.map((line) => line.seq),
    [1, 2, 3],
    "`seq` rises by one",
  );
  for (const line of written) {
    assert.equal(typeof line.data.file, "string", "`file` is one member and never a list");
    assert.equal(Array.isArray(line.data.file), false);
    assert.equal(line.data.acceptedAt, "2026-10-01T09:30:00.000Z");
    assert.match(String(line.data.oldHash), /^[0-9a-f]{64}$/);
    assert.match(String(line.data.newHash), /^[0-9a-f]{64}$/);
    assert.notEqual(line.data.oldHash, line.data.newHash);
  }
  assert.ok(statSync(file).size > 300, "the file holds the three lines");
  assert.match(sha256(file), /^[0-9a-f]{64}$/);
  // The check of "one for each file" over what was actually written.
  assert.deepEqual([...oneEventForEachFile(written.map((line) => line.data))], []);
});

test("CT-111-151: one event for each file — two events for one file, and a list, are findings", () => {
  const spec = acceptedFile("spec", 0);
  assert.deepEqual(
    [...oneEventForEachFile([spec, acceptedFile("plan", 1), { ...spec, newHash: "e".repeat(64) }])],
    ["source.change_accepted: the file `spec` is named by 2 events; one event for each file"],
  );
  assert.deepEqual(
    [...oneEventForEachFile([{ ...spec, file: ["spec", "plan"] }])],
    [
      "source.change_accepted: `file` holds a list; one event names one of " +
        "spec, plan, tasks and never several",
    ],
  );
  assert.deepEqual(
    [...oneEventForEachFile([{ ...spec, file: "annexes" }])],
    ["source.change_accepted: `annexes` is no member of spec, plan, tasks"],
  );
  // A list is refused by the schema as well: `file` carries the closed set.
  const findings = checkRefinedData("source.change_accepted", { ...spec, file: ["spec"] });
  assert.ok(
    findings.some((finding) => finding.keyword === "enum" && finding.path === "data.file"),
    `a list in \`file\` is refused: ${JSON.stringify(findings)}`,
  );
});

test("CT-111-151: no text of the source, no count and no detail of how it was accepted", () => {
  for (const name of ["text", "body", "diff", "patch", "content", "lines", "count", "detail"]) {
    assert.ok(
      (FIELDS_THAT_WOULD_HOLD_SOURCE_TEXT as readonly string[]).includes(name),
      `${name} is among the names that would hold the text, a count or a detail`,
    );
  }
  assert.deepEqual([...sourceChangeFieldFindings()], []);
  // Negative control: the row carrying one of them is a finding.
  const planted = [
    {
      type: "source.change_accepted",
      kind: "instant" as const,
      partner: "",
      dataFields: ["file", "diff"],
      freeTextFields: [],
    },
  ];
  assert.deepEqual(
    [...sourceChangeFieldFindings(planted)],
    [
      "source.change_accepted: the data field `diff` would hold the text of the source, a " +
        "count or a detail of how the change was accepted; F111-FR-051 keeps none of them",
    ],
  );
  // And an event that carries one is refused: the catalogue has no such field.
  const spec = acceptedFile("spec", 0);
  for (const name of ["diff", "count", "detail", "text"]) {
    const findings = checkRefinedData("source.change_accepted", { ...spec, [name]: "x" });
    assert.ok(
      findings.some(
        (finding) => finding.keyword === "additionalProperties" && finding.path === `data.${name}`,
      ),
      `${name} is refused: ${JSON.stringify(findings)}`,
    );
    assert.equal(
      validateBeforeWrite({ type: "source.change_accepted", data: { ...spec, [name]: "x" } })
        .admitted,
      false,
      `the writer's gate refuses an event carrying ${name}`,
    );
  }
  // `changedRef` is a LOGICAL NAME, as in `blocked`, and never a path.
  assert.equal(
    sourceChangeLogicalNameOf("111-event-schema-and-projection", "spec"),
    "feature:111-event-schema-and-projection:spec",
  );
  assert.ok(
    checkRefinedData("source.change_accepted", {
      ...spec,
      changedRef: "/repo/specs/x/spec.md",
    }).some((finding) => finding.keyword === "rule"),
    "a path in `changedRef` is a finding",
  );
});

/* ------------------------------------------------------------------ *
 * `fallback.skipped` and `terms.override_used`.
 * ------------------------------------------------------------------ */

test("CT-111-151: `fallback.skipped` carries the entry and a reason of its set", () => {
  const base = {
    entry: 2,
    entryHarness: "codex",
    entryProvider: "openai",
    authTier: "subscription",
    audience: AUDIENCES[0] as string,
    reason: "terms-refused",
  };
  assert.deepEqual([...checkRefinedData("fallback.skipped", base)], []);
  for (const reason of FALLBACK_SKIP_REASONS) {
    assert.deepEqual(
      [...checkRefinedData("fallback.skipped", { ...base, reason })],
      [],
      `${reason} is a member of the set of feature 127`,
    );
  }
  const findings = checkRefinedData("fallback.skipped", { ...base, reason: "because-i-said-so" });
  assert.ok(
    findings.some((finding) => finding.keyword === "enum" && finding.path === "data.reason"),
    `a reason outside the set is refused: ${JSON.stringify(findings)}`,
  );
  // `entry` is the POSITION of the entry in the fallback list of the role.
  assert.ok(
    checkRefinedData("fallback.skipped", { ...base, entry: "second" }).some(
      (finding) => finding.keyword === "type" && finding.path === "data.entry",
    ),
    "`entry` is the position, a whole number",
  );
  // An audience outside row 41 is refused.
  assert.ok(
    checkRefinedData("fallback.skipped", { ...base, audience: "everyone" }).some(
      (finding) => finding.keyword === "enum" && finding.path === "data.audience",
    ),
  );
});

test("CT-111-151: the envelope names the entry IN USE; the skipped entry is in `data`", () => {
  // "The role is the envelope field `role`; the envelope fields `harness` and
  // `provider` name the entry in use, not the skipped one" — so the skipped
  // entry is named by `entryHarness` and `entryProvider` in `data`, and `data`
  // never carries the envelope's own three names.
  assert.deepEqual([...ENVELOPE_FIELDS_NOT_IN_DATA], ["harness", "provider", "role"]);
  const entry = CATALOGUE_BY_TYPE.get("fallback.skipped");
  assert.ok(entry !== undefined);
  assert.ok(entry.dataFields.includes("entryHarness"));
  assert.ok(entry.dataFields.includes("entryProvider"));
  assert.deepEqual([...fallbackSkippedFindings(entry.dataFields)], []);
  assert.deepEqual(
    [...fallbackSkippedFindings(["entry", "harness", "role"])],
    [
      "fallback.skipped: `harness` is a field of the envelope and names the entry in use; " +
        "the skipped entry is `entryHarness`/`entryProvider` in `data`",
      "fallback.skipped: `role` is a field of the envelope and names the entry in use; " +
        "the skipped entry is `entryHarness`/`entryProvider` in `data`",
    ],
  );
});

test("CT-111-151: `terms.override_used` carries the provider, the auth tier and the audience", () => {
  const data = { termsProvider: "anthropic", authTier: "api", audience: AUDIENCES[0] as string };
  assert.deepEqual([...checkRefinedData("terms.override_used", data)], []);
  for (const audience of AUDIENCES) {
    assert.deepEqual([...checkRefinedData("terms.override_used", { ...data, audience })], []);
  }
  assert.ok(
    checkRefinedData("terms.override_used", { ...data, audience: "the-world" }).some(
      (finding) => finding.keyword === "enum" && finding.path === "data.audience",
    ),
    "an audience outside row 41 is refused",
  );
  // Every field of the table is required: an event without one is refused.
  for (const field of ["termsProvider", "authTier", "audience"]) {
    const partial: Record<string, unknown> = { ...data };
    delete partial[field];
    assert.ok(
      checkRefinedData("terms.override_used", partial).some(
        (finding) => finding.keyword === "required" && finding.path === `data.${field}`,
      ),
      `${field} is required`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Each projects to nothing.
 * ------------------------------------------------------------------ */

test("CT-111-151: each of the three projects to nothing", () => {
  assert.equal(
    CONTROL_FALLBACK_TERMS_TYPES_PROJECT_TO,
    null,
    "F111-FR-051: they project to nothing",
  );
  if (!existsSync(PROJECTION_TABLE)) {
    assert.ok(true, `skip: ${PROJECTION_TABLE} is not in this checkout`);
    return;
  }
  const rows = readProjectionTable(readFileSync(PROJECTION_TABLE, "utf8"));
  for (const type of CONTROL_FALLBACK_TERMS_TYPES) {
    assert.ok(
      rows.some((row) => row.type === type),
      `${type} has a row in feature 144's projection table`,
    );
    assert.equal(projectsToNothing(rows, type), true, `${type} projects to nothing`);
  }
  assert.equal(projectsToNothing(rows, "run.started"), false, "run.started does project");
});
