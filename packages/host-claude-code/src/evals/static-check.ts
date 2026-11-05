/**
 * T033 — the static check of the suite files and of the build configuration
 * (F113-FR-041). The per-change build MUST call no model and no paid or
 * external API; for the evals it checks what can be checked WITHOUT a model
 * call:
 *
 *   (a) the suite files: the case counts of F113-FR-038 (at least six positive
 *       and six negative cases per skill), the confusable pair run and reverse,
 *       the restriction of tools so that no run can launch, and that no file
 *       holds a model id (F113-FR-039: the model comes from the configuration
 *       of the run);
 *   (b) the build configuration: no job of the build starts the host's suite
 *       runner — the build fails when one would (F113-FR-041, last sentence).
 *
 * Part (c), the token budget of each host skill, is the static size check of
 * T025 (`tests/ci-checks/checks.ts`) and the budget check of `src/render/`;
 * this module does not restate it. Part (b) of F113-FR-041, the eval driver on
 * the stub of the host's suite runner, is `./eval-driver.ts` and
 * `./stub-runner.ts`.
 *
 * Nothing here calls a model, starts a process or opens a connection: every
 * function takes parsed values (or file contents as text) and returns findings.
 */
import type { FreeGraderFile, TriggerSuiteFile } from "./suite-file.ts";

/** The case counts of F113-FR-038: at least six positive and six negative. */
export const MIN_POSITIVE_CASES_PER_SKILL = 6 as const;
export const MIN_NEGATIVE_CASES_PER_SKILL = 6 as const;

/** The confusable pair of F113-FR-038, as the suite files name it. */
export const CONFUSABLE_PAIR = "run-reverse" as const;

/** The keys a model id would hide behind (F113-FR-039: there is none). */
export const MODEL_ID_KEYS: readonly string[] = Object.freeze([
  "model",
  "modelId",
  "modelIds",
  "judgeModel",
  "judgeModelId",
  "judgeModelIds",
]);

/** One finding of the static check. */
export type StaticFinding = {
  /** The check the finding is of. */
  readonly check: string;
  /** True when the check passed. */
  readonly ok: boolean;
  /** What was observed, as one line. */
  readonly detail: string;
};

const ok = (check: string, detail: string): StaticFinding => ({ check, ok: true, detail });
const bad = (check: string, detail: string): StaticFinding => ({ check, ok: false, detail });

/* -------------------------------------------------------------------------
 * (a) the suite files
 * ---------------------------------------------------------------------- */

/**
 * True where the parsed suite file (or any value inside it) hides a model id
 * behind one of the `MODEL_ID_KEYS` with a non-empty value (F113-FR-039).
 */
export function containsModelId(value: unknown, keyPath = ""): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsModelId(entry, keyPath));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
      containsModelId(child, keyPath.length === 0 ? key : `${keyPath}.${key}`),
    );
  }
  const lastKey = keyPath.split(".").pop() ?? "";
  if (!MODEL_ID_KEYS.includes(lastKey)) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return false; // handled above, one level up
  return value !== null && value !== undefined;
}

/** The static check of ONE suite file (F113-FR-041 (a)). */
export function checkOneSuite(suite: TriggerSuiteFile): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const cases = suite.cases ?? [];
  const positive = cases.filter((entry) => entry.kind === "positive");
  const negative = cases.filter((entry) => entry.kind !== "positive");
  findings.push(
    positive.length >= MIN_POSITIVE_CASES_PER_SKILL
      ? ok("case-counts-positive", `${positive.length} positive cases of ${suite.skill}`)
      : bad(
          "case-counts-positive",
          `${suite.skill} holds ${positive.length} positive cases; F113-FR-038 needs at least ` +
            `${MIN_POSITIVE_CASES_PER_SKILL}`,
        ),
  );
  findings.push(
    negative.length >= MIN_NEGATIVE_CASES_PER_SKILL
      ? ok("case-counts-negative", `${negative.length} negative cases of ${suite.skill}`)
      : bad(
          "case-counts-negative",
          `${suite.skill} holds ${negative.length} negative cases; F113-FR-038 needs at least ` +
            `${MIN_NEGATIVE_CASES_PER_SKILL}`,
        ),
  );
  const confusable = cases.some((entry) => entry.confusablePair === CONFUSABLE_PAIR);
  findings.push(
    confusable
      ? ok("confusable-pair", `the confusable pair ${CONFUSABLE_PAIR} is among the cases`)
      : bad("confusable-pair", `no case carries the confusable pair ${CONFUSABLE_PAIR}`),
  );
  findings.push(
    containsModelId(suite)
      ? bad("no-model-id", `${suite.skill}: the suite file holds a model id (F113-FR-039)`)
      : ok("no-model-id", `${suite.skill}: no model id in the suite file`),
  );
  return findings;
}

/** The static check of the graders file: free graders and restricted tools. */
export function checkGraders(graders: FreeGraderFile): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const graders_ = graders.graders ?? {};
  const allFree = Object.values(graders_).every(
    (grader) => (grader as { modelJudge?: unknown }).modelJudge === false,
  );
  findings.push(
    allFree && Object.keys(graders_).length > 0
      ? ok("free-graders", `${Object.keys(graders_).length} free graders, none with a model judge`)
      : bad("free-graders", "a grader uses a model judge, or the graders file holds none"),
  );
  const restriction = graders.toolRestriction;
  const restricted =
    restriction !== undefined &&
    Array.isArray(restriction.allowedTools) &&
    restriction.allowedTools.length === 0 &&
    restriction.launchImpossible === true;
  findings.push(
    restricted
      ? ok("tool-restriction", `allowedTools is empty and launch is impossible: no run can launch`)
      : bad(
          "tool-restriction",
          "the tools of a run are not restricted: a run could launch (F113-FR-038)",
        ),
  );
  findings.push(
    containsModelId(graders)
      ? bad("no-model-id", "the graders file holds a model id (F113-FR-039)")
      : ok("no-model-id", "no model id in the graders file"),
  );
  return findings;
}

/** The static check of the whole suite: every suite file and the graders. */
export function checkSuiteFiles(
  suites: readonly TriggerSuiteFile[],
  graders: FreeGraderFile,
): readonly StaticFinding[] {
  return Object.freeze([
    ...suites.flatMap((suite) => checkOneSuite(suite)),
    ...checkGraders(graders),
  ]);
}

/** True where every finding of a static check passed. */
export function staticCheckPasses(findings: readonly StaticFinding[]): boolean {
  return findings.every((finding) => finding.ok);
}

/* -------------------------------------------------------------------------
 * (b) the build configuration: no job starts the host's suite runner
 * ---------------------------------------------------------------------- */

/**
 * What marks a command of the build as one that would start the host's suite
 * runner: the host CLI with its eval command, or the person-run runner of this
 * feature (F113-FR-041: the build fails when one of its jobs would).
 */
export const SUITE_RUNNER_MARKERS: readonly RegExp[] = Object.freeze([
  /\bclaude\b[^|;&]*\bplugin\s+eval\b/,
  /\bplugin\s+eval\b/,
  /evals[\\/]trigger-suite\.ts/,
]);

/** One job of the build configuration, as a name and the command it runs. */
export type BuildJob = {
  /** Where the job is declared, e.g. `package.json script "test"`. */
  readonly declaredIn: string;
  /** The command the job runs. */
  readonly command: string;
};

/** The jobs of the build configuration that would start the host's suite runner. */
export function jobsThatStartTheSuiteRunner(jobs: readonly BuildJob[]): readonly BuildJob[] {
  return jobs.filter((job) => SUITE_RUNNER_MARKERS.some((marker) => marker.test(job.command)));
}

/** The error the build fails with (F113-FR-041, last sentence). */
export class SuiteRunnerInBuildError extends Error {
  override readonly name = "SuiteRunnerInBuildError";
  readonly offenders: readonly BuildJob[];
  constructor(offenders: readonly BuildJob[]) {
    super(
      `the build fails: ${offenders.length} job(s) would start the host's suite runner ` +
        `(F113-FR-041): ${offenders.map((job) => `${job.declaredIn} → ${job.command}`).join("; ")}`,
    );
    this.offenders = Object.freeze([...offenders]);
  }
}

/**
 * The build-configuration half of the static check: throws (the build fails)
 * when one job of the build would start the host's suite runner.
 */
export function assertNoJobStartsTheSuiteRunner(jobs: readonly BuildJob[]): void {
  const offenders = jobsThatStartTheSuiteRunner(jobs);
  if (offenders.length > 0) throw new SuiteRunnerInBuildError(offenders);
}

/** True where the whole static check of F113-FR-041 would call a model: never. */
export function staticCheckCallsAModel(): boolean {
  return false;
}
