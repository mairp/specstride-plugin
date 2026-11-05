/**
 * T019 — the trust filter over project configuration (F110-FR-017,
 * F110-FR-018, F110-FR-019).
 *
 * F110-FR-017: project configuration narrows a run and never widens it. A key
 * of the class widening in the project file is ignored, with one launch message
 * that names the file and the key and one doctor warning; under the `parity`
 * profile the launch message is not printed (row 19 of annex X §X.7) and the
 * doctor warning stays. The run goes on.
 *
 * F110-FR-018: a key of the class narrowing in the project file is accepted only
 * if its value is stricter than the value the ranks below the project file would
 * give, by the direction of the catalogue. An equal value is accepted. A looser
 * value is ignored with one launch message. A list whose direction is `sub` is
 * accepted only as a subset.
 *
 * F110-FR-019: the keys that widen are accepted from user file, environment and
 * flags only; five of them from the user file only. Project configuration may add
 * task ids to `loop.parallel.exclude` and may narrow a declared write scope to a
 * subset; it may not remove a task id of a lower rank and may not add or widen a
 * scope, and a scope wider than the declared one is refused with a doctor
 * finding.
 *
 * The four trust classes themselves are feature 100's contract
 * (`@specstride/contracts`, `envelope/trust-classes`). What this module owns is
 * the content: which key is in which class (the catalogue of §K.1), what
 * "stricter" means for each direction of the catalogue, and the keys
 * F110-FR-019 names by hand.
 */
import { mayBeWritten } from "@specstride/contracts/grammar/output-modes";
import type { Finding } from "@specstride/contracts/records/doctor-findings";
import {
  FILTERED_RANK,
  TRUST_CLASS_DEFAULT,
  type TrustClass,
} from "@specstride/contracts/envelope/trust-classes";

import { matchCatalogueKey } from "../schema/catalogue.ts";
import { validateKeyValue } from "../schema/validate.ts";
import {
  ConfigValueError,
  UnknownKeyError,
  type KeyEntry,
  type NarrowingDirection,
} from "../schema/types.ts";
import { PROFILE_NAME } from "../schema/profile.ts";
import type { LoadedConfigFile } from "./files.ts";

/** The rank a trust class filters: project configuration, and no other. */
export { FILTERED_RANK };

/** The trust class of a key, from the column "Class" of §K.1. */
export function trustClassOf(key: string): TrustClass {
  const entry = matchCatalogueKey(key)?.entry;
  if (entry === undefined) return TRUST_CLASS_DEFAULT;
  if (entry.trust === "W") return "widening";
  if (entry.trust === "N") return "narrowing";
  return "neutral";
}

/**
 * F110-FR-019, third sentence — the keys whose column "Layers" omits `P` but
 * whose note lets the project file narrow them: `P lowers` and `P narrows`.
 * `loop.parallel.workersMax` is widening and the project file may lower it;
 * `loop.parallel.scopes.<taskId>` is widening and the project file may narrow it
 * to a subset.
 */
export function projectMayNarrow(entry: KeyEntry): NarrowingDirection | undefined {
  if (/\bP\s+(may\s+)?lowers?\b/i.test(entry.layerNote)) return "lo";
  if (/\bP\s+narrows?\b/i.test(entry.layerNote)) return "sub";
  return undefined;
}

/**
 * The five keys F110-FR-019 accepts from the user file only (CQ-183, CQ-205).
 * `sandbox.level` is accepted from flag and environment except for the one value
 * that opts into containment C0.
 */
export const USER_FILE_ONLY: readonly {
  readonly key: string;
  /** Where set, only this value is restricted to the user file. */
  readonly onlyForValue?: string;
}[] = Object.freeze([
  Object.freeze({ key: "loop.parallel.allow_detect" }),
  Object.freeze({ key: "sandbox.level", onlyForValue: "C0" }),
  Object.freeze({ key: "distribution.audience" }),
  Object.freeze({ key: "distribution.termsOverride" }),
  Object.freeze({ key: "toolchains.<id>" }),
]);

/** True where a value of a key may come from the user file only (F110-FR-019). */
export function isUserFileOnly(key: string, value: unknown): boolean {
  const entry = matchCatalogueKey(key)?.entry;
  const catalogueKey = entry?.key ?? key;
  return USER_FILE_ONLY.some((row) => {
    if (row.key !== catalogueKey && row.key !== key) return false;
    if (row.onlyForValue === undefined) return true;
    return String(value) === row.onlyForValue;
  });
}

/**
 * The keys F110-FR-019 names as widening, accepted from user file, environment
 * and flags only. `verification.scopes.<commandId>.reads`, `.writes` and
 * `.sideEffects` are named here by their spelling because the catalogue of this
 * feature does not carry them: they belong to feature 107's contract
 * (`contracts/README.md`), and F110-FR-019 names them all the same.
 */
export const WIDENING_KEYS_OF_FR019: readonly string[] = Object.freeze([
  "harnesses.<id>.pluginAllowlist",
  "harnesses.<id>.bin",
  "engine.executable",
  "harnesses.<id>.transport",
  "loop.parallel.scopes.<taskId>",
  "verification.scopes.<commandId>.reads",
  "verification.scopes.<commandId>.writes",
  "verification.scopes.<commandId>.sideEffects",
  "state.dir",
]);

/**
 * What no project key, comment or file inside the repository may declare
 * (F110-FR-017, last sentence), with the key patterns of each.
 */
export const PROJECT_MUST_NOT_DECLARE: readonly {
  readonly what: string;
  readonly patterns: readonly RegExp[];
}[] = Object.freeze([
  Object.freeze({ what: "a harness", patterns: [/^harnesses\.[^.]+$/, /\.harness$/] }),
  Object.freeze({
    what: "its command line",
    patterns: [/^harnesses\.[^.]+\.bin$/, /^engine\.executable$/, /\.launcher$/],
  }),
  Object.freeze({ what: "an endpoint", patterns: [/\.url$/i, /\.endpoint$/i, /\.baseUrl$/i] }),
  Object.freeze({ what: "a secret reference", patterns: [/\.credential$/, /\.token$/] }),
  Object.freeze({ what: "a critic", patterns: [/^roles\.critic\./, /^critic\./] }),
  Object.freeze({ what: "a containment level", patterns: [/^sandbox\.level$/] }),
  Object.freeze({ what: "a permission flag", patterns: [/^sandbox\.permissionMode$/] }),
  Object.freeze({ what: "a budget increase", patterns: [/^budget\./, /^quota\./] }),
  Object.freeze({ what: "a host hook", patterns: [/^host\./, /^hooks\./] }),
  Object.freeze({ what: "a telemetry address", patterns: [/^telemetry\..*\.url$/] }),
  Object.freeze({ what: "content capture", patterns: [/\.captureContent$/, /^traces\./] }),
]);

/** What a project key would declare, where it would declare one of them. */
export function projectWouldDeclare(key: string): string | undefined {
  for (const row of PROJECT_MUST_NOT_DECLARE) {
    if (row.patterns.some((pattern) => pattern.test(key))) return row.what;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * F110-FR-018 — what "stricter" means, by the direction of the catalogue.
 * ------------------------------------------------------------------ */

const asList = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? (value as readonly unknown[]) : undefined;

const isSubset = (candidate: readonly unknown[], of: readonly unknown[]): boolean =>
  candidate.every((item) => of.includes(item));

const truthy = (value: unknown): boolean =>
  value === true || value === "on" || value === "true" || value === "yes";

/** Two values of a key that stand for the same setting (F110-FR-018). */
export function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const la = asList(a);
  const lb = asList(b);
  if (la !== undefined && lb !== undefined) {
    return la.length === lb.length && la.every((item, i) => item === lb[i]);
  }
  return false;
}

/**
 * F110-FR-018 — the prose directions of the catalogue. Three forms stand in
 * §K.3 to §K.6b: a chain (`required is stricter than plan, plan than off`), a
 * superset (`a superset is stricter`, `a superset of the check points is
 * stricter`) and one named value (`classic is stricter`, `supervise is
 * stricter`, `strict`).
 */
export function stricterByProse(
  note: string,
  candidate: unknown,
  fromLowerRanks: unknown,
): boolean | undefined {
  const chain = /([\w-]+) is stricter than ([\w-]+), \2 than ([\w-]+)/.exec(note);
  if (chain !== null) {
    const order = [chain[1] as string, chain[2] as string, chain[3] as string];
    const a = order.indexOf(String(candidate));
    const b = order.indexOf(String(fromLowerRanks));
    if (a < 0 || b < 0) return undefined;
    return a <= b;
  }
  if (/superset/i.test(note)) {
    const c = asList(candidate);
    const l = asList(fromLowerRanks);
    if (c === undefined || l === undefined) return undefined;
    return isSubset(l, c);
  }
  const named = /^\(?\s*`?([\w-]+)`?\s*(is stricter)?\)?$/.exec(note.trim());
  if (named !== null) {
    const strictest = named[1] as string;
    if (String(fromLowerRanks) === strictest) return String(candidate) === strictest;
    return String(candidate) === strictest || String(candidate) === String(fromLowerRanks);
  }
  return undefined;
}

/**
 * F110-FR-018 — is the candidate stricter than, or equal to, the value the
 * ranks below the project file would give? The direction is the one the
 * catalogue states: `lo` lower is stricter, `lo0` lower is stricter and 0 means
 * unlimited, `on` or `off` the stricter value, `sub` a subset, `prose` the rule
 * the annex writes out. With nothing from the lower ranks there is nothing to
 * loosen, so the value is accepted.
 */
export function isStricterOrEqual(
  entry: KeyEntry,
  candidate: unknown,
  fromLowerRanks: unknown,
  direction: NarrowingDirection | undefined = entry.narrowing,
): boolean {
  if (fromLowerRanks === undefined || fromLowerRanks === null) return true;
  // F110-FR-018, second sentence — an equal value is accepted, whatever the
  // direction. It is tested before the directions, so that a direction whose
  // own rule reads strictly (`lo0`, where 0 is the loosest value there is)
  // cannot refuse a value that only repeats the lower rank.
  if (equalValues(candidate, fromLowerRanks)) return true;
  switch (direction) {
    case "lo":
      return (
        typeof candidate === "number" &&
        typeof fromLowerRanks === "number" &&
        candidate <= fromLowerRanks
      );
    case "lo0": {
      if (typeof candidate !== "number" || typeof fromLowerRanks !== "number") return false;
      // 0 is "unlimited", the loosest value there is: it never narrows, and any
      // other value narrows it.
      if (fromLowerRanks === 0) return candidate !== 0;
      if (candidate === 0) return false;
      return candidate <= fromLowerRanks;
    }
    case "on":
      return truthy(candidate) || truthy(candidate) === truthy(fromLowerRanks);
    case "off":
      return !truthy(candidate) || truthy(candidate) === truthy(fromLowerRanks);
    case "sub": {
      const c = asList(candidate);
      const l = asList(fromLowerRanks);
      if (c === undefined || l === undefined) return false;
      return isSubset(c, l);
    }
    case "prose":
      return stricterByProse(entry.narrowingNote ?? "", candidate, fromLowerRanks) ?? false;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * The filter.
 * ------------------------------------------------------------------ */

/** Why the filter ignored a value of the project file. */
export const IGNORED_REASONS = [
  "widening",
  "not-stricter",
  "user-file-only",
  "wider-scope",
  "removes-an-exclusion",
] as const;
export type IgnoredReason = (typeof IGNORED_REASONS)[number];

/** What the filter did with one key of one layer. */
export type TrustOutcome =
  | {
      readonly key: string;
      readonly accepted: true;
      readonly value: unknown;
      /** Why it was accepted: the trust class, or the narrowing it is. */
      readonly why: "neutral" | "narrowing" | "project-may-narrow" | "adds-an-exclusion";
    }
  | {
      readonly key: string;
      readonly accepted: false;
      readonly reason: IgnoredReason;
      /** The one launch message of F110-FR-017: it names the file and the key. */
      readonly launchMessage: string;
      /**
       * False under the `parity` profile, where no line without an as-is
       * equivalent is printed (row 19 of annex X §X.7); the doctor finding stays.
       */
      readonly launchMessageIsPrinted: boolean;
      /** The one doctor finding of F110-FR-017. */
      readonly finding: Finding;
    };

/** The doctor finding ids this feature records, in the group `config` (§G.7). */
export const FINDING_IDS = Object.freeze({
  widening: "config.project-widening",
  notStricter: "config.project-not-stricter",
  userFileOnly: "config.user-file-only",
  widerScope: "config.project-scope-wider",
  removesAnExclusion: "config.project-removes-exclusion",
  shadowedEnvironment: "config.shadowed-environment",
});

/** What the filter is told about the run it filters for. */
export interface ProjectFilterContext {
  /** The path of the project file, which every launch message names. */
  readonly path: string;
  /** The value the ranks below the project file would give for a key. */
  readonly fromLowerRanks: (key: string) => unknown;
  /** The profile in force, where one is selected. */
  readonly profile?: string | undefined;
  /** The declared scopes a project scope may only narrow (F110-FR-019). */
  readonly declaredScopes?: Readonly<Record<string, readonly string[]>> | undefined;
}

/**
 * Row 19 of annex X §X.7 through F100-FR-176 — a launch message of this
 * feature has no as-is equivalent, so under the `parity` profile it is printed
 * on no stream, and outside it, it is printed.
 */
export function launchMessageIsPrinted(profile: string | undefined): boolean {
  return mayBeWritten(
    { stream: "stderr", hasAnAsIsEquivalent: false, featureIsOn: true },
    profile === PROFILE_NAME ? PROFILE_NAME : undefined,
  ).allowed;
}

const ignored = (
  key: string,
  reason: IgnoredReason,
  launchMessage: string,
  finding: Finding,
  profile: string | undefined,
): TrustOutcome =>
  Object.freeze({
    key,
    accepted: false,
    reason,
    launchMessage,
    launchMessageIsPrinted: launchMessageIsPrinted(profile),
    finding,
  });

/**
 * F110-FR-017 to F110-FR-019 — filter one key of the project file.
 *
 * The order is the order of the requirements: a key that may come from the user
 * file only is ignored first (F110-FR-019), then a scope or an exclusion with
 * its own rule, then a widening key (F110-FR-017), then a narrowing key against
 * the lower ranks (F110-FR-018). A neutral key is accepted.
 */
export function filterProjectKey(
  key: string,
  value: unknown,
  context: ProjectFilterContext,
): TrustOutcome {
  const match = matchCatalogueKey(key);
  const entry = match?.entry;
  const file = context.path;
  const profile = context.profile;

  if (isUserFileOnly(key, value)) {
    return ignored(
      key,
      "user-file-only",
      `${file}: the key \`${key}\` is accepted from the user file only and was ignored ` +
        `(F110-FR-019)`,
      Object.freeze({
        id: FINDING_IDS.userFileOnly,
        severity: "warn",
        lb: false,
        message: `\`${key}\` is set in project configuration and is accepted from the user file only`,
        fix: `remove \`${key}\` from ${file} and set it in the user configuration file`,
        evidence: `${file}: \`${key}\``,
      }),
      profile,
    );
  }

  // F110-FR-019 — a declared scope may be narrowed to a subset and never widened.
  const scope = /^loop\.parallel\.scopes\.([^.]+)$/.exec(key);
  if (scope !== null) {
    const taskId = scope[1] as string;
    const declared =
      context.declaredScopes?.[taskId] ??
      (context.fromLowerRanks(key) as readonly string[] | undefined);
    const candidate = asList(value) ?? [];
    if (declared === undefined) {
      return ignored(
        key,
        "wider-scope",
        `${file}: the key \`${key}\` adds a write scope for the task \`${taskId}\`, which no ` +
          `higher-trust layer declared, and was refused (F110-FR-019)`,
        Object.freeze({
          id: FINDING_IDS.widerScope,
          severity: "fail",
          lb: false,
          message: `project configuration adds the write scope \`${key}\`, which is not declared`,
          fix: `declare the scope of \`${taskId}\` in user configuration, a flag or the environment`,
          evidence: `${file}: \`${key}\``,
        }),
        profile,
      );
    }
    if (!isSubset(candidate, declared)) {
      return ignored(
        key,
        "wider-scope",
        `${file}: the write scope of \`${taskId}\` is wider than the declared one and was ` +
          `refused (F110-FR-019)`,
        Object.freeze({
          id: FINDING_IDS.widerScope,
          severity: "fail",
          lb: false,
          message: `project configuration widens the write scope of \`${taskId}\``,
          fix: `narrow \`${key}\` in ${file} to a subset of the declared scope`,
          evidence: `${file}: \`${key}\``,
        }),
        profile,
      );
    }
    return Object.freeze({ key, accepted: true, value, why: "project-may-narrow" });
  }

  // F110-FR-019 — the project file may add task ids to the exclusion of parallel
  // units and may never remove one.
  if (key === "loop.parallel.exclude") {
    const lower = asList(context.fromLowerRanks(key)) ?? [];
    const candidate = asList(value) ?? [];
    if (!isSubset(lower, candidate)) {
      const removed = lower.filter((id) => !candidate.includes(id));
      return ignored(
        key,
        "removes-an-exclusion",
        `${file}: the key \`${key}\` removes the task ${removed
          .map((id) => `\`${String(id)}\``)
          .join(", ")} from the exclusion of a lower rank and was ignored (F110-FR-019)`,
        Object.freeze({
          id: FINDING_IDS.removesAnExclusion,
          severity: "warn",
          lb: false,
          message: `project configuration removes a task id from \`${key}\``,
          fix: `keep every task id of the lower ranks in \`${key}\` of ${file}`,
          evidence: `${file}: \`${key}\``,
        }),
        profile,
      );
    }
    return Object.freeze({ key, accepted: true, value, why: "adds-an-exclusion" });
  }

  const narrowByNote = entry === undefined ? undefined : projectMayNarrow(entry);
  const cls = trustClassOf(key);

  if (cls === "widening" && narrowByNote === undefined) {
    const declares = projectWouldDeclare(key);
    return ignored(
      key,
      "widening",
      `${file}: the key \`${key}\` is of the class widening and was ignored; project ` +
        `configuration narrows a run and never widens it (F110-FR-017)` +
        (declares === undefined ? "" : `. No project key may declare ${declares}`),
      Object.freeze({
        id: FINDING_IDS.widening,
        severity: "warn",
        lb: false,
        message: `project configuration sets the widening key \`${key}\`; it is ignored`,
        fix: `set \`${key}\` in user configuration, a flag or the environment instead`,
        evidence: `${file}: \`${key}\``,
      }),
      profile,
    );
  }

  if (cls === "narrowing" || narrowByNote !== undefined) {
    const lower = context.fromLowerRanks(key);
    const direction = narrowByNote ?? entry?.narrowing;
    if (entry !== undefined && isStricterOrEqual(entry, value, lower, direction)) {
      return Object.freeze({
        key,
        accepted: true,
        value,
        why: narrowByNote === undefined ? "narrowing" : "project-may-narrow",
      });
    }
    return ignored(
      key,
      "not-stricter",
      `${file}: the key \`${key}\` is set to ${JSON.stringify(value) ?? String(value)}, which is ` +
        `not stricter than the value the ranks below the project file give ` +
        `(${JSON.stringify(lower) ?? String(lower)}); it was ignored and the lower value ` +
        `applies (F110-FR-018)`,
      Object.freeze({
        id: FINDING_IDS.notStricter,
        severity: "warn",
        lb: false,
        message: `\`${key}\` in project configuration is not stricter than the lower ranks`,
        fix: `set \`${key}\` no looser than the value of the lower ranks, or remove it from ${file}`,
        evidence: `${file}: \`${key}\``,
      }),
      profile,
    );
  }

  return Object.freeze({ key, accepted: true, value, why: "neutral" });
}

/** One key and value read from the project file, before the trust filter. */
export interface ProjectValue {
  readonly key: string;
  readonly value: unknown;
}

/**
 * Every key the project file sets, including the keys whose column "Layers"
 * omits `P`.
 *
 * The file loader of T011 validates each value against the layers of the
 * catalogue and records a key whose layers omit `P` as a `layer-not-allowed`
 * error. For rank 5 the more specific rule is F110-FR-017: such a key is
 * **ignored**, with one launch message and one doctor warning, and the run goes
 * on. This function hands both halves to the filter, which decides.
 */
export function projectValuesOfFile(file: LoadedConfigFile): readonly ProjectValue[] {
  const values: ProjectValue[] = [...file.values].map(([key, value]) => ({ key, value }));
  for (const error of file.errors) {
    if (error instanceof ConfigValueError && error.reason === "layer-not-allowed") {
      values.push({ key: error.key, value: error.value });
    }
  }
  return Object.freeze(values);
}

/**
 * F110-FR-017, F110-FR-018 — filter every key of the project file. Exactly one
 * outcome per key, so exactly one launch message and one doctor finding per
 * ignored key.
 *
 * A value the loader of T011 never type-checked — a key whose layers omit `P`,
 * which the loader refused before it read the value — is validated here against
 * the user-file layer, which the catalogue does allow for every such key, so
 * that an accepted narrowing value is of the key's own type.
 */
export function filterProjectOffers(
  values: readonly ProjectValue[],
  context: ProjectFilterContext,
): {
  readonly outcomes: readonly TrustOutcome[];
  readonly errors: readonly (ConfigValueError | UnknownKeyError)[];
} {
  const outcomes: TrustOutcome[] = [];
  const errors: (ConfigValueError | UnknownKeyError)[] = [];
  for (const { key, value } of values) {
    const outcome = filterProjectKey(key, value, context);
    if (!outcome.accepted) {
      outcomes.push(outcome);
      continue;
    }
    const verdict = validateKeyValue(key, outcome.value, "U", { place: context.path });
    if (verdict.ok) {
      outcomes.push(Object.freeze({ ...outcome, value: verdict.value }));
    } else {
      errors.push(verdict.error);
    }
  }
  return Object.freeze({ outcomes: Object.freeze(outcomes), errors: Object.freeze(errors) });
}

/**
 * F110-FR-019, second sentence — a value of one of the five user-file-only keys
 * that comes from the environment, a flag or project configuration is ignored
 * with a launch message and a doctor warning.
 */
export function filterUserFileOnly(
  key: string,
  value: unknown,
  place: string,
  profile: string | undefined = undefined,
): TrustOutcome {
  if (!isUserFileOnly(key, value)) {
    return Object.freeze({ key, accepted: true, value, why: "neutral" });
  }
  return ignored(
    key,
    "user-file-only",
    `${place}: the key \`${key}\` is accepted from the user file only and was ignored ` +
      `(F110-FR-019, F100-FR-111, F100-FR-112, F100-FR-028)`,
    Object.freeze({
      id: FINDING_IDS.userFileOnly,
      severity: "warn",
      lb: false,
      message: `\`${key}\` was set at ${place} and is accepted from the user file only`,
      fix: `set \`${key}\` in the user configuration file`,
      evidence: `${place}: \`${key}\``,
    }),
    profile,
  );
}

/** Every launch message of a set of outcomes that is printed (F110-FR-017). */
export function launchMessagesOf(outcomes: readonly TrustOutcome[]): readonly string[] {
  return Object.freeze(
    outcomes
      .filter((o) => !o.accepted && o.launchMessageIsPrinted)
      .map((o) => (o as { launchMessage: string }).launchMessage),
  );
}

/** Every doctor finding of a set of outcomes (F110-FR-017). */
export function findingsOf(outcomes: readonly TrustOutcome[]): readonly Finding[] {
  return Object.freeze(
    outcomes.filter((o) => !o.accepted).map((o) => (o as { finding: Finding }).finding),
  );
}
