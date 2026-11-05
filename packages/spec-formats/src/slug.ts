/**
 * T015 — feature selection and the ONE slug rule (F104-FR-003).
 *
 * Two different questions live here, and the requirement keeps them apart:
 *
 *  1. **Selection.** With several candidates, `--feature` picks the FIRST
 *     candidate whose parent directory name equals the RAW, unsanitized
 *     feature value (B-0243). The slug rule is not applied to the comparison:
 *     a value that needs sanitising matches no directory and the resolution
 *     fails with the one-line message of F104-FR-004.
 *  2. **The slug.** The feature slug is derived ONCE by one rule, and it is
 *     the namespace of the durable state. An explicit value is sanitised
 *     (B-0246, B-2044); without one the slug comes from the location of the
 *     spec (B-2045), and anything else is `default`.
 *
 * `spec feature-slug` answers BEFORE the spec is read (F104-FR-003), so
 * nothing in this module parses a line of a specification: it reads path
 * names and the presence of the `.specify` marker only.
 *
 * One reading had to be chosen. The two records of the baseline, both rows of
 * `docs/ecosystem/research/R18-behaviour-inventory.tsv`, state the sanitising
 * differently: row B-0246 replaces EVERY character outside `A-Za-z0-9._-`
 * with a hyphen, while row B-2044 (`lib/specstride_spec.py:520`) collapses a
 * RUN of them to one hyphen. F104-FR-003 is the authority over the behaviour inventory and says
 * "every character ... replaced by a hyphen", so that is what
 * `slugOfAnExplicitFeature` does; `collapsingSlugOfAnExplicitFeature` carries
 * the other reading so that a test can measure the difference, which is
 * observable only where two forbidden characters stand next to each other.
 */
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-003"] as const;

/** The records of the baseline this module is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-0243",
  "B-0246",
  "B-0247",
  "B-2043",
  "B-2044",
  "B-2045",
  "B-0806",
]);

/** The slug when nothing names a feature (F104-FR-003). */
export const DEFAULT_SLUG = "default" as const;

/** The characters a slug may hold: letters, digits, dot, underscore, hyphen. */
export const SLUG_ALLOWED = /[A-Za-z0-9._-]/;

/** One character outside the allowed set. */
const ONE_FORBIDDEN = /[^A-Za-z0-9._-]/g;
/** A run of characters outside the allowed set (the other reading, B-2044). */
const A_RUN_OF_FORBIDDEN = /[^A-Za-z0-9._-]+/g;

/** The marker directory of a Spec Kit project (B-2043). */
export const SPEC_KIT_PROJECT_MARKER = ".specify" as const;

/** The path shape of an OpenSpec change whose directory name is the slug. */
export const OPENSPEC_CHANGE_PATH = /(?:^|\/)openspec\/changes\/([^/]+)\/[^/]+$/;

/** `spec feature-slug` answers before the spec is read (F104-FR-003). */
export const ANSWERED_BEFORE_THE_SPEC_IS_READ = true as const;

/**
 * The slug of an EXPLICIT feature value, by the one rule of F104-FR-003:
 * every character outside letters, digits, dot, underscore and hyphen becomes
 * a hyphen, leading and trailing hyphens are removed, and an empty result
 * becomes `default`.
 */
export function slugOfAnExplicitFeature(value: string): string {
  const replaced = value.replace(ONE_FORBIDDEN, "-");
  const trimmed = stripOuterHyphens(replaced);
  return trimmed === "" ? DEFAULT_SLUG : trimmed;
}

/**
 * The other reading of the sanitising, `lib/specstride_spec.py:520` (B-2044),
 * in which a RUN of forbidden characters collapses to one hyphen. It is NOT
 * the rule of this feature; it is here so that `test/slug.test.ts` can measure
 * where the two readings differ instead of asserting that they never do.
 */
export function collapsingSlugOfAnExplicitFeature(value: string): string {
  const replaced = value.replace(A_RUN_OF_FORBIDDEN, "-");
  const trimmed = stripOuterHyphens(replaced);
  return trimmed === "" ? DEFAULT_SLUG : trimmed;
}

/** Leading and trailing hyphens removed (both readings do this). */
function stripOuterHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start += 1;
  while (end > start && value[end - 1] === "-") end -= 1;
  return value.slice(start, end);
}

/**
 * The root of the Spec Kit project a spec sits in: the nearest directory at or
 * above the spec's own directory that holds a `.specify` entry (B-2043).
 * `undefined` where the walk reaches the file-system root without finding one.
 */
export function specKitProjectRootOf(
  specDirectory: string,
  options: { readonly exists?: (path: string) => boolean } = {},
): string | undefined {
  const exists = options.exists ?? existsSync;
  let directory = isAbsolute(specDirectory) ? specDirectory : resolve(specDirectory);
  for (;;) {
    if (exists(`${directory}${sep}${SPEC_KIT_PROJECT_MARKER}`)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** The change directory of a spec at `openspec/changes/<change>/<file>`. */
export function openspecChangeOf(specPath: string): string | undefined {
  const match = OPENSPEC_CHANGE_PATH.exec(specPath.split(sep).join("/"));
  return match?.[1];
}

/**
 * The slug a spec's LOCATION gives, with no explicit value (B-2045):
 *
 *  - an OpenSpec change uses its change directory name;
 *  - a spec inside a `.specify` project uses its feature directory name;
 *  - a spec at the project root, or any other spec, is `default`.
 *
 * The result is passed through the sanitising rule, so a directory name with a
 * character outside the allowed set still yields a usable namespace.
 */
export function featureSlugOfASpecLocation(
  specPath: string,
  options: { readonly exists?: (path: string) => boolean } = {},
): string {
  const change = openspecChangeOf(specPath);
  if (change !== undefined) return slugOfAnExplicitFeature(change);
  const directory = dirname(isAbsolute(specPath) ? specPath : resolve(specPath));
  const root = specKitProjectRootOf(directory, options);
  if (root === undefined) return DEFAULT_SLUG;
  if (resolve(root) === resolve(directory)) return DEFAULT_SLUG;
  return slugOfAnExplicitFeature(basename(directory));
}

/** What the slug was derived from, so that a caller can report it. */
export type SlugSource = "explicit" | "openspec-change" | "spec-kit-feature" | "default";

/** The slug with the source it came from. */
export type FeatureSlug = { readonly slug: string; readonly source: SlugSource };

/**
 * The ONE derivation of F104-FR-003: an explicit value wins, else the location
 * of the spec, else `default`. `explicit` is the value of `--feature` or of the
 * key `spec.feature`, in that order, which `resolveFeatureInput` of
 * `registry.ts` has already settled (F104-FR-007).
 */
export function featureSlug(
  request: {
    readonly explicit?: string | undefined;
    readonly specPath?: string | undefined;
  },
  options: { readonly exists?: (path: string) => boolean } = {},
): FeatureSlug {
  const explicit = request.explicit;
  if (explicit !== undefined && explicit !== "") {
    return Object.freeze({ slug: slugOfAnExplicitFeature(explicit), source: "explicit" as const });
  }
  const specPath = request.specPath;
  if (specPath === undefined || specPath === "") {
    return Object.freeze({ slug: DEFAULT_SLUG, source: "default" as const });
  }
  if (openspecChangeOf(specPath) !== undefined) {
    return Object.freeze({
      slug: featureSlugOfASpecLocation(specPath, options),
      source: "openspec-change" as const,
    });
  }
  const slug = featureSlugOfASpecLocation(specPath, options);
  return Object.freeze({
    slug,
    source: slug === DEFAULT_SLUG ? ("default" as const) : ("spec-kit-feature" as const),
  });
}

/** What selection needs of a candidate: its path and its parent directory name. */
export type SelectableCandidate = { readonly path: string; readonly parentName: string };

/**
 * Selection among several candidates (F104-FR-003, B-0243): the FIRST candidate
 * whose parent directory name equals the RAW, unsanitized feature value. The
 * comparison is on the raw value by requirement, so a value such as `my
 * feature` matches the directory `my feature` and not `my-feature`.
 */
export function selectCandidateByFeature<T extends SelectableCandidate>(
  candidates: readonly T[],
  rawFeature: string,
): T | undefined {
  return candidates.find((candidate) => candidate.parentName === rawFeature);
}

/** The comparison of `selectCandidateByFeature` uses the unsanitized value. */
export const SELECTION_USES_THE_RAW_VALUE = true as const;
