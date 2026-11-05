/**
 * T068 — the interface type of the canonical hasher with its operations
 * (annex X, §X.5; F100-FR-207). The hasher itself belongs to feature 104.
 *
 * There is one hashing scheme, offered by one hasher; every feature that
 * hashes a source, a launch contract, a plan or a manifest uses it. The
 * classification of the staleness verdict is one of its operations: a pure
 * function of the recorded hashes and the hashes now, which every feature
 * that decides staleness (102, 103, 104) calls and does not reimplement.
 *
 * T301 — aligned with §X.5 as amended on 2026-09-30. Three points of the
 * amendment:
 *
 *  1. "Canonical record text" is an operation of its own: the record as text
 *     with sorted keys, compact separators, non-ASCII characters kept, and
 *     NO final line end. It is the form in which the Specstride baseline
 *     hashes the records of its verification plan, so a feature that ports
 *     such a hash takes the content hash of this text as it is.
 *  2. The canonical record HASH is the content hash of that text with one
 *     line end added. The two forms are therefore different values over the
 *     same record, and F100-FR-207 makes every feature state which one a
 *     baseline hashes.
 *  3. The obligation id and the signature of unmet criteria are taken over
 *     the TEXT their owners form (feature 107, F107-FR-004; feature 101,
 *     F101-FR-019). The hasher holds no rule of theirs: it hashes the text
 *     it is handed. Only the phase shape is built by the hasher.
 */
import kernelOperations from "../../data/kernel-operations.json" with { type: "json" };

type RawOperation = { Operation: string; Input: string; Output: string };

/** One operation of the table of §X.5. */
export type HasherOperation = {
  readonly operation: string;
  readonly input: string;
  readonly output: string;
};

/** The operations of the canonical hasher, from `data/kernel-operations.json`. */
export const hasherOperations: readonly HasherOperation[] = Object.freeze(
  (kernelOperations as { hasher: RawOperation[] }).hasher.map((row) =>
    Object.freeze({ operation: row.Operation, input: row.Input, output: row.Output }),
  ),
);

/** The one hashing scheme (annex X, §X.5). */
export const ALGORITHM = "SHA-256" as const;

/** The word for such a value is "hash" (F100-FR-207). */
export const WORD_FOR_THE_VALUE = "hash" as const;

/** The state of one recorded source, as the classifier reads it. */
export type SourceReading = {
  /** The logical name of the source. */
  readonly logicalName: string;
  /** The path of the source relative to the repository. */
  readonly repositoryPath: string;
  /** The hash recorded in the run snapshot. */
  readonly recordedHash: string;
  /** For a task list, the recorded hash that ignores checkboxes. */
  readonly recordedHashIgnoringCheckboxes?: string | undefined;
  /** The hash now, or `undefined` where the source cannot be read. */
  readonly hashNow?: string | undefined;
  /** For a task list, the hash now that ignores checkboxes. */
  readonly hashNowIgnoringCheckboxes?: string | undefined;
};

/** What the classifier says about one source (annex X, §X.5). */
export const SOURCE_STATES = ["unchanged", "ticks-only", "changed", "unreadable"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/** The verdict over every source (annex X, §X.5). */
export const STALENESS_VERDICTS = ["fresh", "stale"] as const;
export type StalenessVerdict = (typeof STALENESS_VERDICTS)[number];

/** The result of the classification: a state per source and one verdict. */
export type StalenessClassification = {
  readonly sources: Readonly<Record<string, SourceState>>;
  readonly verdict: StalenessVerdict;
};

/**
 * The interface of the canonical hasher (annex X, §X.5). Feature 104
 * implements it; feature 100 owns this type, so that every caller of a hash
 * calls the one hasher (F100-FR-207).
 */
export interface CanonicalHasher {
  /** The content hash of the bytes of a file, or of a text taken as UTF-8. */
  contentHash(bytes: Uint8Array | string): string;
  /**
   * The canonical record TEXT: the record as text with sorted keys, compact
   * separators, non-ASCII characters kept, and no final line end (T301). It is
   * the input of `canonicalRecordHash`, and the form in which the Specstride
   * baseline hashes the records of its verification plan. No feature builds a
   * record text of its own (F100-FR-207).
   */
  canonicalRecordText(record: unknown): string;
  /** The hash of a task list that does not change when a checkbox is ticked. */
  taskListHashIgnoringCheckboxes(taskList: string): string;
  /**
   * The canonical record HASH: the content hash of the canonical record text
   * with one line end added (T301). It is not the content hash of the text as
   * it is; a feature that ports a baseline hash over a record states which of
   * the two forms that baseline hashes (F100-FR-207).
   */
  canonicalRecordHash(record: unknown): string;
  /** The phase shape, built by the hasher: 16 hexadecimal characters (F104-FR-021). */
  phaseShape(input: unknown): string;
  /**
   * The obligation id, over the text feature 107 forms (F107-FR-004). The
   * hasher holds no rule of that text: it hashes what it is handed (T301).
   */
  obligationId(text: string): string;
  /**
   * The signature of unmet criteria, over the text feature 101 forms
   * (F101-FR-019). The hasher holds no rule of that text either (T301).
   */
  unmetCriteriaSignature(text: string): string;
  /**
   * The classification of the staleness verdict: a pure function that reads
   * no file (rules: feature 104, F104-FR-024).
   */
  classifyStaleness(readings: readonly SourceReading[]): StalenessClassification;
}

/**
 * EP-03 gains no operation for this: the reading of the files and of the task
 * lines stays with `@specstride/spec-formats` (F100-FR-207).
 */
export const EP_03_GAINS_AN_OPERATION = false as const;

/** The classification reads no file (F100-FR-207). */
export const CLASSIFICATION_READS_A_FILE = false as const;

/** Every feature that decides staleness calls the hasher (F100-FR-207). */
export const FEATURES_THAT_DECIDE_STALENESS = ["102", "103", "104"] as const;

/* ------------------------------------------------------------------ *
 * T301 — the facts of §X.5 as amended on 2026-09-30, as data, so that a
 * caller and a conformance suite can assert them (F100-FR-207).
 * ------------------------------------------------------------------ */

/** The shape of the canonical record text (annex X, §X.5, T301). */
export const CANONICAL_RECORD_TEXT_FORM = Object.freeze({
  /** The keys of every object are sorted. */
  sortedKeys: true,
  /** Compact separators: no space after `,` or `:`. */
  compactSeparators: true,
  /** Non-ASCII characters are kept, never escaped. */
  nonAsciiKept: true,
  /** The text carries no final line end. */
  finalLineEnd: false,
} as const);

/**
 * The canonical record hash is the content hash of the canonical record text
 * with one line end added. This is the line end that is added (T301).
 */
export const LINE_END_OF_THE_CANONICAL_RECORD_HASH = "\n" as const;

/**
 * The two forms a baseline may hash over a record, which F100-FR-207 makes
 * every porting feature name.
 */
export const RECORD_HASH_FORMS = ["canonical-record-text", "canonical-record-hash"] as const;
export type RecordHashForm = (typeof RECORD_HASH_FORMS)[number];

/**
 * Which form each named baseline hash takes, from F100-FR-207: the verification
 * plan of the Specstride baseline hashes the canonical record text as it is;
 * the launch contract hashes the text with a final line end.
 */
export const BASELINE_RECORD_HASH_FORMS: Readonly<Record<string, RecordHashForm>> = Object.freeze({
  /** F105-FR-011, F105-FR-012. */
  "verification-plan": "canonical-record-text",
  /** F107-FR-019. */
  "launch-contract": "canonical-record-hash",
});

/**
 * The operations the hasher BUILDS, and the operations it only hashes a text
 * for. The obligation id and the signature of unmet criteria are formed by
 * their owners; the hasher holds no rule of theirs (T301).
 */
export const OPERATIONS_THE_HASHER_BUILDS = ["phaseShape"] as const;
export const OPERATIONS_OVER_A_TEXT_THEIR_OWNER_FORMS = Object.freeze({
  obligationId: "107",
  unmetCriteriaSignature: "101",
} as const);

/** No feature builds a record text of its own (F100-FR-207). */
export const A_FEATURE_BUILDS_ITS_OWN_RECORD_TEXT = false as const;
