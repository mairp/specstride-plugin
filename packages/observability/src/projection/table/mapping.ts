/**
 * T018 — the published mapping as data, with its checks, and the order of the
 * projected lines inside each writer class (F144-FR-002, F144-FR-011).
 *
 * F144-FR-011: *The published table MUST be readable as data, so that a
 * reader can tell which old name a type reaches and which types lie behind an
 * old name. Sink errors of the projection MUST be swallowed, and the projected
 * lines MUST be in the order of `seq` inside each class of writer (`engine`,
 * `stream-tap`, `critic`, `learning`).*
 *
 * This is the idea feature 144 keeps from Lisa (research D-5): the table of
 * `V1_V2_MAPPING` was data a test could check, and one emit gave both
 * encodings. Its CODE is not kept — the table here is read from the contract's
 * own copy and the shapes are this feature's.
 *
 * The mapping is published in BOTH directions because a reader asks both
 * questions. `oldNamesOfType` answers "which old name does this type reach",
 * `typesBehindOldName` answers "which types lie behind this old name", and
 * `mappingOffences` proves the two are inverses of one another — the
 * consistency check of CT-144-1.
 *
 * ORDER (rule N-14 of the oracle). Order is compared INSIDE each class of
 * writer; interleaving between classes is not compared. So the projection
 * never has to interleave four writers correctly: it has to keep each class
 * rising in `seq`, which is what `linesInOrderOfSeqInsideEachClass` does and
 * `orderIsKeptInsideEachClass` checks.
 */
import {
  WRITER_CLASSES,
  carriedLegacyNames,
  projectionRows,
  readCatalogueTypes,
  selectRow,
  type ProjectionRow,
  type WriterClass,
} from "./index.ts";

export { WRITER_CLASSES, type WriterClass };

/** The mapping, in both directions, as data (F144-FR-011). */
export type PublishedMapping = {
  /** For every type of the catalogue: the old names its rows target. */
  readonly byType: Readonly<Record<string, readonly string[]>>;
  /** For every old name: the types whose rows target it. */
  readonly byOldName: Readonly<Record<string, readonly string[]>>;
  /** For every old name: the writer class its lines are written in. */
  readonly classOfOldName: Readonly<Record<string, WriterClass>>;
};

/** Build the published mapping from the rows of the table. */
export function publishMapping(rows: readonly ProjectionRow[] = projectionRows): PublishedMapping {
  const byType = new Map<string, Set<string>>();
  const byOldName = new Map<string, Set<string>>();
  const classOfOldName = new Map<string, WriterClass>();
  for (const row of rows) {
    const names = byType.get(row.type) ?? new Set<string>();
    for (const name of row.targets) {
      names.add(name);
      const types = byOldName.get(name) ?? new Set<string>();
      types.add(row.type);
      byOldName.set(name, types);
      classOfOldName.set(name, row.classOfRow);
    }
    byType.set(row.type, names);
  }
  const sorted = (entries: Map<string, Set<string>>): Readonly<Record<string, readonly string[]>> =>
    Object.freeze(
      Object.fromEntries(
        [...entries.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, set]) => [key, Object.freeze([...set].sort())]),
      ),
    );
  return Object.freeze({
    byType: sorted(byType),
    byOldName: sorted(byOldName),
    classOfOldName: Object.freeze(Object.fromEntries([...classOfOldName.entries()].sort())),
  });
}

/** The published mapping of the table that ships with this package. */
export const mapping: PublishedMapping = publishMapping();

/** The old names a type reaches, over all of its rows (F144-FR-011). */
export function oldNamesOfType(
  type: string,
  published: PublishedMapping = mapping,
): readonly string[] {
  return published.byType[type] ?? Object.freeze([]);
}

/** The types that lie behind an old name (F144-FR-011). */
export function typesBehindOldName(
  name: string,
  published: PublishedMapping = mapping,
): readonly string[] {
  return published.byOldName[name] ?? Object.freeze([]);
}

/**
 * The read access to the table that the sink context of EP-08 declares:
 * `asIsNameOf(eventType)` gives the old name of a type, or null where the
 * type projects to nothing (annex C §C.10, `compatibilityProjection`). A type
 * with more than one row under different conditions has more than one name;
 * the one accessor answers with the name of the row that has no condition, or
 * with the first, so that the answer is a name and never a list.
 */
export function asIsNameOf(
  eventType: string,
  rows: readonly ProjectionRow[] = projectionRows,
): string | null {
  const names = oldNamesOfType(eventType, publishMapping(rows));
  if (names.length === 0) return null;
  const unconditional = rows.find(
    (row) => row.type === eventType && row.condition === "" && row.targets.length > 0,
  );
  return unconditional?.targets[0] ?? (names[0] as string);
}

/* ------------------------------------------------------------------ *
 * The checks of the published mapping (CT-144-1, F144-FR-002).
 * ------------------------------------------------------------------ */

/**
 * The consistency check of the published mapping. It holds when the list is
 * empty. Four claims, each one a way the published data could lie:
 *
 *   1. every type of the event catalogue is a key of `byType` — a type
 *      without a row would be missing from the mapping;
 *   2. the two directions are inverses: a name under a type appears in that
 *      name's list of types and the other way round;
 *   3. every one of the 65 carried names of the old vocabulary is a key of
 *      `byOldName`, and no key of `byOldName` is a name the inventory does not
 *      carry (F144-SC-002);
 *   4. every old name has ONE writer class, so that order inside a class is a
 *      well-defined thing to compare (rule N-14).
 */
export function mappingOffences(
  published: PublishedMapping = mapping,
  rows: readonly ProjectionRow[] = projectionRows,
  catalogueTypes: readonly string[] = readCatalogueTypes(),
  carried: readonly string[] = carriedLegacyNames(),
): readonly string[] {
  const offences: string[] = [];
  for (const type of catalogueTypes) {
    if (!(type in published.byType)) offences.push(`the mapping has no entry for the type ${type}`);
  }
  for (const [type, names] of Object.entries(published.byType)) {
    for (const name of names) {
      if (!(published.byOldName[name] ?? []).includes(type)) {
        offences.push(`${type} reaches ${name}, but ${name} does not list ${type}`);
      }
    }
  }
  for (const [name, types] of Object.entries(published.byOldName)) {
    for (const type of types) {
      if (!(published.byType[type] ?? []).includes(name)) {
        offences.push(`${name} lists ${type}, but ${type} does not reach ${name}`);
      }
    }
    if (!carried.includes(name)) {
      offences.push(`${name} is the target of a row and is not one of the carried names`);
    }
    const classes = new Set(
      rows.filter((row) => row.targets.includes(name)).map((row) => row.classOfRow),
    );
    if (classes.size !== 1) {
      offences.push(`${name} is written in ${String(classes.size)} writer classes, not one`);
    }
  }
  for (const name of carried) {
    if (!(name in published.byOldName)) {
      offences.push(`the carried name ${name} is the target of no row (F144-SC-002)`);
    }
  }
  return Object.freeze(offences);
}

/* ------------------------------------------------------------------ *
 * The order inside a writer class (rule N-14; F144-FR-011).
 * ------------------------------------------------------------------ */

/** One projected line, with the number and the class it is ordered by. */
export type ProjectedLine = {
  /** The `seq` of the event the line was rendered from. */
  readonly seq: number;
  /** The writer class of the row. */
  readonly writerClass: WriterClass;
  /** The old name of the line. */
  readonly event: string;
  /** The bytes of the line. */
  readonly line: string;
};

/**
 * The lines grouped by writer class, each group in the order of `seq`. The
 * classes come in the order of `WRITER_CLASSES`; interleaving between them is
 * not compared (rule N-14), so grouping them loses nothing the oracle reads.
 */
export function linesInOrderOfSeqInsideEachClass(
  lines: readonly ProjectedLine[],
): Readonly<Record<WriterClass, readonly ProjectedLine[]>> {
  const out = {} as Record<WriterClass, readonly ProjectedLine[]>;
  for (const writerClass of WRITER_CLASSES) {
    out[writerClass] = Object.freeze(
      lines.filter((line) => line.writerClass === writerClass).sort((a, b) => a.seq - b.seq),
    );
  }
  return Object.freeze(out);
}

/** True where every class of the lines rises in `seq`, strictly (rule N-14). */
export function orderIsKeptInsideEachClass(lines: readonly ProjectedLine[]): boolean {
  for (const writerClass of WRITER_CLASSES) {
    const ofClass = lines.filter((line) => line.writerClass === writerClass);
    for (let at = 1; at < ofClass.length; at += 1) {
      if ((ofClass[at] as ProjectedLine).seq <= (ofClass[at - 1] as ProjectedLine).seq)
        return false;
    }
  }
  return true;
}

/** The writer class an event's line is written in, or null where it writes none. */
export function writerClassOfEvent(
  type: string,
  data: Readonly<Record<string, unknown>> = {},
  rows: readonly ProjectionRow[] = projectionRows,
): WriterClass | null {
  const row = selectRow(type, data, rows);
  if (row === undefined || row.writesNothing) return null;
  return row.classOfRow;
}
