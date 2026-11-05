/**
 * T017 — the core side of the harness port (EP-02) (F109-FR-003).
 *
 * The seam offers the eight operations of feature 100, annex C §C.1 and
 * reaches a harness adapter only through them. Every operation here:
 *
 *  1. asks the terms gate FIRST, and refuses the call unless the decision
 *     allows it at that moment;
 *  2. runs under a time limit, which is configuration (the keys of the limits
 *     are feature 110's) and is recorded with the run;
 *  3. takes the path of annex C §C.1 "Failure of an implementation" when the
 *     adapter throws, runs over its limit or returns a value outside the
 *     operation's result set: the degradation is recorded and NO verdict, NO
 *     exit code and NO stop reason of the harness adapter is passed on.
 */

/** The eight operations of the harness port, in the order of annex C §C.1. */
export const PORT_OPERATIONS = [
  "detect",
  "capabilities",
  "preflight",
  "startPass",
  "complete",
  "stop",
  "betweenPasses",
  "classify",
] as const;
export type PortOperation = (typeof PORT_OPERATIONS)[number];

/** Why an operation took the path "Failure of an implementation". */
export const DEGRADATION_REASONS = ["threw", "timeout", "unknown-value"] as const;
export type DegradationReason = (typeof DEGRADATION_REASONS)[number];

/** The record of one degradation. It never carries the adapter's verdict. */
export type Degradation = {
  readonly operation: PortOperation;
  readonly reason: DegradationReason;
  /** Detail text of the cause, for the record only. */
  readonly detail: string;
};

/** The decision of the terms gate before every call of a harness. */
export type TermsDecision = {
  readonly allowed: boolean;
  readonly reason?: string;
};

export type TermsGate = {
  decide(operation: PortOperation): TermsDecision;
};

/** Time limits per operation, in milliseconds; configuration, recorded with the run. */
export type TimeLimits = Readonly<Record<PortOperation, number>>;

/** The result sets of the operations; a value outside one is an unknown value. */
export type OperationResultSets = {
  detect: "a record with a truth value `present`";
  capabilities: "a record of capabilities";
  preflight: "a truth value";
  startPass: "a handle with `pid`, the raw stream and `sessionId`";
  complete: "a record with a text `reply`";
  stop: "a record with a truth value `ended`";
  betweenPasses: "one of `continue`, `stop:4`, `stop:7`";
  classify: "a member of the closed vocabulary of typed failures";
};

/** The typed failures of the harness port (closed set, row 36 of annex X §X.6). */
export const TYPED_FAILURES = [
  "authentication_failed",
  "rate_limited",
  "quota_exhausted",
  "context_window_exceeded",
  "transport_failed",
  "agent_failure",
  "capability_absent",
  "critic_not_toolless",
] as const;
export type TypedFailure = (typeof TYPED_FAILURES)[number];

/** The outcomes of `betweenPasses` (closed set, row 37). */
export const BETWEEN_PASSES_OUTCOMES = ["continue", "stop:4", "stop:7"] as const;
export type BetweenPassesOutcome = (typeof BETWEEN_PASSES_OUTCOMES)[number];

/** What a call of the port returns; `degraded` never carries an adapter value. */
export type PortCallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly degraded: true; readonly degradation: Degradation };

/** What the adapter of a port does: one function per operation. */
export type HarnessAdapter = {
  detect?(): unknown;
  capabilities?(): unknown;
  preflight?(input: { readonly role: string }): unknown;
  startPass?(input: unknown): unknown;
  complete?(input: unknown): unknown;
  stop?(input: unknown): unknown;
  betweenPasses?(input: unknown): unknown;
  classify?(input: unknown): unknown;
};

export type HarnessPortOptions = {
  readonly adapter: HarnessAdapter;
  /** Time limits per operation, in milliseconds. */
  readonly timeLimits: TimeLimits;
  /** Asked before EVERY call of a harness; the call is refused unless allowed. */
  readonly termsGate: TermsGate;
  /** Receives every degradation and every refusal of the terms gate. */
  readonly onDegradation?: (degradation: Degradation) => void;
};

/** Default time limit where the configuration gives none (generous, never zero). */
export const DEFAULT_TIME_LIMIT_MS = 30_000 as const;

function resultIsInSet(operation: PortOperation, value: unknown): boolean {
  switch (operation) {
    case "detect":
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { present?: unknown }).present === "boolean"
      );
    case "capabilities":
      return typeof value === "object" && value !== null;
    case "preflight":
      return typeof value === "boolean";
    case "startPass": {
      if (typeof value !== "object" || value === null) {
        return false;
      }
      const handle = value as { pid?: unknown; sessionId?: unknown };
      return typeof handle.pid === "number" && typeof handle.sessionId === "string";
    }
    case "complete":
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { reply?: unknown }).reply === "string"
      );
    case "stop":
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { ended?: unknown }).ended === "boolean"
      );
    case "betweenPasses":
      return (
        typeof value === "string" && (BETWEEN_PASSES_OUTCOMES as readonly string[]).includes(value)
      );
    case "classify":
      return typeof value === "string" && (TYPED_FAILURES as readonly string[]).includes(value);
  }
}

/**
 * The one call path every operation goes through: the terms gate first, then
 * the time limit, then the result set. A throw, a time-out and an unknown
 * value all land on the same degradation path.
 */
export async function callOperation<T = unknown>(
  options: HarnessPortOptions,
  operation: PortOperation,
  input: unknown,
): Promise<PortCallResult<T>> {
  // The terms gate is asked before every call, without exception.
  const decision = options.termsGate.decide(operation);
  if (!decision.allowed) {
    const degradation: Degradation = {
      operation,
      reason: "threw",
      detail: `the terms gate refused the call${decision.reason ? `: ${decision.reason}` : ""}`,
    };
    options.onDegradation?.(degradation);
    return { ok: false, degraded: true, degradation };
  }

  const fn = options.adapter[operation];
  if (typeof fn !== "function") {
    const degradation: Degradation = {
      operation,
      reason: "threw",
      detail: "the harness adapter holds no implementation of the operation",
    };
    options.onDegradation?.(degradation);
    return { ok: false, degraded: true, degradation };
  }

  const limitMs = options.timeLimits[operation] ?? DEFAULT_TIME_LIMIT_MS;
  let value: unknown;
  try {
    value = await Promise.race([
      Promise.resolve((fn as (i: unknown) => unknown).call(options.adapter, input)),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`the operation ran over its time limit of ${limitMs} ms`)),
          limitMs,
        );
      }),
    ]);
  } catch (error) {
    const overTime = error instanceof Error && error.message.includes("time limit");
    const degradation: Degradation = {
      operation,
      reason: overTime ? "timeout" : "threw",
      detail: error instanceof Error ? error.message : String(error),
    };
    options.onDegradation?.(degradation);
    return { ok: false, degraded: true, degradation };
  }

  if (!resultIsInSet(operation, value)) {
    // An unknown value: no verdict, no exit code and no stop reason passes on.
    const degradation: Degradation = {
      operation,
      reason: "unknown-value",
      detail: `the value the adapter returned is outside the result set of \`${operation}\` (${value === undefined ? "undefined" : typeof value})`,
    };
    options.onDegradation?.(degradation);
    return { ok: false, degraded: true, degradation };
  }

  return { ok: true, value: value as T };
}

/** The port as the engine holds it: one method per operation of annex C §C.1. */
export type HarnessPort = {
  readonly operations: typeof PORT_OPERATIONS;
  readonly timeLimits: TimeLimits;
  detect(): Promise<PortCallResult<unknown>>;
  capabilities(): Promise<PortCallResult<unknown>>;
  preflight(role: string): Promise<PortCallResult<unknown>>;
  startPass(input: unknown): Promise<PortCallResult<unknown>>;
  complete(input: unknown): Promise<PortCallResult<unknown>>;
  stop(input: unknown): Promise<PortCallResult<unknown>>;
  betweenPasses(input: unknown): Promise<PortCallResult<unknown>>;
  classify(input: unknown): Promise<PortCallResult<unknown>>;
};

/** Build the core side of the harness port over one harness adapter. */
export function createHarnessPort(options: HarnessPortOptions): HarnessPort {
  const call = <T>(operation: PortOperation, input?: unknown): Promise<PortCallResult<T>> =>
    callOperation<T>(options, operation, input);
  return {
    operations: PORT_OPERATIONS,
    timeLimits: options.timeLimits,
    detect: (): Promise<PortCallResult<unknown>> => call("detect"),
    capabilities: (): Promise<PortCallResult<unknown>> => call("capabilities"),
    preflight: (role: string): Promise<PortCallResult<unknown>> => call("preflight", { role }),
    startPass: (input: unknown): Promise<PortCallResult<unknown>> => call("startPass", input),
    complete: (input: unknown): Promise<PortCallResult<unknown>> => call("complete", input),
    stop: (input: unknown): Promise<PortCallResult<unknown>> => call("stop", input),
    betweenPasses: (input: unknown): Promise<PortCallResult<unknown>> =>
      call("betweenPasses", input),
    classify: (input: unknown): Promise<PortCallResult<unknown>> => call("classify", input),
  };
}
