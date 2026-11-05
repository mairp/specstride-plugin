/**
 * T050 of feature 118 — the settings of the yield and their aliases
 * (F118-FR-025; the alias table of annex X §X.8 through feature 110, T008).
 *
 * The variables of the baseline stay as aliases of the keys `loop.yield.*`.
 * Two distinctions of the baseline are kept: the poll variable, when it is
 * set at all, is an operator override by set-ness and not by value; and the
 * `command` allowance must be exactly `true` to allow.
 */
import { YIELD_POLL_DEFAULT_SEC, YIELD_MAX_PER_ATTEMPT_DEFAULT } from "./schema/index.ts";
import { LOG_HEAD_DEFAULT, LOG_TAIL_DEFAULT } from "./resume-block/index.ts";
import { FILE_STABLE_DEFAULT_SEC } from "./predicates/index.ts";

/** The default failure pattern of the ledger (F118-FR-037). */
export const FAILURE_PATTERN_DEFAULT =
  "\\b(FAIL|FAILED|FAILURE|ERROR)\\b|Traceback \\(most recent|RC=[1-9][0-9]*|exit \\[code\\] [1-9][0-9]*";

/** The resolved settings of one phase attempt. */
export interface YieldSettings {
  /** The poll interval, in seconds (default 30), with the source of the value. */
  readonly pollSec: number;
  readonly pollSource: "override" | "learned" | "default";
  /** The number of yields allowed per phase attempt (default 4; 0 disables the cap). */
  readonly maxPerAttempt: number;
  /** True only when the variable is exactly `true` (F118-FR-025). */
  readonly allowCommand: boolean;
  /** True only when the variable is exactly `true`. */
  readonly countsAsIter: boolean;
  /** Emit the wait event every N ticks (default 10; 0 disables). */
  readonly waitEvery: number;
  /** The head and the tail of the log slice (40 and 80). */
  readonly logHead: number;
  readonly logTail: number;
  /** The failure-ledger section (default on) and its cap (150). */
  readonly failureLedger: boolean;
  readonly failureLedgerMax: number;
  /** The failure pattern; an empty value reads as unset. */
  readonly failurePattern: string;
  /** The wall-clock budget of the run, in minutes, for the wait. */
  readonly wallBudgetMin: number | undefined;
}

/** The environment the resolver reads: handed in, never the host's. */
export type Environment = Readonly<Record<string, string | undefined>>;

function integer(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Exactly-true, as the baseline reads its boolean variables (F118-FR-025). */
export function exactlyTrue(raw: string | undefined): boolean {
  return raw === "true";
}

/** Resolve every yield setting of F118-FR-025. */
export function resolveYieldSettings(environment: Environment): YieldSettings {
  // The poll is an operator override by set-ness, not by value: any set value
  // (even an odd one) overrides; unset falls to the learned value, then the default.
  const rawPoll = environment["SPECSTRIDE_YIELD_POLL"];
  const learnedPoll = integer(environment, "yield_poll_interval", YIELD_POLL_DEFAULT_SEC);
  const pollSec =
    rawPoll !== undefined
      ? integer(environment, "SPECSTRIDE_YIELD_POLL", YIELD_POLL_DEFAULT_SEC)
      : learnedPoll;
  const pollSource: YieldSettings["pollSource"] =
    rawPoll !== undefined
      ? "override"
      : environment["yield_poll_interval"] !== undefined
        ? "learned"
        : "default";
  const rawPattern = environment["SPECSTRIDE_FAILURE_PATTERN"];
  return {
    pollSec,
    pollSource,
    maxPerAttempt: integer(
      environment,
      "SPECSTRIDE_YIELD_MAX_PER_ATTEMPT",
      YIELD_MAX_PER_ATTEMPT_DEFAULT,
    ),
    allowCommand: exactlyTrue(environment["SPECSTRIDE_YIELD_ALLOW_COMMAND"]),
    countsAsIter: exactlyTrue(environment["SPECSTRIDE_YIELD_COUNTS_AS_ITER"]),
    waitEvery: integer(environment, "SPECSTRIDE_YIELD_WAIT_EVERY", 10),
    logHead: integer(environment, "SPECSTRIDE_YIELD_LOG_HEAD", LOG_HEAD_DEFAULT),
    logTail: integer(environment, "SPECSTRIDE_YIELD_LOG_TAIL", LOG_TAIL_DEFAULT),
    failureLedger: exactlyTrue(environment["SPECSTRIDE_FAILURE_LEDGER"] ?? "true"),
    failureLedgerMax: integer(environment, "SPECSTRIDE_FAILURE_LEDGER_MAX", 150),
    failurePattern:
      rawPattern === undefined || rawPattern === "" ? FAILURE_PATTERN_DEFAULT : rawPattern,
    wallBudgetMin:
      environment["SPECSTRIDE_MAX_WALL_MIN"] === undefined
        ? undefined
        : integer(environment, "SPECSTRIDE_MAX_WALL_MIN", 0) > 0
          ? integer(environment, "SPECSTRIDE_MAX_WALL_MIN", 0)
          : undefined,
  };
}

/** The alias table of the yield settings: variable, key, default (F118-FR-025). */
export interface YieldSettingAlias {
  readonly env: string;
  readonly key: string | undefined;
  readonly default: string;
}

export const YIELD_ALIASES: readonly YieldSettingAlias[] = Object.freeze([
  { env: "SPECSTRIDE_YIELD_POLL", key: "loop.yield.pollSec", default: "30" },
  { env: "SPECSTRIDE_YIELD_MAX_PER_ATTEMPT", key: "loop.yield.maxPerAttempt", default: "4" },
  { env: "SPECSTRIDE_YIELD_ALLOW_COMMAND", key: "loop.yield.allowCommand", default: "false" },
  { env: "SPECSTRIDE_YIELD_COUNTS_AS_ITER", key: "loop.yield.countsAsIter", default: "false" },
  { env: "SPECSTRIDE_YIELD_WAIT_EVERY", key: "loop.yield.waitEvery", default: "10" },
  { env: "SPECSTRIDE_YIELD_LOG_HEAD", key: "loop.yield.logHead", default: "40" },
  { env: "SPECSTRIDE_YIELD_LOG_TAIL", key: "loop.yield.logTail", default: "80" },
  { env: "SPECSTRIDE_FAILURE_LEDGER", key: "loop.yield.failureLedger", default: "true" },
  { env: "SPECSTRIDE_FAILURE_LEDGER_MAX", key: "loop.yield.failureLedgerMax", default: "150" },
  {
    env: "SPECSTRIDE_FAILURE_PATTERN",
    key: "loop.yield.failurePattern",
    default: FAILURE_PATTERN_DEFAULT,
  },
  { env: "SPECSTRIDE_MAX_WALL_MIN", key: undefined, default: "" },
  { env: "SPECSTRIDE_RUN_START_EPOCH", key: undefined, default: "" },
]);

/** The default stable period of the `file_stable` predicate, re-exported for the table. */
export const STABLE_SEC_DEFAULT = FILE_STABLE_DEFAULT_SEC;
