/**
 * T017 — the phase gate with a changed protected set: the condition of the
 * result is handed to the fact block and nothing halts (feature 149,
 * F149-FR-009; R23v IR-33; DV-076; F100-FR-098, F100-FR-136).
 *
 * F149-FR-009: "When the protected set was changed without authority, the phase
 * gate MUST still run: the verification gate runs, its result carries the
 * condition, the critic is told through the fact block, and an approval stays
 * possible. An integrity event MUST never halt the run and MUST never be read
 * as a verdict."
 *
 * The five parts of that sentence, and where they are below:
 *
 * | Part | Here |
 * |---|---|
 * | the verification gate runs | `PhaseGateWithAChangedProtectedSet.verificationGateRan`, and the gate is called on every path of `theGateRunsWithAChangedProtectedSet` |
 * | its result carries the condition | the condition `tainted` with the reason `protected-set-changed` (annex C §C.8; row 53 of annex X §X.6) |
 * | the critic is told through the fact block | `facts`, the rows the engine hands to the fact block (annex D §D.7, field `protected`) |
 * | an approval stays possible | `APPROVAL_STAYS_POSSIBLE`, and no field of the result can take APPROVED away |
 * | never halts, never a verdict | `THE_RUN_HALTS`, `AN_INTEGRITY_EVENT_IS_A_VERDICT` |
 *
 * The switch is `integrity.gate_fingerprint`, row 31 of annex X §X.7:
 * "Fingerprints around every command of the verification gate and around
 * grounding", on by default and OFF under the `parity` profile. With no
 * fingerprint taken around a command there is nothing to compare, so no
 * condition is raised and no fact reaches the critic — but the verification gate
 * runs exactly as before. The row belongs to features 148 and 117, so it is
 * READ here and never registered (F100-FR-212).
 *
 * The module reads no file and hashes nothing: the engine hands in the
 * fingerprints and the paths that changed (F100-FR-012, F100-FR-234).
 */
import {
  CONDITION_OF_A_CHANGED_PROTECTED_SET,
  CONDITIONS,
  type CheckResult,
  type Condition,
} from "@specstride/contracts/ep/check-runner";
import {
  resultConditionsOfACheckReasonsOfTaintedReasonsOfUnchecked as conditionsAndReasons,
  integrityKindsThatReachTheCritic,
} from "@specstride/contracts/enums/all-sets";
import { profileRow, type ProfileRow } from "@specstride/contracts/profile/parity";

/* ------------------------------------------------------------------ *
 * The switch of row 31.
 * ------------------------------------------------------------------ */

/** Row 31 of annex X §X.7 — the fingerprints around the verification gate. */
export const PARITY_ROW = 31 as const;

/** The configuration key of the switch. */
export const SWITCH_KEY = "integrity.gate_fingerprint" as const;

/** The row itself, as `data/parity-profile.json` holds it. */
export function rowOfTheSwitch(): ProfileRow {
  const row = profileRow(PARITY_ROW);
  if (row === undefined) {
    throw new Error(
      `the \`parity\` profile holds no row ${String(PARITY_ROW)}; F149-FR-009 is switched ` +
        `by that row of annex X §X.7`,
    );
  }
  return row;
}

/** The default of the switch, from the row: `on`. */
export function defaultOfTheSwitch(): string {
  return rowOfTheSwitch().default;
}

/** The value of the switch under the `parity` profile, from the row: `off`. */
export function valueUnderParity(): string {
  return rowOfTheSwitch().parity;
}

export const ON = "on" as const;
export const OFF = "off" as const;

/**
 * Whether the fingerprints around the commands of the verification gate are
 * taken. A value the switch does not offer is read as the default of the row,
 * which is `on`: an unreadable switch never silently takes an integrity fact
 * away.
 */
export function theFingerprintsAreOn(config: Readonly<Record<string, unknown>> = {}): boolean {
  const held = config[SWITCH_KEY];
  if (held === OFF || held === false) return false;
  if (held === ON || held === true) return true;
  return defaultOfTheSwitch() !== OFF;
}

/* ------------------------------------------------------------------ *
 * The condition the result carries.
 * ------------------------------------------------------------------ */

/** F100-FR-098 — the condition a result obtained against a changed set carries. */
export const CONDITION: Condition = CONDITION_OF_A_CHANGED_PROTECTED_SET;

/** The reason that condition carries, from row 53 of annex X §X.6. */
export const CONDITION_REASON = "protected-set-changed" as const;

/** Both are members of their closed sets; neither name can drift. */
export const CONDITION_IS_OF_THE_SET: boolean = (CONDITIONS as readonly string[]).includes(
  CONDITION,
);
export const CONDITION_REASON_IS_OF_THE_SET: boolean = (
  conditionsAndReasons.members as readonly string[]
).includes(CONDITION_REASON);

/**
 * The kind of the integrity event a change without authority raises:
 * `changed-during-check`, row 65 of annex X §X.6 ("Integrity kinds that reach
 * the critic").
 */
export const INTEGRITY_KIND = "changed-during-check" as const;
export const INTEGRITY_KIND_IS_OF_THE_SET: boolean = (
  integrityKindsThatReachTheCritic.members as readonly string[]
).includes(INTEGRITY_KIND);

/** The name of the event on the primary stream. */
export const PROTECTED_SET_EVENT = "integrity.protected-set" as const;

/* ------------------------------------------------------------------ *
 * What F149-FR-009 fixes, as constants a test can read.
 * ------------------------------------------------------------------ */

/** The verification gate runs. */
export const THE_VERIFICATION_GATE_RUNS = true as const;
/** Its result carries the condition. */
export const THE_RESULT_CARRIES_THE_CONDITION = true as const;
/** The critic is told through the fact block. */
export const THE_CRITIC_IS_TOLD = true as const;
/** An approval stays possible. */
export const APPROVAL_STAYS_POSSIBLE = true as const;
/** An integrity event never halts the run. */
export const THE_RUN_HALTS = false as const;
/** An integrity event is never read as a verdict. */
export const AN_INTEGRITY_EVENT_IS_A_VERDICT = false as const;

/* ------------------------------------------------------------------ *
 * What the engine hands in, and what comes back.
 * ------------------------------------------------------------------ */

/** One path of the protected set that changed, and whether it was authorised. */
export type ChangedPath = {
  readonly path: string;
  /**
   * Whether the change was authorised from the text of the task at launch
   * (F100-FR-010). A change WITHOUT authority is the subject of F149-FR-009.
   */
  readonly authorised: boolean;
};

/** The verification gate, as this module calls it: the whole of it, always. */
export type VerificationGateRun = () => Promise<CheckResult[]> | CheckResult[];

/** What the engine hands in when it runs a phase gate against a changed set. */
export type ChangedProtectedSetInput = {
  readonly phase: number;
  /** The paths of the protected set that changed since phase entry. */
  readonly changedPaths: readonly ChangedPath[];
  /** The verification gate of the phase gate; it is called on every path. */
  readonly verificationGate: VerificationGateRun;
  /** The configuration, which holds the switch of row 31. */
  readonly config?: Readonly<Record<string, unknown>>;
};

/** The integrity event a change without authority raises. */
export type ProtectedSetEvent = {
  readonly name: typeof PROTECTED_SET_EVENT;
  readonly kind: typeof INTEGRITY_KIND;
  readonly phase: number;
  /** F149-FR-009: an integrity event never halts a run. */
  readonly blocking: false;
  /** And is never read as a verdict. */
  readonly isAVerdict: false;
};

/**
 * One row of the field `protected` of the fact block (§D.7): the path, and
 * whether it was authorised from the text of the task at launch. No fingerprint
 * VALUE is in it (§D.7, "Never in the block").
 */
export type ProtectedSetFact = {
  readonly integrity: typeof INTEGRITY_KIND;
  readonly path: string;
  readonly authorised: boolean;
};

/** What comes back from one phase gate run against a changed protected set. */
export type PhaseGateWithAChangedProtectedSet = {
  /** Whether the fingerprints of row 31 were taken at all. */
  readonly fingerprintsTaken: boolean;
  /** Whether a path of the protected set changed without authority. */
  readonly changedWithoutAuthority: boolean;
  /** The verification gate ran: true on every path. */
  readonly verificationGateRan: true;
  /** Its results, each carrying the condition where the set had changed. */
  readonly results: readonly CheckResult[];
  /** The condition the results carry, where they carry one. */
  readonly condition?: Condition;
  readonly conditionReason?: typeof CONDITION_REASON;
  /** The integrity event, present exactly where a change had no authority. */
  readonly event?: ProtectedSetEvent;
  /** The rows the critic is told through the fact block. */
  readonly facts: readonly ProtectedSetFact[];
  /** F149-FR-009: an approval stays possible. */
  readonly approvalStaysPossible: true;
  /** F149-FR-009: nothing halts. */
  readonly halts: false;
  /** And no part of this is a verdict. */
  readonly isAVerdict: false;
};

/* ------------------------------------------------------------------ *
 * The phase gate with a changed protected set.
 * ------------------------------------------------------------------ */

/**
 * T017 — run the phase gate when the protected set was changed.
 *
 * The verification gate is awaited before anything is decided, on every path of
 * this function: there is no branch in which a changed protected set takes it
 * away, shortens it or replaces it with a condition. Afterwards the condition
 * `tainted` with the reason `protected-set-changed` is set on every result, the
 * changed paths become rows of the fact block, and the result says in three
 * fields that nothing halts, that an approval stays possible, and that none of
 * it is a verdict.
 */
export async function theGateRunsWithAChangedProtectedSet(
  input: ChangedProtectedSetInput,
): Promise<PhaseGateWithAChangedProtectedSet> {
  /* The verification gate runs FIRST and in full, whatever the protected set
   * did. That is the first clause of F149-FR-009. */
  const ran = await input.verificationGate();
  const results = Object.freeze([...ran]);

  const fingerprintsTaken = theFingerprintsAreOn(input.config ?? {});
  const withoutAuthority = fingerprintsTaken
    ? input.changedPaths.filter((changed) => !changed.authorised)
    : [];
  const changedWithoutAuthority = withoutAuthority.length > 0;

  const base = {
    fingerprintsTaken,
    changedWithoutAuthority,
    verificationGateRan: true as const,
    approvalStaysPossible: true as const,
    halts: false as const,
    isAVerdict: false as const,
  };

  if (!changedWithoutAuthority) {
    return Object.freeze({ ...base, results, facts: Object.freeze([]) });
  }

  return Object.freeze({
    ...base,
    results: Object.freeze(results.map(withTheCondition)),
    condition: CONDITION,
    conditionReason: CONDITION_REASON,
    event: Object.freeze({
      name: PROTECTED_SET_EVENT,
      kind: INTEGRITY_KIND,
      phase: input.phase,
      blocking: false as const,
      isAVerdict: false as const,
    }),
    facts: factsOf(withoutAuthority),
  });
}

/**
 * The result of one command, with the condition of a changed protected set set
 * on it. Each condition of §C.8 is a field of its own, so the condition is set
 * and the exit result is left exactly as the command gave it: a result that
 * carries a condition is not a failed result (F100-FR-098, F116-FR-017).
 */
export function withTheCondition(result: CheckResult): CheckResult {
  return Object.freeze({ ...result, tainted: true, reason: CONDITION_REASON });
}

/**
 * The rows for the field `protected` of the fact block: one per changed path,
 * each with the kind of row 65 and no fingerprint value (§D.7).
 */
export function factsOf(changed: readonly ChangedPath[]): readonly ProtectedSetFact[] {
  return Object.freeze(
    [...changed]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((one) =>
        Object.freeze({
          integrity: INTEGRITY_KIND,
          path: one.path,
          authorised: one.authorised,
        }),
      ),
  );
}

/**
 * An integrity event, read as a verdict: never. A verdict comes from the reply
 * of the critic alone (annex E §E.1), and this function is the one answer this
 * module gives to the question.
 */
export function theEventIsAVerdict(): false {
  return false;
}

/** An integrity event, read as a halt: never (F149-FR-009, ruling 41). */
export function theEventHalts(): false {
  return false;
}

/**
 * Whether APPROVED is still a verdict the phase gate may come out with after a
 * change of the protected set without authority: yes, always. The condition is
 * a fact for the critic and the critic decides (ruling 41).
 */
export function approvalStaysPossible(): true {
  return true;
}
