/**
 * T154 — the type and the validator of the doctor's findings from
 * `schemas/doctor-findings.schema.json` (annex G, §G.7, the field table;
 * F100-FR-189).
 *
 * Schema id `specstride.doctor/1`. It is the `--json` output of the doctor:
 * the field `schema` is required, a different major is refused, and an unknown
 * field follows the rule of the schema.
 */
import type { DoctorFindings as Generated } from "./generated/doctor-findings.ts";
import { validate, type SchemaError } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.doctor/1" as const;

/** The section of annex G that owns the field list. */
export const ANNEX_SECTION = "annex G, §G.7" as const;

/** The closed set of severities of §G.7. */
export const SEVERITIES = ["ok", "info", "warn", "fail"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Unknown-value rule of §G.7: a severity a reader does not know is read as `warn`. */
export const SEVERITY_WHEN_UNKNOWN: Severity = "warn";

/** Read a severity; an unknown one is `warn` (§G.7). */
export function readSeverity(value: unknown): Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)
    ? (value as Severity)
    : SEVERITY_WHEN_UNKNOWN;
}

/** The two audiences the field table names. */
export const AUDIENCES = ["personal", "distributed"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** One finding of the list `findings` (§G.7, the field table). */
export type Finding = {
  readonly id: string;
  readonly severity: Severity;
  /** Launch-blocking. */
  readonly lb: boolean;
  readonly message: string;
  readonly fix: string;
  /** Redacted. */
  readonly evidence: string;
};

/** The doctor's findings (annex G, §G.7). */
export type DoctorFindings = Omit<Generated, "summary" | "findings"> & {
  readonly schema: string;
  readonly at: string;
  readonly host: string;
  readonly audience: Audience;
  readonly exit: number;
  readonly summary: Readonly<Record<Severity, number>>;
  readonly findings: readonly Finding[];
};

/** The fields the field table of §G.7 marks required. */
export const REQUIRED_FIELDS = [
  "schema",
  "at",
  "host",
  "audience",
  "exit",
  "summary",
  "findings",
] as const;

/** The optional fields of the field table of §G.7. */
export const OPTIONAL_FIELDS = ["registry", "pick", "sources"] as const;

/** The calling host is a host id, or `cli` (§G.7, the field table). */
export const HOST_WHEN_THE_CLI_CALLS = "cli" as const;

/** A value that does not validate against `specstride.doctor/1`. */
export class DoctorFindingsRefusedError extends Error {
  readonly errors: readonly SchemaError[];
  constructor(errors: readonly SchemaError[]) {
    super(
      `refused: the value is no doctor findings record of \`${SCHEMA_ID}\` ` +
        `(${errors.map((e) => `${e.path} ${e.message}`).join("; ")}) (annex G, §G.7)`,
    );
    this.name = "DoctorFindingsRefusedError";
    this.errors = Object.freeze([...errors]);
  }
}

/** Read the record: every required field of §G.7 is required. */
export function readDoctorFindings(value: unknown): DoctorFindings {
  const result = validate<DoctorFindings>(SCHEMA_ID, value);
  if (!result.ok) throw new DoctorFindingsRefusedError(result.errors);
  return result.record;
}

/** `readDoctorFindings` that returns a result instead of throwing. */
export function tryReadDoctorFindings(
  value: unknown,
): { ok: true; record: DoctorFindings } | { ok: false; error: DoctorFindingsRefusedError } {
  const result = validate<DoctorFindings>(SCHEMA_ID, value);
  if (result.ok) return { ok: true, record: result.record };
  return { ok: false, error: new DoctorFindingsRefusedError(result.errors) };
}

/** True when the value validates against `specstride.doctor/1`. */
export function isDoctorFindings(value: unknown): value is DoctorFindings {
  return validate<DoctorFindings>(SCHEMA_ID, value).ok;
}

/** F100-FR-189 — the launch checks are exactly the findings whose `lb` is set. */
export function launchBlockingFindings(record: DoctorFindings): readonly Finding[] {
  return Object.freeze(record.findings.filter((f) => f.lb));
}

/** The counts per severity of a list of findings, for the field `summary`. */
export function summaryOf(findings: readonly Finding[]): Readonly<Record<Severity, number>> {
  const out: Record<Severity, number> = { ok: 0, info: 0, warn: 0, fail: 0 };
  for (const f of findings) out[readSeverity(f.severity)] += 1;
  return Object.freeze(out);
}
