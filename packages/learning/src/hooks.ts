/**
 * T076 — the calls the engine makes into learning through the function
 * interface of F100-FR-235: `observe` after an approved phase, `evaluate`
 * for the active decisions of that phase, and the read-only report of the
 * last evaluations for the lines at exit.
 *
 * F106-FR-036: *When the mode is not `off`, the engine MUST, after each
 * approved phase, write the observation of that phase (F106-FR-006), record
 * learning.observed when it was written, and then run the evaluation of the
 * active decisions of that phase only, under the current shape of the phase
 * and not as a dry run, with its events going to the learning stream
 * (F106-FR-021), and MUST at exit print each line of the last recorded
 * evaluations, to standard output and to the engine log, when a decision log
 * exists. A failure of the observation or of the evaluation MUST be logged
 * as `#   (learning: … failed — continuing; the run is unaffected)` and MUST
 * NEVER undo the approval or change the result of the run.*
 *
 * THE FAILURE RULE IS CARRIED BY THE RESULT TYPE, NOT BY DISCIPLINE. Every
 * call here returns a result union and never raises into the run: a caller
 * that ignores `ok: false` has no observation and no evaluation in its hands,
 * only a line for the engine log. The lines of an observation, of an
 * evaluation and of an automatic revert in a run go to the engine log and not
 * to standard output; only the lines at exit go to both (F106-FR-036).
 *
 * The event learning.observed itself is an event of the RUN's stream, written
 * by the engine — learning never writes it (F106-FR-021, F106-FR-006). What
 * this module hands the engine is the record to append
 * (`observedEventRecord`) and the mark that the document was written
 * (`EngineObserveResult.written`), so a failed observation records no event.
 *
 * The evaluation is NOT a dry run: it evaluates, records when the signature
 * changed, and reverts on a guardrail breach (F106-FR-019), under the
 * writer-domain lock, from the deciding read to the last append
 * (F106-FR-038). Every free text written passes the one ingress first
 * (F106-FR-040); a refusal of the ingress writes nothing for that decision
 * and is returned as a result, never raised into the run.
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { activeDecisions, evaluateDecision } from "./evaluate.ts";
import { actOnEvaluation } from "./guardrails.ts";
import { readDecisionEntries } from "./events-reader.ts";
import { observe, type Observation } from "./observation.ts";
import { appendEntry } from "./decision-log.ts";
import {
  appendLearningEventLine,
  learningPaths,
  OBSERVED_EVENT_TYPE,
  withLearningLock,
} from "./stream.ts";
import {
  DECISION_ENTRY_FREE_TEXT_MEMBERS,
  LEARNING_EVENT_FREE_TEXT_MEMBERS,
  learningIngress,
  redactWrittenValue,
} from "./ingress.ts";

/** The prefix of a decision run id: `learn-` and twelve hexadecimal characters. */
export function newLearningRunId(): string {
  return `learn-${randomBytes(6).toString("hex")}`;
}

/** The line a failed call logs (F106-FR-036), word for word. */
export function learningFailureLine(what: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `#   (learning: ${what} failed (${message}) — continuing; the run is unaffected)`;
}

/** The result of one engine `observe` call. */
export type EngineObserveResult =
  | {
      readonly ok: true;
      /** True when the document was written: the engine records learning.observed. */
      readonly written: boolean;
      /** The observation the operation produced. */
      readonly observation: Observation;
      /** The line for the engine log, never for standard output (F106-FR-036). */
      readonly line: string;
    }
  | {
      readonly ok: false;
      /** The failure line for the engine log: the run is unaffected. */
      readonly line: string;
    };

/** What one engine `observe` call takes (F106-FR-006, F106-FR-036). */
export type EngineObserveInput = {
  /** The feature directory of the run; the document goes to `learning/phase-<N>.json`. */
  readonly featureDir: string;
  readonly phase: number;
  /** The shape the phase ran under; `null` when unrestricted. */
  readonly shape: string | null;
  /** The summary document of the run so far (F106-FR-004). */
  readonly summary: Record<string, unknown>;
  /** `generated_at`, UTC to the second, handed in by the engine's clock. */
  readonly generatedAt: string;
  /** What the figures were computed from, recorded in `inputs`. */
  readonly inputs?: Readonly<Record<string, unknown>>;
};

/**
 * `observe` after an approved phase (F100-FR-235, F106-FR-036). Never
 * raises: a failure comes back as `ok: false` with the engine-log line, and
 * nothing was written — the engine records no learning.observed then.
 */
export function engineObserve(input: EngineObserveInput): EngineObserveResult {
  const path = learningPaths(input.featureDir).observation(input.phase);
  try {
    const observation = observe({
      phase: input.phase,
      shape: input.shape,
      summary: input.summary,
      path,
      generatedAt: input.generatedAt,
      inputs: input.inputs,
    });
    return { ok: true, written: true, observation, line: observation.line };
  } catch (error) {
    return { ok: false, line: learningFailureLine(`observe of phase ${input.phase}`, error) };
  }
}

/**
 * The record the ENGINE appends to the event stream of the run after a
 * written observation (F106-FR-006, F106-FR-021): envelope
 * `specstride.event/1`, type learning.observed, with the phase and the
 * logical name. Learning never writes this event; the engine is the one
 * writer of the run's stream.
 */
export function observedEventRecord(input: {
  readonly seq: number;
  readonly ts: string;
  readonly runId: string;
  readonly phase: number;
  readonly logicalName: string;
}): Record<string, unknown> {
  return {
    schema: "specstride.event",
    v: 1,
    seq: input.seq,
    ts: input.ts,
    type: OBSERVED_EVENT_TYPE,
    runId: input.runId,
    data: { phase: input.phase, logical_name: input.logicalName },
  };
}

/** The result of one engine `evaluate` call. */
export type EngineEvaluateResult =
  | {
      readonly ok: true;
      /** One line per evaluated decision, for the engine log (F106-FR-036). */
      readonly lines: readonly string[];
      /** The automatic-revert lines, if a guardrail breached (F106-FR-019). */
      readonly revertLines: readonly string[];
    }
  | {
      readonly ok: false;
      readonly line: string;
    };

/** What one engine `evaluate` call takes (F106-FR-036). */
export type EngineEvaluateInput = {
  /** The feature directory; the decision log and the learning stream live under it. */
  readonly featureDir: string;
  readonly phase: number;
  /** The current shape of the phase; the evaluation runs under it, not dry. */
  readonly shape: string | null;
  /** The summary document of the run so far. */
  readonly summary: Record<string, unknown>;
  /** The run id of THIS run (the evaluating run). */
  readonly runId: string;
  /** `evaluated_at` / `applied_at`, UTC to the second, from the engine's clock. */
  readonly evaluatedAt: string;
  /** `time.time()` form of now, for the quarantine freshness clock. */
  readonly nowSeconds?: number;
};

/**
 * `evaluate` for the active decisions of ONE phase (F100-FR-235, F106-FR-036,
 * I2): not a dry run — each evaluation is recorded when its signature
 * changed, and a guardrail breach reverts the decision automatically
 * (F106-FR-019). The writer-domain lock is held from the deciding read to
 * the last append (F106-FR-038). Never raises into the run.
 */
export async function engineEvaluate(input: EngineEvaluateInput): Promise<EngineEvaluateResult> {
  try {
    const paths = learningPaths(input.featureDir);
    return await withLearningLock(input.featureDir, () => {
      const entries = readDecisionEntries(paths.decisions);
      const decisions = activeDecisions(entries, input.phase);
      const ingress = learningIngress();
      const lines: string[] = [];
      const revertLines: string[] = [];
      for (const decision of decisions) {
        const result = evaluateDecision(input.summary, decision, input.shape);
        const acted = actOnEvaluation({
          result,
          entries,
          revertRunId: newLearningRunId(),
          evaluatedRunId: newLearningRunId(),
          appliedAt: input.evaluatedAt,
          ts: input.evaluatedAt,
          revertedTs: input.nowSeconds,
        });
        for (const entry of [acted.evaluationEntry, acted.revertEntry]) {
          if (entry === null) continue;
          // The one ingress before the bytes exist (F106-FR-040): a refusal
          // throws before the file is opened, and this call returns it as a
          // result — nothing of this decision was written.
          appendEntry(
            paths.decisions,
            redactWrittenValue(entry, DECISION_ENTRY_FREE_TEXT_MEMBERS, ingress),
          );
        }
        for (const line of [
          acted.evaluationEventLine,
          acted.revertEventLine,
          acted.autoRevertedEventLine,
        ]) {
          if (line === null) continue;
          appendLearningEventLine(
            paths.events,
            redactWrittenValue(line, LEARNING_EVENT_FREE_TEXT_MEMBERS, ingress),
          );
        }
        if (acted.line !== null) revertLines.push(acted.line);
        lines.push(evaluationLineOf(result));
      }
      return { ok: true as const, lines, revertLines };
    });
  } catch (error) {
    return { ok: false, line: learningFailureLine(`evaluate of phase ${input.phase}`, error) };
  }
}

/**
 * The read-only report of the last evaluations for the lines at exit
 * (F106-FR-036): no decision log, no lines. Never raises.
 *
 * The lines are in the exit form the reference captures print
 * (`FX-01/106-learning-apply` / `FX-01/106-learning-tampered`) — the form of
 * `evaluationLineOf` for a recorded evaluation, and the `not evaluated yet`
 * form for an `apply` whose decision no evaluation has recorded yet — one
 * line per (knob, phase), the latest of each.
 */
export function lastEvaluationsReport(decisionsPath: string): readonly string[] {
  // F106-FR-036: the lines exist only WHEN A DECISION LOG EXISTS — no log on
  // disk, no lines at all (not even a "no active decisions" line).
  if (!existsSync(decisionsPath)) return [];
  let entries: Record<string, unknown>[];
  try {
    entries = readDecisionEntries(decisionsPath);
  } catch {
    return [];
  }
  try {
    // One line per (knob, phase), the LAST entry of each; the lines come out
    // in the order the keys first appear in the log.
    const byKey = new Map<string, string>();
    const order: string[] = [];
    for (const entry of entries) {
      const knob = entry["knob"];
      if (typeof knob !== "string") continue;
      const phase = String(entry["phase"] ?? "");
      const key = `${knob}\u0000${phase}`;
      if (!order.includes(key)) order.push(key);
      byKey.set(
        key,
        entry["action"] === "evaluate"
          ? evaluationLineOf(entry)
          : // An apply whose decision has no recorded evaluation yet
            // (`FX-01/106-learning-tampered`, the line at exit): the same form,
            // with `not evaluated yet` where the outcome goes.
            `learn: phase ${phase} ${knob} ${String(entry["previous"] ?? 0)}→${String(entry["value"] ?? 0)} ` +
              `[${String(entry["run_id"] ?? "")}]: not evaluated yet`,
      );
    }
    return order.map((key) => byKey.get(key)!);
  } catch {
    return [];
  }
}

/**
 * One exit line of an evaluation, in the form the reference captures print
 * (`FX-01/106-learning-apply`, the line at exit):
 * `learn: phase 1 proposer_timeout <a>→<b> [<id>]: insufficient (…) — cost n=0/0 (need 6/6); wall n=0/0 (need 6/6)`.
 */
export function evaluationLineOf(result: Record<string, unknown>): string {
  const cost = (result["cost"] ?? {}) as Record<string, unknown>;
  const wall = (result["wall"] ?? {}) as Record<string, unknown>;
  const n = (arm: Record<string, unknown>): string => `${arm["n_a"] ?? 0}/${arm["n_b"] ?? 0}`;
  const reason = result["reason"];
  const reset = result["reset"];
  const label =
    reset !== null && reset !== undefined
      ? `insufficient (baseline reset: ${String(reset)})`
      : result["label"] === "insufficient" && typeof reason === "string"
        ? `insufficient (${reason})`
        : String(result["label"] ?? "insufficient");
  return (
    `learn: phase ${result["phase"]} ${result["knob"]} ${result["previous"]}→${result["value"]} ` +
    `[${result["evaluates_run_id"]}]: ${label} — cost n=${n(cost)} (need 6/6); wall n=${n(wall)} (need 6/6)`
  );
}
