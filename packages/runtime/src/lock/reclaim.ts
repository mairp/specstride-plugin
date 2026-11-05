/**
 * T031 — `reclaim`, by ONE atomic rename (research D-4; F122-FR-015,
 * F122-FR-016).
 *
 * F122-FR-015: *`reclaim` MUST be the only way in which a lock changes its
 * owner… It MUST be atomic and MUST never be a removal followed by a
 * creation.* R2v measured what "never a removal followed by a creation"
 * costs: remove-then-create gave SEVERAL winners in 297 of 300 rounds. A
 * rename gives one, because the kernel does the choosing.
 *
 * THE NAME OF THE TOMBSTONE IS THE MECHANISM, and this is the one thing in
 * this module worth reading twice. Every contender renames the stale lock to
 * the SAME target, derived from the content of the STALE OWNER RECORD. Two
 * consequences follow from the same kernel rule that D-1 rests on — a rename
 * onto an existing, non-empty directory fails:
 *
 *   1. Of eight contenders that probed one stale lock, exactly one rename
 *      succeeds. The other seven find the tombstone already there and get
 *      `lost-race` (F122-FR-015).
 *   2. A contender that probed the stale lock, went to sleep, and woke after
 *      the winner had already taken a FRESH lock under the same name cannot
 *      rename that fresh lock away: its target is the tombstone of the stale
 *      owner, and the tombstone is still there. Had the target been unique
 *      per contender, that late rename would have succeeded and carried a
 *      LIVE run's lock off with it.
 *
 * Which is why the tombstone is KEPT and not cleaned up when the reclaim
 * succeeds: it is not litter, it is the thing that closes (2). Its name is
 * derived from the stale owner, so one dead owner leaves one tombstone and
 * never a growing pile, and `sweepTombstones` is offered for a consumer who
 * wants them gone — to be called only where a probe says `free`, which is the
 * one moment at which no late contender can be holding an old reading.
 *
 * A FOREIGN OR UNKNOWN LOCK IS NEVER RECLAIMED (F122-FR-016). The probe runs
 * first and only `stale-owner-dead` opens the way; `held-foreign` and
 * `unknown` are refused with a detail that names the logical name of the
 * lock, the host, the launch and the time of the owner record.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lease } from "@specstride/contracts/records/lease";
import type { OwnerRecord } from "@specstride/contracts/records/owner-record";
import { FILE_MODE } from "../root/control-root.ts";
import {
  ACQUIRED_AT_FIELD,
  ENDPOINT_FIELD,
  probeLock,
  type LockOwnerRecord,
  type ProbeDependencies,
  type ProbeOutcome,
} from "./probe.ts";
import { TOMBSTONE_PREFIX, lockPathsOf, type LockPlace } from "./paths.ts";

/** The requirements this module carries and the research it comes from. */
export const RECLAIM_REQUIREMENTS = ["F122-FR-015", "F122-FR-016"] as const;
export const RECLAIM_DECISION = "D-4" as const;

/** F122-FR-015 — reclaim is one rename and never a removal and a creation. */
export const RECLAIM_IS_A_REMOVAL_AND_A_CREATION = false as const;

/** The one probe result that opens the way (F122-FR-015). */
export const THE_ONLY_RESULT_THAT_ALLOWS_RECLAIM = "stale-owner-dead" as const;

/** The file that keeps a tombstone non-empty, and so keeps it effective. */
export const TOMBSTONE_NOTE = "reclaimed.json" as const;

/** The reasons a reclaim does not happen (EP-13, `ReclaimResult`). */
export const RECLAIM_REFUSALS = ["lost-race", "foreign-owner"] as const;
export type ReclaimRefusal = (typeof RECLAIM_REFUSALS)[number];

/**
 * What `reclaim` answers here. The two arms are `ReclaimResult` of EP-13; the
 * extra fields are this provider's own.
 *
 * `error: "unknown"` is set where the probe said `unknown`. The closed set of
 * `reason` holds `lost-race` and `foreign-owner` and nothing else, and
 * neither of them is the truth about a lock nobody can read — so `reason` is
 * the one that claims least (`lost-race`: this contender did not get it) and
 * `error` carries what actually happened, which is what the refusal
 * `lock-unknown` of the launch table is written from.
 */
export type ReclaimOutcome =
  | { readonly reclaimed: true; readonly lease: Lease; readonly tombstone: string }
  | {
      readonly reclaimed: false;
      readonly reason: ReclaimRefusal;
      readonly error?: "unknown";
      readonly probe: string;
      readonly detail: string;
    };

/** What the reclaim needs from the provider that calls it. */
export type ReclaimDependencies = {
  /**
   * D-4 — *the winner then acquires as in D-1*. The acquire is handed in
   * rather than imported, so that this module holds the rename and nothing
   * else, and so that a test can watch the two steps separately.
   */
  readonly acquire: (
    owner: OwnerRecord,
    input: { runId: string; launchId: string; launchNonce: string },
  ) => Promise<{ readonly acquired: true; readonly lease: Lease } | { readonly acquired: false }>;
  readonly probeDependencies?: ProbeDependencies | undefined;
  readonly now?: (() => Date) | undefined;
  /** The identity the winner acquires with, where the caller pins one. */
  readonly owner?: OwnerRecord | undefined;
  readonly input?: { runId: string; launchId: string; launchNonce: string } | undefined;
};

/**
 * The name of the tombstone of a stale owner: derived from the record, so
 * that every contender that probed the SAME stale lock computes the SAME
 * target. This is what makes the rename a race with one winner.
 */
export function tombstoneNameFor(owner: LockOwnerRecord | null): string {
  const material =
    owner === null
      ? "unreadable"
      : [
          owner.pid,
          owner.startTime,
          owner.bootId,
          owner.hostName,
          owner.launchId,
          owner.runTokenHash,
          owner[ACQUIRED_AT_FIELD] ?? "",
        ].join("\u0000");
  return `${TOMBSTONE_PREFIX}${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * F122-FR-015 — reclaim a stale lock by one atomic rename, then acquire as in
 * D-1. A reclaimed lock carries the owner record of the winner from its first
 * moment, because the acquire that follows is the ordinary one.
 */
export async function reclaimByOneAtomicRename(
  place: LockPlace,
  dependencies: ReclaimDependencies,
): Promise<ReclaimOutcome> {
  const paths = lockPathsOf(place);
  const outcome: ProbeOutcome = await probeLock(place, dependencies.probeDependencies);
  if (outcome.result !== THE_ONLY_RESULT_THAT_ALLOWS_RECLAIM) {
    return refusalFor(outcome, paths.lockDirectory);
  }
  const stale = outcome.reading.owner;
  const tombstone = join(paths.parentDirectory, tombstoneNameFor(stale));
  try {
    // THE one rename. Every contender aims at the same name, so the kernel
    // picks one winner, and a late contender that probed before the winner
    // re-acquired finds the tombstone in its way and cannot carry off the
    // fresh lock (research D-4).
    renameSync(paths.lockDirectory, tombstone);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOENT: another contender renamed it first. ENOTEMPTY/EEXIST: the
    // tombstone of this very owner is already there, so the lock under the
    // name is not the stale one any more. Both are `lost-race`.
    return Object.freeze({
      reclaimed: false as const,
      reason: "lost-race" as const,
      probe: outcome.result,
      detail:
        code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST"
          ? `another contender reclaimed \`workspace:lock\` first (${code})`
          : `the stale lock could not be renamed: ${messageOf(error)}`,
    });
  }
  // D-4 — *and removes the stale socket*. The owner is known dead (the probe
  // said `stale-owner-dead`) and this contender won the rename, so nothing
  // else can be listening on it. The tombstone, unlike the socket, is KEPT:
  // see the header.
  removeTheStaleSocket(stale);
  // The tombstone must stay NON-EMPTY for as long as it exists, or a rename
  // onto it would succeed and the guarantee above would be gone. The stale
  // owner record is already inside it; this note says why it is kept.
  noteTheTombstone(tombstone, stale, dependencies.now ?? ((): Date => new Date()));
  const owner = dependencies.owner;
  const input = dependencies.input ?? {
    runId: "unknown",
    launchId: "unknown",
    launchNonce: "unknown",
  };
  const acquired = await dependencies.acquire(owner ?? (stale as OwnerRecord), input);
  if (!acquired.acquired) {
    return Object.freeze({
      reclaimed: false as const,
      reason: "lost-race" as const,
      probe: outcome.result,
      detail:
        `the stale lock was renamed to \`${tombstone}\` and the acquire that followed did ` +
        `not win: another contender took \`workspace:lock\` in between`,
    });
  }
  return Object.freeze({ reclaimed: true as const, lease: acquired.lease, tombstone });
}

/** F122-FR-016 — the refusal, with everything the requirement asks it to name. */
function refusalFor(outcome: ProbeOutcome, lockDirectory: string): ReclaimOutcome {
  const owner = outcome.reading.owner;
  const where =
    owner === null
      ? `its owner record at \`${lockDirectory}\` cannot be read`
      : `host \`${owner.hostName}\`, launch \`${owner.launchId}\`, taken at ` +
        `\`${owner[ACQUIRED_AT_FIELD] ?? "unknown"}\``;
  if (outcome.result === "held-foreign") {
    return Object.freeze({
      reclaimed: false as const,
      reason: "foreign-owner" as const,
      probe: outcome.result,
      detail:
        `\`workspace:lock\` is \`held-foreign\` (${where}): a foreign owner is never ` +
        `reclaimed by the product by itself (F122-FR-016)`,
    });
  }
  if (outcome.result === "unknown") {
    return Object.freeze({
      reclaimed: false as const,
      reason: "lost-race" as const,
      error: "unknown" as const,
      probe: outcome.result,
      detail:
        `\`workspace:lock\` probes \`unknown\` (${where}): an unknown lock counts as held and ` +
        `is never reclaimed by the product by itself (F122-FR-016)`,
    });
  }
  return Object.freeze({
    reclaimed: false as const,
    reason: "lost-race" as const,
    probe: outcome.result,
    detail:
      `\`workspace:lock\` probes \`${outcome.result}\` and only ` +
      `\`${THE_ONLY_RESULT_THAT_ALLOWS_RECLAIM}\` allows a reclaim (F122-FR-015); nothing ` +
      `removes a lock whose owner lives (F122-FR-016)`,
  });
}

/** D-4 — the socket of the dead owner, which nothing can be listening on. */
function removeTheStaleSocket(stale: LockOwnerRecord | null): void {
  const endpoint = stale?.[ENDPOINT_FIELD];
  if (typeof endpoint !== "string" || endpoint === "") return;
  try {
    rmSync(endpoint, { force: true });
  } catch {
    /* a socket that cannot be removed answers `dead` anyway */
  }
}

/** Keep the tombstone non-empty and say, inside it, why it is there. */
function noteTheTombstone(tombstone: string, stale: LockOwnerRecord | null, now: () => Date): void {
  try {
    writeFileSync(
      join(tombstone, TOMBSTONE_NOTE),
      JSON.stringify(
        {
          note:
            "the stale lock this directory was, reclaimed by one atomic rename (research " +
            "D-4). It is kept and kept NON-EMPTY on purpose: a rename onto a non-empty " +
            "directory fails, which is what stops a late contender from renaming a freshly " +
            "acquired lock away. Remove it only where a probe says `free`.",
          reclaimedAt: now().toISOString(),
          staleOwner: stale,
        },
        null,
        2,
      ) + "\n",
      { mode: FILE_MODE },
    );
  } catch {
    /* the stale owner record inside it already keeps it non-empty */
  }
}

/**
 * Remove the tombstones of a workspace. Safe ONLY where a probe says `free`:
 * while a lock exists, a tombstone may still be the thing that stops a late
 * contender, and removing it would reopen the window research D-4 closes.
 */
export function sweepTombstones(place: LockPlace, probeSaidFree: boolean): readonly string[] {
  if (!probeSaidFree) return Object.freeze([]);
  const paths = lockPathsOf(place);
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(paths.parentDirectory);
  } catch {
    return Object.freeze([]);
  }
  for (const name of names) {
    if (!name.startsWith(TOMBSTONE_PREFIX)) continue;
    const path = join(paths.parentDirectory, name);
    try {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      }
    } catch {
      /* a tombstone that cannot be removed is left alone */
    }
  }
  return Object.freeze(removed);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
