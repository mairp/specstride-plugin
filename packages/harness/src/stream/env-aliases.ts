/**
 * T035 — the environment alias table of the stream tap (F126-FR-011; origins
 * C-147 B-2060…B-2076, C-148 B-2077…B-2081, C-052 B-0495…B-0535).
 *
 * The as-is variable names of the tap stay as aliases of keys through the
 * alias table of annex X §X.8: the table of `@specstride/contracts` holds the
 * rows (`SPECSTRIDE_AGENT_STREAM`, `SPECSTRIDE_AGENT_TAP`, `SPECSTRIDE_EVENTS`,
 * `SPECSTRIDE_RUN_ID`, `SPECSTRIDE_TASK`, `SPECSTRIDE_FEATURE`,
 * `SPECSTRIDE_BACKEND_LABEL`); the two names the tap adds on the same pattern
 * are `SPECSTRIDE_ROLE` and `SPECSTRIDE_INVOCATION_ID`. An unknown name
 * resolves to nothing. The six names `SPECSTRIDE_EVENTS`, `SPECSTRIDE_RUN_ID`,
 * `SPECSTRIDE_TASK`, `SPECSTRIDE_FEATURE`, `SPECSTRIDE_BACKEND_LABEL` and
 * `SPECSTRIDE_ROLE` are exported to the processes of a pass only while
 * `compat.legacyEvents` is on.
 */
import { environmentAliases } from "@specstride/contracts/profile/layout-old-side";

/**
 * One row of the alias table as the tap reads it: the as-is variable name and
 * the key it is an alias of, or the empty string where the table states in
 * words that the name maps to no key (the event context of the run).
 */
export type TapAliasRow = {
  readonly asIsVariable: string;
  readonly key: string;
};

/** The alias rows of the tap, in the order F126-FR-011 names them. */
export const STREAM_TAP_ALIASES: readonly TapAliasRow[] = Object.freeze([
  { asIsVariable: "SPECSTRIDE_AGENT_STREAM", key: "stream.tap" },
  { asIsVariable: "SPECSTRIDE_EVENTS", key: "" },
  { asIsVariable: "SPECSTRIDE_BACKEND_LABEL", key: "harnesses.claude.label" },
  { asIsVariable: "SPECSTRIDE_TASK", key: "" },
  { asIsVariable: "SPECSTRIDE_ROLE", key: "role" },
  { asIsVariable: "SPECSTRIDE_INVOCATION_ID", key: "invocation.idBase" },
  { asIsVariable: "SPECSTRIDE_AGENT_TAP", key: "stream.tapExecutable" },
  { asIsVariable: "SPECSTRIDE_RUN_ID", key: "" },
  { asIsVariable: "SPECSTRIDE_FEATURE", key: "spec.feature" },
] as const);

/** The key one as-is variable name is an alias of; empty where it maps to no key. */
export function keyOfAsIsVariable(asIsVariable: string): string | null {
  const row = STREAM_TAP_ALIASES.find((r) => r.asIsVariable === asIsVariable);
  return row ? row.key : null;
}

/**
 * The value of one as-is variable through the alias table. The row must also
 * be held by the table of annex X §X.8 in `@specstride/contracts` — the
 * single source of the alias names — and the names of the rows that table
 * states in words are matched here. An unknown name resolves to nothing.
 */
export function valueThroughAliasTable(
  env: Readonly<Record<string, string | undefined>>,
  asIsVariable: string,
): string | undefined {
  if (keyOfAsIsVariable(asIsVariable) === null) return undefined;
  if (!aliasTableHolds(asIsVariable)) return undefined;
  return env[asIsVariable];
}

/**
 * True where the variable is held as an alias: either by the table of annex
 * X §X.8 (the data of `@specstride/contracts`) or by the rows of the tap
 * itself, which bind the two names that table states only in the pass
 * (`SPECSTRIDE_ROLE`, `SPECSTRIDE_INVOCATION_ID`).
 */
export function aliasTableHolds(asIsVariable: string): boolean {
  return (
    environmentAliases.some((row) => row.asIsVariables.includes(asIsVariable)) ||
    STREAM_TAP_ALIASES.some((row) => row.asIsVariable === asIsVariable)
  );
}

/** True where the table of annex X §X.8 in `@specstride/contracts` holds the name. */
export function contractsTableHolds(asIsVariable: string): boolean {
  return environmentAliases.some((row) => row.asIsVariables.includes(asIsVariable));
}

/**
 * The defaults the tap reads from the environment through the alias table
 * (B-2060…B-2081, B-0495, B-0535): each flag default is the variable of its
 * row. `SPECSTRIDE_AGENT_STREAM` defaults to true; `false` restores raw
 * output. The role of the pass defaults to `proposer` (B-0502).
 */
export type TapEnvDefaults = {
  readonly events: string | null;
  readonly runId: string | null;
  readonly task: string | null;
  readonly feature: string | null;
  readonly backend: string | null;
  readonly role: string | null;
  readonly invocationId: string | null;
  readonly tapExecutable: string | null;
  /** Default true; false restores raw output (B-0495). */
  readonly streamOn: boolean;
};

/** The tap defaults of one environment, read only through the alias table. */
export function tapDefaultsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): TapEnvDefaults {
  const read = (name: string): string | null => {
    const value = valueThroughAliasTable(env, name);
    return value !== undefined && value.length > 0 ? value : null;
  };
  const rawStream = valueThroughAliasTable(env, "SPECSTRIDE_AGENT_STREAM");
  return {
    events: read("SPECSTRIDE_EVENTS"),
    runId: read("SPECSTRIDE_RUN_ID"),
    task: read("SPECSTRIDE_TASK"),
    feature: read("SPECSTRIDE_FEATURE"),
    backend: read("SPECSTRIDE_BACKEND_LABEL"),
    role: read("SPECSTRIDE_ROLE") ?? "proposer",
    invocationId: read("SPECSTRIDE_INVOCATION_ID"),
    tapExecutable: read("SPECSTRIDE_AGENT_TAP"),
    streamOn: rawStream === undefined ? true : rawStream !== "false",
  };
}

/** The six names exported to the processes of a pass (F126-FR-011, C-052). */
export const LEGACY_EXPORT_NAMES: readonly string[] = Object.freeze([
  "SPECSTRIDE_EVENTS",
  "SPECSTRIDE_RUN_ID",
  "SPECSTRIDE_TASK",
  "SPECSTRIDE_FEATURE",
  "SPECSTRIDE_BACKEND_LABEL",
  "SPECSTRIDE_ROLE",
] as const);

/**
 * What the pass exports to its child processes: the six names only while
 * `compat.legacyEvents` is on; nothing of them otherwise (F126-FR-011).
 */
export function legacyExportsFor(
  env: Readonly<Record<string, string | undefined>>,
  legacyEvents: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!legacyEvents) return out;
  for (const name of LEGACY_EXPORT_NAMES) {
    const value = valueThroughAliasTable(env, name);
    if (value !== undefined && value.length > 0) out[name] = value;
  }
  return out;
}
