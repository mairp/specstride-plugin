/**
 * T057 — `evaluate` (F106-FR-018, F106-FR-019): the two arms, the baseline of
 * the decision, the effect on cost and on wall-clock, the minimum detectable
 * effect at the arm sizes the decision has, the label, the counterfactual,
 * and the signature that decides whether an evaluation is recorded.
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`): `mde`, `compare_arms`, `_combine`, `_phase_attempts`,
 * `_samples`, `counterfactual`, `_applied_runs`, `evaluate_decision`,
 * `active_decisions`, `_last_evaluation` and `_signature`. The labelling rule
 * (05-evaluate-design.md §1): a decision is labelled by comparing its effect
 * with the minimum detectable effect at the arm sizes it has, and the MDE is
 * always reported beside the effect, so `neutral` reads as "nothing this
 * large could be seen", never as "no effect".
 *
 * Purity: the planners read the documents handed in and return the entry and
 * the event line; the caller (verb.ts, guardrails.ts) holds the writer-domain
 * lock across the deciding read and the appends (F106-FR-038).
 */
import {
  entryShape,
  fraction,
  isDecision,
  LEARN_APPLIED_SCHEMA,
  serializeValue,
  toInt,
} from "./decision-log.ts";
import { isSample, type PassRecord } from "./metrics.ts";
import { evaluateGuardrails, guardrailCounts, type GuardrailCounts } from "./guardrails.ts";

/** Billed non-futility passes per arm, below which: `insufficient` (EVAL_FLOOR). */
export const EVAL_FLOOR = 6 as const;
/** z(0.975) + z(0.80): 5 % two-sided, 80 % power (EVAL_Z). */
export const EVAL_Z = 2.8 as const;
/** Floor on the pooled within-phase sd of log(x) (EVAL_SD_FLOOR). */
export const EVAL_SD_FLOOR = 0.5 as const;
/** Assumed intra-episode correlation; the corpus cannot estimate it (EVAL_ICC). */
export const EVAL_ICC = 0.5 as const;

/** The closed label set, in the order the baseline names it. */
export const LABELS = ["helped", "neutral", "regressed", "insufficient"] as const;
export type EvaluationLabel = (typeof LABELS)[number];

/** log() needs a positive value: a pass billed at $0 or timed at 0 s is floored here. */
export const LOG_FLOOR: Readonly<Record<"cost" | "wall", number>> = { cost: 1e-4, wall: 1.0 };

/** The proposer_cap fields that say which value a run's passes ran under, per knob. */
export const CAP_FIELDS: Readonly<Record<string, readonly [string, string, string]>> = {
  proposer_timeout: ["seconds", "source", "arm"],
  yield_poll_interval: ["yield_poll", "yield_poll_source", "yield_poll_arm"],
};

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function fmean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Minimum detectable effect on log(x): `2.80 · s · sqrt(1/n_a + 1/n_b) ·
 * sqrt(DEFF)`, s floored at 0.50, `DEFF = 1 + (m̄ − 1)·0.5` for m̄ passes per
 * episode (the baseline's `mde`).
 */
export function mde(s: number, nA: number, nB: number, mbar = 1.0): number {
  const deff = 1.0 + (Math.max(mbar, 1.0) - 1.0) * EVAL_ICC;
  return EVAL_Z * Math.max(s, EVAL_SD_FLOOR) * Math.sqrt(1.0 / nA + 1.0 / nB) * Math.sqrt(deff);
}

/** One arm sample: `[run, value]` — the run is the episode a pass clusters in. */
export type ArmSample = readonly [string, number];

/** The result of comparing two arms for one primary (`compare_arms`). */
export type ArmComparison = {
  readonly n_a: number;
  readonly n_b: number;
  readonly r: number | null;
  readonly mde: number | null;
  readonly s: number | null;
  readonly deff: number | null;
  readonly label: EvaluationLabel;
};

/**
 * One primary: `applied`/`baseline` are (run, value) samples; the run is the
 * episode a pass clusters in (the baseline's `compare_arms`).
 */
export function compareArms(
  applied: readonly ArmSample[],
  baseline: readonly ArmSample[],
  kind: "cost" | "wall",
): Record<string, unknown> {
  const floor = LOG_FLOOR[kind];
  const la = applied
    .filter(([, v]) => v !== null)
    .map(([r, v]) => [r, Math.log(Math.max(v, floor))] as const);
  const lb = baseline
    .filter(([, v]) => v !== null)
    .map(([r, v]) => [r, Math.log(Math.max(v, floor))] as const);
  const nA = la.length;
  const nB = lb.length;
  const out: Record<string, unknown> = {
    n_a: nA,
    n_b: nB,
    r: null,
    mde: null,
    s: null,
    deff: null,
    label: "insufficient",
  };
  if (nA < EVAL_FLOOR || nB < EVAL_FLOOR) return out;
  const ma = fmean(la.map(([, x]) => x));
  const mb = fmean(lb.map(([, x]) => x));
  const ss =
    la.reduce((acc, [, x]) => acc + (x - ma) ** 2, 0) +
    lb.reduce((acc, [, x]) => acc + (x - mb) ** 2, 0);
  const sd = Math.sqrt(ss / (nA + nB - 2));
  const episodes = new Set(la.map(([r]) => r)).size + new Set(lb.map(([r]) => r)).size;
  const mbar = (nA + nB) / Math.max(episodes, 1);
  const r = ma - mb;
  const m = mde(sd, nA, nB, mbar);
  const label: EvaluationLabel = r <= -m ? "helped" : r >= m ? "regressed" : "neutral";
  return {
    ...out,
    r: round4(r),
    mde: round4(m),
    s: round4(Math.max(sd, EVAL_SD_FLOOR)),
    sd: round4(sd),
    deff: round4(1.0 + (mbar - 1.0) * EVAL_ICC),
    mbar: round3(mbar),
    label,
  };
}

/** The empty comparison every insufficient arm reports (`compare_arms([], [], …)`). */
export function emptyArmComparison(): Record<string, unknown> {
  return compareArms([], [], "cost");
}

/** Two primaries combine at the worst label: regressed, then helped, then neutral (the baseline's `_combine`). */
export function combineLabels(
  cost: Record<string, unknown>,
  wall: Record<string, unknown>,
): EvaluationLabel {
  const labels = [String(cost["label"]), String(wall["label"])];
  if (labels.includes("regressed")) return "regressed";
  if (labels.includes("helped")) return "helped";
  if (labels.includes("neutral")) return "neutral";
  return "insufficient";
}

type AttemptLike = Record<string, unknown>;

/** The attempts of one phase, of the given runs, under the shape when one is keyed. */
export function phaseAttemptsOf(
  doc: Record<string, unknown>,
  phase: number,
  shape: string | null,
  runs: readonly string[],
): AttemptLike[] {
  const wanted = new Set(runs);
  const atts = (doc["attempts"] ?? []) as AttemptLike[];
  return atts.filter((a) => {
    if (toInt(a["phase"]) !== phase) return false;
    if (!wanted.has(String(a["run"] ?? ""))) return false;
    if (shape !== null && a["shape"] !== shape) return false;
    return true;
  });
}

/** The billed non-futility samples of the attempts: `[run, cost]` and `[run, wall]`. */
export function samplesOf(attempts: readonly AttemptLike[]): {
  cost: ArmSample[];
  wall: ArmSample[];
} {
  const cost: ArmSample[] = [];
  const wall: ArmSample[] = [];
  for (const a of attempts) {
    const run = String(a["run"] ?? "");
    for (const p of (a["passes_detail"] ?? []) as PassRecord[]) {
      if (!isSample(p)) continue;
      if (p.cost_usd !== null) cost.push([run, p.cost_usd]);
      if (p.elapsed_sec !== null) wall.push([run, p.elapsed_sec]);
    }
  }
  return { cost, wall };
}

/**
 * What the recorded passes can say without a run under the new value
 * (05-evaluate-design.md §2.9). Informational only; never a label input
 * (the baseline's `counterfactual`).
 */
export function counterfactual(decision: Record<string, unknown>): Record<string, unknown> {
  const base = (decision["baseline"] ?? {}) as Record<string, unknown>;
  const value = toInt(decision["value"]);
  const previous = toInt(decision["previous"]);
  if (
    decision["knob"] !== "proposer_timeout" ||
    value === null ||
    previous === null ||
    value === previous
  ) {
    return { kind: "none" };
  }
  if (value > previous) {
    return {
      kind: "censored",
      note: "a longer cap cannot be evaluated from logs: a killed pass does not show how long it would have run",
    };
  }
  const wall: ArmSample[] = ((base["wall"] ?? []) as unknown[]).map((pair) => {
    const [r, v] = pair as [string, unknown];
    return [r, typeof v === "number" ? v : 0] as ArmSample;
  });
  const capped: ArmSample[] = wall.map(([r, v]) => [r, Math.min(v, value)] as ArmSample);
  return {
    kind: "shorter_cap_wall_only",
    note: "wall-clock only: a truncated pass's cost is unobserved",
    wall: compareArms(capped, wall, "wall"),
  };
}

/** The runs whose passes of this phase ran under the decision (the baseline's `_applied_runs`). */
export function appliedRunsOf(
  summary: Record<string, unknown>,
  decision: Record<string, unknown>,
): string[] {
  const knob = String(decision["knob"]);
  const fields = CAP_FIELDS[knob];
  if (!fields) return [];
  const [valueF, sourceF, armF] = fields;
  const phase = toInt(decision["phase"]) ?? 0;
  const phaseStats =
    ((summary["phases"] ?? {}) as Record<string, Record<string, unknown>>)[String(phase)] ?? {};
  const caps = (phaseStats["caps"] ?? []) as AttemptLike[];
  const source = new Set((decision["source_runs"] ?? []) as string[]);
  const value = toInt(decision["value"]);
  const out: string[] = [];
  for (const c of caps) {
    const run = String(c["run"] ?? "");
    if (source.has(run)) continue;
    const arm = c[armF];
    let hit: boolean;
    if (arm !== null && arm !== undefined) {
      // a run that recorded an arm but no tamper bracket is excluded, not trusted
      hit = arm === "applied" && toInt(c[valueF]) === value && c["tamper_bracket"] === "on";
    } else {
      hit = c[sourceF] === "learned" && toInt(c[valueF]) === value;
    }
    if (hit) out.push(run);
  }
  return out;
}

/**
 * Label one applied decision against its recorded baseline (the baseline's
 * `evaluate_decision`). The result members are inserted in the order the
 * captured `evaluate` entry carries them (`FX-29/106-evaluate-recorded`,
 * task T004).
 */
export function evaluateDecision(
  summary: Record<string, unknown>,
  decision: Record<string, unknown>,
  currentShape: string | null,
  excludedRuns: readonly string[] = [],
): Record<string, unknown> {
  const base = (decision["baseline"] ?? null) as Record<string, unknown> | null;
  const phase = toInt(decision["phase"]) ?? 0;
  const shape = entryShape(decision);
  const result: Record<string, unknown> = {
    knob: decision["knob"],
    phase,
    shape,
    evaluates_run_id: decision["run_id"],
    value: decision["value"],
    previous: decision["previous"],
    reset: null,
    applied_runs: [],
    counterfactual: counterfactual(decision),
  };
  const empty = emptyArmComparison();
  if (!base || typeof base !== "object") {
    result["label"] = "insufficient";
    result["reason"] = "no baseline recorded (applied before evaluate existed)";
    result["cost"] = empty;
    result["wall"] = { ...empty };
    return result;
  }
  const backend = base["backend"] ?? null;
  result["backend"] = backend;
  if ((currentShape ?? null) !== shape) {
    result["label"] = "insufficient";
    result["reset"] = "shape";
    result["reason"] =
      "the phase's shape changed since the decision; its baseline no longer applies";
    result["cost"] = empty;
    result["wall"] = { ...empty };
    return result;
  }
  const runsMeta = runsMetaOf(summary);
  const phaseStats =
    ((summary["phases"] ?? {}) as Record<string, Record<string, unknown>>)[String(phase)] ?? {};
  const phaseRuns = (phaseStats["runs_seen"] ?? []) as string[];
  let latest: string | null = null;
  for (const r of [...phaseRuns].reverse()) {
    if (runsMeta[r]) {
      latest = r;
      break;
    }
  }
  if (
    latest !== null &&
    !((base["runs"] ?? []) as string[]).includes(latest) &&
    runsMeta[latest]!["backend"] !== backend
  ) {
    result["label"] = "insufficient";
    result["reset"] = "backend";
    result["reason"] =
      `backend changed from '${String(backend)}' to '${String(runsMeta[latest]!["backend"])}'; ` +
      "applied-arm samples discarded";
    result["cost"] = empty;
    result["wall"] = { ...empty };
    return result;
  }
  const tampered = new Set(
    Object.entries(runsMeta)
      .filter(([, m]) => m["tampered"] === true)
      .map(([r]) => r),
  );
  const excluded = new Set([...excludedRuns, ...tampered]);
  const candidates = appliedRunsOf(summary, decision);
  const applied = candidates.filter(
    (r) => !excluded.has(r) && runsMeta[r]?.["backend"] === backend,
  );
  result["applied_runs"] = applied;
  result["excluded_runs"] = [...excluded].filter((r) => candidates.includes(r)).sort();
  const atts = phaseAttemptsOf(summary, phase, shape, applied);
  const { cost: costA, wall: wallA } = samplesOf(atts);
  const toArm = (pairs: unknown): ArmSample[] =>
    ((pairs ?? []) as unknown[]).map((pair) => {
      const [r, v] = pair as [string, unknown];
      return [r, typeof v === "number" ? v : 0] as ArmSample;
    });
  const cost = compareArms(costA, toArm(base["cost"]), "cost");
  const wall = compareArms(wallA, toArm(base["wall"]), "wall");
  const appliedCounts = guardrailCounts(atts, runsMeta, phase);
  result["cost"] = cost;
  result["wall"] = wall;
  result["label"] = combineLabels(cost, wall);
  result["applied_guardrails"] = appliedCounts;
  result["guardrails"] = evaluateGuardrails(
    (base["guardrails"] ?? null) as unknown as Readonly<GuardrailCounts>,
    appliedCounts,
  );
  return result;
}

/** The runs map of a summary, keyed by run id (the baseline's `summary["runs"]`). */
export function runsMetaOf(
  summary: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of (summary["runs"] ?? []) as Record<string, unknown>[]) {
    const run = String(r["run"] ?? "");
    if (run) out[run] = r;
  }
  return out;
}

/**
 * The `apply` entries currently in effect, one per (knob, phase, shape) — the
 * latest decision of each key that is an apply (the baseline's
 * `active_decisions`).
 */
export function activeDecisions(
  entries: readonly Record<string, unknown>[],
  phase?: number | null,
): Record<string, unknown>[] {
  const latest = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  for (const e of entries) {
    if (!isDecision(e)) continue;
    const key = `${String(e["knob"])}\u0000${String(toInt(e["phase"]))}\u0000${String(entryShape(e))}`;
    if (!latest.has(key)) order.push(key);
    latest.set(key, e);
  }
  return order
    .map((k) => latest.get(k)!)
    .filter(
      (e) =>
        e["action"] === "apply" &&
        (phase === undefined || phase === null || toInt(e["phase"]) === phase),
    );
}

/** The last recorded evaluation of one decision run id (the baseline's `_last_evaluation`). */
export function lastEvaluation(
  entries: readonly Record<string, unknown>[],
  runId: string,
): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (const e of entries) {
    if (e["action"] === "evaluate" && e["evaluates_run_id"] === runId) last = e;
  }
  return last;
}

/** The signature that decides whether an evaluation is recorded (the baseline's `_signature`). */
export function evaluationSignature(result: Record<string, unknown>): string {
  const cost = (result["cost"] ?? {}) as Record<string, unknown>;
  const wall = (result["wall"] ?? {}) as Record<string, unknown>;
  return JSON.stringify([
    result["label"] ?? null,
    result["reset"] ?? null,
    result["action_taken"] ?? null,
    cost["n_a"] ?? null,
    cost["n_b"] ?? null,
    wall["n_a"] ?? null,
    wall["n_b"] ?? null,
    sortedJson(result["guardrails"] ?? null),
  ]);
}

/** `json.dumps(..., sort_keys=True)` of one value, for the signature. */
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${serializeValue(k)}: ${sortedJson(v)}`).join(", ")}}`;
  }
  return serializeValue(value);
}

export type EvaluationRecordPlan = {
  /** `null` when the signature repeats the last evaluation: nothing to record. */
  readonly entry: Record<string, unknown> | null;
  /** The as-is `knob_evaluated` line; `null` with the entry. */
  readonly eventLine: string | null;
};

/**
 * Plan the recording of one evaluation (the baseline's `record_evaluation`):
 * one `evaluate` entry — never touching the apply entry — and one
 * `knob_evaluated` event, only when the result differs from the last
 * evaluation of the same decision, so re-approving a phase without new
 * samples adds nothing. `Fraction` values pass through unchanged; the
 * fraction-bearing members are wrapped by the caller where the baseline
 * writes a whole with a fraction (the arms carry plain numbers).
 */
export function planEvaluation(input: {
  readonly result: Record<string, unknown>;
  readonly entries: readonly Record<string, unknown>[];
  readonly runId: string;
  readonly evaluatedAt: string;
  readonly ts: string;
}): EvaluationRecordPlan {
  const { result, entries } = input;
  const last = lastEvaluation(entries, String(result["evaluates_run_id"]));
  if (last !== null && evaluationSignature(asRecord(last)) === evaluationSignature(result)) {
    return { entry: null, eventLine: null };
  }
  const entry: Record<string, unknown> = {
    ...result,
    schema: LEARN_APPLIED_SCHEMA,
    action: "evaluate",
    run_id: input.runId,
    evaluated_at: input.evaluatedAt,
  };
  const cost = (result["cost"] ?? {}) as Record<string, unknown>;
  const wall = (result["wall"] ?? {}) as Record<string, unknown>;
  const event: Record<string, unknown> = {
    event: "knob_evaluated",
    ts: input.ts,
    knob: result["knob"],
    phase: result["phase"],
    label: result["label"],
    action: result["action_taken"] ?? "evaluated",
    reset: result["reset"] ?? null,
    cost_r: cost["r"] ?? null,
    cost_mde: cost["mde"] ?? null,
    wall_r: wall["r"] ?? null,
    wall_mde: wall["mde"] ?? null,
    n_applied: cost["n_a"] ?? 0,
    n_baseline: cost["n_b"] ?? 0,
    run_id: input.runId,
    evaluates_run_id: result["evaluates_run_id"],
  };
  return { entry, eventLine: `${serializeValue(event)}\n` };
}

/** The fraction form of a whole-valued figure the baseline writes with a fraction. */
export function asFraction(value: number): { fraction: number } {
  return fraction(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}
