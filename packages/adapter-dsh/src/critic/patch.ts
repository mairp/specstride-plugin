/**
 * T042 — the patch file of the critic, its hash and its removal (F130-FR-023).
 *
 * The critic is made tool-less by a patch file that disables the model-facing
 * tools of the harness by id: 18 tools, in the groups shell, filesystem,
 * search, skills, sub-agents, workflow, web, todo and user questions. The ids
 * are DATA of the adapter (`data/critic-patch.json`, dated and pinned
 * `0.1.0-rc.8`). The patch is written to a temporary file for the call, at
 * the logical name `pass:<passId>:critic-patch`; its hash is recorded in the
 * record of the call; and the file is REMOVED after the call, also when the
 * call failed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The logical name of the patch file (feature 100, annex B §B.5). */
export const CRITIC_PATCH_LOGICAL_PREFIX = "pass:" as const;
export const CRITIC_PATCH_LOGICAL_SUFFIX = ":critic-patch" as const;

/** The logical name of the patch of one pass. */
export function criticPatchLogicalName(passId: string): string {
  return `${CRITIC_PATCH_LOGICAL_PREFIX}${passId}${CRITIC_PATCH_LOGICAL_SUFFIX}`;
}

/** The data of the patch, as `data/critic-patch.json` states it. */
const PATCH_DATA_PATH = fileURLToPath(new URL("../../data/critic-patch.json", import.meta.url));

/** One disabled entry of the patch: the id, and `disabled: true`. */
export type DisabledTool = { readonly id: string; readonly disabled: true };

/** The 18 tool ids the patch disables (F130-FR-023), from the adapter data. */
export const CRITIC_PATCH_IDS: readonly string[] = Object.freeze(
  (JSON.parse(readPatchData()) as { readonly disabled: readonly { id: string }[] }).disabled.map(
    (entry) => entry.id,
  ),
);

function readPatchData(): string {
  // Read lazily so importing the module never touches the filesystem of a
  // consumer that does not use the critic role.
  return readFileSync(PATCH_DATA_PATH, "utf8");
}

/** The number of ids the patch holds (18; F130-FR-023). */
export const CRITIC_PATCH_ENTRY_COUNT = CRITIC_PATCH_IDS.length;

/** The JSON document written to the temporary patch file. */
export function criticPatchDocument(): {
  readonly schema: string;
  readonly harness: string;
  readonly disabled: readonly DisabledTool[];
} {
  return {
    schema: "specstride.adapter-critic-patch/1",
    harness: "dsh",
    disabled: CRITIC_PATCH_IDS.map((id) => ({ id, disabled: true as const })),
  };
}

/** The sha256 hash of the patch document, recorded in the record of the call. */
export function criticPatchHash(document: unknown): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

/** A written patch file: its path, its hash, and the removal that always runs. */
export type CriticPatchFile = {
  /** The logical name `pass:<passId>:critic-patch`. */
  readonly logicalName: string;
  readonly path: string;
  readonly hash: string;
  readonly entryCount: number;
  /** Removes the file; idempotent; safe after a failed call. */
  readonly remove: () => void;
};

/**
 * Writes the patch file for one pass (F130-FR-023): a temporary file in the
 * system temporary directory holding `criticPatchDocument()`. The removal
 * takes the file and, when it created it, the holding directory.
 */
export function writeCriticPatch(passId: string): CriticPatchFile {
  const dir = mkdtempSync(join(tmpdir(), "specstride-dsh-patch."));
  const path = join(dir, "critic-patch.json");
  const document = criticPatchDocument();
  // The loader takes a top-level list of patch entries; JSON is YAML to it.
  const entries = document.disabled.map(({ id }) => ({ id, disabled: true }));
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  const hash = criticPatchHash(document);
  let removed = false;
  return {
    logicalName: criticPatchLogicalName(passId),
    path,
    hash,
    entryCount: document.disabled.length,
    remove: () => {
      if (removed) return;
      removed = true;
      try {
        if (existsSync(path)) rmSync(path, { force: true });
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort: the call is over either way */
      }
    },
  };
}
