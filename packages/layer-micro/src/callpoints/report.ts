/**
 * T111 — the call point `report` (F115-FR-038): the `[LOOP]` line the engine
 * prints before the digest, in default output only, never under the `parity`
 * profile (annex G §G.3; `contracts/loop-line.md`).
 *
 * With the layer on the line carries the fourteen keys in this order, pairs
 * `key=value` separated by one space: `strategy`, `level`, `containment`,
 * `protection`, `units`, `pass`, `fail`, `unchecked`, `tainted`, `cycles`,
 * `disengaged`, `escalations`, `failfast-stops`, `fallback`. `fallback` is
 * `none` or a fallback reason; `protection` is `prevent` or `detect`
 * followed by `,basic` when a detected toolchain has no profile (CQ-082).
 * With the layer off by rule the line reads
 * `strategy=classic reason=<fallback reason>`. The status line carries the
 * strategy. Neither line exists under `parity`.
 *
 * Purity: imports `@specstride/contracts` and the layer only; no `node:fs`,
 * no process, no printing — the engine prints what the builder returns.
 */
import { isFallbackReason, type FallbackReason } from "../strategy/fallback.ts";

/** The keys of the `[LOOP]` line, in the order of F115-FR-038. */
export const LOOP_LINE_KEYS = [
  "strategy",
  "level",
  "containment",
  "protection",
  "units",
  "pass",
  "fail",
  "unchecked",
  "tainted",
  "cycles",
  "disengaged",
  "escalations",
  "failfast-stops",
  "fallback",
] as const;
export type LoopLineKey = (typeof LOOP_LINE_KEYS)[number];

/** The containment levels the layer can report (the level in force). */
export const CONTAINMENT_LEVELS = ["C0", "C1", "C2", "C3"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

/** The counts the engine holds for the run, as the `[LOOP]` line reports them. */
export type LoopReport = {
  readonly containment: ContainmentLevel;
  /** The run record field `containment` (annex E §E.2): `prevent` or `detect`. */
  readonly protection: "prevent" | "detect";
  /** True when a detected toolchain has no profile (CQ-082): `,basic` follows. */
  readonly protectionBasic?: boolean;
  readonly units: number;
  readonly pass: number;
  readonly fail: number;
  readonly unchecked: number;
  readonly tainted: number;
  readonly cycles: number;
  readonly disengaged: number;
  readonly escalations: number;
  /** Jobs stopped by the first-failure predicate; the count is given by the engine. */
  readonly failfastStops: number;
  /** `none`, or the fallback reason of a phase attempt that occurred last. */
  readonly fallback: "none" | FallbackReason;
};

function pair(key: LoopLineKey, value: string | number | boolean): string {
  return `${key}=${String(value)}`;
}

/**
 * The `[LOOP]` line with the layer on, or `undefined` under the `parity`
 * profile (F115-FR-038: never printed there). The keys are emitted in the
 * order of `LOOP_LINE_KEYS` — a key missed or reordered is a defect.
 */
export function renderLoopLine(
  report: LoopReport,
  options: { readonly profile?: string; readonly strategy?: string; readonly level?: string } = {},
): string | undefined {
  if (options.profile === "parity") return undefined;
  const strategy = options.strategy ?? "micro";
  const level = options.level ?? "L1";
  if (!(CONTAINMENT_LEVELS as readonly string[]).includes(report.containment)) {
    throw new Error(`not a containment level: ${report.containment}`);
  }
  const protection = report.protectionBasic ? `${report.protection},basic` : report.protection;
  const fallback = report.fallback;
  if (fallback !== "none" && !isFallbackReason(fallback)) {
    throw new Error(`not a fallback reason of row 59: ${String(fallback)}`);
  }
  const values: Record<LoopLineKey, string | number> = {
    strategy,
    level,
    containment: report.containment,
    protection,
    units: report.units,
    pass: report.pass,
    fail: report.fail,
    unchecked: report.unchecked,
    tainted: report.tainted,
    cycles: report.cycles,
    disengaged: report.disengaged,
    escalations: report.escalations,
    "failfast-stops": report.failfastStops,
    fallback,
  };
  return `[LOOP] ${LOOP_LINE_KEYS.map((key) => pair(key, values[key])).join(" ")}`;
}

/**
 * The `[LOOP]` line with the layer off by rule:
 * `strategy=classic reason=<fallback reason>`. Also `undefined` under parity.
 */
export function renderClassicLoopLine(
  reason: FallbackReason,
  options: { readonly profile?: string } = {},
): string | undefined {
  if (options.profile === "parity") return undefined;
  if (!isFallbackReason(reason)) {
    throw new Error(`not a fallback reason of row 59: ${String(reason)}`);
  }
  return `strategy=classic reason=${reason}`;
}

/** The status line carries the strategy (F115-FR-038); `undefined` under parity. */
export function renderStatusLine(
  strategy: "classic" | "micro",
  options: { readonly profile?: string } = {},
): string | undefined {
  if (options.profile === "parity") return undefined;
  return `strategy=${strategy}`;
}

/**
 * The report of one call of the `report` call point: the line the engine
 * prints (or `none` of the loop-layer frame when nothing is printed, as
 * under the `parity` profile, or when the layer is not the strategy in
 * force). This is the value the frame's `report` point carries back.
 */
export type ReportResult =
  | { readonly kind: "loop-line"; readonly line: string }
  | { readonly kind: "classic-line"; readonly line: string }
  | { readonly kind: "none" };

/** Build the report result for one call of the point. */
export function buildReport(input: {
  readonly engaged: boolean;
  readonly strategy: "classic" | "micro";
  readonly profile?: string;
  /** Set with the counts when the layer is engaged. */
  readonly report?: LoopReport;
  /** The fallback reason, when the layer is off by rule. */
  readonly fallbackReason?: FallbackReason;
}): ReportResult {
  if (input.profile === "parity") return { kind: "none" };
  if (input.engaged && input.strategy === "micro" && input.report) {
    const line = renderLoopLine(input.report, { profile: input.profile });
    return line === undefined ? { kind: "none" } : { kind: "loop-line", line };
  }
  if (input.fallbackReason) {
    const line = renderClassicLoopLine(input.fallbackReason, {
      profile: input.profile,
    });
    return line === undefined ? { kind: "none" } : { kind: "classic-line", line };
  }
  return { kind: "none" };
}
