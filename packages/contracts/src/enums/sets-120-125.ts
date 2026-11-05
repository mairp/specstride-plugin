/**
 * T253 — the closed sets of the owners 120 to 125 (41 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 120 to 125; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import { defineClosedSet, defineByReference } from "./index.ts";

/**
 * Row 11 — Stage reasons, transient and deliberate.
 *
 * Members: Annex E F100-FR-150
 * Owner: 123. Closed by: Design.
 * Unknown value: Not transient
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { stageReasonSet as stageReasonsTransientAndDeliberate } from "../codes/stop-reason-literals.ts";

/**
 * Row 12 — Pipeline exit reasons.
 *
 * Members: Annex E F100-FR-150
 * Owner: 123. Closed by: Design.
 * Unknown value: Not transient
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { pipelineExitReasonSet as pipelineExitReasons } from "../codes/stop-reason-literals.ts";

/**
 * Row 13 — Launch-check refusals.
 *
 * Members: `launcher-not-found`, `launcher-edited`, `learning-decisions-changed`, `stale-sources`, `open-blocker`, `draft-contract`, `invalid-contract`, `unauthorized-root`, `launcher-syntax-error`, `dry-run-failed`, `already-running`
 * Owner: 123. Closed by: Design.
 * Unknown value: Refusal
 */
export const launchCheckRefusals = defineClosedSet(13, [
  "launcher-not-found",
  "launcher-edited",
  "learning-decisions-changed",
  "stale-sources",
  "open-blocker",
  "draft-contract",
  "invalid-contract",
  "unauthorized-root",
  "launcher-syntax-error",
  "dry-run-failed",
  "already-running",
] as const);

/**
 * Row 14 — Relaunch refusals.
 *
 * Members: Of the table `relaunch-observe`: `relaunch-disabled`, `still-running`, `operator-stop`, `completed`, `deliberate-stop`, `unknown-terminal`, `lock-conflict`, `unknown-launcher-exit`, `signal-stop`, `invalid-contract`, `preflight-blocked`, `stale-sources`, `launcher-exit-<n>`, `state-not-failed`, `unk
 * Owner: 123. Closed by: Design.
 * Unknown value: Refusal
 */
export const relaunchRefusals = defineClosedSet(14, [
  "relaunch-observe",
  "relaunch-disabled",
  "still-running",
  "operator-stop",
  "completed",
  "deliberate-stop",
  "unknown-terminal",
  "lock-conflict",
  "unknown-launcher-exit",
  "signal-stop",
  "invalid-contract",
  "preflight-blocked",
  "stale-sources",
  "launcher-exit-<n>",
  "state-not-failed",
  "unknown-stage",
  "postcondition-failure",
  "stage-precondition",
  "setup-required",
  "interrupted",
  "stage-did-not-run",
  "stage-did-not-fail",
  "exec-error",
  "stage-reason-not-transient",
  "child-exit-not-retryable",
  "stop-reason-not-allowed",
  "contract-digest-changed",
  "learning-decisions-changed",
  "launcher-edited",
  "budget-exhausted",
  "budget-deadline-exceeded",
  "classified-transient",
  "relaunch-root",
  "blocked-on-human",
  "lease-lost",
  "stop-not-retryable",
  "relaunch-held",
  "classified-crash",
] as const);

/**
 * Row 15 — Digest states.
 *
 * Members: `completed`, `failed`, `stopped`, `dry-run`
 * Owner: 123. Closed by: Design.
 * Unknown value: Supervisor outcome unknown-terminal
 */
export const digestStates = defineClosedSet(15, [
  "completed",
  "failed",
  "stopped",
  "dry-run",
] as const);

/**
 * Row 16 — Supervision outcomes.
 *
 * Members: The seven of annex G F100-FR-184
 * Owner: 123. Closed by: Design.
 * Unknown value: Exit 1
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export { supervisionOutcomeSet as supervisionOutcomes } from "../codes/resume-and-supervision.ts";

/**
 * Row 17 — Handshake outcomes.
 *
 * Members: `started`, `attached`, `refused`
 * Owner: 122. Closed by: Design.
 * Unknown value: `refused`
 */
export const handshakeOutcomes = defineClosedSet(17, ["started", "attached", "refused"] as const);

/**
 * Row 18 — Kinds of run request.
 *
 * Members: `pipeline`, `engine`
 * Owner: 123. Closed by: Design.
 * Unknown value: The launch is refused
 */
export const kindsOfRunRequest = defineClosedSet(18, ["pipeline", "engine"] as const);

/**
 * Row 20 — `relaunch.owner`.
 *
 * Members: `root`, `supervise`
 * Owner: 123. Closed by: Owner decision.
 * Unknown value: Configuration error
 */
export const relaunchOwner = defineClosedSet(20, ["root", "supervise"] as const);

/**
 * Row 21 — Inbox request types.
 *
 * Members: `stop`, `hold-relaunch`, `host-event`
 * Owner: 122. Closed by: Design.
 * Unknown value: The request is ignored and reported
 */
export const inboxRequestTypes = defineClosedSet(21, [
  "stop",
  "hold-relaunch",
  "host-event",
] as const);

/**
 * Row 22 — Classes of the process registry; kinds of process.
 *
 * Members: `owned`, `adoptable`; the seven kinds of annex B §B.10
 * Owner: 122. Closed by: Design.
 * Unknown value: Class `owned`; the entry is never signalled without the identity check
 */
export const classesOfTheProcessRegistryKindsOfProcess = defineClosedSet(22, [
  "owned",
  "adoptable",
] as const);

/**
 * Row 23 — Results of a lock probe.
 *
 * Members: The six of annex F §F.5
 * Owner: 122. Closed by: Design.
 * Unknown value: `unknown`, which counts as held
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const resultsOfALockProbe = defineByReference(23, [] as const);

/**
 * Row 24 — Detach strategies.
 *
 * Members: An open registry; Wave 1: `spawn-detached`, `foreground`
 * Owner: 122. Closed by: Open.
 * Unknown value: Configuration error
 */
export const detachStrategies = defineClosedSet(24, ["spawn-detached", "foreground"] as const);

/**
 * Row 25 — Stage kinds; precondition checks.
 *
 * Members: Open registries; Wave 1: the five and the six of annex F §F.7
 * Owner: 123. Closed by: Open.
 * Unknown value: The launch contract is invalid
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const stageKindsPreconditionChecks = defineByReference(25, [] as const);

/**
 * Row 82 — Reasons of a launch.
 *
 * Members: `first`, `resume`, `relaunch`, `manual`
 * Owner: 122. Closed by: Design.
 * Unknown value: `manual`
 */
export const reasonsOfALaunch = defineClosedSet(82, [
  "first",
  "resume",
  "relaunch",
  "manual",
] as const);

/**
 * Row 101 — Resolve refusals.
 *
 * Members: `launcher-not-found`, `launcher-missing`, `launcher-ambiguous`, `launcher-unreadable`, `launcher-not-generated`
 * Owner: 123. Closed by: Design.
 * Unknown value: Refusal
 */
export const resolveRefusals = defineClosedSet(101, [
  "launcher-not-found",
  "launcher-missing",
  "launcher-ambiguous",
  "launcher-unreadable",
  "launcher-not-generated",
] as const);

/**
 * Row 102 — Pipeline states; states of one stage.
 *
 * Members: `preflight`, `ready`, `running`, `failed`, `stopped`, `completed`; `running`, `completed`, `failed`, `stopped`
 * Owner: 123. Closed by: Design.
 * Unknown value: The record is read as empty
 */
export const pipelineStatesStatesOfOneStage = defineClosedSet(102, [
  "preflight",
  "ready",
  "running",
  "failed",
  "stopped",
  "completed",
  "running",
  "completed",
  "failed",
  "stopped",
] as const);

/**
 * Row 103 — Launch decisions; launch checks; statuses of a launch check.
 *
 * Members: `launch`, `refuse`, `attach`; `launcher-intact`, `contract-validated`, `authorized-root`, `launcher-syntax`, `launcher-dry-run`, `run-directory-free`; `pass`, `fail`, `not-evaluated`
 * Owner: 123. Closed by: Design.
 * Unknown value: `refuse`
 */
export const launchDecisionsLaunchChecksStatusesOfALaunchCheck = defineClosedSet(103, [
  "launch",
  "refuse",
  "attach",
  "launcher-intact",
  "contract-validated",
  "authorized-root",
  "launcher-syntax",
  "launcher-dry-run",
  "run-directory-free",
  "pass",
  "fail",
  "not-evaluated",
] as const);

/**
 * Row 104 — Relaunch decisions.
 *
 * Members: `relaunch`, `refuse`, `hold`
 * Owner: 123. Closed by: Design.
 * Unknown value: `refuse`
 */
export const relaunchDecisions = defineClosedSet(104, ["relaunch", "refuse", "hold"] as const);

/**
 * Row 105 — Classes of a stage reason.
 *
 * Members: `transient`, `postcondition`, `stage-precondition`, `setup-required`, `interrupted`, `existing-prerequisite`, `completed`, `exec-error`, `other`
 * Owner: 123. Closed by: Design.
 * Unknown value: `other`
 */
export const classesOfAStageReason = defineClosedSet(105, [
  "transient",
  "postcondition",
  "stage-precondition",
  "setup-required",
  "interrupted",
  "existing-prerequisite",
  "completed",
  "exec-error",
  "other",
] as const);

/**
 * Row 106 — Observation statuses of supervision.
 *
 * Members: `running`, `starting`, `lock-conflict`, `completed`, `failed`, `stopped`, `unknown-terminal`
 * Owner: 123. Closed by: Design.
 * Unknown value: `unknown-terminal`
 */
export const observationStatusesOfSupervision = defineClosedSet(106, [
  "running",
  "starting",
  "lock-conflict",
  "completed",
  "failed",
  "stopped",
  "unknown-terminal",
] as const);

/**
 * Row 107 — As-is modes of a launch by `supervise`; sources of a mode; sources of a launcher.
 *
 * Members: `generate`, `run`, `auto`; `token`, `refusal`, `prose`, `default`; `request`, `feature-default`, `generated-marker`
 * Owner: 123. Closed by: Owner decision.
 * Unknown value: The launch is withheld
 */
export const asIsModesOfALaunchBySuperviseSourcesOfAModeSourcesOfALauncher = defineClosedSet(107, [
  "generate",
  "run",
  "auto",
  "token",
  "refusal",
  "prose",
  "default",
  "request",
  "feature-default",
  "generated-marker",
] as const);

/**
 * Row 108 — Timings and results of a precondition check.
 *
 * Members: `preflight`, `stage`; `pass`, `fail`, `deferred`
 * Owner: 123. Closed by: Design.
 * Unknown value: The check is `fail`
 */
export const timingsAndResultsOfAPreconditionCheck = defineClosedSet(108, [
  "preflight",
  "stage",
  "pass",
  "fail",
  "deferred",
] as const);

/**
 * Row 109 — Colour modes of the pipeline entry.
 *
 * Members: `auto`, `always`, `never`
 * Owner: 123. Closed by: Design.
 * Unknown value: Usage error, exit 2
 */
export const colourModesOfThePipelineEntry = defineClosedSet(109, [
  "auto",
  "always",
  "never",
] as const);

/**
 * Row 110 — Relaunch classifier tables.
 *
 * Members: `relaunch-observe`, `relaunch-root`
 * Owner: 123. Closed by: Design.
 * Unknown value: The table is invalid
 */
export const relaunchClassifierTables = defineClosedSet(110, [
  "relaunch-observe",
  "relaunch-root",
] as const);

/**
 * Row 111 — Verbs of `supervise`.
 *
 * Members: `mode`, `resolve`, `gate`, `launch`, `watch`, `observe`, `auto`, `stop`, `hold`, `release`, and `learning` and `retro` (owner 106)
 * Owner: 123. Closed by: Design.
 * Unknown value: Usage error, exit 2
 */
export const verbsOfSupervise = defineClosedSet(111, [
  "mode",
  "resolve",
  "gate",
  "launch",
  "watch",
  "observe",
  "auto",
  "stop",
  "hold",
  "release",
  "learning",
  "retro",
] as const);

/**
 * Row 180 — Steps of the critic order.
 *
 * Members: `configured`, `gateway`, `discovered`, `default-model-tier`
 * Owner: 124. Closed by: Owner decision.
 * Unknown value: The record is refused
 */
export const stepsOfTheCriticOrder = defineClosedSet(180, [
  "configured",
  "gateway",
  "discovered",
  "default-model-tier",
] as const);

/**
 * Row 181 — Sources of the proposer.
 *
 * Members: `flag`, `environment`, `configuration`, `default`
 * Owner: 124. Closed by: Owner decision.
 * Unknown value: The record is refused
 */
export const sourcesOfTheProposer = defineClosedSet(181, [
  "flag",
  "environment",
  "configuration",
  "default",
] as const);

/**
 * Row 182 — Reasons why a critic candidate does not qualify or is passed over.
 *
 * Members: `role-unsupported`, `form-unproven`, `unverified-cli`, `memory-not-off`, `window-unknown`, `window-too-small`, `not-diverse`, `credential-absent`, `preflight-failed`, `terms-refused`, `terms-unknown`, `quota-exhausted`, `no-budget`, `no-spend-cap`, `read-denial-unconfirmed`, `worker-root-not-empty`,
 * Owner: 124. Closed by: Design.
 * Unknown value: Shown as text; the candidate does not qualify
 */
export const reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver = defineClosedSet(182, [
  "role-unsupported",
  "form-unproven",
  "unverified-cli",
  "memory-not-off",
  "window-unknown",
  "window-too-small",
  "not-diverse",
  "credential-absent",
  "preflight-failed",
  "terms-refused",
  "terms-unknown",
  "quota-exhausted",
  "no-budget",
  "no-spend-cap",
  "read-denial-unconfirmed",
  "worker-root-not-empty",
  "first-call-unproven",
] as const);

/**
 * Row 183 — Results of the diversity test.
 *
 * Members: `diverse`, `same-provider`, `same-model`, `unverified`
 * Owner: 124. Closed by: Design.
 * Unknown value: `unverified`, with the warning
 */
export const resultsOfTheDiversityTest = defineClosedSet(183, [
  "diverse",
  "same-provider",
  "same-model",
  "unverified",
] as const);

/**
 * Row 209 — Results of `reclaim` of a lock.
 *
 * Members: a lease, `lost-race`
 * Owner: 122. Closed by: Design.
 * Unknown value: `lost-race`
 */
export const resultsOfReclaimOfALock = defineClosedSet(209, ["lost-race"] as const);

/**
 * Row 210 — Errors of a detach strategy.
 *
 * Members: `unavailable`, `not-ready`
 * Owner: 122. Closed by: Design.
 * Unknown value: `not-ready`; the launch is refused
 */
export const errorsOfADetachStrategy = defineClosedSet(210, ["unavailable", "not-ready"] as const);

/**
 * Row 211 — What a detach strategy survives.
 *
 * Members: `parent-end`, `session-end`, `reboot`
 * Owner: 122. Closed by: Design.
 * Unknown value: Ignored
 */
export const whatADetachStrategySurvives = defineClosedSet(211, [
  "parent-end",
  "session-end",
  "reboot",
] as const);

/**
 * Row 212 — Refusals of a launch written by the detached runtime and by `launch`.
 *
 * Members: `lock-conflict`, `foreign-owner`, `owner-dead-group-alive`, `lock-unknown`, `provider-mismatch`, `detach-unavailable`, `detach-not-ready`, `control-root-not-writable`, `unadopted-approvals`, `launch-abandoned`, `control-root-unsafe`; `unknown-mode`, `comment-changed` (raised by the launch command of the CLI before the handshake, feature 107)
 * Owner: 122; the last two 107. Closed by: Design.
 * Unknown value: Shown as text; the launch stays refused
 */
export const refusalsOfALaunchWrittenByTheDetachedRuntime = defineClosedSet(212, [
  "lock-conflict",
  "foreign-owner",
  "owner-dead-group-alive",
  "lock-unknown",
  "provider-mismatch",
  "detach-unavailable",
  "detach-not-ready",
  "control-root-not-writable",
  "unadopted-approvals",
  "launch-abandoned",
  "control-root-unsafe",
  "unknown-mode",
  "comment-changed",
] as const);

/**
 * Row 213 — End causes of an entry of the process registry.
 *
 * Members: `exited`, `signalled`, `ended-by-stop`, `ended-by-root`, `ended-as-survivor`, `identity-mismatch`, `gone`
 * Owner: 122. Closed by: Design.
 * Unknown value: Shown as text
 */
export const endCausesOfAnEntryOfTheProcessRegistry = defineClosedSet(213, [
  "exited",
  "signalled",
  "ended-by-stop",
  "ended-by-root",
  "ended-as-survivor",
  "identity-mismatch",
  "gone",
] as const);

/**
 * Row 214 — Results of a case of the spike.
 *
 * Members: `survived`, `ended`, `skipped`
 * Owner: 122. Closed by: Design.
 * Unknown value: `skipped`
 */
export const resultsOfACaseOfTheSpike = defineClosedSet(214, [
  "survived",
  "ended",
  "skipped",
] as const);

/**
 * Row 219 — Outcomes of the proof of a critic call of the Claude harness adapter.
 *
 * Members: `proved`, `refused-tool`, `refused-server`, `refused-session`, `refused-no-record`, `refused-customisation`
 * Owner: 125. Closed by: Design.
 * Unknown value: Read as a refusal, `critic_not_toolless`
 */
export const outcomesOfTheProofOfACriticCallOfTheClaudeHarnessAdapter = defineClosedSet(219, [
  "proved",
  "refused-tool",
  "refused-server",
  "refused-session",
  "refused-no-record",
  "refused-customisation",
] as const);

/**
 * Row 220 — Availability of a transport.
 *
 * Members: `available`, `absent-dependency`, `out-of-range`, `refused-at-tier`, `not-chosen`
 * Owner: 125. Closed by: Design.
 * Unknown value: The transport is unavailable
 */
export const availabilityOfATransport = defineClosedSet(220, [
  "available",
  "absent-dependency",
  "out-of-range",
  "refused-at-tier",
  "not-chosen",
] as const);

/**
 * Row 221 — Classifier signals of the Claude harness adapter.
 *
 * Members: limit event rejected, limit event warning, retry event, overload, billing error, credit required, authentication failure, spending cap, prompt too long, limit message, other
 * Owner: 125. Closed by: Design.
 * Unknown value: `provider_other`, confidence `text`
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const classifierSignalsOfTheClaudeHarnessAdapter = defineByReference(221, [] as const);

/**
 * Row 277 — Providers of lock and liveness.
 *
 * Members: An open registry: the lock providers and liveness probes registered at EP-13 by their owners; Wave 1 names the providers of feature 122
 * Owner: 122. Closed by: Open.
 * Unknown value: An unknown provider id is refused at registration
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const providersOfLockAndLiveness = defineByReference(277, [] as const);

/**
 * Row 279 — Hold refusals.
 *
 * Members: `no-live-run`
 * Owner: 123. Closed by: Design.
 * Unknown value: Refusal
 */
export const holdRefusals = defineClosedSet(279, ["no-live-run"] as const);
