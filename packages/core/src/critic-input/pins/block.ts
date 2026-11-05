// Feature 117 (T085) — the life cycle of the verdict pins and the pin block
// (F117-FR-030, F117-FR-031).
//
// The states of the record (data-model.md):
//
//   none → stored (on REJECTED) → honoured or dropped (hash equal or not)
//        → removed (on APPROVED)
//
//  - `loadConfirmedPins` runs BEFORE the critic call of an attempt: it
//    returns the criterion ids still validly pinned CONFIRMED for the phase —
//    an empty set on any mismatch of the backing hash, on a corrupt or
//    missing record, or on an entry that is not a criterion id. Fail SAFE
//    toward re-verification, never toward stale approval.
//  - `updatePinsAfterVerdict` runs AFTER the call: the confirmed set is
//    recorded ONLY on a REJECTED verdict (a genuine REJECT is the one
//    verdict whose reply carries a trustworthy unmet set); a MALFORMED reply
//    never updates the pins, and an APPROVED phase removes them.
//  - `clearPins` is the removal on APPROVED: the record is replaced by the
//    empty confirmed set under the same logical name, with the atomic write
//    of the kernel, so a future re-run of the phase starts clean. (The ports
//    of `../ports.ts` hold no remove primitive, by design — the critic-input
//    group reads and the kernel writes atomically — and an empty confirmed
//    set is the observable removal: no criterion stays pinned.)
//  - `renderPinBlock` is the block the critic prompt gains when pins stand,
//    taken from the as-is literal `pinBlock` of the data files, byte for
//    byte, and joined to the grounding block by the assembler
//    (`../prompt/assemble.ts`, block id `pins`, appended to the grounding
//    text). Empty when there are no pins, so a first attempt is unchanged.
//
// Every failure of a pin step is an optimization lost, never a fault: the
// caller warns with `pinLoadSkippedWarning` (the as-is literal `pinWarning`)
// and goes on without pins, as the baseline does on standard error.
import literals from "../data/as-is-literals.json" with { type: "json" };
import type { FileReadingPort } from "../ports.ts";
import { isCriterionId, sortedIds, unmetIds, type FindCriterionIds } from "./ids.ts";
import { backingHashOfPaths } from "./hash.ts";
import {
  readVerdictPins,
  verdictPinsRecord,
  writeVerdictPins,
  type VerdictPinsRecord,
} from "./store.ts";

/**
 * The criteria still validly pinned CONFIRMED for the phase: the stored
// confirmed set when the record exists, its hash equals the current backing
 * hash and every entry is a criterion id; the empty set otherwise.
 */
export function loadConfirmedPins(
  reader: FileReadingPort,
  recordPath: string,
  currentHash: string,
): Set<string> {
  const record = readVerdictPins(reader, recordPath);
  if (record === undefined || record.hash !== currentHash) return new Set<string>();
  const confirmed = new Set<string>();
  for (const id of record.confirmed) if (isCriterionId(id)) confirmed.add(id);
  return confirmed;
}

/** The input of the pin update after a verdict. */
export type PinUpdateInput = {
  /** The verdict of the call, as the grammar of feature 101 spells it. */
  readonly verdict: "APPROVED" | "REJECTED" | "MALFORMED";
  readonly phase: number;
  /** The physical path of the pin record (`verdictPinsRecordPath`). */
  readonly recordPath: string;
  /** The criterion ids the phase's SPEC section declares. */
  readonly allIds: ReadonlySet<string>;
  /** The reply of the critic (the unmet ids are read from it on a REJECTED). */
  readonly reply: string;
  /** The backing hash of the priority files. */
  readonly hash: string;
  /** The file-reading port, for the prior set. */
  readonly reader: FileReadingPort;
  /**
   * The reader of the criterion ids of the ONE grammar owner (F104-SC-001):
   * it reads the unmet ids out of the reply. The composition root wires it.
   */
  readonly findCriterionIds: FindCriterionIds;
};

/**
 * The pin update after a verdict (the translation of the baseline's call
 * sites in `lib/critic.py`). The update runs ONLY on a REJECTED verdict and
 * only when the phase declared criteria and the backing hash is known; the
 * confirmed set is the union of this attempt's confirmed criteria (all minus
 * the ones the reply names unmet) with the pins already valid for the SAME
 * hash, minus the unmet ones again last — so a criterion the CURRENT reply
 * names unmet loses its pin immediately, even if an earlier attempt had
 * confirmed it. On a MALFORMED reply nothing is written (no trustworthy
 * unmet set). Best-effort: a write that fails is swallowed.
 *
 * Returns the confirmed set the record holds afterwards (the empty set when
 * nothing was written).
 */
export function updatePinsAfterVerdict(input: PinUpdateInput): Set<string> {
  if (input.verdict !== "REJECTED") return new Set<string>();
  if (input.allIds.size === 0 || input.hash === "") return new Set<string>();
  const prior = loadConfirmedPins(input.reader, input.recordPath, input.hash);
  const unmet = unmetIds(input.reply, input.findCriterionIds);
  const confirmed = new Set<string>([...input.allIds, ...prior]);
  for (const id of unmet) confirmed.delete(id);
  writeVerdictPins(
    input.recordPath,
    verdictPinsRecord(input.phase, input.hash, sortedIds(confirmed)),
  );
  return confirmed;
}

/**
 * The removal of the pins on APPROVED: the record under the same logical
 * name is replaced by the empty confirmed set, atomically. Idempotent,
 * best-effort (a failed removal is swallowed); true when the removal stood.
 */
export function clearPins(recordPath: string, phase: number): boolean {
  return writeVerdictPins(recordPath, verdictPinsRecord(phase, "", []));
}

/**
 * The pin block for the confirmed set: the as-is literal `pinBlock` with the
 * sorted ids in place of `{ids}`, byte for byte with the baseline's
 * `render_pin_block`. The empty string when there are no pins, so a first
 * attempt of a phase is unchanged.
 */
export function renderPinBlock(confirmed: ReadonlySet<string>): string {
  if (confirmed.size === 0) return "";
  return literals.pinBlock.replace("{ids}", sortedIds(confirmed).join(", "));
}

/**
 * The warning line on standard error when a pin step was skipped (the as-is
 * literal `pinWarning`): the baseline's `warn("W9 pin load skipped: %s")`.
 */
export function pinLoadSkippedWarning(reason: string): string {
  return `${literals.pinWarning}: ${reason}`;
}

/**
 * One pin step of an attempt, from the priority paths to the block: the
 * backing hash, the load before the call and the block, best-effort. On any
 * throw the hash is `""` (so the update after the call is skipped too), the
 * block is empty and `warning` carries the line for standard error.
 */
export function pinStepBeforeCall(input: {
  readonly reader: FileReadingPort;
  readonly phase: number;
  readonly recordPath: string;
  /** The priority paths of the grounding pass, as cited. */
  readonly priorityPaths: readonly string[];
  readonly workdir: string;
}): {
  readonly hash: string;
  readonly confirmed: Set<string>;
  readonly block: string;
  readonly warning: string | undefined;
} {
  try {
    const hash = backingHashOfPaths(input.reader, input.priorityPaths, input.workdir);
    const confirmed = loadConfirmedPins(input.reader, input.recordPath, hash);
    return { hash, confirmed, block: renderPinBlock(confirmed), warning: undefined };
  } catch (error) {
    return {
      hash: "",
      confirmed: new Set<string>(),
      block: "",
      warning: pinLoadSkippedWarning(error instanceof Error ? error.message : String(error)),
    };
  }
}

/** The record shape, re-exported for the callers that inspect the state. */
export type { VerdictPinsRecord };
