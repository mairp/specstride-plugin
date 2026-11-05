/**
 * The entries of the process registry the ENGINE writes, read for `stop
 * --now` (F102-FR-006 over F143-FR-026). The engine's registry is the
 * supervision file `<controlRoot>/procs.json` — a map of `specstride.procs/1`
 * identity blocks keyed by logical name (`run:<runId>:pass-in-flight`,
 * `worker:<id>`, the adoptable jobs) — while the identity check of
 * `signal-owned.ts` reads the contracts record `specstride.procs/1`. This
 * reader is the join: every entry on the file as it stands, carried over
 * field by field (pid, group, session, start time, run-token hash), with the
 * class the check considers (`owned`; an adoptable job only with `--jobs`)
 * and the kind the logical name names. An unreadable or partial file answers
 * no entries — a stop that ends nothing rather than one that guesses.
 */
import { readFileSync } from "node:fs";

import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";
import { isProcessRegistry } from "@specstride/contracts/records/process-registry";

import type { RegistryEntry } from "../../../core/src/pass-supervision/ports.ts";

/** The requirements this join carries out. */
export const SUPERVISION_REGISTRY_ENTRIES_REQUIREMENTS = ["F102-FR-006", "F143-FR-026"] as const;

/** The kind of a record the schema holds, from the entry's logical name. */
function kindOf(logicalName: string): ProcessRegistry["kind"] {
  if (logicalName.startsWith("worker:")) return "worker-pass";
  if (logicalName.startsWith("job:")) return "detached-job";
  return "harness-pass";
}

/** The run id an entry's logical name carries (`run:<runId>:…`), else "". */
function runIdOf(logicalName: string): string {
  const rest = logicalName.startsWith("run:") ? logicalName.slice(4) : "";
  const end = rest.indexOf(":");
  return end < 0 ? rest : rest.slice(0, end);
}

/** One supervision entry as the contracts record the identity check reads. */
function asProcessRegistry(entry: RegistryEntry): ProcessRegistry {
  return {
    schema: "specstride.procs/1",
    procId: entry.logicalName,
    class: entry.registryClass === "adoptable" ? "adoptable" : "owned",
    kind: kindOf(entry.logicalName),
    pid: entry.identity.pid,
    processGroup: entry.identity.groupId,
    processSession: entry.identity.sessionId,
    startTime: new Date(entry.identity.startedAtMs).toISOString(),
    runTokenHash: entry.identity.runTokenHash,
    runId: runIdOf(entry.logicalName),
    engineStartId: "",
  };
}

/**
 * Every entry of the engine's supervision registry (`<controlRoot>/procs.json`)
 * in the shape the identity check reads. Entries the schema refuses are
 * dropped: the check runs over what reads, never over what does not.
 */
export function entriesOfTheSupervisionRegistry(path: string): readonly ProcessRegistry[] {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (typeof file !== "object" || file === null) return [];
  const entries: ProcessRegistry[] = [];
  for (const value of Object.values(file as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const candidate = value as RegistryEntry;
    if (
      typeof candidate.logicalName !== "string" ||
      typeof candidate.identity?.pid !== "number" ||
      typeof candidate.identity.groupId !== "number" ||
      typeof candidate.identity.sessionId !== "number" ||
      typeof candidate.identity.startedAtMs !== "number" ||
      typeof candidate.identity.runTokenHash !== "string" ||
      (candidate.registryClass !== "pass" &&
        candidate.registryClass !== "job" &&
        candidate.registryClass !== "adoptable")
    ) {
      continue;
    }
    const record = asProcessRegistry(candidate);
    if (isProcessRegistry(record)) entries.push(record);
  }
  return entries;
}
