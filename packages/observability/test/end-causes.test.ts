/**
 * T073 — the closed sets of `endCause` and of `outcome` as data, the rename of
 * the `data` field `cause` to `endCause`, and the build failing on a `data`
 * schema that has a field named `cause` (F111-FR-005, F111-FR-007,
 * F111-FR-010).
 *
 * THE TWO NAMES MEAN TWO THINGS. `cause` in the ENVELOPE (annex X §X.1) is the
 * `seq` or the id of the event that led to this one. `endCause` in `data` is
 * why a pass, a phase attempt or an engine start ended. They are not the same
 * fact, so they do not share a name: `data-model.md` says *no `data` of a
 * catalogue type has a field named `cause`*, and this is where the build is
 * made to fail when one appears.
 *
 * The sets themselves are DATA in `src/catalogue/end-causes.ts`, read from
 * `@specstride/contracts` by the ROW NUMBER of annex X §X.6 and never written
 * out as literals. The independent oracle is `data-model.md`: its four tables
 * under "End causes and outcomes (closed sets)" are parsed here by a parser
 * written for this test alone, and every member of every set must appear in
 * both. The effect witness for the rename is a real event file: an emitter
 * that writes `cause` has its field renamed before the write, and the bytes on
 * disk — read back through `readEventLine` of `@specstride/contracts` — carry
 * `endCause` in `data` and nothing named `cause`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEventLine } from "@specstride/contracts/envelope/event";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { CATALOGUE, parseCatalogue } from "../src/catalogue/index.ts";
import { refinedDataSchemaOf } from "../src/catalogue/types/index.ts";
import {
  CHECKED_AT_LOAD,
  CauseFieldError,
  DATA_END_CAUSE_FIELD,
  END_CAUSE_SETS,
  ENVELOPE_CAUSE_FIELD,
  FIELDS_THAT_GO_WITH,
  PASS_END_CAUSES,
  ATTEMPT_END_CAUSES,
  PHASE_OUTCOMES,
  RENAMED_DATA_FIELD,
  RUN_END_CAUSES_ENGINE,
  RUN_END_CAUSES_SYNTHESIZED,
  assertNoCauseFieldInADataSchema,
  causeFieldFindings,
  endCauseSetConsistencyFindings,
  endCauseSetOf,
  readUnknownAs,
  renameCauseToEndCause,
} from "../src/catalogue/end-causes.ts";
import { PrimaryWriter } from "../src/writer/writer.ts";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const DATA_MODEL = join(ROOT, "specs/111-event-schema-and-projection/data-model.md");

/* ------------------------------------------------------------------ *
 * The independent oracle: the four tables of `data-model.md`.
 * ------------------------------------------------------------------ */

/** The members of one `### `-table of "End causes and outcomes (closed sets)". */
export function readMembersOfTable(dataModel: string, heading: string): readonly string[] {
  const from = dataModel.indexOf(`### ${heading}`);
  assert.ok(from >= 0, `data-model.md holds the table ${heading}`);
  const after = dataModel.slice(from + heading.length);
  const end = after.indexOf("\n### ");
  const section = end < 0 ? after : after.slice(0, end);
  const members: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = (line.split("|")[1] ?? "").trim();
    const name = /^`([a-z][a-z0-9_-]*)`$/.exec(first);
    if (name !== null) members.push(name[1] as string);
  }
  assert.ok(members.length > 0, `the table ${heading} holds members`);
  return Object.freeze(members);
}

/** The reading of an unknown value a table records: "Unknown value: read as `x`." */
export function readUnknownValueOf(dataModel: string, heading: string): string | undefined {
  const from = dataModel.indexOf(`### ${heading}`);
  assert.ok(from >= 0);
  const after = dataModel.slice(from + heading.length);
  const end = after.indexOf("\n### ");
  const section = end < 0 ? after : after.slice(0, end);
  const hit = /Unknown value(?: of `[a-zA-Z]+`)?: read as `([a-z_-]+)`/.exec(section);
  return hit === null ? undefined : (hit[1] as string);
}

const DATA_MODEL_TEXT = existsSync(DATA_MODEL) ? readFileSync(DATA_MODEL, "utf8") : "";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "t073-"));
}

/* ------------------------------------------------------------------ *
 * 1. The closed sets, as data.
 * ------------------------------------------------------------------ */

test("T073: the four closed sets are data, read from annex X §X.6 by row number", () => {
  assert.equal(END_CAUSE_SETS.length, 5, "pass, phase attempt, phase, and the two of a run");
  for (const set of END_CAUSE_SETS) {
    assert.ok(set.rows.length > 0, `${set.type}.${set.field} names its rows of annex X §X.6`);
    assert.ok(set.members.length > 0, `${set.type}.${set.field} has members`);
    for (const row of set.rows) {
      const fromTheContract = closedSet(row);
      assert.ok(fromTheContract !== undefined, `the closed set of row ${row} exists`);
      assert.ok(fromTheContract.members.length > 0, `row ${row} gives its members`);
      // Every member this module holds is a member of the contract's row: the
      // members are READ and never written out here.
      for (const member of set.members) {
        assert.ok(
          set.rows.some((number) => (closedSet(number)?.members ?? []).includes(member)),
          `${member} is a member of a row of ${set.type}.${set.field}`,
        );
      }
    }
  }
  assert.deepEqual([...PASS_END_CAUSES], [...(closedSet(271)?.members ?? [])], "row 271");
  assert.deepEqual([...ATTEMPT_END_CAUSES], [...(closedSet(272)?.members ?? [])], "row 272");
  assert.deepEqual([...PHASE_OUTCOMES], [...(closedSet(273)?.members ?? [])], "row 273");
  assert.deepEqual([...RUN_END_CAUSES_SYNTHESIZED], [...(closedSet(96)?.members ?? [])], "row 96");
  // Row 5 merges the terminal `cause` with `causedBy`; F111-FR-005 names the
  // three that are a cause of an engine's own end.
  assert.deepEqual([...RUN_END_CAUSES_ENGINE], ["normal", "crash", "owner-lost"]);
  for (const member of RUN_END_CAUSES_ENGINE) {
    assert.ok((closedSet(5)?.members ?? []).includes(member), `${member} is of row 5`);
  }
});

test("T073: the sets say the same as the tables of data-model.md", () => {
  if (DATA_MODEL_TEXT.length === 0) {
    assert.ok(true, `skip: ${DATA_MODEL} is not in this checkout`);
    return;
  }
  assert.deepEqual(
    [...PASS_END_CAUSES],
    [...readMembersOfTable(DATA_MODEL_TEXT, "`pass.ended`, field `endCause`")],
  );
  assert.deepEqual(
    [...ATTEMPT_END_CAUSES],
    [...readMembersOfTable(DATA_MODEL_TEXT, "`attempt.ended`, field `endCause`")],
  );
  assert.deepEqual(
    [...PHASE_OUTCOMES],
    [...readMembersOfTable(DATA_MODEL_TEXT, "`phase.ended`, field `outcome`")],
  );
  // The unknown-value readings of the three tables.
  assert.equal(
    readUnknownValueOf(DATA_MODEL_TEXT, "`pass.ended`, field `endCause`"),
    readUnknownAs("pass.ended", "endCause"),
  );
  assert.equal(
    readUnknownValueOf(DATA_MODEL_TEXT, "`attempt.ended`, field `endCause`"),
    readUnknownAs("attempt.ended", "endCause"),
  );
  assert.equal(
    readUnknownValueOf(DATA_MODEL_TEXT, "`phase.ended`, field `outcome`"),
    readUnknownAs("phase.ended", "outcome"),
  );
  assert.equal(readUnknownAs("pass.ended", "endCause"), "error");
  assert.equal(readUnknownAs("attempt.ended", "endCause"), "error");
  assert.equal(readUnknownAs("phase.ended", "outcome"), "halted");
});

test("T073: the fields that go with each end cause of a pass are data too", () => {
  // `data-model.md` names, for each member of row 271, the fields that go with
  // it. `evidence` goes with `evidence`; `quota_pause` and `stopped` with none;
  // `crash` only on a closer marked `synthesized`.
  for (const member of PASS_END_CAUSES) {
    assert.ok(
      Object.hasOwn(FIELDS_THAT_GO_WITH, member),
      `${member} has a row in the table of the fields that go with it`,
    );
  }
  assert.deepEqual([...(FIELDS_THAT_GO_WITH.evidence ?? [])], ["evidence"]);
  assert.deepEqual([...(FIELDS_THAT_GO_WITH.quota_pause ?? [])], []);
  assert.deepEqual([...(FIELDS_THAT_GO_WITH.stopped ?? [])], []);
  assert.deepEqual([...(FIELDS_THAT_GO_WITH.crash ?? [])], ["synthesized"]);
  assert.deepEqual(
    [...(FIELDS_THAT_GO_WITH.hard_cap ?? [])],
    ["reason", "elapsed", "consec", "max"],
  );
  // Every field named is a `data` field of `pass.ended`.
  const entry = CATALOGUE.find((row) => row.type === "pass.ended");
  assert.ok(entry !== undefined);
  for (const [member, fields] of Object.entries(FIELDS_THAT_GO_WITH)) {
    for (const field of fields) {
      assert.ok(
        entry.dataFields.includes(field),
        `${member}: ${field} is a data field of pass.ended`,
      );
    }
  }
});

test("T073: which set a `run.ended` is read against follows `synthesized` (F111-FR-005)", () => {
  assert.deepEqual(
    [...(endCauseSetOf("run.ended", { synthesized: true }) ?? [])],
    [...RUN_END_CAUSES_SYNTHESIZED],
  );
  assert.deepEqual(
    [...(endCauseSetOf("run.ended", { synthesized: false }) ?? [])],
    [...RUN_END_CAUSES_ENGINE],
  );
  assert.deepEqual([...(endCauseSetOf("run.ended", {}) ?? [])], [...RUN_END_CAUSES_ENGINE]);
  assert.deepEqual([...(endCauseSetOf("pass.ended", {}) ?? [])], [...PASS_END_CAUSES]);
  assert.deepEqual([...(endCauseSetOf("attempt.ended", {}) ?? [])], [...ATTEMPT_END_CAUSES]);
  assert.deepEqual([...(endCauseSetOf("phase.ended", {}) ?? [])], [...PHASE_OUTCOMES]);
  assert.equal(endCauseSetOf("alert", {}), undefined, "a type with no end cause has no set");
  // `crash` means the same in both; `host_exit` is of row 96 alone and
  // `normal` of row 5 alone.
  assert.ok(
    RUN_END_CAUSES_ENGINE.includes("crash") && RUN_END_CAUSES_SYNTHESIZED.includes("crash"),
  );
  assert.ok(!RUN_END_CAUSES_ENGINE.includes("host_exit"));
  assert.ok(!RUN_END_CAUSES_SYNTHESIZED.includes("normal"));
});

test("T073: the sets and the `data` schemas that ship say the same thing", () => {
  assert.deepEqual([...endCauseSetConsistencyFindings()], []);
  // The schemas really do carry them, so the check above is not vacuous.
  assert.deepEqual(
    [...(refinedDataSchemaOf("pass.ended")?.properties.endCause?.enum ?? [])],
    [...PASS_END_CAUSES],
  );
  assert.deepEqual(
    [...(refinedDataSchemaOf("attempt.ended")?.properties.endCause?.enum ?? [])],
    [...ATTEMPT_END_CAUSES],
  );
  assert.deepEqual(
    [...(refinedDataSchemaOf("phase.ended")?.properties.outcome?.enum ?? [])],
    [...PHASE_OUTCOMES],
  );
});

/* ------------------------------------------------------------------ *
 * 2. The rename: `cause` becomes `endCause`.
 * ------------------------------------------------------------------ */

test("T073: the `data` field is `endCause`; `cause` is the envelope's and is renamed", () => {
  assert.equal(DATA_END_CAUSE_FIELD, "endCause");
  assert.equal(ENVELOPE_CAUSE_FIELD, "cause");
  assert.deepEqual({ ...RENAMED_DATA_FIELD }, { from: "cause", to: "endCause" });
  // The rename, on each of the types that has an end cause in `data`.
  assert.deepEqual(renameCauseToEndCause("pass.ended", { cause: "error", consec: 2 }), {
    endCause: "error",
    consec: 2,
  });
  assert.deepEqual(renameCauseToEndCause("attempt.ended", { cause: "rejected" }), {
    endCause: "rejected",
  });
  assert.deepEqual(renameCauseToEndCause("run.ended", { cause: "normal" }), {
    endCause: "normal",
  });
  // `phase.ended` carries `outcome`, not `endCause`: the rename leaves it alone
  // rather than inventing a field the catalogue does not have.
  assert.deepEqual(renameCauseToEndCause("phase.ended", { cause: "approved" }), {
    cause: "approved",
  });
  // A type with no end cause is untouched, and an existing `endCause` wins: a
  // record that carries both is not quietly overwritten.
  assert.deepEqual(renameCauseToEndCause("alert", { cause: "x" }), { cause: "x" });
  assert.deepEqual(renameCauseToEndCause("pass.ended", { cause: "error", endCause: "killed" }), {
    cause: "error",
    endCause: "killed",
  });
  // And nothing without a `cause` is changed at all.
  const already = { endCause: "evidence", evidence: "feature:111:gate7:evidence" };
  assert.deepEqual(renameCauseToEndCause("pass.ended", already), already);
});

test("T073: an emitter that writes `cause` reaches the file with `endCause` in `data`", () => {
  const dir = freshDir();
  const file = join(dir, "events.jsonl");
  const writer = PrimaryWriter.open({
    file,
    runId: "run-t073",
    launchId: "launch-t073",
    holder: "t073",
    now: () => new Date("2026-10-01T00:00:00.000Z"),
  });
  try {
    // The envelope field `cause` (the link to the event that led to this one)
    // travels beside the renamed `data` field, and the two do not collide. It
    // is written as TEXT: annex X §X.1 reads "the `seq` or the id of the event
    // that led to this one", and the envelope schema feature 100 ships
    // (`packages/contracts/schemas/event-envelope.schema.json`) types the field
    // as a string, so a `seq` travels as its decimal form. That file belongs to
    // feature 100 and was not edited.
    writer.append({
      type: "pass.ended",
      cause: "7",
      data: renameCauseToEndCause("pass.ended", {
        cause: "no_progress",
        consec: 3,
        timeBreakdown: { modelMs: 1, toolMs: 1, waitMs: 0, idleMs: 0 },
        firstEditAt: null,
        usageComplete: true,
        transcriptRef: null,
      }),
    });
  } finally {
    writer.close();
  }
  const line = readFileSync(file, "utf8").trimEnd();
  const read = readEventLine(line, true);
  assert.equal(read.ok, true, line);
  assert.ok(read.ok);
  const data = (read.event.data ?? {}) as Record<string, unknown>;
  assert.equal(data.endCause, "no_progress", "`data.endCause` is on disk");
  assert.equal(Object.hasOwn(data, "cause"), false, "`data` holds nothing named cause");
  assert.equal(read.event.cause, "7", "the ENVELOPE field `cause` is untouched");
  assert.ok(PASS_END_CAUSES.includes(String(data.endCause)));
  assert.ok(statSync(file).size > 100);
  assert.match(createHash("sha256").update(readFileSync(file)).digest("hex"), /^[0-9a-f]{64}$/);
});

/* ------------------------------------------------------------------ *
 * 3. The build fails when a `data` schema has a field named `cause`.
 * ------------------------------------------------------------------ */

test("T073: no `data` schema of the product has a field named `cause`", () => {
  assert.deepEqual([...causeFieldFindings()], []);
  assert.equal(CHECKED_AT_LOAD, true, "the check ran when the module was loaded");
  assert.doesNotThrow(() => assertNoCauseFieldInADataSchema());
});

test("T073: a row or a schema with a field named `cause` is a finding, and throws", () => {
  const planted = [
    {
      type: "pass.ended",
      kind: "close" as const,
      partner: "pass.started",
      dataFields: ["cause", "consec"],
      freeTextFields: [],
    },
  ];
  assert.deepEqual(
    [...causeFieldFindings(planted)],
    [
      "pass.ended: the data field `cause` is a field of the envelope (annex X §X.1); " +
        "the end cause of a `data` is named `endCause`",
    ],
  );
  assert.throws(
    () => assertNoCauseFieldInADataSchema(planted),
    (error: unknown) => {
      assert.ok(error instanceof CauseFieldError, `${String(error)} is a CauseFieldError`);
      assert.match(String(error.message), /`cause`/);
      return true;
    },
  );
  // A SCHEMA that holds the property, with a row that does not: both halves are
  // read, because a schema is where a validator would admit the field.
  const schemas = new Map([
    [
      "pass.ended",
      {
        $schema: "https://json-schema.org/draft/2020-12/schema" as const,
        $id: "specstride.event.data/1:pass.ended",
        title: "the data of pass.ended",
        type: "object" as const,
        properties: { cause: {} },
        additionalProperties: false as const,
        required: [],
      },
    ],
  ]);
  assert.deepEqual(
    [...causeFieldFindings(CATALOGUE, schemas)],
    [
      "pass.ended: the data schema has a property named `cause`, which is a field of the " +
        "envelope (annex X §X.1); the end cause of a `data` is named `endCause`",
    ],
  );
});

test("T073: the build FAILS on a catalogue with a `data` field named `cause`", () => {
  // The observable effect of "make the build fail" is a non-zero exit code.
  // A catalogue with the field is written to a temporary directory — never into
  // the package — and the guard is run over it in a child process.
  const dir = freshDir();
  const catalogue = join(dir, "event-catalogue.tsv");
  writeFileSync(
    catalogue,
    [
      "type\tkind\tpartner\tdata_fields\tfree_text_fields",
      "pass.started\topen\tpass.ended\tsessionId\t",
      "pass.ended\tclose\tpass.started\tcause,consec\t",
      "",
    ].join("\n"),
  );
  const script = join(dir, "guard.mjs");
  const packageDir = join(ROOT, "packages/observability");
  writeFileSync(
    script,
    [
      `import { readFileSync } from "node:fs";`,
      `import { parseCatalogue } from ${JSON.stringify(pathToFileURL(join(packageDir, "src/catalogue/index.ts")).href)};`,
      `import { assertNoCauseFieldInADataSchema } from ${JSON.stringify(pathToFileURL(join(packageDir, "src/catalogue/end-causes.ts")).href)};`,
      `const rows = parseCatalogue(readFileSync(${JSON.stringify(catalogue)}, "utf8"));`,
      `assertNoCauseFieldInADataSchema(rows);`,
      `console.log("the guard did not fire");`,
      "",
    ].join("\n"),
  );
  let code = 0;
  let output = "";
  try {
    output = execFileSync(process.execPath, [script], {
      cwd: packageDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string; stdout?: string };
    code = failure.status ?? -1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  assert.notEqual(code, 0, `the guard exits non-zero; it exited ${code} with: ${output}`);
  assert.match(output, /CauseFieldError/, output);
  assert.match(output, /pass\.ended/, output);
  assert.ok(!output.includes("the guard did not fire"), output);
  // The control: the SHIPPED catalogue passes the same guard in the same child.
  const clean = join(dir, "clean.mjs");
  writeFileSync(
    clean,
    [
      `import { CATALOGUE } from ${JSON.stringify(pathToFileURL(join(packageDir, "src/catalogue/index.ts")).href)};`,
      `import { assertNoCauseFieldInADataSchema } from ${JSON.stringify(pathToFileURL(join(packageDir, "src/catalogue/end-causes.ts")).href)};`,
      `assertNoCauseFieldInADataSchema(CATALOGUE);`,
      `console.log("ok " + CATALOGUE.length);`,
      "",
    ].join("\n"),
  );
  const ok = execFileSync(process.execPath, [clean], {
    cwd: packageDir,
    encoding: "utf8",
  });
  assert.match(ok, new RegExp(`ok ${CATALOGUE.length}`));
  assert.equal(
    parseCatalogue(readFileSync(catalogue, "utf8")).length,
    2,
    "the planted file parsed",
  );
});
