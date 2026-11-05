/**
 * T041 — the learning mode (F106-FR-009): the key `learning.mode`, its bound
 * `learning.through`, the aliases of annex X §X.8 and the closed set.
 *
 * The mode is a closed set with the members `off`, `suggest` and `apply` (row
 * 77 of annex X §X.6), read from feature 100's generated data through
 * `@specstride/contracts` (`learningModes`) and never written a second time.
 * The default is `off`, and a value that is not a member is read as `off`
 * (CQ-113). The keys `learning.mode` and `learning.through` carry the as-is
 * variables `SPECSTRIDE_LEARNING` and `SPECSTRIDE_LEARNING_THROUGH` as their
 * aliases (annex X §X.8, the normalization table of feature 100), and both are
 * pinnable by the launch contract: where the contract pins a value, the shell
 * loses — a supervised run receives the learning mode from the launch contract
 * and not from the environment.
 *
 * Purity: imports `@specstride/contracts` only. The environment is handed in,
 * never read here.
 */
import { learningModes } from "@specstride/contracts";

/** The configuration key of the mode. */
export const LEARNING_MODE_KEY = "learning.mode" as const;
/** The configuration key of the bound through a run id (F106-FR-027). */
export const LEARNING_THROUGH_KEY = "learning.through" as const;

/** The as-is alias of `learning.mode` (annex X §X.8). */
export const LEARNING_MODE_ALIAS = "SPECSTRIDE_LEARNING" as const;
/** The as-is alias of `learning.through` (annex X §X.8). */
export const LEARNING_THROUGH_ALIAS = "SPECSTRIDE_LEARNING_THROUGH" as const;

/** The map of the aliases: the key of the configuration to its as-is variable. */
export const LEARNING_KEY_ALIASES: Readonly<
  Record<typeof LEARNING_MODE_KEY | typeof LEARNING_THROUGH_KEY, string>
> = Object.freeze({
  [LEARNING_MODE_KEY]: LEARNING_MODE_ALIAS,
  [LEARNING_THROUGH_KEY]: LEARNING_THROUGH_ALIAS,
});

/** The two keys whose shadowing by the launch contract the doctor reports (F106-FR-031). */
export const LEARNING_PINNABLE_KEYS = [LEARNING_MODE_KEY, LEARNING_THROUGH_KEY] as const;

/**
 * The mode, normalized: a member of the closed set, or `off` for a value that
 * is not a member and for absence. The set itself comes from feature 100's
 * closed set 77 (`learningModes`); this module never restates its members.
 */
export type LearningMode = "off" | "suggest" | "apply";

/** Normalize a value of the mode: a member stays; anything else — including `null` and absence — reads as `off`. */
export function normalizeMode(value: unknown): LearningMode {
  if (typeof value === "string" && learningModes.has(value)) return value as LearningMode;
  return "off";
}

/** True when the value is a member of the closed set, before normalization. */
export function isModeLiteral(value: unknown): value is LearningMode {
  return typeof value === "string" && learningModes.has(value);
}

/** What the layer may do under a mode (F106-FR-009). */
export type ModeBehaviour = {
  /** The layer watches the runs and computes metrics and observations. */
  readonly observes: boolean;
  /** The layer lets a learned value take effect at run time. */
  readonly takesEffect: boolean;
  /** The layer evaluates applied decisions and may revert one automatically. */
  readonly evaluates: boolean;
};

/** What the layer does under each mode: nothing in `off`, observe-and-print in `suggest`, everything in `apply`. */
export const MODE_BEHAVIOUR: Readonly<Record<LearningMode, ModeBehaviour>> = Object.freeze({
  off: Object.freeze({ observes: false, takesEffect: false, evaluates: false }),
  suggest: Object.freeze({ observes: true, takesEffect: false, evaluates: true }),
  apply: Object.freeze({ observes: true, takesEffect: true, evaluates: true }),
});

/** The inputs the mode is resolved from, in the order the precedence reads them. */
export type ModeSourceInput = {
  /** The value the launch contract pinned (`configuration.learning`), if it pins one. */
  readonly pinned?: { readonly mode?: unknown; readonly through?: unknown } | null;
  /** The environment to read the as-is aliases from; handed in, never read here. */
  readonly env?: Readonly<Record<string, string | undefined>> | null;
};

/** The resolved mode, its bound, and where each came from. */
export type ResolvedMode = {
  readonly mode: LearningMode;
  readonly through: string | null;
  readonly modeSource: "launch-contract" | "environment" | "default";
  readonly throughSource: "launch-contract" | "environment" | "default";
};

/**
 * Resolve the mode and its bound (F106-FR-009): the launch contract's pin
 * wins, then the as-is alias of the environment, then the default `off`. A
 * pinned value that is not a member is read as `off`, like any other unknown
 * value (CQ-113). A through that is not a non-empty run id is no bound.
 */
export function resolveMode(input: ModeSourceInput = {}): ResolvedMode {
  const env = input.env ?? {};
  const pinnedMode = input.pinned?.mode;
  const envMode = env[LEARNING_MODE_ALIAS];
  const mode =
    pinnedMode !== undefined && pinnedMode !== null
      ? normalizeMode(pinnedMode)
      : envMode !== undefined && envMode !== ""
        ? normalizeMode(envMode)
        : "off";
  const modeSource: ResolvedMode["modeSource"] =
    pinnedMode !== undefined && pinnedMode !== null
      ? "launch-contract"
      : envMode !== undefined && envMode !== ""
        ? "environment"
        : "default";

  const pinnedThrough = input.pinned?.through;
  const envThrough = env[LEARNING_THROUGH_ALIAS];
  const rawThrough =
    pinnedThrough !== undefined && pinnedThrough !== null
      ? pinnedThrough
      : envThrough !== undefined && envThrough !== ""
        ? envThrough
        : undefined;
  const through = isRunIdText(rawThrough) ? String(rawThrough) : null;
  const throughSource: ResolvedMode["throughSource"] =
    rawThrough === undefined
      ? "default"
      : through !== null
        ? pinnedThrough !== undefined && pinnedThrough !== null
          ? "launch-contract"
          : "environment"
        : "default";
  return Object.freeze({ mode, through, modeSource, throughSource });
}

/** A bound `through` is a literal non-empty run id (the binding contract). */
export function isRunIdText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The strip record: in a supervised run both aliases are removed from the stage environment (F106-FR-030). */
export const STRIPPED_ENVIRONMENT_KEYS = [LEARNING_MODE_ALIAS, LEARNING_THROUGH_ALIAS] as const;

/** The keys of the binding block of the launch contract (the binding contract; annex G §G.8). */
export const BINDING_KEYS = [
  "mode",
  "decisions_through",
  "decisions_sha256",
  "effective",
  "source_path",
] as const;
