/**
 * T069 — the home per auth tier (F138-FR-045; F138-FR-005; user story 1).
 *
 * A call on prime, for either role, uses the home feature 100 annex C §C.16
 * and F100-FR-113 give for the auth tier:
 *  - at auth TIER 1, the consumer's REAL home, which the run never writes —
 *    session state goes to the session directory of the phase attempt
 *    (F138-FR-014) or is not stored;
 *  - at auth TIER 2, a THROWAWAY home built from an overlay; the real home
 *    is never handed to the process. The harness has a variable of its own
 *    for its session directory and none for its configuration directory, so
 *    the overlay redirects the home variable AND the session directory
 *    variable, and seeds no credential and no authentication file: the key
 *    reaches prime by environment only (F138-FR-005). The throwaway home is
 *    removed after the call — a killed pass and a call that passed its time
 *    limit included (the removal runs in `finally`-shaped code of the
 *    caller, and `removeThrowawayHome` is idempotent).
 *
 * An overlay that cannot be built fails the call BEFORE a process starts.
 * The descriptor states, with its provenance, whether the agent executable
 * follows the home variable; until capture (5) of F138-FR-042 has shown it
 * the statement is NULL, and a call at auth tier 2 is refused before a
 * process starts, with a reason that names the missing fact (CQ-234).
 * Under the `parity` profile no overlay is built at all: the home is the one
 * of the oracle's hermetic environment.
 */
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { primeDescriptor, type PrimeDescriptor } from "../descriptor/index.ts";
import { SESSION_DIR_VAR } from "./auth.ts";

/** The home variable the overlay redirects. */
export const HOME_VAR = "HOME";

/** The session directory variable the overlay redirects (F138-FR-014). */
export const SESSION_DIR_VAR_OF_OVERLAY = SESSION_DIR_VAR;

/** Where the overlay's variables come from, in the descriptor. */
export const OVERLAY_VARS: readonly string[] = Object.freeze([HOME_VAR, SESSION_DIR_VAR]);

/** The overlay seeds NOTHING: no credential, no authentication file. */
export const OVERLAY_SEEDS: readonly string[] = Object.freeze([]);

/** The auth tier that uses the throwaway home. */
export const THROWAWAY_HOME_TIER = 2;

/** The statement of the descriptor about following the home variable. */
export type HomeFollowStatement = {
  /**
   * Whether the agent executable takes its configuration directory from the
   * home variable. NULL until capture (5) shows it — and null for good when
   * the capture shows the contrary (CQ-234).
   */
  readonly statement: boolean | null;
  /** The provenance: the capture that may set it. */
  readonly provenance: string;
  /** The capture number of F138-FR-042 the statement waits for. */
  readonly capture: 5;
  readonly status: "unverified" | "verified-on-capture";
};

/**
 * Read the descriptor's statement about the home variable
 * (`isolation.configHome.homeFollows`). Never guessed: what the descriptor
 * does not state, the adapter does not know.
 */
export function homeFollowStatement(
  descriptor: PrimeDescriptor = primeDescriptor,
): HomeFollowStatement {
  const raw = (
    descriptor.isolation as {
      configHome?: { homeFollows?: HomeFollowStatement };
    }
  ).configHome?.homeFollows;
  if (raw === undefined) {
    throw new Error(
      "internal: the descriptor states no homeFollows field; the overlay cannot be judged",
    );
  }
  return raw;
}

/** The refusal of a call at auth tier 2: no process is ever started. */
export type HomeRefusal = {
  kind: "refused";
  /** No command: the refusal happens before a process starts. */
  command: undefined;
  /** Why: the missing fact, or the overlay that could not be built. */
  reason: string;
  requirement: "F138-FR-045";
};

/** A real home: tier 1, never written by the run. */
export type RealHome = {
  kind: "real-home";
  homeVar: typeof HOME_VAR;
  home: string;
  overlay: null;
  requirement: "F138-FR-045";
};

/** The parity profile: no overlay, the oracle's hermetic home. */
export type ParityHome = {
  kind: "parity-home";
  homeVar: typeof HOME_VAR;
  home: string | null;
  overlay: null;
  requirement: "F138-FR-045";
};

/** The throwaway home of tier 2, with its removal. */
export type ThrowawayHome = {
  kind: "throwaway-home";
  homeVar: typeof HOME_VAR;
  sessionDirVar: typeof SESSION_DIR_VAR;
  home: string;
  overlay: { vars: readonly string[]; seeds: readonly string[] };
  /** Removes the throwaway home; idempotent, safe after a kill. */
  remove: () => void;
  requirement: "F138-FR-045";
};

export type HomePlan = RealHome | ParityHome | ThrowawayHome | HomeRefusal;

export type HomePlanInput = {
  /** The auth tier of the call: 1 or 2. */
  readonly tier: number;
  /** The profile: under `parity` no overlay is built at all. */
  readonly profile: "parity" | "default";
  /** The consumer's real home, as the process would see it. */
  readonly realHome?: string | undefined;
  /** The home the oracle's hermetic environment holds (parity). */
  readonly parityHome?: string | null;
  /** Builds the overlay's throwaway home; defaults to a temp directory. */
  readonly buildOverlay?: (() => string) | undefined;
  /** Removes a throwaway home; defaults to `removeThrowawayHome`. */
  readonly removeHome?: ((home: string) => void) | undefined;
  /** The descriptor's statement; the descriptor's own when omitted. */
  readonly homeFollow?: boolean | null | undefined;
};

/**
 * The refusal at tier 2 while the statement about the home variable is
 * null: the fact capture (5) must show is missing, and the adapter does not
 * build an overlay whose one premise is unproven (CQ-234).
 */
export function tier2RefusedWhileHomeFollowUnknown(reason?: string): HomeRefusal {
  return {
    kind: "refused",
    command: undefined,
    reason:
      reason ??
      "prime: refused at auth tier 2 before a process starts — the descriptor's " +
        "statement that the agent executable follows the home variable is null " +
        "(capture (5) of F138-FR-042 has not shown it; CQ-234); the missing fact " +
        "names itself: whether the throwaway home would be read at all",
    requirement: "F138-FR-045",
  };
}

/**
 * The home of one call on prime (F138-FR-045). No code path here starts a
 * process: the caller alone does, and only when the plan is not a refusal.
 */
export function homeForCall(input: HomePlanInput): HomePlan {
  // Under `parity` no overlay is built, whatever the tier says: the home is
  // the one of the oracle's hermetic environment (row 30: scope none).
  if (input.profile === "parity") {
    return {
      kind: "parity-home",
      homeVar: HOME_VAR,
      home: input.parityHome ?? null,
      overlay: null,
      requirement: "F138-FR-045",
    };
  }
  // Auth tier 1: the real home, which the run never writes.
  if (input.tier === 1) {
    return {
      kind: "real-home",
      homeVar: HOME_VAR,
      home: input.realHome ?? "",
      overlay: null,
      requirement: "F138-FR-045",
    };
  }
  // Auth tier 2: the statement about the home variable first.
  const follows =
    input.homeFollow !== undefined ? input.homeFollow : homeFollowStatement().statement;
  if (follows !== true) {
    return tier2RefusedWhileHomeFollowUnknown();
  }
  // Then the overlay: a home that cannot be built fails the call before a
  // process starts.
  const build = input.buildOverlay ?? (() => mkdtempSync(join(tmpdir(), "prime-home-")));
  let home: string;
  try {
    home = build();
  } catch (error) {
    return {
      kind: "refused",
      command: undefined,
      reason:
        `prime: refused at auth tier 2 before a process starts — the throwaway ` +
        `home could not be built (${String(error)})`,
      requirement: "F138-FR-045",
    };
  }
  const removeHome = input.removeHome ?? removeThrowawayHome;
  return {
    kind: "throwaway-home",
    homeVar: HOME_VAR,
    sessionDirVar: SESSION_DIR_VAR_OF_OVERLAY,
    home,
    overlay: { vars: OVERLAY_VARS, seeds: OVERLAY_SEEDS },
    remove: () => {
      try {
        removeHome(home);
      } catch {
        // A removal that fails must not mask the call's own outcome; the
        // doctor reports leftovers. Idempotent on a second call.
      }
    },
    requirement: "F138-FR-045",
  };
}

/**
 * Remove a throwaway home (F138-FR-045): after the call, after a killed
 * pass, after a call that passed its time limit. Idempotent — a home that
 * is already gone is a success, not an error.
 */
export function removeThrowawayHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

/** The run-record line about the home the process saw (F138-FR-045). */
export function homeRunRecord(plan: HomePlan): string {
  if (plan.kind === "refused") return "home=refused";
  if (plan.kind === "parity-home") return "home=parity-hermetic overlay=none";
  if (plan.kind === "real-home") return "home=real overlay=none";
  return "home=throwaway overlay=HOME+PRIME_AGENT_SESSION_DIR seeds=none";
}
