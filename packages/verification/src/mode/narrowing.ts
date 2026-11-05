/**
 * T104 — the NARROWING RULE for verification in project configuration
 * (F105-FR-045, DV-068).
 *
 * A verification command, a time limit or a mode in project configuration is
 * accepted only inside the narrowing rule of feature 100, annex X §X.2:
 * project configuration MAY make verification STRICTER and MUST NOT
 *
 *  - remove a command,
 *  - weaken the mode, or
 *  - raise `verification.parallelism`.
 *
 * Two things this requirement settles beside the rule:
 *
 *  - the verification-commands DOCUMENT of the project is a PLAN SOURCE and is
 *    not configuration, so none of this applies to what it declares;
 *  - the KEY THAT NAMES that document MAKES CODE RUN, and the owner of the
 *    keys classes it as WIDENING: from project configuration it is ignored
 *    with the launch message and the doctor warning of §X.2, so a file of the
 *    project cannot point a run at a document of its choice.
 *
 * The filter itself is feature 100's (`filterProjectKey` of
 * `@specstride/contracts/envelope/trust-classes`); what this module adds is
 * the trust class of each key of this feature and the comparison "stricter"
 * for a MODE, which no general comparison can make.
 */
import {
  filterProjectKey,
  TRUST_CLASS_DEFAULT,
  type FilterOutcome,
  type Stricter,
  type TrustClass,
} from "@specstride/contracts/envelope/trust-classes";
import { VERIFICATION_MODES, type VerificationMode } from "./closed-sets.ts";
import {
  COMMANDS_KEY,
  GENERATE_TESTS_KEY,
  TEST_PLAN_KEY,
  VERIFICATION_MODE_KEY,
} from "./switches.ts";

/** The key that caps how many verification commands run side by side. */
export const PARALLELISM_KEY = "verification.parallelism" as const;

/**
 * The trust class of every key of this feature (F105-FR-045, §X.2). The MODE
 * and the time limits are NARROWING: project configuration may make them
 * stricter. The key that names the verification-commands document is
 * WIDENING, because it makes code run (F105-FR-045).
 */
export const TRUST_CLASS_OF: Readonly<Record<string, TrustClass>> = Object.freeze({
  [VERIFICATION_MODE_KEY]: "narrowing",
  [PARALLELISM_KEY]: "narrowing",
  [COMMANDS_KEY]: "widening",
  [GENERATE_TESTS_KEY]: "widening",
  [TEST_PLAN_KEY]: "neutral",
});

/** The keys of this feature that project configuration may never set. */
export const WIDENING_KEYS: readonly string[] = Object.freeze(
  Object.entries(TRUST_CLASS_OF)
    .filter(([, cls]) => cls === "widening")
    .map(([key]) => key),
);

/** The trust class of a key, with the default of §X.2 where there is none. */
export function trustClassOf(key: string): TrustClass {
  return TRUST_CLASS_OF[key] ?? TRUST_CLASS_DEFAULT;
}

/**
 * The three things project configuration MUST NOT do (F105-FR-045), as data,
 * so that a reader of the rule and a test read the same list.
 */
export const PROJECT_CONFIGURATION_MUST_NOT = [
  "remove a command",
  "weaken the mode",
  "raise `verification.parallelism`",
] as const;

/** The verification-commands document is a plan source, not configuration. */
export const THE_DOCUMENT_IS_CONFIGURATION = false as const;

/**
 * How strict each mode is: `off` is the loosest, `required` the strictest. A
 * mode of project configuration is accepted only where it is STRICTER than the
 * one from the lower ranks (F105-FR-045).
 */
export const STRICTNESS_OF_A_MODE: Readonly<Record<VerificationMode, number>> = Object.freeze({
  off: 0,
  plan: 1,
  required: 2,
});

/** The order of the modes from the loosest to the strictest. */
export const MODES_FROM_LOOSEST: readonly VerificationMode[] = Object.freeze(
  [...VERIFICATION_MODES].sort((a, b) => STRICTNESS_OF_A_MODE[a] - STRICTNESS_OF_A_MODE[b]),
);

/** True where the candidate mode is stricter than the one in force. */
export function modeIsStricter(candidate: unknown, fromLowerRanks: unknown): boolean {
  const left = STRICTNESS_OF_A_MODE[candidate as VerificationMode];
  const right = STRICTNESS_OF_A_MODE[fromLowerRanks as VerificationMode];
  if (left === undefined || right === undefined) return false;
  return left > right;
}

/**
 * The comparison "stricter" for the keys of this feature (F105-FR-045): for a
 * MODE the order above, for a NUMBER the smaller value — which is what makes
 * raising `verification.parallelism` impossible from project configuration.
 */
export const verificationStricter: Stricter = (candidate, fromLowerRanks) => {
  if (
    typeof candidate === "string" &&
    typeof fromLowerRanks === "string" &&
    candidate in STRICTNESS_OF_A_MODE &&
    fromLowerRanks in STRICTNESS_OF_A_MODE
  ) {
    return modeIsStricter(candidate, fromLowerRanks);
  }
  if (typeof candidate === "number" && typeof fromLowerRanks === "number") {
    return candidate < fromLowerRanks;
  }
  return false;
};

/**
 * One key of project configuration, filtered (F105-FR-045). The outcome is
 * feature 100's `FilterOutcome`, so a key that is dropped carries the launch
 * message and the doctor warning of §X.2 and this module writes neither.
 */
export function filterVerificationKey(input: {
  readonly key: string;
  readonly value: unknown;
  readonly fromLowerRanks: unknown;
}): FilterOutcome {
  return filterProjectKey(
    input.key,
    input.value,
    trustClassOf(input.key),
    input.fromLowerRanks,
    verificationStricter,
  );
}

/**
 * A COMMAND of project configuration (F105-FR-045): a command may be added —
 * adding one makes verification stricter — and never removed. The rule is
 * stated over the two lists, because no comparison of one value can see a
 * removal.
 */
export function commandsOfProjectConfigurationAreAccepted(input: {
  readonly fromLowerRanks: readonly string[];
  readonly fromTheProject: readonly string[];
}): { readonly accepted: boolean; readonly removed: readonly string[] } {
  const removed = input.fromLowerRanks.filter((one) => !input.fromTheProject.includes(one));
  return Object.freeze({ accepted: removed.length === 0, removed: Object.freeze(removed) });
}

/** The launch message a removal of a command is ignored with (§X.2). */
export function removalIsIgnoredMessage(removed: readonly string[]): string {
  return (
    "project configuration cannot loosen a run: it removes the verification " +
    `command(s) ${removed.join(", ")}, and the removal was ignored (F105-FR-045, F100-FR-202)`
  );
}

/** The doctor warning a removal of a command gives (§X.2). */
export function removalDoctorWarning(removed: readonly string[]): string {
  return (
    "the project configuration file removes the verification command(s) " +
    `${removed.join(", ")}; the removal is ignored (F105-FR-045, F100-FR-202)`
  );
}
