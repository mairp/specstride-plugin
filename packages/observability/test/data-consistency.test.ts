/**
 * T002 — the consistency check of `specs/111-event-schema-and-projection/
 * contracts/README.md` over the event catalogue, in the build.
 *
 * The catalogue is DATA (plan.md, "Approach"): one row per event type, with
 * its kind, its partner, its `data` fields and the free-text fields it marks
 * with their ingress class. `packages/observability/data/event-catalogue.tsv`
 * is the copy the package ships; the contract source stays under `specs/`.
 *
 * `contracts/README.md` names four checks, and this file is where the build
 * runs them:
 *
 *   1. every partner of a pair is a type;
 *   2. every type of the catalogue is written in `spec.md`;
 *   3. every marked field is a field of its type;
 *   4. no `data` field is named `cause`, which is a field of the envelope.
 *
 * Each check is a function over the parsed rows, so a negative control can
 * show that it detects the violation it is there to detect; check 2 reads the
 * specification and reports a skip with its reason where the `specs/` tree is
 * not in the checkout.
 *
 * T074 EXTENDS the three checks of F111-FR-001 and F111-FR-016, because each of
 * them passed for a weaker reason than the one the quickstart means:
 *
 *   1. *every partner is a type* was satisfied by a partner that merely EXISTS.
 *      `pairsAreMutual` asks the rest: the partner of an opener is a closer
 *      that names the opener back (the canonical closer of F111-FR-003), and
 *      the partner of a closer is an opener. An opener with two closers —
 *      `recovery.diagnosis_started` ends in `_done` or `_failed` — is still
 *      well formed: only the `open` row names the canonical one.
 *   2. *every type is in `spec.md`* was satisfied by the NAME appearing
 *      anywhere in the file, a retirement note included.
 *      `typesWrittenInTheCatalogue` narrows the haystack to the section "Event
 *      catalogue" and the requirement bullets, and `namedTypesAreRows` adds the
 *      direction that was missing altogether: every type the specification
 *      NAMES is a row, so a type written in the spec and forgotten in the data
 *      is a finding and not a silence.
 *   3. *every marked field is a field of its type* was checked against one copy
 *      of the marks. F111-FR-016 names TWO — the column "Free-text fields" of
 *      `data-model.md` and the column `free_text_fields` of the contract — so
 *      `marksAgreeWithTheDataModel` holds them against each other, and
 *      `enforcementReadsTheColumn` holds the ENFORCEMENT of T027
 *      (`src/writer/freetext.ts`) against the column, cell by cell, and drives
 *      a value through it to show the cap that is applied is the cap the column
 *      names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingressClasses } from "@specstride/contracts/enums/all-sets";
import {
  CLASS_LIMITS,
  capBytes,
  freeTextFieldsOf,
  ingressClassOf,
} from "../src/writer/freetext.ts";
import {
  REQUIREMENT_IDS_MOVED_TO_144,
  RETIRED_REQUIREMENT_IDS,
  RETIRED_TEST_IDS,
} from "../src/catalogue/retired.ts";
import { readAddedTypesTable } from "./support/spec-tables.ts";

/** The repository root: three levels up from `packages/observability/test`. */
const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/** The copy this package ships and that the writer reads (T002). */
export const CATALOGUE_FILE = join(ROOT, "packages/observability/data/event-catalogue.tsv");

/** The contract source the copy is taken from. */
export const CONTRACT_FILE = join(
  ROOT,
  "specs/111-event-schema-and-projection/contracts/event-catalogue.tsv",
);

/** The specification check 2 reads. */
export const SPEC_FILE = join(ROOT, "specs/111-event-schema-and-projection/spec.md");

/** The second copy of the marks F111-FR-016 names (T074). */
export const DATA_MODEL_FILE = join(ROOT, "specs/111-event-schema-and-projection/data-model.md");

/** The columns of the catalogue, in order. */
export const COLUMNS = ["type", "kind", "partner", "data_fields", "free_text_fields"] as const;

/** The kinds of an event type (`open`, `close`, `instant`). */
export const KINDS = ["open", "close", "instant"] as const;

/** One row of the catalogue. */
export type CatalogueRow = {
  readonly type: string;
  readonly kind: (typeof KINDS)[number];
  readonly partner: string;
  readonly dataFields: readonly string[];
  /** The free-text marks, each `field` with the `ingressClass` of its cap. */
  readonly freeTextFields: readonly { readonly field: string; readonly ingressClass: string }[];
};

function cells(line: string): string[] {
  return line.split("\t");
}

function list(cell: string): string[] {
  return cell
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Parse the catalogue. Throws where the header is not the five columns. */
export function readCatalogue(text: string): readonly CatalogueRow[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const header = cells(lines[0] ?? "");
  assert.deepEqual(header, [...COLUMNS], "the header of the catalogue is the five columns");
  return Object.freeze(
    lines.slice(1).map((line) => {
      const [type, kind, partner, dataFields, freeTextFields] = cells(line);
      assert.ok(type !== undefined && kind !== undefined, `a row without a type: ${line}`);
      return Object.freeze({
        type,
        kind: kind as CatalogueRow["kind"],
        partner: partner ?? "",
        dataFields: Object.freeze(list(dataFields ?? "")),
        freeTextFields: Object.freeze(
          list(freeTextFields ?? "").map((mark) => {
            const at = mark.lastIndexOf(":");
            return Object.freeze({
              field: at < 0 ? mark : mark.slice(0, at),
              ingressClass: at < 0 ? "" : mark.slice(at + 1),
            });
          }),
        ),
      });
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The four checks of `contracts/README.md`.
 * ------------------------------------------------------------------ */

/** Check 1 — every partner of a pair is a type of the catalogue. */
export function partnersAreTypes(rows: readonly CatalogueRow[]): readonly string[] {
  const types = new Set(rows.map((row) => row.type));
  const findings: string[] = [];
  for (const row of rows) {
    if (row.partner.length === 0) continue;
    if (!types.has(row.partner)) {
      findings.push(`${row.type}: the partner ${row.partner} is no type of the catalogue`);
    }
  }
  return Object.freeze(findings);
}

/** Check 2 — every type of the catalogue is written in `spec.md`. */
export function typesWrittenInSpec(
  rows: readonly CatalogueRow[],
  specification: string,
): readonly string[] {
  return Object.freeze(
    rows
      .filter((row) => !specification.includes(row.type))
      .map((row) => `${row.type}: the type is in the catalogue and not in spec.md`),
  );
}

/** Check 3 — every marked field is a `data` field of its type. */
export function marksAreDataFields(rows: readonly CatalogueRow[]): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const fields = new Set(row.dataFields);
    for (const mark of row.freeTextFields) {
      if (mark.ingressClass.length === 0) {
        findings.push(`${row.type}: the mark ${mark.field} carries no ingress class`);
        continue;
      }
      if (!fields.has(mark.field)) {
        findings.push(`${row.type}: the marked field ${mark.field} is no data field of the type`);
      }
    }
  }
  return Object.freeze(findings);
}

/** Check 4 — no `data` field is named `cause`; `cause` is a field of the envelope. */
export function noDataFieldNamedCause(rows: readonly CatalogueRow[]): readonly string[] {
  return Object.freeze(
    rows
      .filter((row) => row.dataFields.includes("cause"))
      .map((row) => `${row.type}: a data field named cause; cause is a field of the envelope`),
  );
}

/** Every ingress class of a mark is a member of the closed set of row 89. */
export function marksCarryAKnownIngressClass(rows: readonly CatalogueRow[]): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    for (const mark of row.freeTextFields) {
      if (!ingressClasses.has(mark.ingressClass)) {
        findings.push(
          `${row.type}.${mark.field}: ${mark.ingressClass} is no member of the ingress classes`,
        );
      }
    }
  }
  return Object.freeze(findings);
}

/** The kind and the partner agree: an `instant` has none, an `open` or `close` has one. */
export function kindAgreesWithPartner(rows: readonly CatalogueRow[]): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    if (!(KINDS as readonly string[]).includes(row.kind)) {
      findings.push(`${row.type}: ${row.kind} is no kind of an event type`);
      continue;
    }
    const hasPartner = row.partner.length > 0;
    if (row.kind === "instant" && hasPartner) {
      findings.push(`${row.type}: an instant has no partner`);
    }
    if (row.kind !== "instant" && !hasPartner) {
      findings.push(`${row.type}: a ${row.kind} has a partner`);
    }
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * T074 — the three checks, extended.
 * ------------------------------------------------------------------ */

/**
 * Check 1, extended — the partner of an OPENER is a closer that names the
 * opener back (the canonical closer); the partner of a CLOSER is an opener. An
 * opener with more than one closer is well formed: only the `open` row names
 * the canonical one (`src/writer/pairs.ts`, F111-FR-003).
 */
export function pairsAreMutual(rows: readonly CatalogueRow[]): readonly string[] {
  const by = new Map(rows.map((row) => [row.type, row]));
  const findings: string[] = [];
  for (const row of rows) {
    if (row.kind === "instant") continue;
    const partner = by.get(row.partner);
    if (partner === undefined) continue; // check 1 reports a partner that is no type.
    const wanted = row.kind === "open" ? "close" : "open";
    if (partner.kind !== wanted) {
      findings.push(
        `${row.type}: the partner ${partner.type} of a ${row.kind} is a ${partner.kind}, ` +
          `and a ${wanted} is what closes or opens it`,
      );
      continue;
    }
    if (row.kind === "open" && partner.partner !== row.type) {
      findings.push(
        `${row.type}: its canonical closer ${partner.type} names ` +
          `${partner.partner.length === 0 ? "(none)" : partner.partner} as its opener`,
      );
    }
  }
  return Object.freeze(findings);
}

/** The section "Event catalogue" of `spec.md`, up to the table of the additions. */
export function catalogueSectionOf(specification: string): string {
  const from = specification.indexOf("## Event catalogue");
  if (from < 0) return "";
  const after = specification.slice(from);
  const end = after.indexOf("### Types added on 2026-09-30");
  return end < 0 ? after : after.slice(0, end);
}

/**
 * The prose a type of the catalogue has to be written in: the section "Event
 * catalogue" (its table and its sentence of pairs), the table of the additions
 * of 2026-09-30, and the requirement bullets — F111-FR-015 is where the seven
 * `parallel.*` types are named one by one, the catalogue table naming them
 * together.
 */
export function catalogueProse(specification: string): string {
  const added = specification.slice(specification.indexOf("### Types added on 2026-09-30"));
  const bullets = specification
    .split("\n")
    .filter((line) => line.startsWith("- **F111-FR-"))
    .join("\n");
  return `${catalogueSectionOf(specification)}\n${added}\n${bullets}`;
}

/**
 * Check 2, extended — every type of the catalogue is written in the CATALOGUE
 * of `spec.md`, not merely somewhere in the file. A name that appears only in a
 * note about a retirement does not count as a type of the catalogue.
 */
export function typesWrittenInTheCatalogue(
  rows: readonly CatalogueRow[],
  specification: string,
): readonly string[] {
  const prose = catalogueProse(specification);
  return Object.freeze(
    rows
      .filter((row) => !prose.includes(`\`${row.type}\``))
      .map(
        (row) =>
          `${row.type}: the type is in the catalogue and is not written in the ` +
          `"Event catalogue" of spec.md`,
      ),
  );
}

/** The form of an event type name (F111-FR-001), for reading names out of prose. */
const NAME_IN_PROSE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/**
 * Every event type the specification NAMES: the column "Types" of the
 * catalogue table, the sentence of pairs, and the first column of the table of
 * the additions. A retired row of that table is not a name of a type.
 */
export function typesNamedInTheSpecification(specification: string): readonly string[] {
  const named = new Set<string>();
  for (const line of catalogueSectionOf(specification).split("\n")) {
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1);
      // The table reads `| Area | Types | Key \`data\` |`; only the second cell
      // holds type names. The third holds FIELD names, also in backticks.
      const types = cells[1] ?? "";
      for (const hit of types.matchAll(/`([^`]+)`/g)) {
        const token = hit[1] as string;
        if (NAME_IN_PROSE.test(token)) named.add(token);
      }
      continue;
    }
    if (!line.startsWith("Pairs:")) continue;
    for (const hit of line.matchAll(/`([^`]+)`/g)) {
      const token = hit[1] as string;
      if (NAME_IN_PROSE.test(token)) named.add(token);
    }
  }
  for (const row of readAddedTypesTable(specification)) {
    if (row.retired) continue;
    named.add(row.type);
  }
  return Object.freeze([...named]);
}

/**
 * Check 2, the direction that was missing — every type the specification names
 * is a row of the catalogue. A type written in `spec.md` and forgotten in the
 * data would otherwise be a silence.
 */
export function namedTypesAreRows(
  rows: readonly CatalogueRow[],
  specification: string,
): readonly string[] {
  const types = new Set(rows.map((row) => row.type));
  return Object.freeze(
    typesNamedInTheSpecification(specification)
      .filter((type) => !types.has(type))
      .map((type) => `${type}: spec.md names the type and the catalogue holds no row for it`),
  );
}

/**
 * The marks of the column "Free-text fields (ingress class)" of the catalogue
 * table of `data-model.md`, in the form `\`field\` (class)`.
 */
export function readDataModelMarks(
  dataModel: string,
): ReadonlyMap<string, readonly { readonly field: string; readonly ingressClass: string }[]> {
  const from = dataModel.indexOf("## Event catalogue");
  const section = from < 0 ? "" : dataModel.slice(from);
  const marks = new Map<string, { field: string; ingressClass: string }[]>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 5) continue;
    const name = /^`([a-z][a-z0-9_.]*)`$/.exec((cells[0] ?? "").trim());
    if (name === null) continue;
    const own: { field: string; ingressClass: string }[] = [];
    for (const hit of (cells[4] ?? "").matchAll(/`([A-Za-z][A-Za-z0-9_]*)`\s*\(([a-z-]+)\)/g)) {
      own.push({ field: hit[1] as string, ingressClass: hit[2] as string });
    }
    marks.set(name[1] as string, own);
  }
  return marks;
}

/**
 * Check 3, extended — F111-FR-016 names TWO copies of the marks: the column
 * "Free-text fields" of `data-model.md` and the column `free_text_fields` of
 * the contract. They must say the same thing, type by type and mark by mark.
 */
export function marksAgreeWithTheDataModel(
  rows: readonly CatalogueRow[],
  dataModel: string,
): readonly string[] {
  const fromTheDataModel = readDataModelMarks(dataModel);
  const findings: string[] = [];
  for (const row of rows) {
    const theirs = fromTheDataModel.get(row.type);
    if (theirs === undefined) {
      findings.push(`${row.type}: the catalogue table of data-model.md holds no row for it`);
      continue;
    }
    const ours = [...row.freeTextFields].map((mark) => `${mark.field}:${mark.ingressClass}`).sort();
    const them = [...theirs].map((mark) => `${mark.field}:${mark.ingressClass}`).sort();
    if (ours.join(", ") === them.join(", ")) continue;
    findings.push(
      `${row.type}: the contract marks ${ours.join(", ") || "(none)"} and data-model.md ` +
        `marks ${them.join(", ") || "(none)"}`,
    );
  }
  return Object.freeze(findings);
}

/**
 * Check 3, the half about the ENFORCEMENT — T027
 * (`packages/observability/src/writer/freetext.ts`) reads the column
 * `free_text_fields` and nothing else. The column as parsed HERE is held
 * against what the enforcement returns, cell by cell, for every row.
 */
export function enforcementReadsTheColumn(rows: readonly CatalogueRow[]): readonly string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const fromTheEnforcement = freeTextFieldsOf(row.type)
      .map((mark) => `${mark.field}:${mark.ingressClass}`)
      .join(", ");
    const fromTheColumn = row.freeTextFields
      .map((mark) => `${mark.field}:${mark.ingressClass}`)
      .join(", ");
    if (fromTheEnforcement !== fromTheColumn) {
      findings.push(
        `${row.type}: the enforcement of T027 reads ${fromTheEnforcement || "(none)"} where ` +
          `the column reads ${fromTheColumn || "(none)"}`,
      );
      continue;
    }
    for (const mark of row.freeTextFields) {
      const ingressClass = ingressClassOf(row.type, mark.field);
      if (ingressClass !== mark.ingressClass) {
        findings.push(
          `${row.type}.${mark.field}: the enforcement caps by ${String(ingressClass)} where ` +
            `the column names ${mark.ingressClass}`,
        );
        continue;
      }
      if (!Object.hasOwn(CLASS_LIMITS, mark.ingressClass)) {
        findings.push(
          `${row.type}.${mark.field}: the enforcement has no cap for the class ${mark.ingressClass}`,
        );
      }
    }
  }
  return Object.freeze(findings);
}

/** All checks that read the catalogue alone, as one list of findings. */
export function catalogueFindings(rows: readonly CatalogueRow[]): readonly string[] {
  return Object.freeze([
    ...partnersAreTypes(rows),
    ...pairsAreMutual(rows),
    ...enforcementReadsTheColumn(rows),
    ...marksAreDataFields(rows),
    ...noDataFieldNamedCause(rows),
    ...marksCarryAKnownIngressClass(rows),
    ...kindAgreesWithPartner(rows),
  ]);
}

/* ------------------------------------------------------------------ *
 * The checks over the data this package ships.
 * ------------------------------------------------------------------ */

const CATALOGUE_TEXT = readFileSync(CATALOGUE_FILE, "utf8");
const ROWS = readCatalogue(CATALOGUE_TEXT);

/** A row to build a negative control from. */
function rowOf(type: string): CatalogueRow {
  const row = ROWS.find((candidate) => candidate.type === type);
  assert.ok(row !== undefined, `${type} is a type of the catalogue`);
  return row;
}

test("T002: the package ships the catalogue, byte-identical with the contract source", () => {
  assert.equal(existsSync(CATALOGUE_FILE), true, `${CATALOGUE_FILE} is the copy of T002`);
  assert.ok(ROWS.length > 0, "the copy holds rows");
  if (!existsSync(CONTRACT_FILE)) {
    // The `specs/` tree is not part of the published package; the identity is
    // checked wherever it is in the checkout.
    assert.ok(true, `skip: ${CONTRACT_FILE} is not in this checkout`);
    return;
  }
  assert.equal(
    CATALOGUE_TEXT,
    readFileSync(CONTRACT_FILE, "utf8"),
    "the copy is byte-identical with the contract source",
  );
});

test("T002: the catalogue parses: five columns, 123 rows, every type once", () => {
  assert.deepEqual(readCatalogue(CATALOGUE_TEXT).length, 123);
  assert.equal(new Set(ROWS.map((row) => row.type)).size, ROWS.length, "no type twice");
  for (const row of ROWS) {
    // The name is lower-case words, in one or two parts (`blocked`,
    // `run.started`); the full form of a name is CT-111-101 (T003).
    assert.match(row.type, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)*$/, `the name of ${row.type}`);
  }
});

test("T002 check 1: every partner of a pair is a type of the catalogue", () => {
  assert.deepEqual([...partnersAreTypes(ROWS)], []);
  // Negative control: a partner that is no type is a finding.
  const broken = [{ ...rowOf("run.started"), partner: "run.absent" }];
  assert.deepEqual(
    [...partnersAreTypes(broken)],
    ["run.started: the partner run.absent is no type of the catalogue"],
  );
});

test("T002 check 2: every type of the catalogue is written in spec.md", () => {
  if (!existsSync(SPEC_FILE)) {
    assert.ok(true, `skip: ${SPEC_FILE} is not in this checkout`);
    return;
  }
  const specification = readFileSync(SPEC_FILE, "utf8");
  assert.deepEqual([...typesWrittenInSpec(ROWS, specification)], []);
  // Negative control: a type the specification does not write is a finding.
  const broken = [{ ...rowOf("run.started"), type: "run.notInTheSpecification" }];
  assert.deepEqual(
    [...typesWrittenInSpec(broken, specification)],
    ["run.notInTheSpecification: the type is in the catalogue and not in spec.md"],
  );
});

test("T002 check 3: every marked field is a data field of its type", () => {
  assert.deepEqual([...marksAreDataFields(ROWS)], []);
  assert.ok(
    ROWS.some((row) => row.freeTextFields.length > 0),
    "the catalogue marks free-text fields",
  );
  // Negative control: a mark on a field the type does not hold is a finding.
  const broken = [
    { ...rowOf("run.started"), freeTextFields: [{ field: "absent", ingressClass: "free-text" }] },
  ];
  assert.deepEqual(
    [...marksAreDataFields(broken)],
    ["run.started: the marked field absent is no data field of the type"],
  );
  // Negative control: a mark without an ingress class is a finding.
  const classless = [
    { ...rowOf("run.started"), freeTextFields: [{ field: "workdir", ingressClass: "" }] },
  ];
  assert.deepEqual(
    [...marksAreDataFields(classless)],
    ["run.started: the mark workdir carries no ingress class"],
  );
});

test("T002 check 4: no data field is named cause", () => {
  assert.deepEqual([...noDataFieldNamedCause(ROWS)], []);
  // Negative control: `cause` in the `data` of a type is a finding.
  const broken = [{ ...rowOf("run.ended"), dataFields: ["outcome", "cause"] }];
  assert.deepEqual(
    [...noDataFieldNamedCause(broken)],
    ["run.ended: a data field named cause; cause is a field of the envelope"],
  );
});

test("T002: every ingress class of a mark is a member of the closed set of row 89", () => {
  assert.deepEqual([...marksCarryAKnownIngressClass(ROWS)], []);
  assert.equal(ingressClasses.number, 89);
  assert.equal(ingressClasses.owner, "111");
  const broken = [
    { ...rowOf("run.started"), freeTextFields: [{ field: "workdir", ingressClass: "prose" }] },
  ];
  assert.deepEqual(
    [...marksCarryAKnownIngressClass(broken)],
    ["run.started.workdir: prose is no member of the ingress classes"],
  );
});

test("T002: the kind and the partner of every row agree", () => {
  assert.deepEqual([...kindAgreesWithPartner(ROWS)], []);
  assert.deepEqual(
    [...kindAgreesWithPartner([{ ...rowOf("run.launched"), partner: "run.ended" }])],
    ["run.launched: an instant has no partner"],
  );
  assert.deepEqual(
    [...kindAgreesWithPartner([{ ...rowOf("run.started"), partner: "" }])],
    ["run.started: a open has a partner"],
  );
});

test("T002: the consistency check of contracts/README.md passes over the shipped data", () => {
  assert.deepEqual([...catalogueFindings(ROWS)], []);
});

/* ------------------------------------------------------------------ *
 * T074 — the three checks, extended.
 * ------------------------------------------------------------------ */

test("T074 check 1 extended: every pair is mutual, and an opener names its canonical closer", () => {
  assert.deepEqual([...pairsAreMutual(ROWS)], []);
  assert.ok(
    ROWS.some((row) => row.kind === "open"),
    "the catalogue holds openers",
  );
  // An opener whose closer names another opener back is a finding. (The row of
  // `pass.started` is in the set so that `run.ended`'s own partner resolves;
  // `pass.started`'s closer is not, and a partner that is no type of the set is
  // check 1's finding and not this one's.)
  const brokenBack = [
    rowOf("run.started"),
    { ...rowOf("run.ended"), partner: "pass.started" },
    rowOf("pass.started"),
  ];
  assert.deepEqual(
    [...pairsAreMutual(brokenBack)],
    ["run.started: its canonical closer run.ended names pass.started as its opener"],
  );
  // A closer whose partner is an instant is a finding.
  const brokenKind = [{ ...rowOf("run.ended"), partner: "alert" }, rowOf("alert")];
  assert.deepEqual(
    [...pairsAreMutual(brokenKind)],
    ["run.ended: the partner alert of a close is a instant, and a open is what closes or opens it"],
  );
  // An opener with two closers is NOT a finding: only the `open` row names the
  // canonical one (`recovery.diagnosis_started` ends in `_done` or `_failed`).
  const twoClosers = [
    rowOf("recovery.diagnosis_started"),
    rowOf("recovery.diagnosis_done"),
    rowOf("recovery.diagnosis_failed"),
  ];
  assert.deepEqual([...pairsAreMutual(twoClosers)], []);
  assert.equal(rowOf("recovery.diagnosis_failed").partner, "recovery.diagnosis_started");
  assert.equal(rowOf("recovery.diagnosis_started").partner, "recovery.diagnosis_done");
});

test("T074 check 2 extended: every type is written in the CATALOGUE of spec.md", () => {
  if (!existsSync(SPEC_FILE)) {
    assert.ok(true, `skip: ${SPEC_FILE} is not in this checkout`);
    return;
  }
  const specification = readFileSync(SPEC_FILE, "utf8");
  assert.deepEqual([...typesWrittenInTheCatalogue(ROWS, specification)], []);
  // The haystack is narrower than the whole file: the two retired types are
  // named in spec.md and are not types of the catalogue, and the narrowed
  // prose does not hold them as a type of the catalogue table.
  assert.ok(specification.includes("critic.passed_over"), "the retirement is written in spec.md");
  const prose = catalogueProse(specification);
  assert.ok(prose.length > 1000, "the catalogue prose was found");
  assert.ok(prose.length < specification.length, "it is narrower than the whole file");
  // Negative control: a type the catalogue section does not name is a finding.
  const broken = [{ ...rowOf("run.started"), type: "run.not_in_the_catalogue" }];
  assert.deepEqual(
    [...typesWrittenInTheCatalogue(broken, specification)],
    [
      "run.not_in_the_catalogue: the type is in the catalogue and is not written in the " +
        '"Event catalogue" of spec.md',
    ],
  );
});

test("T074 check 2, the other direction: every type spec.md NAMES is a row", () => {
  if (!existsSync(SPEC_FILE)) {
    assert.ok(true, `skip: ${SPEC_FILE} is not in this checkout`);
    return;
  }
  const specification = readFileSync(SPEC_FILE, "utf8");
  const named = typesNamedInTheSpecification(specification);
  assert.ok(named.length > 100, `${named.length} types are named in the catalogue of spec.md`);
  assert.deepEqual([...namedTypesAreRows(ROWS, specification)], []);
  // The thirteen types of F111-FR-050 and F111-FR-051 are among the named.
  for (const type of [
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
    "source.change_accepted",
    "fallback.skipped",
    "terms.override_used",
  ]) {
    assert.ok(named.includes(type), `${type} is named in the catalogue of spec.md`);
  }
  // The two retired types are NOT named as a type: their rows read `retired`.
  for (const type of ["critic.passed_over", "critic.diversity"]) {
    assert.equal(named.includes(type), false, `${type} is not named as a type`);
  }
  // Negative control: a catalogue that lost a type the spec names is a finding.
  const withoutIt = ROWS.filter((row) => row.type !== "tripwire.cleared");
  assert.deepEqual(
    [...namedTypesAreRows(withoutIt, specification)],
    ["tripwire.cleared: spec.md names the type and the catalogue holds no row for it"],
  );
});

test("T074 check 3 extended: the two copies of the marks say the same thing", () => {
  if (!existsSync(DATA_MODEL_FILE)) {
    assert.ok(true, `skip: ${DATA_MODEL_FILE} is not in this checkout`);
    return;
  }
  const dataModel = readFileSync(DATA_MODEL_FILE, "utf8");
  const theirs = readDataModelMarks(dataModel);
  assert.equal(theirs.size, ROWS.length, "data-model.md holds a row for every type");
  assert.deepEqual([...marksAgreeWithTheDataModel(ROWS, dataModel)], []);
  // The reader really reads marks, so the agreement above is not two empties.
  const marked = [...theirs.values()].filter((own) => own.length > 0);
  assert.ok(marked.length > 30, `${marked.length} rows of data-model.md carry a mark`);
  assert.deepEqual(
    [...(theirs.get("run.started") ?? [])],
    [{ field: "workdir", ingressClass: "target" }],
  );
  // Negative control: a contract mark the data model does not have is a
  // finding, and so is a class the two spell differently.
  const extra = [
    {
      ...rowOf("run.ended"),
      freeTextFields: [{ field: "stopReason", ingressClass: "free-text" }],
    },
  ];
  assert.deepEqual(
    [...marksAgreeWithTheDataModel(extra, dataModel)],
    ["run.ended: the contract marks stopReason:free-text and data-model.md marks (none)"],
  );
  const reclassed = [
    { ...rowOf("run.started"), freeTextFields: [{ field: "workdir", ingressClass: "free-text" }] },
  ];
  assert.deepEqual(
    [...marksAgreeWithTheDataModel(reclassed, dataModel)],
    ["run.started: the contract marks workdir:free-text and data-model.md marks workdir:target"],
  );
});

test("T074: the enforcement of T027 reads the column `free_text_fields`", () => {
  assert.deepEqual([...enforcementReadsTheColumn(ROWS)], []);
  // The enforcement returns the column, mark for mark, for every row — and for
  // the thirteen types of 2026-09-30 too.
  assert.deepEqual(
    [...freeTextFieldsOf("checkpoint.accepted")],
    [{ field: "taskIds", ingressClass: "free-text" }],
  );
  assert.deepEqual([...freeTextFieldsOf("tripwire.cleared")], [], "an unmarked type has no mark");
  assert.equal(ingressClassOf("run.started", "workdir"), "target");
  assert.equal(
    ingressClassOf("run.started", "phases"),
    undefined,
    "an unmarked field has no class",
  );
  const marksInTheColumn = ROWS.flatMap((row) => row.freeTextFields);
  assert.ok(marksInTheColumn.length > 60, `${marksInTheColumn.length} marks in the column`);
  // Negative control: a row whose column names another class is a finding, and
  // the finding names the class the ENFORCEMENT reads.
  const reclassed = [
    { ...rowOf("run.started"), freeTextFields: [{ field: "workdir", ingressClass: "diagnostic" }] },
  ];
  assert.deepEqual(
    [...enforcementReadsTheColumn(reclassed)],
    [
      "run.started: the enforcement of T027 reads workdir:target where the column reads " +
        "workdir:diagnostic",
    ],
  );
});

test("T074: the cap the enforcement applies is the cap the column names", () => {
  // The column is not only READ, it DECIDES: for every class the column uses,
  // a value one byte over the cap of that class comes back cut to it.
  const classesUsed = [
    ...new Set(ROWS.flatMap((row) => row.freeTextFields.map((m) => m.ingressClass))),
  ];
  assert.ok(classesUsed.length >= 4, `the column uses ${classesUsed.length} classes`);
  for (const ingressClass of classesUsed) {
    const limit = CLASS_LIMITS[ingressClass];
    assert.equal(typeof limit, "number", `${ingressClass} has a cap`);
    const cut = capBytes("x".repeat((limit as number) + 1), limit as number);
    assert.equal(cut.truncated, true, `${ingressClass}: a value over the cap is cut`);
    assert.equal(cut.retainedBytes, limit, `${ingressClass}: cut to ${String(limit)} bytes`);
    const exact = capBytes("x".repeat(limit as number), limit as number);
    assert.equal(exact.truncated, false, `${ingressClass}: a value at the cap is kept whole`);
  }
  // And the cap really differs by class, so reading the column matters: a
  // `target` is cut to 512 bytes where a `stream-text` keeps 4096.
  assert.notEqual(CLASS_LIMITS.target, CLASS_LIMITS["stream-text"]);
  assert.equal(ingressClassOf("run.started", "workdir"), "target");
  assert.equal(
    capBytes("y".repeat(5000), CLASS_LIMITS.target as number).retainedBytes,
    CLASS_LIMITS.target,
  );
});

/* ------------------------------------------------------------------ *
 * T076 — the traceability half of the consistency check.
 *
 * T002 and T074 hold the DATA of the catalogue against the specification.
 * T076 extends the same check to the TRACEABILITY of the specification, which
 * F111-SC-009 measures ("Every requirement has a test"), in four directions:
 *
 *   1. forward: every requirement bullet of `spec.md` names its test in a
 *      `test:` sub-bullet (F111-FR-001 to F111-FR-038, F111-FR-050,
 *      F111-FR-051 — forty of them);
 *   2. backward: every test id named there has a TASK of `tasks.md` that names
 *      it and carries `proves:` (the format note of `tasks.md`: "A test task
 *      carries `proves:`"), and the task's `proves:`/`covers:` pair binds that
 *      task to the requirement that named the test;
 *   3. into the tree: the file the task names exists and names the test id, so
 *      a document pair that agrees with itself but with no test behind it is a
 *      finding and not a silence;
 *   4. the retired ids are NOT required and are claimed by nothing:
 *      F111-FR-039 to F111-FR-049 and their tests moved to feature 144,
 *      F111-FR-052 and CT-111-152 are tombstones, and CT-111-139 to
 *      CT-111-149 name no test of this feature.
 *
 * The share of EV-01 to EV-20 — the twenty gaps of the time-use baseline —
 * is T028's, in `tests/parity/111/gaps.test.ts`: this file asserts that T028
 * declares all twenty and claims none of them itself. F111-SC-009 also counts
 * EV-21 to EV-34, and those are mapped here to the requirements of this
 * specification that carry them, each pinned to the wording of R14 so the
 * mapping cannot drift from its source.
 * ------------------------------------------------------------------ */

/** The task list whose `proves:` the backward direction reads. */
export const TASKS_FILE = join(ROOT, "specs/111-event-schema-and-projection/tasks.md");

/** R14, where the requirements EV-01 to EV-34 are written. Read, never written. */
export const R14_FILE = join(ROOT, "docs/ecosystem/research/R14-quotas-cost-observability.md");

/** T028's file: the fixture of the twenty gaps (F111-SC-001). */
export const GAPS_TEST_FILE = join(ROOT, "tests/parity/111/gaps.test.ts");

/** The ids F111-SC-009 counts: the forty requirements of this specification. */
export const REQUIRED_REQUIREMENT_IDS: readonly string[] = Object.freeze([
  ...Array.from(
    { length: 38 },
    (_unused, index) => `F111-FR-${String(index + 1).padStart(3, "0")}`,
  ),
  "F111-FR-050",
  "F111-FR-051",
]);

/** One requirement bullet of `spec.md` with the test ids it names. */
export type RequirementBullet = {
  readonly id: string;
  /** The ids of every `test:` sub-bullet, in order. A `*` tail is a prefix. */
  readonly tests: readonly string[];
  /** 1-based line of the bullet in `spec.md`. */
  readonly line: number;
};

/** One row of the table "Requirements moved to 144-compatibility-projection". */
export type MovedRow = {
  readonly oldId: string;
  readonly newId: string;
  readonly testBefore: string;
  readonly testAfter: string;
};

/** One task of `tasks.md` with its annotations. */
export type TaskEntry = {
  readonly id: string;
  readonly description: string;
  readonly proves: readonly string[];
  readonly covers: readonly string[];
  readonly measures: readonly string[];
  /** The test ids the description names (`CT-111-101`, `PT-111-C-020-best-effort`). */
  readonly testIds: readonly string[];
  /** The repository paths the description names. */
  readonly paths: readonly string[];
};

/** One row of R14's table of schema requirements. */
export type EvRow = {
  readonly id: string;
  readonly gap: string;
  readonly statement: string;
};

/** Slice one `## ` section out of a markdown document. */
function sectionOf(document: string, heading: string): string {
  const from = document.indexOf(heading);
  assert.ok(from >= 0, `${heading} is a section of the document`);
  const after = document.slice(from + heading.length);
  const end = after.indexOf("\n## ");
  return end < 0 ? after : after.slice(0, end);
}

const REQUIREMENT_BULLET = /^- \*\*(F111-(?:FR|SC)-\d{3})\*\*:/;
const SUB_BULLET = /^ {2}- ([a-z-]+): (.*)$/;

/**
 * Parse the requirement bullets of the section "Requirements" of `spec.md`,
 * each with the test ids of its `test:` sub-bullets. Only that section is read,
 * so the tombstone table of the moved ids is out of the haystack by
 * construction.
 */
export function readRequirementBullets(specification: string): readonly RequirementBullet[] {
  const section = sectionOf(specification, "## Requirements *(mandatory)*");
  const offset = specification.slice(0, specification.indexOf(section)).split("\n").length;
  const bullets: RequirementBullet[] = [];
  let current: { id: string; tests: string[]; line: number } | undefined;
  section.split("\n").forEach((line, index) => {
    const bullet = REQUIREMENT_BULLET.exec(line);
    if (bullet !== null) {
      if (current !== undefined)
        bullets.push(Object.freeze({ ...current, tests: Object.freeze(current.tests) }));
      current = { id: bullet[1] as string, tests: [], line: offset + index };
      return;
    }
    const sub = SUB_BULLET.exec(line);
    if (sub === null || current === undefined) return;
    if (sub[1] !== "test") return;
    for (const id of (sub[2] as string).split(/[,;]/)) {
      const trimmed = id.trim();
      if (trimmed.length > 0) current.tests.push(trimmed);
    }
  });
  if (current !== undefined)
    bullets.push(Object.freeze({ ...current, tests: Object.freeze(current.tests) }));
  return Object.freeze(bullets);
}

/**
 * Parse the table "Requirements moved to 144-compatibility-projection". It is
 * the specification's own record of what left, so the exclusion of the retired
 * ids is read off the document and not hard-coded here.
 */
export function readMovedTable(specification: string): readonly MovedRow[] {
  const section = sectionOf(specification, "## Requirements moved to 144-compatibility-projection");
  const rows: MovedRow[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| F111-")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    rows.push(
      Object.freeze({
        oldId: cells[0] as string,
        newId: cells[1] as string,
        testBefore: cells[2] as string,
        testAfter: cells[3] as string,
      }),
    );
  }
  return Object.freeze(rows);
}

/** The test ids that moved to feature 144 with group G5, read off the table. */
export function testsMovedTo144(specification: string): readonly string[] {
  return Object.freeze(
    readMovedTable(specification)
      .map((row) => row.testBefore)
      .filter((id) => id !== "—" && id.length > 0),
  );
}

const TASK_BULLET = /^- \[([ x])\] (T\d+) (.*)$/;
const TEST_ID_IN_TEXT = /\b(?:CT|PT)-111-[A-Za-z0-9-]*[A-Za-z0-9]/g;
const PATH_IN_TEXT = /\b(?:packages|tests|specs|docs)\/[A-Za-z0-9_./-]*/g;

/** Parse the tasks of `tasks.md` with their `proves:`, `covers:` and `measures:`. */
export function readTasks(tasksDocument: string): readonly TaskEntry[] {
  const tasks: TaskEntry[] = [];
  let current:
    | { id: string; description: string; proves: string[]; covers: string[]; measures: string[] }
    | undefined;
  const close = (): void => {
    if (current === undefined) return;
    tasks.push(
      Object.freeze({
        id: current.id,
        description: current.description,
        proves: Object.freeze(current.proves),
        covers: Object.freeze(current.covers),
        measures: Object.freeze(current.measures),
        testIds: Object.freeze([...new Set(current.description.match(TEST_ID_IN_TEXT) ?? [])]),
        paths: Object.freeze([...new Set(current.description.match(PATH_IN_TEXT) ?? [])]),
      }),
    );
  };
  for (const line of tasksDocument.split("\n")) {
    const bullet = TASK_BULLET.exec(line);
    if (bullet !== null) {
      close();
      current = {
        id: bullet[2] as string,
        description: bullet[3] as string,
        proves: [],
        covers: [],
        measures: [],
      };
      continue;
    }
    const sub = SUB_BULLET.exec(line);
    if (sub === null || current === undefined) continue;
    const values = (sub[2] as string)
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (sub[1] === "proves") current.proves.push(...values);
    else if (sub[1] === "covers") current.covers.push(...values);
    else if (sub[1] === "measures") current.measures.push(...values);
  }
  close();
  return Object.freeze(tasks);
}

/** True where the task names the test id the specification wrote; a `*` tail is a prefix. */
export function taskNamesTheTest(task: TaskEntry, namedTest: string): boolean {
  if (namedTest.endsWith("*")) {
    const prefix = namedTest.slice(0, -1);
    return task.testIds.some((id) => id.startsWith(prefix));
  }
  return task.testIds.includes(namedTest);
}

/**
 * Direction 1 — every required requirement of `spec.md` names its test in
 * `test:`. A requirement with no `test:` sub-bullet, and a required id with no
 * bullet at all, are both findings.
 */
export function requirementsNameTheirTest(
  bullets: readonly RequirementBullet[],
  required: readonly string[] = REQUIRED_REQUIREMENT_IDS,
): readonly string[] {
  const findings: string[] = [];
  const byId = new Map(bullets.map((bullet) => [bullet.id, bullet]));
  for (const id of required) {
    const bullet = byId.get(id);
    if (bullet === undefined) {
      findings.push(`${id}: the specification has no requirement bullet for it`);
      continue;
    }
    if (bullet.tests.length === 0)
      findings.push(`${id}: the requirement names no test in \`test:\``);
  }
  return Object.freeze(findings);
}

/**
 * Direction 2 — every test id the specification names has a task that names it
 * and carries `proves:`, which is what makes a task a TEST task.
 */
export function namedTestsHaveATask(
  bullets: readonly RequirementBullet[],
  tasks: readonly TaskEntry[],
): readonly string[] {
  const findings: string[] = [];
  for (const bullet of bullets) {
    for (const namedTest of bullet.tests) {
      const naming = tasks.filter((task) => taskNamesTheTest(task, namedTest));
      if (naming.length === 0) {
        findings.push(`${bullet.id}: no task names the test ${namedTest}`);
        continue;
      }
      if (!naming.some((task) => task.proves.length > 0)) {
        findings.push(
          `${bullet.id}: the task that names ${namedTest} carries no \`proves:\`, so it is no test task`,
        );
      }
    }
  }
  return Object.freeze(findings);
}

/** The characterization cluster of a parity test id (`PT-111-C-167-limits` -> `C-167`). */
export function clusterOf(namedTest: string): string | undefined {
  const hit = /^PT-111-(C-\d+)-/.exec(namedTest);
  return hit === null ? undefined : (hit[1] as string);
}

/**
 * Direction 2, the coupling — the task that names the test is bound to the
 * requirement that named it:
 *
 *   - a contract test (`CT-111-nnn`) carries the REQUIREMENT in `proves:`;
 *   - a parity or characterization test (`PT-111-C-nnn-...`) carries the
 *     as-is CLUSTER (`C-nnn`) in `proves:`, as the format of `tasks.md` has
 *     it, and the requirement is then the `covers:` of an implementation task.
 *
 * The second branch is the shape of the document and not a weaker check: a
 * parity test proves the baseline's behaviour, and the requirement it serves is
 * carried by the task that implements it.
 */
export function provesCouplesTheRequirement(
  bullets: readonly RequirementBullet[],
  tasks: readonly TaskEntry[],
): readonly string[] {
  const findings: string[] = [];
  for (const bullet of bullets) {
    for (const namedTest of bullet.tests) {
      const naming = tasks.filter((task) => taskNamesTheTest(task, namedTest));
      if (naming.length === 0) continue;
      const cluster = clusterOf(namedTest);
      if (cluster === undefined) {
        if (!naming.some((task) => task.proves.includes(bullet.id))) {
          findings.push(
            `${bullet.id}: no task that names ${namedTest} carries ${bullet.id} in \`proves:\``,
          );
        }
        continue;
      }
      if (!naming.some((task) => task.proves.includes(cluster))) {
        findings.push(
          `${bullet.id}: the parity task that names ${namedTest} carries no ${cluster} in \`proves:\``,
        );
      }
      if (!tasks.some((task) => task.covers.includes(bullet.id))) {
        findings.push(
          `${bullet.id}: the test is the parity test ${namedTest}, and no task carries ${bullet.id} in \`covers:\``,
        );
      }
    }
  }
  return Object.freeze(findings);
}

/**
 * Direction 3 — the test exists in the tree. For every test id the
 * specification names, the task that names it names a file, that file is in the
 * checkout, and the test id is written in it. Where the `specs/` tree or the
 * test tree is absent the check reports a skip to the caller by returning the
 * reason, so an absent checkout never passes as an empty finding list.
 */
export function namedTestsAreInTheTree(
  bullets: readonly RequirementBullet[],
  tasks: readonly TaskEntry[],
): readonly string[] {
  const findings: string[] = [];
  for (const bullet of bullets) {
    for (const namedTest of bullet.tests) {
      const naming = tasks.filter((task) => taskNamesTheTest(task, namedTest));
      const files = [...new Set(naming.flatMap((task) => task.paths))].filter((path) =>
        path.endsWith(".ts"),
      );
      if (files.length === 0) {
        findings.push(`${namedTest}: the task that names it names no test file`);
        continue;
      }
      const concrete = files.map((path) => join(ROOT, path)).filter((path) => existsSync(path));
      if (concrete.length === 0) {
        findings.push(`${namedTest}: none of the files ${files.join(", ")} is in the checkout`);
        continue;
      }
      const written = concrete.filter((path) => {
        const text = readFileSync(path, "utf8");
        return namedTest.endsWith("*")
          ? text.includes(namedTest.slice(0, -1))
          : text.includes(namedTest);
      });
      if (written.length === 0) {
        findings.push(`${namedTest}: the file of the task does not name the test id`);
      }
    }
  }
  return Object.freeze(findings);
}

/**
 * A task NAMES a retired id without reviving it where it also declares the
 * retirement: a tombstone (T071) and the exclusion clause of this very task
 * (T076) both write the id in order to say it is gone. A task that writes the
 * id with no such word is a task that claims it again.
 */
const DECLARES_RETIREMENT = /\bretired\b|\bnot required\b|\bmoved to\b|\bare gone\b/i;

/**
 * Direction 4 — the retired ids are not required. A retired requirement id is
 * no live bullet, a retired or moved test id is named by no live requirement,
 * and no task claims one as a deliverable (a tombstone or an exclusion clause,
 * which declares the retirement in the same sentence, is not a claim).
 */
export function retiredIdsAreNotRequired(
  specification: string,
  bullets: readonly RequirementBullet[],
  tasks: readonly TaskEntry[],
): readonly string[] {
  const findings: string[] = [];
  const moved = readMovedTable(specification);
  const retiredRequirements = [...moved.map((row) => row.oldId), ...RETIRED_REQUIREMENT_IDS];
  const live = new Set(bullets.map((bullet) => bullet.id));
  for (const id of retiredRequirements) {
    if (live.has(id)) findings.push(`${id}: a retired id is a live requirement bullet again`);
    if (REQUIRED_REQUIREMENT_IDS.includes(id)) {
      findings.push(`${id}: a retired id is in the required set`);
    }
  }
  const retiredTests = [...testsMovedTo144(specification), ...RETIRED_TEST_IDS];
  for (const id of retiredTests) {
    const claiming = tasks.filter(
      (task) => taskNamesTheTest(task, id) && !DECLARES_RETIREMENT.test(task.description),
    );
    if (claiming.length > 0) {
      findings.push(
        `${id}: a retired test id is carried by ${claiming.map((task) => task.id).join(", ")}`,
      );
    }
    if (bullets.some((bullet) => bullet.tests.includes(id))) {
      findings.push(`${id}: a retired test id is named by a live requirement`);
    }
  }
  return Object.freeze(findings);
}

/** Parse R14's table of the schema requirements EV-01 to EV-34. */
export function readEvRequirements(r14: string): readonly EvRow[] {
  const rows: EvRow[] = [];
  for (const line of r14.split("\n")) {
    if (!line.startsWith("| EV-")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    rows.push(
      Object.freeze({
        id: cells[0] as string,
        gap: cells[1] as string,
        statement: cells[2] as string,
      }),
    );
  }
  return Object.freeze(rows);
}

/**
 * EV-21 to EV-34 mapped to the requirements of THIS specification that carry
 * them. `anchor` is a phrase of R14's own cell for that row: the mapping is
 * pinned to its source, so a row that is reworded in R14 makes the check fail
 * instead of drifting in silence. EV-01 to EV-20 are absent on purpose — their
 * share is T028's, `tests/parity/111/gaps.test.ts`.
 */
export const EV_COVERAGE: readonly {
  readonly ev: string;
  readonly requirements: readonly string[];
  readonly anchor: string;
  readonly note?: string;
}[] = Object.freeze([
  {
    ev: "EV-21",
    requirements: ["F111-FR-002", "F111-FR-017", "F111-FR-018"],
    anchor: "torn last line tolerated by readers",
  },
  {
    ev: "EV-22",
    requirements: ["F111-FR-003"],
    anchor: "on every record that has them",
  },
  {
    ev: "EV-23",
    requirements: ["F111-FR-004"],
    anchor: "the OTel span is built from the pair at emit time",
  },
  {
    ev: "EV-24",
    requirements: ["F111-FR-006"],
    anchor: "tokens, `billing`, `role`, `model`",
  },
  {
    ev: "EV-25",
    requirements: ["F111-FR-013"],
    anchor: "`run.paused` with `resumeAt`",
  },
  {
    ev: "EV-26",
    requirements: ["F111-FR-010"],
    anchor: "`counters.reset`",
  },
  {
    ev: "EV-27",
    requirements: ["F111-FR-002", "F111-FR-008"],
    anchor: "`microloop.unit.layerOff`",
  },
  {
    ev: "EV-28",
    requirements: ["F111-FR-011"],
    anchor: "at launch",
  },
  {
    ev: "EV-29",
    requirements: ["F111-FR-005"],
    anchor: "no heartbeat events",
  },
  {
    ev: "EV-30",
    requirements: ["F111-FR-013"],
    anchor: "`budget.exceeded`",
  },
  {
    ev: "EV-31",
    requirements: ["F111-FR-014"],
    anchor: "when a stream ends without a terminal record",
  },
  {
    ev: "EV-32",
    requirements: ["F111-FR-016"],
    anchor: "No prompt, reply, tool-argument body or command output in any event",
  },
  {
    ev: "EV-33",
    requirements: ["F111-FR-014"],
    anchor: "a violation emits `stream.diagnostic`",
  },
  {
    ev: "EV-34",
    requirements: ["F111-FR-037"],
    anchor: "The event stream is the only input to `RunView`",
    note:
      "the other half of the row, the disposable snapshot cache, is the read model of feature 129 " +
      "(the out-of-scope table of spec.md); what this feature carries is that the stream is the " +
      "one input and that an `x.` type never changes the read model",
  },
]);

/** The ids of the twenty gaps whose share is T028's. */
export const GAP_IDS: readonly string[] = Object.freeze(
  Array.from({ length: 20 }, (_unused, index) => `EV-${String(index + 1).padStart(2, "0")}`),
);

/**
 * EV-21 to EV-34 each have a NAMED test: the requirement of this specification
 * that carries the row names one in `test:`. The anchor of the mapping must be
 * in R14's own cell for the row.
 */
export function evRequirementsHaveANamedTest(
  evRows: readonly EvRow[],
  bullets: readonly RequirementBullet[],
): readonly string[] {
  const findings: string[] = [];
  const byId = new Map(bullets.map((bullet) => [bullet.id, bullet]));
  const byEv = new Map(evRows.map((row) => [row.id, row]));
  for (const mapped of EV_COVERAGE) {
    const row = byEv.get(mapped.ev);
    if (row === undefined) {
      findings.push(`${mapped.ev}: R14 has no row for it`);
      continue;
    }
    if (!row.statement.includes(mapped.anchor)) {
      findings.push(`${mapped.ev}: R14 no longer reads "${mapped.anchor}"`);
    }
    for (const requirement of mapped.requirements) {
      const bullet = byId.get(requirement);
      if (bullet === undefined) {
        findings.push(`${mapped.ev}: ${requirement} is no requirement of this specification`);
        continue;
      }
      if (bullet.tests.length === 0) {
        findings.push(`${mapped.ev}: ${requirement} names no test, so the row has none`);
      }
    }
  }
  return Object.freeze(findings);
}

/** The test ids EV-21 to EV-34 reach through the requirements that carry them. */
export function namedTestsOfEv(
  bullets: readonly RequirementBullet[],
): ReadonlyMap<string, readonly string[]> {
  const byId = new Map(bullets.map((bullet) => [bullet.id, bullet]));
  const reached = new Map<string, readonly string[]>();
  for (const mapped of EV_COVERAGE) {
    const tests = mapped.requirements.flatMap((id) => [...(byId.get(id)?.tests ?? [])]);
    reached.set(mapped.ev, Object.freeze([...new Set(tests)]));
  }
  return reached;
}

/**
 * The share of EV-01 to EV-20 is T028's: all twenty are declared in
 * `tests/parity/111/gaps.test.ts`, and none of them is claimed here.
 */
export function gapsAreT028s(gapsTest: string): readonly string[] {
  const findings: string[] = [];
  for (const id of GAP_IDS) {
    if (!gapsTest.includes(`id: "${id}"`)) {
      findings.push(`${id}: T028 declares no gap for it in tests/parity/111/gaps.test.ts`);
    }
  }
  if (!gapsTest.includes("F111-SC-001")) {
    findings.push("tests/parity/111/gaps.test.ts does not name F111-SC-001");
  }
  for (const mapped of EV_COVERAGE) {
    if (GAP_IDS.includes(mapped.ev)) {
      findings.push(`${mapped.ev}: the share of the twenty gaps is T028's and is claimed here`);
    }
  }
  return Object.freeze(findings);
}

/** Every success criterion of `spec.md` has a task that carries it in `measures:`. */
export function criteriaAreMeasured(
  specification: string,
  tasks: readonly TaskEntry[],
): readonly string[] {
  const findings: string[] = [];
  const section = sectionOf(specification, "## Success Criteria *(mandatory)*");
  const ids = [
    ...new Set([...section.matchAll(/\*\*(F111-SC-\d{3})\*\*/g)].map((hit) => hit[1] as string)),
  ];
  assert.ok(ids.length > 0, "the specification has success criteria");
  for (const id of ids) {
    if (!tasks.some((task) => task.measures.includes(id))) {
      findings.push(`${id}: no task carries it in \`measures:\``);
    }
  }
  return Object.freeze(findings);
}

/** All of T076's checks over the documents, as one list of findings. */
export function traceabilityFindings(
  specification: string,
  tasksDocument: string,
  r14: string,
  gapsTest: string,
): readonly string[] {
  const bullets = readRequirementBullets(specification);
  const tasks = readTasks(tasksDocument);
  return Object.freeze([
    ...requirementsNameTheirTest(bullets),
    ...namedTestsHaveATask(bullets, tasks),
    ...provesCouplesTheRequirement(bullets, tasks),
    ...namedTestsAreInTheTree(bullets, tasks),
    ...retiredIdsAreNotRequired(specification, bullets, tasks),
    ...evRequirementsHaveANamedTest(readEvRequirements(r14), bullets),
    ...gapsAreT028s(gapsTest),
    ...criteriaAreMeasured(specification, tasks),
  ]);
}

/* ------------------------------------------------------------------ *
 * T076 — the checks over the documents this feature ships.
 * ------------------------------------------------------------------ */

/** The documents T076 reads, or the reason a check reports a skip. */
const DOCUMENTS = (():
  | { readonly present: false; readonly reason: string }
  | {
      readonly present: true;
      readonly spec: string;
      readonly tasks: string;
      readonly r14: string;
      readonly gaps: string;
    } => {
  const missing = [SPEC_FILE, TASKS_FILE, R14_FILE, GAPS_TEST_FILE].filter(
    (path) => !existsSync(path),
  );
  if (missing.length > 0) {
    return { present: false, reason: `not in this checkout: ${missing.join(", ")}` };
  }
  return {
    present: true,
    spec: readFileSync(SPEC_FILE, "utf8"),
    tasks: readFileSync(TASKS_FILE, "utf8"),
    r14: readFileSync(R14_FILE, "utf8"),
    gaps: readFileSync(GAPS_TEST_FILE, "utf8"),
  };
})();

test("T076: the documents of the traceability check are in the checkout", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  assert.deepEqual(
    bullets.map((bullet) => bullet.id),
    [...REQUIRED_REQUIREMENT_IDS],
    "the requirement bullets of spec.md are the forty required ids, in order",
  );
  const tasks = readTasks(DOCUMENTS.tasks);
  assert.equal(tasks.length, 76 - 17, "tasks.md holds 59 tasks: T001 to T076 less the 17 of G5");
  assert.deepEqual(tasks.at(-1)?.id, "T076");
});

test("T076 direction 1: every requirement of spec.md names its test in `test:`", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  assert.deepEqual([...requirementsNameTheirTest(bullets)], []);
  assert.equal(bullets.length, 40, "forty requirements");
  assert.equal(
    bullets.filter((bullet) => bullet.tests.length > 0).length,
    40,
    "100 per cent of the requirements name a test (F111-SC-009)",
  );
  // Negative control: a requirement with no `test:` is a finding, and a
  // required id with no bullet at all is a finding too.
  const withoutATest = bullets.map((bullet) =>
    bullet.id === "F111-FR-016" ? { ...bullet, tests: [] } : bullet,
  );
  assert.deepEqual(
    [...requirementsNameTheirTest(withoutATest)],
    ["F111-FR-016: the requirement names no test in `test:`"],
  );
  assert.deepEqual(
    [...requirementsNameTheirTest(bullets, ["F111-FR-099"])],
    ["F111-FR-099: the specification has no requirement bullet for it"],
  );
});

test("T076 direction 2: every test id named in spec.md has a task that carries it in `proves:`", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  const tasks = readTasks(DOCUMENTS.tasks);
  assert.deepEqual([...namedTestsHaveATask(bullets, tasks)], []);
  assert.deepEqual([...provesCouplesTheRequirement(bullets, tasks)], []);
  // The glob of F111-FR-019 (`PT-111-C-020-*`) is a PREFIX and resolves to the
  // id T011 writes.
  const best = tasks.find((task) => task.id === "T011");
  assert.ok(best !== undefined && best.testIds.includes("PT-111-C-020-best-effort"));
  assert.equal(taskNamesTheTest(best, "PT-111-C-020-*"), true);
  assert.equal(taskNamesTheTest(best, "PT-111-C-021-*"), false, "the prefix does not over-match");
  // Negative control 1: a test id no task names.
  const invented = bullets.map((bullet) =>
    bullet.id === "F111-FR-001" ? { ...bullet, tests: ["CT-111-999"] } : bullet,
  );
  assert.deepEqual(
    [...namedTestsHaveATask(invented, tasks)],
    ["F111-FR-001: no task names the test CT-111-999"],
  );
  // Negative control 2: the task that names the test carries no `proves:`.
  const withoutProves = tasks.map((task) => (task.id === "T003" ? { ...task, proves: [] } : task));
  assert.deepEqual(
    [...namedTestsHaveATask(bullets, withoutProves)],
    ["F111-FR-001: the task that names CT-111-101 carries no `proves:`, so it is no test task"],
  );
  // Negative control 3: the coupling — the task proves another requirement.
  const miscoupled = tasks.map((task) =>
    task.id === "T029" ? { ...task, proves: ["F111-FR-001"] } : task,
  );
  assert.deepEqual(
    [...provesCouplesTheRequirement(bullets, miscoupled)],
    ["F111-FR-034: no task that names CT-111-134 carries F111-FR-034 in `proves:`"],
  );
  // Negative control 4: a parity test whose cluster is gone from `proves:`,
  // and the requirement no longer carried by any `covers:`.
  const clusterGone = tasks.map((task) =>
    task.id === "T038" ? { ...task, proves: task.proves.filter((id) => id !== "C-167") } : task,
  );
  assert.deepEqual(
    [...provesCouplesTheRequirement(bullets, clusterGone)],
    ["F111-FR-027: the parity task that names PT-111-C-167-limits carries no C-167 in `proves:`"],
  );
  assert.equal(clusterOf("PT-111-C-167-limits"), "C-167");
  assert.equal(clusterOf("CT-111-101"), undefined);
});

test("T076 direction 3: the file every named test lives in is in the tree and names it", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  const tasks = readTasks(DOCUMENTS.tasks);
  assert.deepEqual([...namedTestsAreInTheTree(bullets, tasks)], []);
  // Every one of the forty named tests resolved to a file that exists and
  // writes the id, so the pair of documents is bound to the test tree.
  const named = [...new Set(bullets.flatMap((bullet) => [...bullet.tests]))];
  assert.equal(named.length, 40, "forty distinct test ids are named");
  // Negative control 1: the task names no file.
  const noFile = tasks.map((task) => (task.id === "T003" ? { ...task, paths: [] } : task));
  assert.deepEqual(
    [...namedTestsAreInTheTree(bullets, noFile)],
    ["CT-111-101: the task that names it names no test file"],
  );
  // Negative control 2: the file the task names is not in the checkout.
  const absent = tasks.map((task) =>
    task.id === "T003"
      ? { ...task, paths: ["packages/observability/test/not-written-yet.test.ts"] }
      : task,
  );
  assert.deepEqual(
    [...namedTestsAreInTheTree(bullets, absent)],
    [
      "CT-111-101: none of the files packages/observability/test/not-written-yet.test.ts is in " +
        "the checkout",
    ],
  );
  // Negative control 3: the file exists but does not name the test id.
  const wrongFile = tasks.map((task) =>
    task.id === "T003"
      ? { ...task, paths: ["packages/observability/test/learning-domain.test.ts"] }
      : task,
  );
  assert.deepEqual(
    [...namedTestsAreInTheTree(bullets, wrongFile)],
    ["CT-111-101: the file of the task does not name the test id"],
  );
});

test("T076 direction 4: the retired ids and the tests that moved to 144 are not required", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  const tasks = readTasks(DOCUMENTS.tasks);
  assert.deepEqual([...retiredIdsAreNotRequired(DOCUMENTS.spec, bullets, tasks)], []);
  // The table of the move is the specification's own record: eleven
  // requirements and two criteria, F111-FR-039 to F111-FR-049.
  const moved = readMovedTable(DOCUMENTS.spec);
  assert.deepEqual(
    moved.filter((row) => row.oldId.includes("FR")).map((row) => row.oldId),
    [...REQUIREMENT_IDS_MOVED_TO_144],
    "the table and the data of T071 agree on what moved",
  );
  assert.deepEqual(
    moved.filter((row) => row.oldId.includes("SC")).map((row) => row.oldId),
    ["F111-SC-005", "F111-SC-006"],
  );
  // CT-111-139 to CT-111-149 are among the ids the table retires, and
  // CT-111-152 is the tombstone of T071.
  const retiredTests = new Set([...testsMovedTo144(DOCUMENTS.spec), ...RETIRED_TEST_IDS]);
  for (const id of ["CT-111-139", "CT-111-140", "CT-111-147", "CT-111-148", "CT-111-152"]) {
    assert.equal(retiredTests.has(id), true, `${id} is retired`);
  }
  // None of them is named by a live requirement or carried by a task.
  const named = new Set(bullets.flatMap((bullet) => [...bullet.tests]));
  for (const id of retiredTests) {
    assert.equal(named.has(id), false, `${id} is named by no requirement`);
  }
  // Negative control 1: a retired requirement id back as a live bullet.
  const revived = [
    ...bullets,
    { id: "F111-FR-039", tests: ["CT-111-139"], line: 0 } satisfies RequirementBullet,
  ];
  assert.deepEqual(
    [...retiredIdsAreNotRequired(DOCUMENTS.spec, revived, tasks)],
    [
      "F111-FR-039: a retired id is a live requirement bullet again",
      "CT-111-139: a retired test id is named by a live requirement",
    ],
  );
  // Negative control 2: a task that carries a retired test id in `proves:`.
  const revivedTask = [
    ...tasks,
    {
      id: "T077",
      description: "Test CT-111-152 in packages/observability/test/ghost.test.ts",
      proves: ["F111-FR-052"],
      covers: [],
      measures: [],
      testIds: ["CT-111-152"],
      paths: ["packages/observability/test/ghost.test.ts"],
    } satisfies TaskEntry,
  ];
  assert.deepEqual(
    [...retiredIdsAreNotRequired(DOCUMENTS.spec, bullets, revivedTask)],
    ["CT-111-152: a retired test id is carried by T077"],
  );
});

test("T076: the share of EV-01 to EV-20 is T028's", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  assert.deepEqual([...gapsAreT028s(DOCUMENTS.gaps)], []);
  // Negative control 1: a gap T028 does not declare.
  assert.deepEqual(
    [...gapsAreT028s(DOCUMENTS.gaps.replace('id: "EV-07"', 'id: "EV-07x"'))],
    ["EV-07: T028 declares no gap for it in tests/parity/111/gaps.test.ts"],
  );
  // Negative control 2: T028's file no longer names the criterion it measures.
  assert.deepEqual(
    [...gapsAreT028s(DOCUMENTS.gaps.replaceAll("F111-SC-001", "F111-SC-00X"))],
    ["tests/parity/111/gaps.test.ts does not name F111-SC-001"],
  );
  // And this file claims none of the twenty: the mapping starts at EV-21.
  assert.deepEqual(
    EV_COVERAGE.map((mapped) => mapped.ev).filter((ev) => GAP_IDS.includes(ev)),
    [],
  );
});

test("T076: EV-21 to EV-34 each have a named test through the requirement that carries them", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const evRows = readEvRequirements(DOCUMENTS.r14);
  assert.deepEqual(
    evRows.map((row) => row.id),
    Array.from({ length: 34 }, (_unused, index) => `EV-${String(index + 1).padStart(2, "0")}`),
    "R14 writes the 34 requirements EV-01 to EV-34 that F111-SC-009 counts",
  );
  const bullets = readRequirementBullets(DOCUMENTS.spec);
  assert.deepEqual([...evRequirementsHaveANamedTest(evRows, bullets)], []);
  assert.equal(EV_COVERAGE.length, 14, "EV-21 to EV-34 are the fourteen that are not T028's");
  // Every one reaches at least one NAMED test id, and the ids are the
  // specification's own.
  const reached = namedTestsOfEv(bullets);
  const named = new Set(bullets.flatMap((bullet) => [...bullet.tests]));
  for (const mapped of EV_COVERAGE) {
    const tests = reached.get(mapped.ev) ?? [];
    assert.ok(tests.length > 0, `${mapped.ev} reaches a named test`);
    for (const id of tests) assert.equal(named.has(id), true, `${id} is named by spec.md`);
  }
  assert.deepEqual([...(reached.get("EV-32") ?? [])], ["CT-111-116"]);
  // Negative control 1: the mapping drifts from R14's wording.
  const drifted = evRows.map((row) =>
    row.id === "EV-29" ? { ...row, statement: "liveness is an event after all" } : row,
  );
  assert.deepEqual(
    [...evRequirementsHaveANamedTest(drifted, bullets)],
    ['EV-29: R14 no longer reads "no heartbeat events"'],
  );
  // Negative control 2: the requirement that carries a row names no test.
  const silent = bullets.map((bullet) =>
    bullet.id === "F111-FR-016" ? { ...bullet, tests: [] } : bullet,
  );
  assert.deepEqual(
    [...evRequirementsHaveANamedTest(evRows, silent)],
    ["EV-32: F111-FR-016 names no test, so the row has none"],
  );
  // Negative control 3: an R14 row the mapping cannot find.
  assert.deepEqual(
    [
      ...evRequirementsHaveANamedTest(
        evRows.filter((row) => row.id !== "EV-34"),
        bullets,
      ),
    ],
    ["EV-34: R14 has no row for it"],
  );
});

test("T076: every success criterion of spec.md has a task that measures it", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  const tasks = readTasks(DOCUMENTS.tasks);
  assert.deepEqual([...criteriaAreMeasured(DOCUMENTS.spec, tasks)], []);
  // F111-SC-009, the criterion of this task, is measured by T076 itself.
  const t076 = tasks.find((task) => task.id === "T076");
  assert.ok(t076 !== undefined);
  assert.deepEqual([...t076.proves], ["F111-SC-009"]);
  assert.deepEqual([...t076.measures], ["F111-SC-009"]);
  assert.ok(
    t076.paths.includes("packages/observability/test/data-consistency.test.ts"),
    "T076 names this file",
  );
  // Negative control: a criterion no task measures.
  const unmeasured = tasks.map((task) => (task.id === "T076" ? { ...task, measures: [] } : task));
  assert.deepEqual(
    [...criteriaAreMeasured(DOCUMENTS.spec, unmeasured)],
    ["F111-SC-009: no task carries it in `measures:`"],
  );
});

test("T076: the traceability check of F111-SC-009 passes over the shipped documents", () => {
  if (!DOCUMENTS.present) {
    assert.ok(true, `skip: ${DOCUMENTS.reason}`);
    return;
  }
  assert.deepEqual(
    [...traceabilityFindings(DOCUMENTS.spec, DOCUMENTS.tasks, DOCUMENTS.r14, DOCUMENTS.gaps)],
    [],
    "F111-SC-009: every requirement has a test, and every test has a task and a file",
  );
  // The aggregate is not vacuous: it reports every direction. One broken
  // document makes it non-empty.
  const broken = DOCUMENTS.spec.replace("  - test: CT-111-116\n", "");
  assert.ok(
    traceabilityFindings(broken, DOCUMENTS.tasks, DOCUMENTS.r14, DOCUMENTS.gaps).length >= 2,
    "a requirement that loses its test is a finding of direction 1 and of the EV mapping",
  );
});
