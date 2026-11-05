/**
 * T003 — the test frame of feature 127: the fakes of the five ports of
 * `../../src/quota/ports.ts`, and `testPorts()`, which builds the whole set at
 * once so that a characterization test of a later phase injects one object.
 *
 * `plan.md`, **Testing**: "a fake clock, a fake random source and a fake file
 * writer"; "Physical choices behind the specification" adds the fake sleep
 * (*Time*) and the jitter source (*Jitter*). Nothing here reads a clock, a
 * random source or the file system of the platform, so a test of a five-hour
 * pause takes microseconds and gives the same answer on every machine.
 */
import type { PolicyPorts } from "../../src/quota/ports.ts";
import { type FakeClock, type FakeClockOptions, fakeClock } from "./clock.ts";
import { type FakeFileWriter, fakeFileWriter } from "./file-writer.ts";
import { type FakeEventWriter, fakeEventWriter } from "./event-writer.ts";
import { type FixedRandom, fixedRandom } from "./random.ts";

export { DEFAULT_MONOTONIC_MS, DEFAULT_START_MS, fakeClock } from "./clock.ts";
export type { FakeClock, FakeClockOptions, SleepCall } from "./clock.ts";
export { UnreadableFile, fakeFileWriter } from "./file-writer.ts";
export type { FakeFileWriter, WriteCall } from "./file-writer.ts";
export { EVENT_TYPES, fakeEventWriter } from "./event-writer.ts";
export type { FakeEventWriter, PolicyEventType } from "./event-writer.ts";
export { fixedRandom } from "./random.ts";
export type { FixedRandom } from "./random.ts";

/** The whole frame: the five ports, each a fake a test can question. */
export type TestPorts = PolicyPorts & {
  readonly clock: FakeClock;
  readonly sleep: FakeClock;
  readonly random: FixedRandom;
  readonly fileWriter: FakeFileWriter;
  readonly eventWriter: FakeEventWriter;
};

/** How a test starts the frame. */
export type TestPortsOptions = FakeClockOptions & {
  /** The fractions the fixed random source hands out, in order; `[0]` by default. */
  readonly fractions?: readonly number[];
  /** Files the run already wrote, by path. */
  readonly files?: Readonly<Record<string, string>>;
  /** False to let the event writer take a type of another feature. */
  readonly strictEvents?: boolean;
};

/**
 * The five fakes as one set of ports. The clock and the sleep are the same
 * object, so the fake sleep moves the clock a test reads.
 */
export function testPorts(options: TestPortsOptions = {}): TestPorts {
  const clock = fakeClock({ startMs: options.startMs, monotonicMs: options.monotonicMs });
  return {
    clock,
    sleep: clock,
    random: fixedRandom(...(options.fractions ?? [0])),
    fileWriter: fakeFileWriter(options.files ?? {}),
    eventWriter: fakeEventWriter({ strict: options.strictEvents }),
  };
}
