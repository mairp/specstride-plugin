/**
 * T115 — the command `tripwire clear` (F115-FR-041).
 *
 * The command removes the tripwire record `user:tripwire` of the machine and
 * exits 0; it exits 1 when no record exists; it exits 3 on wrong usage (any
 * argument beyond the command name). The removal leaves the clear marker
 * that the NEXT engine start consumes as the event `tripwire.cleared`
 * (`consumeClearMarkersAtEngineStart` of
 * `@specstride/integrity`'s tripwire record) — the command itself writes no
 * event: the catalogue places `tripwire.cleared` in the engine start.
 *
 * This module is the command's logic and its exit-code mapping; the command
 * surface of `@specstride/cli` belongs to feature 119 and wires it.
 */

import { createTripwireStore, readTripwire } from "@specstride/integrity";

/** The exit codes of the command (F115-FR-041). */
export const EXIT_CODES = {
  /** The record existed and was removed. */
  cleared: 0,
  /** No record exists. */
  absent: 1,
  /** Wrong usage. */
  usage: 3,
} as const;
export type TripwireClearExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** The outcome of one run of the command. */
export type TripwireClearResult = {
  readonly exitCode: TripwireClearExitCode;
  /** What the command prints, in default output. */
  readonly message: string;
};

/** True only for an argv the command accepts: no argument at all. */
export function isUsageValid(argv: readonly string[]): boolean {
  return argv.length === 0;
}

/** The usage line the command prints on wrong usage. */
export const USAGE = "usage: specstride tripwire clear" as const;

/**
 * Run the command. `home` narrows the user-level state for the tests; the
 * command itself uses the machine's state (see the tripwire record).
 */
export async function runTripwireClear(
  argv: readonly string[],
  options: { home?: string } = {},
): Promise<TripwireClearResult> {
  if (!isUsageValid(argv)) {
    return {
      exitCode: EXIT_CODES.usage,
      message: USAGE,
    };
  }
  const store = createTripwireStore({ home: options.home });
  const state = await store.read();
  if (!state.breached && readTripwire(options.home).breaches.length === 0) {
    // No record exists: exit 1, nothing removed, no clear marker.
    return {
      exitCode: EXIT_CODES.absent,
      message: "tripwire: no record exists",
    };
  }
  await store.clear();
  return {
    exitCode: EXIT_CODES.cleared,
    message: "tripwire: record removed; the next engine start records tripwire.cleared",
  };
}
