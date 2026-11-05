/**
 * T011 — the shape `learning`: the as-is record of the learning stream
 * (F144-FR-004; B-1225 to B-1229).
 *
 * F144-FR-004, last sentence: *A row of the shape `learning` MUST write
 * `event` first and `ts`, and no `time`.* B-1225 says the same from the other
 * side: the fields of `knob_adjusted` are `event`, `ts`, `knob`, `phase`,
 * `from`, `to`, `reason`, `metric`, `samples`, `run_id`, and NO `time` field
 * is written.
 *
 * A null is KEPT here, unlike the shape `python`: the revert of B-1227 writes
 * `samples=null` and `metric=null` as fields of the record. `keepsNulls`
 * records that difference as data, so that a reader of the two shapes sees
 * where they part.
 */
import { ITEM_SEPARATOR, KEY_SEPARATOR } from "../python-line/index.ts";
import type { TypedPair } from "../python-line/index.ts";

export type { TypedPair };
export { ITEM_SEPARATOR, KEY_SEPARATOR };

/**
 * The `ts` of this shape is NOT the six decimals of the critic's record: the
 * learning writer takes the text of the clock as it is
 * (`str(time.time())`, `lib/learn.py:930`), which is the shortest text that
 * reads back as the same number. `String` of a number in TypeScript is the
 * same shortest form, so the two agree digit for digit.
 */
export function asIsTimestamp(epochSeconds: number): string {
  return String(epochSeconds);
}

/** The two keys that open the record, in order (F144-FR-004). */
export const LEADING_KEYS = ["event", "ts"] as const;

/** The shape writes no `time` field (B-1225). */
export const WRITES_TIME = false as const;

/** A null is a value of this shape, not an absence (B-1227). */
export const KEEPS_NULLS = true as const;

/** The three old names of the learning stream (F144-FR-002). */
export const LEARNING_NAMES = ["knob_adjusted", "knob_auto_reverted", "knob_evaluated"] as const;

/** What one record of the shape `learning` is made of. */
export type LearningLine = {
  readonly event: string;
  readonly ts: string;
  /** The pairs of the row, in the order of its field map, types and nulls kept. */
  readonly pairs: readonly TypedPair[];
};

/** The pairs of a record: `event`, then `ts`, then the row's own, nulls kept. */
export function pairsOfLearningLine(line: LearningLine): readonly TypedPair[] {
  return Object.freeze([
    Object.freeze(["event", line.event]) as TypedPair,
    Object.freeze(["ts", line.ts]) as TypedPair,
    ...line.pairs.filter(([, value]) => value !== undefined),
  ]);
}

/** The bytes of one record: a JSON object, `event` first, no `time`. */
export function renderLearningLine(line: LearningLine): string {
  const body = pairsOfLearningLine(line)
    .map(([key, value]) => `${JSON.stringify(key)}${KEY_SEPARATOR}${JSON.stringify(value ?? null)}`)
    .join(ITEM_SEPARATOR);
  return `{${body}}`;
}
