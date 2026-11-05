/**
 * T077 — the tamper bracket (F106-FR-037, F100-FR-228): the size and the
 * hash of the leading bytes of the three files of the learning writer domain
 * are taken before a pass and checked after it.
 *
 * F106-FR-037: *The learning mode is not `off`, and the events file shrank
 * during a pass: the run is marked tampered and excluded from every baseline
 * and evaluation.* F100-FR-228 words the same bracket around a proposer pass
 * (the reported difference of the plan, row I5): the files are the decision
 * log, the learning stream and the summary of the writer domain; the bracket
 * is around a pass.
 *
 * THE BRACKET IS TWO FUNCTIONS AND NOTHING MORE. `takeTamperBracket` records,
 * for each of the three files, its size and the SHA-256 of its leading bytes
 * (`TAMPER_LEAD_BYTES`); `checkTamperBracket` recomputes both and reports
 * every file whose bytes that predate the pass no longer hold that form — a
 * file that shrank, or whose leading bytes changed. An append of new bytes
 * past the lead is growth, not tampering: the leading bytes still hash the
 * same and the size only grew. A file that disappeared, or that was rewritten
 * under the same size, is a change.
 *
 * WHAT THE ENGINE DOES WITH A CHANGE IS THE ENGINE'S. This module reports;
 * the engine executes the bracket beside the calls of T076, records the event
 * integrity.events_changed (an event of the run's stream, as-is name
 * events_tampered — `FX-01/106-learning-tampered`, line 17) and prints the
 * line
 * `!!! learning: <file> lost or rewrote bytes that predate this pass — run excluded from every evaluation`,
 * and the run is excluded from every baseline and evaluation (F106-FR-037).
 * Both functions return results and never raise into the run.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { learningPaths } from "./stream.ts";

/** How many leading bytes the bracket hashes (the head of each file). */
export const TAMPER_LEAD_BYTES = 4096 as const;

/** The three files of the writer domain the bracket covers (F100-FR-228). */
export const TAMPERED_FILES = ["decisions", "events", "summary"] as const;
export type TamperedFile = (typeof TAMPERED_FILES)[number];

/** The recorded state of one file before a pass. */
export type TamperTake = {
  readonly file: TamperedFile;
  readonly path: string;
  /** The size of the file when it existed; `null` when it did not. */
  readonly size: number | null;
  /** The SHA-256 of the leading bytes; `null` when the file did not exist. */
  readonly leadSha256: string | null;
};

/** The bracket taken before a pass: one record per covered file. */
export type TamperBracket = {
  readonly leadBytes: number;
  readonly takes: readonly TamperTake[];
};

/** The change the check found in one file. */
export type TamperFinding = {
  readonly file: TamperedFile;
  readonly path: string;
  readonly before: { readonly size: number | null; readonly leadSha256: string | null };
  readonly after: { readonly size: number | null; readonly leadSha256: string | null };
  /** Why the file counts as changed (F106-FR-037). */
  readonly why: "shrank" | "leading bytes changed" | "disappeared";
};

/** The result of the check after a pass. */
export type TamperCheck = {
  /** True when every covered file holds the bytes it held before the pass. */
  readonly intact: boolean;
  readonly findings: readonly TamperFinding[];
};

/** Hash the leading bytes of a file, or return `null` when it does not exist. */
function leadState(path: string, leadBytes: number): { size: number; leadSha256: string } | null {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  const fd = readFileSync(path);
  const lead = fd.subarray(0, leadBytes);
  return { size: stats.size, leadSha256: createHash("sha256").update(lead).digest("hex") };
}

/**
 * The hash the check compares: the bytes that predate the pass are the first
 * `min(sizeBefore, leadBytes)` bytes — for a file smaller than the lead, the
 * whole file it was, so an append past its end is growth, not tampering.
 */
function predateSha256(path: string, sizeBefore: number, leadBytes: number): string | null {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  return createHash("sha256")
    .update(bytes.subarray(0, Math.min(sizeBefore, leadBytes)))
    .digest("hex");
}

/**
 * Take the bracket BEFORE a pass (F100-FR-228): the size and the hash of the
 * leading bytes of the three files of the writer domain under `featureDir`.
 * A file that does not exist yet is bracketed as absent — its later creation
 * is growth, not tampering.
 */
export function takeTamperBracket(
  featureDir: string,
  leadBytes: number = TAMPER_LEAD_BYTES,
): TamperBracket {
  const paths = learningPaths(featureDir);
  const takes: TamperTake[] = TAMPERED_FILES.map((file) => {
    const path = paths[file];
    const state = leadState(path, leadBytes);
    return {
      file,
      path,
      size: state?.size ?? null,
      leadSha256: state?.leadSha256 ?? null,
    };
  });
  return { leadBytes, takes };
}

/**
 * Check the bracket AFTER a pass (F100-FR-037): recompute the size and the
 * leading-byte hash of each covered file and report every file whose bytes
 * that predate the pass changed. Growth past the lead is not a finding.
 */
export function checkTamperBracket(bracket: TamperBracket): TamperCheck {
  const findings: TamperFinding[] = [];
  for (const take of bracket.takes) {
    const after = leadState(take.path, bracket.leadBytes);
    const afterState = after ?? { size: null as number | null, leadSha256: null as string | null };
    let why: TamperFinding["why"] | null = null;
    if (take.size !== null && take.leadSha256 !== null) {
      const nowSha = predateSha256(take.path, take.size, bracket.leadBytes);
      if (afterState.leadSha256 === null && nowSha === null) why = "disappeared";
      else if (
        afterState.leadSha256 !== null &&
        afterState.size !== null &&
        afterState.size < take.size
      )
        why = "shrank";
      else if (nowSha === null || (afterState.size === 0 && take.size > 0)) why = "disappeared";
      else if (nowSha !== take.leadSha256) why = "leading bytes changed";
    } else if (take.size === null && afterState.leadSha256 !== null) {
      // The file appeared; the bracket holds only what predates the pass.
      // Creation is not tampering (an `apply` mid-run is legitimate), but a
      // file that appeared AND later lost bytes is: the next bracket sees it.
      why = null;
    }
    if (why !== null) {
      findings.push({
        file: take.file,
        path: take.path,
        before: { size: take.size, leadSha256: take.leadSha256 },
        after: afterState,
        why,
      });
    }
  }
  return { intact: findings.length === 0, findings };
}

/** The as-is name of the event the engine records on a change (F106-FR-037). */
export const EVENTS_CHANGED_EVENT_TYPE = "integrity.events_changed" as const;
export const EVENTS_CHANGED_ASIS_NAME = "events_tampered" as const;

/**
 * The record the ENGINE appends to the event stream of the run when the
 * check reports a change (`FX-01/106-learning-tampered`, line 17): as-is
 * name events_tampered, with the phase, the attempt and the file.
 */
export function eventsChangedEventRecord(input: {
  readonly ts: string;
  readonly runId: string;
  readonly feature: string;
  readonly phase: number;
  readonly attempt: number;
  readonly file: string;
}): Record<string, unknown> {
  return {
    ts: input.ts,
    time: input.ts,
    event: EVENTS_CHANGED_ASIS_NAME,
    run_id: input.runId,
    task: "work",
    backend: "prop:dsh/crit:claude",
    feature: input.feature,
    phase: String(input.phase),
    attempt: String(input.attempt),
    file: input.file,
  };
}

/** The line the engine prints on a change (`FX-01/106-learning-tampered`). */
export function tamperedLine(path: string): string {
  return `!!! learning: ${path} lost or rewrote bytes that predate this pass — run excluded from every evaluation`;
}
