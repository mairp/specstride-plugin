/**
 * T003 — the fake event writer of the test frame of feature 127 (`plan.md`,
 * **Testing**; F127-FR-040, which names the events this feature emits).
 *
 * A module of this feature emits through the `eventWriter` port
 * (`../../src/quota/ports.ts`) and never appends to a file. The fake keeps the
 * events in order and offers the three questions the tests of this feature ask:
 *
 *  - `types()`: the order of the events — US2 is proven by an event order
 *    (the `loud` alert precedes the first usage record on the key);
 *  - `of(type)`: every event of one type, for its payload;
 *  - `countOf(type)`: how many of a type, for the deduplication of an alert key
 *    (§Q.4: "A threshold fires once per window").
 *
 * The fake asserts nothing by itself. It also refuses an event type that is not
 * one of F127-FR-040, so that a typo in a module under test fails the test
 * instead of passing unnoticed.
 */
import type { EventWriter, PolicyEvent } from "../../src/quota/ports.ts";

/**
 * The event types F127-FR-040 names for this feature, and `usage` which the
 * ledger of F127-FR-031 counts and the rebuild of F127-FR-032 replays.
 */
export const EVENT_TYPES = [
  "quota.signal",
  "harness.error",
  "run.paused",
  "run.resumed",
  "fallback.switched",
  "fallback.restored",
  "fallback.skipped",
  "alert",
  "budget.exceeded",
  "blocked",
  "usage",
] as const;
export type PolicyEventType = (typeof EVENT_TYPES)[number];

/** A fake event writer over a list. */
export type FakeEventWriter = EventWriter & {
  /** Every event, in the order it was emitted. */
  readonly events: readonly PolicyEvent[];
  /** The types, in order. */
  types(): readonly string[];
  /** Every event of one type, in order. */
  of(type: string): readonly PolicyEvent[];
  /** How many events of one type. */
  countOf(type: string): number;
  /** Forget everything emitted so far; the ports stay the same. */
  clear(): void;
};

/**
 * A fake event writer.
 *
 * `strict` (the default) refuses a type that `EVENT_TYPES` does not hold. A
 * test that means to emit a type of another feature passes `{ strict: false }`
 * and says why.
 */
export function fakeEventWriter(options: { readonly strict?: boolean } = {}): FakeEventWriter {
  const strict = options.strict ?? true;
  const events: PolicyEvent[] = [];
  return {
    emit(event: PolicyEvent): void {
      if (strict && !(EVENT_TYPES as readonly string[]).includes(event.type)) {
        throw new Error(
          `not an event type of feature 127 (F127-FR-040): ${event.type}; ` +
            `the types are ${EVENT_TYPES.join(", ")}`,
        );
      }
      events.push(event);
    },
    events,
    types: () => events.map((event) => event.type),
    of: (type: string) => events.filter((event) => event.type === type),
    countOf: (type: string) => events.filter((event) => event.type === type).length,
    clear(): void {
      events.length = 0;
    },
  };
}
