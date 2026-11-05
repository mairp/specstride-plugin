/**
 * THE LIVE RUN THE ENGINE'S OWN RECORDS SHOW (owed item 3 of par-4, carried
 * into step 5's part B).
 *
 * WHY THIS EXISTS. The engine of this build takes no workspace lock and
 * writes no workspace record, so `stop`'s as-is live-run check — the owner
 * file of `workspace:lock` — never fired on a real run: on a LIVE run the
 * command printed `no run appears to be active … (lock is free)` and exited 1
 * (reproduced in the par-4 drive). The reviewer ruling (par-4.done, item 3)
 * says the command must read the live run from WHAT THE ENGINE REALLY
 * WRITES, say so, and exit 0. The two things the engine really writes while
 * a run is live are:
 *
 *  - `<controlRoot>/procs.json` — the supervision registry
 *    (`specstride.procs/1`, F118): the engine holds one entry per pass in
 *    flight (`run:<runId>:pass-in-flight`) and per worker pass of a group
 *    while that pass runs. ANY entry is a live run.
 *  - `<controlRoot>/runs/<runId>/events.jsonl` — the run's own event file.
 *    The engine appends to it continuously and ends it with ONE terminal
 *    event (`run.ended`, F119-FR-028's terminal). A run whose newest event
 *    stream does not end in `run.ended` stands OPEN in the records — live,
 *    or cut without a clean end. Either way it is a run the records show
 *    open, and it is the truth about "no run appears to be active" that the
 *    lock could not give.
 *
 * The read is a READ, never a probe of a process and never a lock
 * (F119-FR-028's rule for the front door): a file that names nothing gives
 * `live: false`, a read error never throws, and a registry that cannot be
 * read is no evidence. An event file that STANDS but carries no parseable
 * terminal event is the opposite of an absence: a torn tail is a run cut
 * while it wrote, and the records show it open. The newest run directory is
 * named by its modification time — the same newest-run rule the inspection
 * verbs use (`newestRunOf`, F119-FR-010).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The requirement this module serves (the reviewer ruling of par-4, item 3). */
export const LIVE_RUN_EVIDENCE_REQUIREMENTS = ["F102-FR-002", "F143-FR-026"] as const;

/** What the engine's records say about a live run. */
export type LiveRunOfTheRecords = {
  /** The records show a run that is live or stands open. */
  readonly live: boolean;
  /** The file the answer came from, where one did. */
  readonly where: string;
  /** The run id the records name, where the run's own records showed it. */
  readonly runId: string;
};

/** No run stands open in the engine's records. */
export const NO_LIVE_RUN: LiveRunOfTheRecords = Object.freeze({
  live: false,
  where: "",
  runId: "",
});

/** The name of the registry file the engine writes (`run-feature.ts`). */
const REGISTRY_FILE = "procs.json";

/** The terminal event a finished run ends its event file with. */
const TERMINAL_EVENT = "run.ended";

/** Whether the registry file holds at least one entry (`specstride.procs/1`). */
function theRegistryHoldsAnEntry(controlRoot: string): boolean {
  try {
    const path = join(controlRoot, REGISTRY_FILE);
    if (!existsSync(path)) return false;
    const read = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return read !== null && typeof read === "object" && Object.keys(read as object).length > 0;
  } catch {
    return false;
  }
}

/** The last whole, parseable event line of a run's event file, if any. */
function theLastEventOf(eventsFile: string): { readonly type: string } | undefined {
  try {
    const lines = readFileSync(eventsFile, "utf8").split("\n");
    for (let at = lines.length - 1; at >= 0; at -= 1) {
      const line = (lines[at] as string).trim();
      if (line === "") continue;
      const parsed = JSON.parse(line) as { type?: unknown };
      return typeof parsed.type === "string" ? { type: parsed.type } : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * THE LIVE RUN OF THE RECORDS. The registry first — it names a pass in
 * flight at the moment of the read — then the newest run of the control
 * root, whose event file not ending in the terminal event is an OPEN run.
 * Both reads are silent about anything they cannot read: a record that
 * cannot be read is no evidence, never a failure.
 */
export function theLiveRunOfTheEngineRecords(controlRoot: string): LiveRunOfTheRecords {
  if (theRegistryHoldsAnEntry(controlRoot)) {
    return Object.freeze({
      live: true,
      where: join(controlRoot, REGISTRY_FILE),
      runId: "",
    });
  }
  const runsDirectory = join(controlRoot, "runs");
  let entries: string[];
  try {
    entries = readdirSync(runsDirectory);
  } catch {
    return NO_LIVE_RUN;
  }
  let newest: { readonly runId: string; readonly at: number } | undefined;
  for (const runId of entries) {
    try {
      const at = statSync(join(runsDirectory, runId)).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { runId, at };
    } catch {
      /* a vanished entry is passed over, never a failure of the read */
    }
  }
  if (newest === undefined) return NO_LIVE_RUN;
  const eventsFile = join(runsDirectory, newest.runId, "events.jsonl");
  if (!existsSync(eventsFile)) return NO_LIVE_RUN;
  const last = theLastEventOf(eventsFile);
  if (last?.type === TERMINAL_EVENT) return NO_LIVE_RUN;
  return Object.freeze({
    live: true,
    where: eventsFile,
    runId: newest.runId,
  });
}

/** The sentence `stop` prints where the records show a live run. */
export function aRunStandsOpenLine(reading: LiveRunOfTheRecords): string {
  const run = reading.runId === "" ? "" : ` (${reading.runId})`;
  return `a run stands open in the engine's records${run}: ${reading.where} — the request will be honoured at its next boundary.`;
}
