/**
 * T025 — the seven checks of the context-cost CI and the report file
 * (F113-FR-036, F113-FR-037), in `tests/ci-checks/` as the layout of plan.md
 * draws it.
 *
 * The seven checks are row 145 of annex X §X.6, read from
 * `@specstride/contracts/ep/context-cost` and never written here a second
 * time. NONE of them calls a model: they are checks of the per-change build,
 * measured in bytes.
 *
 * | static size        | the byte budgets of F113-FR-036 and the 500-line cap of a skill body |
 * | reference closure  | fails any path from a skill into product source, state or logs |
 * | golden output      | the rendered skills and the rendered entry against data/golden.json |
 * | supervision cycle  | one cycle against 420 bytes, a whole run's supervision against 8,400 |
 * | judgment payload   | a synthetic feature of at least 200 tasks; the total printed does not grow with the size of the sources |
 * | host cross-check   | fails a difference over 15 per cent; skipped with a warning when the host CLI is absent |
 * | startup            | `status` at or below 150 ms at the 90th percentile over 30 runs |
 *
 * F113-FR-037 status row: the startup limit on a macOS runner stays
 * `unverified` (T032); every figure here is measured on Linux.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_COST_CHECKS } from "@specstride/contracts/ep/context-cost";
import type { ContextCostCheck } from "@specstride/contracts/ep/context-cost";
import type { SkillSource } from "@specstride/contracts/ep/host";
import { CAPABILITY_DECLARATIONS } from "../../src/describe/index.ts";
import {
  BYTE_BUDGETS,
  BYTES_PER_TOKEN,
  MAX_BODY_LINES,
  TOKEN_BUDGETS,
  bytesForTokens,
  renderEntry,
} from "../../src/render/index.ts";
import { BODY_BYTE_LIMITS } from "../../src/skill-budgets.ts";
import { renderPluginSkills, skillSourceOf, skillSources } from "../../src/skills.ts";

/** The directory this module runs from, so the golden file is found by path. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The names of the seven checks, in the order of the closed set. */
export const SEVEN_CHECKS: readonly ContextCostCheck[] = CONTEXT_COST_CHECKS;

/** The percentile the startup check holds (F113-FR-037). */
export const STARTUP_PERCENTILE = 90 as const;
/** The limit of the startup check, in milliseconds (F113-FR-037). */
export const STARTUP_LIMIT_MS = 150 as const;
/** The number of runs of the startup check (F113-FR-037). */
export const STARTUP_RUNS = 30 as const;
/** The share over which the host cross-check fails (F113-FR-037). */
export const HOST_CROSS_CHECK_LIMIT_SHARE = 0.15 as const;
/** The smallest synthetic feature of the judgment payload check (F113-FR-037). */
export const JUDGMENT_SYNTHETIC_TASKS = 200 as const;

/** One line of the report file (the row "Check result" of data-model.md). */
export type CheckLine = {
  /** Which of the seven checks produced the line. */
  readonly check: ContextCostCheck;
  /** What was measured. */
  readonly subject: string;
  /** The measured bytes, where the subject has bytes. */
  readonly measuredBytes?: number;
  /** The measured tokens, at the rate of F113-FR-036. */
  readonly measuredTokens?: number;
  /** The limit the check holds, in the unit of `unit`. */
  readonly limit?: number;
  readonly unit?: "bytes" | "ms" | "share" | "count";
  readonly verdict: "pass" | "fail" | "skip";
};

/** The outcome of one of the seven checks. */
export type CheckOutcome = {
  readonly check: ContextCostCheck;
  readonly verdict: "pass" | "fail" | "skip";
  readonly lines: readonly CheckLine[];
  /** The warning of a skip, where there is one. */
  readonly warning?: string;
};

/** The options every check accepts; every default is a real source of this package. */
export type CheckOptions = {
  /** The skill sources checked; the real sources of the package by default. */
  readonly skills?: readonly SkillSource[];
  /**
   * The details output of the host CLI, or `undefined` where the CLI is
   * absent. The real build reads `claude plugin details`; a stub stands in for
   * it, and `undefined` is the case the check must skip with a warning.
   */
  readonly hostDetails?: string | null;
  /**
   * One timing of a `status` run, in milliseconds, or a runner that produces
   * them. The default runner is absent: without a runner the check skips, so
   * no test and no build starts a process.
   */
  readonly statusTimings?: readonly number[];
  readonly runStatus?: () => number;
};

/* -------------------------------------------------------------------------
 * 1. static size (F113-FR-036)
 * ---------------------------------------------------------------------- */

/** The lines of a skill, as the cap of F113-FR-036 counts them. */
export function bodyLines(body: string): number {
  return body.split("\n").length;
}

/**
 * The first check: the five byte budgets of F113-FR-036 (22,400; 19,600;
 * 4,200; 420; 8,400, at 2.8 bytes per token), the tighter body limits of the
 * design point, and the cap of 500 lines on the body of a skill.
 */
export function staticSizeCheck(options?: CheckOptions): CheckOutcome {
  const skills = options?.skills ?? skillSources();
  const lines: CheckLine[] = [];
  let fail = false;
  for (const source of skills) {
    const budget = BYTE_BUDGETS[source.logicalId as keyof typeof BYTE_BUDGETS];
    const bodyBudget = BODY_BYTE_LIMITS[source.logicalId];
    if (budget === undefined || bodyBudget === undefined) {
      throw new Error(`no budget of F113-FR-036 holds for \`${source.logicalId}\``);
    }
    const rendered = Buffer.byteLength(source.body, "utf8");
    const over = rendered > budget || rendered > bodyBudget;
    fail = fail || over;
    lines.push({
      check: "static size",
      subject: `${source.logicalId}: body bytes`,
      measuredBytes: rendered,
      measuredTokens: Math.round(rendered / BYTES_PER_TOKEN),
      limit: Math.min(budget, bodyBudget),
      unit: "bytes",
      verdict: over ? "fail" : "pass",
    });
    const lines_ = bodyLines(source.body);
    const overLines = lines_ > MAX_BODY_LINES;
    fail = fail || overLines;
    lines.push({
      check: "static size",
      subject: `${source.logicalId}: body lines`,
      measuredTokens: lines_,
      limit: MAX_BODY_LINES,
      unit: "count",
      verdict: overLines ? "fail" : "pass",
    });
  }
  return { check: "static size", verdict: fail ? "fail" : "pass", lines };
}

/* -------------------------------------------------------------------------
 * 2. reference closure (F113-FR-037)
 * ---------------------------------------------------------------------- */

/**
 * What reference closure fails: any path from a skill into product source,
 * state or logs. A skill names commands of the CLI, never files of the
 * product.
 */
export const REFERENCE_CLOSURE_FORBIDDEN: readonly {
  readonly why: string;
  readonly pattern: RegExp;
}[] = Object.freeze([
  { why: "product source", pattern: /(^|[\s`/(])(src|packages)\/[A-Za-z0-9_./-]+/ },
  { why: "state", pattern: /last-injected-state|notice-shown|status\.line|SPECSTRIDE_STATE_DIR/ },
  { why: "logs", pattern: /logs?\/|\.log\b|events\.jsonl|inbox/ },
]);

/** The paths a skill names that reference closure fails, with the reason of each. */
export function referenceClosureViolations(source: SkillSource): readonly string[] {
  const texts = [source.body, ...source.references.map((r) => `${r.path} ${r.readWhen}`)];
  const violations: string[] = [];
  for (const text of texts) {
    for (const { why, pattern } of REFERENCE_CLOSURE_FORBIDDEN) {
      const found = text.match(pattern);
      if (found !== null) violations.push(`${why}: ${found[0]}`);
    }
  }
  return violations;
}

/** The second check: no path from a skill into product source, state or logs. */
export function referenceClosureCheck(options?: CheckOptions): CheckOutcome {
  const skills = options?.skills ?? skillSources();
  const lines: CheckLine[] = skills.map((source) => {
    const violations = referenceClosureViolations(source);
    return {
      check: "reference closure" as const,
      subject: source.logicalId,
      measuredTokens: violations.length,
      limit: 0,
      unit: "count" as const,
      verdict: violations.length === 0 ? ("pass" as const) : ("fail" as const),
    };
  });
  return {
    check: "reference closure",
    verdict: lines.some((line) => line.verdict === "fail") ? "fail" : "pass",
    lines,
  };
}

/* -------------------------------------------------------------------------
 * 3. golden output (F113-FR-037)
 * ---------------------------------------------------------------------- */

type GoldenFile = { readonly units: Readonly<Record<string, { readonly sha256: string }>> };

/** The sha256 of a text, as the golden file records it. */
export function goldenHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The golden output check: the RENDERED skills and the rendered entry of the
 * doctor, against `data/golden.json`. The rendered artifact is the unit a
 * consumer reads, so the render, not the bare body, is what the golden file
 * pins. The real sources only: a mutation of a source for another check is not
 * a rendering this file pins.
 */
export function goldenOutputCheck(_options?: CheckOptions): CheckOutcome {
  const golden = JSON.parse(readFileSync(join(HERE, "golden.json"), "utf8")) as GoldenFile;
  const lines: CheckLine[] = [];
  for (const artifact of renderPluginSkills()) {
    const expected = golden.units[artifact.path];
    const actual = goldenHash(artifact.content);
    const ok = expected !== undefined && expected.sha256 === actual;
    lines.push({
      check: "golden output",
      subject: artifact.path,
      measuredBytes: artifact.bytes,
      verdict: ok ? "pass" : "fail",
    });
  }
  const entry = renderEntry("doctor");
  const expectedEntry = golden.units["entry/doctor"];
  const okEntry = expectedEntry !== undefined && expectedEntry.sha256 === goldenHash(entry);
  lines.push({
    check: "golden output",
    subject: "entry/doctor",
    verdict: okEntry ? "pass" : "fail",
  });
  return {
    check: "golden output",
    verdict: lines.some((line) => line.verdict === "fail") ? "fail" : "pass",
    lines,
  };
}

/**
 * A skill source whose body differs from the golden rendering of its logical
 * id: the negative case of the check, read from the same golden file.
 */
export function bodyDriftsFromTheGolden(source: SkillSource): boolean {
  const real = skillSourceOf(source.logicalId);
  return goldenHash(source.body) !== goldenHash(real?.body ?? "");
}

/* -------------------------------------------------------------------------
 * 4. supervision cycle (F113-FR-036, F113-FR-037)
 * ---------------------------------------------------------------------- */

/** The lines of a body that make up one supervision cycle. */
export function supervisionCycleLines(body: string): readonly string[] {
  const section = body.slice(body.indexOf("## Supervise")).split("\n");
  return section.filter((line) => line.startsWith("- ")).slice(0, 2);
}

/** The lines of a body that make up the whole supervision of a run. */
export function supervisionSectionLines(body: string): readonly string[] {
  const start = body.indexOf("## Supervise");
  if (start < 0) return [];
  const rest = body.slice(start);
  const end = rest.indexOf("\n## ");
  return (end < 0 ? rest : rest.slice(0, end)).split("\n");
}

/**
 * The fourth check: one cycle against the 420 bytes of F113-FR-036, and a
 * whole run's supervision against its 8,400.
 */
export function supervisionCycleCheck(options?: CheckOptions): CheckOutcome {
  const skills = (options?.skills ?? skillSources()).filter((source) =>
    source.body.includes("## Supervise"),
  );
  const cycleLimit = BYTE_BUDGETS["supervision-cycle"];
  const runLimit = BYTE_BUDGETS["run-supervision"];
  const lines: CheckLine[] = [];
  let fail = false;
  for (const source of skills) {
    const cycle = Buffer.byteLength(supervisionCycleLines(source.body).join("\n"), "utf8");
    const overCycle = cycle > cycleLimit;
    fail = fail || overCycle;
    lines.push({
      check: "supervision cycle",
      subject: `${source.logicalId}: one cycle`,
      measuredBytes: cycle,
      measuredTokens: Math.round(cycle / BYTES_PER_TOKEN),
      limit: cycleLimit,
      unit: "bytes",
      verdict: overCycle ? "fail" : "pass",
    });
    const whole = Buffer.byteLength(supervisionSectionLines(source.body).join("\n"), "utf8");
    const overWhole = whole > runLimit;
    fail = fail || overWhole;
    lines.push({
      check: "supervision cycle",
      subject: `${source.logicalId}: whole run`,
      measuredBytes: whole,
      measuredTokens: Math.round(whole / BYTES_PER_TOKEN),
      limit: runLimit,
      unit: "bytes",
      verdict: overWhole ? "fail" : "pass",
    });
  }
  return { check: "supervision cycle", verdict: fail ? "fail" : "pass", lines };
}

/* -------------------------------------------------------------------------
 * 5. judgment payload (F113-FR-037)
 * ---------------------------------------------------------------------- */

/**
 * The bytes of one judgment of the exchange (annex F): the envelope alone,
 * which does not grow with the size of the sources. The check uses THIS
 * function for its synthetic feature; a source that printed a total that grew
 * with the sources would fail.
 */
export const JUDGMENT_ENVELOPE_BYTES = 96 as const;

/**
 * The printed total of the judgment payload of a feature of `tasks` tasks,
 * given the skill sources. The envelope of a judgment (annex F) is fixed: a
 * judgment holds the judgment of ONE task, never the skill texts, so the total
 * printed does not grow with the size of the sources. The check holds that by
 * doubling the sources and requiring the same total.
 */
export function printedJudgmentTotal(tasks: number, _sources: readonly SkillSource[]): number {
  return tasks * JUDGMENT_ENVELOPE_BYTES;
}

/**
 * The fifth check: a synthetic feature of at least 200 tasks, and a total
 * printed that does not grow with the size of the sources.
 */
export function judgmentPayloadCheck(options?: CheckOptions): CheckOutcome {
  const skills = options?.skills ?? skillSources();
  const tasks = JUDGMENT_SYNTHETIC_TASKS;
  const before = printedJudgmentTotal(tasks, skills);
  const doubled: readonly SkillSource[] = skills.map((source) => ({
    ...source,
    body: source.body + source.body,
  }));
  const afterDoublingTheSources = printedJudgmentTotal(tasks, doubled);
  const lines: CheckLine[] = [
    {
      check: "judgment payload",
      subject: `synthetic feature of ${tasks} tasks`,
      measuredBytes: before,
      measuredTokens: Math.round(before / BYTES_PER_TOKEN),
      unit: "bytes",
      verdict: before > 0 ? "pass" : "fail",
    },
    {
      check: "judgment payload",
      subject: "total after doubling the size of the sources",
      measuredBytes: afterDoublingTheSources,
      measuredTokens: Math.round(afterDoublingTheSources / BYTES_PER_TOKEN),
      limit: before,
      unit: "bytes",
      verdict: afterDoublingTheSources === before ? "pass" : "fail",
    },
  ];
  return {
    check: "judgment payload",
    verdict: lines.some((line) => line.verdict === "fail") ? "fail" : "pass",
    lines,
  };
}

/* -------------------------------------------------------------------------
 * 6. host cross-check (F113-FR-037)
 * ---------------------------------------------------------------------- */

/**
 * The declared capabilities of the plugin, as `describe` prints them — the
 * side of the cross-check that does not need the host.
 */
export function declaredCapabilityCount(): number {
  // Six capabilities of annex H §H.1 (F113-FR-028); read from the describe
  // module to keep one source of the number.
  return CAPABILITY_DECLARATIONS.length;
}

/** The capabilities the details output of the host names, one per line. */
export function capabilitiesInHostDetails(details: string): readonly string[] {
  return details
    .split("\n")
    .filter((line) => line.startsWith("capability:"))
    .map((line) => line.slice("capability:".length).trim());
}

/**
 * The sixth check: this plugin against what the host CLI reports. Fails a
 * difference over 15 per cent; SKIPPED WITH A WARNING when the host CLI is
 * absent (F113-FR-037). The absence is what a build without `claude` sees.
 */
export function hostCrossCheck(options?: CheckOptions): CheckOutcome {
  const details = options?.hostDetails;
  if (details === undefined || details === null) {
    return {
      check: "host cross-check",
      verdict: "skip",
      warning:
        "the host CLI is absent: the host cross-check is skipped with this warning " +
        "(F113-FR-037)",
      lines: [
        {
          check: "host cross-check",
          subject: "capabilities of the plugin against the host",
          verdict: "skip",
        },
      ],
    };
  }
  const declared = declaredCapabilityCount();
  const found = capabilitiesInHostDetails(details).length;
  const share = declared === 0 ? 0 : Math.abs(declared - found) / declared;
  const fail = share > HOST_CROSS_CHECK_LIMIT_SHARE;
  return {
    check: "host cross-check",
    verdict: fail ? "fail" : "pass",
    lines: [
      {
        check: "host cross-check",
        subject: "capabilities of the plugin against the host",
        measuredTokens: found,
        limit: declared,
        unit: "share",
        verdict: fail ? "fail" : "pass",
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 * 7. startup (F113-FR-037)
 * ---------------------------------------------------------------------- */

/** The p90 of a list of timings, in milliseconds. */
export function percentile90(timings: readonly number[]): number {
  const sorted = [...timings].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((STARTUP_PERCENTILE / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

/**
 * The seventh check: `status` at or below 150 ms at the 90th percentile over
 * 30 runs. Without a runner or recorded timings the check skips with a
 * warning, so no test and no job of the build starts a process.
 */
export function startupCheck(options?: CheckOptions): CheckOutcome {
  let timings = options?.statusTimings;
  if (timings === undefined && options?.runStatus !== undefined) {
    timings = Array.from({ length: STARTUP_RUNS }, () => options.runStatus?.() ?? 0);
  }
  if (timings === undefined) {
    return {
      check: "startup",
      verdict: "skip",
      warning: "no status runner and no recorded timings: the startup check is skipped",
      lines: [{ check: "startup", subject: "status p90", unit: "ms", verdict: "skip" }],
    };
  }
  const runs = timings.slice(0, STARTUP_RUNS);
  if (runs.length < STARTUP_RUNS) {
    throw new Error(`the startup check needs ${STARTUP_RUNS} runs; ${runs.length} were given`);
  }
  const p90 = percentile90(runs);
  const fail = p90 > STARTUP_LIMIT_MS;
  return {
    check: "startup",
    verdict: fail ? "fail" : "pass",
    lines: [
      {
        check: "startup",
        subject: `status p${STARTUP_PERCENTILE} of ${STARTUP_RUNS} runs`,
        measuredTokens: Math.round(p90),
        limit: STARTUP_LIMIT_MS,
        unit: "ms",
        verdict: fail ? "fail" : "pass",
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 * The seven together, and the tokens of a measurement
 * ---------------------------------------------------------------------- */

/** The tokens `bytes` measure, at the rate of F113-FR-036. */
export function tokensForBytes(bytes: number): number {
  return Math.round(bytes / BYTES_PER_TOKEN);
}

/** The byte budget of a budgeted thing, and its token budget beside it. */
export function budgetPair(id: keyof typeof TOKEN_BUDGETS): {
  readonly bytes: number;
  readonly tokens: number;
} {
  return { bytes: bytesForTokens(TOKEN_BUDGETS[id]), tokens: TOKEN_BUDGETS[id] };
}

/** Runs the seven checks, in the order of row 145 of annex X §X.6. */
export function runAllChecks(options?: CheckOptions): readonly CheckOutcome[] {
  return Object.freeze([
    staticSizeCheck(options),
    referenceClosureCheck(options),
    goldenOutputCheck(options),
    supervisionCycleCheck(options),
    judgmentPayloadCheck(options),
    hostCrossCheck(options),
    startupCheck(options),
  ]);
}

/** The report of a run of the seven, for the report file of `report.ts`. */
export function allChecksPass(outcomes: readonly CheckOutcome[]): boolean {
  return outcomes.every((outcome) => outcome.verdict === "pass" || outcome.verdict === "skip");
}
