/**
 * T255 — the closed sets of the owners 130 to 144 (42 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 130 to 144; a compound owner such as `100; 102` goes with its first
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
import { TREE_STORE_OPERATIONS } from "../ep/tree-store.ts";

/**
 * Row 39 — Dialects of the JSONL reader.
 *
 * Members: The rows of the dialect table; Wave 1: `prime`, `pi`
 * Owner: 138. Closed by: Open by data.
 * Unknown value: The stream is refused
 */
export const dialectsOfTheJsonlReader = defineClosedSet(39, ["prime", "pi"] as const);

/**
 * Row 60 — Fallback reasons of the layer `parallel`.
 *
 * Members: `classic`, `gate-not-executing`, `not-git`, `submodules`, `git-version`, `harness`, `containment`, `no-group`
 * Owner: 142. Closed by: Design.
 * Unknown value: Shown as text; the layer is off
 */
export const fallbackReasonsOfTheLayerParallel = defineClosedSet(60, [
  "classic",
  "gate-not-executing",
  "not-git",
  "submodules",
  "git-version",
  "harness",
  "containment",
  "no-group",
] as const);

/**
 * Row 61 — Admission checks of a parallel group.
 *
 * Members: `marker`, `scope`, `protected`, `resource`, `headroom`, `check`, `links`, `jobs`
 * Owner: 142. Closed by: Design.
 * Unknown value: The task is serial
 */
export const admissionChecksOfAParallelGroup = defineClosedSet(61, [
  "marker",
  "scope",
  "protected",
  "resource",
  "headroom",
  "check",
  "links",
  "jobs",
] as const);

/**
 * Row 62 — Outcomes of a worker.
 *
 * Members: `integrated`, `refused`, `killed`, `paused`
 * Owner: 143. Closed by: Design.
 * Unknown value: `refused`
 */
export const outcomesOfAWorker = defineClosedSet(62, [
  "integrated",
  "refused",
  "killed",
  "paused",
] as const);

/**
 * Row 63 — Refusal reasons of a delta.
 *
 * Members: `scope`, `protected`, `overlap`, `path-leak`, `checkpoint`, `yield`, `tree-changed-after-end`, `workspace-changed`
 * Owner: 142. Closed by: Design.
 * Unknown value: The delta is refused
 */
export const refusalReasonsOfADelta = defineClosedSet(63, [
  "scope",
  "protected",
  "overlap",
  "path-leak",
  "checkpoint",
  "yield",
  "tree-changed-after-end",
  "workspace-changed",
] as const);

/**
 * Row 64 — Operations of the tree store.
 *
 * Members: The seven of annex D §D.2
 * Owner: 143. Closed by: Design.
 * Unknown value: The layer is refused at registration
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const operationsOfTheTreeStore = defineByReference(64, TREE_STORE_OPERATIONS);

/**
 * Row 86 — Results of the comparator.
 *
 * Members: `equal`, `waived` with its register row, `different`
 * Owner: 141. Closed by: Design.
 * Unknown value: `different`
 */
export const resultsOfTheComparator = defineClosedSet(86, [
  "equal",
  "waived",
  "different",
] as const);

/**
 * Row 91 — Writer classes of the compatibility projection.
 *
 * Members: `engine`, `stream-tap`, `critic`, `learning`
 * Owner: 144. Closed by: Design.
 * Unknown value: `engine`
 */
export const writerClassesOfTheCompatibilityProjection = defineClosedSet(91, [
  "engine",
  "stream-tap",
  "critic",
  "learning",
] as const);

/**
 * Row 92 — Row shapes of the compatibility projection.
 *
 * Members: `bash`, `python`, `learning`, `none`
 * Owner: 144. Closed by: Design.
 * Unknown value: The table is invalid
 */
export const rowShapesOfTheCompatibilityProjection = defineClosedSet(92, [
  "bash",
  "python",
  "learning",
  "none",
] as const);

/**
 * Row 146 — Finding codes of the reverse lint.
 *
 * Members: `template.mandatory`, `template.family`, `template.expected`, `placeholder`, `structure.extra`, `structure.contracts`, `structure.required`, `evidence.format`, `evidence.kind`, `evidence.confidence`, `evidence.validation`, `evidence.disproved`, `evidence.citation`, `evidence.contradicts`, `evidence.
 * Owner: 140. Closed by: Design.
 * Unknown value: Read as an error finding of unknown kind
 */
export const findingCodesOfTheReverseLint = defineClosedSet(146, [
  "template.mandatory",
  "template.family",
  "template.expected",
  "placeholder",
  "structure.extra",
  "structure.contracts",
  "structure.required",
  "evidence.format",
  "evidence.kind",
  "evidence.confidence",
  "evidence.validation",
  "evidence.disproved",
  "evidence.citation",
  "evidence.contradicts",
  "evidence.missing",
  "evidence.skipped",
  "unknowns.placement",
  "spec.fr-format",
  "spec.sc-format",
  "spec.fr-unique",
  "spec.sc-unique",
  "spec.story-format",
  "spec.story-numbers",
  "spec.story-parts",
  "spec.clarifications",
  "research.decisions",
  "data-model.entities",
  "checklist.items",
  "tasks.grammar",
  "tasks.line-format",
  "tasks.ids",
  "tasks.phase-order",
  "tasks.story-labels",
  "tasks.story-exists",
  "tasks.parallel-files",
  "tasks.mode",
  "coverage.fr",
  "claims.missing",
] as const);

/**
 * Row 147 — Severities of a lint finding.
 *
 * Members: `error`, `warning`
 * Owner: 140. Closed by: Design.
 * Unknown value: Read as `error`
 */
export const severitiesOfALintFinding = defineClosedSet(147, ["error", "warning"] as const);

/**
 * Row 148 — Levels of the reverse lint.
 *
 * Members: 0, 1, 2, 3, 4, 5
 * Owner: 140. Closed by: Design.
 * Unknown value: Exit 3
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const levelsOfTheReverseLint = defineByReference(148, [] as const);

/**
 * Row 149 — Evidence kinds; evidence validations.
 *
 * Members: `observed`, `inferred`, `declared`; `verified`, `unverified`, `disproved`
 * Owner: 140. Closed by: Design.
 * Unknown value: An error finding
 */
export const evidenceKindsEvidenceValidations = defineClosedSet(149, [
  "observed",
  "inferred",
  "declared",
  "verified",
  "unverified",
  "disproved",
] as const);

/**
 * Row 151 — Walk modes of the source inventory.
 *
 * Members: `git`, `walk`
 * Owner: 140. Closed by: Design.
 * Unknown value: The inventory is refused
 */
export const walkModesOfTheSourceInventory = defineClosedSet(151, ["git", "walk"] as const);

/**
 * Row 152 — Skip reasons of the source inventory.
 *
 * Members: `binary`, `oversize`, `symlink-escape`
 * Owner: 140. Closed by: Design.
 * Unknown value: Read as a skipped entry of unknown reason; still fingerprinted
 */
export const skipReasonsOfTheSourceInventory = defineClosedSet(152, [
  "binary",
  "oversize",
  "symlink-escape",
] as const);

/**
 * Row 153 — Roles of a file in the source inventory.
 *
 * Members: `ci`, `test`, `schema`, `template`, `doc`, `script`, `source`, `config`, `other`
 * Owner: 140. Closed by: Design.
 * Unknown value: `other`
 */
export const rolesOfAFileInTheSourceInventory = defineClosedSet(153, [
  "ci",
  "test",
  "schema",
  "template",
  "doc",
  "script",
  "source",
  "config",
  "other",
] as const);

/**
 * Row 154 — Kinds of entry point.
 *
 * Members: `bin`, `console-script`, `export`, `container-entrypoint`, `python-main`, `go-main`, `script`
 * Owner: 140. Closed by: Design.
 * Unknown value: Kept as text
 */
export const kindsOfEntryPoint = defineClosedSet(154, [
  "bin",
  "console-script",
  "export",
  "container-entrypoint",
  "python-main",
  "go-main",
  "script",
] as const);

/**
 * Row 155 — Languages of the source inventory.
 *
 * Members: An open set by data: the table of names and extensions
 * Owner: 140. Closed by: Open by data.
 * Unknown value: `unknown`
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const languagesOfTheSourceInventory = defineByReference(155, [] as const);

/**
 * Row 184 — Kinds of record of the ledger namespace `parallel`.
 *
 * Members: `group_planned`, `group_started`, `worker_started`, `worker_ended`, `group_barrier`, `audit_done`, `merge_done`, `apply_started`, `applied`, `ticks_applied`, `merge_check_started`, `merge_check_finished`, `group_closed`
 * Owner: 143. Closed by: Design.
 * Unknown value: The ledger is invalid inside the group; the layer is off for the phase attempt
 */
export const kindsOfRecordOfTheLedgerNamespaceParallel = defineClosedSet(184, [
  "group_planned",
  "group_started",
  "worker_started",
  "worker_ended",
  "group_barrier",
  "audit_done",
  "merge_done",
  "apply_started",
  "applied",
  "ticks_applied",
  "merge_check_started",
  "merge_check_finished",
  "group_closed",
] as const);

/**
 * Row 185 — Reasons for which the layer `parallel` is switched off inside a run.
 *
 * Members: For the phase attempt: `group-failures`, `harness-error`, `unchecked`, `missing-object`, `ledger`, `check-budget`. For the run: `plan-hash`, `apply-incomplete`
 * Owner: 142. Closed by: Design.
 * Unknown value: Shown as text; the layer is off for the run
 */
export const reasonsForWhichTheLayerParallelIsSwitchedOffInsideARun = defineClosedSet(185, [
  "group-failures",
  "harness-error",
  "unchecked",
  "missing-object",
  "ledger",
  "check-budget",
  "plan-hash",
  "apply-incomplete",
] as const);

/**
 * Row 186 — Sources of a write scope.
 *
 * Members: `consumer`, `task-text`
 * Owner: 142. Closed by: Design.
 * Unknown value: The scope is read as absent, which is the whole tree
 */
export const sourcesOfAWriteScope = defineClosedSet(186, ["consumer", "task-text"] as const);

/**
 * Row 215 — Facts of the proof of the critic mode of dsh.
 *
 * Members: `version-pin`, `tool-coverage`, `patch-hash`, `permission-mode`
 * Owner: 130. Closed by: Design.
 * Unknown value: The proof fails: `critic_not_toolless`
 */
export const factsOfTheProofOfTheCriticModeOfDsh = defineClosedSet(215, [
  "version-pin",
  "tool-coverage",
  "patch-hash",
  "permission-mode",
] as const);

/**
 * Row 216 — Values of `harnesses.dsh.critic.proof`.
 *
 * Members: `strict`, `none`
 * Owner: 130. Closed by: Design.
 * Unknown value: Configuration error
 */
export const valuesOfHarnessesDshCriticProof = defineClosedSet(216, ["strict", "none"] as const);

/**
 * Row 217 — Causes of a refused plugin request.
 *
 * Members: `request-not-regular`, `request-link`, `request-too-large`, `request-json`, `request-keys`, `request-contract`, `request-plugins`, `request-duplicate`, `request-reason`, `allowlist-entry`, `not-allowed`, `allowlist-empty`, `install-launch`, `install-timeout`, `install-failed`
 * Owner: 130. Closed by: Design.
 * Unknown value: The request is refused (result 7)
 */
export const causesOfARefusedPluginRequest = defineClosedSet(217, [
  "request-not-regular",
  "request-link",
  "request-too-large",
  "request-json",
  "request-keys",
  "request-contract",
  "request-plugins",
  "request-duplicate",
  "request-reason",
  "allowlist-entry",
  "not-allowed",
  "allowlist-empty",
  "install-launch",
  "install-timeout",
  "install-failed",
] as const);

/**
 * Row 218 — Sources of a fact of the proof of a critic with read-only tools.
 *
 * Members: `stream-first-record`, `adapter-invocation`
 * Owner: 131. Closed by: Design.
 * Unknown value: The proof fails: `critic_not_toolless`
 */
export const sourcesOfAFactOfTheProofOfACriticWithReadOnlyTools = defineClosedSet(218, [
  "stream-first-record",
  "adapter-invocation",
] as const);

/**
 * Row 222 — Diagnostic codes of the JSONL reader.
 *
 * Members: `malformed_json`, `absent_schema`, `unsupported_schema`, `unknown_record`, `provider_retry`, `provider_auth`, `provider_error`, `abandoned_tool`
 * Owner: 138. Closed by: Design.
 * Unknown value: Kept and treated as a warning
 */
export const diagnosticCodesOfTheJsonlReader = defineClosedSet(222, [
  "malformed_json",
  "absent_schema",
  "unsupported_schema",
  "unknown_record",
  "provider_retry",
  "provider_auth",
  "provider_error",
  "abandoned_tool",
] as const);

/**
 * Row 223 — Severities of a diagnostic of the JSONL reader.
 *
 * Members: `error`, `warning`
 * Owner: 138. Closed by: Design.
 * Unknown value: Read as `warning`
 */
export const severitiesOfADiagnosticOfTheJsonlReader = defineClosedSet(223, [
  "error",
  "warning",
] as const);

/**
 * Row 224 — Reason codes of a terminal written by the JSONL reader.
 *
 * Members: `unsupported_schema`, `provider_auth`, `provider_error`
 * Owner: 138. Closed by: Design.
 * Unknown value: Read as `provider_error`
 */
export const reasonCodesOfATerminalWrittenByTheJsonlReader = defineClosedSet(224, [
  "unsupported_schema",
  "provider_auth",
  "provider_error",
] as const);

/**
 * Row 225 — Statuses of a tool record.
 *
 * Members: `start`, `progress`, `end`
 * Owner: 138. Closed by: Design.
 * Unknown value: The record is dropped with a diagnostic event
 */
export const statusesOfAToolRecord = defineClosedSet(225, ["start", "progress", "end"] as const);

/**
 * Row 226 — Words of the end of an agent's stream.
 *
 * Members: Error: `error`, `failed`, `failure`. Success: `success`, `completed`, `complete`, `ok`
 * Owner: 138. Closed by: Design.
 * Unknown value: No terminal
 */
export const wordsOfTheEndOfAnAgentSStream = defineClosedSet(226, [
  "error",
  "failed",
  "failure",
  "success",
  "completed",
  "complete",
  "ok",
] as const);

/**
 * Row 227 — Modes of a critic-class call on prime.
 *
 * Members: `text`, `json`
 * Owner: 138. Closed by: Design.
 * Unknown value: `text`
 */
export const modesOfACriticClassCallOnPrime = defineClosedSet(227, ["text", "json"] as const);

/**
 * Row 262 — Kinds of stub of the oracle.
 *
 * Members: proposer, critic over HTTP, critic as a CLI, diagnostician, engine, verification command, plugin installer, telemetry sink
 * Owner: 141. Closed by: Design.
 * Unknown value: The fixture is refused
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const kindsOfStubOfTheOracle = defineByReference(262, [] as const);

/**
 * Row 263 — Verbs of the proposer stub.
 *
 * Members: `write`, `evidence`, `stream`, `text`, `sleep`, `exit`, `yield`, `silent`, `repeat`, `nothing`, `plugin-request`
 * Owner: 141. Closed by: Design.
 * Unknown value: The fixture is refused
 */
export const verbsOfTheProposerStub = defineClosedSet(263, [
  "write",
  "evidence",
  "stream",
  "text",
  "sleep",
  "exit",
  "yield",
  "silent",
  "repeat",
  "nothing",
  "plugin-request",
] as const);

/**
 * Row 264 — Verbs of the critic stub and the diagnostician stub.
 *
 * Members: `approve`, `reject`, `malformed-none`, `malformed-wrong-nonce`, `malformed-duplicate`, `empty`, `http-error`, `exit`, `hang`, `hint`, `fail`
 * Owner: 141. Closed by: Design.
 * Unknown value: The fixture is refused
 */
export const verbsOfTheCriticStubAndTheDiagnosticianStub = defineClosedSet(264, [
  "approve",
  "reject",
  "malformed-none",
  "malformed-wrong-nonce",
  "malformed-duplicate",
  "empty",
  "http-error",
  "exit",
  "hang",
  "hint",
  "fail",
] as const);

/**
 * Row 265 — Verbs of the engine stub.
 *
 * Members: `succeed`, `transient`, `fail`, `stop`, `sleep`, `crash`
 * Owner: 141. Closed by: Design.
 * Unknown value: The fixture is refused
 */
export const verbsOfTheEngineStub = defineClosedSet(265, [
  "succeed",
  "transient",
  "fail",
  "stop",
  "sleep",
  "crash",
] as const);

/**
 * Row 266 — Verbs of the verification command stubs; of the installer stub.
 *
 * Members: `pass`, `fail`, `slow`, `write-result`; `install`, `fail`, `hang`. The verbs of the sink stub are in the specification of 141
 * Owner: 141. Closed by: Design.
 * Unknown value: The fixture is refused
 */
export const verbsOfTheVerificationCommandStubsOfTheInstallerStub = defineClosedSet(266, [
  "pass",
  "fail",
  "slow",
  "write-result",
  "install",
  "fail",
  "hang",
] as const);

/**
 * Row 267 — Surfaces of the oracle.
 *
 * Members: `exit`, `stdout`, `stderr`, `tree`, `state`, `events`, `transcript`, `processes`, `pipeline`, `telemetry`, `repository`, `launcher`, `home`, `events-primary`, `control-records`, `counters` (S-01 to S-16)
 * Owner: 141. Closed by: Design.
 * Unknown value: The test is refused
 */
export const surfacesOfTheOracle = defineClosedSet(267, [
  "exit",
  "stdout",
  "stderr",
  "tree",
  "state",
  "events",
  "transcript",
  "processes",
  "pipeline",
  "telemetry",
  "repository",
  "launcher",
  "home",
  "events-primary",
  "control-records",
  "counters",
] as const);

/**
 * Row 268 — Handling of a register row in the oracle.
 *
 * Members: normalization rule, off, mapped, waiver, layer field, not observable, none needed, no differential test
 * Owner: 141. Closed by: Design.
 * Unknown value: The suite fails
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const handlingOfARegisterRowInTheOracle = defineByReference(268, [] as const);

/**
 * Row 269 — Variants of a scenario of FX-35 and FX-36.
 *
 * Members: `@engine-stub`, `@full-stack`
 * Owner: 141. Closed by: Design.
 * Unknown value: The test is refused
 */
export const variantsOfAScenarioOfFx35AndFx36 = defineClosedSet(269, [
  "@engine-stub",
  "@full-stack",
] as const);

/**
 * Row 270 — Test tiers of the oracle; status of a fixture family.
 *
 * Members: hermetic, reference, platform; active, retired
 * Owner: 141. Closed by: Design.
 * Unknown value: The test is refused; a family is read as retired
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const testTiersOfTheOracleStatusOfAFixtureFamily = defineByReference(270, [] as const);

/**
 * Row 275 — Kinds of dsh-profile customisation.
 *
 * Members: `plugins`, `host-hooks`, `skills`, `tool-servers`
 * Owner: 130. Closed by: Design.
 * Unknown value: Recorded as `not-switchable`
 */
export const kindsOfDshProfileCustomisation = defineClosedSet(275, [
  "plugins",
  "host-hooks",
  "skills",
  "tool-servers",
] as const);

/**
 * Row 276 — States of a customisation or of native memory of dsh.
 *
 * Members: `off`, `absent`, `opted-in`, `not-switchable`, `as-is`
 * Owner: 130. Closed by: Design.
 * Unknown value: Read as `not-switchable`
 */
export const statesOfACustomisationOrOfNativeMemoryOfDsh = defineClosedSet(276, [
  "off",
  "absent",
  "opted-in",
  "not-switchable",
  "as-is",
] as const);

/* ------------------------------------------------------------------ *
 * T228 — the rows of owner 143 in this batch.
 *
 * The split of the former parallel-units feature gave feature 143 the tree
 * store and the worker side of a group (ruling W-100-03 of the cross-feature
 * review), and with it three rows of annex X §X.6: the outcomes of a worker
 * (62), the operations of the tree store (64) and the thirteen kinds of record
 * of the ledger namespace `parallel` (184). The rows 60, 61 and 63 stay with
 * 142. The list is pinned here and checked against the table at load, so that a
 * row of 143 added to §X.6 without a typed set in this batch — or a row moved
 * to another owner — fails the build rather than the feature that reads the set.
 * ------------------------------------------------------------------ */

/** The rows of annex X §X.6 that owner 143 holds in this batch (T228). */
export const ROWS_OF_OWNER_143: readonly number[] = Object.freeze([62, 64, 184]);

{
  const rowsOf143 = closedSetRows
    .filter((row) => firstOwnerNumber(row.owner) === 143)
    .map((row) => row.number);
  const missing = rowsOf143.filter((n) => !ROWS_OF_OWNER_143.includes(n));
  const stale = ROWS_OF_OWNER_143.filter((n) => !rowsOf143.includes(n));
  if (missing.length > 0 || stale.length > 0) {
    throw new ClosedSetRegistrationError(
      `the rows of owner 143 in annex X §X.6 are ${rowsOf143.join(", ")}; this batch (T255) ` +
        `pins ${ROWS_OF_OWNER_143.join(", ")}` +
        (missing.length > 0 ? `; not registered here: ${missing.join(", ")}` : "") +
        (stale.length > 0 ? `; pinned but no longer owned by 143: ${stale.join(", ")}` : "") +
        ` (F100-FR-208; T228)`,
    );
  }
  for (const number of ROWS_OF_OWNER_143) {
    if (registeredSets().get(number) === undefined) {
      throw new ClosedSetRegistrationError(
        `row ${number} of annex X §X.6 is owned by 143 and is not registered by this batch (T228)`,
      );
    }
  }
}
