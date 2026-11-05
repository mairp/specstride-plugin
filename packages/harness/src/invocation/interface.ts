/**
 * T045 — the function interface of `@specstride/contracts` through which the
 * engine calls reconciliation, finalization and the retention sweep
 * (F100-FR-237 as proposed in `analyze-report.md`, P1; F126-FR-033 to
 * F126-FR-035, F126-FR-037).
 *
 * The types are declared in `@specstride/contracts/engine/finalization`
 * (F100-FR-237); this module is the one implementation of them, in
 * `@specstride/harness` (F126-FR-033 to F126-FR-035), which the composition
 * root (`@specstride/runtime`, `@specstride/cli`) hands to the engine. The
 * core never imports `@specstride/harness`: the interface is a plain function
 * object, handed in.
 *
 * `reconcile` is pure: it folds the observations of one invocation into the
 * result shape of the contract. `finalize` decides from the breaker state,
 * the limit and the optional kill and cap limits, folding the result into
 * the breakers through the state path the composition root binds.
 * `sweepRetention` sweeps the invocations of one run under the root the
 * composition root binds.
 */
import type {
  BreakerState,
  Finalization,
  FinalizationDecision,
  FinalizationEvent,
  FinalizationLimit,
  FinalizationOutcome,
  Finalize,
  InvocationIdentity,
  InvocationObservation,
  InvocationResult,
  KillClass,
  Reconcile,
  RetentionSweepOutcome,
  SweepRetention,
} from "@specstride/contracts/engine/finalization";
import {
  classifyKillReason,
  reconcileInvocation,
  type ProviderTerminalObservation,
} from "./reconcile.ts";
import { decideAfterFold } from "./finalization.ts";
import { foldIntoBreakers, saveBreakerState, type BreakerFields } from "./breakers.ts";
import type { ProducerFields } from "./writers.ts";
import { sweepRetentionFor } from "./retention.ts";

/** The number of an observation value, or null. */
function numberOf(values: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The text of an observation value, or null. */
function textOf(values: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = values[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The producer fields an observation carries, where it names them. */
export function producerFieldsOfObservation(
  observation: InvocationObservation,
): ProducerFields | null {
  const exit = numberOf(observation.values, "producer_exit_code");
  const parser = numberOf(observation.values, "parser_exit_code");
  if (exit === null && parser === null) return null;
  return {
    producer_exit_code: exit,
    producer_signal: textOf(observation.values, "producer_signal"),
    parser_exit_code: parser,
    timed_out: observation.values["timed_out"] === true,
    launch_failed: observation.values["launch_failed"] === true,
    duration_ms: numberOf(observation.values, "duration_ms") ?? 0,
  };
}

/**
 * `reconcile` — the observations of one invocation into a result
 * (F100-FR-237, F126-FR-033). An observation whose source is `provider-terminal`
 * carries the provider terminal; one whose source is `producer` (or any
 * observation naming the producer fields) carries the exit; the flags
 * `malformed_stream`, `unsupported_schema` and `cancelled` are read as data
 * from the values.
 */
export const reconcileObservations: Reconcile = (
  invocation: InvocationIdentity,
  observations: readonly InvocationObservation[],
): InvocationResult => {
  let producer: ProducerFields | null = null;
  let terminal: {
    status: "error" | "success";
    reasonCode: string | null;
    reason: string | null;
    stopReason: string | null;
  } | null = null;
  let malformedStream = false;
  let unsupportedSchema = false;
  let cancelled = false;
  for (const observation of observations) {
    const fromObservation = producerFieldsOfObservation(observation);
    if (fromObservation !== null && producer === null) producer = fromObservation;
    if (observation.source === "provider-terminal" || terminal === null) {
      const status = observation.values["provider_terminal"];
      if (status === "error" || status === "success") {
        terminal = {
          status,
          reasonCode: textOf(observation.values, "reason_code"),
          reason: textOf(observation.values, "reason"),
          stopReason: textOf(observation.values, "stop_reason"),
          extra: undefined,
        } as ProviderTerminalObservation;
      }
    }
    malformedStream = malformedStream || observation.values["malformed_stream"] === true;
    unsupportedSchema = unsupportedSchema || observation.values["unsupported_schema"] === true;
    cancelled = cancelled || observation.values["cancelled"] === true;
  }
  const outcome = reconcileInvocation({
    producer: producer ?? {
      producer_exit_code: null,
      producer_signal: null,
      parser_exit_code: null,
      timed_out: false,
      launch_failed: false,
      duration_ms: 0,
    },
    providerTerminal: terminal,
    malformedStream,
    unsupportedSchema,
    cancelled,
  });
  return {
    invocation,
    isError: outcome.status !== "success",
    reasonCode: outcome.reason_code,
    exitCode: producer === null ? null : producer.producer_exit_code,
    observations,
  };
};

/** The breaker fields the fold starts from, as the contract reads them. */
function breakerFieldsOf(state: BreakerState): BreakerFields {
  return {
    count: state.consecutiveErrors,
    cap_count: 0,
    last_invocation_id: null,
    last_reason_code: null,
    last_kill_class: null,
  };
}

/**
 * `finalize` — the decision, the reason code, `is_error`, the count of
 * consecutive errors, the kill class and the cap count (F126-FR-034). Where
 * the composition root binds a reader of the durable result, the outcome of
 * that result decides `is_error` and the reason code; without one, the
 * kill reason does.
 */
export function finalizeOf(deps: {
  /** The durable result of the invocation, where it was reconciled already. */
  readonly readResult?:
    | ((invocation: InvocationIdentity) => {
        readonly isError: boolean;
        readonly reasonCode: string;
      } | null)
    | undefined;
  /** Where the folded breaker state is kept, as the `core` counters file. */
  readonly breakerStatePath?: ((invocation: InvocationIdentity) => string) | undefined;
}): Finalize {
  return (
    invocation: InvocationIdentity,
    breaker: BreakerState,
    limit: FinalizationLimit,
    killReason?: string | undefined,
    capLimit?: number | undefined,
  ): FinalizationOutcome => {
    const killClass: KillClass | "unknown" | null =
      killReason === undefined ? null : (classifyKillReason(killReason) as KillClass | null);
    const durable = deps.readResult?.(invocation) ?? null;
    const isError = durable !== null ? durable.isError : killClass !== null;
    const reasonCode = durable !== null ? durable.reasonCode : (killClass ?? "");
    const fields = breakerFieldsOf(breaker);
    const after = foldIntoBreakers(fields, {
      invocationId: invocation.invocationId,
      isError,
      reasonCode,
      killClass,
    });
    // The decision reads the folded state: a success resets the count (F126-FR-034).
    const decision: FinalizationDecision = decideAfterFold(
      after,
      limit.consecutiveErrorLimit,
      capLimit ?? 0,
    );
    // The folded state is kept where the composition root binds it.
    const statePath = deps.breakerStatePath?.(invocation);
    if (statePath !== undefined) saveBreakerState(statePath, after);
    const event: FinalizationEvent = {
      event: "agent_result",
      invocation,
      values: {
        status: isError ? "error" : "done",
        reason_code: reasonCode,
        is_error: isError,
      },
    };
    return {
      decision,
      reasonCode,
      is_error: isError,
      consecutiveErrors: after.count,
      killClass,
      capCount: after.cap_count,
      result: {
        invocation,
        isError,
        reasonCode,
        exitCode: null,
        observations: [],
      },
      event,
    };
  };
}

/**
 * `sweepRetention` — the invocations of a run (F126-FR-037), bound to the
 * control-plane root the composition root hands in.
 */
export function sweepRetentionOf(root: string): SweepRetention {
  const sweep = sweepRetentionFor(root);
  return (runId: string): RetentionSweepOutcome => sweep(runId);
}

/**
 * The one interface object (F100-FR-237): plain functions, handed to the
 * engine by the composition root.
 */
export function invocationFinalization(deps: {
  readonly root: string;
  readonly readResult?:
    | ((invocation: InvocationIdentity) => {
        readonly isError: boolean;
        readonly reasonCode: string;
      } | null)
    | undefined;
  readonly breakerStatePath?: ((invocation: InvocationIdentity) => string) | undefined;
}): Finalization {
  return {
    reconcile: reconcileObservations,
    finalize: finalizeOf(deps),
    sweepRetention: sweepRetentionOf(deps.root),
  };
}
