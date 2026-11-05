/**
 * T096 and T148 — the DERIVATION of the check manifest of a phase
 * (F105-FR-020), with the intake of declared reads and writes from the launch
 * contract and from nowhere else (CQ-190).
 *
 * One manifest per phase, derived AT LAUNCH from the verification plan and
 * from nothing else, with the fields of feature 100, annex D §D.8, stored
 * under `phase:<N>:manifest` with its hash — and that hash is the CANONICAL
 * RECORD HASH of the hasher (annex X §X.5), not the content hash of the text
 * the plan's own hashes take (F105-FR-011). The two are different values over
 * the same record, so the two forms are named apart here and in
 * `../plan/hash.ts`.
 *
 * The rules this module is:
 *
 *  - the entries are the commands OF THE PHASE ITSELF, that is of the suite
 *    `SUITE-phase-<N>` of the plan, in the order of the plan; the commands of
 *    earlier phases are in the manifests of those phases;
 *  - where manifests are written, the CUMULATIVE verification gate takes its
 *    commands from the manifests of the phases whose suites it names, less the
 *    ones it excludes, so that it selects the same commands as from the plan;
 *  - every entry is derived with `inner` TRUE: the inner check set of a phase
 *    is its manifest, and only the runtime takes a command out of that set,
 *    with a reason, during a phase attempt;
 *  - `pin` is the identity record the operation `pin` of the check runner
 *    returned AT LAUNCH, and `searchPath` the search path as it was at launch;
 *  - a phase without commands has a manifest whose list of entries is
 *    EXPLICITLY EMPTY, and no command is ever generated for it;
 *  - declared reads and writes enter ONLY from the launch contract with the
 *    provenance user configuration, the environment or a flag; an entry
 *    without them is undeclared, which means serial;
 *  - nothing adds an entry after launch.
 */
import {
  AN_ENTRY_MAY_BE_ADDED_AFTER_LAUNCH,
  INNER_IS_TRUE_FOR_EVERY_ENTRY,
  KIND_THAT_REQUIRES_ARGV,
  LOGICAL_NAME,
  SCHEMA_ID,
  UNDECLARED_MEANS_SERIAL,
  type CheckManifest,
  type ManifestEntry,
} from "@specstride/contracts/records/check-manifest";
import type { Provenance } from "@specstride/contracts/ep/verification-source";
import { canonicalRecordHash } from "@specstride/kernel/hasher";
import { commandIdsOfGate, gateOfThePlan, suiteIdOf } from "../plan/suites.ts";
import { VerificationError, type PlanCommand, type VerificationPlan } from "../plan/record.ts";
import { declaredScopeOf, type LaunchContractScopes } from "../sources/scopes.ts";

/** The schema id of a manifest and its logical name (annex D §D.8). */
export { SCHEMA_ID, LOGICAL_NAME };

/** The logical name of the manifest of one phase (annex D §D.8). */
export function manifestNameOf(phase: number): string {
  return LOGICAL_NAME.replace("<N>", String(phase));
}

/** Every entry is derived with `inner` true (F105-FR-020). */
export const INNER = INNER_IS_TRUE_FOR_EVERY_ENTRY;
/** Nothing adds an entry after launch (F105-FR-020). */
export const AN_ENTRY_IS_ADDED_AFTER_LAUNCH = AN_ENTRY_MAY_BE_ADDED_AFTER_LAUNCH;
/** An entry without `reads` and `writes` is undeclared, which means serial. */
export const UNDECLARED_IS_SERIAL = UNDECLARED_MEANS_SERIAL;
/** The hash of a manifest is the CANONICAL RECORD HASH (F105-FR-020). */
export const MANIFEST_HASH_FORM = "canonical-record-hash" as const;
/** The kind of a manifest entry of a command (annex D §D.8). */
export const ENTRY_KIND = KIND_THAT_REQUIRES_ARGV;

/**
 * The `pin` of the check runner at launch (feature 100, annex C §C.8): an
 * injected port, because this package calls the runner and does not implement
 * it. `pinAtLaunch` of `../gate/run-command.ts` is the one call site.
 */
export type PinPort = (command: PlanCommand) => Record<string, unknown>;

/** What the derivation of a manifest is given (F105-FR-020). */
export type DeriveManifestInput = {
  readonly plan: VerificationPlan;
  readonly phase: number;
  /** The identity record of every command, from the check runner at launch. */
  readonly pin: PinPort;
  /** The search path for executables AS IT WAS AT LAUNCH (F105-FR-020). */
  readonly searchPath: string;
  /** `configuration.scopes` of the launch contract, or `undefined`. */
  readonly scopes?: LaunchContractScopes | undefined;
  /**
   * The provenance of every command, by command id, which the derivation of
   * the plan returns beside it (`DerivedPlan.provenance`). The plan record
   * carries no provenance — it would move its content hash — and the manifest
   * entry requires one (annex D §D.8), so it comes from here.
   */
  readonly provenance?: ReadonlyMap<string, Provenance> | undefined;
};

/** The commands of the suite of the phase ITSELF, in the order of the plan. */
export function commandsOfThePhaseItself(input: {
  readonly plan: VerificationPlan;
  readonly phase: number;
}): readonly PlanCommand[] {
  const suite = input.plan.suites.find((one) => one.id === suiteIdOf(input.phase));
  if (suite === undefined) return Object.freeze([]);
  const byId = new Map(input.plan.commands.map((command) => [command.id, command]));
  const commands: PlanCommand[] = [];
  for (const id of suite.commandRefs) {
    const command = byId.get(id);
    if (command !== undefined) commands.push(command);
  }
  return Object.freeze(commands);
}

/** The argument list of a manifest entry: the executable and its arguments. */
export function argvOf(command: PlanCommand): readonly string[] {
  return Object.freeze([command.executable, ...command.args]);
}

/** The provenance of a command, or the empty one where none is known. */
export const PROVENANCE_OF_NO_DECLARATION: Provenance = Object.freeze({ file: "", line: 0 });

/** One entry of the manifest (annex D §D.8, F105-FR-020). */
export function entryOf(input: {
  readonly command: PlanCommand;
  readonly pin: PinPort;
  readonly scopes?: LaunchContractScopes | undefined;
  readonly provenance?: ReadonlyMap<string, Provenance> | undefined;
}): ManifestEntry {
  const command = input.command;
  const scope = declaredScopeOf({ scopes: input.scopes, commandId: command.id });
  return Object.freeze({
    id: command.id,
    kind: ENTRY_KIND,
    argv: [...argvOf(command)],
    pin: input.pin(command),
    provenance:
      input.provenance?.get(command.id) ?? command.provenance ?? PROVENANCE_OF_NO_DECLARATION,
    timeLimit: command.timeoutSec,
    // Steps and exclusive resources are read AT LAUNCH from the plan sources
    // and are part of the manifest (F105-FR-020).
    ...(command.steps !== undefined ? { steps: command.steps.map((one) => ({ ...one })) } : {}),
    ...(scope.resource !== undefined
      ? { resource: scope.resource }
      : command.resource !== undefined
        ? { resource: command.resource }
        : {}),
    // Declared reads and writes ONLY from the launch contract, and only with
    // the provenance that counts; otherwise ABSENT, which means serial.
    ...(scope.reads !== undefined ? { reads: [...scope.reads] } : {}),
    ...(scope.writes !== undefined ? { writes: [...scope.writes] } : {}),
    inner: INNER,
  }) as ManifestEntry;
}

/**
 * Derive the check manifest of one phase (F105-FR-020). The hash is computed
 * over the record WITHOUT its `hash` field and is the canonical record hash.
 */
export function deriveManifest(input: DeriveManifestInput): CheckManifest {
  if (!Number.isInteger(input.phase) || input.phase < 1) {
    throw new VerificationError(`a manifest is derived for a phase above zero: ${input.phase}`);
  }
  const entries = commandsOfThePhaseItself({ plan: input.plan, phase: input.phase }).map(
    (command) =>
      entryOf({
        command,
        pin: input.pin,
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
      }),
  );
  const withoutHash = {
    schema: SCHEMA_ID,
    phase: input.phase,
    searchPath: input.searchPath,
    // A phase without commands has a manifest whose entries are EXPLICITLY
    // empty; no command is ever generated for it (F105-FR-020). The list is
    // FROZEN, because nothing adds an entry after launch (F105-FR-020): a
    // writer that tried fails here rather than widening the inner check set
    // of the phase.
    entries: Object.freeze(entries),
  };
  return Object.freeze({
    ...withoutHash,
    hash: manifestHashOf(withoutHash),
  }) as CheckManifest;
}

/** The hash of a manifest: the canonical record hash (F105-FR-020). */
export function manifestHashOf(manifestWithoutItsHash: Readonly<Record<string, unknown>>): string {
  const record: Record<string, unknown> = { ...manifestWithoutItsHash };
  delete record["hash"];
  return canonicalRecordHash(record);
}

/** True where the recorded hash of a manifest is the computed one. */
export function manifestHashIsRight(manifest: CheckManifest): boolean {
  return manifest.hash === manifestHashOf(manifest as unknown as Record<string, unknown>);
}

/** The manifest of every phase of the plan, in the order of its phases. */
export function deriveEveryManifest(input: {
  readonly plan: VerificationPlan;
  readonly pin: PinPort;
  readonly searchPath: string;
  readonly scopes?: LaunchContractScopes | undefined;
  readonly provenance?: ReadonlyMap<string, Provenance> | undefined;
}): readonly CheckManifest[] {
  const phases = input.plan.suites
    .filter((suite) => suite.scope === "phase" && suite.phase !== undefined)
    .map((suite) => suite.phase!)
    .sort((a, b) => a - b);
  return Object.freeze(
    phases.map((phase) =>
      deriveManifest({
        plan: input.plan,
        phase,
        pin: input.pin,
        searchPath: input.searchPath,
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
      }),
    ),
  );
}

/**
 * The commands a CUMULATIVE verification gate selects FROM THE MANIFESTS
 * (F105-FR-020): the entries of the manifests of the phases whose suites the
 * gate names, in the order the gate names them, less the commands it excludes.
 *
 * It must select the same commands as from the plan: `commandIdsOfGate` of
 * `../plan/suites.ts` is the other reading, and `theTwoReadingsAgree` below
 * compares them.
 */
export function commandIdsFromManifests(input: {
  readonly plan: VerificationPlan;
  readonly phase: number | "release";
  readonly manifests: readonly CheckManifest[];
}): readonly string[] {
  const gate = gateOfThePlan(input.plan.gates, input.phase);
  if (gate === undefined) return Object.freeze([]);
  const excluded = new Set(gate.excludedCommandRefs ?? []);
  const byPhase = new Map(input.manifests.map((manifest) => [manifest.phase, manifest]));
  const ids: string[] = [];
  for (const suiteId of gate.suiteRefs) {
    const suite = input.plan.suites.find((one) => one.id === suiteId);
    if (suite === undefined) continue;
    if (suite.scope === "release") {
      // Release verification names the release suite, which no per-phase
      // manifest holds; its commands come from the plan, as the baseline
      // takes them (F105-FR-008).
      for (const id of suite.commandRefs) {
        if (!ids.includes(id) && !excluded.has(id)) ids.push(id);
      }
      continue;
    }
    const manifest = suite.phase === undefined ? undefined : byPhase.get(suite.phase);
    if (manifest === undefined) continue;
    for (const entry of manifest.entries) {
      if (!ids.includes(entry.id) && !excluded.has(entry.id)) ids.push(entry.id);
    }
  }
  return Object.freeze(ids);
}

/**
 * True where the two readings of a verification gate select the SAME commands
 * (F105-FR-020): from the manifests of the phases it covers, and from the
 * plan.
 */
export function theTwoReadingsAgree(input: {
  readonly plan: VerificationPlan;
  readonly phase: number | "release";
  readonly manifests: readonly CheckManifest[];
}): boolean {
  const gate = gateOfThePlan(input.plan.gates, input.phase);
  if (gate === undefined) return true;
  const fromThePlan = commandIdsOfGate({ gate, suites: input.plan.suites });
  const fromTheManifests = commandIdsFromManifests(input);
  return (
    fromThePlan.length === fromTheManifests.length &&
    fromThePlan.every((id, index) => id === fromTheManifests[index])
  );
}

/**
 * When a manifest is WRITTEN (F105-FR-020, CQ-153): when the loop strategy is
 * not `classic`, or when one of the switches of rows 6, 7, 31 or 33 of the
 * `parity` profile is on; otherwise the verification gate takes its commands
 * from the verification plan, as at the baseline.
 *
 * The rule is `manifestIsWritten` of `../mode/switches.ts` (T009), the one
 * reader of rows 6, 7 and 31, which this feature holds READ ONLY. It is NOT
 * restated here, and this constant only names where it lives, so a reader of
 * the derivation finds it.
 */
export const THE_RULE_ON_WHEN_A_MANIFEST_IS_WRITTEN =
  "manifestIsWritten of ../mode/switches.ts (F105-FR-020, rows 6, 7, 31 and 33 of annex X §X.7)";

/* ------------------------------------------------------------------ *
 * A phase without declared commands: 0 entries, and a result `unchecked`.
 * ------------------------------------------------------------------ */

/**
 * The condition a CHECK of a phase whose manifest is empty gives, and its
 * reason: acceptance scenario 1 of user story 2 of `spec.md` — *"its list of
 * entries is empty, no command is generated, and a check of that phase gives
 * the condition `unchecked`"* — and the second half of F105-SC-001.
 *
 * Both literals are members of row 53 of annex X §X.6, which feature 148 owns
 * (`resultConditionsOfACheckReasonsOfTaintedReasonsOfUnchecked`); this feature
 * only SETS the reason `no-command`, as `uncheckedReasonOwner` of the check
 * runner records ("the loop layer or the owner of the verification gate").
 * They are named here and not registered, because a feature does not register
 * a closed set of another feature (F100-FR-212), and `CT-105-301` compares
 * both against the row.
 */
export const CONDITION_OF_A_PHASE_WITHOUT_COMMANDS = "unchecked" as const;

/** The reason that condition carries; row 53, set by this feature. */
export const REASON_OF_A_PHASE_WITHOUT_COMMANDS = "no-command" as const;

/** The row of annex X §X.6 both literals are members of. */
export const CONDITION_ROW = 53 as const;

/** The result of a check of a phase whose manifest holds no entry. */
export type UncheckedResultOfAPhase = {
  readonly unchecked: true;
  readonly reason: typeof REASON_OF_A_PHASE_WITHOUT_COMMANDS;
  /** Nothing ran, so nothing is stated as a pass (F105-SC-001). */
  readonly statedAsPass: false;
};

/**
 * The result a check of a phase gives where the phase has NO declared command
 * (F105-SC-001): `unchecked`, with the reason `no-command`, and never a pass.
 * A phase WITH entries gets `undefined` — its result comes from running them,
 * which is the check runner's and never this function's.
 */
export function uncheckedResultOfAnEmptyManifest(
  manifest: Pick<CheckManifest, "entries">,
): UncheckedResultOfAPhase | undefined {
  if (manifest.entries.length > 0) return undefined;
  return Object.freeze({
    unchecked: true as const,
    reason: REASON_OF_A_PHASE_WITHOUT_COMMANDS,
    statedAsPass: false as const,
  });
}
