/**
 * T028 — `acquire` and `release` of the shipped provider: a temporary
 * directory that already holds the owner record, renamed into place
 * (research D-1; F122-FR-010, F122-FR-011, F122-FR-014, F122-FR-020).
 *
 * WHY A RENAME AND NOT A `mkdir`. The exclusion has to be ONE operation of
 * the kernel, and the lock must never exist without its owner record. A
 * `mkdir` followed by a write is two: between them the lock exists and is
 * empty, and a second contender that looked in that window would read a lock
 * with no owner — the owner-file window of the Lisa precedent (R2v risk 2).
 * So the contender builds the whole lock somewhere else, owner record and
 * lease inside it, and renames it into place. A rename onto an existing,
 * NON-EMPTY directory fails, so exactly one contender wins, and the lock is
 * complete from its first moment (R2v risks 1 and 2, ruling 23).
 *
 * That "non-empty" is load-bearing and is why nothing here ever creates an
 * empty lock directory: a rename onto an EMPTY directory succeeds and would
 * replace it. Every lock this provider makes holds its owner record before it
 * is visible under the name of the lock, so an empty lock cannot arise, and
 * the winner reads its own record back through the name of the lock before it
 * reports success — the exclusion is confirmed from the file system and not
 * from the return value of `rename`.
 *
 * WHAT `release` DOES, AND WHEN. F122-FR-020: *when a run ends or rests the
 * owner MUST release the lock and remove the advisory marker before it exits,
 * on every exit path it controls. After a release a probe MUST say `free`.*
 * The as-is fallback that stayed behind after a clean exit because its own
 * owner file was still inside it (B-0251, defect D-06) is NOT carried: the
 * release removes the directory with its contents, and `probeAfterRelease`
 * exists so that a test reads the answer from the same place a consumer would.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CONFLICT_ENGINE_CODE,
  CONFLICT_PIPELINE_CODE,
  POINT_ID,
  UNKNOWN_COUNTS_AS_HELD,
  type AcquireResult,
  type HandDownToken,
  type LockProvider,
  type LockScope,
  type ProbeResult,
  type ReclaimResult,
} from "@specstride/contracts/ep/lock";
import type { Lease } from "@specstride/contracts/records/lease";
import { SCHEMA_ID as LEASE_SCHEMA_ID } from "@specstride/contracts/records/lease";
import { RESTING_STATES, runStateRows, type RunState } from "@specstride/contracts/state/run-state";
import { atomicWriteJson } from "@specstride/kernel";
import { GRACE_SECONDS, HEARTBEAT_EVERY_SECONDS, validUntilOf } from "../lease/timing.ts";
import { DIRECTORY_MODE, FILE_MODE } from "../root/control-root.ts";
import { hashToken, mintLeaseToken, type MintedToken } from "../procs/run-token.ts";
import { UNKNOWN_FIELD, type OwnerRecord } from "./owner-record.ts";
import {
  listenForLiveness,
  nextEndpointInstance,
  type EndpointFailure,
  type LivenessEndpoint,
} from "./liveness.ts";
import {
  ACQUIRED_AT_FIELD,
  ENDPOINT_FIELD,
  countsAsHeld,
  probeLock,
  type LockOwnerRecord,
  type ProbeDependencies,
  type ProbeOutcome,
} from "./probe.ts";
import {
  LEASE_FILE,
  OWNER_RECORD_FILE,
  PENDING_PREFIX,
  lockPathsOf,
  type LockPaths,
  type LockPlace,
} from "./paths.ts";
import { reclaimByOneAtomicRename, type ReclaimOutcome } from "./reclaim.ts";
import { workspaceIdentityOf } from "./workspace-record.ts";

/** The id and the version of the shipped provider (F122-FR-019, row 115). */
export const SHIPPED_PROVIDER_ID = "directory-lock" as const;
export const SHIPPED_PROVIDER_VERSION = "1" as const;

/** The requirements this module carries, and the research it comes from. */
export const DIRECTORY_LOCK_REQUIREMENTS = [
  "F122-FR-010",
  "F122-FR-011",
  "F122-FR-014",
  "F122-FR-020",
] as const;
export const DIRECTORY_LOCK_DECISION = "D-1" as const;

/** The two codes a conflict leads to (EP-13, §F.5). */
export const ENGINE_CODE_ON_CONFLICT = CONFLICT_ENGINE_CODE;
export const PIPELINE_CODE_ON_CONFLICT = CONFLICT_PIPELINE_CODE;

/** B-0251, defect D-06 — the lock that stayed behind is not carried. */
export const THE_AS_IS_FALLBACK_STAYS_BEHIND = false as const;

/**
 * C-007, B-0061 — the as-is variable that handed the DESCRIPTOR of the lock
 * to child processes. The baseline exported it so that a child could close
 * its inherited copy before backgrounding a detached job; a child that
 * forgot to kept the run's lock held after the orchestrator had exited
 * (B-0372).
 *
 * This provider neither reads it nor sets it, and the reason is structural
 * rather than careful: the lock is a DIRECTORY and the liveness is a
 * LISTENING SOCKET of the owner, and neither is a descriptor a child
 * inherits. There is nothing of the lock for a child to close, so there is
 * nothing for a child to forget (F122-FR-017).
 *
 * The two constants below are the claim; `packages/runtime/` naming the
 * variable nowhere else is the proof, and a test greps for exactly that.
 */
export const AS_IS_LOCK_DESCRIPTOR_VARIABLE = "LOCK_FD" as const;
export const THE_AS_IS_LOCK_DESCRIPTOR_VARIABLE_IS_SET = false as const;
export const THE_AS_IS_LOCK_DESCRIPTOR_VARIABLE_IS_READ = false as const;

/**
 * F122-FR-017 — *no child process inherits anything of the lock*. The
 * environment a child is given carries nothing of it, which a caller can
 * check for any environment it is about to hand on.
 */
export function noChildInheritsAnythingOfTheLock(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment[AS_IS_LOCK_DESCRIPTOR_VARIABLE] === undefined;
}

/**
 * The defaults of the lease; ordinary configuration (F122-FR-014, CQ-138).
 * They are DEFINED in `../lease/timing.ts`, which also owns the one formula
 * for `validUntil`, and re-exported here so that a caller of the provider need
 * not reach past it.
 */
export { HEARTBEAT_EVERY_SECONDS, GRACE_SECONDS, validUntilOf };

/**
 * F122-FR-020 — in which states the lock is held, read from the column
 * "Lock held" of the states table of annex E §E.2 and never written out
 * again here. `Yes` and `Being taken` are held; `No` is released.
 */
export function lockIsHeldInState(state: RunState): boolean {
  const row = runStateRows.find((r) => r.state === state);
  if (row === undefined) return UNKNOWN_COUNTS_AS_HELD;
  return !/^no$/i.test(row.lockHeld.trim());
}

/** The states in which the lock is released: the resting states of §E.2. */
export const STATES_THAT_RELEASE_THE_LOCK: readonly RunState[] = Object.freeze(
  RESTING_STATES.filter((state) => !lockIsHeldInState(state)),
);

/** The states in which the lock stays held although the run is not working. */
export const STATES_THAT_KEEP_THE_LOCK: readonly RunState[] = Object.freeze(
  (["paused-quota", "relaunching", "stopping"] as const).filter((state) =>
    lockIsHeldInState(state),
  ),
);

/* ------------------------------------------------------------------ *
 * What the caller brings.
 * ------------------------------------------------------------------ */

/** What `acquire` needs beyond the owner record (annex B, §B.8). */
export type AcquireInput = {
  readonly runId: string;
  readonly launchId: string;
  readonly launchNonce: string;
  /** The as-is run id, for the owner line of compatibility output (C-113). */
  readonly asIsRunId?: string | undefined;
  readonly heartbeatEverySeconds?: number | undefined;
  readonly graceSeconds?: number | undefined;
};

/** What the provider is built over, so that every test is hermetic. */
export type DirectoryLockOptions = {
  readonly place: LockPlace;
  /** A clock, so that a test pins the times of the lease. */
  readonly now?: (() => Date) | undefined;
  /** The per-user runtime directory of the liveness endpoint (D-3). */
  readonly runtimeDirectory?: string | undefined;
  /** What the probe reads; a test may pin any of it. */
  readonly probeDependencies?: ProbeDependencies | undefined;
  /**
   * The identity `reclaim(scope)` acquires with, where the caller pins one.
   * EP-13 hands `reclaim` no owner record, and *a reclaimed lock MUST carry
   * the owner record of the winner from its first moment* (F122-FR-015), so
   * the winner's identity has to come from somewhere: this, or the last
   * `acquire` this provider attempted.
   */
  readonly reclaimAs?: { readonly owner: OwnerRecord; readonly input: AcquireInput } | undefined;
};

/**
 * The failure arm of `acquire` that `AcquireResult` does not model: a
 * provider that FAILED gives `unknown`, which counts as held (§F.5,
 * "Failure of an implementation"). It is reported on the conflict arm, with
 * `error` set, so that a caller that only knows `AcquireResult` still refuses
 * the launch, and a caller that knows this provider can tell the two apart —
 * exit 5 or 24 for a conflict (F122-FR-011) against `lock-unknown` and 24 for
 * a provider that failed (the refusal table of `cli-state-commands.md`).
 */
export type DirectoryAcquireResult =
  | {
      readonly acquired: true;
      readonly lease: Lease;
      readonly owner: LockOwnerRecord;
      readonly endpoint: LivenessEndpoint;
      readonly leaseToken: MintedToken;
    }
  | {
      readonly acquired: false;
      readonly conflict: "conflict";
      readonly holder: OwnerRecord;
      /** Set where the provider failed rather than lost: the result is `unknown`. */
      readonly error?: "unknown";
      /** Why, for a refusal and for the doctor. */
      readonly detail: string;
      /** The reason of the endpoint, where that is what failed (F122-FR-021). */
      readonly endpointFailure?: EndpointFailure;
    };

/** An owner record with every field `unknown`: what a failed read may claim. */
export function anUnreadableHolder(): OwnerRecord {
  return Object.freeze({
    pid: 0,
    processGroup: 0,
    startTime: UNKNOWN_FIELD,
    bootId: UNKNOWN_FIELD,
    hostName: UNKNOWN_FIELD,
    pidNamespace: null,
    launchId: UNKNOWN_FIELD,
    runTokenHash: UNKNOWN_FIELD,
  }) as unknown as OwnerRecord;
}

/* ------------------------------------------------------------------ *
 * The provider.
 * ------------------------------------------------------------------ */

/** The shipped provider over one workspace. */
export type DirectoryLock = LockProvider & {
  readonly version: string;
  readonly paths: LockPaths;
  acquire(scope: LockScope, owner: OwnerRecord, input?: AcquireInput): Promise<AcquireResult>;
  /** The richer answer of `acquire`, with the failure arm of §F.5. */
  acquireHere(owner: OwnerRecord, input: AcquireInput): Promise<DirectoryAcquireResult>;
  probeHere(): Promise<ProbeOutcome>;
  reclaimHere(owner: OwnerRecord, input: AcquireInput): Promise<ReclaimOutcome>;
  /** The endpoint of the lock this provider holds, while it holds one. */
  readonly endpoint: LivenessEndpoint | null;
};

/** Build the shipped provider over one workspace. */
export function createDirectoryLock(options: DirectoryLockOptions): DirectoryLock {
  const place = options.place;
  const paths = lockPathsOf(place);
  const now = options.now ?? ((): Date => new Date());
  let held: { endpoint: LivenessEndpoint; lease: Lease; token: MintedToken } | null = null;
  // The identity this provider would acquire with, remembered from the last
  // attempt so that `reclaim(scope)` — which EP-13 gives no owner — can
  // acquire as D-4 asks, with the owner record of the WINNER and never with
  // the dead owner's.
  let intended: { owner: OwnerRecord; input: AcquireInput } | null = options.reclaimAs ?? null;

  const acquireHere = async (
    owner: OwnerRecord,
    input: AcquireInput,
  ): Promise<DirectoryAcquireResult> => {
    intended = { owner, input };
    // The endpoint FIRST: the lock must never be visible without a liveness
    // its owner already answers on, or a prober would read `unknown` about a
    // run that is perfectly alive. The endpoint is named by the process id,
    // so two contenders never collide on it (research D-3).
    const listened = await listenForLiveness(workspaceIdentityOf(place.workspaceRealPath), {
      runtimeDirectory: options.runtimeDirectory,
      instance: nextEndpointInstance(),
    });
    if (!listened.ok) {
      // F122-FR-021 — where the endpoint cannot be created, `acquire` gives
      // `unknown`, and the doctor names the cause.
      return Object.freeze({
        acquired: false as const,
        conflict: "conflict" as const,
        holder: anUnreadableHolder(),
        error: "unknown" as const,
        detail: listened.cause,
        endpointFailure: listened.failure,
      });
    }
    const acquiredAt = now().toISOString();
    const token = mintLeaseToken();
    const record = ownerRecordFor(owner, listened.endpoint.path, acquiredAt, input);
    const lease = leaseFor(record, input, acquiredAt, token.hash);
    let pending: string;
    try {
      pending = buildPendingLock(paths, record, lease);
    } catch (error) {
      await listened.endpoint.close();
      return Object.freeze({
        acquired: false as const,
        conflict: "conflict" as const,
        holder: anUnreadableHolder(),
        error: "unknown" as const,
        detail: `the lock could not be built: ${messageOf(error)}`,
      });
    }
    try {
      // THE one operation that excludes. A rename onto an existing,
      // non-empty directory fails; there is no window in which the lock
      // exists without its owner record (research D-1).
      renameSync(pending, paths.lockDirectory);
    } catch (error) {
      removeQuietly(pending);
      await listened.endpoint.close();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOTDIR") {
        const holder = readHolder(paths);
        return Object.freeze({
          acquired: false as const,
          conflict: "conflict" as const,
          holder: holder ?? anUnreadableHolder(),
          ...(holder === null ? { error: "unknown" as const } : {}),
          detail: conflictDetail(paths, holder),
        });
      }
      return Object.freeze({
        acquired: false as const,
        conflict: "conflict" as const,
        holder: anUnreadableHolder(),
        error: "unknown" as const,
        detail: `the lock could not be renamed into place: ${messageOf(error)}`,
      });
    }
    // Read the owner record back THROUGH THE NAME OF THE LOCK. The rename
    // reported success; this is the file system agreeing with it. A reader
    // that trusted the return value alone could not tell a win from a
    // replacement of an empty directory.
    const readBack = readHolder(paths) as LockOwnerRecord | null;
    if (readBack === null || readBack.runTokenHash !== record.runTokenHash) {
      await listened.endpoint.close();
      return Object.freeze({
        acquired: false as const,
        conflict: "conflict" as const,
        holder: readBack ?? anUnreadableHolder(),
        error: "unknown" as const,
        detail:
          `the rename reported success and the lock \`${paths.lockDirectory}\` does not carry ` +
          `this owner's record: the lock was not taken`,
      });
    }
    held = { endpoint: listened.endpoint, lease, token };
    return Object.freeze({
      acquired: true as const,
      lease,
      owner: record,
      endpoint: listened.endpoint,
      leaseToken: token,
    });
  };

  const provider: DirectoryLock = Object.freeze({
    id: SHIPPED_PROVIDER_ID,
    version: SHIPPED_PROVIDER_VERSION,
    paths,
    get endpoint(): LivenessEndpoint | null {
      return held?.endpoint ?? null;
    },

    async acquire(
      _scope: LockScope,
      owner: OwnerRecord,
      input: AcquireInput = defaultInput(),
    ): Promise<AcquireResult> {
      const result = await acquireHere(owner, input);
      return result as AcquireResult;
    },

    acquireHere,

    heartbeat(lease: Lease): Promise<void> {
      // F122-FR-014 — the owner writes a heartbeat at a fixed interval; the
      // lease holds the interval and `validUntil`. An OLD heartbeat with a
      // LIVE owner never makes the probe report a dead owner: the probe
      // reads the endpoint and never this file, which is why a machine that
      // slept wakes up held and not stale.
      const current = readLease(paths);
      if (current === null) return Promise.resolve();
      const at = now();
      // ONE formula, the one of `../lease/timing.ts`: heartbeat plus grace.
      const grace = graceOfTheLease(lease) ?? graceOfTheLease(current) ?? GRACE_SECONDS;
      const next = {
        ...current,
        heartbeatAt: at.toISOString(),
        validUntil: validUntilOf(at, grace),
      };
      atomicWriteJson(paths.leaseFile, next, { mode: FILE_MODE });
      if (held !== null) held = { ...held, lease: next as Lease };
      return Promise.resolve();
    },

    async release(_lease: Lease): Promise<void> {
      // Every exit path the owner controls ends here (F122-FR-020). The
      // order matters: the lock goes first, because that is what another
      // launch waits on; then the endpoint, then the marker.
      removeQuietly(paths.lockDirectory);
      if (held !== null) await held.endpoint.close();
      held = null;
      removeQuietly(paths.advisoryMarkerFile);
    },

    async probe(_scope: LockScope): Promise<ProbeResult> {
      return (await probeLock(place, options.probeDependencies)).result;
    },

    probeHere(): Promise<ProbeOutcome> {
      return probeLock(place, options.probeDependencies);
    },

    async reclaim(_scope: LockScope): Promise<ReclaimResult> {
      const outcome = await reclaimByOneAtomicRename(place, {
        acquire: (owner, input) => acquireHere(owner, input as AcquireInput),
        probeDependencies: options.probeDependencies,
        now,
        ...(intended === null ? {} : { owner: intended.owner, input: intended.input }),
      });
      return outcome as ReclaimResult;
    },

    reclaimHere(owner: OwnerRecord, input: AcquireInput): Promise<ReclaimOutcome> {
      return reclaimByOneAtomicRename(place, {
        acquire: (nextOwner, nextInput) => acquireHere(nextOwner, nextInput as AcquireInput),
        probeDependencies: options.probeDependencies,
        now,
        owner,
        input,
      });
    },

    handDown(_lease: Lease): HandDownToken {
      // F122-FR-018 — the lease holds only the HASH of the token.
      const token = mintLeaseToken();
      const current = readLease(paths);
      if (current !== null) {
        atomicWriteJson(
          paths.leaseFile,
          { ...current, leaseTokenHash: token.hash },
          { mode: FILE_MODE },
        );
      }
      if (held !== null) held = { ...held, token };
      return token.secret();
    },

    verify(token: HandDownToken): Promise<boolean> {
      // F122-FR-018 — `verify` answers whether the process that handed the
      // token down still holds the lease, and answers "no" when the provider
      // fails. Every path below that cannot read the answer returns false.
      try {
        const current = readLease(paths);
        if (current === null) return Promise.resolve(false);
        if (typeof token !== "string" || token === "") return Promise.resolve(false);
        if (hashToken(token) !== current.leaseTokenHash) return Promise.resolve(false);
        const owner = readHolder(paths) as LockOwnerRecord | null;
        if (owner === null) return Promise.resolve(false);
        const leased = current.owner as unknown as OwnerRecord;
        return Promise.resolve(owner.runTokenHash === leased.runTokenHash);
      } catch {
        return Promise.resolve(false);
      }
    },
  });
  return provider;
}

/** The point this provider implements, for a registry that asks. */
export const PROVIDER_POINT_ID = POINT_ID;

/* ------------------------------------------------------------------ *
 * The pieces.
 * ------------------------------------------------------------------ */

/**
 * D-1 — build the whole lock under a temporary name in the SAME directory as
 * the lock, so that the rename is within one file system and is atomic. The
 * owner record and the lease are inside it before it is renamed, which is the
 * guarantee *a lock never exists without its owner record* (F122-FR-014).
 */
export function buildPendingLock(paths: LockPaths, owner: LockOwnerRecord, lease: Lease): string {
  mkdirSync(paths.parentDirectory, { recursive: true, mode: DIRECTORY_MODE });
  const pending = mkdtempSync(join(paths.parentDirectory, PENDING_PREFIX));
  chmodSync(pending, DIRECTORY_MODE);
  writeFileSync(join(pending, OWNER_RECORD_FILE), JSON.stringify(owner, null, 2) + "\n", {
    mode: FILE_MODE,
  });
  writeFileSync(join(pending, LEASE_FILE), JSON.stringify(lease, null, 2) + "\n", {
    mode: FILE_MODE,
  });
  return pending;
}

/** The owner record as it is written into the lock (annex B, §B.9 and D-3). */
export function ownerRecordFor(
  owner: OwnerRecord,
  endpoint: string,
  acquiredAt: string,
  input: AcquireInput,
): LockOwnerRecord {
  return Object.freeze({
    ...owner,
    // The owner record holds the path of its endpoint (research D-3), the
    // time the lock was taken (F122-FR-016 names it in the refusal) and the
    // run, so that a probe can find the process registry of row P5.
    [ENDPOINT_FIELD]: endpoint,
    [ACQUIRED_AT_FIELD]: acquiredAt,
    runId: input.runId,
    ...(input.asIsRunId === undefined ? {} : { asIsRunId: input.asIsRunId }),
  }) as LockOwnerRecord;
}

/** The lease of a lock that was just taken (annex B, §B.8). */
export function leaseFor(
  owner: LockOwnerRecord,
  input: AcquireInput,
  acquiredAt: string,
  leaseTokenHash: string,
): Lease {
  const every = input.heartbeatEverySeconds ?? HEARTBEAT_EVERY_SECONDS;
  const grace = input.graceSeconds ?? GRACE_SECONDS;
  return Object.freeze({
    schema: LEASE_SCHEMA_ID,
    runId: input.runId,
    launchId: input.launchId,
    launchNonce: input.launchNonce,
    owner: owner as unknown as Record<string, unknown>,
    lockProvider: SHIPPED_PROVIDER_ID,
    heartbeatAt: acquiredAt,
    heartbeatEverySeconds: every,
    // §B.8 — heartbeat plus grace, through the one formula (`../lease/timing.ts`).
    validUntil: validUntilOf(acquiredAt, grace),
    [GRACE_FIELD]: grace,
    leaseTokenHash,
  }) as Lease;
}

/**
 * The grace a lease was written with. §B.8 does not give the lease a field for
 * it — it has the interval and `validUntil` — so the provider keeps it beside
 * the fields of the annex, additively (F100-FR-049), and every heartbeat
 * recomputes `validUntil` with the SAME grace the lease was written with
 * rather than with the shipped default.
 */
export const GRACE_FIELD = "graceSeconds" as const;

/** The grace of a lease, where it carries one. */
export function graceOfTheLease(lease: Lease | null | undefined): number | null {
  const value = (lease as unknown as Record<string, unknown> | null | undefined)?.[GRACE_FIELD];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The owner record of the lock as it lies on disk, or `null`. */
export function readHolder(paths: LockPaths): OwnerRecord | null {
  try {
    return JSON.parse(readFileSync(paths.ownerRecordFile, "utf8")) as OwnerRecord;
  } catch {
    return null;
  }
}

/** The lease of the lock as it lies on disk, or `null`. */
export function readLease(paths: LockPaths): Lease | null {
  try {
    return JSON.parse(readFileSync(paths.leaseFile, "utf8")) as Lease;
  } catch {
    return null;
  }
}

/**
 * F122-FR-011 — *every other receives a conflict that NAMES THE HOLDER.* The
 * line names the logical name of the lock, the host, the launch and the time
 * the lock was taken, which is also what F122-FR-016 asks a refusal to name.
 */
export function conflictDetail(paths: LockPaths, holder: OwnerRecord | null): string {
  if (holder === null) {
    return (
      `\`workspace:lock\` is held and its owner record at \`${paths.ownerRecordFile}\` cannot ` +
      `be read: the result is \`unknown\`, which counts as held (F122-FR-013)`
    );
  }
  const extra = holder as LockOwnerRecord;
  return (
    `\`workspace:lock\` is held by the launch \`${holder.launchId}\` on host ` +
    `\`${holder.hostName}\` (pid ${holder.pid}), taken at ` +
    `\`${extra[ACQUIRED_AT_FIELD] ?? UNKNOWN_FIELD}\` (F122-FR-011)`
  );
}

/** F122-FR-020 — after a release a probe says `free`. */
export async function probeAfterRelease(
  place: LockPlace,
  dependencies: ProbeDependencies = {},
): Promise<ProbeOutcome> {
  return probeLock(place, dependencies);
}

/** True where the result of a probe counts as held (F122-FR-013). */
export { countsAsHeld };

function defaultInput(): AcquireInput {
  return { runId: "unknown", launchId: "unknown", launchNonce: "unknown" };
}

function removeQuietly(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  } catch {
    /* a path that cannot be removed is reported by the next probe */
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
