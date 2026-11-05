/**
 * T014 — the rows that project to nothing, and the field filter
 * (F144-FR-009, F144-FR-012).
 *
 * F144-FR-009: *An event with no as-is equivalent MUST project to nothing:
 * the layer events (DV-016), `blocked` (DV-067), the seven `parallel.*` types
 * and every `x.` type. A field of a projected event that the old vocabulary
 * lacks (`seq`, `passId`, `category`, `strategy`) MUST NOT be projected. The
 * projection MUST write no line that has no as-is equivalent.*
 *
 * Nothing here is a hand-written list of types. The groups the requirement
 * names are READ OUT OF THE TABLE by the register row its cell cites, so that
 * a row whose note changes changes the group with it and the test of T013
 * sees it:
 *
 *   - the layer events are the rows whose note cites DV-016;
 *   - `blocked` is the row whose note cites DV-067;
 *   - the seven `parallel.*` types are the rows whose note cites DV-088.
 *
 * An `x.` type belongs to a third party and is a type of no row at all
 * (F100-FR-199), so `projectsToNothing` answers for it by its prefix and
 * never by a lookup.
 *
 * F144-FR-012 names the thirteen types the event catalogue gained when
 * feature 111 completed it after the split. They are data here, and T013 holds
 * the table to them: each has a row, and each of those rows writes nothing.
 */
import {
  FIELDS_NEVER_PROJECTED,
  NOTHING,
  projectionRows,
  selectRow,
  type ProjectionRow,
} from "./index.ts";
import type { AsIsPair } from "../bash-line/index.ts";
import type { TypedPair } from "../python-line/index.ts";

export { FIELDS_NEVER_PROJECTED, NOTHING };

/** An event type free for third parties; never projected (F100-FR-199). */
export const THIRD_PARTY_PREFIX = "x." as const;

/** The register rows F144-FR-009 names, each with the group it marks. */
export const GROUPS_WITH_NO_AS_IS_EQUIVALENT = Object.freeze({
  /** The layer events. */
  "DV-016": "the layer events",
  /** `blocked`. */
  "DV-067": "a block on a person",
  /** The seven `parallel.*` types. */
  "DV-088": "the types of parallel units",
});
export type RegisterRowOfTheGroups = keyof typeof GROUPS_WITH_NO_AS_IS_EQUIVALENT;

/** The rows whose note cites a register row. */
export function rowsCiting(
  registerRow: string,
  rows: readonly ProjectionRow[] = projectionRows,
): readonly ProjectionRow[] {
  return Object.freeze(rows.filter((row) => row.fieldMap.includes(registerRow)));
}

/** The types of one of the three groups F144-FR-009 names. */
export function typesOfGroup(
  registerRow: RegisterRowOfTheGroups,
  rows: readonly ProjectionRow[] = projectionRows,
): readonly string[] {
  return Object.freeze([...new Set(rowsCiting(registerRow, rows).map((row) => row.type))].sort());
}

/** The seven types of parallel units (DV-088). */
export const PARALLEL_PREFIX = "parallel." as const;
export const PARALLEL_TYPE_COUNT = 7 as const;

/** The type of a block on a person (DV-067). */
export const BLOCKED_TYPE = "blocked" as const;

/** The thirteen types the catalogue gained after the split (F144-FR-012). */
export const TYPES_ADDED_AFTER_THE_SPLIT = [
  "check.admission",
  "check.excluded",
  "check.parallelism_lowered",
  "checkpoint.accepted",
  "checkpoint.refused",
  "checkpoint.removed",
  "fallback.skipped",
  "microloop.inert",
  "source.change_accepted",
  "strategy.selected",
  "terms.override_used",
  "tripwire.raised",
  "tripwire.cleared",
] as const;

/** Thirteen, as F144-FR-012 counts them. */
export const TYPES_ADDED_AFTER_THE_SPLIT_COUNT = 13 as const;

/**
 * The two types feature 111 retired before the catalogue took them
 * (F111-FR-052 retired): they are types of no row, and that is not a gap.
 */
export const TYPES_RETIRED_BEFORE_THE_CATALOGUE = [
  "critic.passed_over",
  "critic.diversity",
] as const;

/** Every row that writes nothing: shape `none` with the target `-`. */
export function rowsThatWriteNothing(
  rows: readonly ProjectionRow[] = projectionRows,
): readonly ProjectionRow[] {
  return Object.freeze(rows.filter((row) => row.writesNothing));
}

/** Every type that writes nothing under every one of its conditions. */
export function typesThatAlwaysWriteNothing(
  rows: readonly ProjectionRow[] = projectionRows,
): readonly string[] {
  const byType = new Map<string, ProjectionRow[]>();
  for (const row of rows) byType.set(row.type, [...(byType.get(row.type) ?? []), row]);
  return Object.freeze(
    [...byType.entries()]
      .filter(([, ofType]) => ofType.every((row) => row.writesNothing))
      .map(([type]) => type)
      .sort(),
  );
}

/**
 * True where the event projects to nothing: an `x.` type of a third party, a
 * type of no row, or a type whose selected row writes nothing (F144-FR-009).
 */
export function projectsToNothing(
  type: string,
  data: Readonly<Record<string, unknown>> = {},
  rows: readonly ProjectionRow[] = projectionRows,
): boolean {
  if (type.startsWith(THIRD_PARTY_PREFIX)) return true;
  const row = selectRow(type, data, rows);
  if (row === undefined) return true;
  return row.writesNothing;
}

/* ------------------------------------------------------------------ *
 * The field filter.
 * ------------------------------------------------------------------ */

/** True where the key is one the old vocabulary lacks (F144-FR-009). */
export function fieldIsNeverProjected(key: string): boolean {
  return FIELDS_NEVER_PROJECTED.includes(key);
}

/**
 * The field filter: the four fields of F144-FR-009 are dropped from the pairs
 * of a line, whatever the shape. One function serves the three shapes because
 * the pair of each is a key and a value; the value is never read here.
 */
export function withoutFieldsTheOldVocabularyLacks<P extends AsIsPair | TypedPair>(
  pairs: readonly P[],
): readonly P[] {
  return Object.freeze(pairs.filter(([key]) => !fieldIsNeverProjected(key)));
}

/**
 * The same filter over the `data` of an event, for a caller that fills a field
 * map from the record: the four fields never reach a line.
 */
export function dataWithoutFieldsTheOldVocabularyLacks(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(data).filter(([key]) => !fieldIsNeverProjected(key))),
  );
}
