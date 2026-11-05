/**
 * T022 — the state guard and the missing-input exits of the front door
 * (F119-FR-009, F119-FR-010, F119-FR-012).
 *
 * The guard runs BEFORE the command that owns the verb sees the call for the
 * verbs of F119-FR-009, and for `resume` it is THE FIRST CHECK of its whole
 * row: on a workspace without state `resume` exits 1 before the refusals of
 * annex G §G.4 are tried (5 for a held lock, 3 when there is nothing to
 * resume — B-1482 before B-1494; CQ-184).
 *
 * The messages are the baseline's, with the port's control plane in the place
 * where the baseline names `.specstride/` (normalization rule N-02 maps the
 * two to the same logical name). The FX-28 captures pin the texts:
 *
 * - `no .specstride/ state dir in <WORK>`                       (status-no-state)
 * - `no feature '<slug>' in <WORK> (.specstride/features/<slug> missing).`
 *   `known features:` and `  - <name>` per feature              (flag-without-value)
 * - `no run.log yet for feature '<slug>' in <WORK>/.specstride` (tail-no-log)
 * - `no events.jsonl yet in <WORK>/.specstride`                 (events-no-events)
 * - `no verdicts recorded yet (<WORK>/.specstride/features/<slug>/verdicts)`
 *   and `no verdicts for phase <N>`                             (verdicts-*)
 * - `no feedback for phase <N> (.specstride/features/<slug>/gates/GATE<N>-FEEDBACK.md)`
 *   and the usage line for `feedback` without `N`               (feedback-*)
 * - `no SPECS.md in <WORK>`                                     (phases-no-spec)
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

/** The name of the control plane at the default location (annex B §B.5). */
export const CONTROL_PLANE_NAME = ".specstride" as const;

/**
 * The exit every refusal of the guard ends with (F119-FR-009: exit 1 when the
 * workspace has no state, and when the chosen feature has none).
 */
export const GUARD_EXIT = 1 as const;

/** The usage line of `feedback` without its phase number (F119-FR-010). */
export const FEEDBACK_USAGE_MESSAGE = "usage: specstride feedback <N> [-w DIR]" as const;

/** The first line of an invalid spec, on standard output (F119-FR-010). */
export const SPEC_INVALID_PREFIX = "SPEC INVALID:" as const;

/** The exit of `phases` on a spec that does not validate (annex G §G.4). */
export const SPEC_INVALID_EXIT = 3 as const;

/** What the guard knows about one workspace. */
export type ControlPlane = {
  /** The working directory, as the caller gave it (already physical). */
  readonly workdir: string;
  /** The control plane directory of the workspace. */
  readonly stateDir: string;
  /** How the messages name the control plane (N-02: inside the workdir the
   * relative spelling is kept, outside it the path itself). */
  readonly label: string;
};

/**
 * The control plane of one call: `SPECSTRIDE_STATE_DIR` when the host set it,
 * `.specstride/` under the working directory otherwise (F119-FR-009, N-02).
 */
export function controlPlaneOf(workdir: string, stateDir?: string | undefined): ControlPlane {
  const resolved = stateDir ?? join(workdir, CONTROL_PLANE_NAME);
  const label = stateDir !== undefined ? stateDir : `${CONTROL_PLANE_NAME}`;
  return Object.freeze({ workdir, stateDir: resolved, label });
}

/** True when the control plane exists and is a directory (a probe, not a lock). */
export function stateExists(cp: ControlPlane): boolean {
  try {
    return statSync(cp.stateDir).isDirectory();
  } catch {
    return false;
  }
}

/** The message of a workspace without state (F119-FR-009). */
export function noStateMessage(cp: ControlPlane): string {
  return `no ${cp.label}/ state dir in ${displayPath(cp.workdir)}`;
}

/** The features of the workspace that have state, in name order. */
export function knownFeatures(cp: ControlPlane): readonly string[] {
  const features = join(cp.stateDir, "features");
  let entries: string[];
  try {
    entries = readdirSync(features);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      try {
        return statSync(join(features, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** The message of a chosen feature without state (F119-FR-009). */
export function noFeatureMessage(cp: ControlPlane, slug: string, known: readonly string[]): string {
  const head = `no feature '${slug}' in ${displayPath(cp.workdir)} (${cp.label}/features/${slug} missing).`;
  if (known.length === 0) return head;
  return [head, "known features:", ...known.map((name) => `  - ${name}`)].join("\n");
}

/** One refusal of the guard: what to print on standard error and the code. */
export type GuardRefusal = {
  readonly exit: number;
  readonly stderr: string;
  /** Standard output, where the refusal holds a product line (spec invalid). */
  readonly stdout?: string;
  /** The closed reason of the refusal, for the default-output error line. */
  readonly reason?: import("../output/closed-sets.ts").FailureReason | undefined;
  /**
   * The refusal text of compatibility output, where it differs from the
   * default one only in the spelling of a path: the baseline prints the
   * ABSOLUTE path of the workspace (the FX-28 captures pin it), default
   * output prints the path of `displayPath` (F119-FR-029, F119-FR-030).
   */
  readonly compatStderr?: string | undefined;
};

/** A path as a refusal names it: never absolute (F119-FR-030, F119-FR-031). */
export function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  if (rel === "") return ".";
  return rel.startsWith("..") ? basename(path) : rel;
}

function refusal(
  message: string,
  reason?: import("../output/closed-sets.ts").FailureReason,
  compatMessage?: string,
): GuardRefusal {
  return Object.freeze({
    exit: GUARD_EXIT,
    stderr: `${message}\n`,
    reason,
    compatStderr: compatMessage === undefined ? undefined : `${compatMessage}\n`,
  });
}

/**
 * The state check of F119-FR-009. `skip` is `--all` (F119-FR-008: `--all`
 * skips the check of the feature; the workspace check is skipped only where
 * the row of the command says so — `status --all`).
 */
export function stateGuard(
  cp: ControlPlane,
  options?: { readonly skip?: boolean },
): GuardRefusal | null {
  if (options?.skip === true) return null;
  if (stateExists(cp)) return null;
  return refusal(noStateMessage(cp), "no-state", `no ${cp.label}/ state dir in ${cp.workdir}`);
}

/** The feature check of F119-FR-009 (`--all` skips it). */
export function featureGuard(
  cp: ControlPlane,
  slug: string,
  options?: { readonly skip?: boolean },
): GuardRefusal | null {
  if (options?.skip === true) return null;
  if (statSyncSafe(join(cp.stateDir, "features", slug)) === "directory") return null;
  const known = knownFeatures(cp);
  const head = `no feature '${slug}' in ${cp.workdir} (${cp.label}/features/${slug} missing).`;
  const compat =
    known.length === 0
      ? head
      : [head, "known features:", ...known.map((name) => `  - ${name}`)].join("\n");
  return refusal(noFeatureMessage(cp, slug, known), "no-feature", compat);
}

type Kind = "absent" | "file" | "directory";

function statSyncSafe(path: string): Kind {
  try {
    return statSync(path).isDirectory() ? "directory" : "file";
  } catch {
    return "absent";
  }
}

/**
 * F119-FR-009 — the verbs the state check holds. `feedback` and `phases` are
 * NOT in the set: they run with no state directory (their checks are the
 * missing-input checks of F119-FR-010 below).
 */
export const STATE_CHECKED_VERBS: readonly string[] = Object.freeze([
  "status",
  "tail",
  "events",
  "verdicts",
  "watch",
  "stop",
  "resume",
  "learn",
]);

/**
 * F119-FR-009 — the FIRST check of `resume` is the state check: on a
 * workspace without state `resume` exits 1 before any other refusal of its
 * row in annex G §G.4 (B-1482 before B-1494; CQ-184). The function exists so
 * the order is a named fact of the router and not an accident of the call
 * order in `route.ts`.
 */
export function resumeStateCheckFirst(cp: ControlPlane): GuardRefusal | null {
  return stateGuard(cp);
}

/* ------------------------------------------------------------------ *
 * F119-FR-010 — the missing-input exits of the inspection verbs.
 * ------------------------------------------------------------------ */

/** The directory of the runs recorded for one feature. */
export function runsDirOf(cp: ControlPlane, slug: string): string {
  return join(cp.stateDir, "features", slug, "runs");
}

/**
 * The newest run recorded for one feature (the run directory with the newest
 * modification time), or `undefined` where none is recorded.
 */
export function newestRunOf(cp: ControlPlane, slug: string): string | undefined {
  const runs = runsDirOf(cp, slug);
  let entries: string[];
  try {
    entries = readdirSync(runs);
  } catch {
    return undefined;
  }
  let newest: { readonly name: string; readonly at: number } | undefined;
  for (const name of entries) {
    const path = join(runs, name);
    try {
      const at = statSync(path).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { name, at };
    } catch {
      /* a vanished entry is passed over, never a failure of the read */
    }
  }
  return newest === undefined ? undefined : join(runs, newest.name);
}

/**
 * The engine log of the newest run of one feature — the file behind the
 * logical name `run:<runId>:engine-log:<k>` of annex B §B.5.
 */
export function tailLogPathOf(cp: ControlPlane, slug: string): string | undefined {
  const run = newestRunOf(cp, slug);
  if (run === undefined) return undefined;
  const log = join(run, "engine.log");
  return existsSync(log) ? log : undefined;
}

/** `tail`: the engine log of the newest run, or the refusal of F119-FR-010. */
export function tailGuard(cp: ControlPlane, slug: string): GuardRefusal | null {
  if (tailLogPathOf(cp, slug) !== undefined) return null;
  return refusal(
    `no run.log yet for feature '${slug}' in ${cp.label}`,
    "no-log",
    `no run.log yet for feature '${slug}' in ${cp.stateDir}`,
  );
}

/** The workspace event file — the logical name `run:<runId>:events-legacy` of
 * annex B §B.5 at its workspace location. */
export function eventsPathOf(cp: ControlPlane): string {
  return join(cp.stateDir, "events.jsonl");
}

/** `events`: the workspace event file, or the refusal of F119-FR-010. */
export function eventsGuard(cp: ControlPlane): GuardRefusal | null {
  if (existsSync(eventsPathOf(cp))) return null;
  return refusal(
    `no events.jsonl yet in ${cp.label}`,
    "no-events",
    `no events.jsonl yet in ${cp.stateDir}`,
  );
}

/** The directory the verdicts of one feature are recorded under. */
export function verdictsDirOf(cp: ControlPlane, slug: string): string {
  return join(cp.stateDir, "features", slug, "verdicts");
}

/** The transcript files recorded for one phase. */
export function verdictsForPhase(dir: string, phase: number): readonly string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter(
    (name) => name.startsWith(`phase-${phase}-`) || name === `phase-${phase}.md`,
  );
}

/** `verdicts [N]`: the recorded transcripts, or the refusals of F119-FR-010. */
export function verdictsGuard(
  cp: ControlPlane,
  slug: string,
  phase?: number | undefined,
): GuardRefusal | null {
  const dir = verdictsDirOf(cp, slug);
  if (statSyncSafe(dir) !== "directory") {
    return refusal(
      `no verdicts recorded yet (${cp.label}/features/${slug}/verdicts)`,
      "no-verdicts",
      `no verdicts recorded yet (${dir})`,
    );
  }
  if (phase !== undefined && verdictsForPhase(dir, phase).length === 0) {
    return refusal(`no verdicts for phase ${phase}`, "no-verdict-for-phase");
  }
  return null;
}

/** The feedback record of one phase — the file the FX-28 capture names. */
export function feedbackPathOf(cp: ControlPlane, slug: string, phase: number): string {
  return join(cp.stateDir, "features", slug, "gates", `GATE${phase}-FEEDBACK.md`);
}

/** `feedback N`: the usage line without `N`, the missing record with it. */
export function feedbackGuard(
  cp: ControlPlane,
  slug: string,
  phase: number | undefined,
): GuardRefusal | null {
  if (phase === undefined) {
    return refusal(FEEDBACK_USAGE_MESSAGE, "usage");
  }
  const path = feedbackPathOf(cp, slug, phase);
  if (!existsSync(path)) {
    return refusal(
      `no feedback for phase ${phase} (${feedbackDisplayPath(cp, slug, phase)})`,
      "no-feedback",
      `no feedback for phase ${phase} (${path})`,
    );
  }
  return null;
}

/**
 * The feedback record of one phase, as a refusal names it: relative to the
 * workspace, never absolute (F119-FR-030).
 */
export function feedbackDisplayPath(cp: ControlPlane, slug: string, phase: number): string {
  return `${cp.label}/features/${slug}/gates/GATE${phase}-FEEDBACK.md`;
}

/** The message for a spec that does not exist (F119-FR-010). */
export function noSpecMessage(workdir: string): string {
  return `no SPECS.md in ${displayPath(workdir)}`;
}

/**
 * `phases` needs no state; its spec check is the check of F119-FR-010: a
 * missing spec refuses 1 with `no SPECS.md in <workdir>`; a spec the grammar
 * rejects is reported on standard output as `SPEC INVALID:` and the findings,
 * exit 3 (F119-FR-010, B-2001). The grammar is the one owner of it
 * (`@specstride/spec-formats`, feature 104) — imported lazily so a `phases`
 * call stays inside the cold-start budget of CT-119-8.
 */
export async function specGuard(cp: ControlPlane, specPath: string): Promise<GuardRefusal | null> {
  if (!existsSync(specPath)) {
    return refusal(noSpecMessage(cp.workdir), "no-spec", `no SPECS.md in ${cp.workdir}`);
  }
  const specfmt = await import("@specstride/spec-formats");
  const report = specfmt.validate.validateFile(specPath, {
    file: specPath,
    format: "native",
    feature: "119-front-door-and-presenter",
  });
  if (report.valid) return null;
  return Object.freeze({
    exit: SPEC_INVALID_EXIT,
    stderr: "",
    stdout: `${SPEC_INVALID_PREFIX}\n${report.findings.map((f) => f.message).join("\n")}\n`,
    reason: "spec-invalid" as const,
  });
}
