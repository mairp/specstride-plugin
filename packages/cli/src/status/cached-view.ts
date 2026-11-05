/**
 * T025 — the reader's half of the cached view (F129-FR-008).
 *
 * The runtime writes `run:<runId>:view` with `renderView` of
 * `@specstride/view`. This module is the READER. It holds the two rules that
 * need the file — the cursor must match the event file, and a cached view older
 * than the newest event of that file is ignored — and it takes the PURE rules of
 * the read model as a function, so that the same rule is applied here and in
 * `project` and no rule is written twice.
 *
 * The pure rule is a parameter and not an import because the import-boundary
 * check of feature 100 refuses an import between two packages of layer L6 that
 * the `mayImport` of the graph does not name explicitly, and the entry of
 * `@specstride/cli` carries the prose "every package above"
 * (`packages/contracts/data/package-graph.json`; the entry of
 * `@specstride/doctor` names `@specstride/view` and the entry of
 * `@specstride/cli` does not). The request to feature 100 is open; see
 * `specs/129-run-view-and-status/contracts/README.md`, "Requests to feature 100".
 *
 * Deleting the cached view loses nothing: every refusal here ends in a
 * projection from the first event, and no run depends on it (F129-FR-008).
 */
import { readFileSync } from "node:fs";
import { eventFileBytes, readEvents } from "./event-reader.ts";

/** Why a cached view may not be used (F129-FR-008); the set of the read model. */
export type CacheRefusal =
  | "no-cache"
  | "not-a-record"
  | "different-major"
  | "another-run"
  | "cursor-does-not-match"
  | "older-than-the-newest-event";

/** What a reader decided about a cached view. */
export type CacheDecision =
  | { readonly usable: true; readonly view: unknown }
  | { readonly usable: false; readonly refusal: CacheRefusal };

/** The pure validity rules of the read model, as the reader is given them. */
export type CacheRuleInput = {
  readonly cached: unknown;
  readonly runId: string | null;
  readonly eventFileBytes: number | null;
  readonly nextSeq: number | null;
  readonly newestEventAt: string | null;
};
export type CacheRule = (input: CacheRuleInput) => CacheDecision;

/** Read the cached view as a value, or null where it is absent or unreadable. */
export function readCachedView(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The byte offset the cursor of a cached view names, or null. */
export function cursorOffsetOf(cached: unknown): number | null {
  if (typeof cached !== "object" || cached === null) return null;
  const cursor = (cached as { cursor?: unknown }).cursor;
  if (typeof cursor !== "object" || cursor === null) return null;
  const offset = (cursor as { offset?: unknown }).offset;
  return typeof offset === "number" && Number.isInteger(offset) && offset >= 0 ? offset : null;
}

/** What the reader read off the two files, before the pure rule is applied. */
export type CacheReading = {
  readonly cached: unknown;
  readonly eventFileBytes: number | null;
  readonly nextSeq: number | null;
  readonly newestEventAt: string | null;
};

/**
 * Read the cached view and the facts of the event file the pure rule needs. The
 * event file is opened by the ONE reader of F129-FR-032 and by nothing else.
 */
export function readForCacheRule(options: {
  readonly cachePath: string;
  readonly eventsPath: string;
}): CacheReading {
  const cached = readCachedView(options.cachePath);
  const offset = cursorOffsetOf(cached);
  const after = offset === null ? null : readEvents(options.eventsPath, { offset });
  const whole = readEvents(options.eventsPath);
  return Object.freeze({
    cached,
    eventFileBytes: eventFileBytes(options.eventsPath),
    nextSeq: after?.events[0]?.seq ?? null,
    newestEventAt: whole.newestEventAt,
  });
}

/**
 * F129-FR-008 — whether the cached view at `cachePath` may be used for the run
 * whose event file is at `eventsPath`. `rule` is the pure rule of the read
 * model; the three refusals of the requirement are all reached through it:
 * another major, a cursor that does not match the event file, and a view older
 * than the newest event.
 */
export function usableCachedView(
  options: {
    readonly cachePath: string;
    readonly eventsPath: string;
    readonly runId: string | null;
  },
  rule: CacheRule,
): CacheDecision {
  const reading = readForCacheRule(options);
  return rule({
    cached: reading.cached,
    runId: options.runId,
    eventFileBytes: reading.eventFileBytes,
    nextSeq: reading.nextSeq,
    newestEventAt: reading.newestEventAt,
  });
}
