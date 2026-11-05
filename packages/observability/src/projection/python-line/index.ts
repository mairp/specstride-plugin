/**
 * T011 — the shape `python`: the as-is record of the critic and of the stream
 * tap (F144-FR-004; B-0997, B-0998).
 *
 * B-0997: *Every critic event record has `ts` (epoch with 6 decimals, as a
 * string), `time` (`%Y-%m-%dT%H:%M:%S%z`) and `event`; fields whose value is
 * `None` are dropped; other values keep their JSON type.*
 *
 * B-0998: *Events are appended to the events file best-effort: an `OSError` on
 * write is swallowed, and an empty events path disables emitting.*
 *
 * So this shape differs from `bash` in four ways, and in no other: six
 * decimals instead of nanoseconds, an offset without a colon, values that
 * keep their type, and a field whose value is null dropped rather than
 * written. The record is built from an ORDERED list of pairs for the same
 * reason the Bash line is (rule N-13), even though the Python emitter has no
 * duplicate key of its own.
 */

/** One field of the record: a key and a value that keeps its JSON type. */
export type TypedPair = readonly [string, unknown];

/** The three keys that open the record, in order (B-0997). */
export const LEADING_KEYS = ["ts", "time", "event"] as const;

/** The decimals of `ts` in this shape (B-0997). */
export const TIMESTAMP_DECIMALS = 6 as const;

/** The form of `time` in this shape, as the baseline's format string (B-0997). */
export const TIME_FORMAT = "%Y-%m-%dT%H:%M:%S%z" as const;

/** B-0997 — `ts` is the epoch with six decimals, written as a string. */
export function asIsTimestamp(epochSeconds: number): string {
  return epochSeconds.toFixed(TIMESTAMP_DECIMALS);
}

/** The offset as `%z` writes it: four digits with a sign and no colon. */
export function offsetOfFormat(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const total = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`;
}

/** B-0997 — `time` in the form `%Y-%m-%dT%H:%M:%S%z`. */
export function asIsTime(at: Date, offsetMinutes = 0): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  return `${shifted.toISOString().slice(0, 19)}${offsetOfFormat(offsetMinutes)}`;
}

/** B-0997 — a field whose value is null is dropped; absence is dropped too. */
export function dropNulls(pairs: readonly TypedPair[]): readonly TypedPair[] {
  return Object.freeze(pairs.filter(([, value]) => value !== null && value !== undefined));
}

/** What one record of the shape `python` is made of. */
export type PythonLine = {
  readonly event: string;
  readonly ts: string;
  readonly time: string;
  /** The pairs of the row, in the order of its field map, types kept. */
  readonly pairs: readonly TypedPair[];
};

/** The pairs of a record in the order B-0997 fixes, nulls dropped. */
export function pairsOfPythonLine(line: PythonLine): readonly TypedPair[] {
  return Object.freeze([
    Object.freeze(["ts", line.ts]) as TypedPair,
    Object.freeze(["time", line.time]) as TypedPair,
    Object.freeze(["event", line.event]) as TypedPair,
    ...dropNulls(line.pairs),
  ]);
}

/**
 * The separators the baseline's serialiser writes: a colon and ONE SPACE
 * between a key and its value, a comma and one space between two fields.
 * `json.dumps` of the baseline is called with its defaults, and those are its
 * defaults (`lib/critic.py:2426`).
 */
export const KEY_SEPARATOR = ": " as const;
export const ITEM_SEPARATOR = ", " as const;

/** The bytes of one record: a JSON object, values with their types kept. */
export function renderPythonLine(line: PythonLine): string {
  const body = pairsOfPythonLine(line)
    .map(([key, value]) => `${JSON.stringify(key)}${KEY_SEPARATOR}${JSON.stringify(value)}`)
    .join(ITEM_SEPARATOR);
  return `{${body}}`;
}

/* ------------------------------------------------------------------ *
 * B-0998 — best effort.
 * ------------------------------------------------------------------ */

/** B-0998 — an empty destination switches emission off. */
export function emissionIsOn(destination: string | undefined | null): boolean {
  return typeof destination === "string" && destination.trim() !== "";
}

/** What became of one best-effort append. A failure is never thrown on. */
export type Emission = {
  readonly written: boolean;
  /** The reason nothing was written: `no-destination` or the error, as text. */
  readonly reason?: string;
};

/**
 * B-0998 — append best effort: nothing is written where the destination is
 * empty, and an error of the file system is swallowed. The caller learns what
 * happened from the result and the loop is never broken.
 */
export function appendBestEffort(
  destination: string | undefined | null,
  bytes: string,
  append: (file: string, data: string) => void,
): Emission {
  if (!emissionIsOn(destination)) {
    return Object.freeze({ written: false, reason: "no-destination" });
  }
  try {
    append(destination as string, bytes);
    return Object.freeze({ written: true });
  } catch (error) {
    return Object.freeze({ written: false, reason: String(error) });
  }
}
