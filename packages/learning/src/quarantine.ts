/**
 * T059 — the quarantine (F106-FR-020): the value an automatic revert retired
 * stays refused until enough new evidence accrued.
 *
 * Ported unchanged from the baseline (`lib/learn.py` at the pinned commit
 * `9cab15d2`): `quarantine_block`. A value within ±10 % of a quarantined one
 * stays refused for (knob, phase, shape, backend) until `QUARANTINE_SAMPLES`
 * new non-futility samples of the phase accrued after the revert; a shape or
 * backend change is a different key, so it clears.
 *
 * The check and `--force` are wired into `apply` in `apply.ts`; `--force`
 * over a quarantine adds `force` and `forced_over` to the `apply` entry
 * (F106-FR-015) and exits 0, while the refusal itself exits 4 (F106-FR-022,
 * annex G §G.4).
 *
 * Purity: the block is computed from the entries and the summary handed in;
 * the caller holds the writer-domain lock.
 */
import { entryShape, toInt } from "./decision-log.ts";
import { isSample, type PassRecord } from "./metrics.ts";

/** ±10 % of a quarantined value (QUARANTINE_BAND). */
export const QUARANTINE_BAND = 0.1 as const;
/** New non-futility samples before a quarantined value may return (QUARANTINE_SAMPLES). */
export const QUARANTINE_SAMPLES = 6 as const;

type EntryLike = Record<string, unknown>;
type AttemptLike = Record<string, unknown>;
type MetaLike = Record<string, unknown>;

/** The auto-revert that quarantined a value, with the fresh-sample count. */
export type QuarantineBlock = {
  readonly entry: EntryLike;
  readonly runId: string;
  readonly revertsRunId: string;
  readonly quarantinedValue: number;
  readonly guardrail: readonly string[];
  readonly freshSamples: number;
};

function attemptsOfPhase(
  doc: Record<string, unknown>,
  phase: number,
  shape: string | null,
  runs: ReadonlySet<string>,
): AttemptLike[] {
  const atts = (doc["attempts"] ?? []) as AttemptLike[];
  return atts.filter((a) => {
    if (toInt(a["phase"]) !== phase) return false;
    if (!runs.has(String(a["run"] ?? ""))) return false;
    if (shape !== null && a["shape"] !== shape) return false;
    return true;
  });
}

/** The billed non-futility samples of the attempts, counted (the baseline counts `cost`). */
function sampleCount(attempts: readonly AttemptLike[]): number {
  let n = 0;
  for (const a of attempts) {
    for (const p of (a["passes_detail"] ?? []) as PassRecord[]) {
      if (isSample(p)) n++;
    }
  }
  return n;
}

/**
 * The auto-revert that quarantines `value` for (knob, phase, shape, backend),
 * or `null` (the baseline's `quarantine_block`).
 */
export function quarantineBlock(input: {
  readonly entries: readonly EntryLike[];
  readonly summary: Record<string, unknown>;
  readonly knob: string;
  readonly phase: number;
  readonly shape: string | null;
  readonly backend: unknown;
  readonly value: number | null;
}): QuarantineBlock | null {
  const { entries, summary, knob, phase, shape, backend } = input;
  const value = input.value;
  if (value === null || !Number.isFinite(value)) return null;
  const runsMeta: Record<string, MetaLike> = {};
  for (const r of (summary["runs"] ?? []) as MetaLike[]) {
    const run = String(r["run"] ?? "");
    if (run) runsMeta[run] = r;
  }
  for (const e of [...entries].reverse()) {
    if (
      e["action"] !== "revert" ||
      e["auto"] !== true ||
      e["knob"] !== knob ||
      toInt(e["phase"]) !== phase ||
      (entryShape(e) ?? null) !== (shape ?? null) ||
      e["backend"] !== backend
    ) {
      continue;
    }
    const q = typeof e["quarantined_value"] === "number" ? e["quarantined_value"] : null;
    if (q === null || Math.abs(value - q) > QUARANTINE_BAND * Math.abs(q)) continue;
    const after = typeof e["reverted_ts"] === "number" ? e["reverted_ts"] : 0.0;
    const fresh = Object.entries(runsMeta)
      .filter(
        ([, meta]) =>
          (typeof meta["started"] === "number" ? meta["started"] : 0) > after &&
          meta["backend"] === backend,
      )
      .map(([r]) => r);
    const n = sampleCount(attemptsOfPhase(summary, phase, shape, new Set(fresh)));
    if (n < QUARANTINE_SAMPLES) {
      return {
        entry: e,
        runId: String(e["run_id"] ?? ""),
        revertsRunId: String(e["reverts_run_id"] ?? ""),
        quarantinedValue: q,
        guardrail: (e["guardrail"] ?? []) as string[],
        freshSamples: n,
      };
    }
  }
  return null;
}

/**
 * The refusal of a quarantined apply (F106-FR-020, exit 4), without the
 * `learn: refusing to apply — ` prefix the caller adds (the message of the
 * captured `FX-29/quarantined` golden).
 */
export function quarantinedMessage(block: QuarantineBlock, value: number): string {
  const { runId, revertsRunId, quarantinedValue, guardrail, freshSamples } = block;
  return (
    `quarantined: ${value} is within ±${Math.round(QUARANTINE_BAND * 100)}% ` +
    `of ${quarantinedValue}, auto-reverted by ${runId} (reverting ${revertsRunId}, guardrail ` +
    `${guardrail.join(",")}); ${freshSamples} of ${QUARANTINE_SAMPLES} new samples since — ` +
    "pass --force to apply anyway"
  );
}
