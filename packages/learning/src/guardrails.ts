/**
 * T058 — the guardrails and the automatic revert (F106-FR-019).
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`): `guardrail_counts`, `_rate_guard`, `_size_guard`,
 * `evaluate_guardrails`, `breaches`, `act_on_evaluation` and the
 * `revert_run(..., extra=…, reason="auto_revert")` form. A guardrail vetoes a
 * decision even when a primary improved, and a breach reverts it. Rate
 * guardrails use an exact one-sided binomial tail against the baseline rate;
 * below its minimum n a guardrail is `unknown`, never `ok`. The guardrail
 * records follow `data-model.md`: one state `ok | breach | unknown` per
 * guardrail, in the captured order.
 *
 * Purity: the planners read the documents handed in and return entries and
 * event lines; the caller holds the writer-domain lock across the deciding
 * read and the appends (F106-FR-038).
 */
import {
  entryShape,
  isDecision,
  LEARN_APPLIED_SCHEMA,
  serializeValue,
  toInt,
} from "./decision-log.ts";
import { binomLower, binomUpper, exactRankTail } from "./stats.ts";

/**
 * The stop reasons that hand a phase back to a human: the arbitration proxy
 * (no event records arbitration itself; 05-evaluate-design.md §2.6) — annex
 * E §E.3 members only, and no new reason.
 */
export const ARBITRATION_STOPS = [
  "max_rejects",
  "gate_oscillation",
  "critic_config",
  "proposer_no_progress",
] as const;

/** A stop reason the arbitration proxy reads (annex E §E.3). */
export type ArbitrationStop = (typeof ARBITRATION_STOPS)[number];

/** p below which a guardrail breaches (GUARD_P). */
export const GUARD_P = 0.01 as const;
/** Rate guardrails: applied-arm trials below which the state is `unknown` (GUARD_MIN_N). */
export const GUARD_MIN_N = 10 as const;
/** Critic input size: samples per arm below which the state is `unknown` (GUARD_MIN_SIZE_N). */
export const GUARD_MIN_SIZE_N = 6 as const;

export type GuardrailCounts = {
  readonly attempts: number;
  readonly verdicts: number;
  readonly malformed: number;
  readonly grounding_gap: number;
  readonly verification_failed: number;
  readonly first_verdicts: number;
  readonly first_approved: number;
  readonly diagnostician_cases: number;
  readonly diagnostician_grounding: number;
  readonly episodes: number;
  readonly arbitration: number;
  readonly critic_prompt_bytes: readonly number[];
};

type AttemptLike = Record<string, unknown>;
type MetaLike = Record<string, unknown>;

/**
 * The raw counts every guardrail needs, for one arm (the baseline's
 * `guardrail_counts`).
 */
export function guardrailCounts(
  attempts: readonly AttemptLike[],
  runsMeta: Readonly<Record<string, MetaLike>>,
  phase: number,
): GuardrailCounts {
  const verdicts = attempts.filter((a) => a["verdict"]);
  const first = verdicts.filter((a) => toInt(a["attempt"]) === 1);
  const cases = attempts
    .filter((a) => a["diagnostician_case"] !== null && a["diagnostician_case"] !== undefined)
    .map((a) => String(a["diagnostician_case"]));
  const episodes = [...new Set(attempts.map((a) => String(a["run"] ?? "")))].sort();
  return {
    attempts: attempts.length,
    verdicts: verdicts.length,
    malformed: verdicts.filter((a) => a["verdict"] === "MALFORMED").length,
    grounding_gap: verdicts.filter((a) => {
      const n = toInt(a["grounding_gap_paths"]);
      return n !== null && n > 0;
    }).length,
    verification_failed: attempts.filter((a) => a["verification"] === "failed").length,
    first_verdicts: first.length,
    first_approved: first.filter((a) => a["verdict"] === "APPROVED").length,
    diagnostician_cases: cases.length,
    diagnostician_grounding: cases.filter((c) => c === "grounding").length,
    episodes: episodes.length,
    arbitration: episodes.filter((r) => {
      const meta = runsMeta[r] ?? {};
      return (
        (ARBITRATION_STOPS as readonly string[]).includes(String(meta["stop_reason"] ?? "")) &&
        toInt(meta["stop_phase"]) === phase
      );
    }).length,
    critic_prompt_bytes: attempts
      .map((a) => a["critic_prompt_bytes"])
      .filter((v): v is number => typeof v === "number"),
  };
}

/** The empty counts of an arm with no attempt (`guardrail_counts([], {}, …)`). */
export function emptyGuardrailCounts(): GuardrailCounts {
  return guardrailCounts([], {}, 0);
}

/** The record of one rate (or two-sided) guardrail (the baseline's `_rate_guard`). */
export function rateGuard(
  kA: number,
  nA: number,
  kB: number,
  nB: number,
  both = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    k_applied: kA,
    n_applied: nA,
    k_baseline: kB,
    n_baseline: nB,
    p: null,
  };
  if (nA < GUARD_MIN_N || nB < 1) return { ...out, state: "unknown" };
  // shrunk by half a trial, so a baseline of 0/6 is not a certainty that turns
  // the first applied-arm event into p = 0
  const rate = (kB + 0.5) / (nB + 1.0);
  const pUp = binomUpper(kA, nA, rate);
  const p = both ? Math.min(pUp, binomLower(kA, nA, rate)) : pUp;
  return { ...out, p: Math.round(p * 1e6) / 1e6, state: p < GUARD_P ? "breach" : "ok" };
}

/** The record of the critic-input-size guardrail (the baseline's `_size_guard`). */
export function sizeGuard(
  sizesA: readonly number[],
  sizesB: readonly number[],
): Record<string, unknown> {
  const nA = sizesA.length;
  const nB = sizesB.length;
  const out: Record<string, unknown> = { n_applied: nA, n_baseline: nB, p: null };
  if (nA < GUARD_MIN_SIZE_N || nB < GUARD_MIN_SIZE_N) return { ...out, state: "unknown" };
  const { k, p } = exactRankTail(sizesA, sizesB);
  return {
    ...out,
    k,
    p: Math.round(p * 1e6) / 1e6,
    state: p < GUARD_P ? "breach" : "ok",
  };
}

/**
 * One state per guardrail: `ok | breach | unknown`; `base`/`applied` are
 * `guardrail_counts` for the two arms (the baseline's `evaluate_guardrails`).
 * The records are inserted in the order `data-model.md` captures.
 */
export function evaluateGuardrails(
  base: Readonly<GuardrailCounts>,
  applied: Readonly<GuardrailCounts>,
): Record<string, Record<string, unknown>> {
  const g: Record<string, Record<string, unknown>> = {};
  g["grounding_gap_rate"] = rateGuard(
    applied.grounding_gap,
    applied.verdicts,
    base.grounding_gap,
    base.verdicts,
  );
  g["malformed_rate"] = rateGuard(
    applied.malformed,
    applied.verdicts,
    base.malformed,
    base.verdicts,
  );
  if (applied.attempts === 0) {
    g["verification"] = {
      state: "unknown",
      applied_failed: 0,
      baseline_failed: base.verification_failed,
    };
  } else {
    // any failure where the baseline had none is a breach, at any n
    const breach = applied.verification_failed > 0 && base.verification_failed === 0;
    g["verification"] = {
      state: breach ? "breach" : "ok",
      applied_failed: applied.verification_failed,
      baseline_failed: base.verification_failed,
    };
  }
  g["diagnostician_grounding_share"] = rateGuard(
    applied.diagnostician_grounding,
    applied.diagnostician_cases,
    base.diagnostician_grounding,
    base.diagnostician_cases,
  );
  g["critic_input_size"] = sizeGuard(applied.critic_prompt_bytes, base.critic_prompt_bytes);
  // a PROXY: no event records human arbitration, only the stops that hand a phase back
  g["arbitration_proxy"] = rateGuard(
    applied.arbitration,
    applied.episodes,
    base.arbitration,
    base.episodes,
  );
  // an alarm in BOTH directions, never a reward and never a label term
  g["first_attempt_approval"] = rateGuard(
    applied.first_approved,
    applied.first_verdicts,
    base.first_approved,
    base.first_verdicts,
    true,
  );
  return g;
}

/** The names of the guardrails whose state is `breach` (the baseline's `breaches`). */
export function breaches(result: Record<string, unknown>): string[] {
  const guardrails = (result["guardrails"] ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(guardrails)
    .filter(([, g]) => g["state"] === "breach")
    .map(([name]) => name);
}

/**
 * The automatic revert of one breached decision (F106-FR-019), as the
 * baseline's `act_on_evaluation` plans it:
 *  - no breach: record the evaluation only;
 *  - a breach of a decision that is no longer the active one: record the
 *    evaluation as `skipped_superseded` and never retry against the new top
 *    of the stack;
 *  - a breach of the active decision: record the evaluation as
 *    `auto_reverted`, then write the automatic revert (its `auto` member
 *    right after `action`, `applied_at` last, as T004 captured), the
 *    `knob_adjusted` line with the reason `auto_revert`, and the
 *    `knob_auto_reverted` line.
 * After `--off` or a manual revert there is nothing to do: a silent no-op.
 */
export function actOnEvaluation(input: {
  readonly result: Record<string, unknown>;
  readonly entries: readonly Record<string, unknown>[];
  readonly revertRunId: string;
  readonly evaluatedRunId: string;
  readonly appliedAt: string;
  readonly ts: string;
  /** `time.time()` at the revert; the quarantine freshness clock reads it. */
  readonly revertedTs?: number;
}): {
  /** The `evaluate` entry to append, or `null` when nothing changed. */
  readonly evaluationEntry: Record<string, unknown> | null;
  readonly evaluationEventLine: string | null;
  /** The automatic `revert` entry, or `null` when no revert was planned. */
  readonly revertEntry: Record<string, unknown> | null;
  readonly revertEventLine: string | null;
  readonly autoRevertedEventLine: string | null;
  /** The line the command prints for the revert; `null` when none. */
  readonly line: string | null;
} {
  const { result, entries } = input;
  const names = breaches(result);
  if (names.length === 0) {
    const plan = planRecordInput(result, entries, input);
    return {
      ...plan,
      revertEntry: null,
      revertEventLine: null,
      autoRevertedEventLine: null,
      line: null,
    };
  }
  const decisionId = String(result["evaluates_run_id"]);
  const phase = toInt(result["phase"]);
  const decision =
    activeDecisionsOf(entries, phase).find((d) => d["run_id"] === decisionId) ?? null;
  if (decision === null) {
    const latest = latestDecisionOf(
      entries,
      String(result["knob"]),
      phase ?? 0,
      entryShape(result),
    );
    if (latest === null || latest["action"] === "revert") {
      // `--off` or a manual revert: a silent no-op
      return {
        evaluationEntry: null,
        evaluationEventLine: null,
        revertEntry: null,
        revertEventLine: null,
        autoRevertedEventLine: null,
        line: null,
      };
    }
    const plan = planRecordInput({ ...result, action_taken: "skipped_superseded" }, entries, input);
    return {
      ...plan,
      revertEntry: null,
      revertEventLine: null,
      autoRevertedEventLine: null,
      line: null,
    };
  }
  const plan = planRecordInput({ ...result, action_taken: "auto_reverted" }, entries, input);
  const evaluatedFrom =
    plan.evaluationEntry !== null
      ? String(plan.evaluationEntry["run_id"])
      : lastEvaluationRunId(entries, decisionId);
  const revertEntry = buildAutoRevertEntry({
    applyEntry: decision,
    runId: input.revertRunId,
    guardrail: names,
    evaluatedFrom,
    revertedTs: input.revertedTs ?? Date.now() / 1000,
    appliedAt: input.appliedAt,
    backend: result["backend"] ?? null,
  });
  const revertEventLine = `${serializeValue({
    event: "knob_adjusted",
    ts: input.ts,
    knob: result["knob"],
    phase: result["phase"],
    from: decision["value"],
    to: decision["previous"],
    reason: "auto_revert",
    samples: null,
    metric: null,
    run_id: input.revertRunId,
    reverts_run_id: decisionId,
  })}\n`;
  const autoRevertedEventLine = `${serializeValue({
    event: "knob_auto_reverted",
    ts: input.ts,
    knob: result["knob"],
    phase: result["phase"],
    guardrail: names.join(","),
    from: decision["value"],
    to: decision["previous"],
    run_id: input.revertRunId,
    reverts_run_id: decisionId,
  })}\n`;
  return {
    ...plan,
    revertEntry,
    revertEventLine,
    autoRevertedEventLine,
    line: autoRevertedLine({
      runId: decisionId,
      guardrail: names,
      knob: String(result["knob"]),
      phase: toInt(result["phase"]) ?? 0,
      value: toInt(decision["previous"]) ?? 0,
    }),
  };
}

// one-way imports of the readers/planners evaluate.ts owns
import { activeDecisions, lastEvaluation, planEvaluation } from "./evaluate.ts";

function activeDecisionsOf(entries: readonly Record<string, unknown>[], phase: number | null) {
  return activeDecisions(entries, phase);
}

function latestDecisionOf(
  entries: readonly Record<string, unknown>[],
  knob: string,
  phase: number,
  shape: string | null,
): Record<string, unknown> | null {
  let latest: Record<string, unknown> | null = null;
  for (const e of entries) {
    if (!isDecision(e)) continue;
    if (e["knob"] !== knob || toInt(e["phase"]) !== phase) continue;
    if ((entryShape(e) ?? null) !== (shape ?? null)) continue;
    latest = e;
  }
  return latest;
}

function lastEvaluationRunId(
  entries: readonly Record<string, unknown>[],
  decisionId: string,
): string | null {
  const last = lastEvaluation(entries, decisionId);
  return last !== null ? String(last["run_id"]) : null;
}

function planRecordInput(
  result: Record<string, unknown>,
  entries: readonly Record<string, unknown>[],
  input: { readonly evaluatedRunId: string; readonly appliedAt: string; readonly ts: string },
): { evaluationEntry: Record<string, unknown> | null; evaluationEventLine: string | null } {
  const plan = planEvaluation({
    result,
    entries,
    runId: input.evaluatedRunId,
    evaluatedAt: input.appliedAt,
    ts: input.ts,
  });
  return { evaluationEntry: plan.entry, evaluationEventLine: plan.eventLine };
}

/**
 * The automatic `revert` entry, in the member order T004 captured
 * (`FX-29/quarantined`): `auto` right after `action`, `applied_at` last.
 */
export function buildAutoRevertEntry(input: {
  readonly applyEntry: Record<string, unknown>;
  readonly runId: string;
  readonly guardrail: readonly string[];
  readonly evaluatedFrom: string | null;
  readonly revertedTs: number;
  readonly appliedAt: string;
  readonly backend: unknown;
}): Record<string, unknown> {
  const a = input.applyEntry;
  return {
    schema: LEARN_APPLIED_SCHEMA,
    action: "revert",
    auto: true,
    run_id: input.runId,
    reverts_run_id: a["run_id"],
    knob: a["knob"],
    phase: a["phase"],
    shape: entryShape(a),
    value: a["previous"],
    previous: a["value"],
    quarantined_value: a["value"],
    backend: input.backend,
    reverted_ts: input.revertedTs,
    evaluated_from: input.evaluatedFrom,
    guardrail: [...input.guardrail],
    applied_at: input.appliedAt,
  };
}

/** The line the command prints for an automatic revert (F106-FR-026). */
export function autoRevertedLine(input: {
  readonly runId: string;
  readonly guardrail: readonly string[];
  readonly knob: string;
  readonly phase: number;
  readonly value: number;
}): string {
  return (
    `learn: auto-reverted ${input.runId} — guardrail ${input.guardrail.join(",")}; ` +
    `${input.knob}[${input.phase}] back to ${input.value}s`
  );
}
