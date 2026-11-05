import type { FileReader } from "../ports.ts";

/**
 * T060 of feature 118 — the first-failure predicate reader (F118-FR-038;
 * contract `yield-predicates.md`, row `first_failure`; CT-118-4).
 *
 * The predicate reads ONLY whole lines (ended by a line break) that were
 * appended to the same file AFTER the job started, in the same file identity.
 * It is satisfied only when a matching line is still present at two
 * successive polls. A failed line that was in the file before the job
 * started, an incomplete last line, and a line the declared pattern does not
 * match never satisfy it. A file that is truncated or replaced (its identity
 * changes) resets the predicate to the bytes after the change, so no old
 * bytes can fire it.
 *
 * The content of a matched line is a claim: this module never returns it,
 * and nothing downstream may read it as the result of a check (F118-FR-038;
 * the fact for the critic is `fact.ts`, by kind and without counts).
 *
 * Every read goes through the `FileReader` port: no `node:fs` in the core.
 * The result codes are the results of a predicate (row 114 of annex X §X.6):
 * 0 satisfied, 1 not yet, 2 unsatisfiable (an invalid pattern).
 */

/** Satisfied: a matching line present at two successive polls. */
export const FIRST_FAILURE_SATISFIED = 0;
/** Not yet: no matching line, or the match is on its first poll only. */
export const FIRST_FAILURE_NOT_YET = 1;
/** Unsatisfiable: the declared pattern is not a valid regular expression. */
export const FIRST_FAILURE_UNSATISFIABLE = 2;

/** The identity of the log file as the reader last saw it. */
export interface LogIdentity {
  readonly device: number;
  readonly inode: number;
}

/** The state the reader carries from one poll to the next. */
export interface FirstFailureState {
  /** The identity the reader initialized itself against, once seen. */
  identity: LogIdentity | undefined;
  /** True once the identity has been taken (the job-start position). */
  started: boolean;
  /** The byte offset the reader continues from (only whole lines are passed). */
  offsetBytes: number;
  /** True when the accumulated appended bytes held a match at the last poll. */
  matchedAtLastPoll: boolean;
}

/**
 * The fresh state at the start of a wait. Bytes already in the file before
 * the job started are never read: the first poll takes the identity and the
 * size of the file as it stands at the job's start and reads only past it.
 */
export function initialFirstFailureState(): FirstFailureState {
  return { identity: undefined, started: false, offsetBytes: 0, matchedAtLastPoll: false };
}

/** What one poll of the predicate reports. */
export interface FirstFailurePoll {
  /** 0 satisfied, 1 not yet, 2 unsatisfiable (row 114). */
  readonly result:
    | typeof FIRST_FAILURE_SATISFIED
    | typeof FIRST_FAILURE_NOT_YET
    | typeof FIRST_FAILURE_UNSATISFIABLE;
  /** True when this poll reset the reader (a truncated or replaced file). */
  readonly reset: boolean;
  /** True when the appended whole lines of this poll held a match. */
  readonly matchedThisPoll: boolean;
}

/** The reader needs only the file port. */
export interface FirstFailureReaderDeps {
  readonly files: FileReader;
}

/**
 * One poll of the `first_failure` predicate (F118-FR-038). Mutates `state`
 * in place so the caller holds the state across the polls of the wait, as
 * the engine holds the state of a wait (`waiting`).
 */
export function pollFirstFailure(
  state: FirstFailureState,
  input: { readonly path: string; readonly pattern: string },
  deps: FirstFailureReaderDeps,
): FirstFailurePoll {
  const compiled = compilePatternOf(input.pattern);
  if (compiled === undefined)
    return { result: FIRST_FAILURE_UNSATISFIABLE, reset: false, matchedThisPoll: false };

  const identified = deps.files.identify(input.path);
  if (identified === undefined) {
    // A missing file is not yet satisfied, and holds no reset: the job may
    // not have created its log yet.
    return { result: FIRST_FAILURE_NOT_YET, reset: false, matchedThisPoll: false };
  }

  let reset = false;
  const identity = { device: identified.identity.device, inode: identified.identity.inode };
  if (!state.started) {
    // First poll of the wait: everything before this size predates the job.
    state.identity = identity;
    state.offsetBytes = identified.identity.sizeBytes;
    state.started = true;
  } else if (
    identity.device !== state.identity?.device ||
    identity.inode !== state.identity?.inode
  ) {
    // The file was replaced: the predicate resets to the bytes after the change.
    resetTo(state, identity, 0);
    reset = true;
  } else if (identified.identity.sizeBytes < state.offsetBytes) {
    // The same file was truncated: reset to the bytes after the change.
    resetTo(state, identity, 0);
    reset = true;
  }

  const slice = deps.files.readAfter(input.path, state.offsetBytes);
  if (slice === undefined) {
    return { result: FIRST_FAILURE_NOT_YET, reset, matchedThisPoll: false };
  }
  // If the reading saw a newer identity (a replacement between the two
  // calls), the identity change is honoured on the next poll; the bytes of
  // this slice after the offset are still whole-appended bytes of one file.
  const text = new TextDecoder().decode(slice.bytes);
  const lastBreak = text.lastIndexOf("\n");
  const matchedThisPoll = lastBreak >= 0 && compiled.test(text.slice(0, lastBreak + 1));
  if (lastBreak >= 0) state.offsetBytes = slice.offsetBytes + lastBreak + 1;
  // An incomplete last line is left unconsumed: it never satisfies, and the
  // next poll reads it again once its line break has arrived.

  // The appended region is append-only, so a line matched at an earlier
  // poll is still present now unless the file was truncated or replaced
  // (both reset the accumulator above): the match "still present" is read
  // over the whole appended region, not over the newest lines only.
  const matchedNow = state.matchedAtLastPoll || matchedThisPoll;
  const result =
    matchedNow && state.matchedAtLastPoll ? FIRST_FAILURE_SATISFIED : FIRST_FAILURE_NOT_YET;
  state.matchedAtLastPoll = matchedNow;
  return { result, reset, matchedThisPoll };
}

function resetTo(state: FirstFailureState, identity: LogIdentity, offsetBytes: number): void {
  state.identity = identity;
  state.offsetBytes = offsetBytes;
  state.matchedAtLastPoll = false;
  state.started = true;
}

function compilePatternOf(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}
