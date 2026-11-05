/**
 * T252 — the closed sets of the owners 110 to 119 (56 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 110 to 119; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import {
  ClosedSetRegistrationError,
  closedSetRows,
  defineByReference,
  defineClosedSet,
  firstOwnerNumber,
  registeredSets,
} from "./index.ts";
import { COMMANDS } from "../grammar/protocol.ts";
// The tables of the two rows of owner 113 that register BY REFERENCE
// (T003 of specs/113-host-claude-code/tasks.md).
import { CAPABILITIES } from "../ep/host.ts";
import { CONTEXT_COST_CHECKS } from "../ep/context-cost.ts";

/**
 * Row 10 — Kill reasons and their classes.
 *
 * Members: Annex E F100-FR-150
 * Owner: 118. Closed by: Design.
 * Unknown value: Class `futility`, as at the baseline
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { killReasonSet as killReasonsAndTheirClasses } from "../codes/stop-reason-literals.ts";

/**
 * Row 27 — `protection`.
 *
 * Members: `prevent`, `detect`
 * Owner: 116. Closed by: Design.
 * Unknown value: Read as `detect`
 */
export const protection = defineClosedSet(27, ["prevent", "detect"] as const);

/**
 * Row 44 — Secret schemes.
 *
 * Members: An open registry; Wave 1: `env:`, `file:`, `keychain:`
 * Owner: 110. Closed by: Open.
 * Unknown value: Configuration error
 */
export const secretSchemes = defineClosedSet(44, ["env:", "file:", "keychain:"] as const);

/**
 * Row 45 — Results of `exists` of a secret.
 *
 * Members: `yes`, `no`, `unprobed`
 * Owner: 110. Closed by: Design.
 * Unknown value: `unprobed`
 */
export const resultsOfExistsOfASecret = defineClosedSet(45, ["yes", "no", "unprobed"] as const);

/**
 * Row 55 — Loop strategies.
 *
 * Members: `classic`, `micro`
 * Owner: 115. Closed by: Owner decision.
 * Unknown value: Configuration error
 */
export const loopStrategies = defineClosedSet(55, ["classic", "micro"] as const);

/**
 * Row 56 — Micro levels.
 *
 * Members: L0, L1, L2, L3; Wave 1 uses L1
 * Owner: 115. Closed by: Design.
 * Unknown value: Configuration error
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const microLevels = defineByReference(56, [] as const);

/**
 * Row 59 — Fallback reasons of the layer `micro`.
 *
 * Members: `gate-not-executing`, `no-check`, `single-unit`, `harness`, `config`, `tripwire`
 * Owner: 115. Closed by: Design.
 * Unknown value: Shown as text
 */
export const fallbackReasonsOfTheLayerMicro = defineClosedSet(59, [
  "gate-not-executing",
  "no-check",
  "single-unit",
  "harness",
  "config",
  "tripwire",
] as const);

/**
 * Row 65 — Integrity kinds that reach the critic.
 *
 * Members: `ledger-invalid`, `manifest-mismatch`, `pin-mismatch`, `changed-during-check`, `phase-entry-mismatch`, `toolchain-config-changed`, `advisory-marker-removed`, and the two neutral kinds of 142, `tree-changed-outside-pass` and `protected-change-not-applied`
 * Owner: 116. Closed by: Design.
 * Unknown value: The kind is not shown to the critic; it stays in the event file
 */
export const integrityKindsThatReachTheCritic = defineClosedSet(65, [
  "ledger-invalid",
  "manifest-mismatch",
  "pin-mismatch",
  "changed-during-check",
  "phase-entry-mismatch",
  "toolchain-config-changed",
  "advisory-marker-removed",
  "tree-changed-outside-pass",
  "protected-change-not-applied",
] as const);

/**
 * Row 66 — Further facts of the fact block.
 *
 * Members: `manifest-rederived`, `result-of-stopped-job`, `evidence-predates-tree`, `source-change-accepted`, `task-list-changed`
 * Owner: 116. Closed by: Design.
 * Unknown value: Not shown
 */
export const furtherFactsOfTheFactBlock = defineClosedSet(66, [
  "manifest-rederived",
  "result-of-stopped-job",
  "evidence-predates-tree",
  "source-change-accepted",
  "task-list-changed",
] as const);

/**
 * Row 67 — Decision points of the router and their choice sets.
 *
 * Members: `tools`: `run`, `exclude:flaky`, `exclude:slow`, `exclude:budget`. `loop`: `stay`, `off:<registered layer>`. `escalation`: `next-tier`, `skip:<skip reason>`. `attempt-tier` (of the attempt planner, owner 149): `bump`, `skip`, `none`. A layer may register a point
 * Owner: 115. Closed by: Design.
 * Unknown value: The table is invalid
 */
export const decisionPointsOfTheRouterAndTheirChoiceSets = defineClosedSet(67, [
  "tools",
  "run",
  "exclude:flaky",
  "exclude:slow",
  "exclude:budget",
  "loop",
  "stay",
  "off:<registered layer>",
  "escalation",
  "next-tier",
  "skip:<skip reason>",
  "attempt-tier",
  "bump",
  "skip",
  "none",
] as const);

/**
 * Row 69 — Predicates of a yield; actions on a first failure.
 *
 * Members: The seven kinds of annex D §D.6; `stop`, `continue-and-notify`
 * Owner: 118. Closed by: Design.
 * Unknown value: The yield artifact is refused
 */
export const predicatesOfAYieldActionsOnAFirstFailure = defineClosedSet(69, [
  "stop",
  "continue-and-notify",
] as const);

/**
 * Row 70 — Job modes of a yield.
 *
 * Members: `launch`, `adopt`
 * Owner: 118. Closed by: Design.
 * Unknown value: The yield artifact is refused
 */
export const jobModesOfAYield = defineClosedSet(70, ["launch", "adopt"] as const);

/**
 * Row 71 — Severities of a doctor finding.
 *
 * Members: `ok`, `info`, `warn`, `fail`
 * Owner: 112. Closed by: Design.
 * Unknown value: `warn`
 */
export const severitiesOfADoctorFinding = defineClosedSet(71, [
  "ok",
  "info",
  "warn",
  "fail",
] as const);

/**
 * Row 72 — Event roles.
 *
 * Members: The role registry, and `supervisor`, `host`
 * Owner: 111; 124. Closed by: Open.
 * Unknown value: Kept as text
 */
export const eventRoles = defineClosedSet(72, ["supervisor", "host"] as const);

/**
 * Row 73 — Event types.
 *
 * Members: The catalogue of 111; the prefix `x.` is free
 * Owner: 111. Closed by: Open by prefix.
 * Unknown value: Ignored by readers
 */
export const eventTypes = defineClosedSet(73, ["x."] as const);

/**
 * Row 74 — `parallel.` event types.
 *
 * Members: `parallel.plan`, `parallel.admission`, `parallel.group.started`, `parallel.group.ended`, `parallel.worker.started`, `parallel.worker.ended`, `parallel.integration`
 * Owner: 111. Closed by: Design.
 * Unknown value: Ignored by readers; they project to nothing
 */
export const parallelEventTypes = defineClosedSet(74, [
  "parallel.plan",
  "parallel.admission",
  "parallel.group.started",
  "parallel.group.ended",
  "parallel.worker.started",
  "parallel.worker.ended",
  "parallel.integration",
] as const);

/**
 * Row 84 — Capabilities of a host.
 *
 * Members: The six of annex H §H.1
 * Owner: 113. Closed by: Design.
 * Unknown value: Ignored
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256). The table is
 * `CAPABILITIES` of `../ep/host.ts`, the machine-readable form of the
 * capability table of annex H §H.1 (`data/host-capabilities.json`), supplied
 * by the owner of the row (T003 of specs/113-host-claude-code/tasks.md).
 */
export const capabilitiesOfAHost = defineByReference(84, CAPABILITIES);

/**
 * Row 89 — Ingress classes.
 *
 * Members: `stream-text`, `tool-arguments`, `tool-result`, `diagnostic`, `target`, `check-output`, `critic-reply`, `comment`, `free-text`
 * Owner: 111. Closed by: Design.
 * Unknown value: Treated as `free-text`
 */
export const ingressClasses = defineClosedSet(89, [
  "stream-text",
  "tool-arguments",
  "tool-result",
  "diagnostic",
  "target",
  "check-output",
  "critic-reply",
  "comment",
  "free-text",
] as const);

/**
 * Row 90 — Marks of dropped content.
 *
 * Members: `redactor-unavailable`, `pattern-set-invalid`
 * Owner: 111. Closed by: Design.
 * Unknown value: Read as `redactor-unavailable`
 */
export const marksOfDroppedContent = defineClosedSet(90, [
  "redactor-unavailable",
  "pattern-set-invalid",
] as const);

/**
 * Row 93 — Delivery statuses of a sink.
 *
 * Members: `attempted`, `accepted`, `failed`, `unknown`
 * Owner: 111. Closed by: Design.
 * Unknown value: `unknown`
 */
export const deliveryStatusesOfASink = defineClosedSet(93, [
  "attempted",
  "accepted",
  "failed",
  "unknown",
] as const);

/**
 * Row 94 — Reasons of a dropped event.
 *
 * Members: `write-failed`, `invalid`, `too-large`
 * Owner: 111. Closed by: Design.
 * Unknown value: `write-failed`
 */
export const reasonsOfADroppedEvent = defineClosedSet(94, [
  "write-failed",
  "invalid",
  "too-large",
] as const);

/**
 * Row 95 — Categories of a tool call.
 *
 * Members: `read`, `edit`, `exec`, `wait`, `search`, `other`
 * Owner: 111. Closed by: Design.
 * Unknown value: `other`
 */
export const categoriesOfAToolCall = defineClosedSet(95, [
  "read",
  "edit",
  "exec",
  "wait",
  "search",
  "other",
] as const);

/**
 * Row 96 — Causes of a synthesized end of a run.
 *
 * Members: `crash`, `host_exit`, `operator_stop`
 * Owner: 111. Closed by: Design.
 * Unknown value: `crash`
 */
export const causesOfASynthesizedEndOfARun = defineClosedSet(96, [
  "crash",
  "host_exit",
  "operator_stop",
] as const);

/**
 * Row 112 — Outcomes of a wait on a yield.
 *
 * Members: `satisfied`, `timeout`, `stop`, `wall_budget`
 * Owner: 118. Closed by: Design.
 * Unknown value: Read as `timeout`
 */
export const outcomesOfAWaitOnAYield = defineClosedSet(112, [
  "satisfied",
  "timeout",
  "stop",
  "wall_budget",
] as const);

/**
 * Row 113 — Steps of the end of a pass.
 *
 * Members: `polite`, `terminate`, `kill`
 * Owner: 118. Closed by: Design.
 * Unknown value: The step is not taken
 */
export const stepsOfTheEndOfAPass = defineClosedSet(113, ["polite", "terminate", "kill"] as const);

/**
 * Row 114 — Results of the evaluation of a yield predicate.
 *
 * Members: 0 satisfied, 1 not yet, 2 cannot be satisfied
 * Owner: 118. Closed by: Design.
 * Unknown value: Read as 2
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const resultsOfTheEvaluationOfAYieldPredicate = defineByReference(114, [] as const);

/**
 * Row 115 — Kinds of presence line of the grounding snapshot.
 *
 * Members: `file`, `directory`, `missing`, `needs-grounding`, `wildcard`, `binary`, `unreadable`, `refused`, `not-shown`
 * Owner: 117. Closed by: Design.
 * Unknown value: The line is not written; the path counts as `not-shown`
 */
export const kindsOfPresenceLineOfTheGroundingSnapshot = defineClosedSet(115, [
  "file",
  "directory",
  "missing",
  "needs-grounding",
  "wildcard",
  "binary",
  "unreadable",
  "refused",
  "not-shown",
] as const);

/**
 * Row 116 — Refused roots of grounding.
 *
 * Members: `control`, `events`, `outbox`, `carry-over`, `worker-root`, `tree-store`, `repository`
 * Owner: 117. Closed by: Owner decision.
 * Unknown value: Refused
 */
export const refusedRootsOfGrounding = defineClosedSet(116, [
  "control",
  "events",
  "outbox",
  "carry-over",
  "worker-root",
  "tree-store",
  "repository",
] as const);

/**
 * Row 117 — Kinds of excerpt.
 *
 * Members: `whole`, `anchored`, `head-tail`, `omitted`, `none`
 * Owner: 117. Closed by: Design.
 * Unknown value: `omitted`
 */
export const kindsOfExcerpt = defineClosedSet(117, [
  "whole",
  "anchored",
  "head-tail",
  "omitted",
  "none",
] as const);

/**
 * Row 118 — Blocks of the critic's prompt.
 *
 * Members: `rules`, `fact-block`, `criteria`, `evidence`, `grounding`, `pins`, `context`, `end`; for the diagnostician also `history`
 * Owner: 117. Closed by: Design.
 * Unknown value: The block is left out and recorded
 */
export const blocksOfTheCriticSPrompt = defineClosedSet(118, [
  "rules",
  "fact-block",
  "criteria",
  "evidence",
  "grounding",
  "pins",
  "context",
  "end",
  "history",
] as const);

/**
 * Row 119 — Order of shrinking of the critic's prompt.
 *
 * Members: `context`, `grounding`, `evidence`
 * Owner: 117. Closed by: Design.
 * Unknown value: Not applicable
 */
export const orderOfShrinkingOfTheCriticSPrompt = defineClosedSet(119, [
  "context",
  "grounding",
  "evidence",
] as const);

/**
 * Row 120 — Values of `prompt.critic.overWindow`.
 *
 * Members: `refuse`, `send`
 * Owner: 117. Closed by: Design.
 * Unknown value: Configuration error
 */
export const valuesOfPromptCriticOverwindow = defineClosedSet(120, ["refuse", "send"] as const);

/**
 * Row 122 — Ways a critic call ends, for the return of the hidden files.
 *
 * Members: `reply`, `failure`, `time-limit`, `kill`, `stop`
 * Owner: 117. Closed by: Design.
 * Unknown value: The files are returned
 */
export const waysACriticCallEndsForTheReturnOfTheHiddenFiles = defineClosedSet(122, [
  "reply",
  "failure",
  "time-limit",
  "kill",
  "stop",
] as const);

/**
 * Row 134 — Groups of a doctor check.
 *
 * Members: `env`, `cli`, `host`, `bin`, `harness`, `auth`, `model`, `critic`, `terms`, `quota`, `budget`, `config`, `secret`, `run`, `sandbox`, `ui`, `telemetry`, `events`, `memory`
 * Owner: 112. Closed by: Design.
 * Unknown value: The check is refused at registration
 */
export const groupsOfADoctorCheck = defineClosedSet(134, [
  "env",
  "cli",
  "host",
  "bin",
  "harness",
  "auth",
  "model",
  "critic",
  "terms",
  "quota",
  "budget",
  "config",
  "secret",
  "run",
  "sandbox",
  "ui",
  "telemetry",
  "events",
  "memory",
] as const);

/**
 * Row 136 — Outcomes of a unit of work.
 *
 * Members: `kept`, `repair`, `unresolved`
 * Owner: 115. Closed by: Design.
 * Unknown value: Read as `unresolved`
 */
export const outcomesOfAUnitOfWork = defineClosedSet(136, [
  "kept",
  "repair",
  "unresolved",
] as const);

/**
 * Row 137 — Status of a unit or task without a result.
 *
 * Members: `unchecked`
 * Owner: 115. Closed by: Design.
 * Unknown value: Read as `unchecked`
 */
export const statusOfAUnitOrTaskWithoutAResult = defineClosedSet(137, ["unchecked"] as const);

/**
 * Row 138 — Refusal reasons of a checkpoint.
 *
 * Members: `pass-killed`, `foreign-id`, `yield-in-pass`, `not-regular`, `stale`, `too-large`, `changed-while-read`, `empty`
 * Owner: 115. Closed by: Design.
 * Unknown value: The checkpoint is refused
 */
export const refusalReasonsOfACheckpoint = defineClosedSet(138, [
  "pass-killed",
  "foreign-id",
  "yield-in-pass",
  "not-regular",
  "stale",
  "too-large",
  "changed-while-read",
  "empty",
] as const);

/**
 * Row 139 — Kinds of record of the ledger namespace `micro`.
 *
 * Members: `unit-declared`, `check-started`, `check-finished`, `unit-kept`, `unit-repair`, `unit-unresolved`, `command-excluded`, `escalation`, `closing-check`, `disengaged`, `integrity`
 * Owner: 115. Closed by: Design.
 * Unknown value: The ledger is invalid for the layer; the layer is off for the phase attempt
 */
export const kindsOfRecordOfTheLedgerNamespaceMicro = defineClosedSet(139, [
  "unit-declared",
  "check-started",
  "check-finished",
  "unit-kept",
  "unit-repair",
  "unit-unresolved",
  "command-excluded",
  "escalation",
  "closing-check",
  "disengaged",
  "integrity",
] as const);

/**
 * Row 140 — Skip reasons of an escalation.
 *
 * Members: `off`, `integrity`, `flaky`, `not-due`, `cap`, `no-ladder`, `critic-collision`, `quota`, `budget`
 * Owner: 115. Closed by: Design.
 * Unknown value: Read as a skip; shown as text
 */
export const skipReasonsOfAnEscalation = defineClosedSet(140, [
  "off",
  "integrity",
  "flaky",
  "not-due",
  "cap",
  "no-ladder",
  "critic-collision",
  "quota",
  "budget",
] as const);

/**
 * Row 141 — Breach kinds of the integrity of the phase gate.
 *
 * Members: `approval-without-gate`, `outer-counter-changed`, `critic-input-excluded-field`, `false-pass`
 * Owner: 115. Closed by: Owner decision.
 * Unknown value: Treated as a breach
 */
export const breachKindsOfTheIntegrityOfThePhaseGate = defineClosedSet(141, [
  "approval-without-gate",
  "outer-counter-changed",
  "critic-input-excluded-field",
  "false-pass",
] as const);

/**
 * Row 142 — Classes of the protected set.
 *
 * Members: A, B
 * Owner: 116. Closed by: Design.
 * Unknown value: Read as class A
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const classesOfTheProtectedSet = defineByReference(142, [] as const);

/**
 * Row 143 — Freshness of a result.
 *
 * Members: `current`, `superseded`
 * Owner: 116. Closed by: Design.
 * Unknown value: Read as `superseded`
 */
export const freshnessOfAResult = defineClosedSet(143, ["current", "superseded"] as const);

/**
 * Row 144 — Logical ids of host skills and entries.
 *
 * Members: `specstride-run`, `specstride-reverse`, `doctor`
 * Owner: 113. Closed by: Design.
 * Unknown value: The build fails
 */
export const logicalIdsOfHostSkillsAndEntries = defineClosedSet(144, [
  "specstride-run",
  "specstride-reverse",
  "doctor",
] as const);

/**
 * Row 145 — Checks of the context-cost build.
 *
 * Members: static size, reference closure, golden output, supervision cycle, judgment payload, host cross-check, startup
 * Owner: 113. Closed by: Design.
 * Unknown value: The build fails
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256). The table is
 * `CONTEXT_COST_CHECKS` of `../ep/context-cost.ts`, which holds the seven
 * checks against `data/closed-sets-113.json` at load, supplied by the owner of
 * the row (T003 of specs/113-host-claude-code/tasks.md).
 */
export const checksOfTheContextCostBuild = defineByReference(145, CONTEXT_COST_CHECKS);

/**
 * Row 157 — Verbs of the front door.
 *
 * Members: The commands of annex G §G.1
 * Owner: 119. Closed by: Design.
 * Unknown value: Exit 1 with the message for an unknown first argument (verb), as F100-FR-182
 *
 * The row gives no literals: it refers to the table of commands of annex G
 * §G.1, `COMMANDS` of `src/grammar/protocol.ts` (T188).
 */
export const verbsOfTheFrontDoor = defineByReference(157, COMMANDS);

/**
 * Row 158 — Reasons of a failure in default output.
 *
 * Members: `no-state`, `no-feature`, `no-log`, `no-events`, `no-verdicts`, `no-verdict-for-phase`, `no-feedback`, `no-spec`, `spec-invalid`, `usage`, `unknown-subcommand`, `internal`
 * Owner: 119. Closed by: Design.
 * Unknown value: `internal`
 */
export const reasonsOfAFailureInDefaultOutput = defineClosedSet(158, [
  "no-state",
  "no-feature",
  "no-log",
  "no-events",
  "no-verdicts",
  "no-verdict-for-phase",
  "no-feedback",
  "no-spec",
  "spec-invalid",
  "usage",
  "unknown-subcommand",
  "internal",
] as const);

/**
 * Row 159 — States of a phase in `phases`.
 *
 * Members: `pending`, `evidence-written`, `rejected(has-feedback)`, `APPROVED`
 * Owner: 119. Closed by: Design.
 * Unknown value: Not applicable: derived
 */
export const statesOfAPhaseInPhases = defineClosedSet(159, [
  "pending",
  "evidence-written",
  "rejected(has-feedback)",
  "APPROVED",
] as const);

/**
 * Row 237 — Errors of a secret resolver.
 *
 * Members: `missing`, `inline-secret`, `unsafe-file`
 * Owner: 110. Closed by: Design.
 * Unknown value: `missing`
 */
export const errorsOfASecretResolver = defineClosedSet(237, [
  "missing",
  "inline-secret",
  "unsafe-file",
] as const);

/**
 * Row 238 — Check points of staleness.
 *
 * Members: `launch`, `resume`, `pass-start`, `critic-start`
 * Owner: 110. Closed by: Owner decision.
 * Unknown value: Configuration error
 */
export const checkPointsOfStaleness = defineClosedSet(238, [
  "launch",
  "resume",
  "pass-start",
  "critic-start",
] as const);

/**
 * Row 239 — Reserved literals of a row of a profile.
 *
 * Members: `off`, `not used`, `baseline`, `as-is`, `(fixture)`
 * Owner: 110. Closed by: Design.
 * Unknown value: The profile is invalid
 */
export const reservedLiteralsOfARowOfAProfile = defineClosedSet(239, [
  "off",
  "not used",
  "baseline",
  "as-is",
  "(fixture)",
] as const);

/**
 * Row 240 — Values of `telemetry.content`.
 *
 * Members: `auto`, `off`
 * Owner: 110. Closed by: Design.
 * Unknown value: Configuration error
 */
export const valuesOfTelemetryContent = defineClosedSet(240, ["auto", "off"] as const);

/**
 * Row 241 — Values of `memory.native.proposer`.
 *
 * Members: `off`, `on`, `as-is`
 * Owner: 110. Closed by: Design.
 * Unknown value: Configuration error
 */
export const valuesOfMemoryNativeProposer = defineClosedSet(241, ["off", "on", "as-is"] as const);

/**
 * Row 242 — Values of `roles.critic.transport`.
 *
 * Members: `auto`, `as-is`
 * Owner: 110. Closed by: Design.
 * Unknown value: Configuration error
 */
export const valuesOfRolesCriticTransport = defineClosedSet(242, ["auto", "as-is"] as const);

/**
 * Row 271 — End causes of a pass (`pass.ended`, field `endCause`).
 *
 * Members: `evidence`, `completed`, `yield`, `no_progress`, `error`, `killed`, `hard_cap`, `quota_pause`, `stopped`, `crash`
 * Owner: 111. Closed by: Design.
 * Unknown value: Read as `error`
 */
export const endCausesOfAPassPassEndedFieldEndcause = defineClosedSet(271, [
  "evidence",
  "completed",
  "yield",
  "no_progress",
  "error",
  "killed",
  "hard_cap",
  "quota_pause",
  "stopped",
  "crash",
] as const);

/**
 * Row 272 — End causes of a phase attempt (`attempt.ended`, field `endCause`).
 *
 * Members: `approved`, `rejected`, `malformed`, `verification-failed`, `no-evidence`, `budget`, `blocked`, `stopped`, `error`, `crash`
 * Owner: 111. Closed by: Design.
 * Unknown value: Read as `error`
 */
export const endCausesOfAPhaseAttemptAttemptEndedFieldEndcause = defineClosedSet(272, [
  "approved",
  "rejected",
  "malformed",
  "verification-failed",
  "no-evidence",
  "budget",
  "blocked",
  "stopped",
  "error",
  "crash",
] as const);

/**
 * Row 273 — Outcomes of a phase (`phase.ended`, field `outcome`).
 *
 * Members: `approved`, `halted`, `blocked`, `stopped`, `crash`
 * Owner: 111. Closed by: Design.
 * Unknown value: Read as `halted`
 */
export const outcomesOfAPhasePhaseEndedFieldOutcome = defineClosedSet(273, [
  "approved",
  "halted",
  "blocked",
  "stopped",
  "crash",
] as const);

/* ------------------------------------------------------------------ *
 * T228 — the rows of owner 116 in this batch.
 *
 * The split of the former micro-loop layer gave feature 116 the integrity of
 * checks and the unit evidence (ruling W-100-02 of the cross-feature review),
 * and with it five rows of annex X §X.6. They fall in this batch because the
 * first number of their `owner` cell is 116, and they are registered above:
 * 27, 65, 66, 142, 143. The list is pinned here and checked against the table
 * at load, so that a row of 116 added to §X.6 without a typed set in this
 * batch — or a row moved to another owner — fails the build rather than the
 * feature that reads the set.
 * ------------------------------------------------------------------ */

/** The rows of annex X §X.6 that owner 116 holds in this batch (T228). */
export const ROWS_OF_OWNER_116: readonly number[] = Object.freeze([27, 65, 66, 142, 143]);

{
  const rowsOf116 = closedSetRows
    .filter((row) => firstOwnerNumber(row.owner) === 116)
    .map((row) => row.number);
  const missing = rowsOf116.filter((n) => !ROWS_OF_OWNER_116.includes(n));
  const stale = ROWS_OF_OWNER_116.filter((n) => !rowsOf116.includes(n));
  if (missing.length > 0 || stale.length > 0) {
    throw new ClosedSetRegistrationError(
      `the rows of owner 116 in annex X §X.6 are ${rowsOf116.join(", ")}; this batch (T252) ` +
        `pins ${ROWS_OF_OWNER_116.join(", ")}` +
        (missing.length > 0 ? `; not registered here: ${missing.join(", ")}` : "") +
        (stale.length > 0 ? `; pinned but no longer owned by 116: ${stale.join(", ")}` : "") +
        ` (F100-FR-208; T228)`,
    );
  }
  for (const number of ROWS_OF_OWNER_116) {
    if (registeredSets().get(number) === undefined) {
      throw new ClosedSetRegistrationError(
        `row ${number} of annex X §X.6 is owned by 116 and is not registered by this batch (T228)`,
      );
    }
  }
}
