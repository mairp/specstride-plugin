/**
 * T005 — `renderLine` and `expiry` (`contracts/status-line.md`; F129-FR-027,
 * F129-FR-028).
 *
 * The grammar, the drop order and the expiry rule. The command `status --line`
 * and the precomputed line of the runtime are built in phases 6 and 7 of
 * `tasks.md`; the two functions the index of the package exports live here from
 * the start, so that no caller writes a line of its own.
 */
import { STATUS_LINE_KEYS } from "../model/view.ts";
import type { RunView, StatusLineKey } from "../model/view.ts";
import { cursorToken } from "../signature/index.ts";
import { byteLength } from "../text/index.ts";

export { STATUS_LINE_KEYS };

/** The line has at most 170 bytes, which is 60 tokens at 2.8 bytes per token. */
export const LINE_CAP_BYTES = 170 as const;

/** The keys that are never left out (F129-FR-027). */
export const KEYS_NEVER_DROPPED: readonly StatusLineKey[] = Object.freeze([
  "run",
  "st",
  "validUntil",
]);

/** The order in which keys are left out until the line fits (F129-FR-027). */
export const DROP_ORDER: readonly StatusLineKey[] = Object.freeze([
  "cur",
  "next",
  "attn",
  "unit",
  "strategy",
  "el",
  "rej",
  "ph",
]);

/** `<h>h<mm>m`, or `<m>m` below one hour (`contracts/status-line.md`). */
export function elapsedText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** What `renderLine` is asked for besides the view. */
export type LineOptions = {
  /** `cur=` is printed by `wait` only. */
  readonly withCursor?: boolean;
  /** `validUntil=` is present only in the precomputed line of F129-FR-028. */
  readonly validUntil?: string | null;
};

/**
 * F129-FR-027 — the status line: one line of pairs `key=value` separated by one
 * space, beginning with `run=` and `st=`. A key whose value is null is left
 * out. Where the full line is longer than 170 bytes, keys are left out in the
 * order of `DROP_ORDER` until it fits; `run`, `st` and `validUntil` are never
 * left out.
 */
export function renderLine(view: RunView, options: LineOptions = {}): string {
  const values = new Map<StatusLineKey, string | null>();
  values.set("run", view.runId);
  values.set("st", view.display);
  values.set(
    "ph",
    view.progress.phase === null || view.progress.phases === null
      ? null
      : `${view.progress.phase}/${view.progress.phases}`,
  );
  values.set(
    "unit",
    view.progress.units === null || view.progress.units.declared === null
      ? null
      : `${view.progress.units.done}/${view.progress.units.declared}`,
  );
  values.set("rej", view.progress.rejects > 0 ? String(view.progress.rejects) : null);
  values.set(
    "el",
    view.progress.elapsedSeconds > 0 ? elapsedText(view.progress.elapsedSeconds) : null,
  );
  values.set(
    "next",
    view.supervision === null || view.supervision.nextSeconds === null
      ? null
      : `${view.supervision.nextSeconds}s`,
  );
  values.set("strategy", view.strategy.strategy);
  values.set("attn", view.attention.length > 0 ? String(view.attention.length) : null);
  values.set("cur", options.withCursor === true ? cursorToken(view) : null);
  values.set("validUntil", options.validUntil ?? null);

  const dropped = new Set<StatusLineKey>();
  const build = (): string =>
    STATUS_LINE_KEYS.filter((key) => !dropped.has(key))
      .map((key) => [key, values.get(key)] as const)
      .filter(
        (pair): pair is readonly [StatusLineKey, string] =>
          pair[1] !== null && pair[1] !== undefined,
      )
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");

  let line = build();
  for (const key of DROP_ORDER) {
    if (byteLength(line) <= LINE_CAP_BYTES) break;
    if (KEYS_NEVER_DROPPED.includes(key)) continue;
    dropped.add(key);
    line = build();
  }
  return line;
}

/** The pairs of a line, in the order the line gives them. */
export function parseLine(line: string): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  for (const token of line.trim().split(" ")) {
    if (token === "") continue;
    const cut = token.indexOf("=");
    if (cut < 0) continue;
    pairs.set(token.slice(0, cut), token.slice(cut + 1));
  }
  return pairs;
}

/** The value `validUntil` carries where the line never expires (F129-FR-028). */
export const NEVER_EXPIRES = "none" as const;

/** What a reader of a precomputed line decided (F129-FR-028). */
export type ExpiryVerdict =
  | { readonly expired: false; readonly validUntil: string | null }
  | { readonly expired: true; readonly validUntil: string }
  | { readonly expired: null; readonly reason: "unreadable" };

/**
 * F129-FR-028 — whether a precomputed status line may still be printed at the
 * time `now`. A live state carries the `validUntil` of the lease; a resting
 * state carries `validUntil=none` and does not expire. A reader that finds a
 * `validUntil` in the past prints that the state is unknown and names `status`
 * (F100-FR-161).
 */
export function expiry(line: string, now: string): ExpiryVerdict {
  const pairs = parseLine(line);
  if (pairs.get("run") === undefined || pairs.get("st") === undefined) {
    return Object.freeze({ expired: null, reason: "unreadable" as const });
  }
  const validUntil = pairs.get("validUntil");
  if (validUntil === undefined || validUntil === NEVER_EXPIRES) {
    return Object.freeze({ expired: false as const, validUntil: null });
  }
  const until = Date.parse(validUntil);
  const here = Date.parse(now);
  if (Number.isNaN(until) || Number.isNaN(here)) {
    return Object.freeze({ expired: null, reason: "unreadable" as const });
  }
  return here > until
    ? Object.freeze({ expired: true as const, validUntil })
    : Object.freeze({ expired: false as const, validUntil });
}
