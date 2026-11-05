/**
 * T028 — the record validator over the lazy compile of T232 (annex B, §B.4;
 * F100-FR-048, F100-FR-049).
 *
 * `readRecord(logicalName, value)` requires the field `schema`, refuses an
 * unknown schema id or a major other than the one supported with the message
 * of the annex — the logical name, the major found and the major supported —
 * and returns the typed record.
 *
 * The schema id of a logical name is the `Schema or content` column of the
 * table of §B.5, read from `data/layout.json`; a name whose content is not a
 * record of this package has none (contracts/README.md, "The `$id` of a
 * schema file").
 */
import layout from "../../data/layout.json" with { type: "json" };
import { validate, validatorFor, UnknownSchemaError, UnsupportedMajorError } from "./compile.ts";
import type { SchemaError } from "./compile.ts";

type RawName = { logicalName: string; content: string };

const NAMES = (layout as { logicalNames: RawName[] }).logicalNames;

/** A schema id as a record carries it: the id with its major, `specstride.lease/1`. */
const SCHEMA_ID = /`(specstride[.-][a-z-]+\/[a-z]?\d+)`/;

/** The schema id of every logical name whose content is a record of this package. */
export const schemaIdOfLogicalName: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    NAMES.map((n) => [n.logicalName, SCHEMA_ID.exec(n.content)?.[1]]).filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  ),
);

/** The major a schema id carries: `specstride.lease/1` -> `1`. */
export function majorOf(schemaId: string): string {
  const slash = schemaId.indexOf("/");
  return slash < 0 ? "" : (schemaId.slice(slash + 1).split(":")[0] ?? "");
}

/** A record read through a logical name that is refused (F100-FR-049). */
export class RecordRefusedError extends Error {
  readonly logicalName: string;
  readonly majorFound: string;
  readonly majorSupported: string;
  readonly reason: "missing-schema" | "unknown-schema" | "different-major" | "invalid";
  readonly errors: readonly SchemaError[];

  constructor(init: {
    logicalName: string;
    majorFound: string;
    majorSupported: string;
    reason: "missing-schema" | "unknown-schema" | "different-major" | "invalid";
    message: string;
    errors?: readonly SchemaError[];
  }) {
    super(init.message);
    this.name = "RecordRefusedError";
    this.logicalName = init.logicalName;
    this.majorFound = init.majorFound;
    this.majorSupported = init.majorSupported;
    this.reason = init.reason;
    this.errors = Object.freeze([...(init.errors ?? [])]);
  }
}

/** The message of the annex: the logical name, the major found, the major supported. */
export function refusalMessage(
  logicalName: string,
  majorFound: string,
  majorSupported: string,
): string {
  return (
    `refused the record of the logical name "${logicalName}": ` +
    `the major found is ${majorFound}, the major supported is ${majorSupported} (F100-FR-049)`
  );
}

/**
 * Read a record by its logical name (F100-FR-048, F100-FR-049).
 *
 * The field `schema` is required. A schema id the package does not hold, and
 * a major other than the one the table of §B.5 gives for the name, are
 * refused with the message of the annex. A field the reader does not know is
 * ignored (F100-FR-049) — the schemas of this package are open unless they
 * say otherwise.
 */
export function readRecord<T = Record<string, unknown>>(logicalName: string, value: unknown): T {
  const supported = schemaIdOfLogicalName[logicalName];
  if (typeof value !== "object" || value === null) {
    throw new RecordRefusedError({
      logicalName,
      majorFound: "—",
      majorSupported: supported === undefined ? "—" : majorOf(supported),
      reason: "missing-schema",
      message:
        `refused the record of the logical name "${logicalName}": ` +
        `it is no record, so it carries no field \`schema\` (F100-FR-048)`,
    });
  }
  const carried = (value as { schema?: unknown }).schema;
  if (typeof carried !== "string" || carried === "") {
    throw new RecordRefusedError({
      logicalName,
      majorFound: "—",
      majorSupported: supported === undefined ? "—" : majorOf(supported),
      reason: "missing-schema",
      message:
        `refused the record of the logical name "${logicalName}": ` +
        `it carries no field \`schema\` (F100-FR-048)`,
    });
  }
  const majorFound = majorOf(carried);
  if (supported !== undefined && carried !== supported) {
    throw new RecordRefusedError({
      logicalName,
      majorFound,
      majorSupported: majorOf(supported),
      reason: "different-major",
      message: refusalMessage(logicalName, majorFound, majorOf(supported)),
    });
  }
  try {
    validatorFor(carried);
  } catch (err) {
    if (err instanceof UnsupportedMajorError) {
      throw new RecordRefusedError({
        logicalName,
        majorFound: err.majorFound,
        majorSupported: err.majorsSupported.join(" or "),
        reason: "different-major",
        message: refusalMessage(logicalName, err.majorFound, err.majorsSupported.join(" or ")),
      });
    }
    if (err instanceof UnknownSchemaError) {
      throw new RecordRefusedError({
        logicalName,
        majorFound,
        majorSupported: supported === undefined ? "—" : majorOf(supported),
        reason: "unknown-schema",
        message:
          `refused the record of the logical name "${logicalName}": ` +
          `the schema id "${carried}" is unknown to this package (F100-FR-049)`,
      });
    }
    throw err;
  }
  const result = validate<T>(carried, value);
  if (!result.ok) {
    throw new RecordRefusedError({
      logicalName,
      majorFound,
      majorSupported: supported === undefined ? majorFound : majorOf(supported),
      reason: "invalid",
      message:
        `refused the record of the logical name "${logicalName}": ` +
        result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors: result.errors,
    });
  }
  return result.record;
}

/** `readRecord` that returns a result instead of throwing. */
export function tryReadRecord<T = Record<string, unknown>>(
  logicalName: string,
  value: unknown,
): { ok: true; record: T } | { ok: false; error: RecordRefusedError } {
  try {
    return { ok: true, record: readRecord<T>(logicalName, value) };
  } catch (err) {
    if (err instanceof RecordRefusedError) return { ok: false, error: err };
    throw err;
  }
}

export type { SchemaError };
