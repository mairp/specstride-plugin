/**
 * T067, T069 — the two tables the tests of phase 7 read as INDEPENDENT ORACLES.
 *
 * Neither is this package's own data:
 *
 *   - the table "Types added on 2026-09-30" lives in
 *     `specs/111-event-schema-and-projection/spec.md`, the specification the
 *     catalogue is checked against;
 *   - the projection table lives in
 *     `specs/144-compatibility-projection/contracts/projection-table.tsv`,
 *     feature 144's own declaration of what each event type projects to.
 *     Feature 111 reads it and never writes it.
 *
 * The parsers are here, in a file the test runner does not collect, so that two
 * test files can share them without either running the other's cases.
 */
import assert from "node:assert/strict";

/** One row of the table "Types added on 2026-09-30": a type and its fields. */
export type AddedTypeRow = {
  readonly type: string;
  readonly fields: readonly string[];
  /** True for the two rows that record a type retired before the catalogue took it. */
  readonly retired: boolean;
};

/**
 * Parse the table "Types added on 2026-09-30" out of `spec.md`. A row reads
 * `| \`type\` | \`a\`, \`b\` | sets and meaning | emitted by |`; a retired row
 * reads `retired` in the second cell instead of a field list.
 */
export function readAddedTypesTable(specification: string): readonly AddedTypeRow[] {
  const heading = "### Types added on 2026-09-30";
  const from = specification.indexOf(heading);
  assert.ok(from >= 0, `${heading} is a section of spec.md`);
  const after = specification.slice(from + heading.length);
  const end = after.indexOf("\n## ");
  const section = end < 0 ? after : after.slice(0, end);
  const rows: AddedTypeRow[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const name = /^`([a-z][a-z0-9_.]*)`$/.exec(cells[0] ?? "");
    if (name === null) continue;
    const type = name[1] as string;
    const second = cells[1] ?? "";
    if (second === "retired") {
      rows.push(Object.freeze({ type, fields: Object.freeze([]), retired: true }));
      continue;
    }
    const fields = [...second.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map(
      (hit) => hit[1] as string,
    );
    rows.push(Object.freeze({ type, fields: Object.freeze(fields), retired: false }));
  }
  return Object.freeze(rows);
}

/** One row of feature 144's projection table: the type and what it projects to. */
export type ProjectionRow = {
  readonly type: string;
  readonly legacyTarget: string;
  readonly shape: string;
};

/** Parse feature 144's projection table. */
export function readProjectionTable(text: string): readonly ProjectionRow[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const header = (lines[0] ?? "").split("\t");
  assert.equal(header[0], "type", "the first column of the projection table is the type");
  const legacyAt = header.indexOf("legacy_target");
  const shapeAt = header.indexOf("shape");
  assert.ok(legacyAt > 0 && shapeAt > 0, "the table names legacy_target and shape");
  return Object.freeze(
    lines.slice(1).map((line) => {
      const cells = line.split("\t");
      return Object.freeze({
        type: cells[0] ?? "",
        legacyTarget: cells[legacyAt] ?? "",
        shape: cells[shapeAt] ?? "",
      });
    }),
  );
}

/**
 * True where the type projects to NOTHING: it has a row, and every row it has
 * reads `-` as the legacy target and `none` as the shape. A type with no row
 * at all is not a pass: silence is not a declaration.
 */
export function projectsToNothing(rows: readonly ProjectionRow[], type: string): boolean {
  const own = rows.filter((row) => row.type === type);
  if (own.length === 0) return false;
  return own.every((row) => row.legacyTarget === "-" && row.shape === "none");
}

/** True where the type has no row of the projection table at all. */
export function hasNoProjectionRow(rows: readonly ProjectionRow[], type: string): boolean {
  return !rows.some((row) => row.type === type);
}
