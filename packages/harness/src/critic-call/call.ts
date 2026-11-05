/**
 * The critic-class call (T039; F109-FR-010).
 *
 * A critic-class call makes exactly one call of the harness and does not try
 * again. The call is bounded by a time limit in whole seconds, 300 by
 * default, set by the key of the critic's time limit or its as-is alias
 * `SPECSTRIDE_CRITIC_TIMEOUT`.
 *
 * The reports, with the as-is detail texts (as at `lib/critic.py`):
 * - a process that passes the limit: `<harness> critic timed out after <n>s`;
 * - a failure of the transport or of the endpoint: `critic call failed: <error>`
 *   with an empty reply;
 * - every other failure of the call (a time limit passed, an exit code other
 *   than 0, empty output, a missing key, an unknown harness):
 *   `critic call error: <error>`.
 *
 * The seam produces no verdict: the report is scored as feature 100, annex C
 * §C.1 states.
 */

/** The default time limit, in whole seconds (as at the baseline). */
export const CRITIC_TIMEOUT_DEFAULT_SECONDS = 300;

/** The as-is key of the critic's time limit and its as-is alias. */
export const CRITIC_TIMEOUT_KEY = "SPECSTRIDE_CRITIC_TIMEOUT";
export const CRITIC_TIMEOUT_ALIAS = "SPECSTRIDE_CRITIC_TIMEOUT";

/**
 * The time limit of a critic-class call, in whole seconds: the first of the
 * keys that is set and holds a positive integer, else 300. A value that is
 * not a positive integer is ignored (the default stands), as at the baseline
 * `int(os.environ.get(...))` with its guard.
 */
export function criticTimeoutSeconds(env: Readonly<Record<string, string | undefined>>): number {
  for (const key of [CRITIC_TIMEOUT_KEY, CRITIC_TIMEOUT_ALIAS]) {
    const raw = env[key];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return CRITIC_TIMEOUT_DEFAULT_SECONDS;
}

/** A failure of the transport or of the endpoint (`critic call failed: …`). */
export class CriticTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticTransportError";
  }
}

/** Every other failure of the call (`critic call error: …`). */
export class CriticCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticCallError";
  }
}

/** The report of a critic-class call; the reply is empty on every failure. */
export type CriticCallReport =
  | { ok: true; reply: string; calls: 1 }
  | {
      ok: false;
      reply: "";
      /** `timeout`, `transport` or `error`. */
      reason: "timeout" | "transport" | "error";
      /** The as-is detail text. */
      detail: string;
      calls: 1;
    };

/** What the caller of the seam gives the call: one invocation of the harness. */
export type CriticInvoke = (options: { signal: AbortSignal }) => Promise<string>;

/** Runs the invoke under a whole-second limit; ends the process on expiry. */
function withTimeLimit<T>(
  seconds: number,
  run: (signal: AbortSignal) => Promise<T>,
): { promise: Promise<T>; expired: () => boolean } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, seconds * 1000);
  const promise = run(controller.signal).finally(() => clearTimeout(timer));
  return { promise, expired: () => expired };
}

/**
 * Makes the critic-class call: exactly one invocation, no retry, bounded by
 * the time limit, reported with the as-is detail texts. The `calls` field of
 * the report is always 1 — proof that the seam tried the harness once.
 */
export async function criticCall(options: {
  /** The id of the harness, for the detail text of a time limit. */
  harness: string;
  /** One invocation of the harness; the seam calls it exactly once. */
  invoke: CriticInvoke;
  /** The time limit in whole seconds; the default of 300 stands where unset. */
  timeoutSeconds?: number;
  /** The environment the key and its alias are read from. */
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<CriticCallReport> {
  const seconds = options.timeoutSeconds ?? criticTimeoutSeconds(options.env ?? {});
  let calls = 0;
  const { promise, expired } = withTimeLimit(seconds, async (signal) => {
    calls += 1; // exactly one invocation: the seam never retries
    void calls;
    return options.invoke({ signal });
  });
  try {
    const reply = await promise;
    return { ok: true, reply, calls: 1 };
  } catch (error) {
    if (expired()) {
      return {
        ok: false,
        reply: "",
        reason: "timeout",
        detail: `${options.harness} critic timed out after ${seconds}s`,
        calls: 1,
      };
    }
    if (error instanceof CriticTransportError) {
      return {
        ok: false,
        reply: "",
        reason: "transport",
        detail: `critic call failed: ${error.message}`,
        calls: 1,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reply: "",
      reason: "error",
      detail: `critic call error: ${message}`,
      calls: 1,
    };
  }
}
