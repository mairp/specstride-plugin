/**
 * T033 — the start of a run on a workspace: the lock is taken BEFORE anything
 * of the run is written, and a conflict becomes engine exit 5 with the as-is
 * line in compatibility output, or pipeline code 24 (F122-FR-011,
 * F122-FR-012, F122-FR-017, F122-FR-019, F122-FR-021; C-009, B-0119; C-012,
 * B-0192; C-013, B-0249).
 *
 * THE ORDER IS THE REQUIREMENT. F122-FR-012: *the lock MUST be acquired
 * before anything of the run is written: before the run record, before the
 * names `workspace:current:events` and `workspace:current:engine-log` resolve
 * to the new engine start, and before the run snapshot is written. A start
 * that loses the lock MUST leave the event file, the engine log and the run
 * snapshot of the live run untouched.* That is not a convention a caller is
 * asked to keep: `startRun` hands the caller a `RunWriter` that REFUSES every
 * write until the lock is held, so a caller that got the order wrong fails
 * loudly instead of trampling a live run's files (B-0249, C-013).
 *
 * TWO CODES, ONE CONFLICT. The same `conflict` of EP-13 becomes 5 or 24
 * depending on who asked: the engine in start mode `standalone` exits 5
 * (C-009, B-0119; the engine exit table of annex E §E.4) and the runtime root
 * of a pipeline exits 24 (the table of the launcher and the pipeline
 * runtime). An engine in start mode `child` never takes a lock at all
 * (F122-FR-018), so asking it to is a usage error and not a conflict.
 *
 * THE LINE IS PRINTED ONLY IN COMPATIBILITY OUTPUT. F122-FR-011 gives the
 * as-is text of a lost lock; §G.2 says compatibility output is where as-is
 * text goes. In default output the refusal is the product's own line, and the
 * as-is line is not printed at all.
 */
import process from "node:process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  LOGICAL_NAME as EVENTS_LOGICAL_NAME,
  MAJOR as EVENT_MAJOR,
  SCHEMA as EVENT_SCHEMA,
  SYNTHESIZED_FIELD,
  type EventEnvelope,
} from "@specstride/contracts/envelope/event";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import {
  CONFLICT_ENGINE_CODE,
  CONFLICT_PIPELINE_CODE,
  type ProbeResult,
} from "@specstride/contracts/ep/lock";
import { OUTPUT_MODES, type OutputMode } from "@specstride/contracts/grammar/output-modes";
import { componentNameOf } from "@specstride/contracts/profile/layout-old-side";
import type { Lease } from "@specstride/contracts/records/lease";
import type { OwnerRecord } from "@specstride/contracts/records/owner-record";
import {
  createDirectoryLock,
  readLease as readLeaseOfTheLock,
  SHIPPED_PROVIDER_ID,
  SHIPPED_PROVIDER_VERSION,
  type AcquireInput,
  type DirectoryLock,
} from "../lock/directory-lock.ts";
import { mintLeaseToken } from "../procs/run-token.ts";
import { DIRECTORY_MODE, FILE_MODE } from "./control-root.ts";
import { startHeartbeat, writeTheLease, type Heartbeat, type LeaseTimes } from "../lease/lease.ts";
import { LOCK_LOGICAL_NAME, lockPathsOf, type LockPlace } from "../lock/paths.ts";
import { type PlatformIo, platformIo } from "../procs/platform.ts";
import {
  MARKER_INTEGRITY_EVENT,
  checkTheMarkerAtLaunch,
  rewriteTheMarkerIfMissing,
  writeTheMarker,
  type MarkerCheck,
  type MarkerHeartbeat,
} from "./marker.ts";
import {
  countsAsHeld,
  openOwnedEntriesOf,
  type LockOwnerRecord,
  type OwnedEntry,
} from "../lock/probe.ts";
import {
  PROVIDER_MISMATCH,
  providerMismatchDetail,
  readWorkspaceRecordOf,
  recordTheProvider,
  recordedProviderOf,
  type ProviderIdentity,
} from "../lock/workspace-record.ts";
import {
  LAYOUT_VERSION_MAJOR_REFUSAL,
  checkLayoutVersionAtLaunch,
  type LayoutVersionCheck,
} from "./layout-version.ts";

/** The requirements this module carries. */
export const START_REQUIREMENTS = [
  "F122-FR-011",
  "F122-FR-012",
  "F122-FR-017",
  "F122-FR-019",
  "F122-FR-021",
] as const;

/** The two start modes of the engine (annex E, §E.2). */
export const START_MODES = ["standalone", "child"] as const;
export type StartMode = (typeof START_MODES)[number];

/** Who is starting: the engine on its own, or the runtime root of a pipeline. */
export const STARTERS = ["engine", "runtime-root"] as const;
export type Starter = (typeof STARTERS)[number];

/** F122-FR-018 — an engine in start mode `child` never takes a lock. */
export const A_CHILD_ENGINE_TAKES_A_LOCK = false as const;

/**
 * C-009, B-0119 — the engine exits 5; the runtime root of a pipeline exits
 * 24. Both numbers come from the EP-13 contract, which took them from the
 * exit-code tables, so this module writes neither of them out.
 */
export const CONFLICT_EXIT_CODES: Readonly<Record<Starter, number>> = Object.freeze({
  engine: CONFLICT_ENGINE_CODE,
  "runtime-root": CONFLICT_PIPELINE_CODE,
});

/** The exit code of the refusals that are not a conflict (the launch table). */
export const REFUSAL_EXIT_CODE = 4 as const;

/** The refusals of a start that this module writes (closed set 212). */
export const START_REFUSALS = [
  "lock-conflict",
  "foreign-owner",
  "owner-dead-group-alive",
  "lock-unknown",
  PROVIDER_MISMATCH,
] as const;
export type StartRefusal = (typeof START_REFUSALS)[number];

/**
 * The refusals a START OF THE ROOT reports. Closed set 212 is closed, and its
 * rule for an unknown value is `shown as text; the launch stays refused`
 * (contracts/closed-sets.json, row 212). `layout-version-major` of
 * `./layout-version.ts` (F122-FR-043) is such an unknown value: the launch
 * record carries it as text and the launch stays refused with exit 4.
 */
export const ROOT_REFUSALS = [...START_REFUSALS, LAYOUT_VERSION_MAJOR_REFUSAL] as const;
export type RootRefusal = (typeof ROOT_REFUSALS)[number];

/** The exit code of each refusal (`contracts/cli-state-commands.md`). */
export function exitCodeOfStartRefusal(refusal: StartRefusal, starter: Starter): number {
  switch (refusal) {
    case "lock-conflict":
      return CONFLICT_EXIT_CODES[starter];
    case "lock-unknown":
      return CONFLICT_PIPELINE_CODE;
    case "foreign-owner":
    case "owner-dead-group-alive":
    case PROVIDER_MISMATCH:
      return REFUSAL_EXIT_CODE;
  }
}

/* ------------------------------------------------------------------ *
 * The as-is line of a lost lock (F122-FR-011; C-012, B-0192).
 * ------------------------------------------------------------------ */

/**
 * F122-FR-011 — *the logical component name `engine`, a colon, and the text
 * `another run holds the lock on <workspace> (<lock>). Exiting.`*
 */
export const AS_IS_LOST_LOCK_TEMPLATE =
  "<component>: another run holds the lock on <workspace> (<lock>). Exiting." as const;

/** The as-is implementation file the component name of rule N-15 comes from. */
export const AS_IS_COMPONENT_FILE = "The engine script of the Specstride baseline" as const;

/**
 * The logical component name of the prefix (rule N-15). It is looked up in
 * the component-name table of annex X §X.8 rather than written out, so the
 * line this module prints and the line the oracle normalizes cannot drift.
 */
export const AS_IS_COMPONENT_NAME: string = componentNameOf(AS_IS_COMPONENT_FILE) ?? "engine";

/**
 * C-012, B-0192 — the as-is line, with the lock named by its logical name
 * (rule N-02: a message that names state names it by logical name) and the
 * prefix by its logical component name (rule N-15).
 */
export function asIsLostLockLine(workspace: string, lock: string = LOCK_LOGICAL_NAME): string {
  return AS_IS_LOST_LOCK_TEMPLATE.replace("<component>", AS_IS_COMPONENT_NAME)
    .replace("<workspace>", workspace)
    .replace("<lock>", lock);
}

/**
 * The same line after rules N-15 and N-02, which is the form the oracle
 * compares: the prefix is the logical component name, the workspace is the
 * root placeholder of the layout table, and the lock is `workspace:lock`.
 */
export function normalizedLostLockLine(): string {
  return asIsLostLockLine("<workspace>", LOCK_LOGICAL_NAME);
}

/** §G.2 — the as-is line is printed in compatibility output only. */
export function theAsIsLineIsPrintedIn(mode: OutputMode): boolean {
  return mode === "compat";
}

/* ------------------------------------------------------------------ *
 * The writer that refuses before the lock (F122-FR-012).
 * ------------------------------------------------------------------ */

/**
 * The names F122-FR-012 says must not resolve to the new engine start, and
 * the records it says must not be written, before the lock is held.
 */
export const WRITES_THAT_WAIT_FOR_THE_LOCK = [
  "run:<runId>:record",
  "run:<runId>:snapshot",
  "workspace:current:events",
  "workspace:current:engine-log",
] as const;

/** A write of the run was attempted before the lock was held. */
export class LockNotHeldError extends Error {
  readonly logicalName: string;
  constructor(logicalName: string) {
    super(
      `\`${logicalName}\` was written before \`${LOCK_LOGICAL_NAME}\` was held; the lock is ` +
        `acquired before anything of the run is written, and a start that loses it leaves the ` +
        `event file, the engine log and the run snapshot of the live run untouched ` +
        `(F122-FR-012)`,
    );
    this.name = "LockNotHeldError";
    this.logicalName = logicalName;
  }
}

/** What a caller writes the run through. */
export type RunWriter = {
  /** True once the lock is held. */
  readonly mayWrite: boolean;
  /** The names this writer has let through, in order. */
  readonly written: readonly string[];
  /** Write something of the run; refused until the lock is held. */
  write<T>(logicalName: string, perform: () => T): T;
};

/** Build the writer. It refuses every write until `allow()` is called. */
export function createRunWriter(): RunWriter & { allow(): void } {
  let allowed = false;
  const written: string[] = [];
  return {
    get mayWrite(): boolean {
      return allowed;
    },
    get written(): readonly string[] {
      return Object.freeze([...written]);
    },
    write<T>(logicalName: string, perform: () => T): T {
      if (!allowed) throw new LockNotHeldError(logicalName);
      written.push(logicalName);
      return perform();
    },
    allow(): void {
      allowed = true;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The start itself.
 * ------------------------------------------------------------------ */

/** What a start is given. */
export type StartInput = {
  readonly place: LockPlace;
  readonly starter: Starter;
  readonly startMode: StartMode;
  /** §G.2 — which output mode the start prints in. */
  readonly outputMode?: OutputMode | undefined;
  readonly owner: OwnerRecord;
  readonly acquire: AcquireInput;
  /** The provider the configuration names (`runtime.lock.provider`). */
  readonly configuredProvider?: ProviderIdentity | undefined;
  /** The provider to use; the shipped one over this place where none is given. */
  readonly provider?: DirectoryLock | undefined;
  /** Everything of the run, written only after the lock is held. */
  readonly writeTheRun?: ((writer: RunWriter) => void) | undefined;
  readonly productVersion?: string | undefined;
  readonly now?: (() => Date) | undefined;
};

/** What a start answers. */
export type StartOutcome =
  | {
      readonly started: true;
      readonly lease: Lease;
      readonly exit: 0;
      readonly provider: DirectoryLock;
      readonly stderr: string;
      readonly wroteTheRun: boolean;
    }
  | {
      readonly started: false;
      readonly refusal: StartRefusal;
      readonly exit: number;
      /** F122-FR-011 — the as-is line, in compatibility output only. */
      readonly stderr: string;
      readonly detail: string;
      /** The probe that led here, where one was taken. */
      readonly probe?: ProbeResult;
      /** F122-FR-017 — the survivors, named. */
      readonly survivors: readonly OwnedEntry[];
      /** F122-FR-012 — nothing of the run was written. */
      readonly wroteTheRun: false;
    };

/**
 * Start a run on a workspace. The lock first, everything else after.
 *
 * The steps, in the order F122-FR-012 fixes them:
 *
 *   1. the configured provider against the recorded one — a READ, so a
 *      refusal here writes nothing either (F122-FR-019);
 *   2. `acquire` — the one step that excludes;
 *   3. where it failed, the probe, so that the refusal can say WHICH of the
 *      four it is and name the survivors (F122-FR-017) or the foreign owner
 *      (F122-FR-016);
 *   4. only now: the provider is recorded, and the caller's own writes are
 *      let through.
 */
export async function startRun(input: StartInput): Promise<StartOutcome> {
  const mode = input.outputMode ?? "default";
  const starter = input.starter;
  const configured = input.configuredProvider ?? {
    id: SHIPPED_PROVIDER_ID,
    version: SHIPPED_PROVIDER_VERSION,
  };
  const writer = createRunWriter();

  // 1 — the provider. A read; nothing of the run is written on this path.
  const recorded = readWorkspaceRecordOf(input.place);
  if (recorded.present) {
    const its = recordedProviderOf(recorded.record);
    if (its.id !== configured.id) {
      return refused(
        PROVIDER_MISMATCH,
        starter,
        mode,
        input.place,
        providerMismatchDetail(its, configured),
        undefined,
        [],
      );
    }
  }

  // 2 — the lock, before anything of the run.
  const provider =
    input.provider ??
    createDirectoryLock({
      place: input.place,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  const acquired = await provider.acquireHere(input.owner, input.acquire);
  if (!acquired.acquired) {
    // 3 — which refusal is it? The probe says, and the probe is taken only
    // now: a probe before the acquire would be a reading that the acquire
    // then contradicts, and the acquire is the one that excludes.
    const outcome = await provider.probeHere();
    const refusal = refusalOf(outcome.result, acquired.error === "unknown");
    const survivors =
      outcome.result === "owner-dead-group-alive" ? survivorsOf(input.place, outcome) : [];
    return refused(refusal, starter, mode, input.place, acquired.detail, outcome.result, survivors);
  }

  // 4 — the lock is held. The provider is recorded at the FIRST acquire
  // (F122-FR-019), and only now may anything of the run be written.
  recordTheProvider(
    input.place,
    configured,
    input.productVersion ?? "0.0.0",
    input.now ?? ((): Date => new Date()),
  );
  writer.allow();
  let wrote = false;
  if (input.writeTheRun !== undefined) {
    input.writeTheRun(writer);
    wrote = writer.written.length > 0;
  }
  return Object.freeze({
    started: true as const,
    lease: acquired.lease,
    exit: 0 as const,
    provider,
    stderr: "",
    wroteTheRun: wrote,
  });
}

/** Which refusal a probe result leads to (the launch table of this feature). */
export function refusalOf(result: ProbeResult, providerFailed: boolean): StartRefusal {
  if (providerFailed && result !== "held-live") return "lock-unknown";
  switch (result) {
    case "held-foreign":
      return "foreign-owner";
    case "owner-dead-group-alive":
      return "owner-dead-group-alive";
    case "unknown":
      return "lock-unknown";
    default:
      // `held-live`, and anything the table does not single out, is the
      // ordinary conflict: another run holds the lock.
      return "lock-conflict";
  }
}

/** F122-FR-017 — the survivors, each with its kind and its process id. */
function survivorsOf(
  place: LockPlace,
  outcome: { readonly reading: { readonly owner: LockOwnerRecord | null } },
): readonly OwnedEntry[] {
  const owner = outcome.reading.owner;
  if (owner === null) return Object.freeze([]);
  // The reader lives in the probe, so that the refusal and the probe can
  // never disagree about who is alive.
  return openOwnedEntriesOf(place, owner);
}

/** Build the refusal, with the as-is line where the mode asks for it. */
function refused(
  refusal: StartRefusal,
  starter: Starter,
  mode: OutputMode,
  place: LockPlace,
  detail: string,
  probe: ProbeResult | undefined,
  survivors: readonly OwnedEntry[],
): StartOutcome {
  const line = theAsIsLineIsPrintedIn(mode)
    ? asIsLostLockLine(place.workspaceRealPath, lockPathsOf(place).lockDirectory) + "\n"
    : "";
  return Object.freeze({
    started: false as const,
    refusal,
    exit: exitCodeOfStartRefusal(refusal, starter),
    stderr: line,
    detail: survivors.length === 0 ? detail : `${detail}; ${survivorLine(survivors)}`,
    ...(probe === undefined ? {} : { probe }),
    survivors: Object.freeze([...survivors]),
    wroteTheRun: false as const,
  });
}

/** F122-FR-017 — every surviving process with its kind and its process id. */
export function survivorLine(survivors: readonly OwnedEntry[]): string {
  return (
    `the owner is dead and ${survivors.length} process(es) it owned live: ` +
    survivors.map((s) => `${s.kind === "" ? "unknown" : s.kind} pid ${s.pid}`).join(", ") +
    ` (F122-FR-017)`
  );
}

/** F122-FR-013 — whether a reader must treat the workspace as active. */
export function aRunIsActiveIn(result: ProbeResult): boolean {
  return countsAsHeld(result);
}

/** The output modes, re-exported so a caller need not reach past this module. */
export { OUTPUT_MODES };
export type { OutputMode };

/** Write the as-is line where the mode asks for it; nothing otherwise. */
export function printAsIsLine(outcome: StartOutcome, stream = process.stderr): void {
  if (!outcome.started && outcome.stderr !== "") stream.write(outcome.stderr);
}

/* ------------------------------------------------------------------ *
 * T046 — step 3 of the handshake: the start of the runtime root.
 * ------------------------------------------------------------------ */

/**
 * Step 3 of §F.3 is one actor and one sentence: *the runtime root takes the
 * workspace lock; writes the lease with the launch nonce; emits
 * `run.launched`*. `startRun` above is the lock half of it, written by T033 for
 * the user story of one run per workspace. What follows is the rest of the
 * step, and the one thing F122-FR-031 puts before all of it:
 *
 *   0. where the predecessor of this workspace is DEAD, reclaim its lock and,
 *      **as the first writer of the event file, write the closing event of the
 *      dead launch, `run.ended` marked as synthesized, before any other
 *      event**. First means first: before the lease, before `run.launched`.
 *      A reader that met `run.launched` of this launch before the closing
 *      event of the last one would see two runs open at once, and `unclosed`
 *      of the event envelope would report the dead one for ever.
 *   1. the lock (`startRun`, or `reclaim` where the owner is gone);
 *   2. the lease with the launch nonce (`../lease/lease.ts`);
 *   3. `run.launched`;
 *   4. the advisory marker (F122-FR-038).
 *
 * The end of the root is `./end.ts`, and the two are written together on
 * purpose: every resource this function takes is released there, on every exit
 * path.
 */

/** F122-FR-031 — the event that closes a run, and the one that opens it. */
export const RUN_LAUNCHED = "run.launched" as const;
export const RUN_ENDED = "run.ended" as const;

/** The pairing a reader uses to find an unclosed run (F100-FR-200). */
export const RUN_EVENT_PAIR: Readonly<Record<string, string>> = Object.freeze({
  [RUN_LAUNCHED]: RUN_ENDED,
});

/** F122-FR-031 — nothing of this feature relaunches a run by itself. */
export const RELAUNCHES_BY_ITSELF = false as const;

/** F122-FR-031 — `dead` is derived by readers and written by no process. */
export const DEAD_IS_WRITTEN_BY_A_PROCESS = false as const;

/** Which run, and where its control plane is. */
export type RootPlace = {
  readonly place: LockPlace;
  readonly slug: string;
  readonly runId: string;
};

/** The path of `run:<runId>:events` (annex B, §B.5). */
export function eventsPathOf(where: RootPlace): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: where.place.workspaceRealPath,
    workspaceId: "",
    controlRoot: where.place.controlRoot,
    workerRoot: "",
  });
  return resolve(EVENTS_LOGICAL_NAME, { "<slug>": where.slug, "<runId>": where.runId }, roots);
}

/** How many events the stream of a run already holds; the next `seq` follows. */
export function eventCountOf(where: RootPlace): number {
  let text: string;
  try {
    text = readFileSync(eventsPathOf(where), "utf8");
  } catch {
    return 0;
  }
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/** What an event of this module carries beyond the envelope's own fields. */
export type AppendEventInput = {
  readonly where: RootPlace;
  readonly type: string;
  readonly launchId: string;
  readonly data?: Record<string, unknown> | undefined;
  /** F100-FR-200 — set on an event a later writer wrote for a dead process. */
  readonly synthesized?: boolean | undefined;
  readonly now?: (() => Date) | undefined;
};

/**
 * Append one event to `run:<runId>:events`. `seq` is *given by the one writer
 * at the append* (annex X §X.1), so it is read from the stream itself and not
 * kept in this process: a root that took over from a dead predecessor
 * continues that predecessor's numbering, without a gap.
 *
 * The append is a single `appendFileSync` of one line that ends in a newline,
 * which is what makes a torn last line impossible for a reader that arrives
 * between two appends.
 */
export function appendEvent(input: AppendEventInput): EventEnvelope {
  const path = eventsPathOf(input.where);
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  const at = (input.now ?? ((): Date => new Date()))();
  const event = Object.freeze({
    schema: EVENT_SCHEMA,
    v: EVENT_MAJOR,
    seq: eventCountOf(input.where) + 1,
    ts: at.toISOString(),
    type: input.type,
    runId: input.where.runId,
    launchId: input.launchId,
    ...(input.synthesized === true ? { [SYNTHESIZED_FIELD]: true } : {}),
    data: input.data ?? {},
  }) as unknown as EventEnvelope;
  appendFileSync(path, JSON.stringify(event) + "\n", { mode: FILE_MODE });
  return event;
}

/** Every event of a run, as a reader reads them back. */
export function readEvents(where: RootPlace): readonly EventEnvelope[] {
  let text: string;
  try {
    text = readFileSync(eventsPathOf(where), "utf8");
  } catch {
    return Object.freeze([]);
  }
  const out: EventEnvelope[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as EventEnvelope);
    } catch {
      // A torn last line is tolerated (F100-FR-199).
    }
  }
  return Object.freeze(out);
}

/** What the root brings to step 3. */
export type RootStartInput = {
  readonly where: RootPlace;
  readonly launchId: string;
  readonly launchNonce: string;
  readonly owner: OwnerRecord;
  /** The provider the configuration names, and the one to use. */
  readonly configuredProvider?: ProviderIdentity | undefined;
  readonly provider?: DirectoryLock | undefined;
  readonly times?: Partial<LeaseTimes> | undefined;
  readonly productVersion?: string | undefined;
  readonly now?: (() => Date) | undefined;
  /** The run's state, for the line the CLI prints (`cli-state-commands.md`). */
  readonly runState?: string | undefined;
  /**
   * F122-FR-038 — the check of the advisory marker at a launch. On by
   * default; a caller that has already made it (a relaunch inside one root)
   * may say so. It is never a way to skip it silently: the outcome records
   * `markerCheck`, so a reader sees whether it was made.
   */
  readonly checkTheMarker?: boolean | undefined;
  /** The readers the marker check uses; a test hands in its own. */
  readonly markerIo?: PlatformIo | undefined;
};

/** A predecessor whose root died, as step 0 found it. */
export type DeadPredecessor = {
  readonly launchId: string;
  readonly runId: string;
  readonly probe: ProbeResult;
};

/** What step 3 answers. */
export type RootStartOutcome =
  | {
      readonly started: true;
      readonly lease: Lease;
      readonly leasePath: string;
      readonly provider: DirectoryLock;
      readonly heartbeat: Heartbeat;
      readonly launched: EventEnvelope;
      /** F122-FR-031 — the closing event written for a dead predecessor. */
      readonly closedThePredecessor: EventEnvelope | null;
      readonly predecessor: DeadPredecessor | null;
      readonly reclaimed: boolean;
      readonly markerPath: string;
      /** F122-FR-043 — what the reading of the layout version answered. */
      readonly layoutCheck: LayoutVersionCheck;
      /** F122-FR-038 — what the check of the marker at this launch answered. */
      readonly markerCheck: MarkerCheck | null;
      /**
       * F122-FR-038 — every heartbeat at which the marker was missing and was
       * written again, with the integrity event that was raised for it.
       */
      readonly markerRewrites: readonly MarkerHeartbeat[];
      readonly exit: 0;
    }
  | {
      readonly started: false;
      readonly refusal: RootRefusal;
      readonly exit: number;
      readonly detail: string;
      readonly probe?: ProbeResult;
      readonly survivors: readonly OwnedEntry[];
      readonly stderr: string;
      /** F122-FR-038 — set where the marker is what refused the launch. */
      readonly markerCheck?: MarkerCheck | undefined;
      /** F122-FR-043 — set where the layout version refused the launch. */
      readonly layoutCheck?: LayoutVersionCheck | undefined;
    };

/**
 * F122-FR-031 — the dead predecessor of this workspace, where there is one.
 *
 * `stale-owner-dead` is the probe result that says the owner of the lock is
 * gone and nothing it owned is left; `owner-dead-group-alive` says the owner is
 * gone and something it owned IS left, and that is NOT reclaimed here — the
 * survivors must end first, and the refusal names them (F122-FR-017). So only
 * the first is a predecessor this launch may close.
 */
export function deadPredecessorOf(place: LockPlace, probe: ProbeResult): DeadPredecessor | null {
  if (probe !== "stale-owner-dead") return null;
  const paths = lockPathsOf(place);
  const lease = readLeaseOfTheLock(paths);
  if (lease === null) return null;
  return Object.freeze({
    launchId: String(lease.launchId),
    runId: String(lease.runId),
    probe,
  });
}

/**
 * T046 — step 3 of the handshake, and the step F122-FR-031 puts before it.
 */
export async function startTheRoot(input: RootStartInput): Promise<RootStartOutcome> {
  const place = input.where.place;
  const now = input.now ?? ((): Date => new Date());
  const acquire: AcquireInput = {
    runId: input.where.runId,
    launchId: input.launchId,
    launchNonce: input.launchNonce,
    ...(input.times?.heartbeatEverySeconds === undefined
      ? {}
      : { heartbeatEverySeconds: input.times.heartbeatEverySeconds }),
    ...(input.times?.graceSeconds === undefined ? {} : { graceSeconds: input.times.graceSeconds }),
  };

  // 0a — F122-FR-038, the advisory marker. It is checked BEFORE the lock,
  // because its one decision is a refusal and a refusal must not leave a lock
  // behind. A marker whose owner cannot be probed refuses with
  // `foreign-owner`; no marker, an unreadable marker, a live owner and a
  // provably dead owner all refuse nothing — the lock decides those.
  const markerCheck =
    input.checkTheMarker === false
      ? null
      : checkTheMarkerAtLaunch(place, input.markerIo ?? platformIo);
  if (markerCheck !== null && markerCheck.refuse) {
    return Object.freeze({
      started: false as const,
      refusal: markerCheck.refusal as StartRefusal,
      exit: exitCodeOfStartRefusal(markerCheck.refusal as StartRefusal, "runtime-root"),
      detail: `${MARKER_LOGICAL_NAME_IN_A_REFUSAL}: ${markerCheck.because} (${markerCheck.path})`,
      survivors: Object.freeze([]),
      stderr: "",
      markerCheck,
    });
  }

  // 1 — the lock, through the module that already owns the order of F122-FR-012.
  let outcome = await startRun({
    place,
    starter: "runtime-root",
    startMode: "standalone",
    owner: input.owner,
    acquire,
    ...(input.configuredProvider === undefined
      ? {}
      : { configuredProvider: input.configuredProvider }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.productVersion === undefined ? {} : { productVersion: input.productVersion }),
    now,
  });

  // 0 — a dead predecessor. The lock was in conflict and the probe says its
  // owner is gone: reclaim it, and remember whose launch it was so that its
  // closing event is written before anything else.
  let predecessor: DeadPredecessor | null = null;
  let reclaimed = false;
  if (!outcome.started && outcome.probe === "stale-owner-dead") {
    predecessor = deadPredecessorOf(place, outcome.probe);
    const provider = input.provider ?? createDirectoryLock({ place, now });
    const taken = await provider.reclaimHere(input.owner, acquire);
    if (!taken.reclaimed) {
      return Object.freeze({
        started: false as const,
        refusal: refusalOf(outcome.probe, taken.error === "unknown"),
        exit: exitCodeOfStartRefusal(
          refusalOf(outcome.probe, taken.error === "unknown"),
          "runtime-root",
        ),
        detail: taken.detail,
        probe: outcome.probe,
        survivors: [] as readonly OwnedEntry[],
        stderr: "",
      });
    }
    reclaimed = true;
    recordTheProvider(
      place,
      input.configuredProvider ?? { id: SHIPPED_PROVIDER_ID, version: SHIPPED_PROVIDER_VERSION },
      input.productVersion ?? "0.0.0",
      now,
    );
    outcome = Object.freeze({
      started: true as const,
      lease: taken.lease,
      exit: 0 as const,
      provider,
      stderr: "",
      wroteTheRun: false,
    });
  }

  if (!outcome.started) {
    return Object.freeze({
      started: false as const,
      refusal: outcome.refusal,
      exit: outcome.exit,
      detail: outcome.detail,
      ...(outcome.probe === undefined ? {} : { probe: outcome.probe }),
      survivors: outcome.survivors,
      stderr: outcome.stderr,
    });
  }

  // 2a — F122-FR-043, the layout version file. The lock is held and the
  // marker is not yet written, which is exactly the window the requirement
  // names: the file is read here, a missing one is written again, and a file
  // of another major refuses the launch — releasing the lock first, because
  // this exit path controls it (F122-FR-020).
  const workspaceRecordReading = readWorkspaceRecordOf(place);
  const layoutCheck = checkLayoutVersionAtLaunch(
    place,
    workspaceRecordReading.present ? workspaceRecordReading.record : null,
  );
  if (layoutCheck.refuse) {
    await outcome.provider.release(outcome.lease);
    return Object.freeze({
      started: false as const,
      refusal: layoutCheck.refusal as RootRefusal,
      exit: layoutCheck.exit,
      detail: layoutCheck.detail,
      survivors: Object.freeze([]) as readonly OwnedEntry[],
      stderr: "",
      layoutCheck,
    });
  }

  // F122-FR-031 — the closing event of the dead launch, FIRST.
  let closed: EventEnvelope | null = null;
  if (predecessor !== null) {
    closed = appendEvent({
      where: { ...input.where, runId: predecessor.runId },
      type: RUN_ENDED,
      launchId: predecessor.launchId,
      synthesized: true,
      data: {
        cause: "crash",
        because: "the runtime root of this launch died and wrote no closing event",
        probe: predecessor.probe,
        closedBy: input.launchId,
      },
      now,
    });
  }

  // 2 — the lease with the launch nonce, at `run:<runId>:lease`.
  const leaseToken = mintLeaseToken();
  const written = writeTheLease({
    where: input.where,
    launchId: input.launchId,
    launchNonce: input.launchNonce,
    owner: input.owner,
    lockProvider: outcome.provider.id,
    leaseTokenHash: leaseToken.hash,
    ...(input.times === undefined ? {} : { times: input.times }),
    now,
  });

  // 3 — `run.launched`.
  const launched = appendEvent({
    where: input.where,
    type: RUN_LAUNCHED,
    launchId: input.launchId,
    data: {
      launchNonce: input.launchNonce,
      lockProvider: outcome.provider.id,
      reclaimed,
      ...(predecessor === null ? {} : { closedThePredecessor: predecessor.launchId }),
    },
    now,
  });

  // 4 — the advisory marker (F122-FR-038). Advisory: it is a convenience for a
  // reader and never what the product decides on; the lock decides.
  const markerPath = writeTheAdvisoryMarker(place, input.owner, input.launchId, now);

  // The heartbeat starts last, so that nothing beats on a lease that is not
  // yet complete. F122-FR-038 — *when the marker is missing while the run
  // lives, the runtime root MUST write it again and an integrity event MUST be
  // raised*: the heartbeat is the boundary at which the root notices, so the
  // rewrite rides on it and the event goes into the stream of the run through
  // the one writer of that stream.
  const markerRewrites: MarkerHeartbeat[] = [];
  const heartbeat = startHeartbeat(input.where, {
    now,
    onBeat: (): void => {
      const one = rewriteTheMarkerIfMissing(place, input.owner, input.launchId, now);
      if (!one.rewritten || one.integrityEvent === null) return;
      markerRewrites.push(one);
      appendEvent({
        where: input.where,
        type: one.integrityEvent.type,
        launchId: input.launchId,
        data: one.integrityEvent.data,
        now,
      });
    },
  });

  return Object.freeze({
    started: true as const,
    lease: written.lease,
    leasePath: written.path,
    provider: outcome.provider,
    heartbeat,
    launched,
    closedThePredecessor: closed,
    predecessor,
    reclaimed,
    markerPath,
    markerCheck,
    layoutCheck,
    markerRewrites,
    exit: 0 as const,
  });
}

/**
 * F122-FR-038 — the advisory marker. It holds the owner record, which is what
 * §B.9 says the marker is part of, and it is rewritten wherever it is missing:
 * writing it is idempotent, so the root may call this at any boundary.
 */
export function writeTheAdvisoryMarker(
  place: LockPlace,
  owner: OwnerRecord,
  launchId: string,
  now: () => Date = () => new Date(),
): string {
  // T066 — the marker is owned by `root/marker.ts`. This function stays as the
  // name step 3 of the handshake calls, and forwards: there is ONE writer of
  // `workspace:active`, so the write at the start, the write again at a
  // heartbeat and the removal at the end cannot drift apart.
  return writeTheMarker(place, owner, launchId, now);
}

/**
 * F122-FR-038 — the marker is advisory: nothing is decided on it beyond the
 * one refusal of `root/marker.ts`. The constant is DECLARED there, with the
 * complete list of what the marker decides, and re-exported here so that the
 * two modules cannot come to disagree about it.
 */
export { THE_MARKER_IS_ADVISORY, MARKER_DECIDES, markerDecides } from "./marker.ts";

/**
 * The logical name a refusal of the marker names, so that the message of
 * `foreign-owner` says WHICH of the two things that can cause it did
 * (the probe of the lock, or the marker). F122-FR-038's refusal and
 * F122-FR-013's are the same word with two causes, and a consumer reading the
 * message needs to know which one they are looking at.
 */
export const MARKER_LOGICAL_NAME_IN_A_REFUSAL = "workspace:active" as const;

/** F122-FR-038 — the integrity event the heartbeat raises; re-exported here. */
export { MARKER_INTEGRITY_EVENT };
