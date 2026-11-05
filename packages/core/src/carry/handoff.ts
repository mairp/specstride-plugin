/**
 * T075 of feature 103 — THE HANDOFF WRITER (F103-FR-041, F103-SC-002).
 *
 * With `carry.ledger_handoff` on, the engine writes the handoff
 * (`feature:<slug>:handoff`) at the START OF EVERY PASS. This module is that
 * writer: it builds the record, renders the file, and hands the bytes to the
 * kernel's atomic write. It is the one carry-over file that crosses a FILE
 * boundary, which is why its schema is in `@specstride/contracts`
 * (`schemas/handoff.schema.json`, T003) and not beside the module.
 *
 * ## The rules the writer keeps, each as a named constant and a test
 *
 * | Rule of F103-FR-041 | Here |
 * |---|---|
 * | Written at the start of every pass | `WRITTEN_AT_THE_START_OF_EVERY_PASS` |
 * | Regenerated every time, never appended to | `REGENERATED_EVERY_TIME`, `APPENDED_TO`; the write is `atomicWrite`, which renames a whole new file into place, so appending is not merely avoided — it is impossible through this path |
 * | At most 6 KB (`carry.handoffMaxBytes`) | `MAX_BYTES_DEFAULT`, and `renderHandoff` cuts at the LAST COMPLETE LINE under the ceiling with a marker |
 * | The runtime never reads it back | `THE_RUNTIME_READS_IT_BACK` is `false`; this module exports NO reader, and the only consumer is the prompt provider |
 * | No model writes any part of it | `NO_MODEL_WRITES_ANY_PART_OF_IT`; every field is built here from the ledger, the plan and the kill note |
 * | Every text from the workspace is data | `quoted`, which frames such text inside a `<data>` element and neutralises a closing tag inside it |
 * | Grounding refuses it | `GROUNDING_ACCEPTS_IT` is `false`, checked against the data of `contracts` |
 * | The tree fingerprint, and the line that the tree wins | `treeFingerprint`, `THE_TREE_WINS` |
 * | After a kill the next handoff names the unit in progress | `killNoteOf`, and `handoffAfterAKill` |
 * | The runtime does not change the tree for it | `THE_RUNTIME_CHANGES_THE_TREE_AFTER_A_KILL` is `false`; the writer touches ONE path, the handoff's own |
 *
 * ## Two forms: the record and the file
 *
 * `handoff.schema.json` describes a RECORD, and the file the proposer reads is
 * a rendered TEXT. Both exist here on purpose. The record is the content model
 * — it validates against the delivered schema, and
 * `tests/characterization/103/handoff.test.ts` (CT-103-141) checks that it
 * does. The file is what the 6 KB ceiling applies to, because a ceiling on a
 * record would have to cut it in the middle of a field; cutting at the last
 * complete LINE of a rendered text leaves something a reader can still use.
 * `writeHandoff` renders, stamps `maxBytes` and `truncated` back onto the
 * record, and writes the text.
 *
 * ## Why the write arrives as an argument
 *
 * A core package reads and writes files through the kernel, and receives the
 * kernel's primitives as arguments from the composition root (F100-FR-012,
 * F100-FR-234). So `writeHandoff` is given the atomic write; the type is the
 * kernel's own, imported as a TYPE, and nothing here opens a path itself.
 */
import type { AtomicWriteOptions } from "@specstride/kernel/atomic-write";
import { contentHash } from "@specstride/kernel/hasher";
import { groundingRefusedNames } from "@specstride/contracts/ids/layout-rules";
import type { LedgerRecord } from "@specstride/contracts/records/ledger-record";
import { ledgerTail, TAIL_LINES_DEFAULT } from "./ledger-core.ts";
import { readCounts, type Counts } from "./counters.ts";
import { cutTitle, INDEX_TITLE_CHARS_DEFAULT } from "./index.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-041", "F103-SC-002"] as const;

/* ------------------------------------------------------------------ *
 * Identity and the rules.
 * ------------------------------------------------------------------ */

/** The schema id of the handoff (`packages/contracts/schemas/handoff.schema.json`). */
export const SCHEMA_ID = "specstride.handoff/1" as const;

/** The logical name of the handoff. */
export const LOGICAL_NAME = "feature:<slug>:handoff" as const;

/** The logical name for one feature slug. */
export function handoffLogicalName(slug: string): string {
  return LOGICAL_NAME.replace("<slug>", slug);
}

/** The switch of F103-FR-041; off under `parity` (row 8 of annex X §X.7). */
export const SWITCH = "carry.ledger_handoff" as const;
export const SWITCH_DEFAULT_ON = true as const;
export const SWITCH_UNDER_PARITY_ON = false as const;

/** `carry.handoffMaxBytes` — row 60 of annex X §X.7 gives 6144. */
export const MAX_BYTES_KEY = "carry.handoffMaxBytes" as const;
export const MAX_BYTES_DEFAULT = 6144 as const;

/** F103-FR-041 — written at the start of every pass. */
export const WRITTEN_AT_THE_START_OF_EVERY_PASS = true as const;

/** F103-FR-041 — regenerated every time, and never appended to. */
export const REGENERATED_EVERY_TIME = true as const;
export const APPENDED_TO = false as const;

/** F103-FR-041 — the runtime never reads it back; the PROPOSER does. */
export const THE_RUNTIME_READS_IT_BACK = false as const;

/** This module exports no reader of the file, which is how that rule is kept. */
export const READERS_THIS_MODULE_OFFERS: readonly string[] = Object.freeze([]);

/** F103-FR-041 — no model writes any part of it. */
export const NO_MODEL_WRITES_ANY_PART_OF_IT = true as const;

/** F103-FR-041 and F100-FR-037 — grounding refuses the handoff. */
export const GROUNDING_ACCEPTS_IT = false as const;

/** The name as the grounding refusal of `contracts` holds it. */
export const GROUNDING_REFUSES_THIS_NAME: readonly string[] = Object.freeze(
  groundingRefusedNames.filter((name) => name === LOGICAL_NAME),
);

/**
 * F103-SC-002 and F103-FR-041 — "the runtime MUST NOT change the tree" for a
 * kill. The writer touches exactly one path, the handoff's own, which
 * `PATHS_THIS_WRITER_TOUCHES` states and the test measures by watching the
 * atomic write it was given.
 */
export const THE_RUNTIME_CHANGES_THE_TREE_AFTER_A_KILL = false as const;
export const PATHS_THIS_WRITER_TOUCHES = ["the handoff itself"] as const;

/** F103-FR-041 — the line that says the tree wins where the two disagree. */
export const THE_TREE_WINS =
  "Where this handoff and the working tree disagree, THE TREE WINS." as const;

/** The divergence register row of the handoff. */
export const DIVERGENCE = "DV-092" as const;

/** The required fields of the record, as `handoff.schema.json` lists them. */
export const REQUIRED_FIELDS = [
  "schema",
  "phase",
  "phaseAttempt",
  "counters",
  "ledgerTail",
  "remainingUnits",
  "feedbackPointers",
  "treeFingerprint",
  "treeWins",
] as const;

/* ------------------------------------------------------------------ *
 * The record.
 * ------------------------------------------------------------------ */

/** One remaining unit of work: the plan less the ledger. */
export type RemainingUnit = {
  readonly id: string;
  /** The title, cut as the index cuts its titles. */
  readonly title: string;
};

/** The newest kill note. */
export type KillNote = {
  readonly reason: string;
  readonly class: string;
  readonly passId?: string | undefined;
  /** F103-FR-041 — the unit in progress, where a layer declared one. */
  readonly unitInProgress?: string | undefined;
  /** The note itself. Text from the workspace; framed as data when rendered. */
  readonly text?: string | undefined;
};

/** The `on_resume` text and the result of a detached job. */
export type DetachedJob = {
  readonly onResume: string;
  readonly exitCode?: number | undefined;
  readonly log?: string | undefined;
};

/** The handoff, as `handoff.schema.json` models it. */
export type HandoffRecord = {
  readonly schema: typeof SCHEMA_ID;
  readonly phase: number;
  readonly phaseAttempt: number;
  readonly counters: Counts;
  readonly ledgerTail: readonly string[];
  readonly remainingUnits: readonly RemainingUnit[];
  readonly killNote?: KillNote | undefined;
  readonly detachedJob?: DetachedJob | undefined;
  readonly feedbackPointers: readonly string[];
  readonly treeFingerprint: string;
  readonly treeWins: string;
  readonly maxBytes?: number | undefined;
  readonly truncated?: boolean | undefined;
};

/** One unit of the plan, as much of it as the handoff reads. */
export type PlannedUnit = {
  readonly id: string;
  readonly title: string;
};

/**
 * F103-FR-041 — "the remaining units of work, which are the plan less the
 * ledger". A unit is DONE when a record of the ledger names it in `unitId`,
 * whatever namespace wrote the record: a layer's own records are what say a
 * unit was kept, so the subtraction reads every namespace and not only `core`.
 * The order of the plan is kept, and the titles are cut the way the index cuts
 * its titles, so the two agree on what a short title is.
 */
export function remainingUnits(
  plan: readonly PlannedUnit[],
  records: readonly LedgerRecord[],
  titleChars: number = INDEX_TITLE_CHARS_DEFAULT,
): readonly RemainingUnit[] {
  const done = new Set<string>();
  for (const record of records) {
    const unit = record.unitId;
    if (typeof unit === "string" && unit !== "") done.add(unit);
  }
  return Object.freeze(
    plan
      .filter((unit) => !done.has(unit.id))
      .map((unit) => Object.freeze({ id: unit.id, title: cutTitle(unit.title, titleChars).title })),
  );
}

/** What a kill gives the writer. */
export type KillInput = {
  readonly reason: string;
  readonly class: string;
  readonly passId?: string | undefined;
  /** The unit a layer declared in progress, where one did. */
  readonly unitInProgress?: string | undefined;
  readonly text?: string | undefined;
};

/**
 * F103-FR-041 and F103-SC-002 — the kill note of the NEXT handoff. "After a
 * kill the next handoff MUST name the unit of work that was in progress, where
 * a layer declared one."
 *
 * Where no layer declared one the field is simply absent: the requirement is
 * conditional ("where a layer declared one"), and inventing a unit would be
 * worse than saying nothing. A caller that wants to know which it was reads
 * `namesAUnit`.
 */
export function killNoteOf(kill: KillInput): KillNote & { readonly namesAUnit: boolean } {
  const declared = typeof kill.unitInProgress === "string" && kill.unitInProgress !== "";
  return Object.freeze({
    reason: kill.reason,
    class: kill.class,
    ...(kill.passId !== undefined ? { passId: kill.passId } : {}),
    ...(declared ? { unitInProgress: kill.unitInProgress } : {}),
    ...(kill.text !== undefined ? { text: kill.text } : {}),
    namesAUnit: declared,
  });
}

/** What the handoff is built from. */
export type HandoffInput = {
  readonly phase: number;
  readonly phaseAttempt: number;
  readonly counters: Counts;
  /** The ledger of the run, oldest first. */
  readonly records: readonly LedgerRecord[];
  /** The plan of units of work, where a layer declared one. */
  readonly plan?: readonly PlannedUnit[] | undefined;
  /** The newest kill, where the pass before was killed. */
  readonly kill?: KillInput | undefined;
  readonly detachedJob?: DetachedJob | undefined;
  /** The pointers to the feedback files, by LOGICAL NAME, never their text. */
  readonly feedbackPointers?: readonly string[] | undefined;
  /** The fingerprint of the tree the handoff is built against. */
  readonly treeFingerprint: string;
  /** How many lines of the ledger to carry. */
  readonly tailLines?: number | undefined;
  readonly titleChars?: number | undefined;
};

/**
 * F103-FR-041 — the handoff record. Every field is built here, from the
 * ledger, the plan, the newest kill note and the pointers: no model writes any
 * part of it, which is a property of this function and not a promise.
 */
export function buildHandoff(input: HandoffInput): HandoffRecord {
  const kill = input.kill === undefined ? undefined : killNoteOf(input.kill);
  return Object.freeze({
    schema: SCHEMA_ID,
    phase: input.phase,
    phaseAttempt: input.phaseAttempt,
    counters: readCounts(input.counters),
    ledgerTail: ledgerTail(input.records, input.tailLines ?? TAIL_LINES_DEFAULT),
    remainingUnits: remainingUnits(
      input.plan ?? [],
      input.records,
      input.titleChars ?? INDEX_TITLE_CHARS_DEFAULT,
    ),
    ...(kill === undefined
      ? {}
      : {
          killNote: Object.freeze({
            reason: kill.reason,
            class: kill.class,
            ...(kill.passId !== undefined ? { passId: kill.passId } : {}),
            ...(kill.unitInProgress !== undefined ? { unitInProgress: kill.unitInProgress } : {}),
            ...(kill.text !== undefined ? { text: kill.text } : {}),
          }),
        }),
    ...(input.detachedJob !== undefined ? { detachedJob: input.detachedJob } : {}),
    feedbackPointers: Object.freeze([...(input.feedbackPointers ?? [])]),
    treeFingerprint: input.treeFingerprint,
    treeWins: THE_TREE_WINS,
  });
}

/**
 * F103-SC-002 — the handoff of the pass AFTER a kill. It is `buildHandoff`
 * with the kill in hand; the separate name exists because the success
 * criterion is about this case and a test that calls it by name reads as what
 * it proves.
 */
export function handoffAfterAKill(
  input: HandoffInput & { readonly kill: KillInput },
): HandoffRecord {
  return buildHandoff(input);
}

/* ------------------------------------------------------------------ *
 * Rendering the file.
 * ------------------------------------------------------------------ */

/** The heading of the file. */
export const HEADING = "# Handoff" as const;

/** The marker a cut file ends with. */
export const TRUNCATION_MARKER = "[cut at carry.handoffMaxBytes]" as const;

/**
 * F103-FR-041 — "Every text in it that comes from the workspace MUST be
 * data." Such a text is put inside a `<data>` element, and a closing tag
 * inside the text itself is neutralised, so no workspace text can end the
 * element early and address the reader from outside it.
 */
export function quoted(name: string, text: string): readonly string[] {
  const safe = text.split("</data>").join("<​/data>");
  return Object.freeze([`<data name="${name}">`, safe, "</data>"]);
}

/** The lines of the file, before the ceiling is applied. */
export function handoffLines(record: HandoffRecord): readonly string[] {
  const lines: string[] = [
    HEADING,
    `phase: ${String(record.phase)}`,
    `phase attempt: ${String(record.phaseAttempt)}`,
    `tree fingerprint: ${record.treeFingerprint}`,
    record.treeWins,
    "",
    "## Counters",
  ];
  for (const [name, value] of Object.entries(record.counters)) {
    lines.push(`- ${name}: ${String(value)}`);
  }
  lines.push("", "## Ledger, last lines");
  if (record.ledgerTail.length === 0) lines.push("- (none)");
  for (const line of record.ledgerTail) lines.push(`- ${line}`);

  lines.push("", "## Remaining units of work (the plan less the ledger)");
  if (record.remainingUnits.length === 0) lines.push("- (none declared)");
  for (const unit of record.remainingUnits) lines.push(`- ${unit.id} — ${unit.title}`);

  if (record.killNote !== undefined) {
    const note = record.killNote;
    lines.push("", "## Newest kill note");
    lines.push(`- reason: ${note.reason}`);
    lines.push(`- class: ${note.class}`);
    if (note.passId !== undefined) lines.push(`- pass: ${note.passId}`);
    lines.push(
      note.unitInProgress === undefined
        ? "- unit in progress: none was declared by a layer"
        : `- unit in progress: ${note.unitInProgress}`,
    );
    if (note.text !== undefined) lines.push(...quoted("kill-note", note.text));
  }

  if (record.detachedJob !== undefined) {
    const job = record.detachedJob;
    lines.push("", "## Detached job");
    if (job.exitCode !== undefined) lines.push(`- exit code: ${String(job.exitCode)}`);
    lines.push(...quoted("on-resume", job.onResume));
    if (job.log !== undefined) lines.push(...quoted("job-log", job.log));
  }

  lines.push("", "## Feedback files");
  if (record.feedbackPointers.length === 0) lines.push("- (none)");
  for (const pointer of record.feedbackPointers) lines.push(`- ${pointer}`);

  return Object.freeze(lines);
}

/** What a render gives back. */
export type RenderedHandoff = {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly maxBytes: number;
  /** The hash of the bytes, so a caller can tell one regeneration from another. */
  readonly hash: string;
};

/**
 * F103-FR-041 — the file, at most `carry.handoffMaxBytes` bytes. The cut is at
 * the LAST COMPLETE LINE that still fits WITH the marker, so the result is
 * always valid text and always says that it was cut. The measure is BYTES of
 * UTF-8, not characters, which is what the requirement says and what matters
 * for a file.
 */
export function renderHandoff(
  record: HandoffRecord,
  maxBytes: number = MAX_BYTES_DEFAULT,
): RenderedHandoff {
  const lines = handoffLines(record);
  const whole = `${lines.join("\n")}\n`;
  const wholeBytes = byteLength(whole);
  if (wholeBytes <= maxBytes) {
    return Object.freeze({
      text: whole,
      bytes: wholeBytes,
      truncated: false,
      maxBytes,
      hash: contentHash(whole),
    });
  }
  const markerBytes = byteLength(`${TRUNCATION_MARKER}\n`);
  const kept: string[] = [];
  let used = markerBytes;
  for (const line of lines) {
    const cost = byteLength(`${line}\n`);
    if (used + cost > maxBytes) break;
    kept.push(line);
    used += cost;
  }
  const text = `${[...kept, TRUNCATION_MARKER].join("\n")}\n`;
  return Object.freeze({
    text,
    bytes: byteLength(text),
    truncated: true,
    maxBytes,
    hash: contentHash(text),
  });
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/* ------------------------------------------------------------------ *
 * Writing it.
 * ------------------------------------------------------------------ */

/**
 * The kernel's atomic write, as the composition root hands it over
 * (F100-FR-234). The signature is the kernel's own; this module holds the type
 * and never the implementation, so it starts nothing and opens nothing.
 */
export type AtomicWrite = (
  path: string,
  contents: string | Uint8Array,
  options?: AtomicWriteOptions,
) => void;

/** What a write is given. */
export type WriteInput = {
  /** The real path of the handoff, resolved by the caller from its logical name. */
  readonly path: string;
  readonly record: HandoffRecord;
  readonly maxBytes?: number | undefined;
  /** The kernel's atomic write (F100-FR-012, F100-FR-234). */
  readonly atomicWrite: AtomicWrite;
  /** Options passed on to the atomic write, e.g. the control root. */
  readonly writeOptions?: AtomicWriteOptions | undefined;
};

/** What a write gives back. */
export type WriteResult = {
  readonly path: string;
  /** The record with `maxBytes` and `truncated` stamped from the render. */
  readonly record: HandoffRecord;
  readonly rendered: RenderedHandoff;
  /** The file was written whole, not appended to. */
  readonly regenerated: true;
  readonly appended: false;
};

/**
 * F103-FR-041 — write the handoff: render under the ceiling, stamp the two
 * fields the render decides, and hand the whole text to the atomic write,
 * which renames a new file into place. Nothing is read first, so the file
 * cannot be appended to and the runtime cannot read it back on this path.
 */
export function writeHandoff(input: WriteInput): WriteResult {
  const maxBytes = input.maxBytes ?? MAX_BYTES_DEFAULT;
  const rendered = renderHandoff(input.record, maxBytes);
  const record: HandoffRecord = Object.freeze({
    ...input.record,
    maxBytes,
    truncated: rendered.truncated,
  });
  input.atomicWrite(input.path, rendered.text, input.writeOptions);
  return Object.freeze({
    path: input.path,
    record,
    rendered,
    regenerated: true as const,
    appended: false as const,
  });
}

/**
 * F103-FR-041 — the whole of a pass's handoff step: build it from the ledger
 * and write it. This is what the engine calls at the start of every pass, and
 * what makes "regenerated every time" true by construction: the record is
 * rebuilt from the ledger on every call and never carried over from the pass
 * before.
 */
export function writeHandoffForAPass(
  input: HandoffInput &
    Omit<WriteInput, "record" | "maxBytes"> & {
      readonly maxBytes?: number | undefined;
    },
): WriteResult {
  return writeHandoff({
    path: input.path,
    record: buildHandoff(input),
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    atomicWrite: input.atomicWrite,
    ...(input.writeOptions !== undefined ? { writeOptions: input.writeOptions } : {}),
  });
}
