/**
 * T214 — the stable read of the kernel (annex B, §B.2; F100-FR-228).
 *
 * The engine brackets a proposer pass around three files that the proposer
 * could reach: the event stream of the run, the decision log of learning and
 * the observation of the current phase. Before the pass it records the size and
 * the hash of the leading bytes of each; after the pass it checks that those
 * leading bytes are unchanged. Appends are allowed — the file may only grow at
 * its end. A file that shrank, or whose leading bytes changed, gives one event
 * `integrity.events_changed` with the phase, the phase attempt and the file,
 * and the run is left out of every baseline and every evaluation of learning.
 *
 * This module is the mechanism only: the leading bytes compared before and
 * after a reading. The rule and its thresholds belong to feature 106
 * (F106-FR-037), and the engine executes the bracket through the calls
 * `bracketTake` and `bracketCheck` of F100-FR-235
 * (`@specstride/contracts/ep/kernel-services`).
 *
 * The three files are named by logical name, never by path: a caller resolves
 * them through the resolver of T034 and hands this module the resolved paths.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

/** The section of annex B that owns the rule. */
export const ANNEX_SECTION = "annex B, §B.2" as const;

/** The requirement this module carries out. */
export const REQUIREMENT = "F100-FR-228" as const;

/** The rule and its thresholds belong to feature 106 (F106-FR-037). */
export const RULE_OWNER = "106" as const;
export const RULE_REQUIREMENT = "F106-FR-037" as const;

/**
 * F100-FR-228 — the three files of the bracket, by logical name. The caller
 * resolves each through the resolver of T034; the observation carries the
 * number of the current phase.
 */
export const BRACKETED_LOGICAL_NAMES = [
  "run:<runId>:events",
  "feature:<slug>:learning:decisions",
  "feature:<slug>:learning:observation:<N>",
] as const;
export type BracketedLogicalName = (typeof BRACKETED_LOGICAL_NAMES)[number];

/** F100-FR-228 — the bracket is taken when the learning mode is not `off`. */
export const LEARNING_MODE_THAT_TAKES_NO_BRACKET = "off" as const;
export function bracketIsTaken(learningMode: string): boolean {
  return learningMode !== LEARNING_MODE_THAT_TAKES_NO_BRACKET;
}

/** F100-FR-228 — the one event a changed file gives. */
export const EVENT_OF_A_CHANGED_FILE = "integrity.events_changed" as const;

/** F100-FR-228 — what that event carries: the phase, the phase attempt and the file. */
export const CHANGED_FILE_EVENT_FIELDS = ["phase", "attempt", "file"] as const;

/** F100-FR-228 — appends are allowed: the file may only grow at its end. */
export const APPENDS_ARE_ALLOWED = true as const;

/**
 * How many leading bytes are read, by default. The leading bytes are the part
 * of the file an append never touches, so comparing them tells a rewrite from
 * an append. The threshold belongs to feature 106 (F106-FR-037); this is the
 * default the kernel uses when the caller names none.
 */
export const DEFAULT_LEADING_BYTES = 65536 as const;

/** The hash the kernel uses for the leading bytes. */
export const HASH_ALGORITHM = "sha256" as const;

/** What the kernel records of one file before a reading (F100-FR-228). */
export type LeadingBytesMark = {
  /** The path the caller resolved from the logical name. */
  readonly path: string;
  /** The logical name of the file, where the caller gives it. */
  readonly logicalName?: string | undefined;
  /** The size of the whole file, in bytes. `null` when the file is absent. */
  readonly size: number | null;
  /** How many leading bytes were read and hashed. */
  readonly leadingBytes: number;
  /** The hash of those leading bytes. `null` when the file is absent. */
  readonly hash: string | null;
};

/** What a caller may set on a mark. */
export type StableReadOptions = {
  /** How many leading bytes to read; `DEFAULT_LEADING_BYTES` by default. */
  readonly leadingBytes?: number | undefined;
  /** The logical name of the file, carried into the mark and the finding. */
  readonly logicalName?: string | undefined;
};

/** Why a file is not stable (F100-FR-228). */
export const INSTABILITY_REASONS = [
  "shrank",
  "leading-bytes-changed",
  "appeared",
  "vanished",
] as const;
export type InstabilityReason = (typeof INSTABILITY_REASONS)[number];

/** The finding of one file that is not stable. */
export type InstabilityFinding = {
  readonly path: string;
  readonly logicalName?: string | undefined;
  readonly reason: InstabilityReason;
  /** The size before and after, so that a reader can see the shrink. */
  readonly sizeBefore: number | null;
  readonly sizeAfter: number | null;
  /** The event the engine emits for this finding. */
  readonly event: typeof EVENT_OF_A_CHANGED_FILE;
};

/** A file that cannot be read at all. */
export class StableReadError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `the leading bytes of ${path} could not be read: ` +
        `${cause instanceof Error ? cause.message : String(cause)} (${ANNEX_SECTION}, ${REQUIREMENT})`,
    );
    this.name = "StableReadError";
    this.path = path;
  }
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Record the size and the hash of the leading bytes of one file. A file that
 * is absent gives a mark with a null size and a null hash, so that the check
 * after the pass can tell "it appeared" from "it changed".
 */
export function markLeadingBytes(path: string, options: StableReadOptions = {}): LeadingBytesMark {
  const leadingBytes = options.leadingBytes ?? DEFAULT_LEADING_BYTES;
  if (!Number.isInteger(leadingBytes) || leadingBytes <= 0) {
    throw new StableReadError(path, `the count of leading bytes must be a whole number above 0`);
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (isMissing(error)) {
      return Object.freeze({
        path,
        logicalName: options.logicalName,
        size: null,
        leadingBytes,
        hash: null,
      });
    }
    throw new StableReadError(path, error);
  }
  const want = Math.min(size, leadingBytes);
  const buffer = Buffer.alloc(want);
  let read = 0;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    while (read < want) {
      const n = readSync(fd, buffer, read, want - read, read);
      if (n === 0) break;
      read += n;
    }
  } catch (error) {
    if (isMissing(error)) {
      return Object.freeze({
        path,
        logicalName: options.logicalName,
        size: null,
        leadingBytes,
        hash: null,
      });
    }
    throw new StableReadError(path, error);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const hash = createHash(HASH_ALGORITHM).update(buffer.subarray(0, read)).digest("hex");
  return Object.freeze({
    path,
    logicalName: options.logicalName,
    size,
    leadingBytes: want,
    hash,
  });
}

/**
 * Compare a mark taken before a reading with the file as it is now. The
 * comparison is of the leading bytes only: a file that grew at its end is
 * stable, because appends are allowed (F100-FR-228).
 */
export function checkLeadingBytes(before: LeadingBytesMark): InstabilityFinding | undefined {
  const after = markLeadingBytes(before.path, {
    leadingBytes: Math.max(before.leadingBytes, 1),
    logicalName: before.logicalName,
  });
  const finding = (reason: InstabilityReason): InstabilityFinding =>
    Object.freeze({
      path: before.path,
      logicalName: before.logicalName,
      reason,
      sizeBefore: before.size,
      sizeAfter: after.size,
      event: EVENT_OF_A_CHANGED_FILE,
    });
  if (before.size === null && after.size === null) return undefined;
  if (before.size === null) return finding("appeared");
  if (after.size === null) return finding("vanished");
  if (after.size < before.size) return finding("shrank");
  if (after.hash !== before.hash) return finding("leading-bytes-changed");
  return undefined;
}

/**
 * True when the leading bytes of the file are unchanged since the mark. This
 * is the stable read of F100-FR-228: the leading bytes compared before and
 * after a reading.
 */
export function leadingBytesAreUnchanged(before: LeadingBytesMark): boolean {
  return checkLeadingBytes(before) === undefined;
}

/**
 * Read a file and prove that its leading bytes did not change while it was
 * read. The reader is the caller's: `read` is given the mark and returns
 * whatever it read. The result carries the value and, where the file was not
 * stable, the finding — never a value a caller could mistake for a stable one.
 */
export type StableReadResult<T> = {
  readonly value: T;
  readonly stable: boolean;
  readonly finding?: InstabilityFinding;
  readonly before: LeadingBytesMark;
};

/** Read a file between a mark and a check (F100-FR-228). */
export function stableRead<T>(
  path: string,
  read: (mark: LeadingBytesMark) => T,
  options: StableReadOptions = {},
): StableReadResult<T> {
  const before = markLeadingBytes(path, options);
  const value = read(before);
  const finding = checkLeadingBytes(before);
  return Object.freeze(
    finding === undefined
      ? { value, stable: true, before }
      : { value, stable: false, finding, before },
  );
}

/* ------------------------------------------------------------------ *
 * The bracket of a proposer pass (F100-FR-228, F100-FR-235).
 * ------------------------------------------------------------------ */

/** One file of the bracket, as the engine names it. */
export type BracketFile = {
  /** The logical name of the file (`BRACKETED_LOGICAL_NAMES`). */
  readonly logicalName: string;
  /** The path the caller resolved from it. */
  readonly path: string;
};

/** What the bracket records before a pass (F100-FR-228). */
export type BracketMark = {
  readonly marks: readonly LeadingBytesMark[];
  readonly leadingBytes: number;
};

/** What the bracket reports after a pass. */
export type BracketReport = {
  /** True when every file of the bracket is unchanged in its leading bytes. */
  readonly unchanged: boolean;
  /** One finding per file that shrank or whose leading bytes changed. */
  readonly findings: readonly InstabilityFinding[];
  /**
   * F100-FR-228 — a file that shrank or changed leaves the run out of every
   * baseline and every evaluation of learning.
   */
  readonly runIsLeftOutOfEveryBaseline: boolean;
  readonly runIsLeftOutOfEveryEvaluation: boolean;
};

/** Take the bracket before a proposer pass (`bracketTake` of F100-FR-235). */
export function bracketTake(
  files: readonly BracketFile[],
  options: StableReadOptions = {},
): BracketMark {
  const leadingBytes = options.leadingBytes ?? DEFAULT_LEADING_BYTES;
  return Object.freeze({
    leadingBytes,
    marks: Object.freeze(
      files.map((f) => markLeadingBytes(f.path, { leadingBytes, logicalName: f.logicalName })),
    ),
  });
}

/** Check the bracket after a proposer pass (`bracketCheck` of F100-FR-235). */
export function bracketCheck(mark: BracketMark): BracketReport {
  const findings = mark.marks
    .map((m) => checkLeadingBytes(m))
    .filter((f): f is InstabilityFinding => f !== undefined);
  const unchanged = findings.length === 0;
  return Object.freeze({
    unchanged,
    findings: Object.freeze(findings),
    runIsLeftOutOfEveryBaseline: !unchanged,
    runIsLeftOutOfEveryEvaluation: !unchanged,
  });
}

/**
 * F100-FR-228 — the one event a finding gives, with the phase, the phase
 * attempt and the file. One event per file that changed, and no more.
 */
export function eventOf(
  finding: InstabilityFinding,
  phase: number,
  attempt: string,
): {
  readonly type: typeof EVENT_OF_A_CHANGED_FILE;
  readonly phase: number;
  readonly attempt: string;
  readonly file: string;
  readonly reason: InstabilityReason;
} {
  return Object.freeze({
    type: EVENT_OF_A_CHANGED_FILE,
    phase,
    attempt,
    file: finding.logicalName ?? finding.path,
    reason: finding.reason,
  });
}
