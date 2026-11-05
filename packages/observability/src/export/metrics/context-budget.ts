/**
 * T076 — the context-budget gauges (F128-FR-034; CQ-123).
 *
 * F128-FR-034: *The exporter MUST offer the figures of the context-budget
 * report of the build (per host skill: measured bytes, tokens by the pinned
 * ratio, and the limit) as gauge metrics `specstride.context.bytes`,
 * `specstride.context.tokens` and `specstride.context.limit` with the
 * attribute `skill`, once at the start of a run, when the OTLP exporter is on
 * and the report is present. When the report is absent nothing MUST be
 * emitted and no warning MUST be given.*
 *
 * The report is the file of the logical name `package:context-budget`
 * (annex B §B.5), `<package>/context-budget.json`. The reading is
 * best-effort: an absent or unparsable report emits NOTHING and raises
 * NOTHING — the warning channel is never touched (F128-FR-034).
 */
import { readFileSync } from "node:fs";

/** The three gauge names, in the order of the requirement. */
export const CONTEXT_BYTES_METRIC = "specstride.context.bytes" as const;
export const CONTEXT_TOKENS_METRIC = "specstride.context.tokens" as const;
export const CONTEXT_LIMIT_METRIC = "specstride.context.limit" as const;

/** The one attribute every context gauge carries. */
export const CONTEXT_SKILL_ATTRIBUTE = "skill" as const;

/** The unit of the bytes gauge (`metrics.tsv`, row `specstride.context.bytes`). */
export const CONTEXT_BYTES_UNIT = "By" as const;

/** One gauge datum ready for the metric recorder. */
export type ContextBudgetGauge = {
  readonly name:
    typeof CONTEXT_BYTES_METRIC | typeof CONTEXT_TOKENS_METRIC | typeof CONTEXT_LIMIT_METRIC;
  readonly value: number;
  readonly attrs: Readonly<Record<typeof CONTEXT_SKILL_ATTRIBUTE, string>>;
};

/**
 * One skill entry of the report, read tolerantly: the measured bytes may be
 * named `bytes` or `measuredBytes`, the tokens `tokens` or `estimatedTokens`
 * (tokens by the pinned ratio), the limit `limit` or `limitBytes`.
 */
export type ContextBudgetSkill = {
  readonly skill: string;
  readonly bytes?: number;
  readonly tokens?: number;
  readonly limit?: number;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read one skill entry of the report. `null` when it holds no usable figure. */
function skillEntryOf(name: string, entry: unknown): ContextBudgetSkill | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const bytes = finiteNumber(record["bytes"]) ?? finiteNumber(record["measuredBytes"]);
  const tokens = finiteNumber(record["tokens"]) ?? finiteNumber(record["estimatedTokens"]);
  const limit = finiteNumber(record["limit"]) ?? finiteNumber(record["limitBytes"]);
  if (bytes === undefined && tokens === undefined && limit === undefined) return null;
  return { skill: name, bytes, tokens, limit };
}

/**
 * The skill entries of one parsed report. The report holds its skills either
 * as an object `{ skills: { <name>: {...} } }` or as an array
 * `{ skills: [{ skill: <name>, ... }] }`; a top-level array of entries is
 * accepted too.
 */
export function skillsOfReport(report: unknown): readonly ContextBudgetSkill[] {
  let skills: unknown = report;
  if (typeof report === "object" && report !== null && !Array.isArray(report)) {
    skills = (report as Record<string, unknown>)["skills"];
  }
  const out: ContextBudgetSkill[] = [];
  if (Array.isArray(skills)) {
    for (const entry of skills) {
      if (typeof entry === "object" && entry !== null) {
        const name = (entry as Record<string, unknown>)["skill"];
        const read = skillEntryOf(typeof name === "string" ? name : "", entry);
        if (read) out.push(read);
      }
    }
    return out;
  }
  if (typeof skills === "object" && skills !== null) {
    for (const [name, entry] of Object.entries(skills as Record<string, unknown>)) {
      const read = skillEntryOf(name, entry);
      if (read) out.push(read);
    }
  }
  return out;
}

/**
 * The gauges of one report: three figures per skill, in the order bytes,
 * tokens, limit. A figure the report does not hold contributes no gauge.
 * A `null`, empty or unparsable report answers an EMPTY list: nothing is
 * emitted and no warning is given (F128-FR-034).
 */
export function contextBudgetGaugesOf(
  reportText: string | null | undefined,
): readonly ContextBudgetGauge[] {
  if (reportText === null || reportText === undefined) return [];
  const trimmed = reportText.trim();
  if (trimmed === "") return [];
  let report: unknown;
  try {
    report = JSON.parse(trimmed);
  } catch {
    return []; // an unparsable report is treated as absent: nothing, no warning
  }
  const gauges: ContextBudgetGauge[] = [];
  for (const entry of skillsOfReport(report)) {
    if (entry.bytes !== undefined) {
      gauges.push({
        name: CONTEXT_BYTES_METRIC,
        value: entry.bytes,
        attrs: { skill: entry.skill },
      });
    }
    if (entry.tokens !== undefined) {
      gauges.push({
        name: CONTEXT_TOKENS_METRIC,
        value: entry.tokens,
        attrs: { skill: entry.skill },
      });
    }
    if (entry.limit !== undefined) {
      gauges.push({
        name: CONTEXT_LIMIT_METRIC,
        value: entry.limit,
        attrs: { skill: entry.skill },
      });
    }
  }
  return gauges;
}

/**
 * Record the gauges into the metric recorder of the exporter start: once at
 * the start of a run, when the exporter is on and the report is present
 * (F128-FR-034). The recorder is called only with the gauges the report
 * yielded; an empty list makes no call at all.
 */
export function recordContextBudgetGauges(
  recorder: {
    record(datum: { name: string; value: number; attrs?: Record<string, string> }): void;
  },
  gauges: readonly ContextBudgetGauge[],
): number {
  let recorded = 0;
  for (const gauge of gauges) {
    recorder.record({ name: gauge.name, value: gauge.value, attrs: { ...gauge.attrs } });
    recorded += 1;
  }
  return recorded;
}

/**
 * Read the report of the logical name `package:context-budget`
 * (`<package>/context-budget.json`). A missing or unreadable file answers
 * `null` — the absent case of F128-FR-034 — and raises nothing.
 */
export function readContextBudgetReport(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
