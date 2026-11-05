/**
 * T248 — the four trust classes as data and type, and the filter over project
 * configuration (annex X, §X.2; F100-FR-202).
 *
 * Project configuration narrows a run and never widens it. A widening key in
 * project configuration is dropped with the launch message and the doctor
 * warning; a narrowing key is accepted only where its value is stricter than
 * the value from the lower ranks.
 */
import ranksData from "../../data/config-ranks.json" with { type: "json" };
import { rankOfLayer, type RankLayer } from "./config.ts";

type RawClass = { Class: string; Meaning: string; "Project configuration": string };

/** The four trust classes of §X.2. */
export const TRUST_CLASSES = ["widening", "narrowing", "neutral", "pinnable"] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

/** One row of the table of trust classes. */
export type TrustClassRow = {
  readonly trustClass: TrustClass;
  /** The class as the annex writes it. */
  readonly label: string;
  readonly meaning: string;
  /** What project configuration does with a key of the class. */
  readonly projectConfiguration: string;
};

const RAW = (ranksData as { trustClasses: RawClass[] }).trustClasses;

export const trustClassRows: readonly TrustClassRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      trustClass: row.Class.toLowerCase() as TrustClass,
      label: row.Class,
      meaning: row.Meaning,
      projectConfiguration: row["Project configuration"],
    }),
  ),
);

/** A key without a trust class is widening (annex X §X.6 row 76). */
export const TRUST_CLASS_DEFAULT: TrustClass = "widening";

/** The rank of project configuration (5). */
export const PROJECT_RANK = rankOfLayer["project-configuration"];

/** What the filter did with one key of project configuration. */
export type FilterOutcome =
  | { readonly key: string; readonly accepted: true; readonly value: unknown }
  | {
      readonly key: string;
      readonly accepted: false;
      readonly reason: "widening" | "not-stricter";
      /** The line the launch prints (F100-FR-202). */
      readonly launchMessage: string;
      /** The finding the doctor shows (F100-FR-202). */
      readonly doctorWarning: string;
    };

/** How a caller compares two values of a narrowing key. */
export type Stricter = (candidate: unknown, fromLowerRanks: unknown) => boolean;

/**
 * The default comparison for a narrowing key: a cap, a budget or a time limit
 * is stricter when it is smaller; a mode that switches something off is
 * stricter than one that leaves it on.
 */
export const defaultStricter: Stricter = (candidate, fromLowerRanks) => {
  if (typeof candidate === "number" && typeof fromLowerRanks === "number") {
    return candidate < fromLowerRanks;
  }
  if (typeof candidate === "boolean" && typeof fromLowerRanks === "boolean") {
    return candidate === false && fromLowerRanks === true;
  }
  return false;
};

/**
 * F100-FR-202 — the filter over project configuration.
 *
 * A widening key is dropped with the launch message and the doctor warning. A
 * narrowing key is accepted only where its value is stricter than the value
 * from the lower ranks. A neutral key is accepted. A pinnable key follows its
 * other class.
 */
export function filterProjectKey(
  key: string,
  value: unknown,
  trustClass: TrustClass | undefined,
  fromLowerRanks: unknown,
  stricter: Stricter = defaultStricter,
): FilterOutcome {
  const cls = trustClass ?? TRUST_CLASS_DEFAULT;
  if (cls === "widening") {
    return {
      key,
      accepted: false,
      reason: "widening",
      launchMessage:
        `project configuration cannot widen a run: the key \`${key}\` is widening ` +
        `and was ignored (F100-FR-202)`,
      doctorWarning:
        `the project configuration file sets the widening key \`${key}\`; ` +
        `it is ignored (F100-FR-202)`,
    };
  }
  if (cls === "narrowing") {
    if (fromLowerRanks === undefined || stricter(value, fromLowerRanks)) {
      return { key, accepted: true, value };
    }
    return {
      key,
      accepted: false,
      reason: "not-stricter",
      launchMessage:
        `project configuration cannot loosen a run: the key \`${key}\` is not ` +
        `stricter than the value from the lower ranks and was ignored (F100-FR-202)`,
      doctorWarning:
        `the project configuration file sets \`${key}\` no stricter than the ` +
        `value from the lower ranks; it is ignored (F100-FR-202)`,
    };
  }
  return { key, accepted: true, value };
}

/** Filter a whole project configuration file (F100-FR-202). */
export function filterProjectConfiguration(
  keys: Readonly<Record<string, unknown>>,
  classOf: (key: string) => TrustClass | undefined,
  fromLowerRanks: (key: string) => unknown,
  stricter: Stricter = defaultStricter,
): readonly FilterOutcome[] {
  return Object.freeze(
    Object.entries(keys).map(([key, value]) =>
      filterProjectKey(key, value, classOf(key), fromLowerRanks(key), stricter),
    ),
  );
}

/** Project configuration is the only rank that a trust class filters. */
export const FILTERED_RANK: RankLayer = "project-configuration";

/** Widening keys the annex names by hand (annex X, §X.2). */
export const NAMED_WIDENING_KEYS = [
  "roles.<role>.tier",
  "harnesses.<id>.authTier",
  "distribution.termsOverride",
  "loop.parallel.allow_detect",
  "profile",
] as const;
