/**
 * T114 — the tripwire record `user:tripwire` (F115-FR-041), the
 * implementation of the port `TripwireStore` of T003
 * (`packages/contracts/src/ports/layer-micro.ts`), in the edge package
 * `@specstride/integrity`: the layer itself never touches the file system.
 *
 * The record lives in the user-level state of the consumer who runs the
 * product — what "the machine" means here — at
 * `<SPECSTRIDE_HOME | $HOME/.specstride>/tripwire.json`. While the record
 * exists every launch on the machine runs with every loop layer off,
 * announced with the fallback reason `tripwire` (`launchFallbackFor`). The
 * writing and the removal go through the atomic write of the kernel
 * (`atomicWriteJson`, F100-FR-036): a crash leaves either the old record or
 * the new one, never a half record.
 *
 * `tripwire clear` removes the record. The event `tripwire.cleared` is
 * written in the NEXT engine start, not in the command: the command leaves a
 * clear marker (`<dir>/tripwire.cleared.pending`), and
 * `consumeClearMarkersAtEngineStart` hands the markers to the engine at its
 * next start and removes them.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { atomicWriteJson } from "@specstride/kernel";
import type { TripwireBreach, TripwireState, TripwireStore } from "@specstride/contracts";

/** The fallback reason of every launch while the record exists (F115-FR-041). */
export const TRIPWIRE_FALLBACK_REASON = "tripwire" as const;

/** The name of the tripwire record in the user-level state. */
export const TRIPWIRE_RECORD_NAME = "tripwire.json" as const;

/** The name of the marker a `tripwire clear` leaves for the next engine start. */
export const TRIPWIRE_CLEAR_MARKER_NAME = "tripwire.cleared.pending" as const;

/** The directory of the user-level state of the machine (F115-FR-041). */
export function tripwireDirectory(home?: string): string {
  const fromEnv = process.env["SPECSTRIDE_HOME"];
  const base =
    home ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".specstride"));
  return base;
}

/** The path of the tripwire record. */
export function tripwireRecordPath(home?: string): string {
  return join(tripwireDirectory(home), TRIPWIRE_RECORD_NAME);
}

/** The path of the clear marker of `tripwire clear`. */
export function tripwireClearMarkerPath(home?: string): string {
  return join(tripwireDirectory(home), TRIPWIRE_CLEAR_MARKER_NAME);
}

/** The state an absent record reads as (the port of T003). */
export const NOT_BREACHED: TripwireState = Object.freeze({
  breached: false,
  breaches: Object.freeze([]),
});

/** Read the record; an absent or unreadable record reads as not breached. */
export function readTripwire(home?: string): TripwireState {
  const path = tripwireRecordPath(home);
  if (!existsSync(path)) return NOT_BREACHED;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TripwireState>;
    return {
      breached: raw["breached"] === true,
      breaches: Array.isArray(raw["breaches"]) ? raw["breaches"] : [],
    };
  } catch {
    // A half record cannot survive the atomic write; a corrupt one is read
    // as not breached so that a broken file never blocks a launch silently
    // — the doctor check reports it instead.
    return NOT_BREACHED;
  }
}

/**
 * True while the record exists: every launch on the machine runs with every
 * loop layer off, announced with the fallback reason `tripwire`.
 */
export function launchFallbackFor(state: TripwireState): "tripwire" | undefined {
  return state.breached ? TRIPWIRE_FALLBACK_REASON : undefined;
}

/**
 * Create the store behind the port of T003. Every write goes through the
 * atomic write of the kernel; the directory is created on the first write.
 */
export function createTripwireStore(
  options: { home?: string; now?: () => string } = {},
): TripwireStore {
  const home = options.home;
  const now = options.now ?? (() => new Date().toISOString());
  const ensureDirectory = (): string => {
    const dir = tripwireDirectory(home);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    async read(): Promise<TripwireState> {
      return readTripwire(home);
    },
    async recordBreach(breach: TripwireBreach): Promise<void> {
      const dir = ensureDirectory();
      const current = readTripwire(home);
      const next: TripwireState = {
        breached: true,
        breaches: [...current.breaches, breach],
      };
      atomicWriteJson(join(dir, TRIPWIRE_RECORD_NAME), next);
    },
    async clear(): Promise<void> {
      const dir = ensureDirectory();
      const record = join(dir, TRIPWIRE_RECORD_NAME);
      if (existsSync(record)) rmSync(record);
      // The event `tripwire.cleared` is written in the next engine start:
      // leave the marker the start consumes.
      atomicWriteJson(join(dir, TRIPWIRE_CLEAR_MARKER_NAME), {
        clearedAt: now(),
      });
    },
  };
}

/** Append one breach with the observation time filled in. */
export async function recordBreach(
  store: TripwireStore,
  kind: string,
  ruleId: string,
  detail: string,
  now: () => string = () => new Date().toISOString(),
): Promise<TripwireBreach> {
  const breach: TripwireBreach = {
    kind,
    ruleId,
    detail,
    observedAt: now(),
  };
  await store.recordBreach(breach);
  return breach;
}

/**
 * The `tripwire.cleared` events of the next engine start (F115-FR-041): the
 * markers a `tripwire clear` left are handed to the engine, in the order
 * they were left, and removed. Each marker yields one event of the type
 * `tripwire.cleared` with its `clearedAt`.
 */
export function consumeClearMarkersAtEngineStart(home?: string): { clearedAt: string }[] {
  const marker = tripwireClearMarkerPath(home);
  if (!existsSync(marker)) return [];
  let clearedAt = new Date().toISOString();
  try {
    const raw = JSON.parse(readFileSync(marker, "utf8")) as { clearedAt?: string };
    if (typeof raw["clearedAt"] === "string") clearedAt = raw["clearedAt"];
  } catch {
    /* a marker that cannot be read still clears: the record is already gone */
  }
  rmSync(marker, { force: true });
  return [{ clearedAt }];
}

/** Write a marker directly (used by the tests to stage the engine-start path). */
export function stageClearMarkerForTest(home: string, clearedAt: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, TRIPWIRE_CLEAR_MARKER_NAME), JSON.stringify({ clearedAt }) + "\n");
}

/** The directory names this module writes into the user-level state. */
export const WRITTEN_NAMES = [TRIPWIRE_RECORD_NAME, TRIPWIRE_CLEAR_MARKER_NAME] as const;
