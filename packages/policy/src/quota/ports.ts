/**
 * T002 — the injected ports that the modules of feature 127 take, so that
 * every rule of the feature has a fake-clock test (`plan.md`, "Physical
 * choices behind the specification": *Time*, *Jitter*, *Ledger write*).
 *
 * The package is `@specstride/policy` at layer L1. The package graph lets it
 * import `@specstride/contracts` and `@specstride/kernel` and nothing else
 * (`packages/contracts/data/package-graph.json`, LR-1), so a port that the
 * contracts package already declares is reused and never redeclared here:
 *
 *  - the clock is `Clock` of annex A §A.3 (`@specstride/contracts/ep/kernel-services`);
 *  - the file writer is `AtomicWrite` of the same section — the kernel's
 *    atomic write, which the ledger of `../budget/ledger.ts` writes through.
 *
 * Three ports the feature needs have no declaration there, and are declared
 * here: a sleep, a random source for the jitter of `resumeAt`
 * (F127-FR-013), and an event writer for the events of F127-FR-040.
 *
 * No module of this package reads a clock, a random source or the file system
 * of the platform: it receives these as arguments. `packages/policy/test/support/`
 * holds the fakes (T003).
 */
import type { AtomicWrite, Clock } from "@specstride/contracts/ep/kernel-services";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";

export type { AtomicWrite, Clock };

/** The names of the five ports, for a check over a composition root. */
export const PORTS = ["clock", "sleep", "random", "fileWriter", "eventWriter"] as const;
export type PortName = (typeof PORTS)[number];

/**
 * A sleep. The pause of F127-FR-010 waits through this port and never through
 * a timer of the platform, so that a test moves a fake clock forward past
 * `resumeAt` instead of waiting (`plan.md`, *Time*).
 */
export type Sleeper = {
  /** Wait for `ms` milliseconds. A negative or non-finite `ms` waits not at all. */
  sleep(ms: number): Promise<void>;
};

/**
 * The random source of the jitter of `resumeAt` (F127-FR-013: `resetsAt` plus
 * `pause.marginMs` plus a jitter of 0 to `pause.jitterMs`). A test fixes it
 * (`plan.md`, *Jitter*).
 */
export type RandomSource = {
  /** A fraction in `[0, 1)`. */
  fraction(): number;
};

/**
 * The event writer. The engine emits the events of F127-FR-040 through this
 * port; a module of this package never appends to a file itself. The envelope
 * is the one of annex X §X.1 (`specstride.event/1`); the writer of feature 111
 * gives `seq` and `ts`, so a caller here hands the type and the payload.
 */
export type EventWriter = {
  emit(event: PolicyEvent): void;
};

/** What a module of this feature hands the event writer. */
export type PolicyEvent = {
  /** The dotted event type, lower case: `run.paused`, `alert`, `budget.exceeded`, … */
  readonly type: string;
  /** The payload of the event, already redacted and cut (F127-FR-040). */
  readonly payload: Readonly<Record<string, unknown>>;
};

/**
 * The store of the pause record (`run:<runId>:pause`, annex B §B.17). It is
 * the kernel's atomic write with one addition this feature needs: the record
 * is REMOVED at the resume (F127-FR-013, "remove the pause record"), and
 * `AtomicWrite` of annex A §A.3 declares a write, a read and an existence
 * check but no removal. A composition root passes the kernel's atomic write
 * with its own `remove`; the fake of `packages/policy/test/support/` has one.
 */
export type PauseStore = AtomicWrite & {
  /** Remove the file. A path that holds nothing is not an error. */
  remove(path: string): void;
};

/** An envelope a reader of the event file sees; the writer of 111 completes it. */
export type WrittenEvent = EventEnvelope;

/** The whole of what a module of this feature receives (T002, T003). */
export type PolicyPorts = {
  readonly clock: Clock;
  readonly sleep: Sleeper;
  readonly random: RandomSource;
  readonly fileWriter: AtomicWrite;
  readonly eventWriter: EventWriter;
};
