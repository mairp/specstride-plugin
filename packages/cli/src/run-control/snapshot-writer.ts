/**
 * T005 — the writer of the run snapshot (F102-FR-025, F102-FR-026;
 * contracts/snapshot-classes.md; annex B §B.12).
 *
 * At a launch, after the launch checks passed and before the first pass, the
 * CLI writes the run snapshot `run:<runId>:snapshot`, schema
 * `specstride.snapshot/1`: every resolved configuration key with its value,
 * its source (the rank of annex X §X.2) and its class, the id of the decision
 * for a learned value, the name of the profile in force, and the hashes of
 * the spec, the plan and the task list as pinned values. Secret references
 * are stored as the references they were written as, never resolved
 * (F102-FR-025).
 *
 * Classes (F102-FR-026): every key carries `pinned` or `tunable`, as the
 * column "Class" of the key catalogue of the config envelope states it
 * (`snapshotClassOf` of `@specstride/config`); a key without a class is read
 * as `pinned`. The rank of a key on resume follows the class: pinned below
 * the flags and above the environment, tunable below the environment and
 * above the project configuration (`snapshotRankOf`).
 *
 * The write is the kernel's atomic write (temporary name in the same
 * directory, fsync, rename; F100-FR-036). A FAILED write is a launch error:
 * no pass starts and the launch record says why (F102-FR-025,
 * research.md D-11). A launch refused by a launch check writes NO snapshot
 * and replaces none — the caller simply never calls the writer.
 *
 * The CLI also rewrites the snapshot at `resume --accept-source-change`,
 * before the engine starts (F102-FR-019): `acceptedChanges` goes into the
 * record here, together with the new source hashes.
 */
import { atomicWriteJson } from "@specstride/kernel";
import {
  buildRunSnapshot,
  snapshotClassOf,
  snapshotRankOf,
  type MergedValue,
  type RunSnapshotRecord,
  type SnapshotKeyRecord,
} from "@specstride/config";
import { isSecretReferenceText } from "@specstride/config";
import { readRunSnapshot } from "./records.ts";
import type { RunSnapshot } from "@specstride/contracts/records/run-snapshot";

/** The requirement numbers this module carries out. */
export const REQUIREMENTS = ["F102-FR-025", "F102-FR-026"] as const;

/** The logical name the snapshot is written under (annex B §B.12). */
export const SNAPSHOT_LOGICAL_NAME = "run:<runId>:snapshot" as const;

/** A failed write of the snapshot is a launch error (F102-FR-025, D-11). */
export const FAILED_WRITE_IS_A_LAUNCH_ERROR = true as const;

/** A launch refused by a launch check writes no snapshot and replaces none. */
export const A_REFUSED_LAUNCH_WRITES_NO_SNAPSHOT = true as const;

/** The engine reads the snapshot and never writes it. */
export const THE_ENGINE_WRITES_NO_SNAPSHOT = false as const;

/** What the caller tells the writer about ONE resolved key. */
export type SnapshotKeyInput = {
  /** The name of the configuration key. */
  readonly key: string;
  /** The resolved value; for a secret, its REFERENCE, never the secret. */
  readonly value: unknown;
  /** The rank of annex X §X.2 the value was resolved from. */
  readonly source: number;
  /** For a learned value, the id of its decision. */
  readonly decisionId?: string | undefined;
  /** True when the caller knows the value is a reference, not a secret. */
  readonly isSecretReference?: boolean | undefined;
};

/**
 * The snapshot record of one key (annex B §B.12): value, source rank, class,
 * decision id and the secret-reference mark.
 *
 * The class comes from the key catalogue (`snapshotClassOf`); a key the
 * catalogue leaves without a class is `pinned` (F102-FR-026). The rank is
 * the rank the snapshot stands at on resume for that class
 * (`snapshotRankOf`): pinned 3, below the flags and above the environment;
 * tunable 4.5, below the environment and above the project configuration
 * (contracts/snapshot-classes.md).
 *
 * A value that is a secret reference TEXT is recorded exactly as the
 * reference, with `isSecretReference: true` — the secret itself never enters
 * the snapshot (F102-FR-025).
 */
export function snapshotRecordOfKey(input: SnapshotKeyInput): SnapshotKeyRecord {
  const cls = snapshotClassOf(input.key);
  const isReference = input.isSecretReference === true || isSecretReferenceText(input.value);
  return Object.freeze({
    value: input.value,
    source: input.source,
    class: cls,
    ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
    ...(isReference ? { isSecretReference: true as const } : {}),
  }) as SnapshotKeyRecord;
}

/**
 * The rank the snapshot stands at on resume for the class of ONE key
 * (contracts/snapshot-classes.md): pinned 3 — below the flags (2) and above
 * the environment (4); tunable 4.5 — below the environment and above the
 * project configuration (5). The rank replay is `@specstride/config`'s rule
 * (`snapshotRankOf`); this wrapper is the form the resume path of this
 * feature calls.
 */
export function rankOfKeyOnResume(key: string): number {
  return snapshotRankOf(key, true);
}

/** What the caller tells the writer about the whole snapshot. */
export type SnapshotWriteInput = {
  readonly runId: string;
  /** Time of the first write, ISO 8601 UTC. The caller's clock. */
  readonly createdAt: string;
  /** The profile in force, or `null` (annex B §B.12). */
  readonly profile?: string | null | undefined;
  /** Every resolved key, in any order; written sorted by key. */
  readonly keys: readonly SnapshotKeyInput[];
  /** The hashes of `spec`, `plan` and `tasks` (see `source-compare.ts`). */
  readonly sourceHashes: Readonly<Record<string, unknown>>;
  /** `acceptedChanges`, written only by `resume --accept-source-change`. */
  readonly acceptedChanges?: readonly unknown[] | undefined;
};

/**
 * Build the run snapshot record (F102-FR-025). The keys are written sorted
 * by name; every key carries its value, its source rank, its class and — for
 * a learned value — the id of its decision. The source hashes are pinned
 * values of the record.
 */
export function buildSnapshotRecord(input: SnapshotWriteInput): RunSnapshot {
  const keys: Record<string, SnapshotKeyRecord> = {};
  for (const entry of [...input.keys].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  )) {
    keys[entry.key] = snapshotRecordOfKey(entry);
  }
  const built: RunSnapshotRecord = buildRunSnapshot({
    runId: input.runId,
    createdAt: input.createdAt,
    profile: input.profile ?? undefined,
    values: new Map(
      Object.keys(keys).map((key) => [
        key,
        {
          key,
          value: keys[key]!.value,
          rank: keys[key]!.source,
          ...(keys[key]!.decisionId === undefined ? {} : { decisionId: keys[key]!.decisionId }),
        },
      ]),
    ) as unknown as ReadonlyMap<string, MergedValue>,
    sourceHashes: input.sourceHashes,
  });
  const record = {
    ...built,
    keys,
    ...(input.acceptedChanges === undefined ? {} : { acceptedChanges: [...input.acceptedChanges] }),
  } as unknown as RunSnapshot;
  const read = readRunSnapshot(record as unknown as unknown);
  if (read.ok === false) {
    throw read.error;
  }
  return record;
}

/** The error a failed snapshot write is reported as: a LAUNCH error. */
export class SnapshotWriteError extends Error {
  readonly path: string;
  readonly causeOfFailure: unknown;
  constructor(path: string, cause: unknown) {
    super(
      `launch error: the run snapshot at ${path} could not be written; ` +
        `no pass starts (F102-FR-025)`,
    );
    this.name = "SnapshotWriteError";
    this.path = path;
    this.causeOfFailure = cause;
  }
}

/** What `writeRunSnapshot` reports. */
export type SnapshotWrite = {
  readonly path: string;
  readonly runId: string;
  /** The number of keys the snapshot carries. */
  readonly keyCount: number;
};

/**
 * Write the run snapshot atomically (F102-FR-025). A failure of the write is
 * thrown as `SnapshotWriteError` — a launch error: no pass starts, and the
 * caller records why in the launch record (research.md D-11). The record is
 * validated against `specstride.snapshot/1` before anything reaches the disk.
 */
export function writeRunSnapshot(
  path: string,
  input: SnapshotWriteInput,
  options: { readonly root?: string | undefined } = {},
): SnapshotWrite {
  const record = buildSnapshotRecord(input);
  try {
    atomicWriteJson(path, record, { root: options.root, createDirectory: true });
  } catch (err) {
    throw new SnapshotWriteError(path, err);
  }
  return { path, runId: input.runId, keyCount: Object.keys(record.keys).length };
}

/* ------------------------------------------------------------------ *
 * T037 — the rewrite at `resume --accept-source-change` (F102-FR-019).
 * ------------------------------------------------------------------ */

/** What the rewrite of one accepted change reports. */
export type SnapshotRewrite = {
  readonly path: string;
  readonly runId: string;
  /** The number of accepted changes the rewritten record carries. */
  readonly acceptedChangeCount: number;
  /** The source hashes the rewritten record pins now. */
  readonly sourceHashes: Readonly<Record<string, unknown>>;
};

/**
 * F102-FR-019 — the snapshot record with `acceptedChanges` and the new
 * source hashes: every key, the profile and the identity of the run stay
 * exactly as the launch wrote them; only the source hashes are re-pinned and
 * `acceptedChanges` is set. A change that was accepted for NO file records
 * NO `acceptedChanges` (F102-FR-019: with the flag and no changed source the
 * command behaves as a plain `resume`).
 *
 * Pure: it changes nothing on disk; `rewriteRunSnapshotWithAcceptedChanges`
 * does the write, validated and atomic like the first write.
 */
export function snapshotWithAcceptedChanges(
  existing: RunSnapshot,
  acceptedChanges: readonly unknown[],
  sourceHashes: Readonly<Record<string, unknown>>,
): RunSnapshot {
  const record = {
    ...existing,
    sourceHashes: { ...sourceHashes },
    ...(acceptedChanges.length > 0 ? { acceptedChanges: [...acceptedChanges] } : {}),
  } as RunSnapshot;
  const read = readRunSnapshot(record as unknown as unknown);
  if (read.ok === false) {
    throw read.error;
  }
  return record;
}

/**
 * F102-FR-019 — rewrite the snapshot at `resume --accept-source-change`,
 * BEFORE the engine starts, through the same atomic write as at launch
 * (temporary name, fsync, rename; F100-FR-036). A failed rewrite is the same
 * launch error a failed first write is (F102-FR-025, research.md D-11).
 */
export function rewriteRunSnapshotWithAcceptedChanges(
  path: string,
  existing: RunSnapshot,
  acceptedChanges: readonly unknown[],
  sourceHashes: Readonly<Record<string, unknown>>,
  options: { readonly root?: string | undefined } = {},
): SnapshotRewrite {
  const record = snapshotWithAcceptedChanges(existing, acceptedChanges, sourceHashes);
  try {
    atomicWriteJson(path, record, { root: options.root, createDirectory: true });
  } catch (err) {
    throw new SnapshotWriteError(path, err);
  }
  return {
    path,
    runId: record.runId,
    acceptedChangeCount: (record.acceptedChanges ?? []).length,
    sourceHashes: record.sourceHashes as Readonly<Record<string, unknown>>,
  };
}
