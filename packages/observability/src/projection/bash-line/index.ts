/**
 * T011 — the shape `bash`: the as-is line of the Bash emitter
 * (F144-FR-003; B-0361, B-0362, B-0363, B-2465, B-2466).
 *
 * B-0362: *Every bash-emitted event is one JSON object per line with `ts`
 * (epoch seconds with nanoseconds), `time` (ISO-8601) and `event`, then
 * `run_id`, `task`, `backend`, `feature`, `trace_id` when their variables are
 * set, then the call's key/value pairs, all values as JSON strings.*
 *
 * The line is built as an ORDERED LIST OF PAIRS and serialised by hand, never
 * through `JSON.stringify` of an object: the baseline never de-duplicates
 * keys, so `run_start` carries `feature` twice and `proposer_start` carries
 * `backend` twice with different values (B-2463, B-2464). An object would lose
 * the first of each pair, and rule N-13 of the oracle reads a line as ordered
 * pairs with duplicates kept, so losing it would be a difference.
 *
 * B-0361: escaping turns backslash, double quote, tab and newline into their
 * escapes, DELETES carriage returns and leaves other control characters raw.
 * That is not JSON — a raw `\u0001` inside a JSON string is ill-formed — and
 * it is deliberate: the bytes of the baseline are what the oracle compares.
 *
 * B-2465: `ts` is `<epoch>.<nanoseconds>`, and whole seconds where the
 * platform cannot give nanoseconds; `time` is ISO 8601 with the offset.
 *
 * B-0363, B-2466: the arguments are consumed in pairs while more than one
 * remains, so a trailing key without a value is silently dropped.
 */

/** One pair of an as-is line: a key and the text of its value. */
export type AsIsPair = readonly [string, string];

/** The keys of the ambient fields, in the order of B-0362. */
export const AMBIENT_KEYS = ["run_id", "task", "backend", "feature", "trace_id"] as const;
export type AmbientKey = (typeof AMBIENT_KEYS)[number];

/** The three keys that open every line of this shape, in order (B-0362). */
export const LEADING_KEYS = ["ts", "time", "event"] as const;

/** The number of decimals of a nanosecond clock. */
export const NANOSECOND_DIGITS = 9 as const;

/**
 * B-0361 — the escaping of the Bash emitter. Backslash, double quote, tab and
 * newline become their escapes; a carriage return is deleted; every other
 * control character is written raw.
 */
export function escapeAsIs(value: string): string {
  let out = "";
  for (const character of value) {
    if (character === "\\") out += "\\\\";
    else if (character === '"') out += '\\"';
    else if (character === "\t") out += "\\t";
    else if (character === "\n") out += "\\n";
    else if (character === "\r") continue;
    else out += character;
  }
  return out;
}

/**
 * The text of a value as this shape writes it: every value is a JSON STRING,
 * whatever its type in the new schema (F144-FR-005). `null` and `undefined`
 * never reach here — the caller drops a pair without a value.
 */
export function textOfValue(value: string | number | boolean): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * B-0363, B-2466 — consume the arguments in pairs while MORE THAN ONE
 * remains. A trailing key without a value is dropped, and so is a pair whose
 * value is absent or null (the baseline's caller never passes one).
 */
export function pairsOfArguments(
  argv: readonly (string | number | boolean | null | undefined)[],
): readonly AsIsPair[] {
  const pairs: AsIsPair[] = [];
  let at = 0;
  while (argv.length - at > 1) {
    const key = argv[at];
    const value = argv[at + 1];
    at += 2;
    if (key === undefined || key === null) continue;
    if (value === undefined || value === null) continue;
    pairs.push(Object.freeze([String(key), textOfValue(value)]) as AsIsPair);
  }
  return Object.freeze(pairs);
}

/**
 * B-2465 — `ts` as `date +%s.%N` writes it: the whole seconds, a point, and
 * the nanoseconds padded to nine digits. Where the platform's clock gives no
 * nanoseconds (`%N` refused), it is the whole seconds alone.
 */
export function asIsTimestamp(epochSeconds: number, nanoseconds?: number | null): string {
  const seconds = Math.floor(epochSeconds);
  if (nanoseconds === undefined || nanoseconds === null) return String(seconds);
  return `${String(seconds)}.${String(Math.floor(nanoseconds)).padStart(NANOSECOND_DIGITS, "0")}`;
}

/** The offset of a time, as ISO 8601 writes it: `+04:00`, `Z` for UTC. */
export function isoOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const total = Math.abs(offsetMinutes);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

/**
 * B-2465 — `time` as `date -Is` writes it: seconds, no fraction, with the
 * offset of the zone. `offsetMinutes` is minutes EAST of UTC, so that a
 * caller can render the line of a fixture without touching the zone of the
 * machine.
 */
export function asIsTime(at: Date, offsetMinutes = 0): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  return `${shifted.toISOString().slice(0, 19)}${isoOffset(offsetMinutes)}`;
}

/** What one line of the shape `bash` is made of. */
export type BashLine = {
  /** The old name of the event: the value of `event`. */
  readonly event: string;
  /** The value of `ts`, as `asIsTimestamp` writes it. */
  readonly ts: string;
  /** The value of `time`, as `asIsTime` writes it. */
  readonly time: string;
  /** The ambient pairs, in the order of `AMBIENT_KEYS`, those that are set. */
  readonly ambient: readonly AsIsPair[];
  /** The pairs of the row, in the order of its field map. */
  readonly pairs: readonly AsIsPair[];
};

/** The pairs of a line in the order B-0362 fixes, duplicates kept. */
export function pairsOfBashLine(line: BashLine): readonly AsIsPair[] {
  return Object.freeze([
    Object.freeze(["ts", line.ts]) as AsIsPair,
    Object.freeze(["time", line.time]) as AsIsPair,
    Object.freeze(["event", line.event]) as AsIsPair,
    ...line.ambient,
    ...line.pairs,
  ]);
}

/**
 * The bytes of one line: a JSON object with every value a string, the pairs in
 * the order they were given, duplicates kept, escaped as B-0361 escapes.
 */
export function renderBashLine(line: BashLine): string {
  const body = pairsOfBashLine(line)
    .map(([key, value]) => `"${escapeAsIs(key)}":"${escapeAsIs(value)}"`)
    .join(",");
  return `{${body}}`;
}

/**
 * The pairs of a rendered line, read back from its bytes as rule N-13 reads
 * them: ordered pairs of key and value, duplicates kept, types kept (here
 * every value is text). This is the reader the tests compare with, so that no
 * test asserts over the object a JSON parser would collapse the line into.
 */
export function readAsIsPairs(line: string): readonly AsIsPair[] {
  const out: AsIsPair[] = [];
  const body = line.trim().replace(/^\{/, "").replace(/\}$/, "");
  let at = 0;
  const text = (): string => {
    // The value starts at the opening quote and ends at the first quote that
    // is not escaped. The escapes are those of B-0361.
    at += 1;
    let value = "";
    while (at < body.length) {
      const character = body[at] as string;
      if (character === "\\") {
        const next = body[at + 1];
        at += 2;
        if (next === "n") value += "\n";
        else if (next === "t") value += "\t";
        else if (next === '"') value += '"';
        else if (next === "\\") value += "\\";
        else value += `\\${String(next)}`;
        continue;
      }
      at += 1;
      if (character === '"') return value;
      value += character;
    }
    return value;
  };
  while (at < body.length) {
    if (body[at] !== '"') {
      at += 1;
      continue;
    }
    const key = text();
    while (at < body.length && body[at] !== '"') at += 1;
    const value = text();
    out.push(Object.freeze([key, value]) as AsIsPair);
  }
  return Object.freeze(out);
}
