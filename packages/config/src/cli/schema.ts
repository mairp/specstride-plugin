/**
 * T018 — `config schema` (F110-FR-012).
 *
 * F110-FR-012: `config schema` prints the schema of this catalogue, with the
 * version of the schema, in a machine-readable form and in a form for people,
 * within the token budget of annex G §G.5. Its exit code is 0, and 3 for a usage
 * error.
 *
 * Both forms are therefore **terse by default** (`plan.md`, Constitution row
 * XIX): the version of the schema, how many keys the catalogue holds, and one
 * line per namespace with its count and the features that own it. The whole
 * catalogue — 259 keys with every column — is behind `--all`, which a person or a
 * tool asks for and a host skill does not, and which `budget.ts` therefore
 * measures without holding it to the §G.5 share. `--key <path>` prints the row of
 * one key in full, which is what a reader of one message needs.
 */
import { Buffer } from "node:buffer";

import {
  CATALOGUE,
  CATALOGUE_NAMESPACES,
  CATALOGUE_SIZE,
  matchCatalogueKey,
} from "../schema/catalogue.ts";
import { CONFIG_SCHEMA_ID, CONFIG_SCHEMA_MAJOR } from "../load/files.ts";
import { PROFILE_NAME } from "../schema/profile.ts";
import type { KeyEntry } from "../schema/types.ts";
import { EXIT_INVALID_OR_USAGE, EXIT_OK, type CommandResult } from "./show.ts";

export { EXIT_OK, EXIT_INVALID_OR_USAGE };

/** The name of the command, as annex G §G.1 spells it. */
export const COMMAND = "config schema" as const;

/** The label of the product lines of this command (annex G §G.3). */
export const LINE_LABEL = "SPECSTRIDE-CONFIG-SCHEMA" as const;

/**
 * The schema id of the `--json` record, of the internal form: the table of
 * §B.20 holds no row for the output of this command (§B.20, the note). Task T043
 * reports the row to the orchestrator.
 */
export const JSON_SCHEMA_ID = "urn:specstride:schema:internal:110:config-schema/1" as const;

/** The version of the schema the command prints (F110-FR-012). */
export const SCHEMA_VERSION = `${CONFIG_SCHEMA_ID}` as const;

/** The flags of `config schema`. */
export const FLAGS = ["--all", "--json", "--key"] as const;

/** What the command was asked to do. */
export interface SchemaFlags {
  /** `--all`: every key of the catalogue with every column. */
  readonly all: boolean;
  /** `--json`: the machine-readable form of F110-FR-012 and F100-FR-172. */
  readonly json: boolean;
  /** `--key <path>`: the row of one key. */
  readonly key?: string | undefined;
  readonly usageError?: string | undefined;
}

/** Read the argument list of `config schema` (exit 3 on a usage error). */
export function parseSchemaFlags(argv: readonly string[]): SchemaFlags {
  let all = false;
  let json = false;
  let key: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;
    if (argument === "--all") {
      all = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--key" || argument.startsWith("--key=")) {
      const value = argument.startsWith("--key=")
        ? argument.slice("--key=".length)
        : argv[(i += 1)];
      if (value === undefined || value === "") {
        return Object.freeze({
          all,
          json,
          usageError: `${COMMAND}: \`--key\` needs the path of a key`,
        });
      }
      key = value;
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
  return Object.freeze({ all, json, ...(key === undefined ? {} : { key }) });
}

/** One namespace of the schema: the first segment of a key, with its counts. */
export interface NamespaceSummary {
  readonly namespace: string;
  readonly keys: number;
  /** How many of them are template keys (`<N>`, `<id>`, `<role>`). */
  readonly templates: number;
  /** The features that own keys of the namespace, sorted. */
  readonly owners: readonly string[];
}

/** The namespaces of the schema, in the order of the tables of §K.3 to §K.6b. */
export function namespaceSummaries(): readonly NamespaceSummary[] {
  return Object.freeze(
    CATALOGUE_NAMESPACES.map((namespace) => {
      const keys = CATALOGUE.filter((e) => (e.key.split(".")[0] ?? e.key) === namespace);
      return Object.freeze({
        namespace,
        keys: keys.length,
        templates: keys.filter((e) => e.isTemplate).length,
        owners: Object.freeze([...new Set(keys.flatMap((e) => [...e.owners]))].sort()),
      });
    }),
  );
}

/** The row of one key as the machine-readable form carries it. */
export function rowOf(entry: KeyEntry): Readonly<Record<string, unknown>> {
  return Object.freeze({
    key: entry.key,
    type: entry.cells.typeAndRange,
    default: entry.cells.default,
    underParity: entry.cells.valueUnderParity,
    layers: entry.cells.layers,
    class: entry.cells.trustClass,
    trust: entry.trust,
    snapshot: entry.snapshot,
    owners: entry.owners,
    profileRows: entry.profileRows,
    template: entry.isTemplate,
  });
}

/** The row of one key as the form for people prints it. */
export function textRowOf(entry: KeyEntry): readonly string[] {
  return Object.freeze([
    `key: ${entry.key}`,
    `  type: ${entry.cells.typeAndRange}`,
    `  default: ${entry.cells.default}`,
    `  under \`${PROFILE_NAME}\`: ${entry.cells.valueUnderParity}`,
    `  layers: ${entry.cells.layers}`,
    `  class: ${entry.cells.trustClass}`,
    `  owner: ${entry.owners.join(", ")}`,
  ]);
}

/** The terse summary both forms print by default (F110-FR-012). */
export interface SchemaSummary {
  readonly schema: string;
  readonly major: number;
  readonly keys: number;
  readonly namespaces: readonly NamespaceSummary[];
}

/** The summary of the schema, which is what `config schema` prints by default. */
export function schemaSummary(): SchemaSummary {
  return Object.freeze({
    schema: SCHEMA_VERSION,
    major: CONFIG_SCHEMA_MAJOR,
    keys: CATALOGUE_SIZE,
    namespaces: namespaceSummaries(),
  });
}

/** F110-FR-012 — run `config schema`. */
export function runConfigSchema(argv: readonly string[] = []): CommandResult {
  const flags = parseSchemaFlags(argv);
  if (flags.usageError !== undefined) {
    return Object.freeze({
      code: EXIT_INVALID_OR_USAGE,
      stdout: "",
      stderr: `${flags.usageError}\n`,
    });
  }

  if (flags.key !== undefined) {
    const entry = matchCatalogueKey(flags.key)?.entry;
    if (entry === undefined) {
      return Object.freeze({
        code: EXIT_INVALID_OR_USAGE,
        stdout: "",
        stderr: `${COMMAND}: \`${flags.key}\` is not a key of the schema\n`,
      });
    }
    const stdout = flags.json
      ? `${JSON.stringify({ schema: JSON_SCHEMA_ID, version: SCHEMA_VERSION, keys: [rowOf(entry)] })}\n`
      : `${[`${SCHEMA_VERSION}`, ...textRowOf(entry)].join("\n")}\n`;
    return Object.freeze({ code: EXIT_OK, stdout, stderr: "" });
  }

  const summary = schemaSummary();
  if (flags.json) {
    const record = flags.all
      ? {
          schema: JSON_SCHEMA_ID,
          version: summary.schema,
          major: summary.major,
          keys: summary.keys,
          catalogue: CATALOGUE.map(rowOf),
        }
      : {
          schema: JSON_SCHEMA_ID,
          version: summary.schema,
          major: summary.major,
          keys: summary.keys,
          namespaces: summary.namespaces,
        };
    return Object.freeze({ code: EXIT_OK, stdout: `${JSON.stringify(record)}\n`, stderr: "" });
  }

  const lines: string[] = [
    `[${LINE_LABEL}] schema=${summary.schema} major=${summary.major} keys=${summary.keys}`,
  ];
  if (flags.all) {
    for (const entry of CATALOGUE) lines.push(...textRowOf(entry));
  } else {
    for (const ns of summary.namespaces) {
      lines.push(
        `  ${ns.namespace}: ${ns.keys} key${ns.keys === 1 ? "" : "s"}` +
          (ns.templates === 0 ? "" : `, ${ns.templates} template`) +
          ` (owner ${ns.owners.join(", ")})`,
      );
    }
    lines.push(`  \`--all\` prints every key; \`--key <path>\` prints one`);
  }
  return Object.freeze({ code: EXIT_OK, stdout: `${lines.join("\n")}\n`, stderr: "" });
}

/** The bytes one run of the command wrote to standard output (§G.5). */
export function outputBytes(result: CommandResult): number {
  return Buffer.byteLength(result.stdout, "utf8");
}
