/**
 * T011 — the lock at start and the exit 24 with its two lines
 * (F123-FR-007), through the lock provider of EP-13.
 *
 * The pipeline entry takes the one lock of the workspace, before any state is
 * written. When the lock is held it ends with exit 24, printing
 * `[BLOCKED] another launcher owns <pipeline run>` and the digest with
 * `exit=24`. Nothing else of the run is started: no stage, no log, no event.
 */
import type { epLock } from "@specstride/contracts";

type LockProvider = epLock.LockProvider;
type LockScope = epLock.LockScope;
type AcquireResult = epLock.AcquireResult;
type OwnerRecord = Parameters<LockProvider["acquire"]>[1];
type Lease = Extract<AcquireResult, { acquired: true }>["lease"];
import { EXIT_CODES } from "../executor/exit.ts";

/** The two lines of a held lock, in the order they are printed. */
export type LockHeldLines = {
  blocked: string;
  digest: string;
};

/** The lines the entry prints when the lock is held (§R.2). */
export function lockHeldLines(pipelineRun: string): LockHeldLines {
  return {
    blocked: `[BLOCKED] another launcher owns ${pipelineRun}`,
    digest: `[DIGEST] state=failed exit=24 last-stage=none evidence=${pipelineRun}`,
  };
}

/** The result of taking the lock at start. */
export type LockOutcome =
  { held: false; lease: Lease } | { held: true; exit: number; lines: LockHeldLines };

/** The default owner record of the pipeline entry. */
export function pipelineOwner(pipelineId: string): OwnerRecord {
  return {
    kind: "pipeline",
    id: pipelineId,
    pid: process.pid,
    started_at: Math.trunc(Date.now() / 1_000),
  } as unknown as OwnerRecord;
}

/**
 * Take the workspace lock through the provider of EP-13 (F123-FR-007).
 * `unknown` counts as held (§F.5), so only a clear `acquired` starts the run.
 */
export async function acquireWorkspaceLock(input: {
  provider: LockProvider;
  scope: LockScope;
  owner: OwnerRecord;
  pipelineRun: string;
}): Promise<LockOutcome> {
  const result: AcquireResult = await input.provider.acquire(input.scope, input.owner);
  if (result.acquired) {
    return { held: false, lease: result.lease } as LockOutcome;
  }
  const lines = lockHeldLines(input.pipelineRun);
  return { held: true, exit: EXIT_CODES.lockHeld, lines };
}

/** Release the lock at the end of the run; a failed release is not an error of the run. */
export async function releaseWorkspaceLock(provider: LockProvider, lease: Lease): Promise<void> {
  try {
    await provider.release(lease);
  } catch {
    /* the lease expires on its own; the run stands */
  }
}
