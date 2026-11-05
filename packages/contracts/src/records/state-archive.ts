/**
 * T062 — the interface type of the signed archive of one feature, and the
 * rule that none of the three commands runs beside a live run (annex B,
 * §B.19; F100-FR-075). Data for feature 122, which owns the commands.
 */
import type { LedgerRecord } from "./ledger-record.ts";
import type { ApprovalRecord } from "./approval-record.ts";

/** The schema id of the archive (annex B, §B.20). */
export const SCHEMA_ID = "specstride.state-archive/1" as const;

/** The three commands of §B.19. */
export const STATE_COMMANDS = ["state export", "state import", "state adopt"] as const;
export type StateCommand = (typeof STATE_COMMANDS)[number];

/** What `state export` writes: the control plane of one feature, signed. */
export type StateArchive = {
  readonly schema: typeof SCHEMA_ID;
  /** The feature the archive belongs to. */
  readonly feature: string;
  /** The approval records of the feature, one per approved phase. */
  readonly approvals: readonly ApprovalRecord[];
  /** The ledger of the feature's run. */
  readonly ledger: readonly LedgerRecord[];
  /** The learning log of the feature, as read by logical name. */
  readonly learningLog: readonly Record<string, unknown>[];
  /** The time of the export. */
  readonly exportedAt: string;
  /** The product version that wrote the archive. */
  readonly productVersion: string;
  /** Which key signed, and the signature over every field above. */
  readonly keyId: string;
  readonly sig: string;
};

/** The three parts of the control plane the archive carries (§B.19). */
export const ARCHIVED_PARTS = ["approvals", "ledger", "learningLog"] as const;

/**
 * F100-FR-075 — the three commands MUST NOT run while a run of the feature is
 * alive. `refusalBesideALiveRun` gives the refusal, or `undefined` when the
 * command may run.
 */
export function refusalBesideALiveRun(
  command: StateCommand,
  featureHasALiveRun: boolean,
): string | undefined {
  if (!featureHasALiveRun) return undefined;
  return `\`${command}\` does not run beside a live run of the feature (F100-FR-075)`;
}

/** `state import` verifies the archive before it installs it (F100-FR-075). */
export function mayInstall(archive: StateArchive, signatureIsValid: boolean): boolean {
  return archive.schema === SCHEMA_ID && signatureIsValid;
}

/** `state adopt` takes over the control plane of the same working tree at an old path. */
export type AdoptRequest = {
  readonly workspaceRealPath: string;
  readonly oldControlRoot: string;
};

export function mayAdopt(request: AdoptRequest, recordedRealPath: string): boolean {
  return request.workspaceRealPath === recordedRealPath;
}
