/**
 * T044 — the comment path of the consumer (F107-FR-034): the argument, the
 * hash at derivation, the comparison and the store at launch, the redaction
 * and the size cap.
 *
 * The order the requirement fixes:
 *
 * - the comment travels verbatim as ONE argument, `--comment`, of
 *   `contract derive` and of `launch`; the hash is taken over the text as
 *   typed, with the canonical hasher of feature 104 and nothing else
 *   (`hashComment` of `src/contract/kernel.ts`, which IS the kernel's
 *   hasher — no hash is computed here);
 * - `contract derive` is the first command that reads the repository: it
 *   records the hash in the draft (`configuration.comment`) BEFORE it prints
 *   anything, so that the comment is bound before any repository text
 *   reaches the host. This module only provides the value; the printing
 *   order is the command's (`commands/derive.ts` builds the record before
 *   the line is composed);
 * - `launch` compares the hash of the comment it is given with the hash the
 *   promoted launch contract recorded. A difference — or one side with a
 *   comment and the other without — refuses the launch with the reason
 *   `comment-changed` and the code of a refusal of `launch` (annex G §G.4),
 *   and nothing starts. A relaunch carries the hash of the first launch and
 *   is NOT compared;
 * - in the mode `run`, `launch` keeps the comment under the logical name
 *   `launch:<launchId>:comment` (annex B §B.5), word for word after the
 *   redactor, with no other change (F100-FR-229), and hands the HASH to the
 *   launch record, which holds only the hash;
 * - every form of the comment that is printed or recorded passes the
 *   redactor of feature 111 and is cut to a size cap. The redaction and the
 *   cut stay in `src/contract/kernel.ts` (`redactAndCutComment`), which
 *   binds the redactor of `@specstride/kernel`; no rule of redaction is
 *   written here.
 */
import {
  COMMENT_TEXT_CAP_BYTES,
  hashComment,
  redactAndCutComment,
  writeAtomically,
} from "../kernel.ts";

export { COMMENT_TEXT_CAP_BYTES };

/** The reason a launch whose comment differs is refused with (F107-FR-034). */
export const REFUSAL_OF_A_CHANGED_COMMENT = "comment-changed" as const;

/** The code of a refusal of `launch` (annex G §G.4, row "`launch`"). */
export const COMMENT_CHANGED_EXIT = 4 as const;

/**
 * The logical name the kept comment lives under (annex B §B.5;
 * F107-FR-034): `launch:<launchId>:comment`.
 */
export function commentRecordLogicalName(launchId: string): string {
  return `launch:${launchId}:comment`;
}

/**
 * The hash over the comment as typed (F107-FR-034), taken at derivation and
 * recorded in `configuration.comment` before any repository text is printed.
 * No cap applies here: the hash is over the verbatim text.
 */
export function commentHashAtDerivation(comment: string): string {
  return hashComment(comment);
}

/**
 * The record `configuration.comment` holds at derivation (F107-FR-034,
 * F107-FR-035): the hash and what was changed because of the comment — no
 * entry yet on a plain derive, one entry per named option (T045) when the
 * host named some. `changed` entries are appended by `steer.ts`.
 */
export function commentRecordAtDerivation(
  comment: string,
  changed: readonly { readonly option: string; readonly value: unknown }[] = [],
): { readonly hash: string; readonly changed: readonly unknown[] } {
  return { hash: commentHashAtDerivation(comment), changed: [...changed] };
}

/** The refusal of a launch whose comment is not the recorded comment. */
export type ChangedCommentRefusal = {
  readonly reason: typeof REFUSAL_OF_A_CHANGED_COMMENT;
  readonly exit: typeof COMMENT_CHANGED_EXIT;
  readonly message: string;
  readonly next: string;
};

/** What the comparison at launch produces. */
export type CommentComparison =
  | { readonly compared: false; readonly note: "relaunch-not-compared" }
  | { readonly compared: true; readonly changed: false }
  | { readonly compared: true; readonly changed: true; readonly refusal: ChangedCommentRefusal };

function changedRefusal(): ChangedCommentRefusal {
  return {
    reason: REFUSAL_OF_A_CHANGED_COMMENT,
    exit: COMMENT_CHANGED_EXIT,
    message: "launch: the comment of this call is not the comment the launch contract recorded",
    next: "pass the same --comment as the call of `contract derive`, or none",
  };
}

/**
 * Compare the comment of the call with the hash the promoted launch contract
 * recorded (F107-FR-034). One side with a comment and the other without is a
 * difference; a relaunch (`relaunch: true`, the hash of the first launch
 * carried by the run) is NOT compared and never refuses on the comment.
 */
export function compareCommentAtLaunch(input: {
  readonly comment?: string | undefined;
  readonly recordedHash?: string | undefined;
  readonly relaunch?: boolean | undefined;
}): CommentComparison {
  if (input.relaunch === true) {
    return { compared: false, note: "relaunch-not-compared" };
  }
  const given = input.comment !== undefined && input.comment !== "";
  const recorded = input.recordedHash !== undefined && input.recordedHash !== "";
  if (
    given !== recorded ||
    (given && hashComment(input.comment as string) !== input.recordedHash)
  ) {
    return { compared: true, changed: true, refusal: changedRefusal() };
  }
  return { compared: true, changed: false };
}

/**
 * The form of the comment that is printed or recorded (F107-FR-034;
 * F100-FR-229): through the redactor of feature 111, cut to the size cap at
 * a character boundary, with no other change. An absent comment is `none`.
 */
export function commentForStorage(
  comment: string | undefined,
  cap: number = COMMENT_TEXT_CAP_BYTES,
): string {
  return redactAndCutComment(comment, cap);
}

/**
 * What the launch record holds (F107-FR-034): ONLY the hash, over the text
 * as typed. The record never carries the text.
 */
export function commentForLaunchRecord(comment: string): { readonly commentHash: string } {
  return { commentHash: hashComment(comment) };
}

/** What storing the comment at launch produced. */
export type StoredComment = {
  /** The logical name of annex B §B.5 the text is kept under. */
  readonly name: string;
  /** The redacted text as kept (word for word after the redactor). */
  readonly text: string;
  /** The hash over the text as typed, handed to the launch record. */
  readonly hash: string;
};

/**
 * Keep the comment at launch, in the mode `run` (F107-FR-034): the redacted
 * text under `launch:<launchId>:comment`, written through the atomic write
 * of the kernel, and the hash for the launch record returned beside it. The
 * caller hands the path the logical name resolves to; this module writes no
 * path rule of the control plane.
 */
export function storeCommentAtLaunch(input: {
  readonly comment: string;
  readonly launchId: string;
  /** The path the logical name `launch:<launchId>:comment` resolves to. */
  readonly path: string;
  readonly cap?: number;
}): StoredComment {
  const text = commentForStorage(input.comment, input.cap);
  const name = commentRecordLogicalName(input.launchId);
  writeAtomically(input.path, text);
  return { name, text, hash: hashComment(input.comment) };
}
