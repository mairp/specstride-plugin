/**
 * T056 — the end of every `owned` process when the engine exits (F122-FR-026,
 * F122-SC-004).
 *
 * *When the engine exits, for any cause, the runtime root MUST end every live
 * process of class `owned` of that engine start, after the identity check,
 * before it relaunches and before it rests. The rule MUST hold with parallel
 * units on or off; with them on it MUST cover every worker pass.*
 *
 * Four words in that sentence do the work.
 *
 * **"for any cause".** The root does not ask how the engine died. The caller
 * hands in the cause only so that it reaches the records; no branch here
 * reads it.
 *
 * **"every live process".** Liveness is asked FIRST, through
 * `recordedProcessLives`, which sends no signal. A process that has already
 * gone is not signalled and not reported as a mismatch either: its entry is
 * closed with `gone`. Only a process that is there reaches the identity
 * check, and only a process that passes the identity check is signalled.
 *
 * **"of that engine start".** The filter is `engineStartId`, so the detached
 * job of an earlier start and the processes of a concurrent run are untouched
 * — and a process of class `adoptable` is never in the set at all, which is
 * F122-FR-028's *survives the end of the engine*.
 *
 * **"before it relaunches and before it rests".** That is an ORDER, and an
 * order kept by a comment is not kept. `relaunchOnlyAfterTheOwnedProcessesEnded`
 * takes the relaunch as a thunk and will not call it while a process of class
 * `owned` of that start is still there. The root has one way to relaunch and
 * it goes through that function.
 *
 * The ladder is the kernel's: polite, then terminate, then kill, with a wait
 * between the rounds. A process that ends at the polite signal is never sent
 * the next one, so the ladder costs nothing where a child behaves.
 */
import type { GroupSignal, Clock } from "@specstride/contracts/ep/kernel-services";
import type { ProcessRegistry } from "@specstride/contracts/records/process-registry";
import { systemClock } from "@specstride/kernel";
import {
  kernelSignaller,
  signalUnderTheIdentityCheck,
  type IdentityDependencies,
  type MismatchRecord,
  type Signaller,
} from "../procs/identity.ts";
import {
  closeEntry,
  readOpenOwnedEntriesOfEngineStart,
  startTimeMsOf,
  type ProcsPlace,
} from "../procs/registry.ts";
import { platformIo, recordedProcessLives, type PlatformIo } from "../procs/platform.ts";

/** The requirements this module carries. */
export const END_OWNED_REQUIREMENTS = ["F122-FR-026", "F122-SC-004"] as const;

/** F122-FR-026 — the rule holds with parallel units on or off. */
export const HOLDS_WITH_PARALLEL_UNITS = Object.freeze(["on", "off"]);

/** F122-FR-026 — with them on it covers every worker pass. */
export const COVERS_EVERY_WORKER_PASS = true as const;

/** F122-FR-026 — the two things that wait for this to finish. */
export const RUNS_BEFORE = Object.freeze(["a relaunch", "a rest"]);

/** The ladder of signals, from polite to final (F100-FR-234). */
export const LADDER: readonly GroupSignal[] = Object.freeze(["polite", "terminate", "kill"]);

/** How long the root waits for a round of the ladder to take effect. */
export const ROUND_WAIT_MS = 500 as const;

/** How often it looks at a process while it waits. */
export const POLL_MS = 20 as const;

/** What happened to one entry of class `owned`. */
export type OwnedOutcome = {
  readonly entry: ProcessRegistry;
  /** True where the process is gone when this call returns. */
  readonly ended: boolean;
  /** How many signals left this process for that entry. 0 on a mismatch. */
  readonly signalsSent: number;
  /** The last signal of the ladder that was sent, where one was. */
  readonly lastSignal: GroupSignal | null;
  /** The end cause the entry was closed with. */
  readonly endCause: string;
  readonly mismatch: MismatchRecord | null;
};

/** What the whole pass did. */
export type EndOwnedResult = {
  readonly outcomes: readonly OwnedOutcome[];
  readonly signalsSent: number;
  /** F122-SC-004 — true where no process of class `owned` of the start lives. */
  readonly noneLeft: boolean;
  readonly ended: readonly string[];
  readonly closedAsGone: readonly string[];
  readonly mismatches: readonly MismatchRecord[];
  /** The cause the caller gave for the end of the engine; nothing branches on it. */
  readonly engineEndCause: string;
};

/** What the pass reaches the machine and the clock through. */
export type EndOwnedDependencies = IdentityDependencies & {
  readonly io?: PlatformIo;
  readonly signaller?: Signaller;
  readonly writer?: string;
  readonly clock?: Clock;
  /** The wait between two rounds of the ladder; a test shortens it. */
  readonly roundWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * F122-FR-026 — end every live process of class `owned` of one engine start,
 * after the identity check.
 */
export async function endOwnedProcessesOfEngineStart(
  place: ProcsPlace,
  engineStartId: string,
  engineEndCause: string,
  dependencies: EndOwnedDependencies = {},
): Promise<EndOwnedResult> {
  const io = dependencies.io ?? platformIo;
  const signaller = dependencies.signaller ?? kernelSignaller;
  const writer = dependencies.writer ?? "runtime-root";
  const clock = dependencies.clock ?? systemClock;
  const roundWaitMs = dependencies.roundWaitMs ?? ROUND_WAIT_MS;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((d) => setTimeout(d, ms)));

  const entries = readOpenOwnedEntriesOfEngineStart(place, engineStartId);
  const outcomes: OwnedOutcome[] = [];
  const mismatches: MismatchRecord[] = [];
  const ended: string[] = [];
  const closedAsGone: string[] = [];
  let signalsSent = 0;

  for (const entry of entries) {
    const liveness = () =>
      recordedProcessLives({ pid: entry.pid, startTimeMs: startTimeMsOf(entry) }, io);

    // 1. Liveness first, and it sends nothing. A process that has gone is
    //    closed with `gone`; it is not a mismatch and it is not signalled.
    const first = liveness();
    if (!first.alive && first.reason !== "pid-reused") {
      closeEntry(place, writer, entry, "gone", clock);
      closedAsGone.push(entry.procId);
      outcomes.push(
        Object.freeze({
          entry,
          ended: true,
          signalsSent: 0,
          lastSignal: null,
          endCause: "gone",
          mismatch: null,
        }),
      );
      continue;
    }

    // 2. The ladder, each round under the identity check.
    let sent = 0;
    let last: GroupSignal | null = null;
    let mismatch: MismatchRecord | null = null;
    for (const signal of LADDER) {
      const guarded = signalUnderTheIdentityCheck(entry, signal, {
        ...dependencies,
        io,
        signaller,
      });
      if (guarded.outcome !== "signalled") {
        mismatch = guarded.record;
        break;
      }
      sent += guarded.signalsSent;
      last = signal;
      if (await goneWithin(liveness, roundWaitMs, sleep)) break;
    }
    signalsSent += sent;

    if (mismatch !== null) {
      mismatches.push(mismatch);
      closeEntry(place, writer, entry, "identity-mismatch", clock);
      outcomes.push(
        Object.freeze({
          entry,
          ended: false,
          signalsSent: 0,
          lastSignal: null,
          endCause: "identity-mismatch",
          mismatch,
        }),
      );
      continue;
    }

    const gone = !liveness().alive;
    const cause = gone ? "ended-by-the-root" : "still-alive";
    closeEntry(place, writer, entry, cause, clock);
    if (gone) ended.push(entry.procId);
    outcomes.push(
      Object.freeze({
        entry,
        ended: gone,
        signalsSent: sent,
        lastSignal: last,
        endCause: cause,
        mismatch: null,
      }),
    );
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    signalsSent,
    noneLeft: outcomes.every((one) => one.ended || one.endCause === "identity-mismatch"),
    ended: Object.freeze(ended),
    closedAsGone: Object.freeze(closedAsGone),
    mismatches: Object.freeze(mismatches),
    engineEndCause,
  });
}

/** Wait until the process is gone, or until the round's time is up. */
async function goneWithin(
  liveness: () => { readonly alive: boolean },
  waitMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (!liveness().alive) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
  }
}

/* ------------------------------------------------------------------ *
 * The order: before a relaunch and before a rest.
 * ------------------------------------------------------------------ */

/** Raised where a relaunch was asked for while an `owned` process still lives. */
export class OwnedProcessesStillLiveError extends Error {
  readonly procIds: readonly string[];

  constructor(procIds: readonly string[]) {
    super(
      `the runtime root may not relaunch or rest while ${procIds.length} process(es) of class ` +
        `\`owned\` of the engine start that just exited still live (F122-FR-026): ` +
        `${procIds.join(", ")}`,
    );
    this.name = "OwnedProcessesStillLiveError";
    this.procIds = Object.freeze([...procIds]);
  }
}

/**
 * F122-FR-026 — the order, kept by the code and not by a comment: end the
 * `owned` processes of the engine start, and only then do the next thing.
 *
 * `next` is the relaunch or the rest. It is NOT called where a process of
 * class `owned` of that start is still there after the ladder; the error
 * names them, so the root fails loudly rather than relaunching over a
 * survivor.
 */
export async function relaunchOnlyAfterTheOwnedProcessesEnded<T>(
  place: ProcsPlace,
  engineStartId: string,
  engineEndCause: string,
  next: (result: EndOwnedResult) => Promise<T> | T,
  dependencies: EndOwnedDependencies = {},
): Promise<T> {
  const result = await endOwnedProcessesOfEngineStart(
    place,
    engineStartId,
    engineEndCause,
    dependencies,
  );
  const left = result.outcomes.filter((one) => !one.ended && one.endCause !== "identity-mismatch");
  if (left.length > 0) throw new OwnedProcessesStillLiveError(left.map((one) => one.entry.procId));
  return next(result);
}
