/**
 * T047 (feature 112) — the checks of the groups `bin` and `harness`
 * (F112-FR-009, F112-FR-013; CT-112-109, CT-112-113; catalogue rows 11 to 16).
 *
 * F112-FR-009: no check enumerates harnesses by name. Every per-harness entry
 * (`bin.<id>`, `harness.state.<id>`, `harness.version.<id>`, `harness.caps.<id>`,
 * `harness.denylist.<id>`) is produced from the resolved registry the probe bag
 * carries (EP-02 `specstride.harness/1`): tested harness adapters, discovered
 * harnesses and harnesses the consumer declared. This file holds no harness
 * name; `harnessChecksOf` builds one check per registry entry.
 *
 * F112-FR-013: `harness.discovered` lists the resolved registry;
 * `harness.state.<id>` shows the state of each harness (`tested`,
 * `locally-verified`, `declared`, `detected`), calls every harness that is not
 * `tested` `unverified`, with what would verify it, and warns when an
 * unverified harness is selected for a role; `harness.version.<id>` warns
 * outside the tested range, informs inside, and informs when `verified-on` is
 * older than `doctor.staleAfterDays` (default 90, row 61); `harness.caps.<id>`
 * warns when a declared and a probed capability differ.
 *
 * Every probe reads only its injected probe bag: no real machine in a test.
 */
import type { Check, HarnessEntry, ProbeBag, Severity } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** The age after which a `verified-on` date is stale (row 61 of annex X §X.7). */
export const STALE_AFTER_DAYS_DEFAULT = 90 as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * F112-FR-009: read the resolved harness registry out of the injected bag.
 * A bag without harness entries holds an empty registry.
 */
export function harnessesOf(bag: ProbeBag): readonly HarnessEntry[] {
  return bag.registry.harnesses ?? [];
}

/** One entry of the resolved registry, by id, for the per-harness probes. */
function entryOf(bag: ProbeBag, id: string): HarnessEntry | undefined {
  return harnessesOf(bag).find((e) => e.id === id);
}

/**
 * F112-FR-013: every harness whose state is not `tested` is called
 * `unverified`, whatever its finer state says.
 */
export function isUnverified(entry: HarnessEntry): boolean {
  return entry.state !== "tested";
}

/** The state word a listing shows: `tested`, or `unverified (<state>)`. */
export function stateWord(entry: HarnessEntry): string {
  return isUnverified(entry) ? `unverified (${entry.state})` : "tested";
}

/**
 * Compare an installed version against the tested range: true inside, false
 * outside, undefined when either side is unknown (nothing is compared).
 */
export function versionInRange(
  version: string | undefined,
  range: { min?: string; max?: string } | undefined,
): boolean | undefined {
  if (version === undefined || range === undefined) return undefined;
  if (range.min === undefined && range.max === undefined) return undefined;
  const compare = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });
  if (range.min !== undefined && compare(version, range.min) < 0) return false;
  if (range.max !== undefined && compare(version, range.max) >= 0) return false;
  return true;
}

/** The age, in whole days, of a `verified-on` date against a clock reading. */
export function verifiedOnAgeDays(
  verifiedOn: string | undefined,
  nowMs: number,
): number | undefined {
  if (verifiedOn === undefined) return undefined;
  const then = Date.parse(verifiedOn);
  if (Number.isNaN(then)) return undefined;
  return Math.floor((nowMs - then) / DAY_MS);
}

/** The capability keys a declared and a probed record differ on. */
export function differingCaps(
  declared: Readonly<Record<string, unknown>> | undefined,
  probed: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (declared === undefined || probed === undefined) return [];
  const keys = new Set([...Object.keys(declared), ...Object.keys(probed)]);
  const differ: string[] = [];
  for (const key of keys) {
    if (String(declared[key]) !== String(probed[key])) differ.push(key);
  }
  return differ.sort();
}

/** `bin.<id>` — the executable of one harness (row 11, launch-blocking). */
export function binCheckFor(id: string): Check {
  return {
    id: `bin.${id}`,
    group: "bin",
    lb: true,
    order: 11,
    messageTemplate: `${id} {state}{where}`,
    fixHint: "install it, or change the harness of the role",
    severityRule: (o: unknown): Severity => {
      const s = o as { state: "present" | "absent-needed" | "absent" };
      // Fail when a configured role needs the harness and it is absent; info
      // when it is merely absent (row 11).
      return s.state === "absent-needed" ? "fail" : s.state === "absent" ? "info" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = entryOf(b, id);
      if (entry === undefined) return undefined;
      const needed = (entry.roles ?? []).length > 0;
      const present = entry.resolvedPath !== undefined;
      const state = present ? "present" : needed ? "absent-needed" : "absent";
      return {
        state,
        where: present ? ` at ${entry.resolvedPath}` : "",
        roles: entry.roles ?? [],
        present,
        needed,
      };
    },
  };
}

/** `harness.discovered` — the resolved registry listed (row 12, info). */
export const harnessDiscoveredCheck: Check = {
  id: "harness.discovered",
  group: "harness",
  lb: false,
  order: 12,
  messageTemplate: "{harnesses}",
  fixHint: "none",
  severityRule: () => "info" as const,
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const entries = harnessesOf(b);
    return {
      harnesses: entries.map((e) => `${e.id} ${stateWord(e)}`).join("; "),
      count: entries.length,
    };
  },
};

/** `harness.state.<id>` — the state of one harness (row 13). */
export function harnessStateCheckFor(id: string): Check {
  return {
    id: `harness.state.${id}`,
    group: "harness",
    lb: false,
    order: 13,
    messageTemplate: `${id} {summary}`,
    fixHint: "run the opt-in verification of the harness",
    severityRule: (o: unknown): Severity => {
      const s = o as { unverified: boolean; selectedForRole: boolean };
      // F112-FR-013: a warning when an unverified harness is selected for a role.
      return s.unverified && s.selectedForRole ? "warn" : "info";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = entryOf(b, id);
      if (entry === undefined) return undefined;
      const unverified = isUnverified(entry);
      const roles = entry.roles ?? [];
      return {
        state: entry.state,
        unverified,
        selectedForRole: roles.length > 0,
        roles,
        // What would verify it: the conformance run of the adapter.
        summary: unverified
          ? `unverified (${entry.state}): run the conformance suite to verify`
          : "tested",
      };
    },
  };
}

/** `harness.version.<id>` — the installed version against the range (row 14). */
export function harnessVersionCheckFor(id: string): Check {
  return {
    id: `harness.version.${id}`,
    group: "harness",
    lb: false,
    order: 14,
    messageTemplate: `${id} {version} {rangeText} ({verifiedText})`,
    fixHint: "pin or downgrade; run the conformance suite",
    severityRule: (o: unknown): Severity => {
      const s = o as {
        inRange: boolean | undefined;
        staleDays: number | undefined;
        staleAfterDays: number;
      };
      // F112-FR-013: warn outside the tested range; info inside, and info when
      // `verified-on` is older than `doctor.staleAfterDays`.
      if (s.inRange === false) return "warn";
      if (s.staleDays !== undefined && s.staleDays > s.staleAfterDays) return "info";
      return "info";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = entryOf(b, id);
      if (entry === undefined) return undefined;
      const staleAfterDays = cfg<number>(b, "doctor.staleAfterDays", STALE_AFTER_DAYS_DEFAULT);
      const inRange = versionInRange(entry.version, entry.testedRange);
      const staleDays = verifiedOnAgeDays(entry.verifiedOn, b.clock.now());
      const range = entry.testedRange;
      const rangeText = range
        ? `${inRange === false ? "outside" : "inside"} >=${range.min ?? "0"} <${range.max ?? "∞"}`
        : "range unknown";
      const verifiedText =
        entry.verifiedOn !== undefined
          ? `verified ${entry.verifiedOn}${staleDays !== undefined && staleDays > staleAfterDays ? `, ${String(staleDays)} days old (over ${String(staleAfterDays)})` : ""}`
          : "never verified";
      return {
        version: entry.version ?? "unknown",
        inRange,
        staleDays,
        staleAfterDays,
        rangeText,
        verifiedText,
      };
    },
  };
}

/** `harness.caps.<id>` — declared against probed capabilities (row 15). */
export function harnessCapsCheckFor(id: string): Check {
  return {
    id: `harness.caps.${id}`,
    group: "harness",
    lb: false,
    order: 15,
    messageTemplate: `${id} caps: {diffText}`,
    fixHint: "set the window in configuration",
    severityRule: (o: unknown): Severity => {
      const s = o as { differ: readonly string[] };
      // F112-FR-013: warn when a declared and a probed capability differ.
      return s.differ.length > 0 ? "warn" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = entryOf(b, id);
      if (entry === undefined) return undefined;
      const differ = differingCaps(entry.declaredCaps, entry.probedCaps);
      return {
        differ,
        diffText:
          differ.length > 0
            ? differ
                .map(
                  (k) =>
                    `${k} declared ${String(entry.declaredCaps?.[k])}, effective ${String(entry.probedCaps?.[k])}`,
                )
                .join("; ")
            : "declared and probed agree",
      };
    },
  };
}

/**
 * `harness.denylist.<id>` — the critic disable list against the tools the
 * harness exposes (row 16). The real probe lives in the package of the
 * harness adapter that has such a list (F112-FR-033); the doctor holds the
 * data of the check and reads what the resolved registry recorded.
 */
export function harnessDenylistCheckFor(id: string): Check {
  return {
    id: `harness.denylist.${id}`,
    group: "harness",
    lb: false,
    order: 16,
    messageTemplate: "{count} plugin ids not in the critic disable list",
    fixHint: "update the product or restrict the harness",
    severityRule: (o: unknown): Severity => {
      const s = o as { count: number };
      return s.count > 0 ? "warn" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = entryOf(b, id);
      if (entry === undefined) return undefined;
      const uncovered = entry.uncoveredTools ?? [];
      return { count: uncovered.length, uncovered: uncovered.length };
    },
  };
}

/**
 * F112-FR-009 — build the checks of the groups `bin` and `harness` for one
 * resolved registry: the fixed `harness.discovered` listing plus one
 * per-harness check of each kind per entry. Nothing here names a harness.
 */
export function harnessChecksOf(entries: readonly HarnessEntry[]): readonly Check[] {
  const checks: Check[] = [harnessDiscoveredCheck];
  for (const entry of entries) {
    checks.push(
      binCheckFor(entry.id),
      harnessStateCheckFor(entry.id),
      harnessVersionCheckFor(entry.id),
      harnessCapsCheckFor(entry.id),
      harnessDenylistCheckFor(entry.id),
    );
  }
  return Object.freeze(checks);
}
