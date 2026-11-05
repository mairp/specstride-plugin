/**
 * T029 — the behaviour smoke with a stub CLI (F113-FR-040).
 *
 * This is a PAID task of a person: `node evals/behaviour-smoke.ts` from the
 * package root. NO job of the build and no schedule starts it, it is not a
 * check of a change and not a release check, and a run of it that calls a model
 * is logged as F113-FR-038 says (`../src/evals/log.ts` writes that record; the
 * paid part itself is `unverified` in `../src/evals/paid-tasks.ts`).
 *
 * The hermetic part, which this module performs with the stub CLI: the smoke
 * asserts that the doctor runs before `launch`, and that the mode `dry-run`
 * never launches.
 */
import { resolve } from "node:path";
import { DRY_RUN_LAUNCHES, RUN_STEP_IDS, stepsOfMode } from "../src/skill-run.ts";

/** One invocation a run recorded on the stub CLI. */
export type RecordedInvocation = {
  /** The command of the CLI, for example `doctor` or `launch`. */
  readonly command: string;
  /** The mode given to the invocation, where the invocation takes one. */
  readonly mode?: string;
};

/** The verdict of the smoke, one failure per line. */
export type SmokeVerdict = {
  readonly passed: boolean;
  readonly failures: readonly string[];
};

/** True where the invocation is the doctor of this host. */
export function isTheDoctor(invocation: RecordedInvocation): boolean {
  return invocation.command === "doctor";
}

/** True where the invocation is a launch. */
export function isALaunch(invocation: RecordedInvocation): boolean {
  return invocation.command === "launch";
}

/**
 * The smoke. `taken` is what the host did, in order, recorded on the stub CLI.
 * Two assertions of F113-FR-040: the doctor runs before `launch`, and
 * `dry-run` never launches.
 */
export function behaviourSmoke(taken: readonly RecordedInvocation[]): SmokeVerdict {
  const failures: string[] = [];
  const launchIndex = taken.findIndex(isALaunch);
  if (launchIndex >= 0) {
    const doctorIndex = taken.slice(0, launchIndex).findIndex(isTheDoctor);
    if (doctorIndex < 0) {
      failures.push("a launch happened with no doctor before it (F113-FR-040)");
    }
  }
  const dryRunLaunch = taken.find(
    (invocation) => invocation.mode === "dry-run" && isALaunch(invocation),
  );
  if (dryRunLaunch !== undefined || DRY_RUN_LAUNCHES !== false) {
    failures.push("the mode `dry-run` launched (F113-FR-040)");
  }
  // The steps the skill itself reaches in `dry-run` hold no launch step.
  const dryRunSteps = stepsOfMode("dry-run").map((step) => step.id);
  if (dryRunSteps.includes("launch")) {
    failures.push("the steps of `dry-run` include the launch step (F113-FR-040)");
  }
  return { passed: failures.length === 0, failures };
}

/** The stub CLI the hermetic smoke records on: it starts nothing. */
export function stubCli(): {
  readonly record: (invocation: RecordedInvocation) => void;
  readonly taken: () => readonly RecordedInvocation[];
} {
  const taken: RecordedInvocation[] = [];
  return Object.freeze({
    record: (invocation: RecordedInvocation) => {
      taken.push(invocation);
    },
    taken: () => Object.freeze([...taken]),
  });
}

/** The hermetic sequence the smoke plays on the stub: doctor, then dry-run, then a run. */
export function hermeticSequence(): readonly RecordedInvocation[] {
  void RUN_STEP_IDS;
  return Object.freeze([
    { command: "doctor" },
    { command: "contract derive", mode: "dry-run" },
    { command: "contract validate", mode: "dry-run" },
    { command: "doctor" },
    { command: "contract derive" },
    { command: "launch" },
  ]);
}

function main(): void {
  const cli = stubCli();
  for (const invocation of hermeticSequence()) cli.record(invocation);
  const verdict = behaviourSmoke(cli.taken());
  console.log(`behaviour smoke (stub CLI): ${verdict.passed ? "PASS" : "FAIL"}`);
  for (const failure of verdict.failures) console.log(`  - ${failure}`);
  console.log(
    "the paid part of T029 (a live model behind the CLI) is `unverified`: " +
      "see src/evals/paid-tasks.ts (owner's ruling of 2026-09-30)",
  );
}

// A person runs this file directly; importing it starts nothing.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
