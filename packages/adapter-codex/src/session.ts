/**
 * T033 — resume, session state and the memory switches of the Codex adapter
 * (F131-FR-012, F131-FR-013, F131-FR-014).
 *
 * Continuation: inside one phase attempt a later pass may continue the
 * session by the id the FIRST record of the first pass's stream returned,
 * through `exec resume {sessionId}`. The adapter NEVER asks for the latest
 * session. A new phase attempt, a relaunch, a watchdog kill, the second
 * repair of a unit, an escalation, a change of configuration and every
 * critic-class call start a fresh session. Under `parity` no invocation
 * carries a continuation argument.
 *
 * Session state: per phase attempt, removed when the phase attempt ends. At
 * auth tier 2 it lives in the throwaway home of the phase attempt. At auth
 * tier 1 the adapter writes and removes NOTHING in the real configuration
 * home — and until capture 4 shows that session files can live outside it,
 * continuation is off for tier 1, a pass persists no session state, and the
 * pass runs with `--ephemeral`.
 *
 * Memory: harness-native memory and project instruction files are off for
 * every critic-class call and off by default for the proposer; the two
 * opt-ins load into a proposer pass only, never into a critic-class call,
 * and are recorded per run.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexProfile } from "./arguments.ts";

/** The subcommand and shape of a continued pass (F131-FR-012). */
export const CODEX_RESUME_COMMAND = ["exec", "resume"] as const;

/** Never passed, never asked for (F131-FR-012). */
export const FORBIDDEN_LATEST_SESSION_FLAGS = ["--last", "--continue", "-c"] as const;

/** The cases that force a fresh session (F131-FR-012). */
export const FRESH_SESSION_REASONS = [
  "new-phase-attempt",
  "relaunch",
  "watchdog-kill",
  "second-repair",
  "escalation",
  "config-change",
  "critic-call",
] as const;
export type FreshSessionReason = (typeof FRESH_SESSION_REASONS)[number];

/** The id-bearing fields a first record of the Codex JSONL stream may use. */
const SESSION_ID_FIELDS = ["thread_id", "session_id", "sessionId", "id"] as const;

/**
 * F131-FR-012 — the session id of the FIRST record of a JSONL stream, or
 * null where the stream carries none. Later records are never consulted:
 * the latest session may be the consumer's own.
 */
export function firstRecordSessionId(
  records: readonly (readonly [string, Readonly<Record<string, unknown>>])[],
): string | null {
  for (const [, record] of records) {
    for (const field of SESSION_ID_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value !== "") return value;
    }
    return null; // the first record decides; a later record is never used
  }
  return null;
}

/** Parse a JSONL stream into (line, record) pairs; malformed lines are dropped. */
export function parseJsonlStream(text: string): (readonly [string, Record<string, unknown>])[] {
  const pairs: (readonly [string, Record<string, unknown>])[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      pairs.push([trimmed, JSON.parse(trimmed) as Record<string, unknown>]);
    } catch {
      // a malformed line is data noise, never a session id
    }
  }
  return pairs;
}

/** The decision about one pass: continue the recorded id, or start fresh. */
export type ContinuationDecision = {
  readonly cont: boolean;
  /** The id to resume, where `cont` is true; always the FIRST record's. */
  readonly sessionId: string | null;
  /** Why the decision came out this way; recorded per pass. */
  readonly reason: string;
  /** A pass that does not continue runs ephemeral (F131-FR-013). */
  readonly ephemeral: boolean;
  /** The resume argument list head, where `cont` is true. */
  readonly resumeArgs: readonly string[] | null;
};

export type ContinuationInput = {
  readonly profile: CodexProfile;
  /** The phase attempt this pass belongs to. */
  readonly phaseAttemptId: string;
  /** The phase attempt the recorded session belongs to, if any. */
  readonly sessionPhaseAttemptId: string | null;
  readonly role: "proposer" | "critic";
  /** The session id the first record of this attempt's first pass returned. */
  readonly priorSessionId: string | null;
  /** The fresh-session case in force, if any. */
  readonly freshReason?: FreshSessionReason | null;
  /** Auth tier: 1 = the consumer's login in the real home. */
  readonly authTier: 1 | 2;
  /**
   * The fact of capture 4 — can session files live outside the home while
   * the login stays in it? Null until the capture is made.
   */
  readonly sessionOutsideHome: boolean | null;
};

/**
 * F131-FR-012, F131-FR-013 — decide whether this pass continues a session.
 * Off under `parity`, off for a critic-class call, off in every fresh case,
 * off at auth tier 1 while the fact of capture 4 is null; otherwise on, by
 * the first record's id, inside the same phase attempt only.
 */
export function continuationDecision(input: ContinuationInput): ContinuationDecision {
  const fresh = (why: string): ContinuationDecision => ({
    cont: false,
    sessionId: null,
    reason: why,
    ephemeral: input.profile !== "parity",
    resumeArgs: null,
  });
  if (input.profile === "parity") {
    return fresh("under the parity profile no invocation carries a continuation argument");
  }
  if (input.role === "critic") {
    return fresh("every critic-class call starts a fresh session");
  }
  if (input.freshReason !== null && input.freshReason !== undefined) {
    return fresh(`a fresh session is forced: ${input.freshReason}`);
  }
  if (input.sessionPhaseAttemptId !== input.phaseAttemptId) {
    return fresh("a new phase attempt starts a fresh session");
  }
  if (input.priorSessionId === null) {
    return fresh("no recorded session id of this phase attempt to continue");
  }
  if (input.authTier === 1 && input.sessionOutsideHome !== true) {
    return fresh(
      "at auth tier 1 continuation is off while the fact of capture 4 is null: the adapter persists no session state",
    );
  }
  return {
    cont: true,
    sessionId: input.priorSessionId,
    reason: "the same phase attempt continues the session id of the first record",
    ephemeral: false,
    resumeArgs: [
      ...CODEX_RESUME_COMMAND,
      input.priorSessionId,
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "-",
    ],
  };
}

/**
 * The forbidden "latest session" flags: the resume list of the adapter is
 * checked against them, so a regression fails loudly.
 */
export function resumeListHoldsLatestFlag(args: readonly string[]): string | null {
  for (const flag of FORBIDDEN_LATEST_SESSION_FLAGS) {
    if (args.includes(flag)) return flag;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Session state per phase attempt (F131-FR-013)
 * ------------------------------------------------------------------ */

/** The session state of one phase attempt. */
export type PhaseAttemptSession = {
  readonly phaseAttemptId: string;
  readonly authTier: 1 | 2;
  /** The throwaway home the state lives in at tier 2; null at tier 1. */
  readonly home: string | null;
  /** Whether a later pass of this attempt may continue. */
  readonly continuationAllowed: boolean;
  /** Whether passes of this attempt run without persisting sessions. */
  readonly ephemeral: boolean;
  /** The session ids the first records of this attempt returned, in order. */
  readonly sessionIds: string[];
};

/**
 * The fact of capture 4, read from the capture's own record: `true` only
 * where the capture is made and shows session files outside the home; null
 * while the capture is not made.
 */
export function capture4SessionFact(
  capture4: {
    readonly status?: string;
    readonly sessionLayoutFixture?: string | null;
  } | null,
): boolean | null {
  if (capture4 === null || capture4.status !== "verified") return null;
  return capture4.sessionLayoutFixture !== null && capture4.sessionLayoutFixture !== undefined;
}

/**
 * F131-FR-013 — open the session state of one phase attempt. At tier 2 the
 * state lives in a fresh throwaway home. At tier 1 the adapter creates
 * nothing in the real home: the state is null and, while the fact of
 * capture 4 is null, a pass persists no session state and runs ephemeral.
 */
export function beginPhaseAttemptSession(input: {
  readonly phaseAttemptId: string;
  readonly authTier: 1 | 2;
  readonly sessionOutsideHome: boolean | null;
  /** Root for throwaway homes; the system temporary area by default. */
  readonly scratchRoot?: string;
}): PhaseAttemptSession {
  if (input.authTier === 1) {
    const allowed = input.sessionOutsideHome === true;
    return {
      phaseAttemptId: input.phaseAttemptId,
      authTier: 1,
      home: null,
      continuationAllowed: allowed,
      ephemeral: !allowed,
      sessionIds: [],
    };
  }
  const root = input.scratchRoot ?? tmpdir();
  const home = mkdtempSync(join(root, `codex-home-${input.phaseAttemptId}-`));
  return {
    phaseAttemptId: input.phaseAttemptId,
    authTier: 2,
    home,
    continuationAllowed: true,
    ephemeral: false,
    sessionIds: [],
  };
}

/** Record the id the first record of a pass returned, in order. */
export function recordSessionId(state: PhaseAttemptSession, sessionId: string): void {
  state.sessionIds.push(sessionId);
}

/** A durable proof that a directory tree was not touched: its listing. */
export function treeSnapshot(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stats = statSync(full);
      out.push(stats.isDirectory() ? `${full}/` : `${full} (${stats.size}b)`);
      if (stats.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * F131-FR-013 — end a phase attempt: the session state is removed. At
 * tier 2 the throwaway home is removed. At tier 1 the adapter removes
 * NOTHING — the real home is not even looked at for removal; the removal
 * would be a write.
 */
export function endPhaseAttemptSession(state: PhaseAttemptSession): {
  removed: string | null;
  tier1TouchedRealHome: false;
} {
  if (state.home !== null) {
    rmSync(state.home, { recursive: true, force: true });
    return { removed: state.home, tier1TouchedRealHome: false };
  }
  return { removed: null, tier1TouchedRealHome: false };
}

/* ------------------------------------------------------------------ *
 * The memory switches (F131-FR-014)
 * ------------------------------------------------------------------ */

/** The opt-in keys of the proposer (annex X §X.7 rows 29 and 131). */
export const CODEX_MEMORY_OPT_IN_KEY = "memory.native.proposer" as const;
export const CODEX_CUSTOMISATIONS_OPT_IN_KEY = "harnesses.codex.proposerCustomisations" as const;

/** The values the customisations opt-in takes; the default is `off`. */
export const CODEX_CUSTOMISATION_VALUES = ["off", "on"] as const;

/**
 * The switches of the pinned version that keep the native memory and the
 * project instruction files off. A customisation with no known switch is
 * reported as null in `capabilities`, and the doctor warns.
 */
export const CODEX_OFF_SWITCHES = {
  userConfiguration: "--ignore-user-config",
  projectInstructionFiles: "--ignore-rules",
} as const;

/** The customisation the adapter knows NO switch for: reported null. */
export const CODEX_CUSTOMISATION_WITHOUT_SWITCH = "harness-native memory of the proposer" as const;

/** The recorded state of both opt-ins for one run. */
export type MemorySwitchRecord = {
  readonly role: "proposer" | "critic";
  readonly profile: CodexProfile;
  readonly memory: "on" | "off";
  readonly customisations: "on" | "off";
  /** The flags the call carries because of these switches ([] under `parity`). */
  readonly flags: readonly string[];
  /** The customisation no switch exists for: null never; it names the gap. */
  readonly unknownSwitch: string | null;
};

/**
 * F131-FR-014 — resolve the memory switches of one call. Off for every
 * critic-class call, whatever the opt-ins say; off by default for the
 * proposer; an opt-in loads into a proposer pass only. Under `parity` no
 * flag about memory or customisation is passed at all. The flags that keep
 * the user configuration and the project rules off are also the switches
 * every auth-tier-1 call carries anyway (F131-FR-009).
 */
export function memorySwitches(input: {
  readonly role: "proposer" | "critic";
  readonly profile: CodexProfile;
  readonly optIns?: {
    readonly memory?: "on" | "off";
    readonly customisations?: "on" | "off";
  };
}): MemorySwitchRecord {
  if (input.profile === "parity") {
    return {
      role: input.role,
      profile: input.profile,
      memory: "off",
      customisations: "off",
      flags: [],
      unknownSwitch: null,
    };
  }
  if (input.role === "critic") {
    return {
      role: "critic",
      profile: input.profile,
      memory: "off",
      customisations: "off",
      flags: [CODEX_OFF_SWITCHES.userConfiguration, CODEX_OFF_SWITCHES.projectInstructionFiles],
      unknownSwitch: null,
    };
  }
  const memory = input.optIns?.memory === "on" ? "on" : "off";
  const customisations = input.optIns?.customisations === "on" ? "on" : "off";
  // A customisation turned on with no switch to turn it off is the recorded
  // gap; where both are off the off-switches travel on the list.
  const unknownSwitch = memory === "on" ? CODEX_CUSTOMISATION_WITHOUT_SWITCH : null;
  const flags =
    memory === "on"
      ? [CODEX_OFF_SWITCHES.projectInstructionFiles]
      : [CODEX_OFF_SWITCHES.userConfiguration, CODEX_OFF_SWITCHES.projectInstructionFiles];
  return {
    role: "proposer",
    profile: input.profile,
    memory,
    customisations,
    flags,
    unknownSwitch,
  };
}

/**
 * F131-FR-014 — the doctor warning for the customisation that has no
 * switch. The warning rides the unverified-facts line of the doctor
 * (`harness.codex.unverified-facts`), where the fact is listed until a
 * capture records a switch.
 */
export function customisationSwitchWarning(): {
  readonly severity: "warn";
  readonly check: "harness.codex.unverified-facts";
  readonly message: string;
} {
  return {
    severity: "warn",
    check: "harness.codex.unverified-facts",
    message: `${CODEX_CUSTOMISATION_WITHOUT_SWITCH}: no switch is known in the pinned version, so it is reported as null in capabilities and must not be turned on`,
  };
}

/** The capability value for the switch-less customisation: null. */
export function customisationSwitchCapability(): null {
  return null;
}
