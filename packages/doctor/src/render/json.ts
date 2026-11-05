/**
 * T021 (feature 112) — the `--json` renderer (F112-FR-025, CT-112-125).
 *
 * One record of schema `specstride.doctor/1` (annex G §G.7), in a stable order
 * of keys, with no escape sequence of our own adding: `JSON.stringify` is
 * called once on the assembled record. It NEVER holds a secret value, an
 * account identifier or a token: the evidence of every finding passes the
 * redactor of the runner before it is stringified into the field `evidence`.
 * `--json` is opt-in and is not limited by the token budget (research D-9).
 *
 * The fields `registry`, `pick` and `sources` are present when the checks that
 * produce them ran (F112-FR-025, last sentence).
 */
import { SCHEMA_ID, tryReadDoctorFindings } from "@specstride/contracts/records/doctor-findings";
import type { Audience } from "@specstride/contracts/records/doctor-findings";
import { summaryOf } from "@specstride/contracts/records/doctor-findings";
import type { Finding } from "../registry/types.ts";
import { redactEvidence } from "../runner/run.ts";

/** The evidence of one finding, stringified after the redactor (F112-FR-025). */
export function evidenceString(evidence: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(redactEvidence(evidence));
}

/** The record the `--json` renderer prints. */
export type DoctorJsonInput = {
  readonly at: string;
  readonly host: string;
  readonly audience: Audience;
  readonly exit: number;
  readonly findings: readonly Finding[];
  /** Present when the checks that produce them ran (F112-FR-025). */
  readonly registry?: unknown;
  readonly pick?: unknown;
  readonly sources?: unknown;
};

/** The keys of the record, in their stable order (F112-FR-025). */
export const JSON_KEY_ORDER: readonly string[] = Object.freeze([
  "schema",
  "at",
  "host",
  "audience",
  "exit",
  "summary",
  "findings",
  "registry",
  "pick",
  "sources",
]);

/**
 * Assemble the `--json` record with a stable order of keys, and validate it
 * against `specstride.doctor/1` before it leaves the renderer.
 */
export function buildDoctorJson(input: DoctorJsonInput): Record<string, unknown> {
  const findings = input.findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    lb: f.lb,
    message: f.message,
    fix: f.remedy,
    evidence: evidenceString(f.evidence),
  }));
  const summary = summaryOf(findings);
  const record: Record<string, unknown> = {
    schema: SCHEMA_ID,
    at: input.at,
    host: input.host,
    audience: input.audience,
    exit: input.exit,
    summary,
    findings,
  };
  // Optional fields are appended in the stable order, only when present.
  if (input.registry !== undefined) record["registry"] = input.registry;
  if (input.pick !== undefined) record["pick"] = input.pick;
  if (input.sources !== undefined) record["sources"] = input.sources;
  const checked = tryReadDoctorFindings(record);
  if (!checked.ok) throw checked.error;
  return record as unknown as Record<string, unknown>;
}

/** Render the `--json` output: one line of JSON, no added escape sequence. */
export function renderJson(input: DoctorJsonInput): string {
  return JSON.stringify(buildDoctorJson(input));
}
