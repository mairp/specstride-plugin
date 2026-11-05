/**
 * T006 — the canonical spec model, the source record and the closed sets of
 * feature 104, from `specs/104-spec-input/contracts/` and `data-model.md`
 * (F104-FR-010, F104-FR-023 to F104-FR-026).
 *
 * This module is the vocabulary of the one grammar owner. Everything the
 * engine, the critic, the derivation of the launch contract, the command
 * line, the doctor and the run view read about a specification has its shape
 * here, and none of them parses a phase heading or a task line itself
 * (F104-FR-008, principle IV).
 *
 * Two rules this module follows and that the later modules inherit:
 *
 *  1. **The closed sets are not written out here.** Every one of them is a row
 *     of the table of annex X §X.6, which `@specstride/contracts` holds as
 *     data; this module reads the row by its number. A member added to the
 *     table reaches this module without an edit, and the two cannot drift
 *     (F100-FR-208, F100-FR-209).
 *  2. **The model is the record of `specstride.spec-format/1:model`.** The
 *     schema of feature 100 (annex C §C.7) takes further fields — its
 *     `additionalProperties` is true — so the richer shape of this feature's
 *     `data-model.md` (a logical `name` on a source, the `file` of a task) is
 *     a canonical spec model and needs no second, lossy form. `test/model.test.ts`
 *     validates a model built here against that schema.
 *
 * The hashes in a source record are made by the canonical hasher of
 * `@specstride/kernel`, which this feature builds (annex X §X.5); this module
 * declares no hashing rule of its own.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import type { ClosedSet } from "@specstride/contracts/enums";
import {
  OPERATIONS as EP_03_OPERATIONS,
  POINT_ID as EP_03_POINT_ID,
} from "@specstride/contracts/ep/spec-format";
import { SCHEMA_ID as MODEL_SCHEMA_ID } from "@specstride/contracts/records/canonical-spec-model";

/** The sections of feature 100's annexes that own the shapes below. */
export const MODEL_ANNEX_SECTION = "annex C, §C.7" as const;
export const CLOSED_SET_ANNEX_SECTION = "annex X, §X.6" as const;

/** The extension point this package implements, and its operations. */
export { EP_03_POINT_ID, EP_03_OPERATIONS };

/** The schema id the canonical model is validated against (F100-FR-048). */
export { MODEL_SCHEMA_ID };

/* ------------------------------------------------------------------ *
 * The closed sets, read from the one table of annex X §X.6.
 * ------------------------------------------------------------------ */

/**
 * The rows of §X.6 this feature owns. The numbers are the identity of a set,
 * which is why they and not the members are written out (F100-FR-208).
 */
export const CLOSED_SETS_OF_THIS_FEATURE = Object.freeze({
  /** Row 49 — Spec formats. An open registry; the alias is a member. */
  specFormats: 49,
  /** Row 50 — Files of the staleness verdict. */
  filesOfTheStalenessVerdict: 50,
  /** Row 97 — Kinds of source of a specification. */
  kindsOfSourceOfASpecification: 97,
  /** Row 98 — States of a source in a staleness verdict. */
  statesOfASourceInAStalenessVerdict: 98,
  /** Row 99 — Errors of a spec-format adapter. */
  errorsOfASpecFormatAdapter: 99,
  /** Row 100 — Subcommands of the command `spec`. */
  subcommandsOfTheCommandSpec: 100,
} as const);

/** A row of §X.6 by its number; a missing row is refused at load. */
export function closedSetOfRow(number: number): ClosedSet {
  const set = closedSet(number);
  if (set === undefined) {
    throw new Error(
      `\`@specstride/spec-formats\` reads the closed set ${number} of ` +
        `${CLOSED_SET_ANNEX_SECTION}, which \`@specstride/contracts\` does not hold`,
    );
  }
  return set;
}

/** Row 49 — the spec formats. Its members include the ALIAS `openspec`. */
export const specFormats = closedSetOfRow(CLOSED_SETS_OF_THIS_FEATURE.specFormats);

/** Row 50 — the files of the staleness verdict, in the order it names them. */
export const filesOfTheStalenessVerdict = closedSetOfRow(
  CLOSED_SETS_OF_THIS_FEATURE.filesOfTheStalenessVerdict,
);

/** Row 97 — the kinds of source of a specification. */
export const kindsOfSourceOfASpecification = closedSetOfRow(
  CLOSED_SETS_OF_THIS_FEATURE.kindsOfSourceOfASpecification,
);

/** Row 98 — the states of a source in a staleness verdict. */
export const statesOfASourceInAStalenessVerdict = closedSetOfRow(
  CLOSED_SETS_OF_THIS_FEATURE.statesOfASourceInAStalenessVerdict,
);

/** Row 99 — the errors of a spec-format adapter. */
export const errorsOfASpecFormatAdapter = closedSetOfRow(
  CLOSED_SETS_OF_THIS_FEATURE.errorsOfASpecFormatAdapter,
);

/** Row 100 — the subcommands of the command `spec` (`contracts/spec-verb.md`). */
export const subcommandsOfTheCommandSpec = closedSetOfRow(
  CLOSED_SETS_OF_THIS_FEATURE.subcommandsOfTheCommandSpec,
);

/* ------------------------------------------------------------------ *
 * The formats, and the alias.
 * ------------------------------------------------------------------ */

/**
 * `openspec` is an alias of `openspec-change` (F104-FR-006). Row 49 holds it
 * as a member, because an explicit `--format openspec` is accepted; a MODEL's
 * `format` is never `openspec` (`data-model.md`, the row Model).
 */
export const FORMAT_ALIASES: Readonly<Record<string, FormatName>> = Object.freeze({
  openspec: "openspec-change",
});

/** The names of the formats of Wave 1: row 49 without its aliases. */
export const FORMAT_NAMES: readonly string[] = Object.freeze(
  specFormats.members.filter((name) => FORMAT_ALIASES[name] === undefined),
);

/** A format name a model may carry. The alias is not one of them. */
export type FormatName = "native" | "speckit-tasks" | "openspec-change";

/**
 * The name a MODEL may carry: a format of Wave 1, or the own name of a format
 * added through the open registry (F104-FR-009, F104-SC-006; row 49 is an open
 * set). The union keeps the three literals for completion while admitting an
 * added name, which is also what the schema `specstride.spec-format/1:model`
 * of `@specstride/contracts` says (`format` is a string there).
 */
export type ModelFormatName = FormatName | (string & {});

/** The fallback format: detection that finds nothing gives `native`. */
export const FALLBACK_FORMAT = "native" as const;

/** True where the name is a format a model may carry (the alias excluded). */
export function isFormatName(name: string): name is FormatName {
  return FORMAT_NAMES.includes(name);
}

/**
 * A format name resolved through the aliases, or `undefined` where the name is
 * no format at all — the error `unknown-format` of row 49 and F104-FR-006,
 * which is never guessed.
 */
export function resolveFormatName(name: string): FormatName | undefined {
  if (isFormatName(name)) return name;
  return FORMAT_ALIASES[name];
}

/* ------------------------------------------------------------------ *
 * The source record (`contracts/verdict.md`; F104-FR-023).
 * ------------------------------------------------------------------ */

/** The kinds of source a specification has: row 97. An unknown kind is `other`. */
export type SourceKind = "spec" | "plan" | "tasks" | "other";

/** Row 97's unknown-value rule: a kind that is unknown is read as `other`. */
export const UNKNOWN_SOURCE_KIND = "other" as const;

/** True where the kind is a member of row 97. */
export function isSourceKind(kind: string): kind is SourceKind {
  return kindsOfSourceOfASpecification.has(kind);
}

/** A kind read through row 97's rule: anything unknown becomes `other`. */
export function readSourceKind(kind: string): SourceKind {
  return isSourceKind(kind) ? kind : UNKNOWN_SOURCE_KIND;
}

/** The one kind that also carries a hash that ignores checkboxes. */
export const KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH = "tasks" as const;

/**
 * The source record of `contracts/verdict.md`: `kind`, `name`, `path`,
 * `contentHash`, and for `tasks` also `checkboxInsensitiveHash`.
 *
 * `path` is relative to the repository, so that a record moves between a
 * workspace and a launch contract unchanged (F104-FR-023). Only a RECORDED
 * source can be stale (`data-model.md`, the row Source).
 */
export type SpecSource = {
  /** Row 97. */
  readonly kind: SourceKind;
  /** The logical name: for a run, a member of row 50. */
  readonly name: string;
  /** The path of the source relative to the repository. */
  readonly path: string;
  /** The content hash from the canonical hasher of `@specstride/kernel`. */
  readonly contentHash: string;
  /**
   * For a task list, the hash that ignores checkboxes (F104-FR-022).
   * `undefined` where the file could not be decoded, which is itself a
   * difference.
   */
  readonly checkboxInsensitiveHash?: string | undefined;
};

/** True where the source is one whose checkbox-insensitive hash is compared. */
export function carriesACheckboxInsensitiveHash(source: SpecSource): boolean {
  return source.kind === KIND_WITH_A_CHECKBOX_INSENSITIVE_HASH;
}

/* ------------------------------------------------------------------ *
 * The phases and their tasks (F104-FR-010).
 * ------------------------------------------------------------------ */

/**
 * One task of a phase (F104-FR-010; `data-model.md`, the row Task).
 *
 * `markers` holds the parallel marker `[P]` first, then at most one further
 * bracketed tag such as a story tag; any further bracketed text stays in
 * `text`, and an unknown marker is kept as text
 * (`UNKNOWN_TASK_MARKER_IS_KEPT_AS_TEXT` of EP-03).
 *
 * `ticked`, `line` and `file` are the state of the file and NEVER enter the
 * hash of a task-list reading (`data-model.md`, the row Task).
 */
export type SpecTask = {
  /** `T`, digits and at most one letter. */
  readonly id: string;
  /** `[P]` first, then at most one further bracketed tag. */
  readonly markers: readonly string[];
  readonly text: string;
  readonly ticked: boolean;
  /** The 1-based line of the task in its file. */
  readonly line: number;
  /** The file the task came from, relative to the repository. */
  readonly file: string;
};

/**
 * One phase (F104-FR-010, F104-FR-014; `data-model.md`, the row Phase).
 * Numbers ascend by 1 and the first is free (F104-FR-015).
 */
export type SpecPhase = {
  readonly number: number;
  readonly title: string;
  /** The raw section, from the heading to the next level-2 heading. */
  readonly section: string;
  /** The acceptance criteria: the TEXT of the checkbox lines, with no mark. */
  readonly criteria: readonly string[];
  /** Required; it may be empty. */
  readonly tasks: readonly SpecTask[];
};

/**
 * The canonical spec model (F104-FR-010; annex C §C.7). It is a pure function
 * of the files, and `format` is never the alias `openspec`.
 *
 * It is a record of `specstride.spec-format/1:model`: the schema takes the
 * further fields this feature's `data-model.md` adds.
 */
export type CanonicalSpecModel = {
  readonly format: ModelFormatName;
  /** The feature slug (F104-FR-003). */
  readonly feature: string;
  readonly sources: readonly SpecSource[];
  readonly phases: readonly SpecPhase[];
};

/** The four fields of a phase the oracle pins; a projection of the model. */
export type PhaseView = {
  readonly number: number;
  readonly title: string;
  readonly section: string;
  readonly criteria: readonly string[];
};

/** The four-field view of every phase, in order (F104-FR-010). */
export function phaseViews(model: CanonicalSpecModel): readonly PhaseView[] {
  return Object.freeze(
    model.phases.map((p) =>
      Object.freeze({ number: p.number, title: p.title, section: p.section, criteria: p.criteria }),
    ),
  );
}

/** The phase numbers of a model, in document order (F104-FR-014). */
export function phaseNumbers(model: CanonicalSpecModel): readonly number[] {
  return Object.freeze(model.phases.map((p) => p.number));
}

/** The phase of a number, or `undefined`; a missing phase is no error. */
export function phaseOf(model: CanonicalSpecModel, number: number): SpecPhase | undefined {
  return model.phases.find((p) => p.number === number);
}

/** The source of a kind, where the model holds one (F104-FR-023). */
export function sourceOfKind(model: CanonicalSpecModel, kind: SourceKind): SpecSource | undefined {
  return model.sources.find((s) => s.kind === kind);
}

/** The source of a logical name, where the model holds one. */
export function sourceOfName(model: CanonicalSpecModel, name: string): SpecSource | undefined {
  return model.sources.find((s) => s.name === name);
}

/* ------------------------------------------------------------------ *
 * The context documents (F104-FR-016).
 * ------------------------------------------------------------------ */

/** One read-only background document of a spec, in the order of its format. */
export type ContextDocument = {
  readonly name: string;
  /** Relative to the repository. */
  readonly path: string;
};

/**
 * The heading the criteria of a phase are shown under, per format
 * (F104-FR-014). Native has its own; the two task formats name tasks.
 */
export const CRITERIA_HEADING: Readonly<Record<FormatName, string>> = Object.freeze({
  native: "Acceptance criteria (the phase spec)",
  "speckit-tasks": "Tasks to complete (each `- [ ]` is a required deliverable)",
  "openspec-change": "OpenSpec tasks to complete (each `- [ ]` is required)",
});

/** `native` has no context document (F104-FR-016). */
export const FORMAT_WITHOUT_CONTEXT_DOCUMENTS = "native" as const;

/* ------------------------------------------------------------------ *
 * The task-list reading (F104-FR-026; `contracts/verdict.md`).
 * ------------------------------------------------------------------ */

/**
 * One task of a task-list reading: the id, the markers and the text, and
 * NOTHING of the file's state. Ticks and line numbers never enter it, which is
 * what makes the reading's hash survive a tick (F104-FR-026).
 */
export type TaskReading = {
  readonly id: string;
  readonly markers: readonly string[];
  readonly text: string;
};

/**
 * The reading of the task list of one phase (F104-FR-026). It is the content
 * of the record `run:<runId>:task-list` of annex B §B.5, which the ENGINE
 * writes at launch: this feature gives the reading and never writes the
 * record.
 */
export type TaskListReading = {
  readonly phase: number;
  readonly tasks: readonly TaskReading[];
  /** The canonical record hash of the list (annex X §X.5). */
  readonly hash: string;
};

/** The schema id of the record the reading is the content of (research D-13). */
export const TASK_LIST_SCHEMA_ID = "specstride.task-list/1" as const;

/** The logical name of that record (annex B §B.5). */
export const TASK_LIST_LOGICAL_NAME = "run:<runId>:task-list" as const;

/** This feature gives the reading and does not write the record (F104-FR-026). */
export const WRITES_THE_TASK_LIST_RECORD = false as const;

/** How two readings of one task list differ (`contracts/verdict.md`). */
export type TaskListComparison = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly reordered: boolean;
  readonly textChanged: readonly string[];
};

/* ------------------------------------------------------------------ *
 * The staleness verdict (F104-FR-024, F104-FR-025; `contracts/verdict.md`).
 * ------------------------------------------------------------------ */

/** The state of a source in a verdict: row 98. */
export type SourceState = "unchanged" | "ticks-only" | "changed" | "unreadable";

/** Row 98's unknown-value rule: a state that is unknown is read as `changed`. */
export const UNKNOWN_SOURCE_STATE = "changed" as const;

/** True where the state is a member of row 98. */
export function isSourceState(state: string): state is SourceState {
  return statesOfASourceInAStalenessVerdict.has(state);
}

/** The result of a verdict. */
export const VERDICT_RESULTS = ["fresh", "stale"] as const;
export type VerdictResult = (typeof VERDICT_RESULTS)[number];

/** What the verdict says about one source (`contracts/verdict.md`). */
export type SourceVerdict = {
  readonly name: string;
  readonly path: string;
  readonly state: SourceState;
  /** For `tasks`: whether the change is more than checkboxes. */
  readonly moreThanTicks?: boolean | undefined;
};

/**
 * The staleness verdict (`contracts/verdict.md`; F104-FR-024). `changed` holds
 * the names of the sources that are `changed` or `unreadable`, in the order
 * spec, plan, tasks.
 *
 * The classification itself is NOT made here: it is the pure operation of the
 * canonical hasher of `@specstride/kernel` (annex X §X.5; CQ-214). This
 * package reads the files, computes the hashes now through the hasher, calls
 * the classification and builds the lines below.
 */
export type Verdict = {
  readonly result: VerdictResult;
  readonly sources: readonly SourceVerdict[];
  readonly changed: readonly string[];
};

/**
 * The lines a launch contract's verdict prints, one per source, in the order
 * recorded and named by INDEX (F104-FR-025; `contracts/verdict.md`).
 */
export const VERDICT_LINES = Object.freeze({
  changed: (index: number, path: string) => `sources[${index}] hash changed: ${path}`,
  unreadable: (index: number, path: string, error: string) =>
    `sources[${index}] cannot be read: ${path}: ${error}`,
});

/** The classification is the hasher's, never this package's (CQ-214). */
export const CLASSIFICATION_OWNER = "@specstride/kernel" as const;

/** EP-03 gains no operation for the verdict (F104-FR-024). */
export const EP_03_GAINS_AN_OPERATION_FOR_THE_VERDICT = false as const;

/* ------------------------------------------------------------------ *
 * T027 — STRUCTURED TASKS: the checkbox syntax of every format and the
 * task line (F104-FR-010, F104-FR-011; B-2021, B-2476).
 *
 * The checkbox syntax is stated ONCE here, because F104-FR-011 states it once
 * for every format: "optional indent, `-`, optional spaces, `[ ]`, `[x]`,
 * `[X]` or `[]`, then the text". The three adapters of `adapters/` read lines
 * through these functions and hold only what is their own grammar — the phase
 * heading, the criteria block and the task id.
 *
 * `markIndex` is the one field that is not grammar but geometry: it is the
 * offset of the single character inside the box, which is the only byte `tick`
 * of T030 is allowed to change (F104-FR-017: "line ends and every other byte
 * stay"). A tick that replaced the line would have to rebuild it; one that
 * replaces one character at a known offset cannot touch anything else.
 * ------------------------------------------------------------------ */

/**
 * The checkbox syntax of EVERY format (F104-FR-011; B-2021). The mark group is
 * optional, which is what admits the empty box `[]`.
 */
export const CHECKBOX_LINE = /^([ \t]*)-([ \t]*)\[([ xX]?)\]([ \t]*)(.*)$/;

/** The three marks a box may carry; the empty box carries none. */
export const TICK_MARKS = ["x", "X"] as const;

/** The mark `tick` writes (F104-FR-017: "the mark written is `x`"). */
export const MARK_WRITTEN_BY_TICK = "x" as const;

/** One checkbox line, read by the one syntax above. */
export type CheckboxLine = {
  /** The indent before the `-`, kept so that a rewrite can restore it. */
  readonly indent: string;
  /** ` `, `x` or `X`; the empty string for the empty box `[]`. */
  readonly mark: string;
  /** Whether the box carries `x` or `X`. */
  readonly ticked: boolean;
  /** Whether the box is the EMPTY box `[]`, which `tick` never touches. */
  readonly empty: boolean;
  /** The text after the box, with the run of white space before it removed. */
  readonly text: string;
  /**
   * The offset of the mark character in the line, or `-1` for the empty box.
   * The one byte a tick may change (F104-FR-017).
   */
  readonly markIndex: number;
};

/** A line read as a checkbox line, or `undefined` where it is not one. */
export function readCheckboxLine(line: string): CheckboxLine | undefined {
  const found = CHECKBOX_LINE.exec(line);
  if (found === null) return undefined;
  const [, indent = "", afterDash = "", mark = "", , text = ""] = found;
  const empty = mark === "";
  return Object.freeze({
    indent,
    mark,
    ticked: (TICK_MARKS as readonly string[]).includes(mark),
    empty,
    text,
    // indent + "-" + afterDash + "[" is everything before the mark.
    markIndex: empty ? -1 : indent.length + 1 + afterDash.length + 1,
  });
}

/** True where the line is a checkbox line with non-empty text (B-2053, B-2026). */
export function isACheckboxWithText(line: string): boolean {
  const box = readCheckboxLine(line);
  return box !== undefined && box.text !== "";
}

/**
 * The two forms a task id takes. `speckit-tasks` uses the `T` form of
 * F104-FR-010 ("`T` and digits and at most one letter"); `openspec-change`
 * uses the dotted id of F104-FR-013 (`N.N[.N…]`), which is why the hasher's
 * mark rule has two forms as well (F104-FR-022, DV-118).
 */
export const TASK_ID_FORMS = ["T-id", "dotted-id"] as const;
export type TaskIdForm = (typeof TASK_ID_FORMS)[number];

/** The `T` form: `T`, digits and at most one letter (F104-FR-010). */
export const TASK_ID = /^T\d+[A-Za-z]?$/;

/** The dotted form of `openspec-change`: `N.N[.N…]` (F104-FR-013; B-2032). */
export const DOTTED_TASK_ID = /^\d+(?:\.\d+)+$/;

/** The id at the head of a task's text, per form, at a word end. */
export const TASK_ID_AT_THE_HEAD: Readonly<Record<TaskIdForm, RegExp>> = Object.freeze({
  "T-id": /^(T\d+[A-Za-z]?)(?![\p{L}\p{N}_])/u,
  "dotted-id": /^(\d+(?:\.\d+)+)(?![\p{L}\p{N}_.])/u,
});

/** True where the text is a task id of the given form. */
export function isATaskId(id: string, form: TaskIdForm): boolean {
  return (form === "T-id" ? TASK_ID : DOTTED_TASK_ID).test(id);
}

/** The parallel marker, which comes first where it is present (F104-FR-010). */
export const PARALLEL_MARKER = "[P]" as const;

/** One bracketed token at the head of a text: `[P]`, `[US3]`, `[A B]`. */
const BRACKETED_AT_THE_HEAD = /^\[([^\]]+)\][ \t]*/;

/**
 * The markers of a task, and the text that is left (F104-FR-010; B-2476).
 *
 * The parallel marker `[P]` comes first where it is there; then AT MOST ONE
 * further bracketed tag, such as a story tag. Any further bracketed text stays
 * in the text — which is also the unknown-value rule of EP-03, "an unknown
 * marker is kept as text": a third bracket is text, and a first bracket that
 * is not `[P]` is taken as the one tag, exactly as the two optional groups of
 * B-2476 take it.
 */
export function readMarkers(text: string): {
  readonly markers: readonly string[];
  readonly text: string;
} {
  let rest = text;
  const markers: string[] = [];
  if (rest.startsWith(PARALLEL_MARKER)) {
    const parallel = BRACKETED_AT_THE_HEAD.exec(rest);
    /* c8 ignore next — `[P]` at the head always matches the bracket pattern */
    if (parallel !== null) {
      markers.push(PARALLEL_MARKER);
      rest = rest.slice(parallel[0].length);
    }
  }
  const tag = BRACKETED_AT_THE_HEAD.exec(rest);
  if (tag !== null) {
    markers.push(`[${tag[1] as string}]`);
    rest = rest.slice(tag[0].length);
  }
  return Object.freeze({ markers: Object.freeze(markers), text: rest });
}

/**
 * A line read as a STRUCTURED TASK (F104-FR-010): its id, its markers, its
 * text, whether it is ticked, its line and the file it came from.
 *
 * This is where the port is WIDER than the grammar of mixture-of-loops that
 * B-2476 records, and deliberately so: F104-FR-008 requires that "a `tasks.md`
 * that the old parser could not read MUST be readable", and DV-060 waives the
 * fixture comparison for exactly such a file. The three widenings are:
 *
 *  1. an INDENT before the `-` (the old regex anchored `-` at column 0);
 *  2. the EMPTY box `[]` (the old regex took only `[ xX]`);
 *  3. an id with NO text after it (the old regex required `\s+` and a text
 *     group after the id).
 *
 * `taskOfTheOldGrammar` below carries B-2476's own regex, so that a test
 * MEASURES where the two differ instead of taking the widening on trust.
 */
export function structuredTaskOfLine(
  line: string,
  lineNumber: number,
  file: string,
  form: TaskIdForm,
): SpecTask | undefined {
  const box = readCheckboxLine(line);
  if (box === undefined) return undefined;
  const head = TASK_ID_AT_THE_HEAD[form].exec(box.text);
  if (head === null) return undefined;
  const id = head[1] as string;
  const afterTheId = box.text.slice(id.length).replace(/^[ \t]+/, "");
  const read = readMarkers(afterTheId);
  return Object.freeze({
    id,
    markers: read.markers,
    text: read.text,
    ticked: box.ticked,
    line: lineNumber,
    file,
  });
}

/**
 * The task grammar of mixture-of-loops, as B-2476 records it at
 * `bootstrap_contract.py:30`, with its own field names. It is here so that the
 * widening of `structuredTaskOfLine` is a MEASURED difference and not a claim:
 * a line this returns `undefined` for and the port reads is a line "the old
 * parser could not read" (F104-FR-008, DV-060).
 */
export const TASK_LINE_OF_THE_OLD_GRAMMAR =
  /^-\s*\[([ xX])\]\s+(T\d+[A-Za-z]?)\s+(?:\[P\]\s+)?(?:\[([^\]]+)\]\s+)?(.*)$/;

/** What the old grammar read from a task line, or `undefined`. */
export function taskOfTheOldGrammar(line: string):
  | {
      readonly id: string;
      readonly checked: boolean;
      readonly parallelMarker: boolean;
      readonly story: string | undefined;
      readonly text: string;
    }
  | undefined {
  const found = TASK_LINE_OF_THE_OLD_GRAMMAR.exec(line);
  if (found === null) return undefined;
  return Object.freeze({
    id: found[2] as string,
    checked: (found[1] as string) !== " ",
    parallelMarker: /\[P\]\s/.test(line),
    story: found[3],
    text: found[4] as string,
  });
}

/**
 * The phase grammar of mixture-of-loops, as B-2476's neighbour B-2475 records
 * it: case-INSENSITIVE. The one grammar is case-sensitive, so a lower-case
 * `## phase 1:` heading is not a phase heading (DV-119, CQ-045). Kept here for
 * the same reason as the task regex above: the difference is measured.
 */
export const PHASE_HEADING_OF_THE_OLD_GRAMMAR = /^##\s+Phase\s+(\d+)\s*:\s*(.+?)\s*$/i;

/** The divergence rows the two regexes above belong to. */
export const DIVERGENCE_OF_THE_OLD_GRAMMAR = Object.freeze({
  /** A `tasks.md` the old parser could not read: waived. */
  unreadableByTheOldParser: "DV-060",
  /** A lower-case `## phase N:` heading is not a phase heading. */
  lowerCasePhaseHeading: "DV-119",
});

/* ------------------------------------------------------------------ *
 * T027 — the grammar record the three adapters fill in.
 * ------------------------------------------------------------------ */

/** One finding of `validate` (F104-FR-015; the shape of EP-03 §C.7). */
export type SpecFinding = {
  readonly severity: "warn" | "fail";
  readonly message: string;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
};

/** A spec is valid only when `validate` returns NO finding (F104-FR-015). */
export function isValid(findings: readonly SpecFinding[]): boolean {
  return findings.length === 0;
}

/**
 * The grammar half of a spec-format adapter: everything that reads a phase
 * heading or a task line (F104-FR-011 to F104-FR-013, F104-FR-015). The
 * detection half is `RegisteredAdapter` of `registry.ts`.
 *
 * `validate.ts`, `tick.ts` and `context.ts` dispatch through this record and
 * hold no grammar of their own, so that an added format of F104-FR-009 is
 * parsed, validated and ticked with no change to a core file (F104-SC-006).
 */
export type SpecGrammar = {
  /** The format's name, which is what `spec detect` prints. */
  readonly name: string;
  /** Which form a task id takes in this format (F104-FR-022). */
  readonly taskIdForm: TaskIdForm;
  /** The heading the criteria are shown under (F104-FR-014). */
  readonly criteriaHeading: string;
  /** The phases of a text; a PURE function of it (F104-FR-010). */
  phasesOf(text: string, file: string): readonly SpecPhase[];
  /** The findings of F104-FR-015 over those phases and that text. */
  findingsOf(phases: readonly SpecPhase[], text: string): readonly SpecFinding[];
  /** The title of a bare section, or `undefined` (F104-FR-014; B-2042). */
  titleOfASection(section: string): string | undefined;
  /** Whether a file of this format may be ticked at all (F104-FR-017). */
  mayBeTicked(text: string): boolean;
};

/* ------------------------------------------------------------------ *
 * T027 — the line geometry every grammar shares (B-2019).
 *
 * "A phase runs from its heading to the next level-2 heading or the end of the
 * file, trailing blank lines kept" is stated for `native` in F104-FR-011 and
 * used by all three formats, so, like the checkbox syntax, it is stated once.
 * ------------------------------------------------------------------ */

/** A LEVEL-2 heading: `##` not followed by a third `#` (B-2019). */
export const LEVEL_2_HEADING = /^##(?!#)/;

/** A LEVEL-3 heading, which ends a criteria block (F104-FR-011; B-2020). */
export const LEVEL_3_HEADING = /^###/;

/** True where the line opens a level-2 heading, which ends a phase section. */
export function isALevel2Heading(line: string): boolean {
  return LEVEL_2_HEADING.test(line);
}

/**
 * The split that keeps the LINE ENDS. Each element of `lines` is one line
 * WITHOUT its end, and `ends[i]` is the end that followed it, so that
 * `joinKeepingLineEnds` restores the text byte for byte — `\n`, `\r\n` and a
 * lone `\r` alike (B-2056, F104-FR-017).
 *
 * The grammar MUST see a line without its end. A regex that ends in `$`
 * without the `m` flag does not match before a `\r`, and `.` does not match a
 * `\r` either, so a grammar fed `text.split("\n")` would silently read NO
 * phase at all out of a file with Windows line ends. This one split is why no
 * regex in this package has to know about `\r`, and why `tick` can still put
 * every byte back: the ends are kept beside the lines rather than inside them.
 */
export function splitKeepingLineEnds(text: string): {
  readonly lines: readonly string[];
  readonly ends: readonly string[];
} {
  const lines: string[] = [];
  const ends: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;
    if (character !== "\n" && character !== "\r") continue;
    lines.push(text.slice(start, index));
    if (character === "\r" && text[index + 1] === "\n") {
      ends.push("\r\n");
      index += 1;
    } else {
      ends.push(character);
    }
    start = index + 1;
  }
  lines.push(text.slice(start));
  ends.push("");
  return Object.freeze({ lines: Object.freeze(lines), ends: Object.freeze(ends) });
}

/** The join that restores a text split by `splitKeepingLineEnds`, byte for byte. */
export function joinKeepingLineEnds(lines: readonly string[], ends: readonly string[]): string {
  return lines.map((line, index) => `${line}${ends[index] ?? ""}`).join("");
}

/**
 * The lines of a text, each WITHOUT its end. Every reader of the grammar uses
 * this and never `String.prototype.split("\n")`, for the reason given above.
 */
export function linesOf(text: string): readonly string[] {
  return splitKeepingLineEnds(text).lines;
}

/** One level-2 section of a file: its heading line, its lines and where it starts. */
export type Level2Section = {
  /** The heading line itself, unstripped and without its line end. */
  readonly heading: string;
  /** The 1-based line number of the heading. */
  readonly headingLine: number;
  /** The lines of the section, the heading first, trailing blank lines KEPT. */
  readonly lines: readonly string[];
  /** The line end that followed each line, so the raw text can be restored. */
  readonly ends: readonly string[];
};

/**
 * The level-2 sections of a text, in document order. Each runs from its
 * heading to the next level-2 heading or the end of the file, with trailing
 * blank lines kept (B-2019). Lines before the first level-2 heading belong to
 * no section.
 */
export function level2SectionsOf(text: string): readonly Level2Section[] {
  const split = splitKeepingLineEnds(text);
  const sections: Level2Section[] = [];
  let current:
    { heading: string; headingLine: number; lines: string[]; ends: string[] } | undefined;
  split.lines.forEach((line, index) => {
    const end = split.ends[index] ?? "";
    if (isALevel2Heading(line)) {
      if (current !== undefined) sections.push(Object.freeze({ ...current }) as Level2Section);
      current = { heading: line, headingLine: index + 1, lines: [line], ends: [end] };
      return;
    }
    if (current === undefined) return;
    current.lines.push(line);
    current.ends.push(end);
  });
  if (current !== undefined) sections.push(Object.freeze({ ...current }) as Level2Section);
  return Object.freeze(sections);
}

/**
 * The RAW text of a section: its lines with their own line ends, so that the
 * slice of F104-FR-014 is the file's own bytes and not a re-ended copy.
 * Trailing blank lines are kept (B-2019).
 */
export function textOfSection(section: Level2Section): string {
  return joinKeepingLineEnds(section.lines, section.ends);
}
