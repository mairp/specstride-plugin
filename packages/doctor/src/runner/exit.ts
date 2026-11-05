/**
 * T017 (feature 112) — the exit code table (F112-FR-027, CT-112-2).
 *
 * 0 — no finding is `fail` (a warning exits 0: research D-2, DV-041).
 * 1 — the doctor could not run (a bad working directory, a check that threw).
 * 2 — at least one finding is `fail`; with `--strict`, a warning as well.
 * 3 — a usage error (an unknown flag, role, harness or check id).
 *
 * Lisa's exit 2 on any finding, and Lisa's documented exit 3 that the code
 * never returned, are NOT carried (DV-041): a warning exits 0 without
 * `--strict`, and 3 is the real usage error.
 */

/** No finding is `fail` (and, without `--strict`, no warning escalates). */
export const EXIT_OK = 0 as const;
/** The doctor could not run: a bad working directory, or a check that threw. */
export const EXIT_COULD_NOT_RUN = 1 as const;
/** At least one finding is `fail` — or, with `--strict`, at least one `warn`. */
export const EXIT_FINDINGS = 2 as const;
/** A usage error: an unknown flag, role, harness, or check id in a filter. */
export const EXIT_USAGE = 3 as const;

/** Whether `--strict` was given: a warning then exits 2 (F112-FR-027). */
export type ExitInput = { readonly strict?: boolean };

/**
 * The exit code for a list of findings in the order they were collected
 * (F112-FR-027). Severity is read by the closed set; an unknown severity is
 * `warn` upstream of here (F112-FR-008), so a warn-shaped value escalates
 * under `--strict` too.
 */
export function exitCodeFor(
  findings: readonly { readonly severity: string }[],
  input?: ExitInput,
): number {
  let fail = false;
  let warn = false;
  for (const finding of findings) {
    if (finding.severity === "fail") fail = true;
    else if (finding.severity === "warn" || finding.severity === "unknown") warn = true;
  }
  if (fail) return EXIT_FINDINGS;
  if (warn && input?.strict === true) return EXIT_FINDINGS;
  return EXIT_OK;
}

/**
 * The exit code of a whole doctor run (F112-FR-027): a run that could not
 * execute (the runner recorded a thrown probe, or the workdir was unreadable)
 * exits 1 and the findings never override that; otherwise the findings table
 * decides. A probe that only timed out is a warning in `findings`, never exit
 * 1, and never above a warning on its own (CT-112-2).
 */
export function exitCodeForRun(
  run: { readonly exit: number; readonly findings: readonly { readonly severity: string }[] },
  input?: ExitInput,
): number {
  if (run.exit !== EXIT_OK && run.exit !== EXIT_FINDINGS && run.exit !== EXIT_USAGE) {
    return EXIT_COULD_NOT_RUN;
  }
  return exitCodeFor(run.findings, input);
}
