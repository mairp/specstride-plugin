/**
 * T018 of feature 101 — the as-is lines of the phase gate for compatibility
 * output (F101-FR-039).
 *
 * In compatibility output the engine writes the lines of the table "As-is lines
 * of the phase gate" of the spec to the engine log, BYTE FOR BYTE. Every line
 * is a function of its values here, so that the bytes stand in one place and
 * the parity oracle compares one thing.
 *
 * Two rules of F101-FR-039 are carried out in this module:
 *
 *  - a warning or a fatal message of a critic-class call carries the LOGICAL
 *    component name `critic` where the baseline names the implementation file
 *    (`warning` and `fatal` below, B-0883);
 *  - under the `parity` profile this feature prints NO line that has no as-is
 *    equivalent — `AS_IS_LINE_IDS` is the whole of what may be printed, and
 *    `hasAnAsIsEquivalent` is the check.
 *
 * T112 adds the THIRD rule, which is F101-FR-052: text that a critic-class call
 * brings from outside the runtime passes the ONE INGRESS of feature 100
 * (F100-FR-009) before any part of it reaches a line of the engine log, the halt
 * banner, a field of an event or a span. The port of that ingress and the one
 * helper that calls it (`Ingress`, `throughTheIngress`) stand at the foot of
 * this module, and `./events.ts` and `./halts.ts` call them from here, so the
 * product has exactly one place at which this feature hands outside text over
 * and exactly one mark that stands in its place when the redactor cannot run.
 * This feature holds NO redaction of its own (`THIS_FEATURE_REDACTS`).
 *
 * Paths in these lines are compared through the layout table (rule N-02) and
 * times through rule N-04; this module writes the value it is handed and does
 * no normalization of its own, so the oracle's rules stay the oracle's.
 */
import { MARK_WHEN_THE_REDACTOR_CANNOT_RUN } from "@specstride/contracts/ep/event-sink";

/** F101-FR-039 — the lines go to the engine log, byte for byte. */
export const BYTE_FOR_BYTE = true as const;

/** F101-FR-039 — the logical component name a critic-class message carries (B-0883). */
export const CRITIC_COMPONENT = "critic" as const;

/** Under the `parity` profile this feature prints a line with no as-is equivalent. */
export const PRINTS_A_LINE_WITHOUT_AN_AS_IS_EQUIVALENT_UNDER_PARITY = false as const;

/** Paths are compared through the layout table; times through rule N-04. */
export const NORMALIZATION_RULES = Object.freeze({ paths: "N-02", times: "N-04" });

/* ------------------------------------------------------------------ *
 * The lines, in the order of the table.
 * ------------------------------------------------------------------ */

/** `# All phases already approved. Nothing to do.` (B-0204). */
export function allPhasesAlreadyApproved(): string {
  return "# All phases already approved. Nothing to do.";
}

/** `===== PHASE <N> — <title>  (<time>) =====` (B-0208). Two blanks before the time. */
export function phaseStart(phase: number, title: string, time: string): string {
  return `===== PHASE ${phase} — ${title}  (${time}) =====`;
}

/** `----- critic: phase <N> attempt <M> (<critic>) -----` (B-0223). */
export function criticStart(phase: number, attempt: number, critic: string): string {
  return `----- critic: phase ${phase} attempt ${attempt} (${critic}) -----`;
}

/** `===== PHASE <N> APPROVED (attempt <M>) =====` (B-0224). */
export function phaseApproved(phase: number, attempt: number): string {
  return `===== PHASE ${phase} APPROVED (attempt ${attempt}) =====`;
}

/** The six blanks every ticking line of B-0225 begins with. */
const TICK_INDENT = "      ";

/** `      ticked <n> task checkbox(es) of phase <N> in <spec>` (B-0225). */
export function tasksTicked(count: number, phase: number, spec: string): string {
  return `${TICK_INDENT}ticked ${count} task checkbox(es) of phase ${phase} in ${spec}`;
}

/**
 * `      WARN: could not tick phase <N> task checkboxes in <spec> (approval stands)`
 * (B-0225). The approval stands: a failed tick never undoes an approval.
 */
export function tasksNotTicked(phase: number, spec: string): string {
  return (
    `${TICK_INDENT}WARN: could not tick phase ${phase} task checkboxes in ${spec} ` +
    `(approval stands)`
  );
}

/** `----- git checkpoint: phase <N> approved -----` (B-0205). */
export function gitCheckpoint(phase: number): string {
  return `----- git checkpoint: phase ${phase} approved -----`;
}

/** `>>> critic config/usage error (exit 3) — halting.` (B-0226). */
export function criticConfigError(): string {
  return ">>> critic config/usage error (exit 3) — halting.";
}

/** `----- phase <N> REJECTED on attempt <M>/<L> -----` (B-0227). `<L>` is the reject limit. */
export function phaseRejected(phase: number, attempt: number, limit: number): string {
  return `----- phase ${phase} REJECTED on attempt ${attempt}/${limit} -----`;
}

/** `>>> critic returned no usable verdict (MALFORMED <streak>/<limit>)` (B-0228). */
export function criticNoUsableVerdict(streak: number, limit: number): string {
  return `>>> critic returned no usable verdict (MALFORMED ${streak}/${limit})`;
}

/** `----- diagnostician: phase <N> attempt <M> (unmet set changed) -----` (B-0206). */
export function diagnosticianStart(phase: number, attempt: number): string {
  return `----- diagnostician: phase ${phase} attempt ${attempt} (unmet set changed) -----`;
}

/**
 * `----- accelerator: phase <N> attempt <M>/<L> (<harness>) — acting on the hint for <criteria> -----`
 * (B-0211).
 */
export function acceleratorStart(
  phase: number,
  attempt: number,
  limit: number,
  harness: string,
  criteria: string,
): string {
  return (
    `----- accelerator: phase ${phase} attempt ${attempt}/${limit} (${harness}) — ` +
    `acting on the hint for ${criteria} -----`
  );
}

/** `# DONE — all <n> phase(s) approved. <time>` (B-0232). */
export function done(phases: number, time: string): string {
  return `# DONE — all ${phases} phase(s) approved. ${time}`;
}

/** `APPROVED`, `REJECTED` or `MALFORMED`, as the one word of the critic call (B-0900, B-0901). */
export function theOneWordOfTheCriticCall(verdict: "APPROVED" | "REJECTED" | "MALFORMED"): string {
  return verdict;
}

/** `HINT-WRITTEN` (B-0894). */
export function hintWritten(): string {
  return "HINT-WRITTEN";
}

/** The markers of the file dump of the diagnostician (B-0893). */
export const FILE_DUMP_MARKERS = Object.freeze({
  begin: (path: string): string => `----- BEGIN ${path} -----`,
  end: (path: string): string => `----- END ${path} -----`,
});

/**
 * A warning of a critic-class call. It carries the LOGICAL component name
 * `critic` where the baseline names the implementation file (F101-FR-039,
 * B-0883).
 */
export function warning(message: string): string {
  return `${CRITIC_COMPONENT}: WARN: ${message}`;
}

/** A fatal message of a critic-class call, with the same logical component name. */
export function fatal(message: string): string {
  return `${CRITIC_COMPONENT}: FATAL: ${message}`;
}

/* ------------------------------------------------------------------ *
 * The halt banner of B-0231.
 * ------------------------------------------------------------------ */

/** The frame of the halt banner: a line of `#` (B-0231). */
export const BANNER_FRAME = "#".repeat(78);

/** The sections of the halt banner, in the order B-0231 gives them. */
export const BANNER_SECTIONS = [
  "latest evidence",
  "latest feedback",
  "diagnostician hint",
  "acceleration note",
  "attempt history",
  "rejection trail:",
] as const;

/** The two sections of the banner that are optional (B-0231). */
export const OPTIONAL_BANNER_SECTIONS = ["diagnostician hint", "acceleration note"] as const;

/** What the halt banner is handed. */
export type HaltBannerInputs = {
  readonly phase: number;
  /** The reject limit the phase exceeded. */
  readonly maxRejects: number;
  readonly latestEvidence: string;
  readonly latestFeedback: string;
  /** Absent where no diagnosis ran. */
  readonly diagnosticianHint?: string | undefined;
  /** Absent where no accelerated phase attempt ran. */
  readonly accelerationNote?: string | undefined;
  readonly attemptHistory: string;
  readonly rejectionTrail: readonly string[];
};

/** The first line of the halt banner (B-0231). */
export function haltBannerHeading(phase: number, maxRejects: number): string {
  return `# HALT — phase ${phase} exceeded MAX_REJECTS (${maxRejects}). Human needed.`;
}

/**
 * The halt banner of B-0231, framed by lines of `#`: the heading, `latest
 * evidence`, `latest feedback`, the OPTIONAL `diagnostician hint` and
 * `acceleration note`, `attempt history`, and `rejection trail:`.
 */
export function haltBanner(inputs: HaltBannerInputs): readonly string[] {
  const out: string[] = [BANNER_FRAME, haltBannerHeading(inputs.phase, inputs.maxRejects)];
  out.push(`latest evidence: ${inputs.latestEvidence}`);
  out.push(`latest feedback: ${inputs.latestFeedback}`);
  if (inputs.diagnosticianHint !== undefined) {
    out.push(`diagnostician hint: ${inputs.diagnosticianHint}`);
  }
  if (inputs.accelerationNote !== undefined) {
    out.push(`acceleration note: ${inputs.accelerationNote}`);
  }
  out.push(`attempt history: ${inputs.attemptHistory}`);
  out.push("rejection trail:");
  for (const entry of inputs.rejectionTrail) out.push(entry);
  out.push(BANNER_FRAME);
  return out;
}

/* ------------------------------------------------------------------ *
 * The whole table, as data.
 * ------------------------------------------------------------------ */

/** The identifier of each line of the table, with its behaviour item. */
export const AS_IS_LINES = Object.freeze([
  { id: "all-phases-already-approved", item: "B-0204", when: "Every phase was approved before" },
  { id: "phase-start", item: "B-0208", when: "A phase starts" },
  { id: "critic-start", item: "B-0223", when: "Before a critic call" },
  { id: "phase-approved", item: "B-0224", when: "An approval" },
  { id: "tasks-ticked", item: "B-0225", when: "After ticking" },
  { id: "tasks-not-ticked", item: "B-0225", when: "After ticking, where it failed" },
  { id: "git-checkpoint", item: "B-0205", when: "The approval commit" },
  { id: "critic-config-error", item: "B-0226", when: "A configuration error of the critic" },
  { id: "phase-rejected", item: "B-0227", when: "A rejection" },
  {
    id: "critic-no-usable-verdict",
    item: "B-0228",
    when: "A MALFORMED verdict while the limit is on",
  },
  { id: "diagnostician-start", item: "B-0206", when: "The diagnostician is due" },
  { id: "accelerator-start", item: "B-0211", when: "An accelerated phase attempt starts" },
  { id: "halt-banner", item: "B-0231", when: "The reject limit was reached" },
  { id: "done", item: "B-0232", when: "The run ends approved" },
  { id: "the-one-word-of-the-critic-call", item: "B-0900, B-0901", when: "After a critic call" },
  { id: "hint-written", item: "B-0894", when: "The hint was written" },
  { id: "file-dump-markers", item: "B-0893", when: "In the prompt of the diagnostician" },
  { id: "critic-warning-or-fatal", item: "B-0883", when: "A critic-class call warns or fails" },
]);

/** The identifiers of the table: the whole of what this feature may print. */
export const AS_IS_LINE_IDS = Object.freeze(AS_IS_LINES.map((row) => row.id));

/** The count of lines the table holds. */
export const AS_IS_LINE_COUNT = AS_IS_LINES.length;

/**
 * F101-FR-039 — whether a line of this feature has an as-is equivalent. Under
 * the `parity` profile a line without one is never printed.
 */
export function hasAnAsIsEquivalent(id: string): boolean {
  return (AS_IS_LINE_IDS as readonly string[]).includes(id);
}

/* ==================================================================== *
 * T112 — F101-FR-052: the ONE ingress of feature 100 (F100-FR-009),
 * through which every text a critic-class call brings from outside the
 * runtime passes before this feature writes any part of it.
 *
 * The three texts the requirement names are the reply of the critic, the
 * reply of the diagnostician, and the message of an error or a warning of
 * the harness. The four places they may reach are a line of the engine
 * log, the halt banner, a field of an event (the `reason` of a verdict,
 * the `error` of the diagnostician) and a span.
 *
 * Where the redactor CANNOT run, the text is DROPPED from the line or the
 * field and the mark of dropped content stands in its place
 * (F100-FR-205), and the verdict and the counts do not change: nothing in
 * this module reads a verdict or a count, which is what makes that last
 * promise structural and not a claim.
 * ==================================================================== */

/** F101-FR-052 — the requirement of feature 100 that owns the one ingress. */
export const INGRESS_REQUIREMENT_OF_FEATURE_100 = "F100-FR-009" as const;

/** F101-FR-052 — this feature holds no redaction of its own. */
export const THIS_FEATURE_REDACTS = false as const;

/**
 * F101-FR-052 — the texts a critic-class call brings from outside the runtime,
 * in the order the requirement names them.
 */
export const OUTSIDE_TEXT_KINDS = [
  "critic-reply",
  "diagnostician-reply",
  "harness-error",
  "harness-warning",
] as const;
export type OutsideTextKind = (typeof OUTSIDE_TEXT_KINDS)[number];

/** F101-FR-052 — the four places such a text may reach, each through the ingress. */
export const PLACES_THAT_NEED_THE_INGRESS = [
  "the engine log",
  "the halt banner",
  "a field of an event",
  "a span",
] as const;

/**
 * F100-FR-205 — the mark that stands in the place of content the redactor
 * could not redact. The literal belongs to feature 100; it is imported and
 * never written here.
 */
export const MARK_OF_DROPPED_CONTENT = MARK_WHEN_THE_REDACTOR_CANNOT_RUN;

/** What the one ingress gives back for one text (annex X §X.4, F100-FR-205). */
export type IngressResult = {
  /** The redacted, cut text; empty where the content was dropped. */
  readonly text: string;
  /** True where the redactor could not run and the content was dropped. */
  readonly dropped?: boolean | undefined;
  /** The member of the closed set of marks of dropped content, where one is given. */
  readonly mark?: string | undefined;
};

/**
 * The one ingress of feature 100 (F100-FR-009), as this feature calls it. The
 * composition root hands it in; a core package implements no redactor and owns
 * no pattern set.
 */
export type Ingress = {
  /** Hand one outside text over. Nothing of it is written before this returns. */
  enter(text: string, kind: OutsideTextKind): IngressResult;
};

/**
 * F101-FR-052 — pass one outside text through the one ingress and give back
 * what may be written.
 *
 * Where the redactor could not run the text is DROPPED and the mark of dropped
 * content stands in its place; where the ingress itself throws, the same mark
 * stands, because a failure of the ingress may never let unredacted text
 * through. Nothing of the verdict and nothing of the counts is touched on
 * either path.
 */
export function throughTheIngress(ingress: Ingress, text: string, kind: OutsideTextKind): string {
  let result: IngressResult;
  try {
    result = ingress.enter(text, kind);
  } catch {
    return MARK_OF_DROPPED_CONTENT;
  }
  if (result.dropped === true) return result.mark ?? MARK_OF_DROPPED_CONTENT;
  return result.text;
}

/** True when what stands in a line or a field is the mark and not the text. */
export function isTheMarkOfDroppedContent(value: string): boolean {
  return value === MARK_OF_DROPPED_CONTENT;
}

/**
 * F101-FR-039 and F101-FR-052 — a warning of a critic-class call, with its
 * message passed through the one ingress FIRST. `warning` above forms the
 * bytes; this is the only form a caller that holds a message of the harness
 * may use, because that message comes from outside the runtime.
 */
export function warningThroughTheIngress(ingress: Ingress, message: string): string {
  return warning(throughTheIngress(ingress, message, "harness-warning"));
}

/** The same for a fatal message of a critic-class call (F101-FR-039, F101-FR-052). */
export function fatalThroughTheIngress(ingress: Ingress, message: string): string {
  return fatal(throughTheIngress(ingress, message, "harness-error"));
}

/**
 * F101-FR-052 — the sections of the halt banner that carry text of a
 * critic-class call and therefore pass the one ingress: the feedback (the
 * reply of the critic), the hint (the reply of the diagnostician), the
 * acceleration note, and the gist lines of the rejection trail, which are read
 * out of feedback.
 *
 * `attempt history` holds ordinals and verdict kinds the runtime itself wrote.
 * `latest evidence` is the proposer's own text, which F101-FR-052 does not
 * name; `halts.ts` passes it through the ingress all the same, as the plainer
 * path for a text that reaches the engine log from outside the runtime.
 */
export const BANNER_SECTIONS_THAT_NEED_THE_INGRESS = [
  "latest feedback",
  "diagnostician hint",
  "acceleration note",
  "rejection trail:",
] as const;
