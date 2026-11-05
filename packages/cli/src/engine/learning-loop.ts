/**
 * The learning wiring of one engine run (feature 106, F106-FR-036): the mode
 * of the run, the compatibility feed its figures come from, the call after
 * each approved phase, and the lines at exit.
 *
 * Everything here COMPOSES the learning package — reached through the front
 * door `../learn.ts`, the one importer of it (T079) — and the compatibility
 * projection of feature 144; no behaviour is restated and none is rewritten.
 * The module owns no file of its own and adds no configuration key: it reads
 * the two switches the projection owns (`profile` and `compat.legacyEvents`)
 * through the REAL configuration — the same read path `loop-config.ts` uses —
 * and writes nothing except through the callbacks it is handed.
 *
 * THE FAILURE RULE (F106-FR-036) is the shape of every call out of here: the
 * learning hooks return result unions and never raise into the run, and the
 * one entry point this module offers the engine (`afterApprovedPhase`) catches
 * everything into the failure line, so a failed observation or a failed
 * evaluation can never undo an approval or change the result of a run. The
 * lines of an observation, of an evaluation and of an automatic revert go to
 * the ENGINE LOG through `logLine`, never to standard output; only the lines
 * at exit go to both.
 *
 * F106-FR-039 (inertness) is why the ENGINE holds the mode and gates every
 * call: with the mode `off` the engine calls nothing here, and a run with the
 * mode `suggest` differs from one with `off` only in the learning stream and
 * files, the learning.observed event and the lines learning prints.
 */
import { realpathSync } from "node:fs";

import { loadConfigFiles, resolveConfiguration } from "@specstride/config";
import {
  engineEvaluate,
  engineObserve,
  lastEvaluationsReport,
  learningFailureLine,
  learningPaths,
  resolveMode,
  summarizeFromPaths,
  OBSERVED_EVENT_TYPE,
  type LearningMode,
  type ResolvedMode,
} from "../learn.ts";
import {
  asIsRunId,
  backendLabelOf,
  CompatibilityProjection,
  SWITCH,
  taskOf,
  type ProjectionSwitches,
} from "@specstride/observability/projection";

/** The key of the profile, whose `parity` value switches the projection on. */
const PROFILE_KEY = "profile";

/** The label of a role the engine resolved, `claude` where none was named. */
function roleLabelOf(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  return value === undefined || value === "" ? "claude" : value;
}

/**
 * The mode of one engine run (F106-FR-009): resolved from the as-is aliases of
 * the environment only — the launch contract pins nothing through this path,
 * so `pinned` is null and where a contract pins a mode it strips the aliases
 * before the engine starts.
 */
export function learningModeOf(environment: NodeJS.ProcessEnv): ResolvedMode {
  return resolveMode({ pinned: null, env: environment });
}

/** What `compatibilityFeedOf` needs: one engine run, as the engine knows it. */
export type CompatibilityFeedInput = {
  /** The home directory, where the user configuration file lives. */
  readonly home: string;
  /** The working directory of the run: `task` (B-0064) and the project file. */
  readonly workdir: string;
  /** The environment, for the configuration and the two role labels. */
  readonly environment: NodeJS.ProcessEnv;
  /** The control root the projection resolves its files against (annex B). */
  readonly controlRoot: string;
  /** The logical run id of the run. */
  readonly runId: string;
  /** The feature slug. */
  readonly slug: string;
  /** The pid of the engine, for the as-is run id (F100-FR-046, B-0500). */
  readonly enginePid: number;
  /** When this engine start began. */
  readonly startedAt: Date;
};

/** The compatibility feed of one engine run: the projection and its event file. */
export type CompatibilityFeed = {
  /** The projection: a sink, best effort, inert where the switches are off. */
  readonly projection: CompatibilityProjection;
  /** The as-is event file of this engine start, in the OLD vocabulary. */
  readonly eventsFile: string;
  /** Whether the projection is on (F144-FR-001). */
  readonly isOn: boolean;
};

/**
 * The compatibility feed the learning figures come from (F106-FR-004): the
 * projection of feature 144, on under the `parity` profile or under the switch
 * `compat.legacyEvents` and off otherwise, read through the REAL
 * configuration. The object comes back whether the switches are on or off —
 * the projection itself is inert when off, `project` writes nothing — so the
 * caller decides nothing: it hands each event over and reads the events file
 * of this engine start.
 */
export function compatibilityFeedOf(input: CompatibilityFeedInput): CompatibilityFeed {
  const files = loadConfigFiles({
    home: input.home,
    workspaceRealPath: realpathSync(input.workdir),
    startDir: input.workdir,
  });
  const resolved = resolveConfiguration({
    ...(files.user === undefined ? {} : { user: files.user }),
    ...(files.project === undefined ? {} : { project: files.project }),
    environment: input.environment,
  });
  const valueOf = (key: string): unknown => resolved.values.get(key)?.value;
  const config: Record<string, unknown> = {
    [PROFILE_KEY]: valueOf(PROFILE_KEY),
    [SWITCH]: valueOf(SWITCH),
  };
  const profile = config[PROFILE_KEY];
  const switches: ProjectionSwitches = {
    profile: typeof profile === "string" ? profile : undefined,
    config,
  };
  const projection = new CompatibilityProjection({
    switches,
    context: {
      runId: asIsRunId(input.startedAt, input.enginePid),
      project: taskOf(input.workdir),
      backendLabel: backendLabelOf(
        roleLabelOf(input.environment, "SPECSTRIDE_PROPOSER"),
        roleLabelOf(input.environment, "SPECSTRIDE_CRITIC"),
      ),
      featureSlug: input.slug,
    },
    layout: { runId: input.runId, slug: input.slug, engineStart: 1 },
    roots: { control: input.controlRoot },
  });
  return Object.freeze({
    projection,
    eventsFile: projection.eventsFile,
    isOn: projection.isOn,
  });
}

/** What `afterApprovedPhase` needs: one approved phase, and where lines go. */
export type AfterApprovedPhaseInput = {
  /** The mode in force; the engine calls this only where it is not `off`. */
  readonly mode: LearningMode;
  /** The feature directory of the run; the learning writer domain lives under it. */
  readonly featureDir: string;
  /** The phase that was approved. */
  readonly phase: number;
  /** The shape the phase ran under; `null` when unrestricted. */
  readonly shape: string | null;
  /** The event files the summary is computed from (the as-is events file). */
  readonly summaryPaths: readonly string[];
  /** The run id of THIS run. */
  readonly runId: string;
  /** The engine's clock. */
  readonly now: Date;
  /**
   * The ENGINE LOG sink (F106-FR-036): every line of the observation, of the
   * evaluation and of an automatic revert goes here and never to stdout.
   */
  readonly logLine: (line: string) => void;
  /** The engine records learning.observed through this, after the document was written. */
  readonly recordObserved: (data: { phase: number; logicalName: string }) => void;
};

/**
 * The call after each approved phase (F106-FR-036): build the summary document
 * (F106-FR-004), observe the phase (F106-FR-006), and — only where the
 * observation was written — evaluate the active decisions of that phase, not
 * as a dry run, under the writer-domain lock (F106-FR-038).
 *
 * NEVER THROWS: every failure, of the summary, of the observation or of the
 * evaluation, is the failure line through `logLine`, and the approval this
 * call follows stands exactly as it did.
 */
export async function afterApprovedPhase(input: AfterApprovedPhaseInput): Promise<void> {
  const { logLine, recordObserved } = input;
  const what = `observe of phase ${String(input.phase)}`;
  try {
    // F106-FR-004 — the figures come from the event streams read through the
    // compatibility projection, where the as-is name is used: the summariser
    // reads the OLD vocabulary. A failure here is the observation's failure.
    let summary: Record<string, unknown>;
    try {
      summary = summarizeFromPaths(input.summaryPaths);
    } catch (error) {
      logLine(learningFailureLine(what, error));
      return;
    }
    const observed = engineObserve({
      featureDir: input.featureDir,
      phase: input.phase,
      shape: input.shape,
      summary,
      generatedAt: input.now.toISOString(),
      inputs: { events: input.summaryPaths },
    });
    if (!observed.ok) {
      logLine(observed.line);
      return;
    }
    if (!observed.written) return;
    // The event is the run's own and the engine's to write (F106-FR-021): it
    // exists only where the document does.
    recordObserved({ phase: input.phase, logicalName: observed.observation.logicalName });
    logLine(observed.line);
    // The evaluation runs only where the observation was written, and is NOT
    // a dry run: it records what changed and reverts on a guardrail breach
    // (F106-FR-019), all under the lock, all as a result union.
    const evaluated = await engineEvaluate({
      featureDir: input.featureDir,
      phase: input.phase,
      shape: input.shape,
      summary,
      runId: input.runId,
      evaluatedAt: input.now.toISOString(),
      nowSeconds: input.now.getTime() / 1000,
    });
    if (!evaluated.ok) {
      logLine(evaluated.line);
      return;
    }
    for (const line of evaluated.lines) logLine(line);
    for (const line of evaluated.revertLines) logLine(line);
  } catch (error) {
    // The rule of F106-FR-036, once more, at the edge: nothing this call does
    // may reach the run, not even a failure to report a failure.
    try {
      logLine(learningFailureLine(what, error));
    } catch {
      /* the sink refused the line; there is nothing left to do */
    }
  }
}

/** What `learningExitLines` needs: the mode and the feature directory. */
export type LearningExitLinesInput = {
  readonly mode: LearningMode;
  readonly featureDir: string;
};

/**
 * The lines at exit (F106-FR-036): the last recorded evaluations, one per
 * (knob, phase), and none at all where no decision log exists. Pure: a read,
 * never a write, and never a throw.
 */
export function learningExitLines(input: LearningExitLinesInput): readonly string[] {
  return lastEvaluationsReport(learningPaths(input.featureDir).decisions);
}

/**
 * The type of the event the engine writes to the run's own stream after a
 * written observation (F106-FR-006, F106-FR-021), handed to the engine here so
 * the wiring names no `learning.` literal itself.
 */
export { OBSERVED_EVENT_TYPE };
