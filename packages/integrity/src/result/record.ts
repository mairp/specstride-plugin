// T076 (F116-FR-023; annex B §B.4, §B.20) — the writers of the records
// `specstride.protected-set/1` and `specstride.check-result/1` and the mapping
// from the value that the check runner returns.
//
// Both records carry their schema id and the fields of the section "Records
// owned by this feature" of spec.md. The record of a check result is the
// STORED record: what the check runner returns is a value, and the engine
// writes from it the fields of that section and no other spelling of them —
// in particular a command entry has `id` and `exit`, written from the
// `commandId` and the `exitCode` of the runner's value.
import type { Conditions } from "../protected/compare.ts";

/** Schema id of the record of the protected set (annex B §B.20). */
export const PROTECTED_SET_SCHEMA = "specstride.protected-set/1";
/** Schema id of the record of a check result (annex B §B.20). */
export const CHECK_RESULT_SCHEMA = "specstride.check-result/1";

/** One ignored path of class A as the record holds it (F116-FR-003). */
export interface RecordIgnoredListing {
  path: string;
  listingHash: string;
  contentHashed: { path: string; hash: string }[];
}

export interface StoredProtectedSetRecordInput {
  phase: number;
  profiles: { id: string; version: string }[];
  basic: boolean;
  classAPatterns: string[];
  ignoredListings: RecordIgnoredListing[];
  classBFiles: { path: string; hash: string }[];
  authorised: Record<string, string[]>;
  atLaunch: { set: string; tree: string };
  atPhaseEntry: { set: string; tree: string };
  exclusions: string[];
  effectiveConfig: string | null;
}

export interface StoredProtectedSetRecord {
  schema: typeof PROTECTED_SET_SCHEMA;
  phase: number;
  profiles: { id: string; version: string }[];
  basic: boolean;
  classA: {
    patterns: string[];
    ignoredListings: {
      path: string;
      listingHash: string;
      contentHashed: { path: string; hash: string }[];
    }[];
  };
  classB: { files: { path: string; hash: string }[] };
  authorised: Record<string, string[]>;
  atLaunch: { set: string; tree: string };
  atPhaseEntry: { set: string; tree: string };
  exclusions: string[];
  effectiveConfig: string | null;
}

/**
 * Write the record of the protected set at `phase:<N>:protected-set`: the
 * schema id and the fields of the section "Records owned by this feature".
 */
export function writeProtectedSetRecord(
  input: StoredProtectedSetRecordInput,
): StoredProtectedSetRecord {
  return {
    schema: PROTECTED_SET_SCHEMA,
    phase: input.phase,
    profiles: input.profiles,
    basic: input.basic,
    classA: {
      patterns: input.classAPatterns,
      ignoredListings: input.ignoredListings,
    },
    classB: { files: input.classBFiles },
    authorised: input.authorised,
    atLaunch: input.atLaunch,
    atPhaseEntry: input.atPhaseEntry,
    exclusions: input.exclusions,
    effectiveConfig: input.effectiveConfig,
  };
}

/** The value that the check runner returns for one command (§C.8). */
export interface CheckRunnerCommandValue {
  commandId: string;
  exitCode: number;
  durationMs?: number;
  output?: { logicalName: string; hash: string; size: number };
  observed?: [number | null, number | null];
}

/** One command entry of the stored record: `id` and `exit`, no other spelling. */
export interface StoredCommandEntry {
  id: string;
  exit: number | null;
  conditions: Conditions;
  durationMs?: number;
  outputRef?: { name: string; hash: string; bytes: number };
  observed?: [number | null, number | null];
}

/**
 * The mapping from the value that the check runner returns to the stored
 * command entry: `commandId` becomes `id`, `exitCode` becomes `exit`.
 */
export function commandFromRunnerValue(
  value: CheckRunnerCommandValue,
  conditions: Conditions,
): StoredCommandEntry {
  return {
    id: value.commandId,
    exit: value.exitCode,
    conditions,
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
    ...(value.output === undefined
      ? {}
      : {
          outputRef: {
            name: value.output.logicalName,
            hash: value.output.hash,
            bytes: value.output.size,
          },
        }),
    ...(value.observed === undefined ? {} : { observed: value.observed }),
  };
}

export interface CheckResultRecordInput {
  unitId: string;
  ordinal: number;
  treeBefore: string;
  treeAfter: string;
  protectedBefore: string;
  protectedAfter: string;
  commands: StoredCommandEntry[];
  excluded?: { id: string; reason: string }[];
}

export interface CheckResultRecord {
  schema: typeof CHECK_RESULT_SCHEMA;
  unitId: string;
  ordinal: number;
  treeBefore: string;
  treeAfter: string;
  protectedBefore: string;
  protectedAfter: string;
  commands: StoredCommandEntry[];
  excluded: { id: string; reason: string }[];
}

/** Write the record of a check result at `unit:<unitId>:check:<i>`. */
export function writeCheckResultRecord(input: CheckResultRecordInput): CheckResultRecord {
  return {
    schema: CHECK_RESULT_SCHEMA,
    unitId: input.unitId,
    ordinal: input.ordinal,
    treeBefore: input.treeBefore,
    treeAfter: input.treeAfter,
    protectedBefore: input.protectedBefore,
    protectedAfter: input.protectedAfter,
    commands: input.commands,
    excluded: input.excluded ?? [],
  };
}
