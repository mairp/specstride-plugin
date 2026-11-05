/**
 * T021 — the environment alias entries and the export of the resolved values
 * (F128-FR-004).
 *
 * F128-FR-004: *The as-is names `SPECSTRIDE_TELEMETRY_ENABLED`,
 * `SPECSTRIDE_LOKI_URL`, `SPECSTRIDE_OTEL_ENABLED` and `SPECSTRIDE_OTEL_URL`
 * MUST stay as aliases of the keys of this feature through the alias table of
 * annex X §X.8, and the as-is name `SPECSTRIDE_OTEL_TRACES` MUST stay as an
 * alias of `telemetry.otel.traces` through §K.8 of feature 110. The name
 * `SPECSTRIDE_OTEL_STATE_DIR` MUST be accepted and MUST have no effect on
 * where spans keep state: that place is the logical name
 * `run:<runId>:span-state`; the launch message says so. The engine MUST hand
 * to every process it starts, and under the `parity` profile, the resolved
 * values under the as-is names `SPECSTRIDE_TELEMETRY`, `SPECSTRIDE_LOKI_URL`,
 * `SPECSTRIDE_OTEL_ENABLED` and `SPECSTRIDE_OTEL_URL`. An inbound
 * distributed-trace id in `SPECSTRIDE_TRACE_ID` MUST be passed through
 * untouched and MUST NOT be invented when absent.*
 *
 * The table mirrors `packages/observability/data/export/config-keys.tsv`
 * (columns `as_is_alias`), which T004 checked against §K.8 of feature 110 and
 * annex X §X.8 of feature 100. The six `RALPH_*` names are aliases at the
 * rank of the environment through §K.8 as well; their time limits are decimal
 * SECONDS that the delivery module converts to milliseconds (T011/T012).
 */
import { isLiteralTrue, withoutTrailingSlash } from "./config.ts";

/** One alias entry: an as-is environment name and the key it resolves. */
export type AliasEntry = {
  /** The as-is variable name, spelled exactly as the baseline read it. */
  readonly variable: string;
  /** The key of this feature the variable resolves; null where it has none. */
  readonly key: string | null;
  /** Where the alias is held: annex X §X.8 of feature 100 or §K.8 of 110. */
  readonly table: "X.8" | "K.8";
  /** What the resolution does with the value. */
  readonly reading: "literal-true" | "address" | "traces" | "no-effect";
};

/**
 * The alias entries of the exporter. `SPECSTRIDE_OTEL_STATE_DIR` is an entry
 * WITH NO KEY: it is accepted and has no effect (CQ-120) — the place of span
 * state is the logical name `run:<runId>:span-state`, which the launch
 * message of `STATE_DIR_LAUNCH_MESSAGE` says.
 */
export const ALIAS_ENTRIES: readonly AliasEntry[] = Object.freeze([
  {
    variable: "SPECSTRIDE_TELEMETRY_ENABLED",
    key: "telemetry.enabled",
    table: "X.8",
    reading: "literal-true",
  },
  { variable: "SPECSTRIDE_LOKI_URL", key: "telemetry.loki.url", table: "X.8", reading: "address" },
  {
    variable: "SPECSTRIDE_OTEL_ENABLED",
    key: "telemetry.otel.enabled",
    table: "X.8",
    reading: "literal-true",
  },
  { variable: "SPECSTRIDE_OTEL_URL", key: "telemetry.otel.url", table: "X.8", reading: "address" },
  {
    variable: "SPECSTRIDE_OTEL_TRACES",
    key: "telemetry.otel.traces",
    table: "K.8",
    reading: "traces",
  },
  { variable: "RALPH_LOKI_URL", key: "telemetry.loki.url", table: "K.8", reading: "address" },
  { variable: "RALPH_OTEL_URL", key: "telemetry.otel.url", table: "K.8", reading: "address" },
  {
    variable: "RALPH_LOKI_TIMEOUT",
    key: "telemetry.loki.timeoutMs",
    table: "K.8",
    reading: "address",
  },
  {
    variable: "RALPH_OTEL_TIMEOUT",
    key: "telemetry.otel.timeoutMs",
    table: "K.8",
    reading: "address",
  },
  {
    variable: "RALPH_LOKI_MAX_BATCH_BYTES",
    key: "telemetry.loki.maxBatchBytes",
    table: "K.8",
    reading: "address",
  },
  {
    variable: "RALPH_OTEL_MAX_BATCH_BYTES",
    key: "telemetry.otel.maxBatchBytes",
    table: "K.8",
    reading: "address",
  },
  { variable: "SPECSTRIDE_OTEL_STATE_DIR", key: null, table: "X.8", reading: "no-effect" },
]);

/** The one accepted variable with no effect (CQ-120). */
export const NO_EFFECT_VARIABLES: readonly string[] = Object.freeze(["SPECSTRIDE_OTEL_STATE_DIR"]);

/** The launch message for the accepted, effectless variable (F128-FR-004). */
export const STATE_DIR_LAUNCH_MESSAGE =
  "SPECSTRIDE_OTEL_STATE_DIR is accepted and has no effect: span state lives at the logical name run:<runId>:span-state" as const;

/**
 * Resolve one alias entry against the environment record. The two enabled
 * switches honour ONLY the literal `true` (F128-FR-001); an address is
 * normalised without its trailing slash (F128-FR-002). An unset variable
 * resolves to `undefined`, never to a default — the default lives in the key.
 */
export function resolveAlias(
  entry: AliasEntry,
  environment: Readonly<Record<string, string | undefined>>,
): string | boolean | undefined {
  const raw = environment[entry.variable];
  if (raw === undefined) return undefined;
  if (entry.reading === "no-effect") return undefined;
  if (entry.reading === "literal-true" || entry.reading === "traces") return isLiteralTrue(raw);
  return withoutTrailingSlash(raw);
}

/** Resolve every alias of the table that the environment sets. */
export function resolveAliases(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const entry of ALIAS_ENTRIES) {
    if (entry.key === null) continue;
    const value = resolveAlias(entry, environment);
    if (value !== undefined) out[entry.key] = value;
  }
  return out;
}

/** The as-is name of the on/off value the baseline handed its children. */
export function asIsSwitch(enabled: boolean): "1" | "0" {
  return enabled ? "1" : "0";
}

/**
 * The resolved values handed to every process the engine starts (F128-FR-004,
 * under the `parity` profile): the as-is names carry the resolved values, the
 * defaults included, so a child of a default run reads the same configuration
 * the run itself reads.
 */
export function resolvedChildEnvironment(
  config: Readonly<{
    loki: { enabled: boolean; url: string };
    otel: { enabled: boolean; url: string };
  }>,
): Record<string, string> {
  return {
    SPECSTRIDE_TELEMETRY: asIsSwitch(config.loki.enabled),
    SPECSTRIDE_LOKI_URL: config.loki.url,
    SPECSTRIDE_OTEL_ENABLED: asIsSwitch(config.otel.enabled),
    SPECSTRIDE_OTEL_URL: config.otel.url,
  };
}

/**
 * An inbound distributed-trace id is passed through UNTOUCHED and is NEVER
 * invented when absent: absent stays absent (F128-FR-004; the exporter's own
 * id rule of F128-FR-017 applies only where the engine starts the trace).
 */
export function inboundTraceId(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const raw = environment["SPECSTRIDE_TRACE_ID"];
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}
