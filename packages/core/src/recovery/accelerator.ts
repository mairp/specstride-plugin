/**
 * T085 of feature 101 — the accelerator (F101-FR-024 to F101-FR-026).
 *
 * One phase attempt after a diagnosis runs in the role `accelerator`: the same
 * phase, the same ordinal counting, a NARROWED prompt that carries the hint as
 * its first instruction, and a record of what the pass changed in the tree.
 *
 * What this module owns:
 *
 * | Piece | Requirement | As-is |
 * |---|---|---|
 * | The due rule, and the two facts the engine hands to the attempt planner | F101-FR-024 | B-0284 |
 * | The harness of the accelerator, which is the proposer's by default | F101-FR-025 | B-0073 |
 * | The narrowed prompt, as blocks of the prompt block provider | F101-FR-025 | B-0286, B-0285 |
 * | The state of the tree before and after the pass | F101-FR-026 | B-0180 |
 * | The acceleration note, with the accelerator's own note taken in | F101-FR-026 | B-0174, B-0175 |
 * | The as-is start event and line, and the event of the note | F101-FR-025, F101-FR-026 | B-0094, B-0211, B-0098 |
 *
 * The two FACTS go to the seam of feature 100 annex E §E.1 and nowhere else:
 * the engine works them out HERE, hands them over in the history, and the
 * planner of the recovery cycle (`../ep18/planner-recovery.ts`) only reads them
 * — "the planner works out neither again" (F101-FR-024).
 *
 * The module holds no I/O. The state of the tree comes from TWO FIXED-ARGV
 * calls of the version-control tool through the check-runner port (EP-05, annex
 * C §C.8), because the engine starts no process itself (F100-FR-012,
 * F100-FR-234); the records are written through the single writer of the phase
 * gate (`../gate/writers.ts`).
 */
import { Buffer } from "node:buffer";
import { cutToDeclaredSize, type Block } from "@specstride/contracts/ep/prompt-block";
import {
  changedByPass,
  halfIsEmpty,
  SCHEMA_ID as ACCELERATOR_SNAPSHOT_SCHEMA_ID,
  LOGICAL_NAME as ACCELERATOR_SNAPSHOT_LOGICAL_NAME,
  type AcceleratorSnapshot,
  type TreeState,
} from "@specstride/contracts/records/accelerator-snapshot";
import { contentHash } from "@specstride/kernel/hasher";
import { criteriaOfAccelerationStart, signatureHoldsTaskIds } from "../gate/feedback.ts";
import { acceleratorStart as acceleratorStartLine } from "../gate/lines.ts";
import {
  anAcceleratedPhaseAttemptIsDue,
  markersBeforeAnAcceleratedPhaseAttempt,
  theAcceleratorIsEnabled,
  theAttemptBeforeWasAccelerated,
  type RecoveryMarkers,
} from "./markers.ts";
import { asData, type BlockSet, type OutsideTextFraming } from "./diagnostician.ts";

export { ACCELERATOR_SNAPSHOT_LOGICAL_NAME, ACCELERATOR_SNAPSHOT_SCHEMA_ID };
export type { AcceleratorSnapshot, TreeState };

/* ==================================================================== *
 * F101-FR-024 — the due rule and the two facts of the history.
 * ==================================================================== */

/** The kind of a phase attempt that this module is about (annex E §E.1). */
export const KIND = "accelerated" as const;

/** F101-FR-025 — the role the pass loop runs an accelerated attempt in. */
export const ROLE = "accelerator" as const;

/** F101-FR-025 — it uses an ordinal of the phase like every other attempt. */
export const USES_AN_ORDINAL_OF_THE_PHASE = true as const;

/** What the due rule is told; the rule itself is `./markers.ts`. */
export type AccelerationFacts = {
  /** The configured value of the switch of the accelerator (B-0072). */
  readonly acceleratorSwitch?: string | undefined;
  /** The kind of the phase attempt before this one IN THIS ENGINE START. */
  readonly kindOfTheAttemptBefore?: string | undefined;
  readonly hintExists: boolean;
  readonly feedbackExists: boolean;
  readonly markers: RecoveryMarkers;
};

/** F101-FR-024 — whether an accelerated phase attempt is due (B-0284). */
export function accelerationIsDue(facts: AccelerationFacts): boolean {
  return anAcceleratedPhaseAttemptIsDue({
    enabled: theAcceleratorIsEnabled(facts.acceleratorSwitch),
    theAttemptBeforeWasAccelerated: theAttemptBeforeWasAccelerated(facts.kindOfTheAttemptBefore),
    hintExists: facts.hintExists,
    feedbackExists: facts.feedbackExists,
    markers: facts.markers,
  });
}

/**
 * F101-FR-024 — the two facts of the history of the phase that the ENGINE
 * works out and hands to the attempt planner, under the names the seam of
 * feature 100 gives them (`AttemptHistory` of annex E §E.1).
 */
export const FACTS_THE_ENGINE_HANDS_OVER = [
  "diagnosisWasMadeForTheNewestSignature",
  "anAcceleratedPhaseAttemptIsDue",
] as const;

/** F101-FR-024 — the planner works out neither of them again. */
export const THE_PLANNER_WORKS_THEM_OUT_AGAIN = false as const;

/** The two facts, as the engine hands them over. */
export type FactsOfTheHistory = {
  /** Whether a diagnosis was made after the last rejection. */
  readonly diagnosisWasMadeForTheNewestSignature: boolean;
  /** Whether an accelerated phase attempt is due. */
  readonly anAcceleratedPhaseAttemptIsDue: boolean;
};

/**
 * F101-FR-024 — the two facts, worked out from the markers of the phase and
 * from what the engine just did.
 *
 * `diagnosisWasMadeForTheNewestSignature` is true where a diagnosis RAN for the
 * signature of the newest feedback — which is what the marker `diagnosed`
 * holds once the diagnostician recorded it (B-0173) — and the due rule of
 * F101-FR-024 decides the second.
 */
export function factsOfTheHistory(inputs: {
  /** The signature of the newest feedback of the phase, where one exists. */
  readonly newestSignature?: string | undefined;
  readonly acceleration: AccelerationFacts;
}): FactsOfTheHistory {
  const diagnosed = inputs.acceleration.markers.diagnosed;
  const signature = inputs.newestSignature;
  return Object.freeze({
    diagnosisWasMadeForTheNewestSignature:
      typeof diagnosed === "string" &&
      diagnosed !== "" &&
      (signature === undefined || signature === diagnosed),
    anAcceleratedPhaseAttemptIsDue: accelerationIsDue(inputs.acceleration),
  });
}

/**
 * F101-FR-024 — the signature is recorded as accelerated BEFORE the pass of
 * the accelerated phase attempt starts, so that an interrupted one is never
 * repeated for the same signature (B-0179). The signature recorded is the one
 * the marker `diagnosed` holds: the acceleration answers the diagnosis.
 */
export function markersBeforeThePass(markers: RecoveryMarkers): RecoveryMarkers {
  const diagnosed = typeof markers.diagnosed === "string" ? markers.diagnosed : "";
  return markersBeforeAnAcceleratedPhaseAttempt(markers, diagnosed);
}

/* ==================================================================== *
 * F101-FR-025 — the harness, and the as-is start of the attempt.
 * ==================================================================== */

/**
 * F101-FR-025 — the harness configured for the accelerator, which by DEFAULT
 * is the proposer's (B-0073: the as-is default of the setting is empty, which
 * means the proposer's backend).
 */
export function harnessOfTheAccelerator(configured: string | undefined, proposer: string): string {
  return configured === undefined || configured === "" ? proposer : configured;
}

/** The as-is event of the start, with its four fields (B-0094). */
export const AS_IS_START_EVENT = Object.freeze({
  name: "accelerator_start",
  fields: ["phase", "attempt", "backend", "criteria"],
});

/** The as-is event of the acceleration note, with its three fields (B-0098). */
export const AS_IS_NOTE_EVENT = Object.freeze({
  name: "acceleration_note",
  fields: ["phase", "attempt", "note"],
});

/** The as-is start event of an accelerated phase attempt (B-0094). */
export function startEvent(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly harness: string;
  readonly signature: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    phase: inputs.phase,
    attempt: inputs.ordinal,
    backend: inputs.harness,
    // B-0094 — `criteria` is the signature WITHOUT its last comma.
    criteria: criteriaOfAccelerationStart(inputs.signature),
  });
}

/** The as-is line of the start of an accelerated phase attempt (B-0211). */
export function startLine(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly rejectLimit: number;
  readonly harness: string;
  readonly signature: string;
}): string {
  return acceleratorStartLine(
    inputs.phase,
    inputs.ordinal,
    inputs.rejectLimit,
    inputs.harness,
    criteriaOfAccelerationStart(inputs.signature),
  );
}

/* ==================================================================== *
 * F101-FR-025 — the narrowed prompt, through the prompt block provider.
 * ==================================================================== */

/**
 * F101-FR-025 — the blocks of the prompt of an accelerated phase attempt, in
 * the order the requirement lists them (B-0286). Every one of them is a block
 * of EP-15, the prompt block provider, so the one assembler of the prompt keeps
 * the budget and the engine contributes no prompt of its own.
 */
export const BLOCK_ORDER = [
  "accelerator.hint",
  "accelerator.phase-section",
  "accelerator.feedback",
  "accelerator.footprint",
  "accelerator.evidence-contract",
  "accelerator.splice",
  "accelerator.ordinal",
  "accelerator.verification-obligations",
] as const;
export type AcceleratorBlockId = (typeof BLOCK_ORDER)[number];

/** F101-FR-025 — the hint is the FIRST instruction of the prompt (B-0286). */
export const THE_HINT_IS_THE_FIRST_INSTRUCTION = true as const;

/**
 * F101-FR-025 — the prompt FOLLOWS THE SWITCH OF THE BLOCK SET OF THE
 * PROPOSER'S PROMPT and has no switch of its own (register row DV-094, rule
 * N-24). With the as-is block set it equals the baseline's byte for byte;
 * otherwise the feedback and the hint stand in it as data.
 */
export const THE_PROMPT_HAS_A_SWITCH_OF_ITS_OWN = false as const;
export const THE_PROMPT_FOLLOWS = "the block set of the proposer's prompt" as const;

/** The as-is footprint rule of the prompt (B-0286). */
export const FOOTPRINT_RULE: string =
  "Change as little as the unmet criteria need. Touch no file that no unmet " +
  "criterion names, and add no task of your own.";

/** The as-is instruction to splice the change into the newest evidence (B-0285). */
export function spliceInstruction(newestArchivedEvidence: string): string {
  return (
    `Take the newest archived phase evidence of this phase, ` +
    `${newestArchivedEvidence}, copy it, and splice your change into it.`
  );
}

/** The as-is line that names the ordinal and the reject limit (B-0286). */
export function ordinalLine(ordinal: number, rejectLimit: number): string {
  return `This is attempt ${ordinal} of ${rejectLimit}`;
}

/**
 * B-0285 — the newest archived phase evidence of the phase: the one with the
 * latest modification time. The engine reads the times through the tree port;
 * this is the choice between them.
 */
export function newestArchivedPhaseEvidence(
  entries: readonly { readonly path: string; readonly modifiedAtMs: number }[],
): string | undefined {
  let newest: { path: string; modifiedAtMs: number } | undefined;
  for (const entry of entries) {
    if (newest === undefined || entry.modifiedAtMs > newest.modifiedAtMs) {
      newest = { path: entry.path, modifiedAtMs: entry.modifiedAtMs };
    }
  }
  return newest?.path;
}

/**
 * F101-FR-025 — the NARROWED section of the phase: only the HEADINGS and the
 * lines that NAME AN UNMET TASK ID; the WHOLE section for a signature of text
 * (B-0286).
 *
 * The ids are the ones the grammar owner already parsed and the signature
 * holds, so this module reads no task-line grammar of its own (F104-SC-001,
 * the same rule `../gate/feedback.ts` records).
 */
export function narrowedPhaseSection(
  section: string,
  unmetIds: readonly string[],
  signature: string,
): string {
  if (!signatureHoldsTaskIds(signature)) return section;
  const lines = section.split(/\r\n|\n|\r/);
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return true;
    return unmetIds.some((id) => id !== "" && line.includes(id));
  });
  return kept.join("\n");
}

/** What the prompt of an accelerated phase attempt is built from. */
export type AcceleratorPromptInputs = {
  readonly phase: number;
  readonly ordinal: number;
  readonly rejectLimit: number;
  /** The hint of the diagnostician, as it stands on disk. */
  readonly hint: string;
  /** The feedback that led to this phase attempt. */
  readonly feedback: string;
  /** The section of the specification of the phase. */
  readonly phaseSection: string;
  /** The signature of unmet criteria, which decides the narrowing. */
  readonly signature: string;
  /** The unmet task ids the signature names. */
  readonly unmetIds: readonly string[];
  /** The contract of the phase evidence, as the consumer states it. */
  readonly evidenceContract: string;
  /** The newest archived phase evidence of the phase (B-0285). */
  readonly newestArchivedEvidence: string;
  /** The verification obligations of the UNMET ids only (F101-FR-025). */
  readonly verificationObligations: readonly string[];
  readonly blockSet: BlockSet;
};

/** The size a block of this prompt declares; a longer block is cut (§D.5). */
export const DECLARED_SIZE = 200_000 as const;

/**
 * F101-FR-025 — the eight blocks of the prompt, in the order of the
 * requirement, as blocks of EP-15. The hint stands first; the feedback and the
 * hint are text from outside the runtime, so outside the as-is block set they
 * stand inside the data boundary of this pass (F100-FR-221).
 */
export function acceleratorPromptBlocks(
  inputs: AcceleratorPromptInputs,
  framing?: OutsideTextFraming,
): readonly Block[] {
  const data = (text: string): string => asData(text, inputs.blockSet, framing);
  const texts: Readonly<Record<AcceleratorBlockId, string>> = Object.freeze({
    "accelerator.hint": data(inputs.hint),
    "accelerator.phase-section": narrowedPhaseSection(
      inputs.phaseSection,
      inputs.unmetIds,
      inputs.signature,
    ),
    "accelerator.feedback": data(inputs.feedback),
    "accelerator.footprint": FOOTPRINT_RULE,
    "accelerator.evidence-contract": inputs.evidenceContract,
    "accelerator.splice": spliceInstruction(inputs.newestArchivedEvidence),
    "accelerator.ordinal": ordinalLine(inputs.ordinal, inputs.rejectLimit),
    "accelerator.verification-obligations": inputs.verificationObligations.join("\n"),
  });
  const blocks = BLOCK_ORDER.map((id) => {
    const text = texts[id];
    const block: Block = Object.freeze({
      id,
      bytes: Buffer.byteLength(text, "utf8"),
      hash: contentHash(text),
      writer: ROLE,
      // Every block of this prompt is protected: the narrowed prompt is the
      // whole instruction of the pass, and a dropped block would send an
      // accelerator off without its hint or without its criteria (§D.5).
      protected: true,
      stability: "volatile",
      text,
    });
    return cutToDeclaredSize(block, DECLARED_SIZE).block;
  });
  return Object.freeze(blocks);
}

/** The prompt as one text, for the record of the pass (B-0178). */
export function acceleratorPromptText(blocks: readonly Block[]): string {
  return blocks
    .filter((block) => block.text !== "")
    .map((block) => block.text)
    .join("\n\n");
}

/** B-0178 — where the prompt of the pass is written, overwritten per attempt. */
export function promptRecordPath(phase: number): string {
  return `accelerator-prompt.phase${phase}.txt`;
}

/* ==================================================================== *
 * F101-FR-026 — the state of the tree before and after the pass.
 * ==================================================================== */

/**
 * The two FIXED-ARGV calls of the version-control tool the state rests on
 * (B-0180). They run through the check-runner port; the engine starts no
 * process itself.
 */
export const CHANGED_FILES_ARGV = Object.freeze(["git", "diff", "--numstat", "HEAD"]);
export const NEW_FILES_ARGV = Object.freeze(["git", "ls-files", "--others", "--exclude-standard"]);

/** F101-FR-026 — both halves are EMPTY outside a repository. */
export const EMPTY_TREE_STATE: TreeState = Object.freeze({
  changed: Object.freeze([]),
  newFiles: Object.freeze([]),
});

/** One fixed-argv call of the version-control tool, as the engine hands it in. */
export type VersionControlCall = (argv: readonly string[]) => {
  readonly exitCode: number;
  readonly stdout: string;
};

/**
 * F101-FR-026 — the state of the tree: the files changed against the last
 * commit with their counts of lines, and the files that are new, both SORTED
 * by path (B-0180). A count that the tool reports as `-` (a binary file) is
 * read as zero lines.
 */
export function treeState(changedOutput: string, newFilesOutput: string): TreeState {
  const changed: { path: string; linesAdded: number; linesRemoved: number }[] = [];
  for (const line of changedOutput.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path === undefined || path === "") continue;
    const count = (value: string | undefined): number => {
      const parsed = Number.parseInt(value ?? "", 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    changed.push({ path, linesAdded: count(added), linesRemoved: count(removed) });
  }
  const newFiles = newFilesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return Object.freeze({
    changed: Object.freeze(
      [...changed].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ),
    newFiles: Object.freeze([...newFiles].sort()),
  });
}

/**
 * F101-FR-026 — the state of the tree taken through the port. Outside a
 * repository the state is EMPTY: the first call fails, and nothing of it is
 * read.
 */
export function treeStateThroughThePort(deps: {
  readonly run: VersionControlCall;
  readonly insideAWorkTree: boolean;
}): TreeState {
  if (!deps.insideAWorkTree) return EMPTY_TREE_STATE;
  const changed = deps.run(CHANGED_FILES_ARGV);
  if (changed.exitCode !== 0) return EMPTY_TREE_STATE;
  const newFiles = deps.run(NEW_FILES_ARGV);
  return treeState(changed.stdout, newFiles.exitCode === 0 ? newFiles.stdout : "");
}

/** F101-FR-026 — the snapshot record of one accelerated phase attempt. */
export function acceleratorSnapshot(inputs: {
  readonly attemptId: string;
  readonly phase: number;
  readonly ordinal: number;
  readonly before: TreeState;
  readonly after: TreeState;
}): AcceleratorSnapshot {
  return Object.freeze({
    schema: ACCELERATOR_SNAPSHOT_SCHEMA_ID,
    attemptId: inputs.attemptId,
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    before: inputs.before,
    after: inputs.after,
    changedByPass: changedByPass(inputs.before, inputs.after),
  }) as AcceleratorSnapshot;
}

/** True where both halves hold nothing: the state outside a repository. */
export function snapshotIsEmpty(snapshot: AcceleratorSnapshot): boolean {
  return halfIsEmpty(snapshot.before as TreeState) && halfIsEmpty(snapshot.after as TreeState);
}

/* ==================================================================== *
 * F101-FR-026 — the acceleration note.
 * ==================================================================== */

/** B-0174 — the as-is heading of the acceleration note. */
export function accelerationNoteHeading(phase: number, ordinal: number): string {
  return `# Phase ${phase} — accelerator pass (attempt ${ordinal})`;
}

/** B-0175 — the as-is heading the accelerator's own note is taken in under. */
export const OWN_NOTE_HEADING = "## The accelerator's own notes" as const;

/** B-0175 — the accelerator's own note is a CLAIM, and it is removed after. */
export const THE_OWN_NOTE_IS_A_CLAIM = true as const;
export const THE_OWN_NOTE_IS_REMOVED = true as const;

/** The parts of the acceleration note, in the order of F101-FR-026. */
export const PARTS_OF_THE_NOTE = Object.freeze([
  "the as-is heading with the phase and the ordinal",
  "the criteria acted on",
  "the files that the pass changed",
  "the accelerator's own note",
]);

/**
 * F101-FR-026 — the acceleration note. The files it names are the files whose
 * entry differs between the two halves of the snapshot (`changedByPass`), and
 * the accelerator's own note stands under its as-is heading, as it was
 * written: it is a claim, and nothing of it is parsed.
 */
export function accelerationNote(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  /** The signature of unmet criteria the pass acted on. */
  readonly criteria: string;
  /** The files the pass changed, from `changedByPass` of the snapshot. */
  readonly changedByPass: readonly string[];
  /** The accelerator's own note, where it left one. */
  readonly ownNote?: string | undefined;
}): string {
  const lines: string[] = [
    accelerationNoteHeading(inputs.phase, inputs.ordinal),
    "",
    `criteria: ${criteriaOfAccelerationStart(inputs.criteria)}`,
    "",
    "## The files the pass changed",
    "",
  ];
  if (inputs.changedByPass.length === 0) {
    lines.push("(no file of the tree changed)");
  } else {
    for (const path of inputs.changedByPass) lines.push(`- ${path}`);
  }
  if (inputs.ownNote !== undefined && inputs.ownNote !== "") {
    lines.push("", OWN_NOTE_HEADING, "", inputs.ownNote.replace(/\n+$/, ""));
  }
  return `${lines.join("\n")}\n`;
}

/* ==================================================================== *
 * One accelerated phase attempt, end to end.
 * ==================================================================== */

/** What the engine is told about one accelerated phase attempt. */
export type AcceleratedAttemptInputs = {
  readonly attemptId: string;
  readonly phase: number;
  readonly ordinal: number;
  readonly rejectLimit: number;
  /** The harness of the accelerator, which is the proposer's by default. */
  readonly harness: string;
  /** The signature the pass acts on: the one the marker `diagnosed` holds. */
  readonly signature: string;
  readonly markers: RecoveryMarkers;
  readonly prompt: AcceleratorPromptInputs;
  readonly insideAWorkTree: boolean;
};

/** The ports one accelerated phase attempt calls. */
export type AcceleratedAttemptDependencies = {
  /** The pass itself, run by the pass loop in the role `accelerator`. */
  readonly runThePass: (prompt: string) => void | Promise<void>;
  /** One fixed-argv call of the version-control tool (EP-05). */
  readonly run: VersionControlCall;
  /** Write the markers back, BEFORE the pass starts (B-0179). */
  readonly writeMarkers: (markers: RecoveryMarkers) => void;
  /** Write the snapshot of the state of the tree. */
  readonly writeSnapshot: (snapshot: AcceleratorSnapshot) => void;
  /** Write the acceleration note. */
  readonly writeNote: (text: string) => string;
  /** Read the accelerator's own note, where it left one, and remove it. */
  readonly takeTheOwnNote?: (() => string | undefined) | undefined;
  readonly emit: (name: string, data: Readonly<Record<string, unknown>>) => void;
  readonly writeLine: (line: string) => void;
  readonly framing?: OutsideTextFraming | undefined;
};

/** What one accelerated phase attempt left behind. */
export type AcceleratedAttemptOutcome = {
  readonly promptText: string;
  readonly blocks: readonly Block[];
  readonly snapshot: AcceleratorSnapshot;
  readonly note: string;
  /** Where the note was written, which the as-is event carries (B-0098). */
  readonly notePath: string;
  readonly markers: RecoveryMarkers;
};

/**
 * F101-FR-025 and F101-FR-026 — run the pass of one accelerated phase attempt.
 *
 * The order is the requirements': the signature is recorded BEFORE anything
 * else, so an interruption cannot repeat the attempt; then the state of the
 * tree, the as-is event and line, the pass, the state of the tree again, the
 * snapshot, and the acceleration note with the event of it.
 */
export async function runAnAcceleratedPhaseAttempt(
  inputs: AcceleratedAttemptInputs,
  deps: AcceleratedAttemptDependencies,
): Promise<AcceleratedAttemptOutcome> {
  // F101-FR-024 — the signature as accelerated, BEFORE the pass starts.
  const markers = markersBeforeThePass(inputs.markers);
  deps.writeMarkers(markers);

  const before = treeStateThroughThePort({
    run: deps.run,
    insideAWorkTree: inputs.insideAWorkTree,
  });

  // F101-FR-025 — the as-is start event and the as-is line (B-0094, B-0211).
  deps.emit(
    AS_IS_START_EVENT.name,
    startEvent({
      phase: inputs.phase,
      ordinal: inputs.ordinal,
      harness: inputs.harness,
      signature: inputs.signature,
    }),
  );
  deps.writeLine(
    startLine({
      phase: inputs.phase,
      ordinal: inputs.ordinal,
      rejectLimit: inputs.rejectLimit,
      harness: inputs.harness,
      signature: inputs.signature,
    }),
  );

  const blocks = acceleratorPromptBlocks(inputs.prompt, deps.framing);
  const promptText = acceleratorPromptText(blocks);
  await deps.runThePass(promptText);

  const after = treeStateThroughThePort({
    run: deps.run,
    insideAWorkTree: inputs.insideAWorkTree,
  });
  const snapshot = acceleratorSnapshot({
    attemptId: inputs.attemptId,
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    before,
    after,
  });
  deps.writeSnapshot(snapshot);

  // B-0175 — the accelerator's own note is read as a claim and removed.
  const ownNote = deps.takeTheOwnNote?.();
  const note = accelerationNote({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    criteria: inputs.signature,
    changedByPass: snapshot.changedByPass,
    ...(ownNote === undefined ? {} : { ownNote }),
  });
  const notePath = deps.writeNote(note);
  deps.emit(AS_IS_NOTE_EVENT.name, {
    phase: inputs.phase,
    attempt: inputs.ordinal,
    note: notePath,
  });

  return Object.freeze({ promptText, blocks, snapshot, note, notePath, markers });
}
