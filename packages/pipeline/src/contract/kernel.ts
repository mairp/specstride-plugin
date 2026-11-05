/**
 * T006 — the wiring of the kernel primitives of `@specstride/kernel` into the
 * launch contract (specs/107-launch-contract/tasks.md, T006).
 *
 * The canonical hasher (feature 104), the redactor (feature 111) and the
 * atomic write of the kernel are imported here — ONCE — and every module of
 * `src/contract/` reaches them through this module, so that the rest of the
 * launch contract depends on the kernel and not on where a primitive lives.
 *
 * NO HASHER IS WRITTEN HERE (F104-FR-027: there is one hashing scheme, and no
 * feature compares hashes itself). This module holds no hash function, no
 * digest construction and no canonicalization rule of its own: `contentHash`,
 * `canonicalRecordText`/`canonicalRecordHash` and
 * `taskListHashIgnoringCheckboxes` are the kernel's own exports, handed
 * through unchanged. `NO_HASHER_IS_WRITTEN_HERE` records that, and the test
 * of this wiring proves that the values this module hands out ARE the
 * kernel's values (same function objects), not local copies.
 */
import {
  contentHash,
  canonicalRecordText,
  canonicalRecordHash,
  taskListHashIgnoringCheckboxes,
  taskListHashIgnoringCheckboxesOfBytes,
  createRedactor as theRedactorOfTheLaunchContract,
  atomicWrite,
  atomicWriteJson,
  type Redactor,
} from "@specstride/kernel";

/** T006 — no hasher, no redactor and no atomic write is written in this package. */
export const NO_HASHER_IS_WRITTEN_HERE = true as const;

/** The canonical hasher of feature 104, by reference (never reimplemented). */
export const hashContent = contentHash;

/**
 * The hash of the consumer's comment (F107-FR-034): the hash over the text as
 * typed, taken with the canonical hasher of feature 104 and nothing else.
 */
export function hashComment(text: string): string {
  return contentHash(text);
}

/**
 * The hash of a source that ignores the checkboxes of the task list
 * (F107-FR-004; data-model.md, `Source`).
 */
export function hashTasksIgnoringCheckboxes(taskList: string): string {
  return taskListHashIgnoringCheckboxes(taskList);
}

/** The canonical record hash, e.g. for the proof of promotion (§G.8). */
export { canonicalRecordHash, canonicalRecordText, taskListHashIgnoringCheckboxesOfBytes };

/**
 * The redactor of feature 111 (F100-FR-229). Every form of the consumer's
 * comment that is printed or recorded passes through it, and is cut to a
 * size cap (F107-FR-034). The redaction itself stays in the redactor of
 * `@specstride/kernel` (F111-FR-023: no redaction is decided here); the
 * import is bound under the name of the caller, as the ingress of feature
 * 106 binds it, and this file writes no rule of what a redaction is.
 */
export function redactor(): Redactor {
  return theRedactorOfTheLaunchContract();
}

/** The default cap of a printed or recorded comment (F107-FR-034). */
export const COMMENT_TEXT_CAP_BYTES = 512 as const;

/**
 * The comment as it may be printed or recorded: redacted by the redactor of
 * feature 111 and cut to the cap at a character boundary, never mid-character.
 * Returns `none` for an absent comment (the key of the dry-run line).
 */
export function redactAndCutComment(
  text: string | undefined,
  cap: number = COMMENT_TEXT_CAP_BYTES,
): string {
  if (text === undefined || text === "") return "none";
  const redacted = redactor().redact(text, cap);
  return redacted.text;
}

/**
 * The atomic write of the kernel (F100-FR-036): a temporary name in the same
 * directory, fsync, rename. The launch contract, the launcher and the launch
 * bundle are written through it and through nothing else.
 */
export const writeAtomically = atomicWrite;
export const writeAtomicallyJson = atomicWriteJson;
