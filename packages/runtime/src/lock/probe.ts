/**
 * T030 — `probe`, driven by the decision table
 * `packages/runtime/src/data/probe-decision-table.json` (research D-5;
 * F122-FR-013).
 *
 * The table is not documentation of this module: it IS this module's control
 * flow. `PROBE_ROWS` is read out of the JSON at load, the rows are evaluated
 * in the order the file gives them ("first matching row"), and the result of a
 * row is the `result` field of the JSON row and never a literal written here.
 * Take a row out of the file and the behaviour changes; change a row's result
 * and the probe returns the new one. What this module adds is one PREDICATE
 * per row id — the reading of the observations that the row's `when` describes
 * — and a row id in the file for which there is no predicate is a
 * configuration error at load, not a row that quietly never matches.
 *
 * The six results and which of them count as held are the table's too
 * (`held`), so "every result except `free` and `stale-owner-dead` counts as
 * held" (F122-FR-013) is checked against the file and not asserted twice.
 *
 * The observations themselves come from three places and this module takes
 * none of them itself: the lock directory (does it exist, can the owner record
 * be read), `owner-record.ts` (host name, pid namespace, boot identity —
 * rows P3 and P4), and `liveness.ts` (the kernel's answer — rows P4, P5, P6).
 * Row P5 asks the process registry, through the reader D-5 names.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PROBE_RESULTS,
  type ProbeResult,
  UNKNOWN_COUNTS_AS_HELD,
} from "@specstride/contracts/ep/lock";
import { classOfKind, type ProcessClass } from "@specstride/contracts/records/process-registry";
import table from "../data/probe-decision-table.json" with { type: "json" };
import { compareWithThisProcess, validateOwnerRecord, type OwnerRecord } from "./owner-record.ts";
import { probeLiveness, type LivenessAnswer } from "./liveness.ts";
import { lockPathsOf, type LockPlace } from "./paths.ts";
import { platformIo, recordedProcessLives, type PlatformIo } from "../procs/platform.ts";
import { processPrimitive } from "@specstride/kernel";
import type { ProcessPrimitive } from "@specstride/contracts/ep/kernel-services";

/** The requirement this module carries and the research it comes from. */
export const PROBE_REQUIREMENT = "F122-FR-013" as const;
export const PROBE_DECISION = "D-5" as const;

/** Where the table lives, so that a reader and a test name the same file. */
export const DECISION_TABLE_FILE = "packages/runtime/src/data/probe-decision-table.json" as const;

/** One row of the decision table, as the file writes it. */
export type ProbeRow = {
  readonly id: string;
  readonly when: string;
  readonly result: ProbeResult;
  readonly held: boolean;
};

type RawTable = {
  requirement: string;
  order: string;
  rows: { id: string; when: string; result: string; held: boolean }[];
};

/** The rows of the table, in the order the file gives them. */
export const PROBE_ROWS: readonly ProbeRow[] = Object.freeze(
  (table as RawTable).rows.map((row) =>
    Object.freeze({
      id: row.id,
      when: row.when,
      result: resultOf(row.id, row.result),
      held: row.held,
    }),
  ),
);

/** The table says "first matching row"; nothing else is supported. */
export const TABLE_ORDER = (table as RawTable).order;

function resultOf(id: string, value: string): ProbeResult {
  if (!(PROBE_RESULTS as readonly string[]).includes(value)) {
    throw new Error(
      `row \`${id}\` of ${DECISION_TABLE_FILE} gives the result \`${value}\`, which is not one ` +
        `of the six of EP-13 (${PROBE_RESULTS.join(", ")})`,
    );
  }
  return value as ProbeResult;
}

/**
 * What a probe observed. Each field is one reading, named as the table's
 * `when` names it, so that a reader can hold the two side by side.
 */
export type ProbeObservations = {
  /** Row P1: no lock exists. A lock that is absent counts as free. */
  readonly lockExists: boolean;
  /** Row P2: the provider failed. */
  readonly providerFailed: boolean;
  /** Row P2: the owner record can be read and carries every required field. */
  readonly ownerRecordReadable: boolean;
  /** Row P3: the host name or the pid namespace differs from the prober's. */
  readonly foreign: boolean;
  /** Rows P4 to P6: the boot identity of the record is the present boot. */
  readonly sameBoot: boolean;
  /** Rows P4 to P6: what the kernel says about the listening endpoint. */
  readonly liveness: LivenessAnswer;
  /** Row P5: an open entry of class `owned` passes the identity check. */
  readonly anOpenOwnedEntryPassesTheIdentityCheck: boolean;
};

/**
 * F122-FR-013 — *an owner whose boot identity differs from the present boot
 * MUST count as dead, whatever process now has its pid.* So "dead" is two
 * readings and not one, and the rows P5 and P6 that say "the owner is dead"
 * mean this.
 */
export function theOwnerIsDead(observed: ProbeObservations): boolean {
  return observed.liveness === "dead" || !observed.sameBoot;
}

/** One predicate per row id of the table. */
const PREDICATES: Readonly<Record<string, (o: ProbeObservations) => boolean>> = Object.freeze({
  P1: (o) => !o.lockExists,
  P2: (o) => o.providerFailed || !o.ownerRecordReadable,
  P3: (o) => o.foreign,
  P4: (o) => o.sameBoot && o.liveness === "alive",
  P5: (o) => theOwnerIsDead(o) && o.anOpenOwnedEntryPassesTheIdentityCheck,
  P6: (o) => theOwnerIsDead(o) && !o.anOpenOwnedEntryPassesTheIdentityCheck,
  P7: () => true,
});

// A row of the file with no predicate here would never match and the probe
// would fall through it in silence. That is a configuration error of the
// product, and it is raised at load, where a test run meets it, and never in
// a consumer's terminal.
for (const row of PROBE_ROWS) {
  if (PREDICATES[row.id] === undefined) {
    throw new Error(
      `row \`${row.id}\` of ${DECISION_TABLE_FILE} ("${row.when}") has no predicate in ` +
        `packages/runtime/src/lock/probe.ts, so it could never match (F122-FR-013)`,
    );
  }
}

/** What the probe decided, and which row of the table decided it. */
export type ProbeDecision = {
  readonly result: ProbeResult;
  /** The id of the first matching row, so a refusal can cite it. */
  readonly row: string;
  /** The `when` of that row, for a doctor finding. */
  readonly because: string;
  /** Whether the result counts as held, from the row of the table. */
  readonly held: boolean;
};

/**
 * F122-FR-013 — the first matching row of the table decides. Nothing below
 * this line knows any of the six results by name.
 */
export function probeResultFrom(observed: ProbeObservations): ProbeDecision {
  for (const row of PROBE_ROWS) {
    const predicate = PREDICATES[row.id];
    if (predicate !== undefined && predicate(observed)) {
      return Object.freeze({
        result: row.result,
        row: row.id,
        because: row.when,
        held: row.held,
      });
    }
  }
  // The table's last row is `anything else`, so this is unreachable while the
  // file holds it. It is here so that a file whose last row was taken out
  // gives the result the unknown-value rule of §F.5 names, and never throws.
  return Object.freeze({
    result: "unknown" as ProbeResult,
    row: "(no row matched)",
    because: `no row of ${DECISION_TABLE_FILE} matched`,
    held: UNKNOWN_COUNTS_AS_HELD,
  });
}

/**
 * F122-FR-013 — whether a result counts as held, read from the `held` column
 * of the table. `UNKNOWN_COUNTS_AS_HELD` of the EP-13 contract is checked
 * against it, so the two can never drift apart without a failure.
 */
export function countsAsHeld(result: ProbeResult): boolean {
  const row = PROBE_ROWS.find((r) => r.result === result);
  return row?.held ?? UNKNOWN_COUNTS_AS_HELD;
}

/** The results the table marks as NOT held: `free` and `stale-owner-dead`. */
export const RESULTS_THAT_ARE_NOT_HELD: readonly ProbeResult[] = Object.freeze(
  PROBE_ROWS.filter((r) => !r.held).map((r) => r.result),
);

/* ------------------------------------------------------------------ *
 * Taking the observations.
 * ------------------------------------------------------------------ */

/** One open entry of class `owned` that a probe found (research D-5). */
export type OwnedEntry = {
  readonly procId: string;
  readonly kind: string;
  readonly class: ProcessClass;
  readonly pid: number;
  readonly startTimeMs: number | null;
};

/** What the probe needs that is not the lock directory itself. */
export type ProbeDependencies = {
  /** D-5 — the open entries of class `owned` of the process registry. */
  readonly openOwnedEntries?: ((owner: OwnerRecord) => readonly OwnedEntry[]) | undefined;
  readonly io?: PlatformIo | undefined;
  readonly primitive?: ProcessPrimitive | undefined;
  /** The liveness answer; the endpoint of the owner record where none is given. */
  readonly liveness?: ((owner: OwnerRecord) => Promise<LivenessAnswer>) | undefined;
};

/** The owner record carries the path of its endpoint (research D-3). */
export const ENDPOINT_FIELD = "livenessEndpoint" as const;

/** The time the lock was taken, written beside the owner record (F122-FR-016). */
export const ACQUIRED_AT_FIELD = "acquiredAt" as const;

/** The owner record as the shipped provider writes it. */
export type LockOwnerRecord = OwnerRecord & {
  readonly [ENDPOINT_FIELD]?: string;
  readonly [ACQUIRED_AT_FIELD]?: string;
  readonly runId?: string;
  readonly asIsRunId?: string;
};

/** The reading of the lock directory, before the table is consulted. */
export type LockReading = {
  readonly lockExists: boolean;
  readonly owner: LockOwnerRecord | null;
  readonly ownerRecordReadable: boolean;
  /** Why the owner record could not be read, for a doctor finding. */
  readonly refusal: string | null;
};

/**
 * How many times the owner record is re-read before a lock is called
 * unreadable. A lock that is being reclaimed is renamed away and renamed back
 * within microseconds, and a reader that happened to look between the two
 * would otherwise report `unknown` — which counts as HELD — about a lock that
 * is merely changing hands. One re-read settles it; three is cheap.
 */
export const READ_ATTEMPTS = 3 as const;

/**
 * Read the lock directory: does it exist, and is its owner record usable?
 *
 * The owner record is read FIRST and the directory is only looked at when
 * that read fails. The other order has a window: a lock can be renamed away
 * between "the directory is there" and "read the record in it", and the
 * reader would then report a lock with no owner record — the one thing this
 * provider guarantees cannot exist.
 */
export function readLock(place: LockPlace): LockReading {
  const paths = lockPathsOf(place);
  let parsed: unknown;
  let last = "";
  for (let attempt = 0; ; attempt++) {
    try {
      parsed = JSON.parse(readFileSync(paths.ownerRecordFile, "utf8"));
      break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (missing && !existsSync(paths.lockDirectory)) {
        // Row P1 — no lock exists. A lock that is absent counts as free.
        return Object.freeze({
          lockExists: false,
          owner: null,
          ownerRecordReadable: false,
          refusal: null,
        });
      }
      if (attempt + 1 >= READ_ATTEMPTS) {
        return Object.freeze({
          lockExists: true,
          owner: null,
          ownerRecordReadable: false,
          refusal: `the owner record cannot be read: ${last}`,
        });
      }
    }
  }
  const validation = validateOwnerRecord(parsed);
  if (!validation.ok) {
    return Object.freeze({
      lockExists: true,
      owner: null,
      ownerRecordReadable: false,
      refusal: `${validation.refusal}: ${validation.message}`,
    });
  }
  return Object.freeze({
    lockExists: true,
    owner: validation.record as LockOwnerRecord,
    ownerRecordReadable: true,
    refusal: null,
  });
}

/**
 * Take every observation the table asks for, then let the table decide.
 * `providerFailed` is passed in by `acquire` and `reclaim`, which know when
 * one of their own steps failed; a probe on its own has not failed.
 */
export async function observe(
  place: LockPlace,
  dependencies: ProbeDependencies = {},
  providerFailed = false,
): Promise<{ readonly observed: ProbeObservations; readonly reading: LockReading }> {
  const reading = readLock(place);
  const io = dependencies.io ?? platformIo;
  const primitive = dependencies.primitive ?? processPrimitive;
  if (reading.owner === null) {
    return {
      observed: Object.freeze({
        lockExists: reading.lockExists,
        providerFailed,
        ownerRecordReadable: false,
        foreign: false,
        sameBoot: false,
        liveness: "unknown" as LivenessAnswer,
        anOpenOwnedEntryPassesTheIdentityCheck: false,
      }),
      reading,
    };
  }
  const owner = reading.owner;
  const comparison = compareWithThisProcess(owner, io, primitive);
  const liveness =
    dependencies.liveness !== undefined
      ? await dependencies.liveness(owner)
      : await livenessOfTheOwner(owner);
  const entries =
    dependencies.openOwnedEntries !== undefined
      ? dependencies.openOwnedEntries(owner)
      : openOwnedEntriesOf(place, owner);
  const anyLives = entries.some(
    (entry) =>
      entry.class === "owned" &&
      recordedProcessLives({ pid: entry.pid, startTimeMs: entry.startTimeMs }, io, primitive).alive,
  );
  return {
    observed: Object.freeze({
      lockExists: true,
      providerFailed,
      // A record that compares as `unknown` was read and is complete; what
      // could not be read is the PRESENT machine. That is row P7's case and
      // not row P2's, so `ownerRecordReadable` stays true here.
      ownerRecordReadable: true,
      foreign: comparison.foreign,
      sameBoot: comparison.sameBoot,
      liveness,
      anOpenOwnedEntryPassesTheIdentityCheck: anyLives,
    }),
    reading,
  };
}

/** The kernel's answer about the owner, through the endpoint it recorded. */
export async function livenessOfTheOwner(owner: LockOwnerRecord): Promise<LivenessAnswer> {
  const endpoint = owner[ENDPOINT_FIELD];
  if (typeof endpoint !== "string" || endpoint === "") return "unknown";
  return probeLiveness(endpoint);
}

/**
 * F122-FR-013, research D-5 — the open entries of class `owned` of the
 * process registry of the run that holds the lock. Entries of class
 * `adoptable` are skipped, which is F122-FR-017's *a process of class
 * `adoptable` MUST never cause this result*: the detached job of a yield
 * holds nothing of the lock.
 */
export function openOwnedEntriesOf(
  place: LockPlace,
  owner: LockOwnerRecord,
): readonly OwnedEntry[] {
  const runId = typeof owner.runId === "string" ? owner.runId : null;
  if (runId === null) return Object.freeze([]);
  const found: OwnedEntry[] = [];
  for (const file of registryFilesOf(place.controlRoot, runId)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // An entry that was closed is not open: `endedAt` is set when the
      // process ended (annex B, §B.10).
      if (entry["endedAt"] !== undefined && entry["endedAt"] !== null) continue;
      const kind = typeof entry["kind"] === "string" ? entry["kind"] : "";
      // A class the entry does not carry is derived from its kind, and an
      // unknown kind is `owned` (closed set 22), never `adoptable`: a process
      // this feature cannot name is never quietly let past the refusal.
      const declared = entry["class"];
      const cls: ProcessClass =
        declared === "adoptable" || declared === "owned"
          ? declared
          : kind === ""
            ? "owned"
            : classOfKind(kind as Parameters<typeof classOfKind>[0]);
      if (cls !== "owned") continue;
      const pid = typeof entry["pid"] === "number" ? entry["pid"] : Number.NaN;
      if (!Number.isInteger(pid)) continue;
      const start = entry["startTime"];
      const startTimeMs =
        typeof start === "string" && Number.isFinite(Number(start)) ? Number(start) : null;
      found.push(
        Object.freeze({
          procId: typeof entry["procId"] === "string" ? entry["procId"] : "",
          kind,
          class: cls,
          pid,
          startTimeMs,
        }),
      );
    }
  }
  return Object.freeze(found);
}

/** The registry files of a run: `run:<runId>:procs`, one file per writer. */
function registryFilesOf(controlRoot: string, runId: string): readonly string[] {
  const features = join(controlRoot, "features");
  const found: string[] = [];
  let slugs: string[];
  try {
    slugs = readdirSync(features);
  } catch {
    return Object.freeze([]);
  }
  for (const slug of slugs) {
    const directory = join(features, slug, "runs", runId, "procs");
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of names) if (name.endsWith(".jsonl")) found.push(join(directory, name));
  }
  return Object.freeze(found);
}

/** What a full probe answers: the decision, and what it was taken from. */
export type ProbeOutcome = ProbeDecision & {
  readonly observed: ProbeObservations;
  readonly reading: LockReading;
};

/** F122-FR-013 — probe the lock of a workspace. */
export async function probeLock(
  place: LockPlace,
  dependencies: ProbeDependencies = {},
  providerFailed = false,
): Promise<ProbeOutcome> {
  const { observed, reading } = await observe(place, dependencies, providerFailed);
  return Object.freeze({ ...probeResultFrom(observed), observed, reading });
}

/* ------------------------------------------------------------------ *
 * What a READER of the lock shows and asks (F122-FR-013).
 * ------------------------------------------------------------------ */

/**
 * C-113, B-1509, B-1510 — *in compatibility output a reader that shows the
 * owner of the lock MUST show the as-is owner line: the as-is run id of the
 * engine start, one space, and the time the lock was taken in ISO 8601 form*
 * (F122-FR-013).
 *
 * Two fields and one space. The as-is run id is the one the owner record
 * carries, which the acquire wrote from the engine start; where there is
 * none, there is no line to show rather than a line with a guess in it.
 */
export function asIsOwnerLine(owner: LockOwnerRecord | null): string | null {
  if (owner === null) return null;
  const runId = owner.asIsRunId;
  const takenAt = owner[ACQUIRED_AT_FIELD];
  if (typeof runId !== "string" || runId === "") return null;
  if (typeof takenAt !== "string" || takenAt === "") return null;
  return `${runId} ${takenAt}`;
}

/** The shape of the as-is owner line, for a reader that checks one. */
export const AS_IS_OWNER_LINE = /^\d{8}-\d{6}-\d+ \d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * C-115, B-1565 — *"a run is active in this workspace" MUST mean, for every
 * reader, that a probe counts as held* (F122-FR-013). Every reader asks this
 * one function, so no two readers can answer differently.
 */
export function aRunIsActive(result: ProbeResult): boolean {
  return countsAsHeld(result);
}

/** What `couldALauncherTakeTheLockNow` answers. */
export type LauncherQuestion = {
  readonly couldTakeIt: boolean;
  readonly probe: ProbeResult;
  readonly row: string;
  /** C-255, B-2760 — the question changes nothing. */
  readonly changedAnything: false;
};

/**
 * C-255, B-2760 — *could a launcher take the lock now?*, answered WITHOUT
 * changing anything.
 *
 * The launch check of the supervisor asks this before it starts anything,
 * and the as-is baseline answered it by trying to take the lock — which
 * changes the thing it is asking about, and leaves a lock behind when the
 * answer is yes. Here it is a probe: it opens no file for writing, creates
 * no endpoint and renames nothing, so asking it twice gives the same answer
 * and asking it at all costs the workspace nothing.
 */
export async function couldALauncherTakeTheLockNow(
  place: LockPlace,
  dependencies: ProbeDependencies = {},
): Promise<LauncherQuestion> {
  const outcome = await probeLock(place, dependencies);
  return Object.freeze({
    couldTakeIt: !countsAsHeld(outcome.result),
    probe: outcome.result,
    row: outcome.row,
    changedAnything: false as const,
  });
}
