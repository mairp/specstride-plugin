/**
 * T016 — the comparison of the tree at phase entry, behind the switch of row 32
 * of the `parity` profile (feature 149, F149-FR-008; R23v IR-33; DV-077;
 * F100-FR-136).
 *
 * F149-FR-008: "At the entry of a phase the tree MUST be compared with the
 * fingerprint of the tree that the approval record of the phase before binds. A
 * difference MUST be an integrity event and a fact for the critic of the phase
 * that starts, and MUST never block."
 *
 * The three parts of that sentence, and where they are below:
 *
 * | Part | Here |
 * |---|---|
 * | the comparison | `compareTheTreeAtPhaseEntry` |
 * | an integrity event | `PhaseEntryComparison.event`, of the kind `phase-entry-mismatch` (row 65 of annex X §X.6) |
 * | a fact for the critic | `PhaseEntryComparison.facts`, the rows the engine hands to the fact block through `contributeCriticInput` (annex D §D.7) |
 * | never blocks | `A_DIFFERENCE_BLOCKS`, and no field of the result can halt a run |
 *
 * The switch is `integrity.phase_entry`, row 32 of annex X §X.7: on by default,
 * OFF under the `parity` profile. The row belongs to feature 116 and this
 * feature performs the comparison, so the row is READ here and never
 * registered: a feature does not register a switch of another feature
 * (F100-FR-212).
 *
 * The first phase of a run has no phase before it, so no comparison is made
 * (the specification, "Edge cases").
 *
 * The module reads no file: the engine hands in the fingerprint of the tree as
 * it stands at phase entry, and the approval record of the phase before
 * (F100-FR-012, F100-FR-234).
 */
import { integrityKindsThatReachTheCritic } from "@specstride/contracts/enums/all-sets";
import { profileRow, type ProfileRow } from "@specstride/contracts/profile/parity";

/* ------------------------------------------------------------------ *
 * The switch of row 32.
 * ------------------------------------------------------------------ */

/** Row 32 of annex X §X.7 — "Comparison of the tree at phase entry". */
export const PARITY_ROW = 32 as const;

/** The configuration key of the switch. */
export const SWITCH_KEY = "integrity.phase_entry" as const;

/** The row itself, as `data/parity-profile.json` holds it. */
export function rowOfTheSwitch(): ProfileRow {
  const row = profileRow(PARITY_ROW);
  if (row === undefined) {
    throw new Error(
      `the \`parity\` profile holds no row ${String(PARITY_ROW)}; F149-FR-008 is switched ` +
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

/** The literals the switch takes. */
export const ON = "on" as const;
export const OFF = "off" as const;

/**
 * Whether the comparison runs, from the configuration. A value the switch does
 * not offer is read as the default of the row, which is `on`: an unreadable
 * switch never silently takes an integrity fact away.
 */
export function theComparisonIsOn(config: Readonly<Record<string, unknown>> = {}): boolean {
  const held = config[SWITCH_KEY];
  if (held === OFF || held === false) return false;
  if (held === ON || held === true) return true;
  return defaultOfTheSwitch() !== OFF;
}

/* ------------------------------------------------------------------ *
 * What the comparison is handed, and what it returns.
 * ------------------------------------------------------------------ */

/**
 * The approval record of the phase before, as this module reads it: the field
 * `treeFingerprint` of `gate:<N>:approved` is what it binds (annex B §B.14).
 */
export type ApprovalOfThePhaseBefore = {
  readonly phase: number;
  readonly treeFingerprint: string;
};

/** What the engine hands in at the entry of a phase. */
export type PhaseEntryInput = {
  /** The phase that starts. */
  readonly phase: number;
  /** The fingerprint of the tree as it stands at the entry of that phase. */
  readonly treeFingerprint: string;
  /** The approval record of the phase before, or `undefined` for the first phase. */
  readonly approvalOfThePhaseBefore?: ApprovalOfThePhaseBefore | undefined;
  /**
   * The paths of the protected set that differ, where the engine worked them
   * out. They become the fact rows for the critic (IR-33); the fingerprint
   * VALUES never do (F100-FR-135, "no fingerprint value per row").
   */
  readonly differingPaths?: readonly string[];
  /** The configuration, which holds the switch of row 32. */
  readonly config?: Readonly<Record<string, unknown>>;
};

/** Why no comparison was made. */
export const REASONS_FOR_NO_COMPARISON = ["switched-off", "no-phase-before"] as const;
export type ReasonForNoComparison = (typeof REASONS_FOR_NO_COMPARISON)[number];

/**
 * The kind of the integrity event a difference raises: `phase-entry-mismatch`,
 * row 65 of annex X §X.6 ("Integrity kinds that reach the critic").
 */
export const INTEGRITY_KIND = "phase-entry-mismatch" as const;

/** The kind is a member of the closed set of row 65; the name cannot drift. */
export const INTEGRITY_KIND_IS_OF_THE_SET: boolean = (
  integrityKindsThatReachTheCritic.members as readonly string[]
).includes(INTEGRITY_KIND);

/** The name of the event on the primary stream. */
export const PHASE_ENTRY_EVENT = "integrity.phase-entry" as const;

/** F149-FR-008: a difference never blocks. */
export const A_DIFFERENCE_BLOCKS = false as const;

/** The integrity event a difference raises. */
export type PhaseEntryEvent = {
  readonly name: typeof PHASE_ENTRY_EVENT;
  /** The kind, from row 65 of annex X §X.6. */
  readonly kind: typeof INTEGRITY_KIND;
  readonly phase: number;
  /** The phase whose approval record bound the tree. */
  readonly phaseBefore: number;
  /** F149-FR-008, F149-FR-009: an integrity event never halts a run. */
  readonly blocking: false;
  /** An integrity event is never read as a verdict (F149-FR-009). */
  readonly isAVerdict: false;
};

/** One row the critic of the phase that starts is told through the fact block. */
export type PhaseEntryFact = {
  /** The kind, from row 65: the fact block carries kinds and no counts (§D.7). */
  readonly integrity: typeof INTEGRITY_KIND;
  /** The path that differs. */
  readonly path: string;
  /** The phase whose approval bound the tree the path differs from. */
  readonly approvedInPhase: number;
};

/** The result of the comparison at the entry of one phase. */
export type PhaseEntryComparison = {
  /** Whether the comparison was made at all. */
  readonly compared: boolean;
  /** Why it was not, where it was not. */
  readonly reason?: ReasonForNoComparison;
  /** Whether the tree differs from what the approval of the phase before binds. */
  readonly differs: boolean;
  /** The fingerprint at phase entry, and the one the approval binds. */
  readonly atPhaseEntry?: string;
  readonly approved?: string;
  /** The integrity event, present exactly where the tree differs. */
  readonly event?: PhaseEntryEvent;
  /** The rows for the fact block of the phase that starts. */
  readonly facts: readonly PhaseEntryFact[];
  /** F149-FR-008: never. */
  readonly blocks: false;
  /** The phase starts whatever the comparison said. */
  readonly thePhaseStarts: true;
};

/* ------------------------------------------------------------------ *
 * The comparison.
 * ------------------------------------------------------------------ */

/**
 * T016 — compare the tree at the entry of a phase with the fingerprint the
 * approval record of the phase before binds.
 *
 * Every path through this function returns `blocks: false` and
 * `thePhaseStarts: true`. That is the whole of "MUST never block": there is no
 * value of the input for which the function reports otherwise, and it has no
 * other output by which a run could be halted.
 */
export function compareTheTreeAtPhaseEntry(input: PhaseEntryInput): PhaseEntryComparison {
  const never = { facts: Object.freeze([]), blocks: false as const, thePhaseStarts: true as const };

  /* Off under the `parity` profile, and wherever the switch of row 32 is off. */
  if (!theComparisonIsOn(input.config ?? {})) {
    return Object.freeze({ compared: false, reason: "switched-off", differs: false, ...never });
  }

  /* The first phase of a run has no phase before it ("Edge cases"). */
  const before = input.approvalOfThePhaseBefore;
  if (before === undefined) {
    return Object.freeze({ compared: false, reason: "no-phase-before", differs: false, ...never });
  }

  const differs = input.treeFingerprint !== before.treeFingerprint;
  if (!differs) {
    return Object.freeze({
      compared: true,
      differs: false,
      atPhaseEntry: input.treeFingerprint,
      approved: before.treeFingerprint,
      ...never,
    });
  }

  return Object.freeze({
    compared: true,
    differs: true,
    atPhaseEntry: input.treeFingerprint,
    approved: before.treeFingerprint,
    event: Object.freeze({
      name: PHASE_ENTRY_EVENT,
      kind: INTEGRITY_KIND,
      phase: input.phase,
      phaseBefore: before.phase,
      blocking: false as const,
      isAVerdict: false as const,
    }),
    facts: factsOf(input.differingPaths ?? [], before.phase),
    blocks: false as const,
    thePhaseStarts: true as const,
  });
}

/**
 * The rows for the fact block: one per differing path, each carrying the KIND
 * of row 65 and no fingerprint value (§D.7, "Never in the block").
 */
export function factsOf(
  differingPaths: readonly string[],
  approvedInPhase: number,
): readonly PhaseEntryFact[] {
  return Object.freeze(
    [...differingPaths].sort().map((path) =>
      Object.freeze({
        integrity: INTEGRITY_KIND,
        path,
        approvedInPhase,
      }),
    ),
  );
}

/**
 * The integrity event, read as a verdict: never. The function exists so that
 * the one answer is in the module the event comes from (F149-FR-009).
 */
export function theEventIsAVerdict(): false {
  return false;
}
