/**
 * T212 — the registry of the further schema ids (annex B, §B.20;
 * F100-FR-227).
 *
 * §B.20 is the table of the records that one feature writes and that other
 * features read by logical name only. Feature 100 fixes three things for each:
 * the schema id, the logical name and the owner. It fixes nothing else: the
 * fields of such a record are in the specification of the feature named as
 * owner, and that feature delivers the schema file to the `contracts` package
 * through its own `contracts/deliver.json` (T299).
 *
 * The rule of F100-FR-227, as data and as functions of this module:
 *
 *  - every record of the table carries its schema id and follows the common
 *    rules of §B.4 (`followsTheCommonRulesOfB4`, the validator of T028);
 *  - the owner lists the fields and delivers the schema file;
 *  - a reader reads the record by its logical name and through its schema, and
 *    depends on no field the owner's specification does not list;
 *  - in compatibility output and in the compatibility projection the as-is
 *    name of a record is written where the baseline writes it.
 */
import furtherSchemaIds from "../../data/further-schema-ids.json" with { type: "json" };
import { holdsLogicalName } from "./logical-names.ts";

/** The section of annex B that owns the table. */
export const ANNEX_SECTION = "annex B, §B.20" as const;

type RawRow = {
  "Schema id": string;
  Record: string;
  "Logical name": string;
  Owner: string;
};

const RAW = (furtherSchemaIds as { schemaIds: RawRow[] }).schemaIds;

/** A cell of the table, without the back-ticks the annex writes it in. */
function plain(cell: string): string {
  return cell.replace(/`/g, "").trim();
}

/**
 * The em dash of the column "Logical name" means the record has none: the
 * archive of `state export` is a file the consumer names, the `--json` record
 * of an inspection command is output, and the two records of feature 130 are
 * internal to one adapter.
 */
function logicalNameOf(cell: string): string | undefined {
  const text = plain(cell);
  if (text === "" || text.startsWith("—")) return undefined;
  const first = text.split(/\s/)[0] ?? "";
  return first === "" ? undefined : first;
}

/**
 * The internal form of a schema id: `urn:specstride:schema:internal:<feature>:<name>/<major>`.
 * A record of that form is no contract of the `contracts` package — it is
 * internal to one adapter — and holds no logical name (§B.20, the note under
 * the table).
 */
export const INTERNAL_ID_PREFIX = "urn:specstride:schema:internal:" as const;

/** The form of every other schema id of the table: `specstride.<name>/<major>`. */
export const PRODUCT_ID_PREFIX = "specstride." as const;

/** One row of the table of §B.20. */
export type FurtherSchemaIdRow = {
  /** The schema id, as the record carries it in its `schema` field. */
  readonly schemaId: string;
  /** The name of the record, in the words of the table. */
  readonly record: string;
  /** The logical name by which a reader reads it, where it has one. */
  readonly logicalName: string | undefined;
  /** The feature that owns the fields and delivers the schema file. */
  readonly owner: string;
  /** The major the id carries. */
  readonly major: number;
  /** True for the internal form, which is no contract of the package. */
  readonly internal: boolean;
  /** The as-is name of the record, where the table names one. */
  readonly asIsName: string | undefined;
  /** A further major whose entries a reader also reads (§B.20). */
  readonly alsoReadsMajor: number | undefined;
};

/** The major of a schema id: the number after the final solidus (§B.4). */
export function majorOfSchemaId(schemaId: string): number {
  const tail = schemaId.slice(schemaId.lastIndexOf("/") + 1);
  const major = Number.parseInt(tail, 10);
  return Number.isFinite(major) ? major : Number.NaN;
}

/**
 * The as-is name a cell of the column "Record" names, where it names one.
 * Three cells say "as-is id the same": the as-is name of those records is the
 * schema id itself.
 */
function asIsNameOf(cell: string, schemaId: string): string | undefined {
  if (/as-is id the same/.test(cell)) return schemaId;
  const match = cell.match(/as-is (?:name|id) `([^`]+)`/);
  return match?.[1];
}

/**
 * The further major a reader of the record also reads, where the cell names
 * one: the decision log of learning is written as `/2` and entries of `/1` are
 * read (§B.20).
 */
function alsoReadsMajorOf(cell: string): number | undefined {
  const match = cell.match(/entries of `\/(\d+)` are read/);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

/** A table that is not the table of §B.20. */
export class FurtherSchemaIdTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FurtherSchemaIdTableError";
  }
}

function rowOfRaw(raw: RawRow): FurtherSchemaIdRow {
  const schemaId = plain(raw["Schema id"]);
  const internal = schemaId.startsWith(INTERNAL_ID_PREFIX);
  if (!internal && !schemaId.startsWith(PRODUCT_ID_PREFIX)) {
    throw new FurtherSchemaIdTableError(
      `the schema id \`${schemaId}\` of ${ANNEX_SECTION} carries neither the form ` +
        `\`${PRODUCT_ID_PREFIX}<name>/<major>\` nor the internal form ` +
        `\`${INTERNAL_ID_PREFIX}<feature>:<name>/<major>\` (F100-FR-227)`,
    );
  }
  const major = majorOfSchemaId(schemaId);
  if (!Number.isFinite(major)) {
    throw new FurtherSchemaIdTableError(
      `the schema id \`${schemaId}\` of ${ANNEX_SECTION} carries no major (§B.4)`,
    );
  }
  return Object.freeze({
    schemaId,
    record: raw.Record.trim(),
    logicalName: internal ? undefined : logicalNameOf(raw["Logical name"]),
    owner: plain(raw.Owner),
    major,
    internal,
    asIsName: asIsNameOf(raw.Record, schemaId),
    alsoReadsMajor: alsoReadsMajorOf(raw.Record),
  });
}

/** Every row of the table of §B.20, in the order of the annex. */
export const furtherSchemaIdRows: readonly FurtherSchemaIdRow[] = Object.freeze(RAW.map(rowOfRaw));

/** How many rows the table of §B.20 holds. */
export const FURTHER_SCHEMA_ID_COUNT = furtherSchemaIdRows.length;

const BY_ID = new Map(furtherSchemaIdRows.map((r) => [r.schemaId, r]));

/** Every schema id of the table, in the order of the annex. */
export const FURTHER_SCHEMA_IDS: readonly string[] = Object.freeze(
  furtherSchemaIdRows.map((r) => r.schemaId),
);

/** A schema id the table of §B.20 does not hold. */
export class UnknownFurtherSchemaIdError extends Error {
  readonly schemaId: string;
  constructor(schemaId: string) {
    super(
      `the table of ${ANNEX_SECTION} holds no schema id \`${schemaId}\`; ` +
        `feature 100 fixes the schema id, the logical name and the owner of every ` +
        `record of that table (F100-FR-227)`,
    );
    this.name = "UnknownFurtherSchemaIdError";
    this.schemaId = schemaId;
  }
}

/** True when the table of §B.20 holds the schema id. */
export function holdsSchemaId(schemaId: string): boolean {
  return BY_ID.has(schemaId);
}

/** The row of a schema id; refuses an id the table does not hold. */
export function rowOfSchemaId(schemaId: string): FurtherSchemaIdRow {
  const row = BY_ID.get(schemaId);
  if (row === undefined) throw new UnknownFurtherSchemaIdError(schemaId);
  return row;
}

/** The record a schema id names, in the words of the table. */
export function recordOf(schemaId: string): string {
  return rowOfSchemaId(schemaId).record;
}

/** The logical name of a record, or `undefined` where it has none. */
export function logicalNameOfSchemaId(schemaId: string): string | undefined {
  return rowOfSchemaId(schemaId).logicalName;
}

/** The feature that owns the fields of a record and delivers its schema file. */
export function ownerOf(schemaId: string): string {
  return rowOfSchemaId(schemaId).owner;
}

/** The rows a feature owns, by its number. */
export function rowsOfOwner(owner: string): readonly FurtherSchemaIdRow[] {
  return Object.freeze(furtherSchemaIdRows.filter((r) => r.owner === owner));
}

/** The row that carries a logical name, where one does. */
export function rowOfLogicalName(logicalName: string): FurtherSchemaIdRow | undefined {
  return furtherSchemaIdRows.find((r) => r.logicalName === logicalName);
}

/* ------------------------------------------------------------------ *
 * The rule of F100-FR-227.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-227 — every record of the table carries its schema id. The value of
 * the field `schema` of the record is that id, with its major, and the common
 * rules of §B.4 hold for it: that is what `readRecord` of T028 checks.
 */
export const EVERY_RECORD_CARRIES_ITS_SCHEMA_ID = true as const;

/** F100-FR-227 — the common rules of §B.4 hold for every row of the table. */
export const COMMON_RULES_SECTION = "annex B, §B.4" as const;
export function followsTheCommonRulesOfB4(schemaId: string): boolean {
  // Every row, the internal form of feature 130 included (§B.20, the note).
  return holdsSchemaId(schemaId);
}

/**
 * F100-FR-227 — the fields are with the owner: feature 100 fixes no field of
 * any record of §B.20. A reader depends on no field the owner's specification
 * does not list.
 */
export const FEATURE_100_FIXES = ["schema id", "logical name", "owner"] as const;
export const FEATURE_100_FIXES_NO_FIELD = true as const;
export const FIELDS_ARE_LISTED_BY = "the feature named as owner" as const;
export const OWNER_DELIVERS_THE_SCHEMA_FILE = true as const;

/**
 * F100-FR-227 — a feature that reads such a record reads it by its logical
 * name and through its schema. A record without a logical name is read by no
 * other feature: the archive of `state export` is a file the consumer names,
 * the `--json` record of an inspection command is output, and the two records
 * of feature 130 are internal to that adapter.
 */
export function readByLogicalName(schemaId: string): string {
  const row = rowOfSchemaId(schemaId);
  if (row.logicalName === undefined) {
    throw new UnknownFurtherSchemaIdError(
      `${schemaId}: the row of ${ANNEX_SECTION} names no logical name, so no other ` +
        `feature reads the record`,
    );
  }
  return row.logicalName;
}

/**
 * F100-FR-227 — in compatibility output and in the compatibility projection
 * the as-is name of a record is written where the baseline writes it. The
 * table names the as-is name of every record that has one.
 */
export const AS_IS_NAME_IS_WRITTEN_IN = [
  "compatibility output",
  "the compatibility projection",
] as const;

/** The as-is name of a record, where the table names one. */
export function asIsNameOfSchemaId(schemaId: string): string | undefined {
  return rowOfSchemaId(schemaId).asIsName;
}

/** Every row that names an as-is name, with it. */
export const AS_IS_NAMES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    furtherSchemaIdRows
      .filter((r): r is FurtherSchemaIdRow & { asIsName: string } => r.asIsName !== undefined)
      .map((r) => [r.schemaId, r.asIsName]),
  ),
);

/**
 * The rows whose logical name is a name of the table of §B.5, so that a
 * reader can resolve it through the resolver of T034. Every row with a logical
 * name must be such a row; `logicalNamesAreOfTheLayout()` says so.
 */
export function logicalNamesAreOfTheLayout(): readonly string[] {
  return Object.freeze(
    furtherSchemaIdRows
      .map((r) => r.logicalName)
      .filter((n): n is string => n !== undefined)
      .filter((n) => !holdsLogicalName(n)),
  );
}

/* ------------------------------------------------------------------ *
 * T228 — the row the repairs of the cross-feature review added.
 * ------------------------------------------------------------------ */

/**
 * `specstride.span-state/1` — the open spans of a run: the trace id and the
 * stack of open scopes. The exporter of feature 128 writes it at the logical
 * name `run:<runId>:span-state`, a file of the control plane, and no other
 * feature writes it.
 *
 * The review B-8.2c found (item B-8.2c-009) that the schema file of feature 128
 * carried the constant `specstride.span-state` with a separate field `v`, which
 * F100-FR-048 refuses: the value of `schema` is the schema id with its major.
 * The row was added to the table of §B.20 (worklist item W-100-09) so that the
 * id has one owner and one logical name, and this registry holds it like every
 * other row of that table.
 */
export const SPAN_STATE_SCHEMA_ID = "specstride.span-state/1" as const;

/** The logical name at which the record of `specstride.span-state/1` is read. */
export const SPAN_STATE_LOGICAL_NAME = "run:<runId>:span-state" as const;

/** The feature that owns the fields of the span state and delivers its schema. */
export const SPAN_STATE_OWNER = "128" as const;

/**
 * The row is pinned at load: a table of §B.20 that drops it, renames it, moves
 * it to another logical name or hands it to another owner fails here, and with
 * it every importer of the `contracts` package — rather than in feature 128,
 * which only reads the id.
 */
const spanState = rowOfSchemaId(SPAN_STATE_SCHEMA_ID);
if (spanState.logicalName !== SPAN_STATE_LOGICAL_NAME || spanState.owner !== SPAN_STATE_OWNER) {
  throw new FurtherSchemaIdTableError(
    `the row \`${SPAN_STATE_SCHEMA_ID}\` of ${ANNEX_SECTION} must carry the logical name ` +
      `\`${SPAN_STATE_LOGICAL_NAME}\` and the owner ${SPAN_STATE_OWNER}; it carries ` +
      `\`${String(spanState.logicalName)}\` and ${spanState.owner} (F100-FR-227; W-100-09)`,
  );
}
