/**
 * T026 of feature 118 — the hard cap and the resolution of the ceiling
 * (F118-FR-006; C-006, C-009, C-013; B-0017, B-0018, B-0109, B-0123, B-0236,
 * B-0302, B-0604, B-0712).
 *
 * The hard cap ends a pass once its elapsed wall time reaches the ceiling,
 * whatever the pass wrote, with the kill reason `hard_cap`; it is checked
 * last on each tick. The ceiling of a phase is resolved once per phase, in
 * the order of annex X §X.2 of feature 100 (the order of the baseline):
 *
 *   1. an explicit per-phase setting (the per-phase flag or the per-phase
 *      environment variable of the baseline, key `phases.<N>.proposer.timeoutSec`);
 *   2. else the learned value, when the learning mode resolves to `apply`
 *      and the arm is `applied`;
 *   3. else the value declared by the verification-commands document for the
 *      phase (the default of the per-phase key; at the baseline the
 *      `phaseTimeouts` entry of the launch contract);
 *   4. else the role key `roles.proposer.timeoutSec` (default 1,800 seconds).
 *
 * The per-phase flag values are applied AFTER the per-phase environment
 * variables into one map, so that the flag wins over the variable for the
 * same phase and a later repeat of the flag wins over an earlier one. A
 * per-phase value that is not `<digits>=<digits greater than 0>`, and a
 * `phaseTimeouts` entry that is not a positive integer number of seconds,
 * ends the launch with exit 3 and the message of the baseline.
 */

/** The default of the role key `roles.proposer.timeoutSec`, in seconds. */
export const ROLE_TIMEOUT_DEFAULT_SEC = 1800;

/** The role key of the pass ceiling (annex X §X.2). */
export const ROLE_TIMEOUT_KEY = "roles.proposer.timeoutSec";

/** The configuration key of the per-phase ceiling (`phases.<N>.proposer.timeoutSec`). */
export function phaseTimeoutKey(phase: number): string {
  return `phases.${phase}.proposer.timeoutSec`;
}

/** Where a resolved ceiling came from, in resolution order. */
export type CeilingSource = "per-phase" | "learned" | "verification-commands" | "role";

/** A ceiling resolved once per phase. */
export interface ResolvedCeiling {
  readonly seconds: number;
  readonly source: CeilingSource;
  /** The learning arm, when the value came from the learned rank. */
  readonly arm?: "applied" | undefined;
}

/** The candidates one ceiling resolution reads. */
export interface CeilingCandidates {
  /** The explicit per-phase setting, when the operator set one. */
  readonly perPhaseSettingSec?: number | undefined;
  /** The learned value, with the mode and the arm it resolved to. */
  readonly learned?:
    { readonly seconds: number; readonly mode: string; readonly arm: string } | undefined;
  /** The value the verification-commands document declares for the phase. */
  readonly declaredByVerificationCommandsSec?: number | undefined;
  /** The value of the role key (default 1,800 when absent). */
  readonly roleSec?: number | undefined;
}

/** The rank of a learned value: counted only under `apply` with arm `applied`. */
export function learnedApplies(learned: CeilingCandidates["learned"]): boolean {
  return learned !== undefined && learned.mode === "apply" && learned.arm === "applied";
}

/** Resolve the ceiling of one phase, once per phase (F118-FR-006). */
export function resolvePassCeiling(candidates: CeilingCandidates): ResolvedCeiling {
  if (candidates.perPhaseSettingSec !== undefined) {
    return { seconds: candidates.perPhaseSettingSec, source: "per-phase" };
  }
  if (learnedApplies(candidates.learned)) {
    return {
      seconds: candidates.learned!.seconds,
      source: "learned",
      arm: "applied",
    };
  }
  if (candidates.declaredByVerificationCommandsSec !== undefined) {
    return {
      seconds: candidates.declaredByVerificationCommandsSec,
      source: "verification-commands",
    };
  }
  return {
    seconds: candidates.roleSec ?? ROLE_TIMEOUT_DEFAULT_SEC,
    source: "role",
  };
}

/** What a bad per-phase spec or `phaseTimeouts` entry does to the launch. */
export interface LaunchRejection {
  readonly exit: 3;
  readonly message: string;
}

/**
 * The baseline message for a per-phase value that is not
 * `<digits>=<digits greater than 0>`.
 */
export function invalidPhaseSpecMessage(token: string): string {
  return `invalid --proposer-timeout-phase spec: ${token} (expected <phase>=<seconds greater than 0>)`;
}

/** The baseline message for a `phaseTimeouts` entry that is not a positive integer. */
export function invalidPhaseTimeoutsEntryMessage(phase: number, seconds: number): string {
  return `invalid phaseTimeouts entry for phase ${phase}: ${seconds} (expected a positive integer number of seconds)`;
}

/** Parse one per-phase token `<digits>=<digits greater than 0>`. */
export function parsePhaseTimeoutToken(
  token: string,
): { phase: number; seconds: number } | LaunchRejection {
  const match = /^([0-9]+)=([0-9]+)$/.exec(token);
  if (match === null) return { exit: 3, message: invalidPhaseSpecMessage(token) };
  const seconds = Number(match[2]);
  if (!(seconds > 0)) return { exit: 3, message: invalidPhaseSpecMessage(token) };
  return { phase: Number(match[1]), seconds };
}

/** A `phaseTimeouts` entry: a positive integer number of seconds, else exit 3. */
export function parsePhaseTimeoutsEntry(phase: number, seconds: number): number | LaunchRejection {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    return { exit: 3, message: invalidPhaseTimeoutsEntryMessage(phase, seconds) };
  }
  return seconds;
}

/**
 * Fold the per-phase environment variables and then the per-phase flags into
 * one map: the flag wins over the variable for the same phase, and a later
 * repeat of the flag wins over an earlier one. A bad token yields the
 * rejection of the launch (exit 3).
 */
export function parsePhaseTimeoutSpecs(
  envSpecs: readonly string[],
  flagSpecs: readonly string[],
): { map: Map<number, number> } | LaunchRejection {
  const map = new Map<number, number>();
  for (const token of [...envSpecs, ...flagSpecs]) {
    // A flag spec arrives as `--proposer-timeout-phase=1=600`; the token is
    // everything after the first `=`. A bare `1=600` is taken as it stands.
    const bare = token.startsWith("--") ? token.slice(token.indexOf("=") + 1) : token;
    const parsed = parsePhaseTimeoutToken(bare);
    if ("exit" in parsed) return parsed;
    map.set(parsed.phase, parsed.seconds);
  }
  return { map };
}

/** What the hard-cap check decided. */
export interface HardCapKill {
  readonly reason: "hard_cap";
  readonly elapsedSec: number;
}

/** The hard cap: the elapsed wall time reached the ceiling, whatever the pass wrote. */
export function hardCapCheck(input: {
  nowMs: number;
  startedAtMs: number;
  ceilingSec: number;
}): HardCapKill | undefined {
  const elapsedMs = input.nowMs - input.startedAtMs;
  if (elapsedMs < input.ceilingSec * 1000) return undefined;
  return { reason: "hard_cap", elapsedSec: Math.round(elapsedMs / 1000) };
}
