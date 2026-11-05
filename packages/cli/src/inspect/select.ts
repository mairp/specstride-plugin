/**
 * T029 — the selection of the events, the engine log and the feature by
 * logical name (F119-FR-016, F119-FR-017).
 *
 * Inspection reaches state ONLY through the logical names of annex B §B.5:
 * `workspace:current:events` and `workspace:current:engine-log` (the newest
 * engine start of the workspace), `run:<runId>:events` and
 * `run:<runId>:engine-log` (the run of the newest engine start of a feature),
 * `gate:<N>:feedback` and `gate:<N>:verdict` (the phase records). No legacy
 * state directory is named and none is read (F119-FR-017); nothing here
 * writes (F119-FR-016).
 *
 * `events --feature S` with no engine start of that feature falls back to the
 * current event file of the workspace (F119-FR-018); the fallback is a fact
 * of the selection (`fellBack`) that the caller may report.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { newestRunOf, eventsPathOf, type ControlPlane } from "../router/guards.ts";
import {
  sanitizeFeature,
  featureOfTheLastRun,
  DEFAULT_FEATURE,
  type InspectArgs,
} from "../router/inspect-args.ts";

/** Where one selection found the events or the log of a call. */
export type SelectedFile = {
  /** The physical path, for the read only; never printed. */
  readonly path: string;
  /** The logical name of annex B §B.5 the line and the record print. */
  readonly logicalName: string;
  /** True where `--feature` fell back to the current file (F119-FR-018). */
  readonly fellBack?: boolean | undefined;
};

/** What one inspection call selected (the `Selection` of the data model). */
export type Selection = {
  /** The feature slug the call resolved to. */
  readonly feature: string;
  /** The newest run recorded for the feature, by run id, when one is. */
  readonly runId: string | undefined;
  /** The event file of the call, when the workspace has one. */
  readonly events: SelectedFile | undefined;
  /** The engine log of the call, when the newest run has one. */
  readonly log: SelectedFile | undefined;
};

/** F119-FR-008 — the feature the call selected: `--feature`, last run, default. */
export function selectFeature(args: InspectArgs, cp: ControlPlane): string {
  if (args.feature !== undefined) return sanitizeFeature(args.feature);
  // The workspace record holds the feature of the newest engine start; the
  // reader of feature 100 resolves it from the run snapshots, by logical
  // name. This module loads lazily, so the read costs no cold start.
  return featureOfTheLastRun(cp.stateDir) ?? DEFAULT_FEATURE;
}

function newestRunOfPath(runs: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(runs);
  } catch {
    return undefined;
  }
  let newest: { name: string; at: number } | undefined;
  for (const name of entries) {
    const path = join(runs, name);
    try {
      const at = statSync(path).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { name, at };
    } catch {
      continue;
    }
  }
  return newest === undefined ? undefined : join(runs, newest.name);
}

/** The id of the newest run of one feature, when one is recorded. */
export function newestRunId(cp: ControlPlane, slug: string): string | undefined {
  const run = newestRunOf(cp, slug);
  return run === undefined ? undefined : basenameOf(run);
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * F119-FR-018 — the event file of one call. Without `--feature` the current
 * event file of the workspace (`workspace:current:events`); with it the
 * newest event file of that feature, falling back to the current one.
 */
export function selectEvents(
  cp: ControlPlane,
  slug: string,
  explicitFeature: boolean,
): SelectedFile | undefined {
  const current = eventsPathOf(cp);
  if (!explicitFeature) {
    return existsSync(current)
      ? { path: current, logicalName: "workspace:current:events" }
      : undefined;
  }
  const featureDir = join(cp.stateDir, "features", slug);
  const candidates = [
    join(featureDir, "events.jsonl"),
    join(newestRunOfPath(join(featureDir, "runs")) ?? "", "events.jsonl"),
  ];
  let newest: { path: string; at: number } | undefined;
  for (const path of candidates) {
    if (path === "" || !existsSync(path)) continue;
    try {
      const at = statSync(path).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { path, at };
    } catch {
      continue;
    }
  }
  if (newest !== undefined) {
    return { path: newest.path, logicalName: `feature:${slug}:events` };
  }
  // F119-FR-018 — the fallback to the current event file of the workspace.
  return existsSync(current)
    ? { path: current, logicalName: "workspace:current:events", fellBack: true }
    : undefined;
}

/**
 * F119-FR-018 — the engine log of the selected engine start:
 * `run:<runId>:engine-log` of the newest run of the feature.
 */
export function selectEngineLog(cp: ControlPlane, slug: string): SelectedFile | undefined {
  const run = newestRunOf(cp, slug);
  if (run === undefined) return undefined;
  const log = join(run, "engine.log");
  if (!existsSync(log)) return undefined;
  return { path: log, logicalName: `run:${basenameOf(run)}:engine-log` };
}

/** Select everything one inspection call reads. */
export function select(args: InspectArgs, cp: ControlPlane): Selection {
  const explicitFeature = args.feature !== undefined;
  const feature = selectFeature(args, cp);
  const runId = newestRunId(cp, feature);
  return Object.freeze({
    feature,
    runId,
    events: selectEvents(cp, feature, explicitFeature),
    log: selectEngineLog(cp, feature),
  });
}
