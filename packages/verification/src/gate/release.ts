/**
 * T112 — RELEASE VERIFICATION (F105-FR-008).
 *
 * A release is verified AS A WHOLE. After the last phase of a run is approved
 * the engine runs one more verification gate — `GATE-release`, which holds
 * EVERY verification obligation and EVERY command of the plan (F105-FR-018) —
 * and a failure there ends the run, no matter that every phase passed its own
 * gate.
 *
 * The five facts of F105-FR-008, each a named value of this module:
 *
 *  1. IT RUNS ONLY IN THE MODE `required`. `releaseVerificationRuns` reads the
 *     row of `mode/effects.ts`; it is not spelled a second time here.
 *  2. IT RUNS ON TWO PATHS: after the last phase is approved, AND on the path
 *     where every phase was approved before the run started (the baseline's
 *     "Already fully done?" branch). `RELEASE_TRIGGERS` holds both, and
 *     `runReleaseVerification` takes one of them, so neither path can be
 *     forgotten by a caller that only has the other in mind.
 *  3. THE ENGINE LOG HOLDS `----- verification: release gate (fixed argv) -----`
 *     BEFORE IT (B-0202). `RELEASE_GATE_LOG_LINE`, first line of
 *     `ReleaseOutcome.logLines` whatever the outcome.
 *  4. A RESULT CODE OTHER THAN 0 — a failed command (10) OR a gate that could
 *     not run (3) — writes `# HALT — release verification failed (exit <rc>).`
 *     and `#   evidence: <path>`, ends the run with EXIT 2, and gives the stop
 *     reason `release_verification` with the fields `rc` and `evidence`.
 *  5. THE RESULT IS WRITTEN UNDER `run:<runId>:verification:release`.
 *
 * THE GATE IS ALWAYS `GATE-release`. `runReleaseVerification` overrides the
 * phase of whatever its caller prepared with `RELEASE_PHASE`, so release
 * verification can never run a phase gate by accident; `gateOf` of `gate.ts`
 * then selects by the scope `release` (F105-FR-018).
 *
 * THE TWO CODES ARE ONE FAILURE. F105-FR-008 says "whether a command failed or
 * the verification gate could not run": both are `rc !== 0`, both halt, and
 * the field `rc` of the stop carries THE GATE'S OWN CODE — 10 or 3 — exactly
 * as the event `verification_failed` does at a phase attempt (U3 of the
 * inconsistency register). `runGateOrCode3` of `gate.ts` is therefore the one
 * entry point here too.
 *
 * WHAT THIS FEATURE DOES NOT WRITE. The terminal record of the run and the
 * event `run_stop` belong to feature 102; this module returns the stop as a
 * value (`ReleaseStop`) with the reason and the two fields, and writes no
 * field of the run record (F105-FR-010).
 *
 * THE RECORD OF A GATE THAT COULD NOT RUN IS NOT WRITTEN, because there is no
 * gate result to write — and the log line `#   evidence: <path>` still names
 * the place, as at the baseline. That is `EVIDENCE_IS_NAMED_EVEN_WHEN_ABSENT`.
 */
import { existsSync, readFileSync } from "node:fs";
import type { BuildArtifactRecord } from "../prestage/artifacts.ts";
import { atomicWrite } from "@specstride/kernel/atomic-write";
import { engineExitOf, isStopReason } from "@specstride/contracts/codes/stop-reasons";
import { resolve as resolveLogicalName } from "@specstride/contracts/ids/logical-names";
import { effectOf } from "../mode/effects.ts";
import type { VerificationMode } from "../mode/closed-sets.ts";
import { verificationReleasePassed, type RenderedEvent } from "./events.ts";
import {
  GATE_PASSED,
  gateFailed,
  runGateOrCode3,
  type GateOutcome,
  type GateRunInput,
} from "./gate.ts";
import {
  RELEASE_RECORD_NAME,
  gateResultRecord,
  writeOnce,
  type GateResultRecord,
  type ReadExisting,
  type WriteAtomically,
  type WriteOutcome,
} from "./records.ts";

/* ------------------------------------------------------------------ *
 * When it runs.
 * ------------------------------------------------------------------ */

/** The phase release verification runs: always the release (F105-FR-008). */
export const RELEASE_PHASE = "release" as const;

/** The id of the gate release verification runs (F105-FR-008, F105-FR-018). */
export const RELEASE_GATE = "GATE-release" as const;

/**
 * Release verification runs ONLY in the mode `required` (F105-FR-008). The
 * fact is the row of `mode/effects.ts`, read and not repeated.
 */
export function releaseVerificationRuns(mode: VerificationMode): boolean {
  return effectOf(mode).releaseVerificationRuns;
}

/** The two paths release verification runs on (F105-FR-008). */
export const RELEASE_TRIGGERS = [
  "after the last phase is approved",
  "every phase was approved before the run started",
] as const;
export type ReleaseTrigger = (typeof RELEASE_TRIGGERS)[number];

/** The trigger of the path the baseline reaches through `run_phase`. */
export const AFTER_THE_LAST_PHASE: ReleaseTrigger = "after the last phase is approved";

/** The trigger of the baseline's "Already fully done?" branch. */
export const EVERY_PHASE_ALREADY_APPROVED: ReleaseTrigger =
  "every phase was approved before the run started";

/** Both paths run release verification, and neither is an exception. */
export const BOTH_PATHS_RUN_IT: boolean = RELEASE_TRIGGERS.length === 2;

/* ------------------------------------------------------------------ *
 * The log lines.
 * ------------------------------------------------------------------ */

/** The line the engine log holds BEFORE release verification (B-0202). */
export const RELEASE_GATE_LOG_LINE = "----- verification: release gate (fixed argv) -----" as const;

/**
 * The log line is written before the gate runs (F105-FR-008). The name says
 * RELEASE because `events.ts` already carries the same fact for the gate of a
 * phase attempt, and a reader must not take one for the other.
 */
export const RELEASE_LOG_LINE_IS_WRITTEN = "before release verification" as const;

/** The first HALT line of a failed release verification (B-0203). */
export function releaseHaltLine(rc: number): string {
  return `# HALT — release verification failed (exit ${rc}).`;
}

/** The second HALT line, which names the result record (B-0203). */
export function releaseEvidenceLine(evidence: string): string {
  return `#   evidence: ${evidence}`;
}

/** The two HALT lines, in the order the engine log holds them (B-0203). */
export function releaseHaltLines(rc: number, evidence: string): readonly string[] {
  return Object.freeze([releaseHaltLine(rc), releaseEvidenceLine(evidence)]);
}

/**
 * The place of the record is named in the log EVEN WHERE THE GATE COULD NOT
 * RUN and no record was written: the line is the engine's, not the gate's.
 */
export const EVIDENCE_IS_NAMED_EVEN_WHEN_ABSENT = true as const;

/* ------------------------------------------------------------------ *
 * The stop.
 * ------------------------------------------------------------------ */

/** The stop reason of a failed release verification (F105-FR-008). */
export const RELEASE_STOP_REASON = "release_verification" as const;

/** The reason is a member of the closed set of stop reasons (annex E §E.3). */
export const STOP_REASON_IS_IN_THE_CLOSED_SET: boolean = isStopReason(RELEASE_STOP_REASON);

/**
 * The exit code of the run, 2, READ FROM THE TABLE of annex E §E.3 for the
 * reason `release_verification` — so a change of the table cannot leave this
 * feature behind.
 */
export const RELEASE_EXIT_CODE: number = engineExitOf(RELEASE_STOP_REASON) ?? 2;

/** The two fields the stop carries beside its reason (F105-FR-008). */
export const RELEASE_STOP_FIELDS = ["rc", "evidence"] as const;

/** The stop a failed release verification gives (F105-FR-008). */
export type ReleaseStop = {
  readonly reason: typeof RELEASE_STOP_REASON;
  /** The code of the verification gate itself: 10 or 3, never the run's 2. */
  readonly rc: number;
  /** The place of the result record. */
  readonly evidence: string;
};

/**
 * Who writes the terminal record and the event `run_stop`: feature 102. This
 * feature writes no field of the run record (F105-FR-010).
 */
export const STOP_IS_WRITTEN_BY = "the owner of the run record (feature 102)" as const;

/** This feature writes no field of the run record (F105-FR-010). */
export const WRITES_NO_FIELD_OF_THE_RUN_RECORD = true as const;

/* ------------------------------------------------------------------ *
 * The place of the record.
 * ------------------------------------------------------------------ */

/** The logical name of the result of release verification (B-0172, B-1142). */
export const RELEASE_RESULT_NAME: typeof RELEASE_RECORD_NAME = RELEASE_RECORD_NAME;

/**
 * The place of the result record, from the layout table of annex B §B.5 by its
 * logical name — never spelled here as a path. The caller gives the run, the
 * feature and the root.
 */
export function releaseRecordPath(input: {
  readonly runId: string;
  readonly slug: string;
  readonly control: string;
}): string {
  return resolveLogicalName(
    RELEASE_RESULT_NAME,
    { "<runId>": input.runId, "<slug>": input.slug },
    { "<control>": input.control },
  );
}

/**
 * The place of the record named from the RUN DIRECTORY instead of the roots:
 * that directory, then `verification/release.json` (B-1142). A caller that
 * holds the run directory and not the root table uses this; both forms end in
 * the same file, and `releaseRecordPath` above is the one that reads the
 * layout. (The as-is spelling of the directory itself belongs to
 * `packages/contracts/data/layout-old-side.json` and is not repeated here,
 * F100-FR-026.)
 */
export function releaseEvidenceIn(runDirectory: string): string {
  return `${runDirectory.replace(/\/+$/, "")}/verification/release.json`;
}

/**
 * THE DIRECTORY OF THE RECORD IS MADE AS PART OF THE WRITE, exactly as the
 * baseline's `_write_evidence` does (`os.makedirs(os.path.dirname(path),
 * exist_ok=True)`, `lib/verification_plan.py`:2201) — the run directory of a
 * fresh run holds no `verification/` yet. `releaseRecordWriter` is therefore
 * the writer a run hands `runReleaseVerification`, so that no call site has to
 * remember the fact, and the write itself stays the atomic write of
 * `@specstride/kernel`.
 */
export function releaseRecordWriter(): WriteAtomically {
  return (path: string, text: string): void => {
    atomicWrite(path, text, { createDirectory: true });
  };
}

/**
 * How a record already at the place is read, for the write-once comparison of
 * `records.ts`: its text, or `undefined` where there is none.
 */
export function releaseRecordReader(): ReadExisting {
  return (path: string): string | undefined =>
    existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/* ------------------------------------------------------------------ *
 * Running it.
 * ------------------------------------------------------------------ */

/** What a run of release verification is given. */
export type ReleaseInput = {
  /** The mode in force; anything but `required` runs nothing. */
  readonly mode: VerificationMode;
  /** Which of the two paths this is. */
  readonly trigger: ReleaseTrigger;
  /** The absolute place of the result record. */
  readonly evidence: string;
  /**
   * What the gate is given. A THROW HERE — a plan that is refused when it is
   * loaded, for instance — is the result code 3, which is the same halt as a
   * failed command (F105-FR-008).
   */
  readonly prepare: () => Omit<GateRunInput, "phase"> | Promise<Omit<GateRunInput, "phase">>;
  /** The revision of the source the record records. */
  readonly sourceRevision?: string | undefined;
  /** The declared build artifacts that now exist (F105-FR-036). */
  readonly buildArtifacts?: readonly BuildArtifactRecord[] | undefined;
  /** How a record already there is read; the record is written once. */
  readonly readExisting?: ReadExisting | undefined;
  /** How the record is written: the atomic write of `@specstride/kernel`. */
  readonly write?: WriteAtomically | undefined;
};

/** The outcome of release verification. */
export type ReleaseOutcome = {
  /** False where the mode is not `required`: nothing ran (F105-FR-008). */
  readonly ran: boolean;
  /** Which of the two paths this was. */
  readonly trigger: ReleaseTrigger;
  /** The code of the verification gate: 0, 10 or 3. */
  readonly rc: number;
  readonly passed: boolean;
  /** The summary line of the gate, where it ran. */
  readonly summary: string | undefined;
  /** The place of the result record, as the log names it. */
  readonly evidence: string;
  /** The gate's outcome, where the gate ran at all. */
  readonly gate: GateOutcome | undefined;
  /** The result record, where one was written. */
  readonly record: GateResultRecord | undefined;
  /** The outcome of the write-once write, where a record was written. */
  readonly written: WriteOutcome | undefined;
  /** The lines the engine log holds, in order. */
  readonly logLines: readonly string[];
  /** The events emitted: `verification_release_passed` on a pass, none else. */
  readonly events: readonly RenderedEvent[];
  /** The exit code of the RUN: 2 on a failure, `undefined` where it goes on. */
  readonly exitCode: number | undefined;
  /** The stop, on a failure (F105-FR-008). */
  readonly stop: ReleaseStop | undefined;
  /** True where the run ends here. */
  readonly runEnds: boolean;
};

/**
 * Run release verification.
 *
 * In a mode other than `required` NOTHING RUNS: no log line, no command, no
 * record, no event — the outcome is `ran: false` and the run goes on
 * (F105-FR-008, and the row of `mode/effects.ts`).
 */
export async function runReleaseVerification(input: ReleaseInput): Promise<ReleaseOutcome> {
  if (!releaseVerificationRuns(input.mode)) {
    return Object.freeze({
      ran: false,
      trigger: input.trigger,
      rc: GATE_PASSED,
      passed: true,
      summary: undefined,
      evidence: input.evidence,
      gate: undefined,
      record: undefined,
      written: undefined,
      logLines: Object.freeze([]),
      events: Object.freeze([]),
      exitCode: undefined,
      stop: undefined,
      runEnds: false,
    });
  }

  // The log line comes FIRST, before a single command of the gate starts
  // (F105-FR-008, B-0202).
  const logLines: string[] = [RELEASE_GATE_LOG_LINE];

  // The gate is always `GATE-release`: the phase of whatever the caller
  // prepared is overridden, so a phase gate can never be run here.
  let prepared: Omit<GateRunInput, "phase"> | undefined;
  const gate = await runGateOrCode3(async () => {
    prepared = await input.prepare();
    return { ...prepared, phase: RELEASE_PHASE };
  });

  const failed = gateFailed(gate.rc);
  // A gate that COULD NOT RUN has no result to write; a gate that ran writes
  // its record under `run:<runId>:verification:release` (F105-FR-008).
  const record =
    prepared === undefined || gate.gateId === undefined
      ? undefined
      : gateResultRecord({
          planId: prepared.plan.id,
          planHash: prepared.plan.contentHash,
          gateId: gate.gateId,
          // The gate's own `phase`, which `GATE-release` does not have:
          // `null` (RELEASE_RECORD_PHASE).
          phase:
            prepared.plan.gates.find((one) => one.scope === RELEASE_PHASE)?.phase ??
            RELEASE_RECORD_PHASE,
          sourceRevision: input.sourceRevision ?? prepared.sourceRevision ?? "",
          outcome: gate,
          buildArtifacts: input.buildArtifacts ?? prepared.buildArtifacts,
        });
  const written =
    record !== undefined && input.readExisting !== undefined && input.write !== undefined
      ? writeOnce({
          logicalName: RELEASE_RESULT_NAME,
          path: input.evidence,
          record,
          readExisting: input.readExisting,
          write: input.write,
        })
      : undefined;

  if (!failed) {
    return Object.freeze({
      ran: true,
      trigger: input.trigger,
      rc: gate.rc,
      passed: true,
      summary: gate.summary,
      evidence: input.evidence,
      gate,
      record,
      written,
      logLines: Object.freeze(logLines),
      events: Object.freeze([verificationReleasePassed({ evidence: input.evidence })]),
      exitCode: undefined,
      stop: undefined,
      runEnds: false,
    });
  }

  // The two HALT lines, then the stop, then the exit code 2 (F105-FR-008).
  logLines.push(...releaseHaltLines(gate.rc, input.evidence));
  return Object.freeze({
    ran: true,
    trigger: input.trigger,
    rc: gate.rc,
    passed: false,
    summary: gate.summary,
    evidence: input.evidence,
    gate,
    record,
    written,
    logLines: Object.freeze(logLines),
    // NO event `verification_release_passed` on a failure (F105-FR-007).
    events: Object.freeze([]),
    exitCode: RELEASE_EXIT_CODE,
    stop: Object.freeze({
      reason: RELEASE_STOP_REASON,
      rc: gate.rc,
      evidence: input.evidence,
    }),
    runEnds: true,
  });
}

/**
 * THE FIELD `phase` OF THE RECORD OF RELEASE VERIFICATION IS `null`.
 *
 * The field is the gate's OWN `phase` field (F105-FR-009), and `GATE-release`
 * has none: its scope is `release` and a phase number would be a second,
 * contradictory answer to the same question. The baseline reads
 * `gate.get("phase")` for every gate alike and therefore writes `None` here,
 * which is `null` in the record — so this is parity and not a choice.
 */
export const RELEASE_RECORD_PHASE = null;

/**
 * The gate of release verification holds EVERY verification obligation and
 * EVERY command of the plan (F105-FR-008, B-1106). `releaseSuiteAndGate` of
 * `plan/suites.ts` builds it that way; this is the predicate a caller — and a
 * parity test — checks a loaded plan with.
 */
export function releaseGateHoldsEverything(plan: {
  readonly obligations?: readonly { readonly id: string }[] | undefined;
  readonly commands: readonly { readonly id: string }[];
  readonly suites: readonly { readonly id: string; readonly commandRefs: readonly string[] }[];
  readonly gates: readonly {
    readonly id: string;
    readonly scope: string;
    readonly suiteRefs: readonly string[];
    readonly obligationRefs?: readonly string[] | undefined;
    readonly excludedCommandRefs?: readonly string[] | undefined;
  }[];
}): boolean {
  const gate = plan.gates.find((one) => one.scope === RELEASE_PHASE);
  if (gate === undefined) return false;
  const obligationIds = (plan.obligations ?? []).map((one) => one.id);
  const held = new Set(gate.obligationRefs ?? []);
  if (!obligationIds.every((id) => held.has(id))) return false;
  const suites = new Map(plan.suites.map((suite) => [suite.id, suite]));
  const excluded = new Set(gate.excludedCommandRefs ?? []);
  const reached = new Set<string>();
  for (const suiteId of gate.suiteRefs) {
    for (const commandId of suites.get(suiteId)?.commandRefs ?? []) {
      if (!excluded.has(commandId)) reached.add(commandId);
    }
  }
  return plan.commands.every((command) => reached.has(command.id));
}

/**
 * A command declared `cumulative: false` still runs at release verification
 * (F105-FR-018): `GATE-release` names `SUITE-release`, which holds every
 * command, and the release gate carries no exclusion.
 */
export const A_NON_CUMULATIVE_COMMAND_STILL_RUNS_AT_RELEASE = true as const;
