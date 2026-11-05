/**
 * T084 of feature 101 — the diagnostician (F101-FR-020 to F101-FR-023).
 *
 * After a rejection whose unmet set CHANGED, one call looks at the phase from
 * the outside and writes a HINT for the next phase attempt. The call is a
 * CRITIC-CLASS call and carries every guarantee of one, with four differences
 * that F101-FR-020 names and that this module holds as data, so that no reader
 * has to take them on trust:
 *
 * | | A critic call | A call of the diagnostician |
 * |---|---|---|
 * | Nonce | one per call | NONE (B-1010) |
 * | Verdict grammar | demanded and parsed | NONE (B-0966) |
 * | Verification plan, reject limit | given | NOT given (B-1148) |
 * | Outcome for the loop | the verdict | IGNORED; the result code is 0 (B-0866) |
 *
 * What it keeps from a critic-class call: a fresh session that is never a
 * session of the proposer, the critic of the role plan unless the consumer
 * configured another harness for the role, the FORM of the `completion` level
 * of its entry of the role plan with the PROOF of that form recorded for the
 * call (feature 100 annex C §C.3, F100-FR-087), the time limit of a critic call
 * (B-0047), exactly one call, the CRITIC-DIVERSITY test before the call
 * (F100-FR-024/F149-FR-001), the hiding of the proposer's notebook, handoff and
 * outbox for the form `read-only-tools` (F100-FR-088), and the checks of the
 * specification, the format, the phase and the phase evidence before the call
 * (B-1003).
 *
 * THE ORDER OF ONE DIAGNOSIS, which `runTheDiagnostician` walks:
 *
 *  1 the rule of F101-FR-021 (`./markers.ts`), the as-is trigger event and the
 *    as-is line;
 *  2 the checks before the call;
 *  3 the PROOF of the form. A proof that is missing or fails means NO CALL:
 *    it is handled as a failure of the diagnostician, which only warns;
 *  4 the critic-diversity test, which is recorded and never blocks;
 *  5 the proposer's files out of the working tree, for the second form;
 *  6 the ONE call, with the prompt of F101-FR-022;
 *  7 the proposer's files back, however the call ended;
 *  8 the case, the hint of F101-FR-023, and the as-is end event;
 *  9 the signature recorded as diagnosed — after EVERY call, whatever happened.
 *
 * Nothing here writes an approval record, a verdict or feedback, and no failure
 * of it halts a run (B-0967). This module holds no I/O: the call, the move of
 * the proposer's files, the write of the hint and the markers are ports the
 * engine hands in (F100-FR-012, F100-FR-234).
 */
import { Buffer } from "node:buffer";
import {
  FILES_MOVED_OUT_OF_THE_WORKING_TREE,
  FIRST_FORM,
  SECOND_FORM,
  type CompletionForm,
  type CriticProofResult,
} from "@specstride/contracts/enums/completion-forms";
import { diagnosisCaseOrDefault, type DiagnosisCase } from "@specstride/contracts/enums/gate";
import {
  LOGICAL_NAME as WITHHELD_PATHS_LOGICAL_NAME,
  MOVED_FILES,
  type MovedEntry,
} from "@specstride/contracts/records/withheld-paths";
import {
  diversityResultOf,
  proofOfTheCall,
  theCriticDiversityWarningIsDue,
  toolsOfTheCall,
  type CompletionCallFacts,
  type DiversityResult,
} from "../ep18/critic-strategy.ts";
import { TIME_LIMIT_DEFAULT_SECONDS } from "../gate/critic-call.ts";
import {
  diagnosticianStart as diagnosticianStartLine,
  FILE_DUMP_MARKERS,
  hintWritten,
  warning,
  type Ingress,
} from "../gate/lines.ts";
import {
  aDiagnosisIsDue,
  markersAfterADiagnosis,
  theDiagnosticianIsEnabled,
  type RecoveryMarkers,
} from "./markers.ts";

/* ==================================================================== *
 * F101-FR-020 — what kind of call this is.
 * ==================================================================== */

/** The role of the call. It is NEVER the role of the proposer (B-0071). */
export const ROLE = "diagnostician" as const;

/** B-1010 — the call carries no nonce. */
export const CARRIES_A_NONCE = false as const;

/** B-0966 — and no verdict grammar. */
export const CARRIES_THE_VERDICT_GRAMMAR = false as const;

/** B-1148 — it is given neither a verification plan nor a reject limit. */
export const IS_GIVEN_A_VERIFICATION_PLAN = false as const;
export const IS_GIVEN_A_REJECT_LIMIT = false as const;

/** F101-FR-020 — exactly one call per diagnosis (B-0966). */
export const CALLS_PER_DIAGNOSIS = 1 as const;

/** B-0047 — the time limit of a critic call bounds it as well. */
export const TIME_LIMIT_SECONDS = TIME_LIMIT_DEFAULT_SECONDS;

/** F101-FR-020 — the diagnostician never runs in a session of the proposer. */
export const RUNS_IN_A_SESSION_OF_THE_PROPOSER = false as const;

/** B-0866 — the result code of the call, whatever happened. */
export const RESULT_CODE = 0 as const;

/** F101-FR-020 — and the loop ignores the outcome of the call. */
export const THE_LOOP_READS_THE_OUTCOME = false as const;

/** B-0967 — the three records a diagnostician never writes. */
export const NEVER_WRITES = Object.freeze(["an approval record", "a verdict", "feedback"]);

/** B-0967 — a failure of the diagnostician only warns; it never halts a run. */
export const A_FAILURE_HALTS_THE_RUN = false as const;

/**
 * B-1003 — the checks that run BEFORE the call, as they do for a critic call.
 * Each can still end the run with the result code of a configuration error;
 * that end belongs to the critic call (`../gate/critic-call.ts`) and not here.
 */
export const CHECKS_BEFORE_THE_CALL = Object.freeze([
  "the specification",
  "the format",
  "the phase",
  "the phase evidence",
]);

/** The as-is events of the diagnostician, in the order they are emitted. */
export const AS_IS_EVENTS = Object.freeze({
  /** B-0089 — the trigger, with the phase and the ordinal. */
  trigger: Object.freeze({ name: "diagnostician_trigger", fields: ["phase", "attempt"] }),
  /** B-0851 — before the call, with the provider. */
  start: Object.freeze({ name: "diagnostician_start", fields: ["phase", "attempt", "provider"] }),
  /** B-0853 — after the call, with the size of the reply and the case. */
  done: Object.freeze({
    name: "diagnostician_done",
    fields: ["phase", "attempt", "bytes", "case"],
  }),
  /** B-0852 — an error of the call; after it no hint is written. */
  error: Object.freeze({ name: "diagnostician_error", fields: ["phase", "attempt", "error"] }),
});

/** B-0852 — after an error of the call, no hint is written. */
export const A_HINT_IS_WRITTEN_AFTER_AN_ERROR = false as const;

/* ==================================================================== *
 * The entry of the role plan, and the proof of its form.
 * ==================================================================== */

/**
 * The entry of the role plan for the role `diagnostician`, as the engine hands
 * it in. Role resolution (feature 124) builds it and admits no critic-class
 * candidate whose context window is unknown, which is why `contextWindow` is a
 * number here and never `null` (F101-FR-022).
 */
export type DiagnosticianRolePlanEntry = {
  /** The harness that runs the call: the critic's, unless one is configured. */
  readonly harness: string;
  /** The provider the as-is start event names (B-0851). */
  readonly provider: string;
  /** The model of the call, or null where the role plan names none. */
  readonly model: string | null;
  /** The form of the `completion` level of this entry (§C.3). */
  readonly form: CompletionForm;
  /** The read-only tools of the second form; none for the first. */
  readonly readOnlyTools?: readonly string[] | undefined;
  /** The context window of the model, in tokens. Known, by role resolution. */
  readonly contextWindow: number;
  /** Whether the harness adapter is a tested one (the weaker proof, case 3). */
  readonly testedHarnessAdapter?: boolean | undefined;
  /** Whether the harness takes a session id from the caller (case 1). */
  readonly sessionIdIsTakenFromTheCaller?: boolean | undefined;
  /** How the critic came to be the critic of the run (F100-FR-230). */
  readonly provenance?: "configured" | "automatically-picked" | undefined;
};

/**
 * F101-FR-020 — the diagnostician runs on the CRITIC of the role plan unless
 * the consumer configured another harness for the role.
 */
export function harnessOfTheDiagnostician(
  configuredForTheRole: string | undefined,
  critic: string,
): string {
  return configuredForTheRole === undefined || configuredForTheRole === ""
    ? critic
    : configuredForTheRole;
}

/**
 * The facts of the form that the harness adapter reports BEFORE the call. A
 * critic call takes them from the initial record of the call it already made;
 * the diagnostician cannot, because F101-FR-020 forbids making a call whose
 * proof is missing or fails. So the adapter is asked for the facts of the form
 * first — its declared tool-less mode or sandbox mode, the state of the
 * network, the version pin, the preflight, the flag set and the confirmation of
 * the withheld paths of §C.4 — and the SAME judgment of feature 100 is applied
 * to them (`proofOfTheCall`), so the two cannot drift.
 */
export type FormFactsBeforeTheCall = Omit<CompletionCallFacts, "reply"> & {
  /** The session the call will run in, which the engine minted for it. */
  readonly sessionId: string;
};

/** What the proof of one call of the diagnostician needs. */
export type ProofInputOfTheDiagnostician = {
  readonly entry: DiagnosticianRolePlanEntry;
  readonly facts: FormFactsBeforeTheCall;
  /** The session ids of the passes of the phase attempt. */
  readonly sessionIdsOfThePasses: readonly string[];
  /** True under the `parity` profile, where NO proof is made (F100-FR-230). */
  readonly underParity: boolean;
};

/**
 * F101-FR-020 — the proof of the form of the call, made BEFORE the call and
 * RECORDED for it (F100-FR-087, "the result of the proof MUST be recorded for
 * every critic-class call"). The judgment is feature 100's.
 */
export function proofOfTheDiagnosticianCall(
  input: ProofInputOfTheDiagnostician,
): CriticProofResult {
  return proofOfTheCall({
    form: input.entry.form,
    facts: { reply: "", ...input.facts },
    sessionId: input.facts.sessionId,
    sessionIdsOfThePasses: input.sessionIdsOfThePasses,
    sessionIdIsTakenFromTheCaller: input.entry.sessionIdIsTakenFromTheCaller === true,
    testedHarnessAdapter: input.entry.testedHarnessAdapter === true,
    provenance: input.entry.provenance ?? "configured",
    underParity: input.underParity,
  });
}

/**
 * F101-FR-020 — "A call whose proof is missing or fails MUST NOT be made".
 *
 * The call is made for a proof that PASSED, and under the `parity` profile,
 * where no proof is made at all and the result is recorded as `not-made`
 * (F100-FR-230, rows 28 and 117 of annex X §X.7). Every other outcome means no
 * call.
 */
export function theCallMayBeMade(proof: CriticProofResult): boolean {
  if (proof.outcome === "passed") return true;
  return proof.outcome === "not-made" && proof.underParity === true;
}

/** The failure a diagnosis reports where the proof refused the call. */
export const FAILURE_WHEN_THE_PROOF_REFUSES = "the proof of the form of the call" as const;

/* ==================================================================== *
 * F101-FR-020 — the proposer's files, for the form `read-only-tools`.
 * ==================================================================== */

/**
 * F100-FR-088 — the three files of the proposer that are moved out of the
 * working tree before a critic-class call of the second form starts, and moved
 * back after it. The move holds for every critic-class call, the diagnostician
 * included (feature 100, annex C §C.3, repair A15).
 */
export const FILES_HIDDEN_FOR_THE_SECOND_FORM = FILES_MOVED_OUT_OF_THE_WORKING_TREE;

/** The same three names as the record of §C.4 holds them. */
export const MOVED_FILE_NAMES = MOVED_FILES;

/** The record that names what was withheld and where it is kept (§C.4). */
export const WITHHELD_PATHS_RECORD = WITHHELD_PATHS_LOGICAL_NAME;

/** F100-FR-088 — the move happens only for the second form of §C.3. */
export function theProposersFilesAreHiddenFor(form: CompletionForm): boolean {
  return form === SECOND_FORM;
}

/**
 * The port through which the proposer's files leave the working tree and come
 * back. It is the port feature 100 annex C §C.3 names — EP-02,
 * `specstride.harness/1`, whose operation `complete` receives the withheld
 * paths of §C.4 beside the working tree — in the half the ENGINE owns: a core
 * package touches no file itself (F100-FR-012, F100-FR-234), so the composition
 * root implements the two moves and this module calls them.
 *
 * `moveBack` runs however the call ended — it stands in a `finally` — so a
 * failed call, a refused proof and a thrown error all leave the working tree as
 * it was.
 */
export type ProposerFilesPort = {
  /** Move notebook, handoff and outbox out; report where each is kept. */
  moveOut(): readonly MovedEntry[] | Promise<readonly MovedEntry[]>;
  /** Move every one of them back, unchanged. */
  moveBack(entries: readonly MovedEntry[]): void | Promise<void>;
};

/* ==================================================================== *
 * F101-FR-020 — the critic-diversity test, before the call.
 * ==================================================================== */

/** The name of the warning, as feature 111 carries it (F149-FR-001). */
export const WARNING_NAME = "critic-diversity" as const;

/** The two results of row 183 of annex X §X.6 that raise the warning. */
export const DIVERSITY_RESULTS_THAT_WARN = ["same-model", "unverified"] as const;

/** F101-FR-020 — the warning never blocks a run or the call. */
export const THE_WARNING_BLOCKS_THE_CALL = false as const;

/** The as-is text of the warning line, which the ingress is handed first. */
export function diversityWarningLine(result: DiversityResult): string {
  return warning(
    `the diagnostician runs on the model that produced the passes of this phase attempt ` +
      `(critic diversity: ${result})`,
  );
}

/**
 * F101-FR-020 — the test itself, before the call: the identity of provider and
 * model that `capabilities` of the harness port reports for the diagnostician,
 * compared with the models that produced passes in the phase attempt. The
 * comparison is feature 100's (`diversityResultOf`), so this feature has none
 * of its own.
 */
export function diversityOfTheDiagnostician(input: {
  readonly model: string | null;
  readonly provider?: string | null | undefined;
  readonly modelsThatProducedPasses: readonly (string | null | undefined)[];
  readonly providersThatProducedPasses?: readonly (string | null | undefined)[] | undefined;
}): { readonly result: DiversityResult; readonly warning: boolean } {
  const result = diversityResultOf(input.model, input.modelsThatProducedPasses, {
    criticProvider: input.provider ?? null,
    providersThatProducedPasses: input.providersThatProducedPasses ?? [],
  });
  return Object.freeze({ result, warning: theCriticDiversityWarningIsDue(result) });
}

/**
 * F101-FR-020 and the `parity` profile — the warning is RAISED and RECORDED
 * either way; its LINE is printed outside the `parity` profile only, where the
 * baseline printed none.
 */
export function theWarningLineIsPrinted(underParity: boolean): boolean {
  return !underParity;
}

/* ==================================================================== *
 * F101-FR-022 — the prompt.
 * ==================================================================== */

/** B-0962 — the two cases the first line of the reply must name. */
export const DEMANDED_CASES = ["CASE: GROUNDING", "CASE: REAL-GAP"] as const;

/** B-0962 — the demand itself, as it stands in the prompt. */
export const CASE_DEMAND: string =
  `The FIRST line of your reply must be exactly one of:\n` +
  `${DEMANDED_CASES[0]}\n${DEMANDED_CASES[1]}`;

/** B-0917 — the as-is caps of the file dump, at the reference window. */
export const BYTES_PER_FILE_CAP = 200_000 as const;
export const TOTAL_BYTES_CAP = 600_000 as const;

/**
 * The window the as-is caps belong to. B-0917 has both caps "scaled by the
 * window", and the baseline scaled them against the window of its own critic;
 * the caps above are therefore the caps AT THIS WINDOW, and a model with a
 * smaller window gets proportionally smaller caps. A larger window never raises
 * them above the as-is caps, so a prompt of this feature is never bigger than
 * the baseline's for the same files. The reading is this feature's and is
 * declared here rather than hidden in an expression.
 */
export const REFERENCE_CONTEXT_WINDOW = 200_000 as const;

/** The caps of one call, scaled by the context window of the model (B-0917). */
export function capsForTheWindow(contextWindow: number): {
  readonly perFile: number;
  readonly total: number;
} {
  const factor = contextWindow > 0 ? Math.min(1, contextWindow / REFERENCE_CONTEXT_WINDOW) : 1;
  return Object.freeze({
    perFile: Math.floor(BYTES_PER_FILE_CAP * factor),
    total: Math.floor(TOTAL_BYTES_CAP * factor),
  });
}

/** How many entries of a directory the dump lists at most (B-0893). */
export const DIRECTORY_ENTRIES_LISTED = 200 as const;

/**
 * B-0893 — the as-is markers of the file dump, each with the shape the
 * baseline writes. `binary` takes the detail the detector gives, which is what
 * stands in the parentheses of the as-is line.
 */
export const DUMP_MARKERS = Object.freeze({
  notFound: (): string => "NOT FOUND on disk",
  directory: (entries: number): string => `directory (${entries} entries)`,
  binary: (detail: string, bytes: number): string =>
    `binary (${detail}), ${bytes} bytes on disk; content not dumped`,
  skipped: (): string =>
    "SKIPPED (diagnostician total budget reached; file verified present on disk)",
  truncated: (bytes: number): string => `(truncated at ${bytes} bytes — file is larger)`,
});

/** The BEGIN and END markers that frame one file of the dump (B-0893). */
export const FILE_FRAME = FILE_DUMP_MARKERS;

/** One file the prompt names, as the engine read it from the tree. */
export type FileForTheDump =
  | { readonly path: string; readonly kind: "missing" }
  | { readonly path: string; readonly kind: "directory"; readonly entries: readonly string[] }
  | {
      readonly path: string;
      readonly kind: "binary";
      readonly detail: string;
      readonly bytes: number;
    }
  | { readonly path: string; readonly kind: "text"; readonly content: string };

/** One file of the dump as it stands in the prompt, with what became of it. */
export type DumpedFile = {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  /** What the marker said about it, where one was written. */
  readonly marker?: string | undefined;
  /** True where the file was cut at the per-file cap. */
  readonly truncated: boolean;
  /** True where it was skipped because the total was reached. */
  readonly skipped: boolean;
};

/**
 * F101-FR-022 — the block of files: every file the prompt names, shown IN FULL
 * up to the per-file cap and the total, with the as-is marker of each case.
 *
 * The order of the files is the caller's; the total is spent in that order, so
 * a file that comes after the total was reached carries the marker `SKIPPED`
 * and is still named, which is how the baseline keeps a reader able to see that
 * the file existed (B-0893).
 */
export function dumpOfTheFiles(
  files: readonly FileForTheDump[],
  caps: { readonly perFile: number; readonly total: number },
): readonly DumpedFile[] {
  let spent = 0;
  const out: DumpedFile[] = [];
  for (const file of files) {
    const frame = (body: string, marker?: string): DumpedFile => {
      const text = `${FILE_FRAME.begin(file.path)}\n${body}\n${FILE_FRAME.end(file.path)}`;
      return Object.freeze({
        path: file.path,
        text,
        bytes: Buffer.byteLength(text, "utf8"),
        ...(marker === undefined ? {} : { marker }),
        truncated: false,
        skipped: false,
      });
    };
    if (file.kind === "missing") {
      out.push(frame(DUMP_MARKERS.notFound(), DUMP_MARKERS.notFound()));
      continue;
    }
    if (file.kind === "directory") {
      const listed = file.entries.slice(0, DIRECTORY_ENTRIES_LISTED);
      const marker = DUMP_MARKERS.directory(file.entries.length);
      out.push(frame([marker, ...listed].join("\n"), marker));
      continue;
    }
    if (file.kind === "binary") {
      const marker = DUMP_MARKERS.binary(file.detail, file.bytes);
      out.push(frame(marker, marker));
      continue;
    }
    const size = Buffer.byteLength(file.content, "utf8");
    if (spent >= caps.total) {
      const marker = DUMP_MARKERS.skipped();
      const framed = frame(marker, marker);
      out.push(Object.freeze({ ...framed, skipped: true }));
      continue;
    }
    const room = Math.min(caps.perFile, caps.total - spent);
    if (size <= room) {
      spent += size;
      out.push(frame(file.content));
      continue;
    }
    const cut = Buffer.from(file.content, "utf8").subarray(0, room).toString("utf8");
    const marker = DUMP_MARKERS.truncated(room);
    spent += room;
    const framed = frame(`${cut}\n${marker}`, marker);
    out.push(Object.freeze({ ...framed, truncated: true }));
  }
  return Object.freeze(out);
}

/** B-0965 — what is shrunk to fit the window, in that order. */
export const SHRINK_ORDER = ["the block of files", "the history", "the phase evidence"] as const;
export type ShrinkablePart = (typeof SHRINK_ORDER)[number];

/** The four parts of the prompt the fitting works on. */
export type PromptParts = {
  /** What never shrinks: the demand of the case and the instructions. */
  readonly fixed: string;
  readonly files: string;
  readonly history: string;
  readonly evidence: string;
};

/** What the fitting did, so that the engine can record it. */
export type FittedPrompt = {
  readonly parts: PromptParts;
  readonly bytes: number;
  /** The parts that were shrunk, in the order they were shrunk. */
  readonly shrunk: readonly ShrinkablePart[];
  /** True where the prompt still does not fit after every part was dropped. */
  readonly overTheWindow: boolean;
};

/** How many bytes of a prompt one token of the window is taken to hold. */
export const BYTES_PER_TOKEN = 4 as const;

/** The byte budget of a prompt for a model of this window. */
export function promptBudgetOf(contextWindow: number): number {
  return Math.max(0, Math.floor(contextWindow * BYTES_PER_TOKEN));
}

/**
 * F101-FR-022 — fit the prompt to the window by shrinking FIRST the block of
 * files, THEN the history, THEN the phase evidence (B-0965). Each part is
 * dropped whole, in that order, until the prompt fits; the fixed part — the
 * demand of the case and the instructions — never shrinks, so a prompt that
 * still does not fit is reported as such and never silently emptied.
 */
export function fitThePrompt(parts: PromptParts, budget: number): FittedPrompt {
  const sizeOf = (p: PromptParts): number =>
    Buffer.byteLength([p.fixed, p.files, p.history, p.evidence].join("\n"), "utf8");
  let current: PromptParts = parts;
  const shrunk: ShrinkablePart[] = [];
  if (budget <= 0 || sizeOf(current) <= budget) {
    return Object.freeze({
      parts: current,
      bytes: sizeOf(current),
      shrunk: Object.freeze([]),
      overTheWindow: false,
    });
  }
  for (const part of SHRINK_ORDER) {
    current =
      part === "the block of files"
        ? { ...current, files: "" }
        : part === "the history"
          ? { ...current, history: "" }
          : { ...current, evidence: "" };
    shrunk.push(part);
    if (sizeOf(current) <= budget) break;
  }
  const bytes = sizeOf(current);
  return Object.freeze({
    parts: current,
    bytes,
    shrunk: Object.freeze([...shrunk]),
    overTheWindow: bytes > budget,
  });
}

/**
 * F101-FR-022 — the block set of the prompt. The prompt of the diagnostician
 * FOLLOWS THE SWITCH OF THE BLOCK SET OF THE CRITIC PROMPT and has NO switch of
 * its own (register row DV-100, rule N-24).
 */
export const BLOCK_SETS = ["as-is", "new"] as const;
export type BlockSet = (typeof BLOCK_SETS)[number];
export const THE_PROMPT_HAS_A_SWITCH_OF_ITS_OWN = false as const;
export const THE_PROMPT_FOLLOWS = "the block set of the critic prompt" as const;

/**
 * The framing of text from outside the runtime, as F100-FR-221 asks for it: a
 * random boundary PER CALL, drawn by the ingress package of feature 111 and
 * handed in, because a core package draws none itself. With the as-is block set
 * no framing is applied, because the prompt must equal the baseline's byte for
 * byte (F101-FR-022, F101-FR-025).
 */
export type OutsideTextFraming = {
  /** The token of this call; every framed text carries it. */
  readonly boundary: string;
  frame(text: string, boundary: string): { readonly framed: string };
};

/** The parts of the prompt that come from OUTSIDE the runtime (F100-FR-221). */
export const OUTSIDE_PARTS_OF_THE_PROMPT = Object.freeze([
  "the phase evidence",
  "the feedback",
  "the files",
]);

/**
 * Put one outside text inside the data boundary of this call. With the as-is
 * block set the text is handed back unchanged, which is what keeps the as-is
 * prompt byte-equal to the baseline's.
 */
export function asData(
  text: string,
  blockSet: BlockSet,
  framing: OutsideTextFraming | undefined,
): string {
  if (blockSet === "as-is" || framing === undefined) return text;
  return framing.frame(text, framing.boundary).framed;
}

/** What the prompt of the diagnostician is built from. */
export type DiagnosticianPromptInputs = {
  readonly phase: number;
  readonly ordinal: number;
  /** The phase evidence of the phase attempt, as the proposer wrote it. */
  readonly phaseEvidence: string;
  /** The feedback that led to this diagnosis. */
  readonly feedback: string;
  /** One line per phase attempt of the phase so far. */
  readonly history: readonly string[];
  /** The files the prompt names, in the order the total is spent in. */
  readonly files: readonly FileForTheDump[];
  /** The section of the specification of the phase, where one is given. */
  readonly phaseSection?: string | undefined;
  readonly blockSet: BlockSet;
  readonly contextWindow: number;
};

/** The prompt, with everything the engine records about how it was built. */
export type DiagnosticianPrompt = {
  readonly text: string;
  readonly parts: PromptParts;
  readonly dump: readonly DumpedFile[];
  readonly caps: { readonly perFile: number; readonly total: number };
  readonly fitted: FittedPrompt;
  /** The boundary token of this call, outside the `as-is` block set. */
  readonly boundary: string | undefined;
};

/**
 * F101-FR-022 — the prompt of the diagnostician. It carries the demand of the
 * case, the block of files under the caps of the window, the history, the
 * feedback and the phase evidence; it carries NO nonce and NO verdict grammar.
 */
export function diagnosticianPrompt(
  inputs: DiagnosticianPromptInputs,
  framing?: OutsideTextFraming,
): DiagnosticianPrompt {
  const caps = capsForTheWindow(inputs.contextWindow);
  const dump = dumpOfTheFiles(inputs.files, caps);
  const data = (text: string): string => asData(text, inputs.blockSet, framing);

  const fixed = [
    `# Diagnostician — phase ${inputs.phase}, attempt ${inputs.ordinal}`,
    "",
    CASE_DEMAND,
    "",
    "You write no verdict and approve nothing. Say what the next attempt must do.",
    ...(inputs.phaseSection === undefined
      ? []
      : ["", "## The phase", "", data(inputs.phaseSection)]),
  ].join("\n");

  const parts: PromptParts = Object.freeze({
    fixed,
    files:
      dump.length === 0
        ? ""
        : ["## The files", "", data(dump.map((file) => file.text).join("\n\n"))].join("\n"),
    history:
      inputs.history.length === 0
        ? ""
        : ["## The attempts so far", "", data(inputs.history.join("\n"))].join("\n"),
    evidence: [
      "## The feedback",
      "",
      data(inputs.feedback),
      "",
      "## The phase evidence",
      "",
      data(inputs.phaseEvidence),
    ].join("\n"),
  });

  const fitted = fitThePrompt(parts, promptBudgetOf(inputs.contextWindow));
  const text = [fitted.parts.fixed, fitted.parts.files, fitted.parts.history, fitted.parts.evidence]
    .filter((part) => part !== "")
    .join("\n\n");
  return Object.freeze({
    text,
    parts: fitted.parts,
    dump,
    caps,
    fitted,
    boundary: inputs.blockSet === "as-is" ? undefined : framing?.boundary,
  });
}

/* ==================================================================== *
 * F101-FR-022 — the case of the reply.
 * ==================================================================== */

/** B-0963 — the as-is spellings of the second case the reader tolerates. */
export const SPELLINGS_OF_THE_SECOND_CASE = ["REAL-GAP", "REAL_GAP", "REAL GAP"] as const;

/** B-0963 — nothing at the phase gate reads the case. */
export const THE_PHASE_GATE_READS_THE_CASE = false as const;

/** The leading mark-up the reader of the case steps over (B-0963). */
const LEADING_MARKUP = /^[\s>*#`_-]+/;

/**
 * F101-FR-022 — the case, read from the FIRST NON-EMPTY line of the reply,
 * tolerant of leading mark-up, of case and of the as-is spellings of the second
 * case. Anything else is the case `unknown`, which is the unknown-value rule of
 * row 252 of annex X §X.6.
 */
export function caseOfTheReply(reply: string | null | undefined): DiagnosisCase {
  for (const raw of (reply ?? "").split(/\r\n|\n|\r/)) {
    const line = raw.replace(LEADING_MARKUP, "").trim();
    if (line === "") continue;
    const upper = line.toUpperCase();
    if (/^CASE\s*:?\s*GROUNDING\b/.test(upper)) return "grounding";
    for (const spelling of SPELLINGS_OF_THE_SECOND_CASE) {
      if (new RegExp(`^CASE\\s*:?\\s*${spelling.replace(/[-_ ]/, "[-_ ]")}\\b`).test(upper)) {
        return "real_gap";
      }
    }
    // The first non-empty line decides; a line that names neither case is
    // `unknown`, and no later line is read (B-0963).
    return diagnosisCaseOrDefault(upper);
  }
  return "unknown";
}

/* ==================================================================== *
 * F101-FR-023 — the hint.
 * ==================================================================== */

/** B-0869 — the as-is heading of the hint. */
export function hintHeading(phase: number, ordinal: number): string {
  return `# Phase ${phase} — diagnostician hint (attempt ${ordinal})`;
}

/** F101-FR-023 — the as-is notice of THREE lines that the hint is no verdict. */
export const HINT_NOTICE = Object.freeze([
  "> This is not a critic verdict and approves nothing.",
  "> It is one reading of why the last attempt was rejected.",
  "> The verdict of the phase comes from the critic alone.",
]);

/** B-0869 — the as-is text for a reply of no bytes. */
export const EMPTY_REPLY = "(empty diagnostician reply)" as const;

/** B-0894 — the as-is word the call reports when the hint was written. */
export const HINT_WRITTEN = hintWritten();

/**
 * F101-FR-023 — the hint as a record of the phase attempt: the as-is heading
 * with the phase and the ordinal, the notice of three lines, and the reply AS
 * IT WAS, or the as-is text for an empty reply.
 */
export function hintOfTheDiagnostician(inputs: {
  readonly phase: number;
  readonly ordinal: number;
  readonly reply: string;
}): string {
  const body = inputs.reply.length === 0 ? EMPTY_REPLY : inputs.reply;
  return `${[hintHeading(inputs.phase, inputs.ordinal), "", ...HINT_NOTICE, "", body].join("\n")}\n`;
}

/* ==================================================================== *
 * The call, end to end.
 * ==================================================================== */

/** One call of the diagnostician, as the harness port receives it. */
export type DiagnosticianRequest = {
  /** Always this role; never the proposer's (B-0071). */
  readonly role: typeof ROLE;
  readonly prompt: string;
  /** The fresh session of this call. */
  readonly sessionId: string;
  readonly form: CompletionForm;
  /** No tool at all, or the read-only tools of the second form. */
  readonly tools: readonly string[];
  readonly model: string | null;
  /** The time limit of a critic call, in seconds (B-0047). */
  readonly timeLimitSeconds: number;
  /** The withheld paths of §C.4, for the second form. */
  readonly withheldPaths?: readonly string[] | undefined;
};

/** `complete` of the harness port, for this one call. */
export type DiagnosticianCall = (
  request: DiagnosticianRequest,
) => Promise<Pick<CompletionCallFacts, "reply" | "model">>;

/** What one diagnosis is told. */
export type DiagnosisInputs = {
  readonly phase: number;
  /** The ordinal of the phase attempt that was just rejected. */
  readonly ordinal: number;
  /** The signature of unmet criteria of the feedback that opened it. */
  readonly signature: string;
  /** Whether feedback of the phase exists at all (F101-FR-021). */
  readonly feedbackExists: boolean;
  /** The configured value of the switch of the diagnostician (B-0070). */
  readonly diagnosticianSwitch?: string | undefined;
  readonly markers: RecoveryMarkers;
  readonly entry: DiagnosticianRolePlanEntry;
  /** The facts of the form, as the harness adapter reports them beforehand. */
  readonly formFacts: FormFactsBeforeTheCall;
  readonly sessionIdsOfThePasses: readonly string[];
  readonly modelsThatProducedPasses: readonly (string | null | undefined)[];
  readonly providersThatProducedPasses?: readonly (string | null | undefined)[] | undefined;
  /** True under the `parity` profile. */
  readonly underParity?: boolean | undefined;
  /** Whether the checks before the call passed (B-1003). */
  readonly checksBeforeTheCallPassed?: boolean | undefined;
  readonly prompt: DiagnosticianPromptInputs;
  /** The withheld paths of §C.4 the call is given for the second form. */
  readonly withheldPaths?: readonly string[] | undefined;
};

/** The ports one diagnosis calls. */
export type DiagnosisDependencies = {
  /** The one call. */
  readonly call: DiagnosticianCall;
  /** The move of the proposer's files, for the second form (F100-FR-088). */
  readonly proposerFiles?: ProposerFilesPort | undefined;
  /** Write the hint; a failed write only warns (B-0967). */
  readonly writeHint: (text: string) => void;
  /** Write the markers back, after EVERY call (B-0173). */
  readonly writeMarkers: (markers: RecoveryMarkers) => void;
  /** Emit one as-is event of the diagnostician. */
  readonly emit: (name: string, data: Readonly<Record<string, unknown>>) => void;
  /** Write a line of the engine log. */
  readonly writeLine: (line: string) => void;
  /** Write a warning line, which is no as-is line of the run. */
  readonly warn?: ((line: string) => void) | undefined;
  /** The ingress of feature 100; every outside text passes it (F101-FR-052). */
  readonly ingress?: Ingress | undefined;
  /** The framing of outside text, outside the `as-is` block set. */
  readonly framing?: OutsideTextFraming | undefined;
  /** Record the diversity of the call and its warning (data-model.md). */
  readonly recordTheCall?:
    | ((record: {
        readonly proof: CriticProofResult;
        readonly diversity: DiversityResult;
        readonly warning: boolean;
        readonly form: CompletionForm;
        readonly tools: readonly string[];
        readonly sessionId: string;
        readonly harness: string;
        readonly provider: string;
        readonly model: string | null;
        readonly withheld: readonly MovedEntry[];
      }) => void)
    | undefined;
};

/** What one diagnosis leaves behind. */
export type DiagnosisOutcome = {
  /** Whether a diagnosis was due at all (F101-FR-021). */
  readonly due: boolean;
  /** Whether the one call was made. */
  readonly called: boolean;
  /** The proof of the form, recorded for the call (F100-FR-087). */
  readonly proof: CriticProofResult | undefined;
  readonly diversity: DiversityResult | undefined;
  readonly warningRaised: boolean;
  /** The case read from the reply; `undefined` where no reply came. */
  readonly case: DiagnosisCase | undefined;
  /** The hint, where one was written. */
  readonly hint: string | undefined;
  readonly hintWasWritten: boolean;
  /** What failed, where something did. A failure only warns (B-0967). */
  readonly failure: string | undefined;
  /** B-0866 — always 0. */
  readonly resultCode: typeof RESULT_CODE;
  /** The markers as they now stand (B-0173). */
  readonly markers: RecoveryMarkers;
  /** The files that were moved out of the working tree and back. */
  readonly withheld: readonly MovedEntry[];
};

/**
 * F101-FR-020 to F101-FR-023 — run ONE diagnosis, in the order of the module
 * header. The function never throws: every failure it can meet becomes a
 * warning and the result code stays 0 (B-0866, B-0967).
 */
export async function runTheDiagnostician(
  inputs: DiagnosisInputs,
  deps: DiagnosisDependencies,
): Promise<DiagnosisOutcome> {
  const underParity = inputs.underParity === true;
  const markersAfter = (): RecoveryMarkers => {
    // B-0173 — the signature is recorded after EVERY call, whether or not the
    // call succeeded or wrote a hint.
    const next = markersAfterADiagnosis(inputs.markers, inputs.signature);
    deps.writeMarkers(next);
    return next;
  };
  const warn = (message: string): void => {
    const text =
      deps.ingress === undefined ? message : deps.ingress.enter(message, "harness-warning").text;
    (deps.warn ?? deps.writeLine)(warning(text));
  };

  // 1 — the rule of F101-FR-021.
  const due = aDiagnosisIsDue({
    enabled: theDiagnosticianIsEnabled(inputs.diagnosticianSwitch),
    feedbackExists: inputs.feedbackExists,
    signature: inputs.signature,
    markers: inputs.markers,
  });
  if (!due) {
    return Object.freeze({
      due: false,
      called: false,
      proof: undefined,
      diversity: undefined,
      warningRaised: false,
      case: undefined,
      hint: undefined,
      hintWasWritten: false,
      failure: undefined,
      resultCode: RESULT_CODE,
      markers: inputs.markers,
      withheld: Object.freeze([]),
    });
  }

  // The as-is trigger event and the as-is line (F101-FR-021, B-0089, B-0206).
  deps.emit(AS_IS_EVENTS.trigger.name, { phase: inputs.phase, attempt: inputs.ordinal });
  deps.writeLine(diagnosticianStartLine(inputs.phase, inputs.ordinal));

  // 2 — the checks before the call (B-1003).
  if (inputs.checksBeforeTheCallPassed === false) {
    warn("the checks before the call of the diagnostician did not pass; no call was made");
    return Object.freeze({
      due: true,
      called: false,
      proof: undefined,
      diversity: undefined,
      warningRaised: false,
      case: undefined,
      hint: undefined,
      hintWasWritten: false,
      failure: "the checks before the call",
      resultCode: RESULT_CODE,
      markers: markersAfter(),
      withheld: Object.freeze([]),
    });
  }

  // 3 — the proof of the form, made BEFORE the call and recorded for it.
  const proof = proofOfTheDiagnosticianCall({
    entry: inputs.entry,
    facts: inputs.formFacts,
    sessionIdsOfThePasses: inputs.sessionIdsOfThePasses,
    underParity,
  });
  const tools = toolsOfTheCall(inputs.entry.form, inputs.entry.readOnlyTools);

  // 4 — the critic-diversity test. It is recorded and never blocks the call.
  const diversity = diversityOfTheDiagnostician({
    model: inputs.entry.model,
    provider: inputs.entry.provider,
    modelsThatProducedPasses: inputs.modelsThatProducedPasses,
    providersThatProducedPasses: inputs.providersThatProducedPasses,
  });
  if (diversity.warning && theWarningLineIsPrinted(underParity)) {
    (deps.warn ?? deps.writeLine)(diversityWarningLine(diversity.result));
  }
  deps.recordTheCall?.({
    proof,
    diversity: diversity.result,
    warning: diversity.warning,
    form: inputs.entry.form,
    tools,
    sessionId: inputs.formFacts.sessionId,
    harness: inputs.entry.harness,
    provider: inputs.entry.provider,
    model: inputs.entry.model,
    withheld: Object.freeze([]),
  });

  if (!theCallMayBeMade(proof)) {
    // F101-FR-020 — a proof that is missing or fails means NO CALL: it is a
    // failure of the diagnostician, which only warns, and no hint is written.
    warn(
      `the diagnostician was not called: ${FAILURE_WHEN_THE_PROOF_REFUSES} ` +
        `(${proof.outcome}${proof.failure === undefined ? "" : `, ${proof.failure}`})`,
    );
    return Object.freeze({
      due: true,
      called: false,
      proof,
      diversity: diversity.result,
      warningRaised: diversity.warning,
      case: undefined,
      hint: undefined,
      hintWasWritten: false,
      failure: FAILURE_WHEN_THE_PROOF_REFUSES,
      resultCode: RESULT_CODE,
      markers: markersAfter(),
      withheld: Object.freeze([]),
    });
  }

  // 5 — the proposer's files out of the working tree, for the second form.
  let withheld: readonly MovedEntry[] = Object.freeze([]);
  if (theProposersFilesAreHiddenFor(inputs.entry.form) && deps.proposerFiles !== undefined) {
    withheld = await deps.proposerFiles.moveOut();
  }

  // The prompt, and the as-is start event with the provider (B-0851).
  const prompt = diagnosticianPrompt(inputs.prompt, deps.framing);
  deps.emit(AS_IS_EVENTS.start.name, {
    phase: inputs.phase,
    attempt: inputs.ordinal,
    provider: inputs.entry.provider,
  });

  let reply: string | undefined;
  let failure: string | undefined;
  try {
    // 6 — the ONE call.
    const facts = await deps.call({
      role: ROLE,
      prompt: prompt.text,
      sessionId: inputs.formFacts.sessionId,
      form: inputs.entry.form,
      tools,
      model: inputs.entry.model,
      timeLimitSeconds: TIME_LIMIT_SECONDS,
      ...(inputs.withheldPaths === undefined ? {} : { withheldPaths: inputs.withheldPaths }),
    });
    reply = facts.reply ?? "";
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    // 7 — and back, however the call ended.
    if (withheld.length > 0 && deps.proposerFiles !== undefined) {
      await deps.proposerFiles.moveBack(withheld);
    }
  }

  if (failure !== undefined) {
    // B-0852 — the as-is error event; after it NO hint is written. The message
    // comes from outside the runtime, so it passes the one ingress first.
    const message =
      deps.ingress === undefined ? failure : deps.ingress.enter(failure, "harness-error").text;
    deps.emit(AS_IS_EVENTS.error.name, {
      phase: inputs.phase,
      attempt: inputs.ordinal,
      error: message,
    });
    warn(`the call of the diagnostician failed: ${failure}`);
    return Object.freeze({
      due: true,
      called: true,
      proof,
      diversity: diversity.result,
      warningRaised: diversity.warning,
      case: undefined,
      hint: undefined,
      hintWasWritten: false,
      failure,
      resultCode: RESULT_CODE,
      markers: markersAfter(),
      withheld,
    });
  }

  // 8 — the case, the hint, the as-is end event.
  const text = reply ?? "";
  const theCase = caseOfTheReply(text);
  const hint = hintOfTheDiagnostician({
    phase: inputs.phase,
    ordinal: inputs.ordinal,
    reply: text,
  });
  let hintWasWritten = false;
  let writeFailure: string | undefined;
  try {
    deps.writeHint(hint);
    hintWasWritten = true;
  } catch (error) {
    // B-0967 — a failed write of the hint only warns.
    writeFailure = error instanceof Error ? error.message : String(error);
    warn(`the hint of the diagnostician could not be written: ${writeFailure}`);
  }
  deps.emit(AS_IS_EVENTS.done.name, {
    phase: inputs.phase,
    attempt: inputs.ordinal,
    bytes: Buffer.byteLength(text, "utf8"),
    case: theCase,
  });
  if (hintWasWritten) deps.writeLine(HINT_WRITTEN);

  return Object.freeze({
    due: true,
    called: true,
    proof,
    diversity: diversity.result,
    warningRaised: diversity.warning,
    case: theCase,
    hint,
    hintWasWritten,
    failure: writeFailure,
    resultCode: RESULT_CODE,
    markers: markersAfter(),
    withheld,
  });
}

/** The two forms, as this module names them for a reader of a test. */
export { FIRST_FORM, SECOND_FORM };
