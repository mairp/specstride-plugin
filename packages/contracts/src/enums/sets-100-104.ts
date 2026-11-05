/**
 * T250 — the closed sets of the owners 100 to 104 (33 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 100 to 104; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import { defineClosedSet, defineByReference } from "./index.ts";
import { IMPLEMENTATION_CLASSES } from "../ep/extension-point.ts";
import { OUTPUT_MODES } from "../grammar/output-modes.ts";
import { LABELS } from "../grammar/lines.ts";

/**
 * Row 1 — Run states.
 *
 * Members: The ten written states of annex E §E.2
 * Owner: 100. Closed by: Design.
 * Unknown value: Shown as `unknown` with an attention item; a writer never writes one
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { runStateSet as runStates } from "../state/run-state.ts";

/**
 * Row 2 — Derived run conditions.
 *
 * Members: `dead`, `stale`, `launch-abandoned`
 * Owner: 100. Closed by: Design.
 * Unknown value: Not applicable: readers derive them
 */
export const derivedRunConditions = defineClosedSet(2, [
  "dead",
  "stale",
  "launch-abandoned",
] as const);

/**
 * Row 3 — Stop reasons.
 *
 * Members: The 15 members of annex E §E.3
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: Treated as not retryable; reported
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { stopReasonSet as stopReasons } from "../codes/stop-reasons.ts";

/**
 * Row 4 — Blocked reasons.
 *
 * Members: The six of annex E §E.2
 * Owner: 100. Closed by: Design.
 * Unknown value: Shown as text; the run stays blocked
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { blockedReasonSet as blockedReasons } from "../state/blocked-reasons.ts";

/**
 * Row 5 — Terminal `cause`; `causedBy`.
 *
 * Members: `normal`, `crash`, `owner-lost`; `self`, `operator`, `supervisor`, `host`, `crash`
 * Owner: 101. Closed by: Design.
 * Unknown value: Read as `crash`
 */
export const terminalCauseCausedby = defineClosedSet(5, [
  "normal",
  "crash",
  "owner-lost",
  "self",
  "operator",
  "supervisor",
  "host",
  "crash",
] as const);

/**
 * Row 6 — Engine exit codes.
 *
 * Members: Annex E §E.4
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: An exit outside the table is a crash
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { engineExitCodeSet as engineExitCodes } from "../codes/engine.ts";

/**
 * Row 7 — Exit codes per command.
 *
 * Members: Annex G §G.4; annex F §F.8
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: The supervisor's exit map gives 1
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { exitCodePerCommandSet as exitCodesPerCommand } from "../codes/commands.ts";

/**
 * Row 8 — Verdicts.
 *
 * Members: APPROVED, REJECTED, MALFORMED
 * Owner: 101. Closed by: Owner decision.
 * Unknown value: MALFORMED
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const verdicts = defineByReference(8, [] as const);

/**
 * Row 19 — Engine start modes.
 *
 * Members: `standalone`, `child`
 * Owner: 100. Closed by: Design.
 * Unknown value: The start is refused
 */
export const engineStartModes = defineClosedSet(19, ["standalone", "child"] as const);

/**
 * Row 49 — Spec formats.
 *
 * Members: An open registry; Wave 1: `native`, `speckit-tasks`, `openspec-change`, alias `openspec`
 * Owner: 104. Closed by: Open.
 * Unknown value: `unknown-format`
 */
export const specFormats = defineClosedSet(49, [
  "native",
  "speckit-tasks",
  "openspec-change",
  "openspec",
] as const);

/**
 * Row 50 — Files of the staleness verdict.
 *
 * Members: `spec`, `plan`, `tasks`
 * Owner: 104. Closed by: Owner decision.
 * Unknown value: The verdict is stale
 */
export const filesOfTheStalenessVerdict = defineClosedSet(50, ["spec", "plan", "tasks"] as const);

/**
 * Row 51 — `resume` refusals.
 *
 * Members: `lock-held` (exit 5), `owner-survivors` (exit 5), `nothing-to-resume` (exit 3), `source-changed` (exit 3), `unsupported-record` (exit 3), `settings-invalid` (exit 3)
 * Owner: 102. Closed by: Owner decision.
 * Unknown value: Not applicable: the CLI writes them
 */
export const resumeRefusals = defineClosedSet(51, [
  "lock-held",
  "owner-survivors",
  "nothing-to-resume",
  "source-changed",
  "unsupported-record",
  "settings-invalid",
] as const);

/**
 * Row 57 — Directives of a loop layer.
 *
 * Members: The eleven of annex D §D.1
 * Owner: 103. Closed by: Design.
 * Unknown value: The layer is refused at registration
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const directivesOfALoopLayer = defineByReference(57, [] as const);

/**
 * Row 58 — Returns of `afterPass`.
 *
 * Members: `accept`, `refuse`, `none`
 * Owner: 103. Closed by: Design.
 * Unknown value: `none`; the layer is off for the phase attempt
 */
export const returnsOfAfterpass = defineClosedSet(58, ["accept", "refuse", "none"] as const);

/**
 * Row 68 — Operators of a table predicate.
 *
 * Members: The nine of §X.3
 * Owner: 100. Closed by: Design.
 * Unknown value: The table is invalid
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const operatorsOfATablePredicate = defineByReference(68, [] as const);

/**
 * Row 75 — Ranks of configuration.
 *
 * Members: The eight of §X.2
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: Not applicable
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const ranksOfConfiguration = defineByReference(75, [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
] as const);

/**
 * Row 76 — Trust classes; key classes of the run snapshot.
 *
 * Members: Widening, narrowing, neutral, pinnable; `pinned`, `tunable`
 * Owner: 100; 102. Closed by: Design.
 * Unknown value: A key without a trust class is widening; a key of the run snapshot without a class is read as `pinned`
 */
export const trustClassesKeyClassesOfTheRunSnapshot = defineClosedSet(76, [
  "pinned",
  "tunable",
] as const);

/**
 * Row 80 — Output modes.
 *
 * Members: Default output, compatibility output
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: Configuration error
 *
 * The row gives no literals: it refers to the table of annex G §G.2,
 * `OUTPUT_MODES` of `src/grammar/output-modes.ts` (T190).
 */
export const outputModes = defineByReference(80, OUTPUT_MODES);

/**
 * Row 81 — Labels of output lines.
 *
 * Members: The families of annex G §G.3
 * Owner: 100; each line its feature. Closed by: Design.
 * Unknown value: A parser ignores a line whose label it does not know
 *
 * The row gives no literals: it refers to the table of annex G §G.3,
 * `LABELS` of `src/grammar/lines.ts` (T192).
 */
export const labelsOfOutputLines = defineByReference(81, LABELS);

/**
 * Row 83 — Classes of implementation of an extension point.
 *
 * Members: Data, first-party code, third-party code
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: Refused at registration
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const classesOfImplementationOfAnExtensionPoint = defineByReference(
  83,
  IMPLEMENTATION_CLASSES,
);

/**
 * Row 85 — Normalization rules.
 *
 * Members: N-01 to N-29 of §X.8
 * Owner: 100. Closed by: Owner decision.
 * Unknown value: A rule is added only with a register row
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const normalizationRules = defineByReference(85, [
  "N-01",
  "N-02",
  "N-03",
  "N-04",
  "N-05",
  "N-06",
  "N-07",
  "N-08",
  "N-09",
  "N-10",
  "N-11",
  "N-12",
  "N-13",
  "N-14",
  "N-15",
  "N-16",
  "N-17",
  "N-18",
  "N-19",
  "N-20",
  "N-21",
  "N-22",
  "N-23",
  "N-24",
  "N-25",
  "N-26",
  "N-27",
  "N-28",
  "N-29",
] as const);

/**
 * Row 97 — Kinds of source of a specification.
 *
 * Members: `spec`, `plan`, `tasks`, `other`
 * Owner: 104. Closed by: Design.
 * Unknown value: Read as `other`
 */
export const kindsOfSourceOfASpecification = defineClosedSet(97, [
  "spec",
  "plan",
  "tasks",
  "other",
] as const);

/**
 * Row 98 — States of a source in a staleness verdict.
 *
 * Members: `unchanged`, `ticks-only`, `changed`, `unreadable`
 * Owner: 104. Closed by: Design.
 * Unknown value: Read as `changed`
 */
export const statesOfASourceInAStalenessVerdict = defineClosedSet(98, [
  "unchanged",
  "ticks-only",
  "changed",
  "unreadable",
] as const);

/**
 * Row 99 — Errors of a spec-format adapter.
 *
 * Members: `invalid-spec`, `ambiguous-candidates`, `unknown-format`
 * Owner: 104. Closed by: Design.
 * Unknown value: Read as `invalid-spec`
 */
export const errorsOfASpecFormatAdapter = defineClosedSet(99, [
  "invalid-spec",
  "ambiguous-candidates",
  "unknown-format",
] as const);

/**
 * Row 100 — Subcommands of the command `spec`.
 *
 * Members: `feature-slug`, `detect`, `context`, `render-context`, `validate`, `tick`, `numbers`, `title`, `shape`, `slice`, `first-unapproved`
 * Owner: 104. Closed by: Design.
 * Unknown value: Usage error, exit 2
 */
export const subcommandsOfTheCommandSpec = defineClosedSet(100, [
  "feature-slug",
  "detect",
  "context",
  "render-context",
  "validate",
  "tick",
  "numbers",
  "title",
  "shape",
  "slice",
  "first-unapproved",
] as const);

/**
 * Row 121 — Block sets of a prompt (proposer and critic).
 *
 * Members: `current`, `as-is`
 * Owner: 103; 117. Closed by: Design.
 * Unknown value: Configuration error
 */
export const blockSetsOfAPromptProposerAndCritic = defineClosedSet(121, [
  "current",
  "as-is",
] as const);

/**
 * Row 132 — Kinds of record of the ledger namespace `core`.
 *
 * Members: `attempt-open`, `attempt-closed`, `pass-closed`, `counts-reset`
 * Owner: 103. Closed by: Design.
 * Unknown value: The record stays in the check of the chain; its content is ignored
 */
export const kindsOfRecordOfTheLedgerNamespaceCore = defineClosedSet(132, [
  "attempt-open",
  "attempt-closed",
  "pass-closed",
  "counts-reset",
] as const);

/**
 * Row 133 — Reasons for a fresh session.
 *
 * Members: `new-attempt`, `watchdog-kill`, `repeated-failure`, `context-fill`, `age`, `configuration-change`, `relaunch`, `session-unavailable`, `continuation-cap`, `profile-parity`, `group-applied`, `no-continuation`
 * Owner: 103. Closed by: Design.
 * Unknown value: Read as `new-attempt`
 */
export const reasonsForAFreshSession = defineClosedSet(133, [
  "new-attempt",
  "watchdog-kill",
  "repeated-failure",
  "context-fill",
  "age",
  "configuration-change",
  "relaunch",
  "session-unavailable",
  "continuation-cap",
  "profile-parity",
  "group-applied",
  "no-continuation",
] as const);

/**
 * Row 135 — Kinds of accepted change of a source.
 *
 * Members: `spec`, `plan`, `tasks`
 * Owner: 102. Closed by: Design.
 * Unknown value: Refused
 */
export const kindsOfAcceptedChangeOfASource = defineClosedSet(135, [
  "spec",
  "plan",
  "tasks",
] as const);

/**
 * Row 251 — Details of a MALFORMED verdict.
 *
 * Members: `nonce-mismatch`, `no-verdict-line`, `multiple-verdict-lines`, `call-failed`
 * Owner: 101. Closed by: Design.
 * Unknown value: Read as `call-failed`; the verdict stays MALFORMED
 */
export const detailsOfAMalformedVerdict = defineClosedSet(251, [
  "nonce-mismatch",
  "no-verdict-line",
  "multiple-verdict-lines",
  "call-failed",
] as const);

/**
 * Row 252 — Cases of a diagnosis.
 *
 * Members: `grounding`, `real_gap`, `unknown`
 * Owner: 101. Closed by: Design.
 * Unknown value: `unknown`
 */
export const casesOfADiagnosis = defineClosedSet(252, [
  "grounding",
  "real_gap",
  "unknown",
] as const);

/**
 * Row 255 — What failed in an approval record.
 *
 * Members: `schema`, `signature`, `key-unknown`, `verdict`, `evidence-hash`, `verification-hash`, `missing`, `marker-only`
 * Owner: 101. Closed by: Design.
 * Unknown value: The record counts as not approved
 */
export const whatFailedInAnApprovalRecord = defineClosedSet(255, [
  "schema",
  "signature",
  "key-unknown",
  "verdict",
  "evidence-hash",
  "verification-hash",
  "missing",
  "marker-only",
] as const);

/**
 * Row 278 — `outcome` of the record of a phase attempt.
 *
 * Members: `approved`, `rejected`, `malformed`, `gate-failed`, `config-error`, `no-verdict`
 * Owner: 101. Closed by: Design.
 * Unknown value: Read as `rejected`; the verdict stays one of the three members of row 8
 */
export const outcomeOfTheRecordOfAPhaseAttempt = defineClosedSet(278, [
  "approved",
  "rejected",
  "malformed",
  "gate-failed",
  "config-error",
  "no-verdict",
] as const);
