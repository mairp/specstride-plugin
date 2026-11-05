/**
 * T008 — capability levels and the check of registration (F109-FR-002).
 *
 * An entry of the registry declares which capability levels it offers:
 * `proposer`, `completion` or both (closed set, row 123 of
 * `packages/harness/data/plan/closed-sets.json`). The level `proposer`
 * requires the six capabilities P1 to P6; the level `completion` the six
 * capabilities C1 to C6 (the table "Capability levels" of
 * `specs/109-harness-seam/spec.md`).
 *
 * Two outcomes are distinct on purpose:
 *  - an entry that declares a level and holds NO operation of that level is
 *    REFUSED at registration (the characterization of Lisa's provider seam,
 *    CT-109-101);
 *  - an entry that declares a level and holds only some of its six
 *    capabilities registers, is NOT offered for that role, and the registry
 *    records which capability is missing.
 */

/** The closed set "Capability levels" (row 123 of annex X §X.6). */
export const CAPABILITY_LEVELS = ["proposer", "completion"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/** The refusal an unknown level names (closed set note: "The entry is refused at registration"). */
export const UNKNOWN_LEVEL_UNKNOWN = "The entry is refused at registration" as const;

/** One capability of a level: its id and the sentence the spec gives it. */
export type LevelCapability = {
  readonly id: string;
  readonly level: CapabilityLevel;
  readonly description: string;
};

const PROPOSER_DESCRIPTIONS: readonly string[] = [
  "The harness runs without interaction and ends by itself",
  "It takes the prompt by standard input, by a file, or as an argument with a declared size limit",
  "It works in a given directory, writes files and runs commands there, without asking",
  "It has a declared way to suppress permission prompts, or declares that none exists",
  "It gives an exit code",
  "Its credential can be checked before the first pass without a paid call, or it declares that no such check exists, which gives a doctor warning",
];

const COMPLETION_DESCRIPTIONS: readonly string[] = [
  "One prompt in, one text reply out",
  "No tools, by construction or by a declared mechanism that is proven per call; or the second form",
  "A known context window in tokens, with its source",
  "A fresh session on every call",
  "Typed failures for at least authentication, rate limit or quota, and context overflow",
  "An identity of provider and model",
];

function levelCapabilities(
  level: CapabilityLevel,
  ids: readonly string[],
  descriptions: readonly string[],
): readonly LevelCapability[] {
  return ids.map((id, index) => ({
    id,
    level,
    description: descriptions[index] as string,
  }));
}

/** The six capabilities of the level `proposer` (P1 to P6). */
export const PROPOSER_CAPABILITIES = levelCapabilities(
  "proposer",
  ["P1", "P2", "P3", "P4", "P5", "P6"],
  PROPOSER_DESCRIPTIONS,
) as readonly LevelCapability[];

/** The six capabilities of the level `completion` (C1 to C6). */
export const COMPLETION_CAPABILITIES = levelCapabilities(
  "completion",
  ["C1", "C2", "C3", "C4", "C5", "C6"],
  COMPLETION_DESCRIPTIONS,
) as readonly LevelCapability[];

/** The six ids of a level, by level. */
export const LEVEL_CAPABILITY_IDS: Readonly<Record<CapabilityLevel, readonly string[]>> =
  Object.freeze({
    proposer: PROPOSER_CAPABILITIES.map((capability) => capability.id),
    completion: COMPLETION_CAPABILITIES.map((capability) => capability.id),
  });

/** One refusal of registration, with the level it names. */
export type RegistrationRefusal = {
  readonly level: CapabilityLevel | string;
  readonly reason: string;
};

/** What `checkRegistration` returns for one entry. */
export type RegistrationResult = {
  /** False only where registration itself fails (a refused entry). */
  readonly ok: boolean;
  /** Why registration failed, empty where `ok` is true. */
  readonly refusals: readonly RegistrationRefusal[];
  /** Per level: whether the entry is offered for that role. */
  readonly offered: Readonly<Record<CapabilityLevel, boolean>>;
  /** Per level: the capabilities of the level the entry lacks, empty where whole. */
  readonly missing: Readonly<Record<CapabilityLevel, readonly string[]>>;
};

/** What a candidate entry declares, enough for the check of registration. */
export type RegistrationCandidate = {
  readonly id: string;
  /** The levels the entry declares; members of the closed set or refused. */
  readonly levels: readonly string[];
  /**
   * Per declared level: the operations of that level the entry holds, named by
   * the id of the level capability (P1 to P6, C1 to C6). A level with an empty
   * list has no operation of that level, and registration fails.
   */
  readonly operations: Readonly<Record<string, readonly string[]>>;
};

/**
 * F109-FR-002 — check the registration of one entry. Pure: it reads the
 * candidate and returns the outcome; the registry applies it.
 */
export function checkRegistration(candidate: RegistrationCandidate): RegistrationResult {
  const refusals: RegistrationRefusal[] = [];
  const missing: Record<CapabilityLevel, string[]> = { proposer: [], completion: [] };
  const offered: Record<CapabilityLevel, boolean> = {
    proposer: false,
    completion: false,
  };

  for (const level of candidate.levels) {
    if (!CAPABILITY_LEVELS.includes(level as CapabilityLevel)) {
      refusals.push({
        level,
        reason: `the level \`${level}\` is not a member of the closed set ${JSON.stringify(CAPABILITY_LEVELS)}`,
      });
      continue;
    }
    const held = candidate.operations[level] ?? [];
    if (held.length === 0) {
      // A declared level without its operation fails registration
      // (CT-109-101, the characterization of Lisa's provider seam).
      refusals.push({
        level,
        reason: `the entry declares the level \`${level}\` and holds no operation of that level`,
      });
      continue;
    }
    const required = LEVEL_CAPABILITY_IDS[level as CapabilityLevel];
    const lacking = required.filter((id) => !held.includes(id));
    if (lacking.length > 0) {
      // Registered, but not offered for the role; the missing capability is
      // recorded (F109-FR-002).
      missing[level as CapabilityLevel] = lacking;
      continue;
    }
    offered[level as CapabilityLevel] = true;
  }

  return {
    ok: refusals.length === 0,
    refusals,
    offered,
    missing,
  };
}
