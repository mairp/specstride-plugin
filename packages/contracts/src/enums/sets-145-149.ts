/**
 * T256 — the closed sets of the owners 145 to 149 (23 rows of
 * `data/closed-sets.json`: the feature number at the start of `owner` in
 * 145 to 149; a compound owner such as `100; 102` goes with its first
 * number). Each is a typed set registered through T070, with its members from
 * `literals` and its unknown-value rule (annex X, §X.6; F100-FR-208).
 *
 * Generated from the data file, so that the sets and the table cannot drift.
 */
import { defineClosedSet, defineByReference } from "./index.ts";

/**
 * Row 9 — Kinds of phase attempt.
 *
 * Members: `plain`, `diagnosed`, `accelerated`, `bumped`
 * Owner: 149. Closed by: Design.
 * Unknown value: `plain`
 */
export const kindsOfPhaseAttempt = defineClosedSet(9, [
  "plain",
  "diagnosed",
  "accelerated",
  "bumped",
] as const);

/**
 * Row 34 — States of a harness.
 *
 * Members: `tested`, `locally-verified`, `declared`, `detected`
 * Owner: 146. Closed by: Design.
 * Unknown value: `detected`
 */
export const statesOfAHarness = defineClosedSet(34, [
  "tested",
  "locally-verified",
  "declared",
  "detected",
] as const);

/**
 * Row 40 — Auth tiers.
 *
 * Members: Tier 1, Tier 2, Tier 3. Tier 3 is never a valid value of configuration or of a descriptor
 * Owner: 147. Closed by: Owner decision.
 * Unknown value: Configuration error
 *
 * The row gives no literals: it refers to another table of the package, and
 * registers by reference to that export (T250 to T256).
 */
export const authTiers = defineByReference(40, [] as const);

/**
 * Row 41 — Audiences.
 *
 * Members: `personal`, `distributed`
 * Owner: 147. Closed by: Owner decision.
 * Unknown value: Configuration error
 */
export const audiences = defineClosedSet(41, ["personal", "distributed"] as const);

/**
 * Row 42 — Status of a terms row.
 *
 * Members: `allowed`, `conditional`, `personal-only`, `refused`
 * Owner: 147. Closed by: Design.
 * Unknown value: `refused`
 */
export const statusOfATermsRow = defineClosedSet(42, [
  "allowed",
  "conditional",
  "personal-only",
  "refused",
] as const);

/**
 * Row 53 — Result conditions of a check; reasons of `tainted`; reasons of `unchecked`.
 *
 * Members: `tainted`, `cached`, `flaky`, `interrupted`, `unchecked`; `changed-during-check`, `protected-set-changed`, `pin-mismatch`; `no-command`, `slow`, `budget`, `flaky-excluded`, `gate-not-executing`, `partial`, `unknown-condition`
 * Owner: 148. Closed by: Design.
 * Unknown value: An unknown condition makes the result `unchecked` with the reason `unknown-condition`; an unknown reason is shown as text
 */
export const resultConditionsOfACheckReasonsOfTaintedReasonsOfUnchecked = defineClosedSet(53, [
  "tainted",
  "cached",
  "flaky",
  "interrupted",
  "unchecked",
  "changed-during-check",
  "protected-set-changed",
  "pin-mismatch",
  "no-command",
  "slow",
  "budget",
  "flaky-excluded",
  "gate-not-executing",
  "partial",
  "unknown-condition",
] as const);

/**
 * Row 54 — Errors of the check runner.
 *
 * Members: `cannot-start`, `timeout`, `interrupted`
 * Owner: 148. Closed by: Design.
 * Unknown value: `cannot-start`
 */
export const errorsOfTheCheckRunner = defineClosedSet(54, [
  "cannot-start",
  "timeout",
  "interrupted",
] as const);

/**
 * Row 160 — Presenter modes.
 *
 * Members: `timeline`, `card`, `plain`
 * Owner: 145. Closed by: Design.
 * Unknown value: Usage error, exit 2
 */
export const presenterModes = defineClosedSet(160, ["timeline", "card", "plain"] as const);

/**
 * Row 161 — Detail levels of the presenter.
 *
 * Members: `milestones`, `tools`, `full`
 * Owner: 145. Closed by: Design.
 * Unknown value: From the variable: `tools`; from the flag: usage error, exit 2
 */
export const detailLevelsOfThePresenter = defineClosedSet(161, [
  "milestones",
  "tools",
  "full",
] as const);

/**
 * Row 162 — Colour depths.
 *
 * Members: `none`, `16`, `256`, `truecolor`
 * Owner: 145. Closed by: Design.
 * Unknown value: Ignored
 */
export const colourDepths = defineClosedSet(162, ["none", "16", "256", "truecolor"] as const);

/**
 * Row 163 — Colour arguments.
 *
 * Members: `always`, `never`, `auto`
 * Owner: 145. Closed by: Design.
 * Unknown value: Usage error
 */
export const colourArguments = defineClosedSet(163, ["always", "never", "auto"] as const);

/**
 * Row 164 — Backgrounds.
 *
 * Members: `dark`, `light`
 * Owner: 145. Closed by: Design.
 * Unknown value: `dark`
 */
export const backgrounds = defineClosedSet(164, ["dark", "light"] as const);

/**
 * Row 165 — Colour roles.
 *
 * Members: `brand`, `accent`, `approved`, `warn`, `reject`, `muted`
 * Owner: 145. Closed by: Design.
 * Unknown value: Not applicable
 */
export const colourRoles = defineClosedSet(165, [
  "brand",
  "accent",
  "approved",
  "warn",
  "reject",
  "muted",
] as const);

/**
 * Row 166 — Width steps of the banner.
 *
 * Members: `full`, `compact`, `line`
 * Owner: 145. Closed by: Design.
 * Unknown value: Not applicable: derived from the size
 */
export const widthStepsOfTheBanner = defineClosedSet(166, ["full", "compact", "line"] as const);

/**
 * Row 167 — Rail states.
 *
 * Members: `A` approved, `R` rejected, `C` current, `P` pending
 * Owner: 145. Closed by: Design.
 * Unknown value: `P`
 */
export const railStates = defineClosedSet(167, ["A", "R", "C", "P"] as const);

/**
 * Row 168 — Live settings.
 *
 * Members: `auto`, `true`, `false`
 * Owner: 145. Closed by: Design.
 * Unknown value: `auto`
 */
export const liveSettings = defineClosedSet(168, ["auto", "true", "false"] as const);

/**
 * Row 178 — Sources of discovery.
 *
 * Members: `harness-adapter`, `binary`, `config-home`, `host`, `endpoint`, `gateway`, `declared`
 * Owner: 146. Closed by: Owner decision.
 * Unknown value: The candidate is dropped, with a doctor finding
 */
export const sourcesOfDiscovery = defineClosedSet(178, [
  "harness-adapter",
  "binary",
  "config-home",
  "host",
  "endpoint",
  "gateway",
  "declared",
] as const);

/**
 * Row 179 — Steps of the probe ladder.
 *
 * Members: `presence`, `version-help`, `credential-presence`, `metadata`, `catalogue`
 * Owner: 146. Closed by: Design.
 * Unknown value: The value is read as null
 */
export const stepsOfTheProbeLadder = defineClosedSet(179, [
  "presence",
  "version-help",
  "credential-presence",
  "metadata",
  "catalogue",
] as const);

/**
 * Row 233 — Signals of a result that has no exit code.
 *
 * Members: `TIMEOUT`, `EXEC_ERROR`, `DEADLINE`
 * Owner: 148; `DEADLINE`: 105. Closed by: Design.
 * Unknown value: The command counts as failed
 */
export const signalsOfAResultThatHasNoExitCode = defineClosedSet(233, [
  "TIMEOUT",
  "EXEC_ERROR",
  "DEADLINE",
] as const);

/**
 * Row 235 — State of a run of steps.
 *
 * Members: `full`, `partial`
 * Owner: 148. Closed by: Design.
 * Unknown value: `partial`
 */
export const stateOfARunOfSteps = defineClosedSet(235, ["full", "partial"] as const);

/**
 * Row 236 — Reasons of an admission to a batch of verification commands.
 *
 * Members: `disjoint`; `undeclared`, `reads-written`, `writes-overlap`, `follows-writer`, `exclusive`, `steps`, `demoted`
 * Owner: 148. Closed by: Design.
 * Unknown value: The command runs alone
 */
export const reasonsOfAnAdmissionToABatchOfVerificationCommands = defineClosedSet(236, [
  "disjoint",
  "undeclared",
  "reads-written",
  "writes-overlap",
  "follows-writer",
  "exclusive",
  "steps",
  "demoted",
] as const);

/**
 * Row 253 — Outcomes of the bump rule.
 *
 * Members: `bump`, `skip`, `none`
 * Owner: 149. Closed by: Design.
 * Unknown value: `none`
 */
export const outcomesOfTheBumpRule = defineClosedSet(253, ["bump", "skip", "none"] as const);

/**
 * Row 254 — Reasons of a skipped bump.
 *
 * Members: `critic-model`, `quota-exhausted`, `ladder-top`
 * Owner: 149. Closed by: Design.
 * Unknown value: Shown as text; the bump is skipped
 */
export const reasonsOfASkippedBump = defineClosedSet(254, [
  "critic-model",
  "quota-exhausted",
  "ladder-top",
] as const);
