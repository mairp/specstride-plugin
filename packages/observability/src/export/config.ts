/**
 * T017 / T019 / T023 — the enablement and the addresses of the two sinks
 * (F128-FR-001, F128-FR-002, F128-FR-003, F128-FR-005).
 *
 * F128-FR-001: *Loki shipping and OTLP shipping MUST both be off by default.
 * A run with default configuration MUST register no exporter, open no network
 * connection for telemetry and write no file of a sink. Each sink MUST be
 * switched on by its own switch, and only the literal value `true` MUST switch
 * the Loki sink on through the as-is variable. The OTLP exporter, its metrics
 * and its traces MUST not be started by the Loki switch, and the Loki sink
 * MUST not be started by the OTLP switch.*
 *
 * F128-FR-002: *The default address of the Loki sink MUST be
 * `http://localhost:3100` and the default address of the OTLP exporter MUST be
 * `http://localhost:4318`, each used when the sink is on and no address is
 * given. A given address MUST be written without a trailing slash.*
 *
 * F128-FR-003 (T019): the four flags `--telemetry`, `--loki-url`, `--otel`
 * and `--otel-url` are SHORT FLAGS OF FEATURE 110 (proposal U1 of
 * `analyze-report.md`): the flag layer of feature 110 maps each to its key at
 * rank 2, and THIS PACKAGE PARSES NO ARGUMENT LIST — the core never imports
 * it, so a parser here could never be called. Everything this module reads is
 * the resolved key record the core hands it; the flags reach the exporter only
 * as the resolved keys `telemetry.enabled`, `telemetry.loki.url`,
 * `telemetry.otel.enabled` and `telemetry.otel.url`.
 *
 * F128-FR-005 (T023): the combination rule of the pass-loop flags
 * (`-j` with a URL flag) is a FLAG RULE of feature 110, fixed there at rank 2;
 * this module applies no combination rule of its own. It reads the resolved
 * keys and nothing else — which the parity test PT-128-C-058 proves from the
 * resolved-key records the flag layer produces.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The default address of the Loki sink (F128-FR-002). */
export const DEFAULT_LOKI_URL = "http://localhost:3100" as const;

/** The default address of the OTLP exporter (F128-FR-002). */
export const DEFAULT_OTEL_URL = "http://localhost:4318" as const;

/** The key that switches the Loki sink on (its own switch; F128-FR-001). */
export const LOKI_ENABLED_KEY = "telemetry.enabled" as const;

/** The key that switches the OTLP exporter on (its own switch; F128-FR-001). */
export const OTEL_ENABLED_KEY = "telemetry.otel.enabled" as const;

/** The key of the Loki base address (F128-FR-002). */
export const LOKI_URL_KEY = "telemetry.loki.url" as const;

/** The key of the OTLP base address (F128-FR-002). */
export const OTEL_URL_KEY = "telemetry.otel.url" as const;

/** The key of the traces switch (row 99 of annex X §X.7; on by default). */
export const TRACES_KEY = "telemetry.otel.traces" as const;

/**
 * Only the literal `true` switches a sink on (F128-FR-001): the resolved
 * boolean, or the as-is variable's exact spelling `true`. Every other value —
 * `1`, `yes`, `TRUE`, `on` — leaves the sink off.
 */
export function isLiteralTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/** An address is stored without a trailing slash (F128-FR-002). */
export function withoutTrailingSlash(address: string): string {
  return address.replace(/\/+$/, "");
}

/**
 * The resolved configuration of the two sinks, taken from the resolved keys
 * ONLY. Nothing here reads the argument list, the environment or a file of the
 * consumer: the core resolves the keys (flags at rank 2, the environment at
 * rank 4) and hands the record in.
 */
export type ExportConfig = {
  /** The Loki sink, with its own switch and its own address. */
  readonly loki: { readonly enabled: boolean; readonly url: string };
  /** The OTLP exporter, with its own switch and its own address. */
  readonly otel: { readonly enabled: boolean; readonly url: string };
  /** Traces are on by default and switched by their own key (row 99). */
  readonly traces: boolean;
  /** True when neither sink is on: a default run (F128-FR-001). */
  readonly silent: boolean;
};

/**
 * Read the enablement and the addresses out of the resolved keys. The two
 * switches are INDEPENDENT: `telemetry.enabled` never starts the OTLP
 * exporter and `telemetry.otel.enabled` never starts the Loki sink, and no
 * combination of the values is computed here (F128-FR-005 is a flag rule of
 * feature 110, not a rule of this module).
 */
export function resolveExportConfig(resolved: Readonly<Record<string, unknown>>): ExportConfig {
  const lokiEnabled = isLiteralTrue(resolved[LOKI_ENABLED_KEY]);
  const otelEnabled = isLiteralTrue(resolved[OTEL_ENABLED_KEY]);
  const lokiUrl = resolved[LOKI_URL_KEY];
  const otelUrl = resolved[OTEL_URL_KEY];
  return Object.freeze({
    loki: Object.freeze({
      enabled: lokiEnabled,
      url: withoutTrailingSlash(
        typeof lokiUrl === "string" && lokiUrl !== "" ? lokiUrl : DEFAULT_LOKI_URL,
      ),
    }),
    otel: Object.freeze({
      enabled: otelEnabled,
      url: withoutTrailingSlash(
        typeof otelUrl === "string" && otelUrl !== "" ? otelUrl : DEFAULT_OTEL_URL,
      ),
    }),
    traces: resolved[TRACES_KEY] === undefined ? true : isLiteralTrue(resolved[TRACES_KEY]),
    silent: !lokiEnabled && !otelEnabled,
  });
}

/**
 * The exporter registers NO sink for a silent configuration: the caller hands
 * the resolved config here and gets the labels of the sinks to register. A
 * default run returns an empty list — no exporter, no connection, no file of
 * a sink (F128-FR-001, CT-128-22).
 */
export function enabledSinkLabels(config: ExportConfig): readonly string[] {
  const out: string[] = [];
  if (config.loki.enabled) out.push("loki");
  if (config.otel.enabled) out.push("otel");
  return Object.freeze(out);
}

/** The path of the copied key contract this module documents. */
export function configKeysPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../data/export/config-keys.tsv");
}

/**
 * The default of one key, read from the copied contract (the defaults of
 * F128-FR-002 are rows 97 and 98 of annex X §X.7 through that file). The
 * module reads the file only for this lookup — never at resolve time.
 */
export function defaultOfKey(key: string): string | undefined {
  const rows = readFileSync(configKeysPath(), "utf8").split("\n").slice(1);
  for (const row of rows) {
    if (row.trim() === "") continue;
    const cells = row.split("\t");
    if (cells[0] === key) return cells[1];
  }
  return undefined;
}
