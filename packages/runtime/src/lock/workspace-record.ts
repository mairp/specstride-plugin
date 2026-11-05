/**
 * T032 — the provider is recorded in the workspace record and a different one
 * is refused; the identity of the workspace is derived from the real path
 * (F122-FR-019; annex B, §B.6).
 *
 * Two sentences of F122-FR-019, and this module is both of them.
 *
 * **The provider is recorded at the FIRST acquire.** A workspace whose lock
 * was once taken by one provider must never be taken by another, because the
 * two do not exclude each other: a directory lock and a lock of some other
 * shape would both succeed, and two runs would work in one workspace. So the
 * id and the version of the provider that first acquired go into
 * `workspace:record`, and a launch whose configured provider differs is
 * refused with a doctor finding — refused, and not migrated, because there is
 * no safe moment at which to change the shape of a lock that something may be
 * holding.
 *
 * **The identity is derived from the REAL path and never read from a file
 * inside the workspace.** A file inside the workspace travels with a copy of
 * the workspace: copy a tree and the copy would claim the original's identity,
 * take the original's control plane and its lock, and two trees would share
 * one run. Deriving it from the real path of the root means a copy has a
 * different identity by construction, and a symbolic link to a tree has the
 * same identity as the tree, which is what a consumer means by "the same
 * workspace".
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
  SCHEMA_ID as WORKSPACE_RECORD_SCHEMA_ID,
  lockProviderMatches,
  tryReadWorkspaceRecord,
  type WorkspaceRecord,
} from "@specstride/contracts/records/workspace-record";
import { layoutVersion } from "@specstride/contracts/ids/logical-names";
import { atomicWriteJson } from "@specstride/kernel";
import { FILE_MODE } from "../root/control-root.ts";
import { lockPathsOf, type LockPlace } from "./paths.ts";

export { WORKSPACE_RECORD_SCHEMA_ID };
export type { WorkspaceRecord };

/** The requirement this module carries and the annex that owns the record. */
export const WORKSPACE_RECORD_REQUIREMENT = "F122-FR-019" as const;
export const WORKSPACE_RECORD_ANNEX_SECTION = "annex B, §B.6" as const;

/** F122-FR-019 — the identity is never read from a file inside the workspace. */
export const IDENTITY_IS_READ_FROM_A_FILE_IN_THE_WORKSPACE = false as const;

/** How the identity is derived, and how long it is. */
export const IDENTITY_ALGORITHM = "sha256" as const;
export const IDENTITY_CHARACTERS = 32 as const;

/** The refusal of F122-FR-019, a member of closed set 212. */
export const PROVIDER_MISMATCH = "provider-mismatch" as const;

/** The exit code of a launch refused with `provider-mismatch`. */
export const PROVIDER_MISMATCH_LAUNCH_EXIT = 4 as const;

/** The id and the version of a lock provider, as the record carries them. */
export type ProviderIdentity = { readonly id: string; readonly version: string };

/**
 * F122-FR-019 — the identity of a workspace, from the REAL path of its root.
 *
 * `realpathSync` resolves every symbolic link and every `..`, so two names of
 * one tree give one identity and a copy of the tree gives another. A path
 * that does not exist cannot be resolved; its identity is derived from the
 * path as given, because a launch in a directory that is not there is refused
 * for that reason and not for a wrong identity.
 */
export function workspaceIdentityOf(workspaceRoot: string): string {
  const real = realPathOf(workspaceRoot);
  return createHash(IDENTITY_ALGORITHM)
    .update(real, "utf8")
    .digest("hex")
    .slice(0, IDENTITY_CHARACTERS);
}

/** The real path of the workspace root, or the path as given where there is none. */
export function realPathOf(workspaceRoot: string): string {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

/** What a reading of the workspace record answers. */
export type WorkspaceRecordReading =
  | { readonly present: true; readonly record: WorkspaceRecord }
  | { readonly present: false; readonly refusal: string | null };

/** Read `workspace:record`, or say why it could not be read. */
export function readWorkspaceRecordOf(place: LockPlace): WorkspaceRecordReading {
  const path = lockPathsOf(place).workspaceRecordFile;
  if (!existsSync(path)) return Object.freeze({ present: false as const, refusal: null });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return Object.freeze({
      present: false as const,
      refusal: `\`workspace:record\` cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  const read = tryReadWorkspaceRecord(parsed);
  if (!read.ok) {
    return Object.freeze({
      present: false as const,
      refusal: `\`workspace:record\` is not valid: ${read.error.message}`,
    });
  }
  return Object.freeze({ present: true as const, record: read.record });
}

/** What `recordTheProvider` answers. */
export type ProviderRecording =
  | {
      readonly ok: true;
      /** True where this call wrote the record; false where it was already there. */
      readonly written: boolean;
      readonly record: WorkspaceRecord;
    }
  | {
      readonly ok: false;
      readonly refusal: typeof PROVIDER_MISMATCH;
      readonly recorded: ProviderIdentity;
      readonly configured: ProviderIdentity;
      readonly exit: typeof PROVIDER_MISMATCH_LAUNCH_EXIT;
      readonly detail: string;
    };

/**
 * F122-FR-019 — record the provider at the first acquire, and refuse a
 * different one.
 *
 * The write is atomic, so a reader never meets a half-written record, and the
 * record is written BEFORE the lock would be used, so a crash between the two
 * leaves a workspace whose provider is known and whose lock is free — which
 * is recoverable — and never the other way round.
 */
export function recordTheProvider(
  place: LockPlace,
  configured: ProviderIdentity,
  productVersion = "0.0.0",
  now: () => Date = () => new Date(),
): ProviderRecording {
  const reading = readWorkspaceRecordOf(place);
  if (reading.present) {
    const recorded = recordedProviderOf(reading.record);
    if (!lockProviderMatches(reading.record, configured)) {
      return Object.freeze({
        ok: false as const,
        refusal: PROVIDER_MISMATCH,
        recorded,
        configured,
        exit: PROVIDER_MISMATCH_LAUNCH_EXIT,
        detail: providerMismatchDetail(recorded, configured),
      });
    }
    return Object.freeze({ ok: true as const, written: false, record: reading.record });
  }
  const paths = lockPathsOf(place);
  const record: WorkspaceRecord = {
    schema: WORKSPACE_RECORD_SCHEMA_ID,
    layoutVersion,
    workspaceId: workspaceIdentityOf(place.workspaceRealPath),
    realPath: realPathOf(place.workspaceRealPath),
    createdAt: now().toISOString(),
    productVersion,
    lockProvider: { id: configured.id, version: configured.version },
  };
  atomicWriteJson(paths.workspaceRecordFile, record, {
    mode: FILE_MODE,
    createDirectory: true,
  });
  return Object.freeze({ ok: true as const, written: true, record });
}

/** The provider the record names (annex B, §B.6). */
export function recordedProviderOf(record: WorkspaceRecord): ProviderIdentity {
  const held = record.lockProvider as { id?: unknown; version?: unknown };
  return Object.freeze({
    id: typeof held?.id === "string" ? held.id : "unknown",
    version: typeof held?.version === "string" ? held.version : "unknown",
  });
}

/** F122-FR-019 — the line of the refusal and of the doctor finding. */
export function providerMismatchDetail(
  recorded: ProviderIdentity,
  configured: ProviderIdentity,
): string {
  return (
    `the lock of this workspace was first taken by the provider \`${recorded.id}\` ` +
    `(version ${recorded.version}) and \`runtime.lock.provider\` now names ` +
    `\`${configured.id}\` (version ${configured.version}); two providers do not exclude each ` +
    `other, so the launch is refused with \`${PROVIDER_MISMATCH}\` (F122-FR-019)`
  );
}

/**
 * F122-FR-019 — whether the configured provider is the recorded one. A
 * workspace with no record yet agrees with any provider: the first acquire
 * is what records it.
 */
export function providerIsTheRecordedOne(place: LockPlace, configured: ProviderIdentity): boolean {
  const reading = readWorkspaceRecordOf(place);
  if (!reading.present) return true;
  return lockProviderMatches(reading.record, configured);
}
