/**
 * T040 — the state readers of `status`: the named state files and the records
 * of the control plane, read as values (`packages/cli/src/status/`; F129-FR-001,
 * F129-FR-024).
 *
 * `project` reads no file (F129-FR-001); the caller hands it values. This
 * module is the reading half of that caller: the run record
 * (`run:<runId>:record`), the terminal record (`run:<runId>:terminal`), the
 * pause record (`run:<runId>:pause`), the newest launch record
 * (`launch:<launchId>:record`) and the supervision record
 * (`launch:<launchId>:supervision`). Every reader answers `null` where the
 * file is absent or unreadable — an absent file is a fact, not a failure
 * (F129-FR-024: `status` exits 1 only where the workspace holds no state at
 * all).
 *
 * The paths are never written as literals here: each one is resolved from the
 * layout table of annex B §B.5 through
 * `@specstride/contracts/ids/logical-names` (F100-FR-053).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";

/** The place a reader of the control plane stands in. */
export type ControlPlace = {
  /** The control root: `$XDG_STATE_HOME/specstride/workspaces/<id>`, or the root the consumer set. */
  readonly controlRoot: string;
  /** The real path of the working tree. */
  readonly workspaceRealPath: string;
};

/** The root paths the layout table resolves against. */
function rootsOf(place: ControlPlace): Readonly<Record<string, string>> {
  return rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  }) as unknown as Readonly<Record<string, string>>;
}

/** Resolve one logical name of the layout table to its path. */
export function controlPathOf(
  place: ControlPlace,
  logicalName: string,
  parameters: Readonly<Record<string, string>> = {},
): string {
  return resolve(logicalName, parameters, rootsOf(place));
}

/** The parsed record at a path, or `null` where it is absent or unreadable. */
export function readJsonAt(path: string): Readonly<Record<string, unknown>> | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Readonly<Record<string, unknown>>)
      : null;
  } catch {
    return null;
  }
}

/** The run record of a run (`run:<runId>:record`), or `null`. */
export function readRunRecord(
  place: ControlPlace,
  slug: string,
  runId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(
    controlPathOf(place, "run:<runId>:record", { "<slug>": slug, "<runId>": runId }),
  );
}

/** The terminal record of a run (`run:<runId>:terminal`), or `null`. */
export function readTerminalRecord(
  place: ControlPlace,
  slug: string,
  runId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(
    controlPathOf(place, "run:<runId>:terminal", { "<slug>": slug, "<runId>": runId }),
  );
}

/** The pause record of a run (`run:<runId>:pause`), or `null`. */
export function readPauseRecord(
  place: ControlPlace,
  slug: string,
  runId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(
    controlPathOf(place, "run:<runId>:pause", { "<slug>": slug, "<runId>": runId }),
  );
}

/** The event file of a run (`run:<runId>:events`). */
export function eventsPathOf(place: ControlPlace, slug: string, runId: string): string {
  return controlPathOf(place, "run:<runId>:events", { "<slug>": slug, "<runId>": runId });
}

/** The lease file of a run (`run:<runId>:lease`), read for the lease's own fields. */
export function readLeaseFile(
  place: ControlPlace,
  slug: string,
  runId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(
    controlPathOf(place, "run:<runId>:lease", { "<slug>": slug, "<runId>": runId }),
  );
}

/** The launch record of a launch (`launch:<launchId>:record`), or `null`. */
export function readLaunchRecord(
  place: ControlPlace,
  launchId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(controlPathOf(place, "launch:<launchId>:record", { "<launchId>": launchId }));
}

/** The supervision record of a launch (`launch:<launchId>:supervision`), or `null`. */
export function readSupervisionRecord(
  place: ControlPlace,
  launchId: string,
): Readonly<Record<string, unknown>> | null {
  return readJsonAt(
    controlPathOf(place, "launch:<launchId>:supervision", { "<launchId>": launchId }),
  );
}

/** What the launcher points at: the run of the newest engine start. */
export type CurrentPointer = {
  readonly runId: string | null;
  readonly feature: string | null;
  readonly launchId: string | null;
};

/** Read `<control>/current.json`, the pointer the layout table names. */
export function readCurrentPointer(place: ControlPlace): CurrentPointer {
  const record = readJsonAt(join(place.controlRoot, "current.json"));
  const runId = record?.["runId"];
  const feature = record?.["feature"] ?? record?.["slug"];
  const launchId = record?.["launchId"];
  return Object.freeze({
    runId: typeof runId === "string" && runId !== "" ? runId : null,
    feature: typeof feature === "string" && feature !== "" ? feature : null,
    launchId: typeof launchId === "string" && launchId !== "" ? launchId : null,
  });
}

/**
 * The newest launch record of the workspace (observation 2 of
 * `contracts/observations.md`): the records of `<control>/launches/`, the
 * newest by `createdAt`, and by launch id where two carry the same time.
 */
export function newestLaunchRecordOf(place: ControlPlace): {
  readonly launchId: string | null;
  readonly record: Readonly<Record<string, unknown>> | null;
} {
  let names: readonly string[];
  try {
    names = readdirSync(join(place.controlRoot, "launches"));
  } catch {
    return Object.freeze({ launchId: null, record: null });
  }
  let best: { launchId: string; record: Readonly<Record<string, unknown>> } | null = null;
  for (const name of names) {
    const record = readLaunchRecord(place, name);
    if (record === null) continue;
    if (
      best !== null &&
      String(record["createdAt"] ?? "") < String(best.record["createdAt"] ?? "")
    ) {
      continue;
    }
    if (
      best !== null &&
      String(record["createdAt"] ?? "") === String(best.record["createdAt"] ?? "") &&
      name < best.launchId
    ) {
      continue;
    }
    best = { launchId: name, record };
  }
  return best === null
    ? Object.freeze({ launchId: null, record: null })
    : Object.freeze({ launchId: best.launchId, record: best.record });
}

/** True where the workspace of the place holds no state at all (F129-FR-024). */
export function holdsNoState(place: ControlPlace): boolean {
  try {
    readdirSync(place.controlRoot);
  } catch {
    return true;
  }
  return false;
}

/**
 * The last `DIGEST` line of the pipeline run the newest supervision record
 * names, when that run is over (F100-FR-180: a host skill prints the line
 * verbatim, so `wait` offers it after a change): the state record of the run
 * directory holds one of the terminal states and its log holds the digest.
 * Nothing else of the log is read — one line, verbatim. The record on disk
 * names its members `runDir` and `launchLog` (the record of
 * `supervisor/record.ts`); the snake-case names belong to its compatibility
 * projection, which never reaches this file.
 */
export function digestLineOfThePipeline(place: ControlPlace): string | null {
  const launchId = newestLaunchRecordOf(place).launchId;
  if (launchId === null) return null;
  const record = readSupervisionRecord(place, launchId);
  if (record === null) return null;
  const runDir = typeof record["runDir"] === "string" ? record["runDir"] : null;
  const launchLog = typeof record["launchLog"] === "string" ? record["launchLog"] : null;
  const log = launchLog ?? (runDir === null ? null : join(runDir, "pipeline.log"));
  if (runDir === null || log === null) return null;
  const state = readJsonAt(join(runDir, "state.json"))?.["state"];
  if (state !== "completed" && state !== "failed" && state !== "stopped") return null;
  let text: string;
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").filter((one) => one.startsWith("[DIGEST] "));
  return lines.at(-1) ?? null;
}
