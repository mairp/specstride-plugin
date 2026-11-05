/**
 * T090 — the verification obligations of the plan (F105-FR-014).
 *
 * One obligation per criterion of a phase; a phase without criteria gets one
 * from its title, or `Complete phase <N>`. The kind and the level come from
 * the WORD LIST of changes, which is a data file and not a constant in code
 * (`../../data/word-lists.json`, T003, `research.md` D-16): a further verb of
 * change needs no code. The pair kind-with-level is the closed set of row 231
 * of annex X §X.6, read through `levelOfKind` of `../mode/closed-sets.ts`, so
 * the two halves cannot drift apart here.
 */
import wordLists from "../../data/word-lists.json" with { type: "json" };
import { levelOfKind, type AutomationStatus, type ObligationKind } from "../mode/closed-sets.ts";
import {
  TRIM_ONLY,
  criterionText,
  type CriterionNormalizer,
  type ProjectionPhaseInput,
} from "./projection.ts";
import { obligationId } from "./hash.ts";
import { VerificationError, type PlanObligation } from "./record.ts";

type WordList = {
  readonly id: string;
  readonly constant: string;
  readonly pattern: string;
  readonly flags: readonly string[];
  readonly words: readonly string[];
};

const LISTS: readonly WordList[] = Object.freeze(wordLists.lists as unknown as WordList[]);

/** One list of `../../data/word-lists.json` by its id. */
export function wordListOf(id: string): WordList {
  const list = LISTS.find((one) => one.id === id);
  if (list === undefined) {
    throw new VerificationError(
      `no word list \`${id}\` in data/word-lists.json (it holds ${LISTS.map((l) => l.id).join(", ")})`,
    );
  }
  return list;
}

/** The flags of a list, as a JavaScript regular expression spells them. */
function flagsOf(list: WordList): string {
  return list.flags.includes("IGNORECASE") ? "i" : "";
}

/** The expression of a list of `../../data/word-lists.json`. */
export function expressionOf(id: string): RegExp {
  const list = wordListOf(id);
  return new RegExp(list.pattern, flagsOf(list));
}

/** The id of the list of verbs of change (the baseline's `MUTATION`). */
export const CHANGE_VERBS = "change-verbs" as const;
/** The id of the list of build words (the baseline's `BUILD_ARTIFACT`). */
export const BUILD_WORDS = "build-words" as const;

/** The verbs of change, as the data file spells them out. */
export const CHANGE_VERB_WORDS: readonly string[] = wordListOf(CHANGE_VERBS).words;
/** The build words, as the data file spells them out. */
export const BUILD_WORD_WORDS: readonly string[] = wordListOf(BUILD_WORDS).words;

/** True where the text holds a verb of change from the as-is list. */
export function holdsAVerbOfChange(text: string): boolean {
  return expressionOf(CHANGE_VERBS).test(text);
}

/** True where the text holds a word of the as-is list of build words. */
export function holdsABuildWord(text: string): boolean {
  return expressionOf(BUILD_WORDS).test(text);
}

/**
 * The kind of an obligation (F105-FR-014): `effect-witness` when the TITLE OF
 * THE PHASE OR THE CRITERION holds a verb of change, else `positive`. The
 * baseline searches the two joined by one line end
 * (`lib/verification_plan.py`:796).
 */
export function kindOf(phaseTitle: string, criterion: string): ObligationKind {
  return holdsAVerbOfChange(`${phaseTitle}\n${criterion}`) ? "effect-witness" : "positive";
}

/** The level that goes with a kind: the pair of row 231 (F105-FR-014). */
export function levelOf(kind: ObligationKind): "integration" | "contract" {
  const level = levelOfKind(kind);
  if (level === undefined) {
    throw new VerificationError(`no level is paired with the obligation kind \`${kind}\``);
  }
  return level;
}

/** The two witnesses of an `effect-witness` obligation (`:808`). */
export const EFFECT_WITNESS_WITNESSES = Object.freeze([
  "Observe the resulting state through an independent read path; the mutation response is not proof.",
  "Record a durable identity, lifecycle state, or content hash that could not exist before the action.",
]);

/** The one negative case of an `effect-witness` obligation (`:830`). */
export const EFFECT_WITNESS_NEGATIVE_CASES = Object.freeze([
  "Reject a successful-looking response when no independently readable durable effect exists.",
]);

/** The witness of a `positive` obligation (`:813`). */
export function positiveWitness(criterion: string): string {
  return `Observe independently that this criterion is true: ${criterion}`;
}

/** The title a phase without criteria falls back to (F105-FR-014). */
export function fallbackTitle(phase: ProjectionPhaseInput): string {
  return phase.title || `Complete phase ${phase.number}`;
}

/**
 * The criteria of a phase as the obligations read them: its own, or ONE from
 * its title, or `Complete phase <N>` (F105-FR-014,
 * `lib/verification_plan.py`:793).
 */
export function criteriaOf(phase: ProjectionPhaseInput): readonly string[] {
  const own = phase.criteria ?? [];
  return own.length > 0 ? own : [fallbackTitle(phase)];
}

/** The reference of a criterion: `phase-<N>-criterion-<i>` (F105-FR-014). */
export function acceptanceRef(phase: number, index: number): string {
  return `phase-${phase}-criterion-${index}`;
}

/**
 * The verification obligations of one phase (F105-FR-014). `index` is
 * ONE-BASED, as the baseline's `enumerate(criteria, 1)` is, and the index is
 * part of the obligation id (F105-FR-011).
 */
export function obligationsOfPhase(input: {
  readonly bundleId: string;
  readonly phase: ProjectionPhaseInput;
  readonly automationStatus: AutomationStatus;
  /** How the text of a criterion is read; `TRIM_ONLY` by default. */
  readonly criterionText?: CriterionNormalizer | undefined;
}): readonly PlanObligation[] {
  const title = input.phase.title ?? "";
  const action = fallbackTitle(input.phase);
  const normalize = input.criterionText ?? TRIM_ONLY;
  return Object.freeze(
    criteriaOf(input.phase).map((raw, offset) => {
      const index = offset + 1;
      const criterion = criterionText(raw, normalize);
      const kind = kindOf(title, criterion);
      return Object.freeze({
        id: obligationId({
          bundleId: input.bundleId,
          phase: input.phase.number,
          index,
          criterion,
        }),
        title: criterion,
        phase: input.phase.number,
        requirementRefs: Object.freeze([]),
        acceptanceRefs: Object.freeze([acceptanceRef(input.phase.number, index)]),
        workItemRefs: Object.freeze([]),
        level: levelOf(kind),
        kind,
        setup: Object.freeze([]),
        action,
        oracle: Object.freeze([criterion]),
        witnesses:
          kind === "effect-witness"
            ? EFFECT_WITNESS_WITNESSES
            : Object.freeze([positiveWitness(criterion)]),
        negativeCases:
          kind === "effect-witness" ? EFFECT_WITNESS_NEGATIVE_CASES : Object.freeze([]),
        automationStatus: input.automationStatus,
      } satisfies PlanObligation);
    }),
  );
}

/**
 * `automationStatus` (F105-FR-014): `planned` when a DISCOVERED test command
 * exists and `manual` otherwise (`lib/verification_plan.py`:789). The status
 * is the same for every obligation of the plan.
 */
export function automationStatusOf(
  discoveredCommands: readonly { readonly kind: string }[],
): AutomationStatus {
  return discoveredCommands.some((command) => command.kind === "test") ? "planned" : "manual";
}

/** The verification obligations of every phase, in the order of the phases. */
export function obligationsOf(input: {
  readonly bundleId: string;
  readonly phases: readonly ProjectionPhaseInput[];
  readonly automationStatus: AutomationStatus;
  readonly criterionText?: CriterionNormalizer | undefined;
}): readonly PlanObligation[] {
  return Object.freeze(
    input.phases.flatMap((phase) =>
      obligationsOfPhase({
        bundleId: input.bundleId,
        phase,
        automationStatus: input.automationStatus,
        ...(input.criterionText !== undefined ? { criterionText: input.criterionText } : {}),
      }),
    ),
  );
}
