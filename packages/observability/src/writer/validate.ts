/**
 * T006 — validation before the write (F111-FR-020).
 *
 * *The writer MUST check the `data` of every event against the schema of its
 * type before it writes it. An event that fails, and an event whose type is
 * neither in the catalogue nor starts with `x.`, MUST NOT be written and MUST
 * be counted in `event.dropped` with the reason `invalid`. The `data` of a type
 * that starts with `x.` is not checked. The check MUST never throw into the
 * loop.*
 *
 * The schema of a type is the row of the catalogue (`../catalogue/index.ts`,
 * T004), so this module holds no field name and no type name of its own. It
 * holds three things:
 *
 *   1. `checkAgainstSchema` — the checker of the keyword subset the `data`
 *      schemas use (`type`, `enum`, `items`, `properties`,
 *      `additionalProperties`, `required`). It returns findings and never
 *      throws.
 *   2. `validateBeforeWrite` — the gate. It is TOTAL over its input: any value
 *      at all gives a verdict, and a value that throws while it is read gives
 *      the refusal `invalid`, never an exception (Principle V: observability
 *      never breaks the loop).
 *   3. `DropLedger` and `writeThroughValidation` — the counting. A refused
 *      event uses no `seq` and reaches no append; the next event that IS
 *      written is preceded by `event.dropped` with the count and the reason
 *      (F111-FR-020, and the mechanism F111-FR-019 reuses for `write-failed`
 *      and `too-large`, which T012 owns).
 *
 * Deviation, recorded: the checker is in this package and not Ajv of
 * `@specstride/contracts`. The validator of feature 100 is keyed by the schema
 * ids the `contracts` package ships (`src/records/compile.ts`: `validatorFor`
 * resolves through `schema-map.ts`), and the `data` schemas of the catalogue are
 * not files of that package — they are derived from a row at load. Reaching Ajv
 * for them would add a second declared runtime dependency to this package for a
 * six-keyword subset. The envelope itself keeps feature 100's validator: this
 * module checks `data` only.
 */
import { reasonsOfADroppedEvent } from "@specstride/contracts/enums/all-sets";
import {
  dataSchemaForType,
  isThirdPartyType,
  typeIsWritable,
  type DataSchema,
  type PropertySchema,
} from "../catalogue/index.ts";

/** The type of the event that reports dropped events. */
export const DROPPED_EVENT_TYPE = "event.dropped" as const;

/** The reason a validation refusal is counted with (row 94 of annex X §X.6). */
export const DROP_REASON_INVALID = "invalid" as const;

/** A reason of a dropped event: a member of the closed set of row 94. */
export type DropReason = (typeof reasonsOfADroppedEvent.members)[number];

/** One finding of the check: the keyword that failed, where, and why. */
export type SchemaFinding = {
  readonly keyword: string;
  readonly path: string;
  readonly message: string;
};

/** What the writer is asked to write: a type and the `data` of that type. */
export type CandidateEvent = {
  readonly type: string;
  readonly data?: unknown;
};

/* ------------------------------------------------------------------ *
 * The checker of the keyword subset the `data` schemas use.
 * ------------------------------------------------------------------ */

/** The JSON type of a value, as the keyword `type` names it. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "number") return Number.isInteger(value) ? "integer" : "number";
  if (kind === "undefined") return "undefined";
  if (kind === "object") return "object";
  return kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return jsonTypeOf(value) === "object";
}

function allowedTypes(property: PropertySchema): readonly string[] | undefined {
  if (property.type === undefined) return undefined;
  return typeof property.type === "string" ? [property.type] : property.type;
}

/** Check one `data` field against its property schema. */
function checkProperty(path: string, property: PropertySchema, value: unknown): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  // A field that is a member of a closed set OR null — `layerOff` and
  // `fallbackReason` of `microloop.unit` are both (F111-FR-008) — admits null
  // before the members are read: null is the absence of a member, not a
  // member that is missing from the set.
  if (value === null && allowedTypes(property)?.includes("null") === true) return findings;
  if (property.enum !== undefined) {
    if (typeof value !== "string" || !property.enum.includes(value)) {
      findings.push({
        keyword: "enum",
        path,
        message:
          `${path} holds ${JSON.stringify(value) ?? "undefined"}; the closed set of the field ` +
          `is ${property.enum.join(", ")}`,
      });
    }
    return findings;
  }
  const allowed = allowedTypes(property);
  const found = jsonTypeOf(value);
  if (allowed !== undefined) {
    // `integer` satisfies `number`, as JSON Schema reads the two.
    const matches = allowed.includes(found) || (found === "integer" && allowed.includes("number"));
    if (!matches) {
      findings.push({
        keyword: "type",
        path,
        message: `${path} is a ${found}; the field holds ${allowed.join(", ")}`,
      });
      return findings;
    }
  }
  if (property.items !== undefined && Array.isArray(value)) {
    for (const [index, member] of value.entries()) {
      const memberType = jsonTypeOf(member);
      if (memberType !== property.items.type) {
        findings.push({
          keyword: "items",
          path: `${path}[${index}]`,
          message: `${path}[${index}] is a ${memberType}; the members hold ${property.items.type}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Check a value against a `data` schema of the catalogue. Returns the findings;
 * an empty list means the value fits. Never throws: a value whose access throws
 * gives the finding `internal`.
 */
export function checkAgainstSchema(schema: DataSchema, data: unknown): readonly SchemaFinding[] {
  try {
    if (!isRecord(data)) {
      return Object.freeze([
        {
          keyword: "type",
          path: "data",
          message: `the data of an event is a record; this is a ${jsonTypeOf(data)}`,
        },
      ]);
    }
    const findings: SchemaFinding[] = [];
    const typeName = schema.$id.slice(schema.$id.indexOf(":") + 1);
    for (const field of Object.keys(data)) {
      if (!Object.hasOwn(schema.properties, field)) {
        findings.push({
          keyword: "additionalProperties",
          path: `data.${field}`,
          message: `the type ${typeName} has no data field named ${field}`,
        });
      }
    }
    for (const field of schema.required) {
      if (!Object.hasOwn(data, field)) {
        findings.push({
          keyword: "required",
          path: `data.${field}`,
          message: `the type ${typeName} requires the data field ${field}`,
        });
      }
    }
    for (const [field, property] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(data, field)) continue;
      findings.push(...checkProperty(`data.${field}`, property, data[field]));
    }
    return Object.freeze(findings);
  } catch (error) {
    return Object.freeze([
      {
        keyword: "internal",
        path: "data",
        message: `the check of the data could not be run: ${String(error)}`,
      },
    ]);
  }
}

/* ------------------------------------------------------------------ *
 * The gate: the verdict before the write.
 * ------------------------------------------------------------------ */

/**
 * The verdict of the gate. `checked` is false for a type that starts with `x.`:
 * its `data` is not checked (F111-FR-020) and is never even read.
 */
export type ValidationVerdict =
  | { readonly admitted: true; readonly type: string; readonly checked: boolean }
  | {
      readonly admitted: false;
      readonly type: string;
      readonly reason: typeof DROP_REASON_INVALID;
      readonly findings: readonly SchemaFinding[];
    };

/**
 * Validate an event before it is written (F111-FR-020). Total over its input
 * and NEVER THROWS: every path returns a verdict, the unexpected one included.
 */
export function validateBeforeWrite(candidate: unknown): ValidationVerdict {
  let type = "";
  try {
    const named = (candidate as { type?: unknown } | null | undefined)?.type;
    if (typeof named !== "string" || named.length === 0) {
      return Object.freeze({
        admitted: false as const,
        type: "",
        reason: DROP_REASON_INVALID,
        findings: Object.freeze([
          {
            keyword: "type-not-in-catalogue",
            path: "type",
            message: "an event carries a type; this one carries none",
          },
        ]),
      });
    }
    type = named;
    if (!typeIsWritable(type)) {
      return Object.freeze({
        admitted: false as const,
        type,
        reason: DROP_REASON_INVALID,
        findings: Object.freeze([
          {
            keyword: "type-not-in-catalogue",
            path: "type",
            message:
              `the type ${type} is no type of the catalogue and does not start with ` +
              `"x."; the event is not written (F111-FR-001, F111-FR-020)`,
          },
        ]),
      });
    }
    // The `data` of a type that starts with `x.` is not checked, so it is not read.
    if (isThirdPartyType(type)) {
      return Object.freeze({ admitted: true as const, type, checked: false });
    }
    const schema = dataSchemaForType(type);
    if (schema === undefined) {
      // Unreachable while `typeIsWritable` and `dataSchemaForType` read the same
      // catalogue; kept so that a drift refuses rather than throws.
      return Object.freeze({
        admitted: false as const,
        type,
        reason: DROP_REASON_INVALID,
        findings: Object.freeze([
          {
            keyword: "type-not-in-catalogue",
            path: "type",
            message: `the type ${type} has no data schema in the catalogue`,
          },
        ]),
      });
    }
    const findings = checkAgainstSchema(schema, (candidate as { data?: unknown }).data);
    if (findings.length > 0) {
      return Object.freeze({
        admitted: false as const,
        type,
        reason: DROP_REASON_INVALID,
        findings,
      });
    }
    return Object.freeze({ admitted: true as const, type, checked: true });
  } catch (error) {
    // The check never throws into the loop: an unexpected error is a refusal.
    return Object.freeze({
      admitted: false as const,
      type,
      reason: DROP_REASON_INVALID,
      findings: Object.freeze([
        {
          keyword: "internal",
          path: "(event)",
          message: `the event could not be validated: ${String(error)}`,
        },
      ]),
    });
  }
}

/* ------------------------------------------------------------------ *
 * The counting: `event.dropped` with the count and the reason.
 * ------------------------------------------------------------------ */

/** One entry of the ledger: how many events were dropped for one reason. */
export type DropCount = { readonly reason: string; readonly count: number };

/**
 * The counts of the events that were dropped and not yet reported. The next
 * event that is written is preceded by one `event.dropped` per reason, in the
 * order in which the reasons were first seen, and the ledger is cleared by the
 * take (F111-FR-020, F111-FR-019).
 */
export class DropLedger {
  readonly #counts = new Map<string, number>();

  /** Count one dropped event under its reason. */
  count(reason: string): void {
    this.#counts.set(reason, (this.#counts.get(reason) ?? 0) + 1);
  }

  /** How many dropped events have not been reported. */
  get total(): number {
    let total = 0;
    for (const count of this.#counts.values()) total += count;
    return total;
  }

  /** What a report would say, without clearing the ledger. */
  pending(): readonly DropCount[] {
    return Object.freeze(
      [...this.#counts.entries()].map(([reason, count]) => Object.freeze({ reason, count })),
    );
  }

  /** What a report says, and clears the ledger. */
  take(): readonly DropCount[] {
    const taken = this.pending();
    this.#counts.clear();
    return taken;
  }

  /**
   * Put an entry back: a report that was taken and could not be written is
   * still owed, so the NEXT event that is written is preceded by it
   * (F111-FR-019). Without this a drop would be reported nowhere when the
   * report itself failed to append.
   */
  restore(entry: DropCount): void {
    this.#counts.set(entry.reason, (this.#counts.get(entry.reason) ?? 0) + entry.count);
  }
}

/** The `event.dropped` that reports one entry of the ledger. */
export function droppedEventOf(entry: DropCount): CandidateEvent {
  return Object.freeze({
    type: DROPPED_EVENT_TYPE,
    data: Object.freeze({ count: entry.count, reason: entry.reason }),
  });
}

/** Where a validated event is appended. The writer of T008 owns the lock and the `seq`. */
export type AppendTarget = {
  append: (event: CandidateEvent) => void;
};

/** What became of one event the writer was asked to write. */
export type WriteOutcome =
  | { readonly written: true; readonly type: string; readonly reported: readonly DropCount[] }
  | {
      readonly written: false;
      readonly type: string;
      readonly reason: string;
      readonly findings: readonly SchemaFinding[];
    };

/**
 * Validate, then write (F111-FR-020). A refused event never reaches `append`,
 * so it uses no `seq` and reaches no sink; it is counted in the ledger instead.
 * An admitted event is preceded by the `event.dropped` the ledger owes.
 *
 * An append that fails is counted with the reason `write-failed` and does not
 * throw, so that this path cannot break the loop either; the whole of
 * F111-FR-019 — the empty destination, `too-large`, the sinks — is T012's.
 */
export function writeThroughValidation(
  target: AppendTarget,
  ledger: DropLedger,
  candidate: unknown,
): WriteOutcome {
  const verdict = validateBeforeWrite(candidate);
  if (!verdict.admitted) {
    ledger.count(verdict.reason);
    return Object.freeze({
      written: false as const,
      type: verdict.type,
      reason: verdict.reason,
      findings: verdict.findings,
    });
  }
  const event = candidate as CandidateEvent;
  // The report of what was dropped goes first, so it precedes the next event
  // that is written. An `event.dropped` is itself a catalogue type: it passes
  // the same gate.
  const owed = ledger.take();
  const reported: DropCount[] = [];
  try {
    for (const entry of owed) {
      const report = droppedEventOf(entry);
      if (validateBeforeWrite(report).admitted) {
        target.append(report);
        reported.push(entry);
      }
    }
    target.append(event);
  } catch (error) {
    ledger.count("write-failed");
    return Object.freeze({
      written: false as const,
      type: verdict.type,
      reason: "write-failed",
      findings: Object.freeze([
        {
          keyword: "append",
          path: "(write)",
          message: `the append failed: ${String(error)}`,
        },
      ]),
    });
  }
  return Object.freeze({
    written: true as const,
    type: verdict.type,
    reported: Object.freeze(reported),
  });
}
