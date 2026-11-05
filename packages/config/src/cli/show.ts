/**
 * T020 — `config show` (F110-FR-021, F110-FR-024, F110-FR-025, F110-FR-026).
 *
 * F110-FR-025: `config show` prints every key that has a value from a rank other
 * than the default, and with `--all` every key, each with its value, its source
 * and its shadowed values, in the output modes of annex G §G.2. It prints a
 * secret reference as written and never a value, and it does not resolve one. It
 * reads the same layers that a launch reads, and reports the same errors. Its
 * exit code is 0, and 3 where the configuration is invalid or the usage is wrong.
 *
 * The two output forms are those of the line grammar of annex G §G.3: in default
 * output the facts are a **product line**, whose label starts with `SPECSTRIDE-`
 * and whose body is pairs `key=value` separated by one space; that family is
 * printed "in default output", so in compatibility output the same pairs are
 * printed without the label — `config show` has no as-is line to reproduce,
 * being a command the baselines do not have (F100-FR-186). `--json` is the
 * structured form of F100-FR-172: one record with a `schema` field, in a stable
 * order of keys and with no secret value.
 */
import { Buffer } from "node:buffer";
import { type OutputMode } from "@specstride/contracts/grammar/output-modes";
import type { Finding } from "@specstride/contracts/records/doctor-findings";

import { CATALOGUE_SIZE } from "../schema/catalogue.ts";
import {
  resolveConfiguration,
  type ConfigurationError,
  type LayerSources,
  type ResolvedConfiguration,
} from "../load/merge.ts";
import {
  isSetAboveTheDefault,
  provenanceTable,
  runRecordSources,
  shadowedEnvironmentFindings,
  shadowedEnvironmentValues,
  type ProvenanceRecord,
} from "../load/provenance.ts";
import { findingsOf, launchMessagesOf } from "../load/trust.ts";

/** The name of the command, as annex G §G.1 spells it. */
export const COMMAND = "config show" as const;

/** The exit code of a run that printed the configuration (§G.4). */
export const EXIT_OK = 0 as const;

/** The exit code of an invalid configuration or a usage error (§G.4). */
export const EXIT_INVALID_OR_USAGE = 3 as const;

/** The label of the product lines of this command (annex G §G.3). */
export const LINE_LABEL = "SPECSTRIDE-CONFIG" as const;

/**
 * The schema id of the `--json` record. The table of §B.20 holds no row for the
 * output of this command, so the id is of the internal form, which is no
 * contract of the `contracts` package (§B.20, the note). Task T043 reports the
 * row to the orchestrator.
 */
export const JSON_SCHEMA_ID = "urn:specstride:schema:internal:110:config-show/1" as const;

/** The flags of `config show`. */
export const FLAGS = ["--all", "--json"] as const;

/** What the command was asked to do. */
export interface ShowFlags {
  /** `--all`: every key of the catalogue, not only those set above the default. */
  readonly all: boolean;
  /** `--json`: the structured form of F100-FR-172. */
  readonly json: boolean;
  /** The usage error, where the argument list holds one. */
  readonly usageError?: string | undefined;
}

/** Read the argument list of `config show` (F110-FR-025, exit 3 on usage). */
export function parseShowFlags(argv: readonly string[]): ShowFlags {
  let all = false;
  let json = false;
  for (const argument of argv) {
    if (argument === "--all") {
      all = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    return Object.freeze({
      all,
      json,
      usageError:
        `${COMMAND}: \`${argument}\` is not a flag of the command. The flags are ` +
        `${FLAGS.join(", ")}`,
    });
  }
  return Object.freeze({ all, json });
}

/** What a command run gives back: the exit code and the two streams. */
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The value of a record as a line prints it; a secret reference as written. */
export function renderValue(record: ProvenanceRecord): string {
  const value = record.value;
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/** The shadowed values of a record as a line prints them: rank by rank. */
export function renderShadowed(record: ProvenanceRecord): string {
  if (record.shadowed.length === 0) return "none";
  return record.shadowed.map((s) => `${s.source}:${s.rank}`).join(",");
}

/** The pairs of one key, in a stable order (annex G §G.3, product lines). */
export function pairsOf(record: ProvenanceRecord): readonly string[] {
  const pairs: string[] = [
    `key=${record.key}`,
    `value=${renderValue(record)}`,
    `source=${record.source}`,
    `rank=${record.sourceRank}`,
  ];
  if (record.place !== undefined) pairs.push(`place=${JSON.stringify(record.place)}`);
  if (record.decisionId !== undefined) pairs.push(`decision=${record.decisionId}`);
  if (record.profile !== undefined) pairs.push(`profile=${record.profile}`);
  if (record.isSecretReference) pairs.push("secret=reference");
  pairs.push(`shadowed=${renderShadowed(record)}`);
  return Object.freeze(pairs);
}

/** One line of one key, in the output mode in force (annex G §G.2, §G.3). */
export function lineOf(record: ProvenanceRecord, mode: OutputMode): string {
  const body = pairsOf(record).join(" ");
  return mode === "compat" ? body : `[${LINE_LABEL}] ${body}`;
}

/** What `config show` is told: the layers of a launch, the flags, the mode. */
export interface ShowRequest {
  readonly argv?: readonly string[] | undefined;
  /** The layers a launch reads (F110-FR-025, "the same layers"). */
  readonly sources?: LayerSources | undefined;
  /** An already-resolved configuration, where the caller has one. */
  readonly resolved?: ResolvedConfiguration | undefined;
  /** The output mode in force; `parity` selects compatibility output. */
  readonly mode?: OutputMode | undefined;
}

/** Everything one run of `config show` produced, beside its two streams. */
export interface ShowOutcome extends CommandResult {
  /** The provenance of every key, which the run record holds as well. */
  readonly records: readonly ProvenanceRecord[];
  /** The findings the doctor receives (F110-FR-017, F110-FR-026). */
  readonly findings: readonly Finding[];
  /** The errors the same launch would report (F110-FR-025). */
  readonly errors: readonly ConfigurationError[];
}

const errorText = (error: ConfigurationError): string => error.message;

/**
 * F110-FR-025 — run `config show`.
 *
 * The exit code is 3 for a usage error and for an invalid configuration, and 0
 * otherwise. A secret reference is printed as it was written and is never
 * resolved: the record carries the reference, and `renderValue` prints it.
 */
export function runConfigShow(request: ShowRequest = {}): ShowOutcome {
  const flags = parseShowFlags(request.argv ?? []);
  if (flags.usageError !== undefined) {
    return Object.freeze({
      code: EXIT_INVALID_OR_USAGE,
      stdout: "",
      stderr: `${flags.usageError}\n`,
      records: Object.freeze([]),
      findings: Object.freeze([]),
      errors: Object.freeze([]),
    });
  }

  const resolved = request.resolved ?? resolveConfiguration(request.sources ?? {});
  const records = provenanceTable(resolved.values);
  const shown = flags.all ? records : records.filter(isSetAboveTheDefault);
  const mode: OutputMode = request.mode ?? (resolved.profile === "parity" ? "compat" : "default");
  const onResume = request.sources?.onResume;

  const findings: Finding[] = [
    ...findingsOf(resolved.trust),
    ...shadowedEnvironmentFindings(records, { onResume }),
  ];

  const stderrLines: string[] = [
    ...launchMessagesOf(resolved.trust),
    ...resolved.errors.map(errorText),
  ];

  if (resolved.errors.length > 0) {
    return Object.freeze({
      code: EXIT_INVALID_OR_USAGE,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`,
      records,
      findings: Object.freeze(findings),
      errors: resolved.errors,
    });
  }

  const stdout = flags.json
    ? `${JSON.stringify(jsonRecordOf(records, shown, resolved, { all: flags.all, onResume }))}\n`
    : `${shown.map((record) => lineOf(record, mode)).join("\n")}${shown.length === 0 ? "" : "\n"}`;

  return Object.freeze({
    code: EXIT_OK,
    stdout,
    stderr: stderrLines.length === 0 ? "" : `${stderrLines.join("\n")}\n`,
    records,
    findings: Object.freeze(findings),
    errors: Object.freeze([]),
  });
}

/**
 * The `--json` record (F100-FR-172): one record with a `schema` field, in a
 * stable order of keys, with no secret value — a secret reference stands as it
 * was written and is never resolved.
 */
export function jsonRecordOf(
  records: readonly ProvenanceRecord[],
  shown: readonly ProvenanceRecord[],
  resolved: ResolvedConfiguration,
  options: { readonly all: boolean; readonly onResume?: boolean | undefined },
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: JSON_SCHEMA_ID,
    command: COMMAND,
    all: options.all,
    catalogueSize: CATALOGUE_SIZE,
    profile: resolved.profile ?? null,
    keys: shown.length,
    sources: runRecordSources(shown),
    shadowedEnvironment: shadowedEnvironmentValues(records, {
      onResume: options.onResume,
    }).map((report) => ({
      key: report.key,
      variable: report.variable ?? null,
      shadowedRank: report.shadowedRank,
      byRank: report.byRank,
      by: report.by,
      pinnedOnResume: report.pinnedOnResume,
    })),
    ignored: resolved.trust
      .filter((outcome) => !outcome.accepted)
      .map((outcome) => ({
        key: outcome.key,
        reason: (outcome as { reason: string }).reason,
      })),
  });
}

/** The bytes one run of the command wrote to standard output (§G.5). */
export function outputBytes(result: CommandResult): number {
  return Buffer.byteLength(result.stdout, "utf8");
}
