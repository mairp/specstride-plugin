// Feature 117 (T083) — the criterion ids of the verdict pins (F117-FR-031).
//
// The verdict pins pin the criteria of a phase that were CONFIRMED in an
// earlier attempt of the SAME phase, keyed by the content hash of the files
// that back them, so that a criterion confirmed earlier is not judged again
// for thin proof. Two sets drive that:
//
//  - `criterionIds(section)` — every acceptance-criterion id the phase's SPEC
//    section declares: the universe of the phase, against which
//    `confirmed = all − unmet` is computed;
//  - `unmetIds(feedback)` — the criterion ids a REJECTED feedback names as
//    unmet.
//
// The ids are not DISCOVERED here, they are RECOGNISED here, through a reader
// the caller hands in (`FindCriterionIds`): F104-SC-001 states that no package
// of the product parses a phase heading or a task line outside the ONE package
// that owns the grammar of a specification, and a pattern such as
// `\bT\d{1,4}\b` written here would be a second reader of the task-line
// grammar — the static check of that owner reports it as a breach, correctly.
// The form of an id stays in one place; the composition root wires the reader,
// exactly as `FindTaskIds` of `../gate/feedback.ts` is wired. The parity test
// `PT-117-C-066-pins` compares the two functions with the baseline's
// `criterion_ids` and `unmet_ids` (`lib/verdict_pins.py` at the pinned commit)
// over the same texts, byte for byte, through the reader it injects.
//
// Pure text functions: no import, no read, deterministic.

/**
 * The reader of the criterion ids of the ONE grammar owner, as this module
 * needs it: it is handed a text and gives back every criterion id that stands
 * in it as a whole token. The TYPE is declared here; the grammar belongs to
 * its one owner, and the composition root wires the function (F104-SC-001).
 */
export type FindCriterionIds = (text: string) => readonly string[];

/**
 * True when the whole string is one criterion id (the baseline's
 * `_CRIT_ID.fullmatch`), used to validate a stored pin entry. The anchored
 * form recognises no line of the grammar — a whole task line is not an id —
 * so it is a validator and not a reader (F104-SC-001).
 */
export function isCriterionId(value: string): boolean {
  return /^(?:T\d{1,4})$/.test(value);
}

/** Every distinct criterion id a text declares, as a set. */
export function criterionIds(text: string | undefined, find: FindCriterionIds): Set<string> {
  const ids = new Set<string>();
  if (text === undefined || text === "") return ids;
  for (const id of find(text)) ids.add(id);
  return ids;
}

/**
 * The criterion ids a REJECTED feedback names as unmet. The same reader as
 * `criterionIds`, on the reply text.
 */
export function unmetIds(text: string | undefined, find: FindCriterionIds): Set<string> {
  return criterionIds(text, find);
}

/** The ids of a set, sorted lexically (the order the pin block lists them in). */
export function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}
