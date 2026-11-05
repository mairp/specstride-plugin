/**
 * T144 — the interface types of EP-17, the detach strategy, from
 * `contracts/extension-points/EP-17.detach.json` and annex F, §F.6
 * (F100-FR-165).
 *
 * `specstride.detach/1`. It starts the runtime root so that it outlives the
 * process that started it.
 */
export const POINT_ID = "specstride.detach/1" as const;
export const EP = "EP-17" as const;
export const ANNEX_SECTION = "annex F, §F.6" as const;

/** F100-FR-165 — the three operations of the point. */
export const OPERATIONS = ["available", "start", "describe"] as const;
export type DetachOperation = (typeof OPERATIONS)[number];

/** The errors of §F.6. */
export const ERRORS = ["unavailable", "not-ready"] as const;
export type DetachError = (typeof ERRORS)[number];

/** The strategies Wave 1 ships. */
export const WAVE_1_STRATEGIES = ["spawn-detached", "foreground"] as const;
export type StrategyId = (typeof WAVE_1_STRATEGIES)[number] | string;
export const DEFAULT_STRATEGY: StrategyId = "spawn-detached";
/** The strategy that runs without detaching, named in the refusal (§F.6). */
export const STRATEGY_WITHOUT_DETACHING: StrategyId = "foreground";
/** A strategy that survives a reboot is not part of Wave 1. */
export const SURVIVES_A_REBOOT_IN_WAVE_1 = false as const;

/** The result of `available`: yes or no, with the reason. */
export type AvailableResult = {
  readonly available: boolean;
  readonly reason: string;
};

/** The inputs of `start` (§F.6, Inputs). */
export type StartInput = {
  readonly runtimeEntry: readonly string[];
  readonly environmentAllowList: readonly string[];
  /** The logical name of the runtime log, never a physical path. */
  readonly runtimeLogLogicalName: string;
  readonly launchNonce: string;
};

/** The identity of the started process (§F.6, Outputs). */
export type StartedProcess = {
  readonly pid: number;
  readonly startTime: string;
  readonly sessionLeader: boolean;
};

/** What a strategy survives (§F.6, Outputs). */
export type Survives = {
  readonly endOfTheParent: boolean;
  readonly endOfTheHostSession: boolean;
  readonly reboot: boolean;
};

/** The description `describe` returns. */
export type StrategyDescription = {
  readonly id: StrategyId;
  readonly survives: Survives;
};

/** F100-FR-165 — a detach strategy. */
export type DetachStrategy = {
  available(): AvailableResult;
  start(input: StartInput): Promise<StartedProcess>;
  describe(): StrategyDescription;
};

/** "Guarantees of the core" of §F.6, as data. */
export const CORE_GUARANTEES = [
  "readiness is confirmed by the lease that carries the launch nonce",
  "the CLI waits for the handshake and no longer",
  "the strategy in use is in the launch record and in the doctor's output",
] as const;

/** "Guarantees of an implementation" of §F.6, as data. */
export const IMPLEMENTATION_GUARANTEES = [
  "standard input closed",
  "output on the runtime log",
  "the environment allow-list",
  "the leader of a process session of its own (except `foreground`)",
] as const;

/**
 * "Failure of an implementation" of §F.6 — the plainer path: a strategy that
 * is `unavailable` or `not-ready` refuses the launch with the outcome
 * `refused`, and the message names the strategy `foreground`.
 */
export const FAILURE_OUTCOME = "refused" as const;
export const FAILURE_PATH =
  "the launch is refused with the outcome `refused`; the message names the strategy `foreground` as the way to run without detaching" as const;
export const FAILURE_PATHS: Readonly<Record<DetachOperation, string>> = Object.freeze({
  available: FAILURE_PATH,
  start: FAILURE_PATH,
  describe: FAILURE_PATH,
});

/** Unknown-value rule of §F.6: an unknown strategy id in configuration. */
export const UNKNOWN_STRATEGY_EXIT_CODE = 3 as const;
export function unknownStrategyMessage(id: string): string {
  return `configuration error (exit 3): no detach strategy \`${id}\` is registered (annex F, §F.6)`;
}
