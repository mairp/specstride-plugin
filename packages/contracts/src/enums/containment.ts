/**
 * T170 — the containment levels as data (annex C, §C.15; F100-FR-111,
 * F100-FR-112).
 *
 * The four levels with their meaning from the key `containmentLevels` of
 * `data/harness-tables.json`, the ceiling with its provenance that every
 * harness adapter declares, the value of `protection` per level, and the rule
 * for parallel units.
 *
 * Row 26 of `data/closed-sets.json` ("Containment levels") gives no literals:
 * it refers to this table and registers by reference to `CONTAINMENT_LEVELS`
 * through the mechanism of T070, in `src/enums/sets-105-109.ts`. The
 * unknown-value rule of the row is `Read as C0`, which `readContainmentLevel`
 * applies.
 */
import harnessTables from "../../data/harness-tables.json" with { type: "json" };
import {
  PROTECTION_VALUES,
  protectionByLevel,
  protectionFor,
  type Protection,
} from "../ids/layout-rules.ts";

/** The section of annex C that owns the table. */
export const ANNEX_SECTION = "annex C, §C.15" as const;

/** The row of annex X §X.6 that closes the set. */
export const CLOSED_SET_ROW = 26 as const;

/**
 * The four levels of §C.15, lowest first. The literal tuple is the members of
 * the closed set; `CONTAINMENT_LEVEL_ROWS` below asserts at load that it is
 * exactly the table of `data/harness-tables.json`, so the two cannot drift.
 */
export const CONTAINMENT_LEVELS = ["C0", "C1", "C2", "C3"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

type RawLevel = { Level: string; Meaning: string };

/** One level of §C.15: its name and what it means. */
export type ContainmentLevelRow = {
  readonly level: ContainmentLevel;
  readonly meaning: string;
  /** 0 for C0, 3 for C3: the order in which the levels grow stronger. */
  readonly strength: number;
};

const RAW = (harnessTables as { containmentLevels: RawLevel[] }).containmentLevels;

/** A table of `data/harness-tables.json` that is not the four levels of §C.15. */
export class ContainmentTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainmentTableError";
  }
}

function rows(): readonly ContainmentLevelRow[] {
  const levels = RAW.map((row) => row.Level);
  if (
    levels.length !== CONTAINMENT_LEVELS.length ||
    levels.some((l, i) => l !== CONTAINMENT_LEVELS[i])
  ) {
    throw new ContainmentTableError(
      `the key \`containmentLevels\` of \`data/harness-tables.json\` holds ` +
        `${levels.join(", ")}; annex C §C.15 holds the four levels ` +
        `${CONTAINMENT_LEVELS.join(", ")} (F100-FR-111)`,
    );
  }
  return Object.freeze(
    RAW.map((row, i) =>
      Object.freeze({
        level: row.Level as ContainmentLevel,
        meaning: row.Meaning,
        strength: i,
      }),
    ),
  );
}

/** The four levels with their meaning, from `data/harness-tables.json`. */
export const CONTAINMENT_LEVEL_ROWS: readonly ContainmentLevelRow[] = rows();

/** The meaning of every level, by level. */
export const meaningOfLevel: Readonly<Record<ContainmentLevel, string>> = Object.freeze(
  Object.fromEntries(CONTAINMENT_LEVEL_ROWS.map((r) => [r.level, r.meaning])) as Record<
    ContainmentLevel,
    string
  >,
);

/** True for a member of the set (annex X §X.6 row 26). */
export function isContainmentLevel(value: unknown): value is ContainmentLevel {
  return typeof value === "string" && (CONTAINMENT_LEVELS as readonly string[]).includes(value);
}

/** Unknown-value rule of row 26: a level a reader does not know is read as C0. */
export const LEVEL_WHEN_UNKNOWN: ContainmentLevel = "C0";

/** Read a level; a value outside the set is read as C0 (row 26). */
export function readContainmentLevel(value: unknown): ContainmentLevel {
  return isContainmentLevel(value) ? value : LEVEL_WHEN_UNKNOWN;
}

/** How strong a level is: 0 for C0, 3 for C3. An unknown value is C0. */
export function strengthOf(level: string): number {
  return CONTAINMENT_LEVEL_ROWS.find((r) => r.level === readContainmentLevel(level))?.strength ?? 0;
}

/** F100-FR-111 — the runtime uses the strongest level available. */
export function strongestOf(levels: readonly string[]): ContainmentLevel {
  let best: ContainmentLevel = LEVEL_WHEN_UNKNOWN;
  for (const level of levels) {
    if (strengthOf(level) > strengthOf(best)) best = readContainmentLevel(level);
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The ceiling with its provenance (F100-FR-111).
 * ------------------------------------------------------------------ */

/**
 * Where the value of the ceiling comes from. `verified` is a value a capture
 * of that harness showed; `declared` is a value the harness adapter states;
 * `probed` is one the adapter established at run time; `unverified` is the
 * mark §C.15 puts on C2 until a capture shows that the sandbox of that
 * harness denies reads of the paths of §C.4.
 */
export const CEILING_PROVENANCES = ["verified", "probed", "declared", "unverified"] as const;
export type CeilingProvenance = (typeof CEILING_PROVENANCES)[number];

/** The ceiling of a harness adapter: the level and where the value comes from. */
export type ContainmentCeiling = {
  readonly level: ContainmentLevel;
  readonly provenance: CeilingProvenance;
  /** The version of the harness the value was established on, where there is one. */
  readonly pin?: string;
  /** The date of the capture, where there is one. */
  readonly verifiedOn?: string;
};

/**
 * F100-FR-111 — every harness adapter declares its ceiling with provenance.
 * A ceiling without a provenance is no ceiling.
 */
export function isContainmentCeiling(value: unknown): value is ContainmentCeiling {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { level?: unknown; provenance?: unknown };
  return (
    isContainmentLevel(v.level) &&
    typeof v.provenance === "string" &&
    (CEILING_PROVENANCES as readonly string[]).includes(v.provenance)
  );
}

/**
 * §C.15 — whether the sandbox of a given harness denies reads of the control
 * plane and the credential paths is `unverified` until a capture of that
 * harness shows it. C2 is therefore the one level whose provenance may be the
 * mark itself.
 */
export const LEVEL_UNVERIFIED_UNTIL_A_CAPTURE: ContainmentLevel = "C2";
export const MARK_OF_AN_UNVERIFIED_CEILING: CeilingProvenance = "unverified";

/* ------------------------------------------------------------------ *
 * `protection` (F100-FR-111, F100-FR-040 SL-6).
 * ------------------------------------------------------------------ */

// The value of `protection` per level is the rule of SL-6, which T244 already
// holds as data; it is re-exported here so that the containment table is one
// place (annex B §B.2, SL-6; annex C §C.15).
export { PROTECTION_VALUES, protectionByLevel, protectionFor };
export type { Protection };

/**
 * F100-FR-111 — the runtime never asserts a sandbox by itself. Only under the
 * `parity` profile does the harness adapter set the as-is assertion variable,
 * and only where the baseline sets it (rows 25 and 26 of annex X §X.7).
 */
export const RUNTIME_NEVER_ASSERTS_A_SANDBOX = true as const;
export const ASSERTION_IS_SET_ONLY_UNDER_PARITY = true as const;
export const ASSERTION_IS_SET_BY = "the harness adapter" as const;

/**
 * F100-FR-111 — C0 needs an opt-in in user configuration; the environment, a
 * flag and project configuration must not give it. A proposer whose ceiling is
 * C0 is refused at launch without the opt-in.
 */
export const LEVEL_THAT_NEEDS_AN_OPT_IN: ContainmentLevel = "C0";
export const OPT_IN_RANK = "user-configuration" as const;
export const RANKS_THAT_MUST_NOT_GIVE_THE_OPT_IN = [
  "flag",
  "environment",
  "project-configuration",
] as const;

/**
 * F100-FR-111 — a proposer whose ceiling is C0 and whose opt-in is absent is
 * refused at launch. The refusal names the level and the one rank that may
 * give the opt-in.
 */
export function proposerIsRefusedAtLaunch(
  ceiling: string,
  optInGivenInUserConfiguration: boolean,
): boolean {
  return readContainmentLevel(ceiling) === LEVEL_THAT_NEEDS_AN_OPT_IN
    ? !optInGivenInUserConfiguration
    : false;
}

/** F100-FR-111 — the level in force is announced and recorded for every run. */
export const LEVEL_IS_ANNOUNCED = true as const;
export const LEVEL_IS_RECORDED = true as const;

/* ------------------------------------------------------------------ *
 * The rule for parallel units (F100-FR-112).
 * ------------------------------------------------------------------ */

/** F100-FR-112 — parallel units run only at containment C2 or above. */
export const PARALLEL_UNITS_MINIMUM_LEVEL: ContainmentLevel = "C2";

/**
 * F100-FR-112 — the one key that lets parallel units run below the minimum
 * level, and the one rank that may set it. The environment, a flag and project
 * configuration must not set it (assumption CQ-183: "user config" of ruling P2
 * is read as the user configuration only).
 */
export const PARALLEL_UNITS_OVERRIDE_KEY = "loop.parallel.allow_detect" as const;
export const PARALLEL_UNITS_OVERRIDE_RANK = "user-configuration" as const;
export const RANKS_THAT_MUST_NOT_SET_THE_OVERRIDE = RANKS_THAT_MUST_NOT_GIVE_THE_OPT_IN;

/** The reason the layer `parallel` falls back on when the level is too low (row 60). */
export const PARALLEL_UNITS_FALLBACK_REASON = "containment" as const;

/** F100-FR-112 — off under the `parity` profile (rows 20 and 23 of annex X §X.7). */
export const PARALLEL_UNITS_UNDER_PARITY = "off" as const;

/** What §C.15 decides for parallel units on a harness of a given ceiling. */
export type ParallelUnitsDecision = {
  /** Whether parallel units may run at all. */
  readonly allowed: boolean;
  /**
   * `off` when the level is too low and the override is absent: the option
   * stays off for the whole run, with the reason stated.
   */
  readonly reason: "level-sufficient" | "override" | typeof PARALLEL_UNITS_FALLBACK_REASON;
  /** What the run says: `prevent` only where the level and the confirmation allow it. */
  readonly protection: Protection;
  /** The option stays off for the run, never per phase (F100-FR-112). */
  readonly offForTheWholeRun: boolean;
};

/**
 * F100-FR-112 — parallel units run only at C2 or above. On a harness whose
 * level is lower the option stays off for the run, with the reason stated,
 * unless the consumer set `loop.parallel.allow_detect` in user configuration;
 * the run then says `protection=detect`.
 */
export function parallelUnitsDecision(
  ceiling: string,
  options: {
    readonly allowDetectInUserConfiguration?: boolean;
    readonly sandboxDeniesControlPlaneWrites?: boolean;
  } = {},
): ParallelUnitsDecision {
  const level = readContainmentLevel(ceiling);
  const allowDetect = options.allowDetectInUserConfiguration === true;
  const confirmed = options.sandboxDeniesControlPlaneWrites === true;
  if (strengthOf(level) >= strengthOf(PARALLEL_UNITS_MINIMUM_LEVEL)) {
    return Object.freeze({
      allowed: true,
      reason: "level-sufficient" as const,
      protection: protectionFor(level, confirmed),
      offForTheWholeRun: false,
    });
  }
  if (allowDetect) {
    return Object.freeze({
      allowed: true,
      reason: "override" as const,
      // Below C2 the run says `protection=detect` (F100-FR-112).
      protection: "detect" as Protection,
      offForTheWholeRun: false,
    });
  }
  return Object.freeze({
    allowed: false,
    reason: PARALLEL_UNITS_FALLBACK_REASON,
    protection: protectionFor(level, confirmed),
    offForTheWholeRun: true,
  });
}
