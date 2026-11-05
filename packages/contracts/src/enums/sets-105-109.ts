/**
 * T251 — the closed sets of the owners 105 to 109 (57 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 105 to 109; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import { defineClosedSet, defineByReference } from "./index.ts";
import { CONTAINMENT_LEVELS } from "./containment.ts";
import { COMPLETION_FORMS } from "./completion-forms.ts";

/**
 * Row 26 — Containment levels.
 *
 * Members: C0, C1, C2, C3
 * Owner: 109. Closed by: Design.
 * Unknown value: Read as C0
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256): the four levels of
 * annex C §C.15, `CONTAINMENT_LEVELS` of `src/enums/containment.ts` (T170).
 */
export const containmentLevels = defineByReference(26, CONTAINMENT_LEVELS);

/**
 * Row 28 — Forms of the `completion` level.
 *
 * Members: `tool-less`, `read-only-tools`
 * Owner: 109. Closed by: Owner decision.
 * Unknown value: `critic_not_toolless`
 */
export const formsOfTheCompletionLevel = defineClosedSet(28, COMPLETION_FORMS);

/**
 * Row 29 — Tool-less mechanism of a descriptor.
 *
 * Members: `structural`, `flag`, `config`, `none`
 * Owner: 109. Closed by: Design.
 * Unknown value: `none`
 */
export const toolLessMechanismOfADescriptor = defineClosedSet(29, [
  "structural",
  "flag",
  "config",
  "none",
] as const);

/**
 * Row 30 — Transports of a harness adapter.
 *
 * Members: `subprocess`, `sdk-in-process`, `direct-call`
 * Owner: 109. Closed by: Design.
 * Unknown value: The transport is unavailable
 */
export const transportsOfAHarnessAdapter = defineClosedSet(30, [
  "subprocess",
  "sdk-in-process",
  "direct-call",
] as const);

/**
 * Row 31 — Kinds of descriptor; stream formats.
 *
 * Members: Open sets, resolved through registries. Kinds of Wave 1: `cli`, `openai-chat`, `anthropic-messages`. Stream formats of Wave 1: `claude` (alias `claude-stream-json`), `prime-v3`, `text`, `jsonl`, `sse-openai`, `sse-anthropic`
 * Owner: 109 (the kinds); 126 (the registry; the rows `claude`, `text`, `sse-openai`, `sse-anthropic`); 138 (the rows `jsonl`, `prime-v3`). Closed by: Open.
 * Unknown value: The descriptor is refused
 */
export const kindsOfDescriptorStreamFormats = defineClosedSet(31, [
  "cli",
  "openai-chat",
  "anthropic-messages",
  "claude",
  "claude-stream-json",
  "prime-v3",
  "text",
  "jsonl",
  "sse-openai",
  "sse-anthropic",
] as const);

/**
 * Row 32 — Placeholders of a descriptor.
 *
 * Members: The seven of annex C §C.2
 * Owner: 109. Closed by: Design.
 * Unknown value: The descriptor is refused
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const placeholdersOfADescriptor = defineByReference(32, [] as const);

/**
 * Row 33 — Provenance of a capability.
 *
 * Members: `declared`, `probed`, `adapter`, `catalogue`
 * Owner: 109. Closed by: Design.
 * Unknown value: The value is read as null
 */
export const provenanceOfACapability = defineClosedSet(33, [
  "declared",
  "probed",
  "adapter",
  "catalogue",
] as const);

/**
 * Row 35 — Origin of a descriptor.
 *
 * Members: `adapter`, `bundled`, `user`, `detected`
 * Owner: 109. Closed by: Design.
 * Unknown value: The descriptor is refused
 */
export const originOfADescriptor = defineClosedSet(35, [
  "adapter",
  "bundled",
  "user",
  "detected",
] as const);

/**
 * Row 36 — Typed failures of the harness port.
 *
 * Members: The eight of annex C §C.1
 * Owner: 109. Closed by: Design.
 * Unknown value: `agent_failure`
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const typedFailuresOfTheHarnessPort = defineByReference(36, [] as const);

/**
 * Row 37 — Outcomes of `betweenPasses`.
 *
 * Members: `continue`; `stop` with 4; `stop` with 7
 * Owner: 109. Closed by: Design.
 * Unknown value: `continue`
 */
export const outcomesOfBetweenpasses = defineClosedSet(37, ["continue", "stop", "stop"] as const);

/**
 * Row 43 — Cost classes.
 *
 * Members: `subscription`, `metered`, `local`, `unknown`
 * Owner: 109. Closed by: Design.
 * Unknown value: `unknown`
 */
export const costClasses = defineClosedSet(43, [
  "subscription",
  "metered",
  "local",
  "unknown",
] as const);

/**
 * Row 52 — Verification modes.
 *
 * Members: `required`, `plan`, `off`
 * Owner: 105. Closed by: Owner decision.
 * Unknown value: Configuration error
 */
export const verificationModes = defineClosedSet(52, ["required", "plan", "off"] as const);

/**
 * Row 77 — Learning modes.
 *
 * Members: `off`, `suggest`, `apply`
 * Owner: 106. Closed by: Design.
 * Unknown value: `off`
 */
export const learningModes = defineClosedSet(77, ["off", "suggest", "apply"] as const);

/**
 * Row 78 — Modes of the host skill `specstride-run`.
 *
 * Members: `run`, `dry-run`
 * Owner: 107. Closed by: Owner decision.
 * Unknown value: The launch is withheld
 */
export const modesOfTheHostSkillSpecstrideRun = defineClosedSet(78, ["run", "dry-run"] as const);

/**
 * Row 79 — Status of a launch contract; kinds and dispositions of a coverage obligation; severity and status of a finding.
 *
 * Members: `draft`, `validated`; the other members are in annex G §G.8
 * Owner: 107. Closed by: Design.
 * Unknown value: The launch contract is invalid
 */
export const statusOfALaunchContractKindsAndDispositionsOfACoverageObligationSeverityAndStatusOfAFinding =
  defineClosedSet(79, ["draft", "validated"] as const);

/**
 * Row 87 — Auth schemes of a descriptor.
 *
 * Members: `bearer`, `x-api-key`, `none`
 * Owner: 109. Closed by: Design.
 * Unknown value: The descriptor is refused
 */
export const authSchemesOfADescriptor = defineClosedSet(87, [
  "bearer",
  "x-api-key",
  "none",
] as const);

/**
 * Row 88 — Scopes of an overlay.
 *
 * Members: `none`, `pass`, `attempt`
 * Owner: 109. Closed by: Design.
 * Unknown value: Configuration error (exit 3)
 */
export const scopesOfAnOverlay = defineClosedSet(88, ["none", "pass", "attempt"] as const);

/**
 * Row 123 — Capability levels of the harness port.
 *
 * Members: `proposer`, `completion`
 * Owner: 109. Closed by: Design.
 * Unknown value: The entry is refused at registration
 */
export const capabilityLevelsOfTheHarnessPort = defineClosedSet(123, [
  "proposer",
  "completion",
] as const);

/**
 * Row 124 — Qualifier forms of a registry entry.
 *
 * Members: `none`, `optional`, `required`
 * Owner: 109. Closed by: Design.
 * Unknown value: The entry is refused at registration
 */
export const qualifierFormsOfARegistryEntry = defineClosedSet(124, [
  "none",
  "optional",
  "required",
] as const);

/**
 * Row 125 — Modes of `stop` of the harness port.
 *
 * Members: `polite`, `terminate`, `kill`
 * Owner: 109. Closed by: Design.
 * Unknown value: Read as `terminate`
 */
export const modesOfStopOfTheHarnessPort = defineClosedSet(125, [
  "polite",
  "terminate",
  "kill",
] as const);

/**
 * Row 126 — Session directives.
 *
 * Members: `fresh`, `continue`
 * Owner: 109. Closed by: Design.
 * Unknown value: Read as `fresh`
 */
export const sessionDirectives = defineClosedSet(126, ["fresh", "continue"] as const);

/**
 * Row 127 — Ways to hand over a prompt.
 *
 * Members: `stdin`, `file`, `argument`
 * Owner: 109. Closed by: Design.
 * Unknown value: The descriptor is refused
 */
export const waysToHandOverAPrompt = defineClosedSet(127, ["stdin", "file", "argument"] as const);

/**
 * Row 128 — Kinds of proof of the form of a critic.
 *
 * Members: `initial-record`, `pinned-configuration`, `read-only-sandbox`
 * Owner: 109. Closed by: Owner decision (rulings 57, 57a, D1); the member `pinned-configuration` by the owner's answer of CQ-182 (2026-09-30; Principle IX of constitution v3.0.1).
 * Unknown value: `critic_not_toolless`
 */
export const kindsOfProofOfTheFormOfACritic = defineClosedSet(128, [
  "initial-record",
  "pinned-configuration",
  "read-only-sandbox",
] as const);

/**
 * Row 129 — Scope words of an overlay marker.
 *
 * Members: `pass`, `attempt`, `critic`
 * Owner: 109. Closed by: Design.
 * Unknown value: The tree is not an overlay of the product and is left alone
 */
export const scopeWordsOfAnOverlayMarker = defineClosedSet(129, [
  "pass",
  "attempt",
  "critic",
] as const);

/**
 * Row 130 — Kinds of record of the environment record of an overlay.
 *
 * Members: `unset`, `set`
 * Owner: 109. Closed by: Design.
 * Unknown value: The pass fails with the result 1
 */
export const kindsOfRecordOfTheEnvironmentRecordOfAnOverlay = defineClosedSet(130, [
  "unset",
  "set",
] as const);

/**
 * Row 131 — Results of `harness verify`.
 *
 * Members: `passed`, `failed`
 * Owner: 109. Closed by: Design.
 * Unknown value: Read as `failed`
 */
export const resultsOfHarnessVerify = defineClosedSet(131, ["passed", "failed"] as const);

/**
 * Row 150 — Tasks modes of a reverse run.
 *
 * Members: `done`, `open`
 * Owner: 108. Closed by: Design.
 * Unknown value: Exit 3
 */
export const tasksModesOfAReverseRun = defineClosedSet(150, ["done", "open"] as const);

/**
 * Row 156 — Kinds of problem of the reverse guard.
 *
 * Members: `deleted`, `added`, `changed`, `fingerprint differs`, `git HEAD moved`, `git status`
 * Owner: 108. Closed by: Design.
 * Unknown value: Not applicable: the guard writes them
 */
export const kindsOfProblemOfTheReverseGuard = defineClosedSet(156, [
  "deleted",
  "added",
  "changed",
  "fingerprint differs",
  "git HEAD moved",
  "git status",
] as const);

/**
 * Row 187 — Adjustable knobs of learning.
 *
 * Members: `proposer_timeout`, `yield_poll_interval`
 * Owner: 106. Closed by: Owner decision.
 * Unknown value: Refused, exit 2
 */
export const adjustableKnobsOfLearning = defineClosedSet(187, [
  "proposer_timeout",
  "yield_poll_interval",
] as const);

/**
 * Row 188 — Actions of a learning decision.
 *
 * Members: `apply`, `revert`, `evaluate`
 * Owner: 106. Closed by: Design.
 * Unknown value: The entry moves no value
 */
export const actionsOfALearningDecision = defineClosedSet(188, [
  "apply",
  "revert",
  "evaluate",
] as const);

/**
 * Row 189 — Arms of an evaluation.
 *
 * Members: `applied`, `baseline`
 * Owner: 106. Closed by: Design.
 * Unknown value: `baseline`
 */
export const armsOfAnEvaluation = defineClosedSet(189, ["applied", "baseline"] as const);

/**
 * Row 190 — Labels of an evaluation.
 *
 * Members: `helped`, `neutral`, `regressed`, `insufficient`
 * Owner: 106. Closed by: Design.
 * Unknown value: `insufficient`
 */
export const labelsOfAnEvaluation = defineClosedSet(190, [
  "helped",
  "neutral",
  "regressed",
  "insufficient",
] as const);

/**
 * Row 191 — Actions taken by an evaluation.
 *
 * Members: `evaluated`, `auto_reverted`, `skipped_superseded`
 * Owner: 106. Closed by: Design.
 * Unknown value: `evaluated`
 */
export const actionsTakenByAnEvaluation = defineClosedSet(191, [
  "evaluated",
  "auto_reverted",
  "skipped_superseded",
] as const);

/**
 * Row 192 — Causes of a reset of the baseline of learning.
 *
 * Members: `shape`, `backend`
 * Owner: 106. Closed by: Design.
 * Unknown value: The label is `insufficient`
 */
export const causesOfAResetOfTheBaselineOfLearning = defineClosedSet(192, [
  "shape",
  "backend",
] as const);

/**
 * Row 193 — Guardrails of learning; their states.
 *
 * Members: `grounding_gap_rate`, `malformed_rate`, `verification`, `diagnostician_grounding_share`, `critic_input_size`, `arbitration_proxy`, `first_attempt_approval`; `ok`, `breach`, `unknown`
 * Owner: 106. Closed by: Design.
 * Unknown value: `unknown`
 */
export const guardrailsOfLearningTheirStates = defineClosedSet(193, [
  "grounding_gap_rate",
  "malformed_rate",
  "verification",
  "diagnostician_grounding_share",
  "critic_input_size",
  "arbitration_proxy",
  "first_attempt_approval",
  "ok",
  "breach",
  "unknown",
] as const);

/**
 * Row 194 — Counterfactuals of the proposer timeout.
 *
 * Members: `censored`, `shorter_cap_wall_only`, `none`
 * Owner: 106. Closed by: Design.
 * Unknown value: `none`
 */
export const counterfactualsOfTheProposerTimeout = defineClosedSet(194, [
  "censored",
  "shorter_cap_wall_only",
  "none",
] as const);

/**
 * Row 195 — Pass outcomes read by learning.
 *
 * Members: `budget_kill`, `worker_error`, `open`, `productive`, `clean_no_progress`
 * Owner: 106. Closed by: Design.
 * Unknown value: `clean_no_progress`
 */
export const passOutcomesReadByLearning = defineClosedSet(195, [
  "budget_kill",
  "worker_error",
  "open",
  "productive",
  "clean_no_progress",
] as const);

/**
 * Row 196 — Statuses of a stage of a retrospective.
 *
 * Members: `ok`, `unavailable`
 * Owner: 106. Closed by: Design.
 * Unknown value: `unavailable`
 */
export const statusesOfAStageOfARetrospective = defineClosedSet(196, [
  "ok",
  "unavailable",
] as const);

/**
 * Row 228 — Stages of a declared verification command.
 *
 * Members: `gate`, `pre`, `prestage`, `both`
 * Owner: 105. Closed by: Design.
 * Unknown value: The declaration is refused
 */
export const stagesOfADeclaredVerificationCommand = defineClosedSet(228, [
  "gate",
  "pre",
  "prestage",
  "both",
] as const);

/**
 * Row 229 — Reuse policies of a staged command.
 *
 * Members: `per-attempt`, `per-phase`, `per-run`
 * Owner: 105. Closed by: Design.
 * Unknown value: The declaration is refused
 */
export const reusePoliciesOfAStagedCommand = defineClosedSet(229, [
  "per-attempt",
  "per-phase",
  "per-run",
] as const);

/**
 * Row 230 — Values of `discovery` of the verification-commands document.
 *
 * Members: `none`
 * Owner: 105. Closed by: Design.
 * Unknown value: The document is refused
 */
export const valuesOfDiscoveryOfTheVerificationCommandsDocument = defineClosedSet(230, [
  "none",
] as const);

/**
 * Row 231 — Kinds and levels of a verification obligation.
 *
 * Members: `effect-witness` with `integration`; `positive` with `contract`
 * Owner: 105. Closed by: Design.
 * Unknown value: The plan is refused
 */
export const kindsAndLevelsOfAVerificationObligation = defineClosedSet(231, [
  "effect-witness",
  "integration",
  "positive",
  "contract",
] as const);

/**
 * Row 232 — Values of `automationStatus`.
 *
 * Members: `planned`, `manual`
 * Owner: 105. Closed by: Design.
 * Unknown value: The plan is refused
 */
export const valuesOfAutomationstatus = defineClosedSet(232, ["planned", "manual"] as const);

/**
 * Row 234 — Sub-commands of the command `verify`.
 *
 * Members: `create`, `validate`, `slice`, `scaffold`, `run`, `prestage`, `prestage-report`
 * Owner: 105. Closed by: Owner decision.
 * Unknown value: Exit 3
 */
export const subCommandsOfTheCommandVerify = defineClosedSet(234, [
  "create",
  "validate",
  "slice",
  "scaffold",
  "run",
  "prestage",
  "prestage-report",
] as const);

/**
 * Row 256 — Kinds of source of a launch contract.
 *
 * Members: `constitution`, `spec`, `plan`, `tasks`, `research`, `data-model`, `quickstart`, `verification-commands`, `contract`, `checklist`
 * Owner: 107. Closed by: Design.
 * Unknown value: The source is refused
 */
export const kindsOfSourceOfALaunchContract = defineClosedSet(256, [
  "constitution",
  "spec",
  "plan",
  "tasks",
  "research",
  "data-model",
  "quickstart",
  "verification-commands",
  "contract",
  "checklist",
] as const);

/**
 * Row 257 — Timing of a coverage obligation.
 *
 * Members: `pipeline-start`, `before:<stage>`, `after:<stage>`, `release`, `specstride-phase:<n>`, `unclassified`
 * Owner: 107. Closed by: Design.
 * Unknown value: The launch contract is invalid
 */
export const timingOfACoverageObligation = defineClosedSet(257, [
  "pipeline-start",
  "before:<stage>",
  "after:<stage>",
  "release",
  "specstride-phase:<n>",
  "unclassified",
] as const);

/**
 * Row 258 — Producer of a coverage obligation.
 *
 * Members: `existing`, `stage:<id>`, `automated-policy`, `external-authority`, `unknown`, `unclassified`
 * Owner: 107. Closed by: Design.
 * Unknown value: The launch contract is invalid
 */
export const producerOfACoverageObligation = defineClosedSet(258, [
  "existing",
  "stage:<id>",
  "automated-policy",
  "external-authority",
  "unknown",
  "unclassified",
] as const);

/**
 * Row 259 — Kinds of judgment item.
 *
 * Members: `classify-obligation`, `settle-prerequisite`, `map-declared-command`, `resolve-blocker`
 * Owner: 107. Closed by: Design.
 * Unknown value: The batch is refused
 */
export const kindsOfJudgmentItem = defineClosedSet(259, [
  "classify-obligation",
  "settle-prerequisite",
  "map-declared-command",
  "resolve-blocker",
] as const);

/**
 * Row 260 — Route of an answer to a judgment item.
 *
 * Members: `host-model`, `delegated-harness`
 * Owner: 107. Closed by: Design.
 * Unknown value: The answer is refused
 */
export const routeOfAnAnswerToAJudgmentItem = defineClosedSet(260, [
  "host-model",
  "delegated-harness",
] as const);

/**
 * Row 261 — Source of a declaration of scope, read or write.
 *
 * Members: `user-config`, `environment`, `flag`
 * Owner: 107. Closed by: Design.
 * Unknown value: The declaration is refused
 */
export const sourceOfADeclarationOfScopeReadOrWrite = defineClosedSet(261, [
  "user-config",
  "environment",
  "flag",
] as const);

/**
 * Row 274 — Error classes of the validation of a launch contract.
 *
 * Members: `unreadable`, `structure`, `action`, `check`, `verification-commands`, `learning`, `auto`, `open-blocker`, `unchecked-prerequisite`, `not-promoted`
 * Owner: 107. Closed by: Design.
 * Unknown value: The build fails (assumption: CQ-194)
 */
export const errorClassesOfTheValidationOfALaunchContract = defineClosedSet(274, [
  "unreadable",
  "structure",
  "action",
  "check",
  "verification-commands",
  "learning",
  "auto",
  "open-blocker",
  "unchecked-prerequisite",
  "not-promoted",
] as const);

/**
 * Row 280 — Kill classes read by learning.
 *
 * Members: `budget`, `futility`, `hang`
 * Owner: 106. Closed by: Design.
 * Unknown value: `unknown`, counted as neither budget nor futility. The as-is
 * kill reasons map onto the classes: hard cap to budget; repeat stall and
 * progress stall to futility; idle timeout to hang
 */
export const killClassesReadByLearning = defineClosedSet(280, [
  "budget",
  "futility",
  "hang",
] as const);

/**
 * Row 281 — Sources of a selected learning mode.
 *
 * Members: `token`, `refusal`, `prose`, `default`
 * Owner: 106. Closed by: Design.
 * Unknown value: `default`
 */
export const sourcesOfASelectedLearningMode = defineClosedSet(281, [
  "token",
  "refusal",
  "prose",
  "default",
] as const);

/**
 * Row 282 — Timing of a check of a launch contract.
 *
 * Members: `preflight`, `stage`
 * Owner: 107. Closed by: Design.
 * Unknown value: The launch contract is invalid. The default is stage, and a
 * postcondition may not have the timing preflight
 */
export const timingOfACheckOfALaunchContract = defineClosedSet(282, [
  "preflight",
  "stage",
] as const);

/**
 * Row 283 — Options that the consumer's comment may select.
 *
 * Members: `features`, `relaunch`, `learning`, `mode`
 * Owner: 107. Closed by: Owner decision.
 * Unknown value: The call is refused (F107-FR-035)
 */
export const optionsThatTheConsumersCommentMaySelect = defineClosedSet(283, [
  "features",
  "relaunch",
  "learning",
  "mode",
] as const);

/**
 * Row 284 — Reason of the verification mode that derivation sets.
 *
 * Members: `declared`, `configured`
 * Owner: 107. Closed by: Design.
 * Unknown value: The build fails: the reason is computed, never read
 */
export const reasonOfTheVerificationModeThatDerivationSets = defineClosedSet(284, [
  "declared",
  "configured",
] as const);

/**
 * Row 285 — Choices of a judgment item.
 *
 * Members: `mapped`, `optional`, `out-of-scope`, `specstride-phase:<n>`,
 * `accepted`, `keep-blocker`
 * Owner: 107. Closed by: Design.
 * Unknown value: The answer is refused (F107-FR-010)
 */
export const choicesOfAJudgmentItem = defineClosedSet(285, [
  "mapped",
  "optional",
  "out-of-scope",
  "specstride-phase:<n>",
  "accepted",
  "keep-blocker",
] as const);
