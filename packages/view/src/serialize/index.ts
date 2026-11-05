/**
 * T023, T025 — the canonical serialization of the view, the writer function
 * `renderView` the runtime calls, and the validity rules a reader applies to a
 * cached view (F129-FR-006, F129-FR-007, F129-FR-008).
 */
import { MAJOR, SCHEMA_ID, type RunView, type ViewCursor } from "../model/view.ts";
import { canonicalJson, hasEscapeSequence } from "./canonical.ts";

export { canonicalJson, hasEscapeSequence };

/**
 * T025 — the writer function for the runtime: the canonical bytes of the cached
 * view `run:<runId>:view`. ONE record, no trailing line end, a stable order of
 * keys. The cached view is disposable: deleting it loses nothing
 * (F129-FR-008).
 */
export function renderView(view: RunView): string {
  return canonicalJson(view);
}

/** Why a cached view may not be used (F129-FR-008). */
export const CACHE_REFUSALS = [
  "no-cache",
  "not-a-record",
  "different-major",
  "another-run",
  "cursor-does-not-match",
  "older-than-the-newest-event",
] as const;
export type CacheRefusal = (typeof CACHE_REFUSALS)[number];

/** What a reader decided about a cached view. */
export type CacheDecision =
  | { readonly usable: true; readonly view: RunView }
  | { readonly usable: false; readonly refusal: CacheRefusal };

/** The major a schema id carries: `specstride.view/1` -> 1. */
export function majorOfSchemaId(schemaId: unknown): number | null {
  if (typeof schemaId !== "string") return null;
  const slash = schemaId.indexOf("/");
  if (slash < 0) return null;
  const major = Number(schemaId.slice(slash + 1).split(":")[0]);
  return Number.isInteger(major) ? major : null;
}

/**
 * T025, F129-FR-008 — the validity rules of a cached view, as a PURE
 * predicate, so that the reader in the CLI and the runtime apply the same rule.
 *
 * A cached view is ignored when it is of another major, when it belongs to
 * another run, when its cursor does not match the event file (the file is
 * shorter than the offset, or the next event does not carry the `seq` that
 * follows the last one), and when it is older than the newest event. No reader
 * needs it and no run depends on it.
 */
export function cachedViewIsUsable(options: {
  readonly cached: unknown;
  readonly runId: string | null;
  /** The size of the event file in bytes, or null where it could not be read. */
  readonly eventFileBytes: number | null;
  /** The `seq` of the first event after the cursor, or null where there is none. */
  readonly nextSeq: number | null;
  /** The time of the newest event of the file, or null where there is none. */
  readonly newestEventAt: string | null;
}): CacheDecision {
  const { cached, runId, eventFileBytes, nextSeq, newestEventAt } = options;
  if (cached === null || cached === undefined) {
    return Object.freeze({ usable: false, refusal: "no-cache" as const });
  }
  if (typeof cached !== "object") {
    return Object.freeze({ usable: false, refusal: "not-a-record" as const });
  }
  const record = cached as Partial<RunView> & { readonly schema?: unknown };
  if (record.schema !== SCHEMA_ID) {
    const major = majorOfSchemaId(record.schema);
    if (major === null || major !== MAJOR) {
      return Object.freeze({ usable: false, refusal: "different-major" as const });
    }
    return Object.freeze({ usable: false, refusal: "not-a-record" as const });
  }
  const cursor = record.cursor as ViewCursor | undefined;
  if (
    cursor === undefined ||
    typeof cursor.offset !== "number" ||
    typeof cursor.lastSeq !== "number"
  ) {
    return Object.freeze({ usable: false, refusal: "not-a-record" as const });
  }
  if (
    runId !== null &&
    record.runId !== null &&
    record.runId !== undefined &&
    record.runId !== runId
  ) {
    return Object.freeze({ usable: false, refusal: "another-run" as const });
  }
  if (eventFileBytes !== null && eventFileBytes < cursor.offset) {
    return Object.freeze({ usable: false, refusal: "cursor-does-not-match" as const });
  }
  if (nextSeq !== null && nextSeq !== cursor.lastSeq + 1) {
    return Object.freeze({ usable: false, refusal: "cursor-does-not-match" as const });
  }
  if (newestEventAt !== null && typeof record.now === "string") {
    const cachedAt = Date.parse(record.now);
    const newest = Date.parse(newestEventAt);
    if (!Number.isNaN(cachedAt) && !Number.isNaN(newest) && cachedAt < newest) {
      return Object.freeze({ usable: false, refusal: "older-than-the-newest-event" as const });
    }
  }
  return Object.freeze({ usable: true, view: record as RunView });
}
