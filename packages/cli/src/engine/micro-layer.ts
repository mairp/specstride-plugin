/**
 * The stateful edge of the loop layer `micro` (feature 115): the per-attempt
 * machine the composition root drives, and the `LoopLayer` object the
 * registry registers. The pure functions of `@specstride/layer-micro` keep
 * deciding everything — this module only holds the state, runs the inner
 * checks through the check runner (F115-FR-013), verifies the manifest and
 * the pins before every check (F115-FR-014), reads the checkpoint claim
 * through the real reader of `@specstride/integrity` after the pass has
 * exited (F115-FR-010), and persists the machine's per-attempt state in the
 * control plane under `features/<slug>/micro/phase<N>.json` (F115-FR-002: no
 * state outside the ledger namespace `micro`).
 */
import { existsSync, readFileSync } from "node:fs";

import { atomicWrite, canonicalRecordHash } from "@specstride/kernel";
import { pinExecutable, verifyPin, type Pin } from "@specstride/integrity";
import { renderFactBlock } from "../../../integrity/src/factblock/build.ts";
import type { FactBlockInput as FactBlockState } from "@specstride/integrity";
import {
  createCheckpointClaimReader,
  checkpointPath,
  removeStaleCheckpoint,
} from "../../../integrity/src/checkpoint/read.ts";
import {
  execute,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "../../../check-runner/src/command/lisa-executor.ts";
import type { LoopLayer } from "@specstride/contracts/ep/loop-layer";
import { checkpointContractBlock } from "../../../layer-micro/src/callpoints/contribute-prompt.ts";
import { afterPass as afterPassPoint } from "../../../layer-micro/src/callpoints/after-pass.ts";
import {
  betweenPasses,
  type InnerCommand,
  type ManifestVerification,
} from "../../../layer-micro/src/callpoints/between-passes.ts";
import {
  nextPassBlock,
  type CheckOutput,
} from "../../../layer-micro/src/callpoints/next-pass-block.ts";
import type { CheckResult } from "../../../layer-micro/src/unit/outcome.ts";
import { assessPass } from "../../../layer-micro/src/caps/exemptions.ts";
import { cycleCapFor, type Caps } from "../../../layer-micro/src/caps/caps.ts";
import { routeIfEngaged, shippedTableVersion } from "../../../layer-micro/src/router/route.ts";
import {
  checkpointAccepted,
  checkpointRefused,
  checkpointRemoved,
  checkEnded,
  checkStarted,
  integrityNoted,
  microloopUnit,
  routeDecided,
  type LayerOffCause,
} from "../../../layer-micro/src/report/events.ts";
import { renderLoopLine, type LoopReport } from "../../../layer-micro/src/callpoints/report.ts";
import {
  contributeCriticInput,
  type DeclaredUnit,
  type FactBlockRow,
  type FactBlockBuilder,
} from "../../../layer-micro/src/callpoints/contribute-critic-input.ts";
import { DECLARED_DIRECTIVES, DECLARED_SERVICES } from "../../../layer-micro/src/register.ts";

/** One command of the inner check set, as the manifest of the phase holds it. */
export type InnerCheckCommand = {
  readonly id: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly timeoutSec: number;
};

/** The check manifest of a phase, as the launch wrote it to the control plane. */
export type CheckManifest = {
  readonly schema: "specstride.check-manifest/1";
  readonly phase: number;
  readonly commands: readonly InnerCheckCommand[];
  /** The canonical record hash of the `commands`, as written at launch. */
  readonly recordHash: string;
  /** The executable pins of the commands, as taken at launch. */
  readonly pins: readonly Pin[];
};

/** The caps the machine consults (the subset of `Caps` it reads). */
export type MachineCaps = Pick<Caps, "repairs" | "cyclesExtra" | "cyclesMin" | "unresolvedUnits">;

/** What one ended pass told the machine. */
export type MachineAfterPass = {
  /** The result of the checkpoint claim, as the layer's point read it. */
  readonly result: "accept" | "refuse" | "none";
  /** True when the pass ended at a checkpoint that validated. */
  readonly validCheckpoint: boolean;
  /** F115-FR-027 — the pass is given back: it raises no pass count. */
  readonly givenBack: boolean;
  /** F115-FR-027 — a valid checkpoint leaves the short-pass counter alone. */
  readonly exemptShortPass: boolean;
  /** The outcome of the unit, when a check ran (`unchecked` included). */
  readonly outcome: "kept" | "repair" | "unresolved" | "unchecked" | "none";
  /** The failure block of the next pass prompt, when the outcome is a repair. */
  readonly repairBlockText: string;
};

/** The per-attempt state, persisted in the control plane (F115-FR-002). */
type AttemptState = {
  readonly schema: "specstride.micro-attempt/1";
  /** The run this state belongs to; a new run starts a fresh attempt. */
  readonly runId: string;
  readonly attempt: number;
  readonly treeAtStart: string;
  cyclesSpent: number;
  repairsByTask: Record<string, number>;
  unresolvedUnits: number;
  uncheckedStreak: number;
  unitCount: number;
  readonly units: readonly UnitRecord[];
  lastCheckpointFingerprint: string | null;
  lastPassedTreeFingerprint: string | null;
  off: boolean;
  offCause: LayerOffCause | undefined;
};

/** One unit of work of the attempt, as the critic's fact block reads it. */
type UnitRecord = {
  readonly unitId: string;
  readonly tasks: readonly string[];
  readonly outcome: string;
  readonly results: readonly {
    readonly id: string;
    readonly exit: number;
    readonly conditions: readonly string[];
    readonly treeAfter: string;
  }[];
};

/** The cause of the record `disengaged` for each rule of the `loop` point. */
const CAUSE_OF_RULE: Readonly<Record<string, LayerOffCause>> = Object.freeze({
  "loop.caps": "caps",
  "loop.no-check": "no-check",
  "loop.single-unit": "single-unit",
  "loop.integrity": "integrity",
  "loop.check-error": "check-error",
});

const ANNOUNCEMENT = (cause: string): string =>
  `[LOOP] layer micro off for the phase-attempt: ${cause}`;

/**
 * The fallback reason of row 59 an off cause carries, when it carries one
 * (F115-FR-005): `single-unit` and `no-check` are phase-attempt fallback
 * reasons; the other off causes are causes of the record `disengaged` only.
 */
const attemptFallbackOf = (
  cause: LayerOffCause | undefined,
): "none" | "single-unit" | "no-check" =>
  cause === "single-unit" || cause === "no-check" ? cause : "none";

/** The per-attempt machine of the layer `micro`, as the composition root drives it. */
export type MicroAttempt = {
  /** The checkpoint contract block, byte-stable inside the run (F115-FR-008). */
  contractBlockText(): string;
  /** The one per-pass line: this pass's unit id and the exact checkpoint path. */
  passInstruction(unitId: string): string;
  /** The next unit id of the attempt (`u1`, `u2`, …, per phase attempt). */
  nextUnitId(): string;
  /** Remove a checkpoint left over from an earlier pass (F115-FR-010). */
  beforePass(unitId: string): void;
  /** Read the claim after the pass exited, run the inner check, decide. */
  afterPass(input: {
    readonly unitId: string;
    readonly passStartedAtMs: number;
    readonly passKilled: boolean;
    readonly yieldInPass: boolean;
  }): Promise<MachineAfterPass>;
  /** The closing check on the final tree (F115-FR-028). */
  closingCheck(): Promise<{ readonly ran: boolean; readonly passed: boolean }>;
  /** The units of the attempt, for the critic's fact block. */
  units(): readonly UnitRecord[];
  /** The state of the attempt as the fact block builder reads it (§D.7). */
  factBlockInput(input: {
    readonly manifestHash: string;
    readonly manifestCommands: readonly string[];
    readonly taskOrder: readonly string[];
  }): FactBlockState;
  /** The rendered fact block of the attempt, as the critic prompt carries it. */
  factBlockText(input: {
    readonly manifestHash: string;
    readonly manifestCommands: readonly string[];
    readonly taskOrder: readonly string[];
  }): string;
  /** The counts of the attempt, as the `[LOOP]` line reports them. */
  counts(): {
    readonly units: number;
    readonly kept: number;
    readonly unresolved: number;
    readonly unchecked: number;
    readonly tainted: number;
    readonly cycles: number;
    readonly disengaged: number;
    readonly off: boolean;
    /**
     * The fallback reason of row 59 the attempt produced, when it did
     * (F115-FR-005): `single-unit` or `no-check`. A cap spent is a cause of
     * the record `disengaged`, not a fallback reason.
     */
    readonly fallback: "none" | "single-unit" | "no-check";
  };
  /** True when the layer has gone off for this phase attempt. */
  isOff(): boolean;
  /** The loop-layer object the registry registers. */
  loopLayer(): LoopLayer;
};

/**
 * Create the machine of one phase attempt. The check manifest is read from
 * the control plane (written at launch); a manifest or a state file that
 * cannot be read switches the layer off for the attempt with an integrity
 * event, and the run continues (F115-FR-014, F115-FR-032). A state file whose
 * attempt ordinal is the current one continues the counts (F115-FR-031); a
 * new ordinal starts fresh.
 */
export function createMicroAttempt(input: {
  readonly runId: string;
  readonly phase: number;
  readonly attempt: number;
  readonly outboxPath: string;
  readonly controlPlanePath: string;
  readonly statePath: string;
  readonly manifestPath: string;
  readonly phaseTaskIds: readonly string[];
  readonly caps: MachineCaps;
  readonly closingCheckOn: boolean;
  readonly emit: (type: string, fields: Readonly<Record<string, unknown>>) => void;
  readonly say: (line: string) => void;
  readonly fingerprint: () => string;
}): MicroAttempt {
  const emitEvent = (event: { readonly type: string; readonly fields: unknown }): void => {
    input.emit(event.type, event.fields as Record<string, unknown>);
  };
  const treeAtStart = input.fingerprint();

  // The check manifest of the phase, as the launch wrote it.
  let manifest: CheckManifest | undefined;
  let manifestUnreadable = false;
  try {
    const read = JSON.parse(readFileSync(input.manifestPath, "utf8")) as CheckManifest;
    if (Array.isArray(read.commands)) manifest = read;
    else manifestUnreadable = true;
  } catch {
    manifestUnreadable = true;
  }

  const fresh = (): AttemptState => ({
    schema: "specstride.micro-attempt/1",
    runId: input.runId,
    attempt: input.attempt,
    treeAtStart,
    cyclesSpent: 0,
    repairsByTask: {},
    unresolvedUnits: 0,
    uncheckedStreak: 0,
    unitCount: 0,
    units: [],
    lastCheckpointFingerprint: null,
    lastPassedTreeFingerprint: null,
    off: false,
    offCause: undefined,
  });
  let state: AttemptState = fresh();
  const offForIntegrity = (kind: string, detail: string): void => {
    state = { ...state, off: true, offCause: "integrity" };
    emitEvent(integrityNoted({ kind, detail }));
    input.say(ANNOUNCEMENT("integrity"));
  };
  try {
    if (existsSync(input.statePath)) {
      const read = JSON.parse(readFileSync(input.statePath, "utf8")) as AttemptState;
      // F115-FR-031 — resume reconstructs the counters of a phase attempt of
      // THIS run; a state file of an earlier run at the same path belongs to
      // an attempt that ended, and a fresh run starts the attempt fresh.
      if (read.attempt === input.attempt && read.runId === input.runId) state = { ...read };
    }
  } catch {
    // F115-FR-032 — a state file that fails to parse: the layer is off for
    // the attempt, with an integrity event; the run continues.
    state = fresh();
    offForIntegrity("ledger-invalid", input.statePath);
  }
  if (manifestUnreadable && !state.off) {
    offForIntegrity("manifest-mismatch", input.manifestPath);
  }

  const persist = (): void => {
    atomicWrite(input.statePath, Buffer.from(JSON.stringify(state, null, 2)), {
      createDirectory: true,
    });
  };
  persist();

  /** F115-FR-014 — the manifest hash and every pin, before every check. */
  const verifyManifest = (): ManifestVerification => {
    if (manifest === undefined) return { ok: false, kind: "manifest-mismatch" };
    if (canonicalRecordHash(manifest.commands) !== manifest.recordHash) {
      return { ok: false, kind: "manifest-mismatch" };
    }
    for (const pin of manifest.pins) {
      if (!verifyPin(pin, process.env.PATH ?? "").ok) {
        return { ok: false, kind: "pin-mismatch" };
      }
    }
    return { ok: true };
  };

  /** F115-FR-013 — one command of the inner set, through the check runner. */
  const runCheckCommand = async (
    command: InnerCommand,
    unitId: string,
  ): Promise<CheckResult & { readonly output: string; readonly treeAfter: string }> => {
    const full = manifest?.commands.find((held) => held.id === command.id);
    emitEvent(checkStarted({ checkId: command.id, unitId, runner: "runtime" }));
    const before = input.fingerprint();
    const evidence = execute(
      {
        id: command.id,
        kind: "test",
        label: command.id,
        executable: full?.argv[0] ?? "false",
        args: (full?.argv ?? command.argv).slice(1),
        cwd: full?.cwd ?? process.cwd(),
        timeoutSec: full?.timeoutSec ?? 5 * 60,
      },
      DEFAULT_MAX_OUTPUT_BYTES,
    );
    const after = input.fingerprint();
    // The taint: a command during whose run the tree changed. Never a pass,
    // never a reason the layer goes off.
    const conditions = before !== after ? ["changed-during-check"] : [];
    emitEvent(
      checkEnded({
        checkId: command.id,
        result: evidence.exitCode === 0 ? "pass" : "fail",
        unitId,
        durationMs: evidence.durationMs,
        runner: "runtime",
      }),
    );
    return {
      id: command.id,
      exit: evidence.exitCode ?? 1,
      ...(conditions.length > 0 ? { conditions } : {}),
      output: `${evidence.stdout}\n${evidence.stderr}`.trim(),
      treeAfter: after,
    };
  };

  const innerSet = (): readonly InnerCommand[] =>
    (manifest?.commands ?? []).map((command) => ({ id: command.id, argv: [...command.argv] }));

  const machine: MicroAttempt = {
    contractBlockText: () => checkpointContractBlock().text,
    passInstruction: (unitId: string): string =>
      `[LOOP] micro: this pass works the unit of work ${unitId}. Before the pass ends, write your` +
      ` checkpoint as JSON to ${checkpointPath(input.outboxPath, unitId)} with the schema` +
      ` "specstride.checkpoint/1" and the task ids of the unit in a "tasks" array.`,
    nextUnitId: (): string => {
      state = { ...state, unitCount: state.unitCount + 1 };
      return `u${String(state.unitCount)}`;
    },
    beforePass(unitId: string): void {
      const removed = removeStaleCheckpoint(input.outboxPath, unitId);
      if (removed !== undefined) emitEvent(checkpointRemoved({ bytes: 0 }));
    },
    async afterPass(pass): Promise<MachineAfterPass> {
      if (state.off) {
        return {
          result: "none",
          validCheckpoint: false,
          givenBack: false,
          exemptShortPass: false,
          outcome: "none",
          repairBlockText: "",
        };
      }
      const tree = input.fingerprint();
      // F115-FR-011 — the claim is read only after the pass has exited, with
      // the real reader, and the reading itself is the layer's pure point.
      const claim = await afterPassPoint({
        claimReader: createCheckpointClaimReader({
          outboxPath: input.outboxPath,
          controlPlanePath: input.controlPlanePath,
          passStartedAtMs: pass.passStartedAtMs,
        }),
        unitId: pass.unitId,
        passKilled: pass.passKilled,
        yieldInPass: pass.yieldInPass,
        phaseTaskIds: input.phaseTaskIds,
      });
      const classic = {
        result: claim.result,
        validCheckpoint: false,
        givenBack: false,
        exemptShortPass: false,
        outcome: "none",
        repairBlockText: "",
      } as const;
      if (claim.result === "none") return classic;
      if (claim.result === "refuse") {
        emitEvent(checkpointRefused({ reason: claim.refusalReason ?? "empty", bytes: 0 }));
        return classic;
      }
      const taskIds = [...(claim.tasks ?? [])];
      emitEvent(
        checkpointAccepted({
          unitId: pass.unitId,
          taskIds,
          checkpointRef: `unit:${pass.unitId}:checkpoint`,
        }),
      );

      // The inner check of the unit, driven by the layer's pure point
      // (T045): the manifest and the pins first, then every command of the
      // set, in manifest order, never stopping at a failed command.
      const check = await betweenPasses({
        services: {
          verifyManifest,
          endPassProcesses: async () => ({ guaranteed: true }),
          runCheckCommand: (command: InnerCommand) => runCheckCommand(command, pass.unitId),
          innerSet: innerSet(),
          stopRequested: () => false,
          budgetAvailable: () => true,
          enterQuotaPause: async () => {},
        },
        taskIds,
        // F115-FR-022 — the budget hands the repairs LEFT per task id: the
        // cap less the repairs already spent. A task spent to the cap is
        // present with 0 (it can no longer take a repair); a task never
        // repaired is absent and takes its default.
        budget: {
          repairsLeft: Object.fromEntries(
            Object.entries(state.repairsByTask).map(([id, spent]) => [
              id,
              Math.max(0, input.caps.repairs - spent),
            ]),
          ),
          defaultRepairsLeft: input.caps.repairs,
        },
      });
      const decision = check.decision ?? {
        outcome: "unchecked" as const,
        directive: "none" as const,
      };
      const results = check.results as (CheckResult & {
        output: string;
        treeAfter: string;
      })[];

      // The counters of the namespace `micro` (F115-FR-022).
      state = { ...state, cyclesSpent: state.cyclesSpent + 1 };
      if (decision.outcome === "repair") {
        const repairs = { ...state.repairsByTask };
        for (const taskId of taskIds) repairs[taskId] = (repairs[taskId] ?? 0) + 1;
        state = { ...state, repairsByTask: repairs };
      }
      if (decision.outcome === "unresolved") {
        state = { ...state, unresolvedUnits: state.unresolvedUnits + 1 };
      }
      state = {
        ...state,
        uncheckedStreak: decision.outcome === "unchecked" ? state.uncheckedStreak + 1 : 0,
        units: [
          ...state.units,
          {
            unitId: pass.unitId,
            tasks: taskIds,
            outcome: decision.outcome,
            results: results.map((result) => ({
              id: result.id,
              exit: result.exit,
              conditions: result.conditions ?? [],
              treeAfter: result.treeAfter,
            })),
          },
        ],
      };

      // The router at the `loop` point, consulted now that the layer is
      // engaged (F115-FR-036); every decision is recorded (F115-FR-033).
      const taskCount = input.phaseTaskIds.length;
      const route = routeIfEngaged("loop", {
        engaged: true,
        cyclesLeft: Math.max(cycleCapFor(taskCount, input.caps as Caps) - state.cyclesSpent, 0),
        unresolvedUnits: state.unresolvedUnits,
        unresolvedOverCap: state.unresolvedUnits >= input.caps.unresolvedUnits,
        innerCount: innerSet().length,
        uncheckedStreak: state.uncheckedStreak,
        phaseTasks: taskCount,
        unitTasks: taskIds.length,
        unitCoversPhaseAtFirstUnit: state.units.length === 1 && taskIds.length === taskCount,
        ...(check.integrityEvent !== undefined ? { integrityKind: check.integrityEvent.kind } : {}),
      });
      if (route.decided && route.ruleId !== undefined && route.choice !== undefined) {
        emitEvent(
          routeDecided({
            tableId: "specstride.router-rules",
            tableVersion: shippedTableVersion(),
            point: "loop",
            ruleId: route.ruleId,
            choice: route.choice,
          }),
        );
        if (route.choice === "off:micro") {
          const cause = CAUSE_OF_RULE[route.ruleId] ?? "caps";
          state = { ...state, off: true, offCause: cause };
          input.say(ANNOUNCEMENT(cause));
        }
      }
      emitEvent(
        microloopUnit({
          unitId: pass.unitId,
          check: innerSet()[0]?.id ?? "none",
          result: decision.outcome,
          ...(state.off && state.offCause !== undefined ? { layerOff: state.offCause } : {}),
        }),
      );

      // F115-FR-027 — the assessment of the ended pass: a valid checkpoint on
      // a changed tree is given back and spends one cycle.
      const assessment = assessPass({
        validCheckpoint: true,
        treeFingerprint: tree,
        previousCheckpointFingerprint: state.lastCheckpointFingerprint ?? state.treeAtStart,
      });
      if (decision.outcome === "kept" && results.every((result) => result.exit === 0)) {
        state = { ...state, lastPassedTreeFingerprint: tree };
      }
      state = { ...state, lastCheckpointFingerprint: tree };
      const givenBack = assessment.givenBack && !state.off;
      persist();

      const repairBlockText =
        decision.outcome === "repair" && state.off === false
          ? repairBlockFor(input.runId, results, tree, state.repairsByTask, taskIds)
          : "";
      return {
        result: "accept",
        validCheckpoint: true,
        givenBack,
        exemptShortPass: true,
        outcome: decision.outcome,
        repairBlockText,
      };
    },
    async closingCheck(): Promise<{ readonly ran: boolean; readonly passed: boolean }> {
      if (!input.closingCheckOn || state.off || state.units.length === 0) {
        return { ran: false, passed: true };
      }
      const tree = input.fingerprint();
      if (state.lastPassedTreeFingerprint === tree) return { ran: false, passed: true };
      const verification = verifyManifest();
      if (!verification.ok) {
        offForIntegrity(verification.kind, input.manifestPath);
        persist();
        return { ran: false, passed: true };
      }
      const results: CheckResult[] = [];
      for (const command of innerSet()) {
        results.push(await runCheckCommand(command, "closing"));
      }
      const passed = results.every((result) => result.exit === 0);
      state = {
        ...state,
        cyclesSpent: state.cyclesSpent + 1,
        ...(passed ? { lastPassedTreeFingerprint: tree } : {}),
      };
      persist();
      return { ran: true, passed };
    },
    units: () => state.units,
    factBlockInput(facts): FactBlockState {
      return {
        manifestHash: facts.manifestHash,
        manifestCommands: [...facts.manifestCommands],
        treeFingerprint: input.fingerprint(),
        taskOrder: [...facts.taskOrder],
        units: state.units.map((unit, at) => ({
          unitId: unit.unitId,
          tasks: [...unit.tasks],
          results: unit.results.map((result, seq) => ({
            ordinal: at + 1,
            seq,
            treeAfter: result.treeAfter,
            commands: [
              {
                id: result.id,
                exit: result.exit,
                tainted: result.conditions.includes("changed-during-check"),
              },
            ],
          })),
        })),
        protectedFacts: {
          changedSincePhaseEntry: [],
          authorised: [],
          changedSinceLaunchInApprovedPhases: [],
          suppressionMarkers: [],
        },
        integrityEvents: [],
        furtherFacts: [],
        excludedCommands: [],
        ledgerInvalidFrom: null,
      };
    },
    factBlockText(facts): string {
      return renderFactBlock(this.factBlockInput(facts));
    },
    counts: () => ({
      units: state.units.length,
      kept: state.units.filter((unit) => unit.outcome === "kept").length,
      unresolved: state.unresolvedUnits,
      unchecked: state.units.filter((unit) => unit.outcome === "unchecked").length,
      tainted: state.units.filter((unit) =>
        unit.results.some((result) => result.conditions.includes("changed-during-check")),
      ).length,
      cycles: state.cyclesSpent,
      disengaged: state.off ? 1 : 0,
      off: state.off,
      fallback: attemptFallbackOf(state.offCause),
    }),
    isOff: () => state.off,
    loopLayer(): LoopLayer {
      return {
        registration: {
          id: "micro",
          directives: [...DECLARED_DIRECTIVES],
          services: [...DECLARED_SERVICES],
          ledgerNamespace: "micro",
        },
        contributePrompt: () => [checkpointContractBlock()],
        afterPass: () => "none",
        betweenPasses: () => "none",
        nextPassBlock: () => "none",
        onEvidence: () => ({ closingCheck: input.closingCheckOn }),
        contributeCriticInput: () => [],
        resume: () => "none",
        report: () => machine.counts() as unknown as Record<string, unknown>,
      };
    },
  };
  return machine;
}

/** The failure block of a repair, from the outputs on the current tree only. */
function repairBlockFor(
  runId: string,
  results: readonly (CheckResult & { readonly output: string; readonly treeAfter: string })[],
  tree: string,
  repairsByTask: Readonly<Record<string, number>>,
  taskIds: readonly string[],
): string {
  const outputs: CheckOutput[] = results.map((result) => ({
    id: result.id,
    exit: result.exit,
    output: result.output,
    treeFingerprint: result.treeAfter,
  }));
  const repairIndex = Math.max(1, ...taskIds.map((taskId) => (repairsByTask[taskId] ?? 0) + 1));
  const block = nextPassBlock({
    runId,
    lastOutcome: "repair",
    outputs,
    treeFingerprint: tree,
    repairIndex,
  });
  return block.directive === "contribute" && block.block !== undefined ? block.block.text : "";
}

/**
 * The `[LOOP]` line of one attempt, as the engine prints it before the digest
 * (F115-FR-038). `fallback` is `none` or the last fallback reason of the run.
 */
export function loopLineOf(
  counts: Omit<ReturnType<MicroAttempt["counts"]>, "off" | "fallback">,
  fallback: "none" | LoopReport["fallback"],
): string | undefined {
  return renderLoopLine(
    {
      containment: "C0",
      protection: "prevent",
      units: counts.units,
      pass: counts.kept,
      fail: counts.unresolved,
      unchecked: counts.unchecked,
      tainted: counts.tainted,
      cycles: counts.cycles,
      disengaged: counts.disengaged,
      escalations: 0,
      failfastStops: 0,
      fallback,
    },
    { strategy: "micro", level: "L1" },
  );
}

/** Write a check manifest of a phase to the control plane, at launch. */
export function writeCheckManifest(input: {
  readonly manifestPath: string;
  readonly phase: number;
  readonly commands: readonly InnerCheckCommand[];
  readonly searchPath: string;
  readonly write: (path: string, text: string) => void;
}): { readonly manifest: CheckManifest; readonly hash: string } {
  const pins: Pin[] = [];
  for (const command of input.commands) {
    const executable = command.argv[0] ?? "";
    if (executable !== "") pins.push(pinExecutable(executable, input.searchPath));
  }
  const manifest: CheckManifest = {
    schema: "specstride.check-manifest/1",
    phase: input.phase,
    commands: input.commands,
    recordHash: canonicalRecordHash(input.commands),
    pins,
  };
  input.write(input.manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, hash: manifest.recordHash };
}

/**
 * The fact-block-builder service the engine offers the layer (annex D §D.1
 * Inputs): the rows of the units as the layer's `contributeCriticInput` point
 * hands them to the writer. The engine, not the layer, writes the record.
 */
export const factBlockBuilder: FactBlockBuilder = Object.freeze({
  build: (input) =>
    contributeCriticInput({
      builder: {
        build: (held: {
          units: readonly DeclaredUnit[];
          checkResults: Readonly<Record<string, readonly CheckResult[]>>;
        }): readonly FactBlockRow[] =>
          held.units.map((unit: DeclaredUnit): FactBlockRow => ({
            unitId: unit.unitId,
            declaredTasks: unit.tasks,
            outcome: unit.outcome,
            commands: (held.checkResults[unit.unitId] ?? []).map((result: CheckResult) => ({
              id: result.id,
              exit: result.exit,
              conditions: result.conditions ?? [],
            })),
          })),
      },
      units: input.units,
      checkResults: input.checkResults,
      taskListAtLaunch: input.taskListAtLaunch,
      ...(input.facts === undefined ? {} : { facts: input.facts }),
    }).rows,
} as FactBlockBuilder);
