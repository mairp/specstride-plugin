/**
 * T028 — the fingerprint bracket of a command of the verification gate
 * (F148-FR-006).
 *
 * F148-FR-006 is five claims. Four of them are this file and the fifth is
 * `containment.ts` of `src/command/`:
 *
 *  1. **Two readings.** Around EVERY command of the verification gate the
 *     protected set is fingerprinted BEFORE and AFTER. The readings are taken
 *     THROUGH the owner of the protected set (EP-16, feature 116): this
 *     feature never walks the tree itself, it is handed a
 *     `specstride.protected-set/1` record per end of the bracket and compares
 *     the two (`data-model.md`, "Fingerprint readings").
 *  2. **The taint.** A result obtained against a changed set carries
 *     `tainted` with the reason `changed-during-check`, APART FROM paths the
 *     manifest declares as writes of THAT command. `compareReadings` leaves
 *     those out and `taintOfABracket` sets the condition without touching the
 *     exit result.
 *  3. **A change without authority is a fact and never a halt.** When files of
 *     the protected set were changed without authority the gate STILL RUNS,
 *     its result carries `tainted` with the reason `protected-set-changed`,
 *     the fact is contributed to the fact block, approval stays possible and
 *     the run does not halt. `onAnUnauthorisedProtectedChange` is that rule,
 *     and it reads feature 100's own statement of it
 *     (`ON_AN_UNAUTHORISED_PROTECTED_CHANGE`, F100-FR-136) rather than
 *     restating it.
 *  4. **No count of tests reaches the fact block.** `protected-fact.ts`.
 *  5. **The containment level of a gate command.** `../command/containment.ts`.
 *
 * Row 31 of annex X §X.7 (`integrity.gate_fingerprint`) switches the bracket:
 * it is on by default and OFF under the `parity` profile, where the baseline
 * took no reading. `bracketIsTaken` reads the value from the row through
 * `../registry/switches.ts`, so the two cannot drift.
 *
 * A comparison of paths is a PREFIX COMPARISON AT A PATH BOUNDARY
 * (`research.md` D-3): the declared write `src/build` covers
 * `src/build/out.o` and never `src/buildings.ts`.
 */
import { GATE_FINGERPRINT_KEY, parityValueOf } from "../registry/switches.ts";
import type { TaintedReason } from "../result/closed-sets.ts";
import { statedAsPass, withCondition, type RunnerResult } from "../result/result.ts";

/* ------------------------------------------------------------------ *
 * The two ends of the bracket, and the port of EP-16.
 * ------------------------------------------------------------------ */

/** The two ends of the bracket: one reading before the command, one after. */
export const BRACKET_ENDS = ["before", "after"] as const;
export type BracketEnd = (typeof BRACKET_ENDS)[number];

/** The schema id of the record a reading is taken from (feature 116, EP-16). */
export const PROTECTED_SET_SCHEMA_ID = "specstride.protected-set/1" as const;

/** The extension point through which a reading is taken, and its owner. */
export const READING_IS_TAKEN_THROUGH = "EP-16" as const;
export const OWNER_OF_THE_PROTECTED_SET = "116" as const;

/**
 * One reading of the protected set, normalized from a
 * `specstride.protected-set/1` record. `paths` holds every file whose CONTENT
 * is hashed (class B, and the files hashed inside an ignored listing of class
 * A); `listings` holds the listing hash of each ignored path of class A, which
 * is the detection for files that are neither pinned executables nor matched
 * by a class A pattern (the constitution, Principle III).
 */
export type ProtectedSetReading = {
  readonly at: BracketEnd;
  /** The hash of the set as the record carries it, or "" where it carries none. */
  readonly set: string;
  /** The fingerprint of the tree as the record carries it, or "". */
  readonly tree: string;
  readonly paths: Readonly<Record<string, string>>;
  readonly listings: Readonly<Record<string, string>>;
};

/**
 * The port of EP-16: the caller hands the runner a reading per end of the
 * bracket. The runner compares; it never derives a protected set, because the
 * set belongs to feature 116 (`data-model.md`).
 */
export type ProtectedSetPort = (at: BracketEnd) => unknown | Promise<unknown>;

type RawListing = {
  path?: unknown;
  listingHash?: unknown;
  contentHashed?: unknown;
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalize a `specstride.protected-set/1` record into a reading. An unknown
 * field is IGNORED, as the record says (`x-unknown-field`), and a missing
 * block gives an empty one rather than an exception: a reading that cannot be
 * taken must not end a check by throwing.
 */
export function readProtectedSetReading(at: BracketEnd, value: unknown): ProtectedSetReading {
  const raw = (value ?? {}) as Readonly<Record<string, unknown>>;
  const paths: Record<string, string> = {};
  const listings: Record<string, string> = {};

  const classB = (raw["classB"] ?? {}) as { files?: unknown };
  if (Array.isArray(classB.files)) {
    for (const file of classB.files as { path?: unknown; hash?: unknown }[]) {
      const path = textOf(file?.path);
      if (path !== "") paths[path] = textOf(file?.hash);
    }
  }

  const classA = (raw["classA"] ?? {}) as { ignoredListings?: unknown };
  if (Array.isArray(classA.ignoredListings)) {
    for (const listing of classA.ignoredListings as RawListing[]) {
      const path = textOf(listing?.path);
      if (path !== "") listings[path] = textOf(listing?.listingHash);
      if (Array.isArray(listing?.contentHashed)) {
        for (const file of listing.contentHashed as { path?: unknown; hash?: unknown }[]) {
          const inner = textOf(file?.path);
          if (inner !== "") paths[inner] = textOf(file?.hash);
        }
      }
    }
  }

  const entry = (raw["atPhaseEntry"] ?? {}) as { set?: unknown; tree?: unknown };
  return Object.freeze({
    at,
    set: textOf(entry.set),
    tree: textOf(entry.tree),
    paths: Object.freeze(paths),
    listings: Object.freeze(listings),
  });
}

/** Take the reading of one end of the bracket through the port of EP-16. */
export async function takeReading(
  port: ProtectedSetPort,
  at: BracketEnd,
): Promise<ProtectedSetReading> {
  return readProtectedSetReading(at, await port(at));
}

/* ------------------------------------------------------------------ *
 * The comparison, with the declared writes left out.
 * ------------------------------------------------------------------ */

/**
 * `research.md` D-3 — a declared prefix covers a path at a PATH BOUNDARY: the
 * prefix itself, or the prefix followed by a separator. `src/build` therefore
 * covers `src/build/out.o` and never `src/buildings.ts`.
 */
export function underPathPrefix(path: string, prefix: string): boolean {
  if (prefix === "") return false;
  if (path === prefix) return true;
  const head = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(head);
}

/**
 * F148-FR-006 — true where the path is one the manifest declares as a write of
 * THAT command, which the comparison leaves out.
 */
export function coveredByADeclaredWrite(path: string, writes: readonly string[]): boolean {
  return writes.some((write) => underPathPrefix(path, write));
}

/** What the two readings differ in. */
export type BracketDifference = {
  /** Paths whose content hash differs, outside the declared writes. */
  readonly changed: readonly string[];
  /** Paths that only the second reading holds, outside the declared writes. */
  readonly added: readonly string[];
  /** Paths that only the first reading holds, outside the declared writes. */
  readonly removed: readonly string[];
  /** Ignored paths whose LISTING differs, outside the declared writes. */
  readonly listingsChanged: readonly string[];
  /** Paths that differ but that the manifest declares as writes of the command. */
  readonly declaredWrites: readonly string[];
  /** True where anything outside the declared writes differs. */
  readonly differs: boolean;
};

/** No difference: what a command that changed nothing leaves behind. */
export const NO_DIFFERENCE: BracketDifference = Object.freeze({
  changed: Object.freeze([]),
  added: Object.freeze([]),
  removed: Object.freeze([]),
  listingsChanged: Object.freeze([]),
  declaredWrites: Object.freeze([]),
  differs: false,
});

/**
 * F148-FR-006 — compare the two readings. A path the manifest declares as a
 * write of that command is left out of every list but `declaredWrites`, so a
 * command that writes what it said it writes is not tainted by its own work.
 */
export function compareReadings(
  before: ProtectedSetReading,
  after: ProtectedSetReading,
  declaredWrites: readonly string[] = [],
): BracketDifference {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const listingsChanged: string[] = [];
  const declared: string[] = [];

  const put = (path: string, into: string[]): void => {
    if (coveredByADeclaredWrite(path, declaredWrites)) {
      declared.push(path);
      return;
    }
    into.push(path);
  };

  for (const [path, hash] of Object.entries(before.paths)) {
    const now = after.paths[path];
    if (now === undefined) put(path, removed);
    else if (now !== hash) put(path, changed);
  }
  for (const path of Object.keys(after.paths)) {
    if (before.paths[path] === undefined) put(path, added);
  }
  for (const [path, hash] of Object.entries(before.listings)) {
    const now = after.listings[path];
    if (now !== undefined && now !== hash) put(path, listingsChanged);
  }

  const differs = changed.length + added.length + removed.length + listingsChanged.length > 0;
  return Object.freeze({
    changed: Object.freeze(changed.sort()),
    added: Object.freeze(added.sort()),
    removed: Object.freeze(removed.sort()),
    listingsChanged: Object.freeze(listingsChanged.sort()),
    declaredWrites: Object.freeze([...new Set(declared)].sort()),
    differs,
  });
}

/** Every path of a difference, outside the declared writes, in one sorted list. */
export function pathsOfADifference(difference: BracketDifference): readonly string[] {
  return Object.freeze(
    [
      ...difference.changed,
      ...difference.added,
      ...difference.removed,
      ...difference.listingsChanged,
    ].sort(),
  );
}

/* ------------------------------------------------------------------ *
 * Row 31: whether the bracket is taken at all.
 * ------------------------------------------------------------------ */

/** The key of row 31 of annex X §X.7, which switches the bracket. */
export { GATE_FINGERPRINT_KEY };

/** The value of row 31 under the `parity` profile, read from the annex: off. */
export const GATE_FINGERPRINT_UNDER_PARITY: boolean | number | string | null =
  parityValueOf(GATE_FINGERPRINT_KEY);

/** The profile under which the bracket is not taken (row 31). */
export const PROFILE_WITHOUT_THE_BRACKET = "parity" as const;

/**
 * F148-FR-006, row 31 — whether the bracket is taken. On by default; off under
 * the `parity` profile, where the baseline took no reading. An explicit value
 * from configuration stands over the profile.
 */
export function bracketIsTaken(profile: string, configured?: boolean): boolean {
  if (configured !== undefined) return configured;
  if (profile === PROFILE_WITHOUT_THE_BRACKET) return GATE_FINGERPRINT_UNDER_PARITY === true;
  return true;
}

/* ------------------------------------------------------------------ *
 * The taint.
 * ------------------------------------------------------------------ */

/** F148-FR-006 — the reason of a difference between the two readings. */
export const REASON_OF_A_DIFFERENCE: TaintedReason = "changed-during-check";

/** F148-FR-006 — the reason of a protected set changed without authority. */
export const REASON_OF_AN_UNAUTHORISED_CHANGE: TaintedReason = "protected-set-changed";

/** The condition both reasons carry (F148-FR-003, EP-05 `CONDITION_OF_A_CHANGED_PROTECTED_SET`). */
export const CONDITION_OF_THE_BRACKET = "tainted" as const;

/**
 * The reasons a result of this bracket carries, where both of them apply. The
 * field `reason` of F148-FR-003 holds ONE member of the closed set, so it holds
 * the FIRST reason that applied and `taintedReasons` holds every one: a result
 * whose set changed before the check AND during it states both facts and loses
 * neither.
 */
export type TaintedReasons = { readonly taintedReasons?: readonly TaintedReason[] };

/** Set `tainted` with a reason, keeping a reason the result already carries. */
function taint(
  result: RunnerResult,
  reason: TaintedReason,
  extra: Readonly<Record<string, unknown>>,
): RunnerResult {
  const carried = (result as RunnerResult & TaintedReasons).taintedReasons ?? [];
  const reasons = Object.freeze([...new Set([...carried, reason])]);
  // `withCondition` copies the exit result across untouched and refuses to be
  // given one, so the condition cannot replace it (F148-FR-003).
  const first = result.tainted && result.reason !== null ? result.reason : reason;
  return withCondition(result, CONDITION_OF_THE_BRACKET, first, {
    ...extra,
    taintedReasons: reasons,
  });
}

/**
 * F148-FR-006 — the taint of a bracket whose readings differ: `tainted` with
 * the reason `changed-during-check`. The exit result is copied across
 * untouched, and the paths are recorded beside the condition so that the
 * critic can be told WHICH paths changed without the result being restated.
 */
export function taintOfABracket(result: RunnerResult, difference: BracketDifference): RunnerResult {
  if (!difference.differs) return result;
  return taint(result, REASON_OF_A_DIFFERENCE, {
    changedDuringCheck: pathsOfADifference(difference),
  });
}

/**
 * F148-FR-006 — the taint of a protected set that was changed WITHOUT
 * AUTHORITY before the check: `tainted` with the reason
 * `protected-set-changed`. The gate still ran; this marks its result.
 */
export function taintOfAnUnauthorisedChange(
  result: RunnerResult,
  paths: readonly string[],
): RunnerResult {
  if (paths.length === 0) return result;
  return taint(result, REASON_OF_AN_UNAUTHORISED_CHANGE, {
    protectedSetChanged: Object.freeze([...paths].sort()),
  });
}

/** The reasons of `tainted` a result of this bracket carries, in the order set. */
export function taintedReasonsOf(result: RunnerResult): readonly TaintedReason[] {
  return (result as RunnerResult & TaintedReasons).taintedReasons ?? Object.freeze([]);
}

/* ------------------------------------------------------------------ *
 * The bracket around one command.
 * ------------------------------------------------------------------ */

/** What one bracketed execution gives back. */
export type BracketedRun = {
  /** The result, with the taint where the readings differ. */
  readonly result: RunnerResult;
  /** True where the bracket was taken at all (row 31). */
  readonly taken: boolean;
  readonly before: ProtectedSetReading | null;
  readonly after: ProtectedSetReading | null;
  readonly difference: BracketDifference;
  /** False whenever the result carries a condition that forbids a pass. */
  readonly statedAsPass: boolean;
};

/** What `bracketACommand` is given. */
export type BracketInput = {
  /** The reading of one end, taken through EP-16. */
  readonly reading: ProtectedSetPort;
  /** The paths the manifest declares as writes of THIS command. */
  readonly declaredWrites?: readonly string[];
  /** The profile, which row 31 reads. */
  readonly profile?: string;
  /** An explicit value of row 31, which stands over the profile. */
  readonly gateFingerprint?: boolean;
  /** Paths of the protected set changed WITHOUT AUTHORITY before the check. */
  readonly unauthorised?: readonly string[];
  /** The execution itself. It runs whatever the readings say (F100-FR-136). */
  readonly run: () => Promise<RunnerResult>;
};

/**
 * F148-FR-006 — the bracket around ONE command of the verification gate: the
 * reading before, the command, the reading after, the comparison with the
 * declared writes left out, and the taint.
 *
 * The command RUNS in every case. A protected set that was changed without
 * authority does not hold the gate back (claim 3); a reading that cannot be
 * taken does not either — it leaves the bracket untaken and is reported as
 * such, because a check that silently did not run would be the worse failure.
 */
export async function bracketACommand(input: BracketInput): Promise<BracketedRun> {
  const taken = bracketIsTaken(input.profile ?? "", input.gateFingerprint);
  const writes = input.declaredWrites ?? [];
  const unauthorised = input.unauthorised ?? [];

  if (!taken) {
    const plain = await input.run();
    const marked = taintOfAnUnauthorisedChange(plain, unauthorised);
    return Object.freeze({
      result: marked,
      taken: false,
      before: null,
      after: null,
      difference: NO_DIFFERENCE,
      statedAsPass: statedAsPass(marked),
    });
  }

  const before = await takeReading(input.reading, "before");
  const result = await input.run();
  const after = await takeReading(input.reading, "after");
  const difference = compareReadings(before, after, writes);
  // Chronological order: the set was changed without authority BEFORE the
  // check, so that reason is set first and stands in `reason`; a difference
  // between the two readings is added after it (`taintedReasons`).
  const marked = taintOfABracket(taintOfAnUnauthorisedChange(result, unauthorised), difference);
  return Object.freeze({
    result: marked,
    taken: true,
    before,
    after,
    difference,
    statedAsPass: statedAsPass(marked),
  });
}
