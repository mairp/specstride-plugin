/**
 * T037 — `apply` (F106-FR-014, F106-FR-015): one knob, one phase, one `apply`
 * entry in the decision log and one `learning.knob_adjusted` event in the
 * learning stream, and the returned entry.
 *
 * Refusals (F106-FR-014) write nothing and exit 3 with
 * `learn: refusing to apply — <reason>`: the phase has no telemetry
 * (`no telemetry for phase <N>`) or a sample floor is not met (the floor of
 * F106-FR-012/F106-FR-013 — floors are not options). A knob outside the
 * allowlist, a missing input, or no way to find the decision log exits 2.
 *
 * The entry is keyed under the phase shape: the shape the spec gives for the
 * phase, else the shape the phase's own `phase_start` events carry (F106-FR-019:
 * without a spec each decision's own recorded shape counts as the current one).
 *
 * The quarantine check and `--force` are added by T059; this module carries
 * the refusal machinery they extend, not the quarantine itself.
 *
 * Purity: the builders here touch no file; the caller (verb.ts) holds the
 * writer-domain lock across the deciding read and the appends (F106-FR-038).
 */
import { LEARN_APPLIED_SCHEMA, entryShape, fraction, toInt } from "./decision-log.ts";
import { isSample, type PassRecord } from "./metrics.ts";
import { quarantinedMessage, quarantineBlock } from "./quarantine.ts";
import { appliedLine } from "./lines.ts";
import type { AdjustableKnob } from "./knobs.ts";
import { floorReason, type SuggestionRow } from "./suggest.ts";
import { knobAdjustedMembersForApply, knobAdjustedAsisLine } from "./stream.ts";

/** The event reason of an applied knob (F106-FR-015, C-092). */
export function applyReasonOf(knob: AdjustableKnob): string {
  return knob === "proposer_timeout"
    ? "learned_from_work_sec_p90"
    : "learned_from_job_duration_p50";
}

/** The metric an applied knob was learned from (F106-FR-015). */
export function applyMetricOf(knob: AdjustableKnob): string {
  return knob === "proposer_timeout" ? "work_sec_p90" : "job_duration_p50";
}

/** Why `apply` must refuse this row, or `null` when it may go ahead (F106-FR-014). */
export function applyRefusalReason(row: SuggestionRow): string | null {
  if (row.value !== null) return null;
  if (row.samples === 0) return `no telemetry for phase ${row.phase}`;
  return floorReason(row.knob, row.samples);
}

/** UTC to the second in the captured form (`2026-01-05T00:00:00+00:00`). */
export function utcSeconds(when: Date = new Date()): string {
  return `${when.toISOString().slice(0, 19)}+00:00`;
}

/** The observed shape of a phase: the last `phase_start` shape its events carry. */
export function observedShapeOf(
  events: readonly Record<string, unknown>[],
  phase: number,
): string | null {
  let shape: string | null = null;
  for (const ev of events) {
    if (ev["event"] !== "phase_start") continue;
    if (toInt(ev["phase"]) !== phase) continue;
    const s = ev["shape"];
    if (typeof s === "string" && s !== "") shape = s;
  }
  return shape;
}

type AttemptLike = Record<string, unknown>;

/** The attempts of one phase, under the shape when one is keyed. */
function attemptsOfPhase(
  doc: Record<string, unknown>,
  phase: number,
  shape: string | null,
): AttemptLike[] {
  const atts = (doc["attempts"] ?? []) as AttemptLike[];
  return atts.filter((a) => {
    if (toInt(a["phase"]) !== phase) return false;
    if (shape !== null && a["shape"] !== shape) return false;
    return true;
  });
}

/**
 * The guardrail counts of an `apply` (and later of an `evaluate`) entry
 * (`data-model.md`, the guardrail-counts table): what the runs of the
 * baseline arm recorded for the phase.
 */
export function baselineGuardrails(
  doc: Record<string, unknown>,
  events: readonly Record<string, unknown>[],
  phase: number,
  shape: string | null,
): Record<string, unknown> {
  const atts = attemptsOfPhase(doc, phase, shape);
  // The verdicts the raw events of the phase recorded: a `verdict` event per
  // judged attempt, with its result and its attempt number.
  const verdictsOfPhase = events.filter(
    (e) => e["event"] === "verdict" && toInt(e["phase"]) === phase,
  );
  const verdictOfRun = new Map<string, Record<string, unknown>>();
  for (const v of verdictsOfPhase) {
    const run = String(v["run_id"] ?? "");
    const attempt = toInt(v["attempt"]);
    if (attempt === 1) verdictOfRun.set(run, v);
  }
  const count = (f: (a: AttemptLike) => boolean): number => atts.filter(f).length;
  const kills = (f: (reason: string) => boolean): number =>
    atts.reduce(
      (n, a) =>
        n +
        Object.entries((a["kills_by_reason"] ?? {}) as Record<string, number>).reduce(
          (m, [reason, k]) => (f(reason) ? m + k : m),
          0,
        ),
      0,
    );
  const runs = (doc["runs"] ?? []) as AttemptLike[];
  const arbitration = runs.filter((r) => {
    if (toInt(r["stop_phase"]) !== phase) return false;
    return ["max_rejects", "gate_oscillation", "critic_config", "proposer_no_progress"].includes(
      String(r["stop_reason"] ?? ""),
    );
  }).length;
  return {
    attempts: atts.length,
    verdicts: verdictsOfPhase.length,
    malformed: kills((reason) => reason.startsWith("malformed")),
    grounding_gap: count(
      (a) => toInt(a["grounding_gap_paths"]) !== null && toInt(a["grounding_gap_paths"])! > 0,
    ),
    verification_failed: count((a) => {
      const rc = toInt(a["verification_rc"]);
      return rc !== null && rc !== 0;
    }),
    first_verdicts: [...verdictOfRun.values()].length,
    first_approved: [...verdictOfRun.values()].filter((v) => v["result"] === "APPROVED").length,
    diagnostician_cases: count(
      (a) => typeof a["diagnostician_case"] === "string" && a["diagnostician_case"] !== "",
    ),
    diagnostician_grounding: count((a) =>
      String(a["diagnostician_case"] ?? "").startsWith("grounding"),
    ),
    episodes: new Set(atts.map((a) => String(a["run"] ?? ""))).size,
    arbitration,
    critic_prompt_bytes: atts
      .map((a) => a["critic_prompt_bytes"])
      .filter((v): v is number => typeof v === "number"),
  };
}

/**
 * The `baseline` member of an `apply` entry (`data-model.md`): the backend,
 * the shape, the runs, the per-sample cost and wall lists (`[run, value]`,
 * the whole-valued floats keeping their fraction) and the guardrail counts.
 */
export function baselineOf(input: {
  readonly doc: Record<string, unknown>;
  readonly phase: number;
  readonly shape: string | null;
  readonly runs: readonly string[];
  readonly events?: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  const { doc, phase, shape, runs, events = [] } = input;
  const atts = attemptsOfPhase(doc, phase, shape);
  const wanted = new Set(runs);
  const backendRuns = (doc["runs"] ?? []) as AttemptLike[];
  const backend =
    backendRuns
      .map((r) => (wanted.has(String(r["run"] ?? "")) ? r["backend"] : null))
      .find((b) => typeof b === "string" && b !== "") ?? null;
  const _samples: PassRecord[] = atts.flatMap((a) => (a["passes_detail"] ?? []) as PassRecord[]);
  const cost: [string, { fraction: number }][] = [];
  const wall: [string, { fraction: number }][] = [];
  for (const a of atts as { run?: unknown; passes_detail?: unknown }[]) {
    const run = String(a.run ?? "");
    for (const p of (a.passes_detail ?? []) as PassRecord[]) {
      if (!isSample(p)) continue;
      if (p.cost_usd !== null) cost.push([run, fraction(p.cost_usd)]);
      if (p.elapsed_sec !== null) wall.push([run, fraction(p.elapsed_sec)]);
    }
  }
  return {
    backend,
    shape,
    runs: [...runs],
    cost,
    wall,
    guardrails: baselineGuardrails(doc, events, phase, shape),
  };
}

/** One planned `apply`: the entry, its event line and the line it prints. */
export type ApplyPlan = {
  readonly refused: false;
  readonly entry: Record<string, unknown>;
  readonly eventLine: string;
  readonly line: string;
};
export type ApplyRefusal = {
  readonly refused: true;
  readonly reason: string;
  /** The exit code of the refusal; 3 by default, 4 for a quarantined apply. */
  readonly exit?: number;
};

/** Build the `apply` entry in the member order of F106-FR-008. */
export function buildApplyEntry(input: {
  readonly knob: AdjustableKnob;
  readonly phase: number;
  readonly shape: string | null;
  readonly value: number;
  readonly previous: number;
  readonly samples: number;
  readonly sourceRuns: readonly string[];
  readonly runId: string;
  readonly doc: Record<string, unknown>;
  readonly events?: readonly Record<string, unknown>[];
  readonly appliedAt: string;
}): Record<string, unknown> {
  return {
    schema: LEARN_APPLIED_SCHEMA,
    action: "apply",
    run_id: input.runId,
    knob: input.knob,
    phase: input.phase,
    shape: input.shape,
    value: input.value,
    previous: input.previous,
    samples: input.samples,
    source_runs: [...input.sourceRuns],
    metric: applyMetricOf(input.knob),
    applied_at: input.appliedAt,
    baseline: baselineOf({
      doc: input.doc,
      events: input.events,
      phase: input.phase,
      shape: input.shape,
      runs: input.sourceRuns,
    }),
  };
}

/** The as-is line of the `learning.knob_adjusted` event of an apply (C-090, C-092). */
export function applyEventLine(input: {
  readonly knob: AdjustableKnob;
  readonly phase: number;
  readonly from: number;
  readonly to: number;
  readonly samples: number;
  readonly runId: string;
  readonly ts: string;
}): string {
  return knobAdjustedAsisLine(
    knobAdjustedMembersForApply({
      knob: input.knob,
      phase: input.phase,
      from: input.from,
      to: input.to,
      reason: applyReasonOf(input.knob),
      metric: applyMetricOf(input.knob),
      samples: input.samples,
      runId: input.runId,
      ts: input.ts,
    }),
  );
}

/** Plan the whole `apply` of one suggestion row (F106-FR-014, F106-FR-015, F106-FR-020). */
export function planApply(input: {
  readonly row: SuggestionRow;
  readonly runId: string;
  readonly shape: string | null;
  readonly doc: Record<string, unknown>;
  readonly events?: readonly Record<string, unknown>[];
  readonly entries?: readonly Record<string, unknown>[];
  readonly summary?: Record<string, unknown>;
  readonly force?: boolean;
  readonly appliedFile: string;
  readonly appliedAt: string;
  readonly ts: string;
}): ApplyRefusal | ApplyPlan {
  const reason = applyRefusalReason(input.row);
  if (reason !== null) return { refused: true, reason };
  const entry = buildApplyEntry({
    knob: input.row.knob,
    phase: input.row.phase,
    shape: input.shape,
    value: input.row.value!,
    previous: input.row.current,
    samples: input.row.samples,
    sourceRuns: sourceRunsOf(input.doc, input.row.phase, input.shape),
    runId: input.runId,
    doc: input.doc,
    events: input.events,
    appliedAt: input.appliedAt,
  });
  if (input.entries !== undefined && input.summary !== undefined) {
    const baseline = (entry["baseline"] ?? null) as Record<string, unknown> | null;
    const block = quarantineBlock({
      entries: input.entries,
      summary: input.summary,
      knob: String(entry["knob"]),
      phase: toInt(entry["phase"]) ?? 0,
      shape: entryShape(entry),
      backend: baseline?.["backend"] ?? null,
      value: typeof entry["value"] === "number" ? entry["value"] : toInt(entry["value"]),
    });
    if (block !== null && !input.force) {
      return {
        refused: true,
        reason: quarantinedMessage(block, Number(entry["value"])),
        exit: 4,
      };
    }
    if (block !== null && input.force) {
      // F106-FR-015: the forced entry records what it overrode
      (entry as Record<string, unknown>)["force"] = true;
      (entry as Record<string, unknown>)["forced_over"] = block.runId;
    }
  }
  return {
    refused: false,
    entry,
    eventLine: applyEventLine({
      knob: input.row.knob,
      phase: input.row.phase,
      from: input.row.current,
      to: input.row.value!,
      samples: input.row.samples,
      runId: input.runId,
      ts: input.ts,
    }),
    line: appliedMessageLine({
      knob: input.row.knob,
      phase: input.row.phase,
      previous: input.row.current,
      value: input.row.value!,
      samples: input.row.samples,
      runId: input.runId,
      appliedFile: input.appliedFile,
    }),
  };
}

/** The runs the samples of a phase came from (the `source_runs` of the entry). */
export function sourceRunsOf(
  doc: Record<string, unknown>,
  phase: number,
  shape: string | null,
): string[] {
  const out: string[] = [];
  for (const a of attemptsOfPhase(doc, phase, shape)) {
    const run = String(a["run"] ?? "");
    if (run && !out.includes(run)) out.push(run);
  }
  return out;
}

/** The line an applied decision prints (F106-FR-026); the caller decides the path form. */
export function appliedMessageLine(input: {
  readonly knob: string;
  readonly phase: number;
  readonly previous: number;
  readonly value: number;
  readonly samples: number;
  readonly runId: string;
  readonly appliedFile: string;
}): string {
  return appliedLine(input);
}
