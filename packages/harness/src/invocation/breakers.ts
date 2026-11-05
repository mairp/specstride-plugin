/**
 * T030 — the breaker state file the finalization folds a result into
 * (F126-FR-034; origins C-159 B-2151 to B-2153, C-160 B-2158, C-058
 * B-0782).
 *
 * The breaker fields live in the `core` counters of the ledger: `count` (the
 * consecutive errors), `cap_count` (the hard-cap hits), `last_invocation_id`,
 * `last_reason_code` and `last_kill_class`. The file is loaded where present
 * and rewritten atomically.
 */
import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "@specstride/kernel/atomic-write";

/** The breaker fields of the ledger `core` counters (data-model). */
export type BreakerFields = {
  readonly count: number;
  readonly cap_count: number;
  readonly last_invocation_id: string | null;
  readonly last_reason_code: string | null;
  readonly last_kill_class: string | null;
};

/** The fresh breaker state, with every count at zero. */
export function freshBreakers(): BreakerFields {
  return {
    count: 0,
    cap_count: 0,
    last_invocation_id: null,
    last_reason_code: null,
    last_kill_class: null,
  };
}

/**
 * Load the breaker state from its file; a missing or unreadable file reads
 * as the fresh state (B-2158).
 */
export function loadBreakerState(path: string): BreakerFields {
  if (!existsSync(path)) return freshBreakers();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const numberOf = (key: string): number =>
      typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : 0;
    const textOf = (key: string): string | null =>
      typeof raw[key] === "string" && (raw[key] as string).length > 0 ? (raw[key] as string) : null;
    return {
      count: numberOf("count"),
      cap_count: numberOf("cap_count"),
      last_invocation_id: textOf("last_invocation_id"),
      last_reason_code: textOf("last_reason_code"),
      last_kill_class: textOf("last_kill_class"),
    };
  } catch {
    return freshBreakers();
  }
}

/** Rewrite the breaker state atomically (B-2158). */
export function saveBreakerState(path: string, state: BreakerFields): void {
  atomicWriteJson(path, state);
}

/**
 * Fold one result into the breakers (F126-FR-034): an error raises the
 * consecutive-error count, a success resets it; a budget kill raises the
 * hard-cap count; the last invocation id, reason code and kill class are
 * always stamped.
 */
export function foldIntoBreakers(
  before: BreakerFields,
  folded: {
    readonly invocationId: string;
    readonly isError: boolean;
    readonly reasonCode: string;
    readonly killClass: string | null;
  },
): BreakerFields {
  return {
    count: folded.isError ? before.count + 1 : 0,
    cap_count: folded.killClass === "budget" ? before.cap_count + 1 : before.cap_count,
    last_invocation_id: folded.invocationId,
    last_reason_code: folded.reasonCode,
    last_kill_class: folded.killClass,
  };
}
