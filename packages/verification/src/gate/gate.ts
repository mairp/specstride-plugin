/**
 * T046 and T051 — the verification gate before the critic, the rejection
 * without a critic call, and the rule that every command runs with its gate
 * summary line (F105-FR-005, F105-FR-032).
 *
 * THE ORDER IS THE WHOLE FEATURE. In the mode `required` the verification gate
 * runs on every phase attempt AFTER PHASE EVIDENCE EXISTS and BEFORE THE
 * CRITIC IS CALLED. A proposer's claim and a critic's judgment can never stand
 * in for a command that failed, because the command ran first.
 *
 * The gate counts as FAILED whenever it ends with a result code other than 0:
 *
 *  - a command failed — the code 10;
 *  - the gate could not run, for example because the plan is refused when it
 *    is loaded — the code 3 (F105-FR-013).
 *
 * Either way THE PHASE ATTEMPT IS A REJECTION WITH THE RESULT CODE 10,
 * whichever of the two codes the gate gave; the critic is NOT called for that
 * phase attempt, and the rejection counts toward the reject limit. The field
 * `rc` of the event rendered as `verification_failed` holds THE CODE OF THE
 * GATE ITSELF and not the rejection's 10 (F105-FR-007) — the two numbers are
 * `outcome.rejection.resultCode` and `outcome.rc`, and they are deliberately
 * separate names.
 *
 * EVERY COMMAND RUNS, ALSO AFTER ONE HAS FAILED (F105-FR-032, `research.md`
 * D-3): the gate never stops at a failed command, because a failure signature
 * that stops at the first failure is incomplete and the proposer repairs one
 * command per attempt. The gate passes only when all passed, and prints
 * `Verification gate <id> passed <n> command(s)` or
 * `Verification gate <id> failed: <command ids>`.
 *
 * A CONDITION IS NOT A FAILURE. A condition the check runner returns beside an
 * exit result is kept in the result record and contributed to the fact block,
 * and does not by itself fail the gate or halt the run (F105-FR-032). The gate
 * decides on the EXIT RESULTS alone.
 *
 * Output of a command reaches a written field only through the one ingress
 * (F105-FR-054), which arrives as the injected port of `ingress.ts`.
 */
import { CONFIGURATION_ERROR_CODE } from "../mode/closed-sets.ts";
import {
  conditionFields,
  conditionsOf,
  type CommandResult,
  type GateCommand,
} from "./run-command.ts";
import {
  dropFields,
  throughTheIngress,
  wasDropped,
  writtenText,
  type CommandOutputIngress,
  type OutputField,
} from "./ingress.ts";
import type { BuildArtifactRecord } from "../prestage/artifacts.ts";
import type { ReuseLookup } from "../prestage/reuse.ts";

/* ------------------------------------------------------------------ *
 * The place of the gate in a phase attempt.
 * ------------------------------------------------------------------ */

/** The gate runs after phase evidence exists (F105-FR-005). */
export const RUNS_AFTER = "phase evidence exists" as const;

/** The gate runs before the critic is called (F105-FR-005). */
export const RUNS_BEFORE = "the critic is called" as const;

/** The steps of a phase attempt in the order the gate fixes. */
export const ORDER_IN_A_PHASE_ATTEMPT = ["phase-evidence", "verification-gate", "critic"] as const;
export type StepOfAPhaseAttempt = (typeof ORDER_IN_A_PHASE_ATTEMPT)[number];

/** The gate stands between the evidence and the critic, and nowhere else. */
export const GATE_IS_BETWEEN_EVIDENCE_AND_THE_CRITIC: boolean =
  ORDER_IN_A_PHASE_ATTEMPT.indexOf("phase-evidence") <
    ORDER_IN_A_PHASE_ATTEMPT.indexOf("verification-gate") &&
  ORDER_IN_A_PHASE_ATTEMPT.indexOf("verification-gate") <
    ORDER_IN_A_PHASE_ATTEMPT.indexOf("critic");

/* ------------------------------------------------------------------ *
 * The result codes.
 * ------------------------------------------------------------------ */

/** The gate passed. */
export const GATE_PASSED = 0 as const;

/** A command of the gate failed (F105-FR-005). */
export const GATE_COMMAND_FAILED = 10 as const;

/** The gate could not run; the code of a refused plan (F105-FR-005, F105-FR-013). */
export const GATE_COULD_NOT_RUN: typeof CONFIGURATION_ERROR_CODE = CONFIGURATION_ERROR_CODE;

/** Every result code of the gate. */
export const GATE_RESULT_CODES = [GATE_PASSED, GATE_COULD_NOT_RUN, GATE_COMMAND_FAILED] as const;
export type GateResultCode = (typeof GATE_RESULT_CODES)[number];

/** The result code the phase attempt's rejection carries, always 10. */
export const REJECTION_RESULT_CODE = 10 as const;

/** A gate has failed whenever its result code is not 0 (F105-FR-005). */
export function gateFailed(rc: number): boolean {
  return rc !== GATE_PASSED;
}

/**
 * The rejection a failed gate makes. `resultCode` is 10 WHICHEVER of the two
 * codes the gate gave; `gateResultCode` is the gate's own, which the event
 * carries in its field `rc`.
 */
export type Rejection = {
  readonly isARejection: true;
  readonly resultCode: typeof REJECTION_RESULT_CODE;
  readonly gateResultCode: number;
  readonly criticIsCalled: false;
  readonly countsTowardTheRejectLimit: true;
};

/** What the gate's result code makes of the phase attempt (F105-FR-005). */
export type PhaseAttemptOutcome =
  | Rejection
  | {
      readonly isARejection: false;
      readonly gateResultCode: typeof GATE_PASSED;
      /** The critic is called as the contract of the critic strategy says. */
      readonly criticIsCalled: true;
      readonly countsTowardTheRejectLimit: false;
    };

/**
 * What a result code of the gate makes of the phase attempt. The one function
 * both codes 3 and 10 pass through, so that a verification gate that ends with
 * the code 3 IS THE SAME REJECTION as one that ends with 10 (U3 of the
 * inconsistency register).
 */
export function phaseAttemptAfterTheGate(rc: number): PhaseAttemptOutcome {
  if (!gateFailed(rc)) {
    return Object.freeze({
      isARejection: false as const,
      gateResultCode: GATE_PASSED,
      criticIsCalled: true as const,
      countsTowardTheRejectLimit: false as const,
    });
  }
  return Object.freeze({
    isARejection: true as const,
    resultCode: REJECTION_RESULT_CODE,
    gateResultCode: rc,
    criticIsCalled: false as const,
    countsTowardTheRejectLimit: true as const,
  });
}

/* ------------------------------------------------------------------ *
 * The summary line.
 * ------------------------------------------------------------------ */

/** The summary line of a gate that passed (B-1074). */
export function passedSummary(gateId: string, commands: number): string {
  return `Verification gate ${gateId} passed ${commands} command(s)`;
}

/** The summary line of a gate that failed, with the ids of the failures (B-1074). */
export function failedSummary(gateId: string, failedIds: readonly string[]): string {
  return `Verification gate ${gateId} failed: ${failedIds.join(", ")}`;
}

/** The summary line of a run of the gate. */
export function gateSummary(
  gateId: string,
  results: readonly Pick<CommandResult, "commandId" | "passed">[],
): string {
  const failed = results.filter((result) => !result.passed).map((result) => result.commandId);
  return failed.length === 0
    ? passedSummary(gateId, results.length)
    : failedSummary(gateId, failed);
}

/* ------------------------------------------------------------------ *
 * The plan, as the gate reads it.
 * ------------------------------------------------------------------ */

/**
 * The part of the verification plan the gate reads. The planner writes the
 * whole record (F105-FR-011 to F105-FR-019); these are the fields the gate
 * selects commands with, named as `data-model.md` names them.
 */
export type GatePlan = {
  readonly id: string;
  readonly contentHash: string;
  readonly project: { readonly workdir: string };
  readonly commands: readonly PlannedCommand[];
  readonly suites: readonly PlannedSuite[];
  readonly gates: readonly PlannedGate[];
};

/** One command of the plan. */
export type PlannedCommand = {
  readonly id: string;
  readonly declaredId?: string | null | undefined;
  readonly source?: string | undefined;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd: string;
  readonly timeoutSec?: number | undefined;
  /**
   * The staging fields the REUSE RULES of F105-FR-033 read: only a command of
   * the stage `prestage` offers its result, and the reuse policy decides which
   * record may answer. They are optional because a plan the baseline wrote
   * omits each at its default (F105-FR-016).
   */
  readonly stage?: string | undefined;
  readonly reusePolicy?: string | undefined;
  readonly detached?: boolean | undefined;
  /** The kind, which the build artifacts record of F105-FR-036 reads. */
  readonly kind?: string | undefined;
};

/** One suite of the plan. */
export type PlannedSuite = {
  readonly id: string;
  readonly commandRefs: readonly string[];
};

/** One gate of the plan. */
export type PlannedGate = {
  readonly id: string;
  readonly scope: string;
  readonly phase?: number | "release" | undefined;
  readonly suiteRefs: readonly string[];
  readonly excludedCommandRefs?: readonly string[] | undefined;
  readonly required: boolean;
};

/** The gate of a phase, or `undefined` where the plan has none. */
export function gateOf(plan: GatePlan, phase: number | "release"): PlannedGate | undefined {
  const scope = phase === "release" ? "release" : "phase";
  return plan.gates.find(
    (gate) => gate.scope === scope && (scope === "release" || gate.phase === phase),
  );
}

/** The message of a phase with no gate (B-1131). */
export function noGateSummary(phase: number | "release"): string {
  return `No verification gate exists for ${phase}`;
}

/** The message of a required gate with no safe executable command (B-1132). */
export function noCommandsSummary(gateId: string): string {
  return `Required gate ${gateId} has no safe executable verification commands`;
}

/** The message of an advisory gate with no automated command. */
export function advisoryNoCommandsSummary(gateId: string): string {
  return `Advisory gate ${gateId} has no automated commands`;
}

/**
 * The commands a gate selects, in the order of its suites, each once. A
 * command the plan EXCLUDED from this gate is still in its phase's suite — the
 * suite is shared — so the exclusion is applied here, at selection.
 */
export function selectCommands(plan: GatePlan, gate: PlannedGate): readonly PlannedCommand[] {
  const suites = new Map(plan.suites.map((suite) => [suite.id, suite]));
  const commands = new Map(plan.commands.map((command) => [command.id, command]));
  const excluded = new Set(gate.excludedCommandRefs ?? []);
  const ids: string[] = [];
  for (const suiteId of gate.suiteRefs) {
    for (const commandId of suites.get(suiteId)?.commandRefs ?? []) {
      if (!ids.includes(commandId) && !excluded.has(commandId)) ids.push(commandId);
    }
  }
  return Object.freeze(
    ids
      .map((id) => commands.get(id))
      .filter((command): command is PlannedCommand => command !== undefined),
  );
}

/* ------------------------------------------------------------------ *
 * Running the gate.
 * ------------------------------------------------------------------ */

/** One command of the gate, as its result record holds it (F105-FR-009). */
export type RecordedCommand = {
  readonly commandId: string;
  readonly declaredId: string | null;
  readonly source: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
} & Readonly<Record<string, unknown>>;

/** The runner of one command: `runCommand` of T010, or a stand-in in a test. */
export type CommandRunner = (
  command: PlannedCommand,
  index: number,
) => CommandResult | Promise<CommandResult>;

/** What a run of the gate is given. */
export type GateRunInput = {
  readonly plan: GatePlan;
  readonly phase: number | "release";
  /** The runner of one command. The gate calls it once per selected command. */
  readonly run: CommandRunner;
  /** The one ingress every written piece of output comes through. */
  readonly ingress: CommandOutputIngress;
  /** The revision of the source the record records. */
  readonly sourceRevision?: string | undefined;
  /**
   * The build artifacts record (F105-FR-036), where the caller took it. It
   * NEVER changes the verdict: `FAILS_THE_VERIFICATION_GATE` of
   * `../prestage/artifacts.ts` is `false`.
   */
  readonly buildArtifacts?: readonly BuildArtifactRecord[] | undefined;
  /**
   * The build artifacts record of ONE PASSED BUILD COMMAND (F105-FR-036). The
   * gate calls it after each command and appends what it gives; T130 of phase
   * 6 supplies it with `buildArtifactsOf` of `../prestage/artifacts.ts`.
   */
  readonly artifactsOf?:
    | ((command: PlannedCommand, result: CommandResult) => readonly BuildArtifactRecord[])
    | undefined;
  /**
   * THE REUSE RULES (F105-FR-033), where the caller has them: the look-up T127
   * of phase 6 builds with `prestageReuse` of `../prestage/reuse.ts`. Absent,
   * the gate executes every command it selected, which is also what the
   * look-up answers in a phase attempt in which a loop layer is engaged.
   */
  readonly reuse?: ReuseLookup | undefined;
};

/** The outcome of a run of the gate. */
export type GateOutcome = {
  /** The gate's own result code: 0, 10 or 3. */
  readonly rc: GateResultCode;
  readonly passed: boolean;
  /** The summary line (F105-FR-032). */
  readonly summary: string;
  /** The commands, in the order they ran, with their fields of F105-FR-009. */
  readonly commands: readonly RecordedCommand[];
  /** Which commands failed, by id, in order. */
  readonly failedIds: readonly string[];
  /** The conditions the check runner returned, by command id. */
  readonly conditions: Readonly<Record<string, readonly string[]>>;
  /** What the gate makes of the phase attempt (F105-FR-005). */
  readonly attempt: PhaseAttemptOutcome;
  /** The gate of the plan, or `undefined` where the plan had none. */
  readonly gateId: string | undefined;
  /** True where a written field held no text because the ingress dropped it. */
  readonly outputWasDropped: boolean;
  /** The build artifacts record of this run of the gate (F105-FR-036). */
  readonly buildArtifacts: readonly BuildArtifactRecord[];
  /** The commands whose result was TAKEN OVER, by id, in order (F105-FR-033). */
  readonly reusedIds: readonly string[];
};

/** The error a gate that could not run throws, which becomes the code 3. */
export class GateCannotRunError extends Error {
  readonly rc: typeof GATE_COULD_NOT_RUN = GATE_COULD_NOT_RUN;
  constructor(reason: string) {
    super(reason);
    this.name = "GateCannotRunError";
  }
}

/**
 * Run the verification gate of a phase.
 *
 * EVERY SELECTED COMMAND RUNS. The loop has no early exit and no `break`: a
 * command that fails is recorded as failed and the next one starts. That is
 * F105-FR-032 and `research.md` D-3, and it is why a caller gets a complete
 * failure signature in one attempt.
 */
export async function runGate(input: GateRunInput): Promise<GateOutcome> {
  const gate = gateOf(input.plan, input.phase);
  if (gate === undefined) {
    return outcome({
      rc: GATE_COMMAND_FAILED,
      passed: false,
      summary: noGateSummary(input.phase),
      commands: [],
      conditions: {},
      gateId: undefined,
      outputWasDropped: false,
    });
  }
  const selected = selectCommands(input.plan, gate);
  if (selected.length === 0) {
    // A required gate with nothing to execute has failed; an advisory one has
    // not (F105-FR-018).
    const passed = !gate.required;
    return outcome({
      rc: passed ? GATE_PASSED : GATE_COMMAND_FAILED,
      passed,
      summary: gate.required ? noCommandsSummary(gate.id) : advisoryNoCommandsSummary(gate.id),
      commands: [],
      conditions: {},
      gateId: gate.id,
      outputWasDropped: false,
    });
  }

  const recorded: RecordedCommand[] = [];
  const conditions: Record<string, readonly string[]> = {};
  const buildArtifacts: BuildArtifactRecord[] = [...(input.buildArtifacts ?? [])];
  const reusedIds: string[] = [];
  let dropped = false;
  for (const [index, command] of selected.entries()) {
    // NO EARLY EXIT. A failed command does not stop the loop (F105-FR-032).
    //
    // THE REUSE RULES COME FIRST, and only they (F105-FR-033): a result they
    // take over is recorded with `reused: true` and `reusedFrom`, and the
    // command is NOT executed. Where they take nothing over — and in a phase
    // attempt in which a loop layer is engaged they take over nothing at all —
    // the command is EXECUTED.
    const taken = input.reuse?.(command);
    if (taken !== undefined && taken.reused) {
      reusedIds.push(command.id);
      recorded.push(taken.entry as unknown as RecordedCommand);
      conditions[command.id] = Object.freeze([]);
      continue;
    }
    const result = await input.run(command, index);
    const stdout = throughTheIngress(input.ingress, result.stdout);
    const stderr = throughTheIngress(input.ingress, result.stderr);
    if (wasDropped(stdout) || wasDropped(stderr)) dropped = true;
    conditions[result.commandId] = conditionsOf(result);
    recorded.push(recordOf(command, result, stdout, stderr));
    // The build artifacts record of F105-FR-036, which never changes the
    // verdict: it is appended beside the commands and read by nothing here.
    if (input.artifactsOf !== undefined) {
      buildArtifacts.push(...input.artifactsOf(command, result));
    }
  }

  const failedIds = recorded.filter((entry) => !entry.passed).map((entry) => entry.commandId);
  const passed = failedIds.length === 0;
  return outcome({
    rc: passed ? GATE_PASSED : GATE_COMMAND_FAILED,
    passed,
    summary: gateSummary(gate.id, recorded),
    commands: recorded,
    conditions,
    gateId: gate.id,
    outputWasDropped: dropped,
    buildArtifacts: Object.freeze(buildArtifacts),
    reusedIds: Object.freeze(reusedIds),
  });
}

/**
 * Run the gate and turn a gate that COULD NOT RUN into the result code 3 — the
 * same rejection as a failed command, with the gate's own code on the event
 * (F105-FR-005). A caller that loads a plan hands the load in `prepare`.
 */
export async function runGateOrCode3(
  prepare: () => GateRunInput | Promise<GateRunInput>,
): Promise<GateOutcome> {
  let prepared: GateRunInput;
  try {
    prepared = await prepare();
  } catch (error) {
    return outcome({
      rc: GATE_COULD_NOT_RUN,
      passed: false,
      summary: messageOf(error),
      commands: [],
      conditions: {},
      gateId: undefined,
      outputWasDropped: false,
    });
  }
  try {
    return await runGate(prepared);
  } catch (error) {
    // A gate that threw while it ran could not run; the code is 3 and the
    // rejection is the same one a failed command makes.
    return outcome({
      rc: GATE_COULD_NOT_RUN,
      passed: false,
      summary: messageOf(error),
      commands: [],
      conditions: {},
      gateId: prepared.plan.gates.find((gate) => gate.scope !== "")?.id,
      outputWasDropped: false,
    });
  }
}

function outcome(input: {
  rc: GateResultCode;
  passed: boolean;
  summary: string;
  commands: readonly RecordedCommand[];
  conditions: Readonly<Record<string, readonly string[]>>;
  gateId: string | undefined;
  outputWasDropped: boolean;
  buildArtifacts?: readonly BuildArtifactRecord[] | undefined;
  reusedIds?: readonly string[] | undefined;
}): GateOutcome {
  return Object.freeze({
    rc: input.rc,
    passed: input.passed,
    summary: input.summary,
    commands: Object.freeze([...input.commands]),
    failedIds: Object.freeze(input.commands.filter((e) => !e.passed).map((e) => e.commandId)),
    conditions: Object.freeze({ ...input.conditions }),
    attempt: phaseAttemptAfterTheGate(input.rc),
    gateId: input.gateId,
    outputWasDropped: input.outputWasDropped,
    buildArtifacts: Object.freeze([...(input.buildArtifacts ?? [])]),
    reusedIds: Object.freeze([...(input.reusedIds ?? [])]),
  });
}

/**
 * One entry of `commands` of the result record: the as-is fields of
 * F105-FR-009, the fields of a drop where one happened, and one field per
 * condition the check runner returned. AN ENTRY WITHOUT A CONDITION HOLDS NO
 * SUCH FIELD, so under the `parity` profile the record has the as-is fields
 * only.
 */
export function recordOf(
  command: PlannedCommand,
  result: CommandResult,
  stdout: OutputField,
  stderr: OutputField,
): RecordedCommand {
  return Object.freeze({
    commandId: result.commandId,
    declaredId: command.declaredId ?? null,
    source: command.source ?? result.source,
    executable: result.executable,
    args: Object.freeze([...result.args]),
    env: Object.freeze({ ...result.env }),
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    stdout: writtenText(stdout),
    stderr: writtenText(stderr),
    passed: result.passed,
    ...dropFields(stdout),
    ...dropFields(stderr),
    ...conditionFields(result),
  }) as RecordedCommand;
}

/**
 * A condition does not fail the gate (F105-FR-032). The gate's verdict comes
 * from `passed` of each result, which `passedFromExitResult` of T010 took from
 * the EXIT RESULT alone.
 */
export const A_CONDITION_FAILS_THE_GATE = false as const;

/** A condition halts the run: no (F105-FR-032). */
export const A_CONDITION_HALTS_THE_RUN = false as const;

/** The gate never stops at a failed command (F105-FR-032, `research.md` D-3). */
export const STOPS_AT_A_FAILED_COMMAND = false as const;

/** The gate decides on the exit results (F105-FR-032). */
export const DECIDES_ON = "the exit results" as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The gate command of T010 for one planned command, with its manifest entry. */
export function gateCommandOf(command: PlannedCommand, entry: GateCommand["entry"]): GateCommand {
  return Object.freeze({
    commandId: command.id,
    declaredId: command.declaredId ?? "",
    source: command.source ?? "",
    entry,
    executable: command.executable,
    args: Object.freeze([...command.args]),
    env: Object.freeze({ ...(command.env ?? {}) }),
    cwd: command.cwd,
  });
}
