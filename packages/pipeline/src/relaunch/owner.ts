/**
 * T031 — the `relaunch.owner` switch (F123-FR-027, F123-FR-030).
 *
 * `relaunch.owner` is ordinary configuration with the values `root` and
 * `supervise` and the default `root`. With `root` the runtime root stays
 * alive after a failed stage and consults table 2 of §R.6. With `supervise`
 * the runtime root exits with the pipeline code at a failed stage and
 * `supervise observe` classifies with table 1 and relaunches. An unknown
 * value is a configuration error. The value is recorded in the run record
 * and is the same for the whole run.
 */

/** The two values of `relaunch.owner` (F123-FR-027). */
export const RELAUNCH_OWNERS = ["root", "supervise"] as const;
export type RelaunchOwner = (typeof RELAUNCH_OWNERS)[number];

/** The default owner: the runtime root looks after the run itself. */
export const RELAUNCH_OWNER_DEFAULT: RelaunchOwner = "root";

/** An unknown `relaunch.owner` value (a configuration error, F123-FR-027). */
export class RelaunchOwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelaunchOwnerError";
  }
}

/**
 * Resolve `relaunch.owner`: absent or empty reads the default `root`; an
 * unknown value is a configuration error.
 */
export function resolveRelaunchOwner(value?: string | null): RelaunchOwner {
  if (value === undefined || value === null || value === "") return RELAUNCH_OWNER_DEFAULT;
  if ((RELAUNCH_OWNERS as readonly string[]).includes(value)) return value as RelaunchOwner;
  throw new RelaunchOwnerError(
    `unknown relaunch.owner ${JSON.stringify(value)}; the values are ${RELAUNCH_OWNERS.join(" and ")}`,
  );
}

/** Whether the runtime root stays alive after a failed stage under this owner. */
export function ownerStaysAlive(owner: RelaunchOwner): boolean {
  return owner === "root";
}

/**
 * The exit the runtime root takes at a failed stage: `null` under `root` —
 * the root stays alive and consults table 2 —, the pipeline code under
 * `supervise` (F123-FR-027).
 */
export function ownerExitAtFailedStage(input: {
  owner: RelaunchOwner;
  pipelineExitCode: number;
}): number | null {
  return input.owner === "root" ? null : input.pipelineExitCode;
}

/**
 * The value recorded in the run record: fixed once at the start of the run
 * and the same for the whole run, relaunches included (F123-FR-027).
 */
export function ownerRecordForRun(owner: RelaunchOwner): {
  relaunchOwner: RelaunchOwner;
  fixedForRun: true;
} {
  return { relaunchOwner: owner, fixedForRun: true };
}
