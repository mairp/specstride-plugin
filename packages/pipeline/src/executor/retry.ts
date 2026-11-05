/**
 * T015 — in-stage retry (F123-FR-012).
 *
 * The retry follows the declared recovery of the stage:
 *
 * - attempts up to the maximum (default 1);
 * - from the second attempt the resume action replaces the action when one
 *   is declared;
 * - a failed attempt is retried only when its exit code is in the declared
 *   list and, where a reason rule is declared, the newest stop reason is one
 *   of the allowed reasons;
 * - the delay is the declared backoff at index `min(attempt-1, length-1)`,
 *   or 0;
 * - when the elapsed time reaches the declared total time limit the retry
 *   stops with the stage reason `recovery-deadline`.
 *
 * A child exit 0 with a failed postcondition prints
 * `[ERROR] <stage> postcondition: <failure>`, ends with the reason
 * `postcondition`, and is never retried. The lines: `[RECOVER] <stage> exit
 * <code>[, reason=<reason>]; retry in <delay>s`, `[FAIL] <stage> exit <code>
 * (<outcome>)`, `[PASS] <stage> completed`. The stage reason
 * `recovery-exhausted` is accepted and is never produced.
 */
import type { Action, Clock, Recovery, Stage } from "./types.ts";
import { retryAllowedUnderReasonRule, type TerminalRecord } from "./outcome.ts";
import type { ChildRun } from "./child.ts";
import { redactAction } from "../output/lines.ts";
import { emitStageStarted, emitStageEnded, type EventPort } from "./events.ts";

/** An accepted stage reason that no code path of this module produces. */
export const ACCEPTED_NEVER_PRODUCED = "recovery-exhausted" as const;

/** One printed event of a retry, in the order it happened. */
export type RetryLine =
  | { label: "[RUN]"; text: string }
  | { label: "[RECOVER]"; text: string }
  | { label: "[FAIL]"; text: string }
  | { label: "[PASS]"; text: string }
  | { label: "[ERROR]"; text: string };

/** What the retry driver did with the stage. */
export type RetryOutcome = {
  ok: boolean;
  reason:
    | "completed"
    | "postcondition"
    | "recovery-deadline"
    | `exit:${number}`
    | `exec-error: ${string}`;
  childExitCode: number | null;
  stopReason: string | null;
  lines: RetryLine[];
};

/** The runner of one attempt: the stage child runner, injected. */
export type AttemptRunner = (input: {
  stage: Stage;
  action: Action;
  attempt: number;
  maxAttempts: number;
}) => Promise<ChildRun>;

/** The reader of the newest terminal record; called again on every attempt. */
export type TerminalReader = () => TerminalRecord | null;

/** The reader of the postconditions: the list of their failures, empty when they hold. */
export type PostconditionReader = () => Promise<string[]>;

/** The backoff before attempt `attempt` (the first attempt has none). */
export function backoffForAttempt(recovery: Recovery, attempt: number): number {
  if (attempt <= 1) return 0;
  const list = recovery.backoffSeconds;
  if (list.length === 0) return 0;
  return list[Math.min(attempt - 1, list.length - 1)] ?? 0;
}

/**
 * Drive the attempts of one stage (F123-FR-012). Pure in its decisions, over
 * the injected runner, clock, terminal reader and postcondition reader.
 */
export async function runWithRetry(input: {
  stage: Stage;
  recovery: Recovery;
  runner: AttemptRunner;
  clock: Clock;
  readTerminal: TerminalReader;
  readPostconditionFailures: PostconditionReader;
  /** The event port: one `stage.started`/`stage.ended` pair per attempt (F123-FR-018). */
  events?: EventPort;
  pipelineId?: string;
}): Promise<RetryOutcome> {
  const { stage, recovery } = input;
  const events = input.events;
  const pipelineId = input.pipelineId ?? "pipeline";
  const maxAttempts = Math.max(1, recovery.maxAttempts);
  const startedAt = input.clock.now();
  const totalMs = recovery.totalSeconds === undefined ? undefined : recovery.totalSeconds * 1_000;
  const lines: RetryLine[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const action = attempt === 1 ? stage.action : (stage.resumeAction ?? stage.action);
    if (action === undefined) {
      return {
        ok: false,
        reason: "exec-error: the stage declares no action",
        childExitCode: 127,
        stopReason: null,
        lines,
      };
    }
    lines.push({
      label: "[RUN]",
      text: `${stage.id} attempt ${attempt}/${maxAttempts}: ${redactAction({ argv: action.argv, env: action.env })}`,
    });
    if (events !== undefined) {
      emitStageStarted(
        events,
        { pipeline: pipelineId, stage: stage.id, attempt },
        input.clock.now(),
      );
    }

    const result = await input.runner({ stage, action, attempt, maxAttempts });
    const stopReason = input.readTerminal()?.stop_reason ?? null;

    if (result.code === 0) {
      const failures = await input.readPostconditionFailures();
      if (failures.length > 0) {
        // Exit 0 with a failed postcondition: never retried (F123-FR-012).
        lines.push({ label: "[ERROR]", text: `${stage.id} postcondition: ${failures[0]}` });
        if (events !== undefined) {
          emitStageEnded(
            events,
            {
              pipeline: pipelineId,
              stage: stage.id,
              attempt,
              ok: false,
              reason: "postcondition",
              childExitCode: 0,
            },
            input.clock.now(),
          );
        }
        return { ok: false, reason: "postcondition", childExitCode: 0, stopReason, lines };
      }
      lines.push({ label: "[PASS]", text: `${stage.id} completed` });
      if (events !== undefined) {
        emitStageEnded(
          events,
          {
            pipeline: pipelineId,
            stage: stage.id,
            attempt,
            ok: true,
            reason: "completed",
            childExitCode: 0,
          },
          input.clock.now(),
        );
      }
      return { ok: true, reason: "completed", childExitCode: 0, stopReason, lines };
    }

    // A failure: retry only under the declared exit codes and the reason rule.
    const codeAllowed = recovery.exitCodes.includes(result.code);
    const reasonAllowed = retryAllowedUnderReasonRule({
      rule: recovery.reasonRule,
      stopReason,
    });
    const moreAttempts = attempt < maxAttempts;

    if (recovery.totalSeconds !== undefined) {
      const elapsed = input.clock.now() - startedAt;
      if (totalMs !== undefined && elapsed >= totalMs) {
        lines.push({
          label: "[FAIL]",
          text: `${stage.id} exit ${result.code} (recovery-deadline)`,
        });
        if (events !== undefined) {
          emitStageEnded(
            events,
            {
              pipeline: pipelineId,
              stage: stage.id,
              attempt,
              ok: false,
              reason: "recovery-deadline",
              childExitCode: result.code,
            },
            input.clock.now(),
          );
        }
        return {
          ok: false,
          reason: "recovery-deadline",
          childExitCode: result.code,
          stopReason,
          lines,
        };
      }
    }

    if (!moreAttempts || !codeAllowed || !reasonAllowed) {
      lines.push({
        label: "[FAIL]",
        text: `${stage.id} exit ${result.code} (exit:${result.code})`,
      });
      if (events !== undefined) {
        emitStageEnded(
          events,
          {
            pipeline: pipelineId,
            stage: stage.id,
            attempt,
            ok: false,
            reason: `exit:${result.code}`,
            childExitCode: result.code,
          },
          input.clock.now(),
        );
      }
      return {
        ok: false,
        reason: `exit:${result.code}`,
        childExitCode: result.code,
        stopReason,
        lines,
      };
    }

    const delay = backoffForAttempt(recovery, attempt + 1);
    const reasonPart = stopReason === null ? "" : `, reason=${stopReason}`;
    lines.push({
      label: "[RECOVER]",
      text: `${stage.id} exit ${result.code}${reasonPart}; retry in ${delay}s`,
    });
    if (events !== undefined) {
      // The attempt that is retried still ends: its pair closes before the
      // next `stage.started` of the following attempt.
      emitStageEnded(
        events,
        {
          pipeline: pipelineId,
          stage: stage.id,
          attempt,
          ok: false,
          reason: `exit:${result.code}`,
          childExitCode: result.code,
        },
        input.clock.now(),
      );
    }
    if (delay > 0) await input.clock.sleep(delay * 1_000);
  }

  // Unreachable while maxAttempts >= 1, but the reason stays accepted.
  return {
    ok: false,
    reason: "recovery-deadline",
    childExitCode: null,
    stopReason: null,
    lines,
  };
}
