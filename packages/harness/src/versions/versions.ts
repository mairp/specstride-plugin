/**
 * T100 — recorded harness versions and their warnings (F109-FR-041).
 *
 * A tested harness adapter is a harness descriptor plus optional code, and its
 * descriptor carries a version range and a `verified-on` date. Every pass and
 * every critic-class call records the version of the harness it ran — and
 * `null` where the harness states none. A version is NEVER guessed: where the
 * harness states none, the record carries `null`, not a default.
 *
 * The doctor warns when the installed version is outside the pinned range, and
 * a change of the version between two passes of one run gives a warning.
 *
 * The product NEVER installs, vendors or downloads a harness — also not to
 * reach a pin. This module is therefore pure: it holds no install, download or
 * vendor operation, touches no network and writes no file; a pin is reached
 * only by a warning that names the gap.
 */

/** The descriptor field that carries the pinned range of a tested adapter. */
export const VERSION_RANGE_FIELD = "versionRange" as const;
/** The descriptor field that carries the `verified-on` date. */
export const VERIFIED_ON_FIELD = "verifiedOn" as const;

/** One version of a harness: three numeric parts, compared numerically. */
export type ParsedVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/**
 * The warning the doctor records for a version outside the pinned range. The
 * figure of plan.md XIX (a doctor finding is at most 200 bytes) holds the
 * sentence short: the composed message already names the version and the
 * range, so the sentence carries only the remedy.
 */
export const OUTSIDE_RANGE_WARNING = "nothing is installed or downloaded to reach the pin" as const;

/** The warning recorded when the version changes between two passes of a run. */
export const VERSION_CHANGE_WARNING =
  "the version of the harness changed between two passes of one run" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `1.4.2`, `1.4`, `1` or a leading `v`. Anything else — a build string,
 * a commit, prose — is no version this module compares; it returns `null` and
 * the caller records the raw string or `null`, never a guess.
 */
export function parseVersion(version: string | null | undefined): ParsedVersion | null {
  if (typeof version !== "string") return null;
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(version.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? "0"),
    patch: Number(match[3] ?? "0"),
  };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (const part of ["major", "minor", "patch"] as const) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether one version satisfies one range. The range is the descriptor's
 * `versionRange` text: a space- (or comma-) separated list of comparators
 * `>=`, `>`, `<=`, `<`, `=` and the exact form, plus the caret `^1.2.3`
 * (same major) and the tilde `~1.2.3` (same major and minor). An empty or
 * unreadable range pins nothing: every version is inside it.
 */
export function versionInRange(version: string | null, range: string | null | undefined): boolean {
  const parsed = parseVersion(version);
  if (parsed === null) return false;
  if (typeof range !== "string" || range.trim() === "") return true;
  for (const token of range.split(/[\s,]+/)) {
    if (token === "" || token === "||") continue;
    if (token.startsWith("^")) {
      const base = parseVersion(token.slice(1));
      if (base !== null && (parsed.major !== base.major || compareVersions(parsed, base) < 0)) {
        return false;
      }
      continue;
    }
    if (token.startsWith("~")) {
      const base = parseVersion(token.slice(1));
      if (
        base !== null &&
        (parsed.major !== base.major ||
          parsed.minor !== base.minor ||
          compareVersions(parsed, base) < 0)
      ) {
        return false;
      }
      continue;
    }
    const comparator = /^(>=|<=|>|<|=)?/.exec(token)?.[1] ?? null;
    const bound = parseVersion(comparator === null ? token : token.slice(comparator.length));
    if (bound === null) continue;
    const order = compareVersions(parsed, bound);
    const holds =
      comparator === ">="
        ? order >= 0
        : comparator === "<="
          ? order <= 0
          : comparator === ">"
            ? order > 0
            : comparator === "<"
              ? order < 0
              : order === 0; // `=` and the exact form
    if (!holds) return false;
  }
  return true;
}

/** The version range a descriptor pins; `null` where it pins none. */
export function versionRangeOf(descriptor: unknown): string | null {
  if (!isRecord(descriptor)) return null;
  const range = descriptor[VERSION_RANGE_FIELD];
  return typeof range === "string" && range.trim() !== "" ? range : null;
}

/** The `verified-on` date of a descriptor; `null` where it states none. */
export function verifiedOnOf(descriptor: unknown): string | null {
  if (!isRecord(descriptor)) return null;
  const date = descriptor[VERIFIED_ON_FIELD];
  return typeof date === "string" && date.trim() !== "" ? date : null;
}

/**
 * Whether a descriptor is that of a tested harness adapter, as F109-FR-041
 * reads it: a version range AND a `verified-on` date are both present.
 */
export function isTestedVersioned(descriptor: unknown): boolean {
  return versionRangeOf(descriptor) !== null && verifiedOnOf(descriptor) !== null;
}

/**
 * The version one pass or one critic-class call records: the version the
 * harness stated, or `null` where it states none. A version is never guessed
 * — no default, no `0.0.0`, no read of a lockfile to fill the field.
 */
export function recordVersion(stated: string | null | undefined): string | null {
  return typeof stated === "string" && stated.trim() !== "" ? stated : null;
}

/** The version record of ONE pass or ONE critic-class call (F109-FR-041). */
export type RecordedCallVersion = {
  /** The version the harness stated, or `null` where it states none. */
  readonly version: string | null;
};

/** Record the version of one pass or one critic-class call. */
export function recordCallVersion(stated: string | null | undefined): RecordedCallVersion {
  return { version: recordVersion(stated) };
}

/** The doctor's warning for an installed version outside the pinned range. */
export function outsideRangeWarning(input: {
  readonly harness: string;
  readonly version: string | null;
  readonly range: string;
}): string {
  return `${input.harness}: version ${input.version === null ? "(none stated)" : input.version} is outside the pinned range ${input.range}; ${OUTSIDE_RANGE_WARNING}`;
}

/** The warning for a version that changed between two passes of one run. */
export function versionChangeWarning(input: {
  readonly harness: string;
  readonly before: string | null;
  readonly after: string | null;
}): string {
  return `${VERSION_CHANGE_WARNING} (${input.harness}: ${input.before === null ? "none" : input.before} -> ${input.after === null ? "none" : input.after})`;
}

/**
 * Compare the version of two passes of one run. A change gives the warning;
 * the same version (or `null` on both sides) gives none. `null` never counts
 * as a change of an installed version — where the harness states no version,
 * there is nothing recorded that could change.
 */
export function checkVersionStability(input: {
  readonly harness: string;
  readonly before: string | null;
  readonly after: string | null;
}): string | null {
  if (input.before === null && input.after === null) return null;
  if (input.before !== null && input.before === input.after) return null;
  return versionChangeWarning(input);
}

/** The closed set of what this module can do to reach a pin: nothing. */
export const INSTALL_ACTIONS: readonly string[] = Object.freeze([]);

/**
 * The doctor's version warning for one harness (F109-FR-041): outside the
 * range it warns; a tested adapter with no stated version warns too (the pin
 * cannot be checked); nothing here installs, vendors or downloads.
 */
export function versionDoctorWarning(input: {
  readonly harness: string;
  readonly tested: boolean;
  readonly version: string | null;
  readonly range: string | null;
}): string | null {
  if (!input.tested || input.range === null) return null;
  if (input.version === null) {
    return `${input.harness}: the tested harness adapter states no version; the pin ${input.range} cannot be checked. ${OUTSIDE_RANGE_WARNING}`;
  }
  if (!versionInRange(input.version, input.range)) {
    return outsideRangeWarning({
      harness: input.harness,
      version: input.version,
      range: input.range,
    });
  }
  return null;
}
