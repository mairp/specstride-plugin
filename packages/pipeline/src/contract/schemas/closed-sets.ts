/**
 * T003 — the closed sets the item schemas of this feature read from
 * `@specstride/contracts`, where feature 100 generates them (F100-FR-208).
 *
 * The item schemas of `schemas/` are JSON documents, and JSON Schema has no
 * import: their `enum` members are therefore written out, but this module is
 * the single reading of the closed sets of annex X §X.6 that the schemas cite,
 * and the static test `test/contract-schemas.test.ts` refuses a schema whose
 * enum differs from the members of the set this module hands over. The sets
 * are never copied by hand into a rule of this feature: a set that changes in
 * the table of feature 100 changes the test, which is where the drift shows.
 *
 * The rows the items of this feature name (feature 107, spec.md "Closed
 * sets", and the rows the requirements cite beside them):
 *
 * - row 52  — the verification modes (feature 105; F107-FR-036 cites it)
 * - row 78  — the modes of the host skill `specstride-run`
 * - row 79  — the status of the launch contract, the kinds and dispositions
 *             of a coverage obligation, the severity and status of a finding
 * - row 256 — the kinds of a source
 * - row 257 — the timing of a coverage obligation
 * - row 258 — the producer of a coverage obligation
 * - row 259 — the kinds of a judgment item
 * - row 260 — the route of an answer to a judgment item
 * - row 261 — the source of a declaration of scope, read or write
 * - row 274 — the error classes of the validation of the launch contract
 * - row 282 — the timing of a check of the launch contract
 * - row 283 — the options that the consumer's comment may select
 * - row 284 — the reason of the verification mode that derivation sets
 * - row 285 — the choices of a judgment item
 *
 * The report T003 owes (for T061): every closed set the specification of
 * feature 107 names has a row in the table as it stands — rows 282 to 285 and
 * the two members `unknown-mode` and `comment-changed` of the refusals of
 * `launch` (row 212) were added by the items P-2 and P-3 of the
 * analyze-report.md, and nothing of the spec names a set that has no row.
 */
import {
  choicesOfAJudgmentItem,
  errorClassesOfTheValidationOfALaunchContract,
  kindsOfJudgmentItem,
  kindsOfSourceOfALaunchContract,
  modesOfTheHostSkillSpecstrideRun,
  optionsThatTheConsumersCommentMaySelect,
  producerOfACoverageObligation,
  reasonOfTheVerificationModeThatDerivationSets,
  routeOfAnAnswerToAJudgmentItem,
  sourceOfADeclarationOfScopeReadOrWrite,
  statusOfALaunchContractKindsAndDispositionsOfACoverageObligationSeverityAndStatusOfAFinding,
  timingOfACheckOfALaunchContract,
  timingOfACoverageObligation,
  verificationModes,
} from "@specstride/contracts/enums/all-sets";
import type { ClosedSet } from "@specstride/contracts/enums";

/** A closed set of the items of this feature, by the row of annex X §X.6. */
export type ContractClosedSet = ClosedSet<string>;

/** The row of annex X §X.6 a set is read from. */
export const ROWS_OF_CONTRACT_CLOSED_SETS = [
  52, 78, 79, 256, 257, 258, 259, 260, 261, 274, 282, 283, 284, 285,
] as const;

/** The verification modes (row 52, feature 105): `required`, `plan`, `off`. */
export const verificationModeSet: ContractClosedSet = verificationModes;

/** The modes of the host skill `specstride-run` (row 78): `run`, `dry-run`. */
export const modesOfTheHostSkillSet: ContractClosedSet = modesOfTheHostSkillSpecstrideRun;

/**
 * The status of the launch contract, the kinds and dispositions of a coverage
 * obligation, the severity and status of a finding (row 79): the members
 * `draft`, `validated` here, the others in annex G §G.8.
 */
export const statusAndDispositionSet: ContractClosedSet =
  statusOfALaunchContractKindsAndDispositionsOfACoverageObligationSeverityAndStatusOfAFinding;

/** The kinds of a source (row 256). */
export const sourceKindSet: ContractClosedSet = kindsOfSourceOfALaunchContract;

/** The timing of a coverage obligation (row 257). */
export const coverageTimingSet: ContractClosedSet = timingOfACoverageObligation;

/** The producer of a coverage obligation (row 258). */
export const coverageProducerSet: ContractClosedSet = producerOfACoverageObligation;

/** The kinds of a judgment item (row 259). */
export const judgmentItemKindSet: ContractClosedSet = kindsOfJudgmentItem;

/** The route of an answer to a judgment item (row 260). */
export const answerRouteSet: ContractClosedSet = routeOfAnAnswerToAJudgmentItem;

/** The source of a declaration of scope, read or write (row 261). */
export const declarationSourceSet: ContractClosedSet = sourceOfADeclarationOfScopeReadOrWrite;

/** The error classes of the validation of the launch contract (row 274). */
export const errorClassSet: ContractClosedSet = errorClassesOfTheValidationOfALaunchContract;

/** The timing of a check of the launch contract (row 282): `preflight`, `stage`. */
export const checkTimingSet: ContractClosedSet = timingOfACheckOfALaunchContract;

/** The options that the consumer's comment may select (row 283). */
export const commentOptionSet: ContractClosedSet = optionsThatTheConsumersCommentMaySelect;

/** The reason of the verification mode that derivation sets (row 284). */
export const verificationReasonSet: ContractClosedSet =
  reasonOfTheVerificationModeThatDerivationSets;

/** The choices of a judgment item (row 285). */
export const judgmentChoiceSet: ContractClosedSet = choicesOfAJudgmentItem;

/** Every closed set the item schemas of this feature read, by its row. */
export const CONTRACT_CLOSED_SETS: ReadonlyMap<number, ContractClosedSet> = Object.freeze(
  new Map<number, ContractClosedSet>([
    [52, verificationModeSet],
    [78, modesOfTheHostSkillSet],
    [79, statusAndDispositionSet],
    [256, sourceKindSet],
    [257, coverageTimingSet],
    [258, coverageProducerSet],
    [259, judgmentItemKindSet],
    [260, answerRouteSet],
    [261, declarationSourceSet],
    [274, errorClassSet],
    [282, checkTimingSet],
    [283, commentOptionSet],
    [284, verificationReasonSet],
    [285, judgmentChoiceSet],
  ]),
);
