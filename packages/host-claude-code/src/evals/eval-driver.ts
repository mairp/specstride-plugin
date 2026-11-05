/**
 * T033 — the eval driver of EP-01 (`evalDriver.run`, contract
 * `specs/113-host-claude-code/contracts/host-package.md`), as the build runs
 * it: ON A STUB of the host's suite runner, with recorded results (F113-FR-041
 * (b)). On the host's own runner the driver calls a model and is started by a
 * person, as a paid task (F113-FR-038, assumption CQ-188) — never here.
 *
 * The driver gives ONE RESULT PER CASE, and reports a recorded interrupted run
 * and a recorded run ended by a usage limit as NOT SCORED (F113-FR-039: exit
 * 130 and 143 are interruptions; neither is a score failure).
 */
import type { TriggerCase } from "./suite-file.ts";
import { howARunEnded } from "./log.ts";

/** What the suite runner recorded for one case, whatever runner it is. */
export type RecordedCaseResult = {
  /** The skill the host invoked for the case, or null where none fired. */
  readonly invokedSkill: string | null;
  /** The tool calls the run recorded (the free graders read them). */
  readonly toolCalls?: readonly string[];
  /** The exit code of the run, where it ended with one. */
  readonly exitCode?: number | null;
  /** The marker the host put on the run, e.g. the usage limit. */
  readonly marker?: string;
};

/** A suite runner: the host's own one calls a model; the stub replays a record. */
export type SuiteRunner = {
  /** What names the runner in the report. */
  readonly kind: "stub" | "host";
  /** The result the runner gives for one case of the suite. */
  runCase(entry: TriggerCase): RecordedCaseResult;
};

/** One line of the driver's report: one result per case. */
export type CaseReport = {
  readonly caseId: string;
  readonly kind: TriggerCase["kind"];
  readonly expected: string | null;
  readonly invokedSkill: string | null;
  readonly scored: boolean;
  readonly notScoredReason?: "interrupted" | "usage-limit";
  readonly interruptedExitCode?: number;
  /** True where every free grader of the case passes on the recorded result. */
  readonly gradersPass: boolean;
};

/**
 * The driver: one result per case, in the order of the suite. A run that was
 * interrupted (exit 130 or 143) or ended by a usage limit is reported as NOT
 * SCORED, never as a failure (F113-FR-039). Where the case expects no skill,
 * the free grader `no-skill-invoked` passes when none fired; where it expects
 * one, `invoked-skill` passes on an exact match; every case must also record
 * no launch among its tool calls (`no-launch`).
 */
export function evalDriverRun(
  suite: { readonly skill: string; readonly cases: readonly TriggerCase[] },
  runner: SuiteRunner,
): readonly CaseReport[] {
  return Object.freeze(
    suite.cases.map((entry): CaseReport => {
      const recorded = runner.runCase(entry);
      const ended = howARunEnded(recorded.exitCode ?? null, recorded.marker);
      const exactMatch = recorded.invokedSkill === entry.expected;
      const noneInvoked = recorded.invokedSkill === null;
      const noLaunch = (recorded.toolCalls ?? []).every(
        (call) => !/launch|shell|bash|exec/i.test(call),
      );
      const gradersPass =
        ended !== "scored"
          ? false // an unscored run is graded by nothing
          : noLaunch && (entry.expected === null ? noneInvoked : exactMatch);
      return Object.freeze({
        caseId: entry.id,
        kind: entry.kind,
        expected: entry.expected,
        invokedSkill: recorded.invokedSkill,
        scored: ended === "scored",
        ...(ended === "interrupted" || ended === "usage-limit"
          ? {
              notScoredReason: ended,
              ...(recorded.exitCode != null ? { interruptedExitCode: recorded.exitCode } : {}),
            }
          : {}),
        gradersPass,
      });
    }),
  );
}

/** True where the driver, as the build runs it, calls a model: never. */
export function evalDriverCallsAModel(): boolean {
  return false;
}
