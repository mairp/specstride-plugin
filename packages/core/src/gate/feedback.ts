/**
 * T014 of feature 101 — the signature, the gist and the reason of a feedback
 * (F101-FR-019, F101-FR-012).
 *
 * The three are what the loop reads out of a critic's own text:
 *
 *  - the SIGNATURE of unmet criteria drives the recovery cycle (one diagnosis
 *    per signature) and the oscillation halt (a criterion that reappears);
 *  - the GIST is the one line a person sees in the timeline;
 *  - the REASON is the as-is field `reason` of the event `verdict`.
 *
 * The hash of a signature without task ids comes from the canonical hasher of
 * feature 100 (`@specstride/kernel/hasher`, F104-FR-027): no feature hashes for
 * itself, and the hash must equal the baseline's on the same input.
 *
 * Every verdict line is removed before the hash is taken, so that the nonce of
 * a call cannot make equal feedback look new — without that, a run could never
 * find an oscillation, because every feedback would carry a fresh 64 bits.
 *
 * ## Why this module holds NO task-line grammar
 *
 * F104-SC-001 states that no package of the product parses a phase heading or a
 * task line outside the ONE package that owns the grammar of a specification,
 * and the kernel's hasher is the single named exception. A pattern such as
 * `\bT\d+[A-Za-z]?\b` written here would be a second reader of the task-line
 * grammar in the product, and the static check of that owner reports it as a
 * breach — correctly: a core package may not import the owner either, since the
 * core may import `@specstride/contracts` and `@specstride/kernel` and nothing
 * else (`packages/contracts/data/package-graph.json`, row `@specstride/core`).
 *
 * So the task ids are not DISCOVERED here, they are RECOGNISED here. The caller
 * hands in the ids the grammar owner already parsed — `SpecTask.id` of the
 * canonical spec model of annex C §C.7, which `SpecFormatPort.parse` produced —
 * and this module looks for those exact ids as whole tokens in the feedback. The
 * form of an id stays in one place, and the signature is still "the sorted list,
 * without repeats, of the task ids in the as-is form found in the feedback"
 * (F101-FR-019).
 *
 * For the as-is reading of the baseline, which greps the feedback for the form
 * itself and so also sees an id of ANOTHER phase, the caller may hand in
 * `findTaskIds`: the reader of the one grammar owner, wired by the composition
 * root. Its TYPE is declared here; its grammar is not.
 */
import { contentHash } from "@specstride/kernel/hasher";

/* ------------------------------------------------------------------ *
 * The as-is texts of a feedback (contracts/as-is-literals.md).
 * ------------------------------------------------------------------ */

/** The as-is heading of a feedback (B-0879). */
export function feedbackHeading(phase: number, result: "REJECTED" | "MALFORMED"): string {
  return `# Phase ${phase} — critic feedback (${result})`;
}

/** The as-is lead line of a feedback (B-0881). */
export function feedbackLead(phase: number): string {
  return `The following must be addressed before re-writing GATE${phase}-EVIDENCE.md:`;
}

/** The as-is text for a reply of no bytes (B-0881). */
export const EMPTY_REPLY = "(no critic output)" as const;

/* ------------------------------------------------------------------ *
 * F101-FR-019 — the signature of unmet criteria.
 * ------------------------------------------------------------------ */

/**
 * The reader of task ids of the ONE grammar owner, as this module needs it: it
 * is handed a text and gives back every task id in the as-is form that stands in
 * it. The TYPE is declared here; the grammar belongs to its one owner, and the
 * composition root wires the function (F104-SC-001).
 */
export type FindTaskIds = (text: string) => readonly string[];

/** What `signatureOfUnmetCriteria` is given besides the feedback. */
export type TaskIdSource = {
  /**
   * The ids the grammar owner parsed for this phase: `SpecTask.id` of the
   * canonical spec model (annex C §C.7). An id of this list that stands in the
   * feedback as a whole token is a task id of the signature.
   */
  readonly knownTaskIds?: readonly string[] | undefined;
  /**
   * The reader of the one grammar owner, for the as-is reading that also sees an
   * id of another phase. Where it is given it decides, and `knownTaskIds` is not
   * consulted.
   */
  readonly findTaskIds?: FindTaskIds | undefined;
};

/** The separator of the signature: a comma, as at the baseline (F101-FR-019). */
export const SIGNATURE_SEPARATOR = "," as const;

/** The marker of a signature that holds no task id (F101-FR-019). */
export const TEXT_SIGNATURE_PREFIX = "text:" as const;

/**
 * Any line in the form of a verdict, whatever nonce it carries. Removed before
 * the hash of a text signature is taken, so that the nonce of a call does not
 * make equal feedback look new (F101-FR-019).
 */
const VERDICT_LINE_ANY_NONCE = /^[^\S\n\r]*VERDICT\b.*$/gim;

/** The feedback with every verdict line removed (F101-FR-019). */
export function withoutVerdictLines(feedback: string): string {
  return feedback.replace(VERDICT_LINE_ANY_NONCE, "");
}

/**
 * Whether the id stands in the text as a WHOLE token: not as a part of a longer
 * id (`T01` inside `T012`) and not inside a word. The id itself comes from the
 * grammar owner, so this holds no grammar — it is a token comparison.
 */
export function idStandsInTheText(id: string, text: string): boolean {
  // An empty id stands nowhere. The guard is also what keeps the loop below
  // finite: `indexOf("", n)` past the end gives the LENGTH of the text and not
  // -1, so an empty needle would never end the search.
  if (id === "") return false;
  const isWordCharacter = (c: string | undefined): boolean =>
    c !== undefined && /[0-9A-Za-z_]/.test(c);
  let at = text.indexOf(id);
  while (at !== -1) {
    const before = at === 0 ? undefined : text[at - 1];
    const after = text[at + id.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    at = text.indexOf(id, at + 1);
  }
  return false;
}

/**
 * The task ids of a feedback: sorted, without repeats (F101-FR-019).
 *
 * The ids come from the one grammar owner — either as the parsed ids of the
 * phase (`knownTaskIds`), of which the ones standing in the feedback are taken,
 * or through its own reader (`findTaskIds`), which gives the as-is reading of the
 * baseline. With neither, there is no task id to be had and the signature falls
 * back to the hash of the text, which is the rule F101-FR-019 already gives for
 * feedback without a task id.
 */
export function taskIdsOf(feedback: string, source: TaskIdSource = {}): readonly string[] {
  if (source.findTaskIds !== undefined) {
    return [...new Set(source.findTaskIds(feedback))].sort();
  }
  const known = source.knownTaskIds ?? [];
  const found = new Set(known.filter((id) => id !== "" && idStandsInTheText(id, feedback)));
  return [...found].sort();
}

/**
 * F101-FR-019 — the signature of unmet criteria of a feedback.
 *
 * With task ids: the sorted list without repeats, joined with commas, as at the
 * baseline. Without a task id: the word `text:` and the hash of the feedback
 * from which every verdict line was removed. The hash comes from the canonical
 * hasher of feature 100 and equals the baseline's on the same input.
 *
 * For feedback without a task id the oscillation halt cannot fire (the edge
 * case of the spec, F101-FR-016): two such signatures are equal only when the
 * whole text is equal, so no single criterion can be seen to reappear.
 */
export function signatureOfUnmetCriteria(feedback: string, source: TaskIdSource = {}): string {
  const ids = taskIdsOf(feedback, source);
  if (ids.length > 0) return ids.join(SIGNATURE_SEPARATOR);
  return `${TEXT_SIGNATURE_PREFIX}${contentHash(withoutVerdictLines(feedback))}`;
}

/** True when the signature was formed from task ids and not from a hash. */
export function signatureHoldsTaskIds(signature: string): boolean {
  return !signature.startsWith(TEXT_SIGNATURE_PREFIX);
}

/**
 * The signature as the as-is field `criteria` of the event `accelerator_start`
 * carries it: the signature WITHOUT its last comma (B-0094, the note of
 * `contracts/as-is-literals.md`).
 */
export function criteriaOfAccelerationStart(signature: string): string {
  return signature.endsWith(SIGNATURE_SEPARATOR) ? signature.slice(0, -1) : signature;
}

/* ------------------------------------------------------------------ *
 * The unmet report — the form the critic is TOLD to write, and the
 * reader of it. The composition root reads the unmet set from this
 * form, so that a task the critic only names in prose — to say it
 * stands — never widens the set of criteria an accelerated attempt
 * retries (F101-FR-025 narrows to the UNMET ids, and the as-is
 * signature of F101-FR-019 sees every id in the text, met ones too).
 * ------------------------------------------------------------------ */

/**
 * The instruction the critic prompt carries: just before the verdict line,
 * one status line per task of the phase. The line is the form
 * `unmetTaskIdsOfTheReport` reads; a critic that writes it makes its unmet
 * set readable without guessing, and a critic that does not makes the engine
 * fall back to every task of the phase (which the composition root says in
 * an event).
 */
export function unmetReportInstruction(): string {
  return (
    "Just before the verdict line, write one status line per task of the phase, in exactly this form:" +
    " `<task id>: MET` for a task that is met, `<task id>: UNMET <one short reason>`" +
    " for a task that is not met. Write no other line in that form."
  );
}

/** The marks a status line may carry around the id and the word: lists and emphasis. */
const STATUS_LINE_MARKS = "(?:[-*+>][ \\t]*)?[*`]{0,2}";

/**
 * The status the feedback reports for ONE task id of the phase: `"unmet"`,
 * `"met"`, or `undefined` where no line of the form stands in the text.
 *
 * A status line begins with nothing but space and list or emphasis marks,
 * names the id, a colon, and then the word MET or UNMET as a whole word —
 * `T001: UNMET the test was not run`, `- **T002: Met.**`, `` `T003`: met ``.
 * A line that merely MENTIONS the id (`Since T001 is unmet, ...`) is not a
 * status line: it does not stand in the form. The id comes from the grammar
 * owner, so this holds no grammar (F104-SC-001).
 */
function statusOfTheTaskInTheReport(id: string, feedback: string): "met" | "unmet" | undefined {
  const pattern = new RegExp(
    `^[ \\t]*${STATUS_LINE_MARKS}[ \\t]*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[*\`]{0,2}[ \\t]*:[ \\t]*[*\`]{0,2}[ \\t]*(MET|UNMET)\\b`,
    "gim",
  );
  let status: "met" | "unmet" | undefined;
  for (const match of feedback.matchAll(pattern)) {
    // A task the critic reports unmet once is unmet; a later MET line of the
    // same id does not un-report it.
    if (match[1]?.toUpperCase() === "UNMET") return "unmet";
    status ??= "met";
  }
  return status;
}

/**
 * The task ids the feedback REPORTS UNMET, read from the status lines of the
 * form `unmetReportInstruction` teaches: sorted, without repeats.
 *
 * `undefined` where the form cannot be parsed — no status line stands in the
 * text at all, or none of them says UNMET. The caller decides the fallback
 * (the composition root takes every task of the phase and says so in an
 * event); this module invents no set of its own.
 */
export function unmetTaskIdsOfTheReport(
  feedback: string,
  source: TaskIdSource = {},
): readonly string[] | undefined {
  const known = source.knownTaskIds ?? [];
  const unmet: string[] = [];
  let aStatusLineStands = false;
  for (const id of known) {
    if (id === "") continue;
    const status = statusOfTheTaskInTheReport(id, feedback);
    if (status === undefined) continue;
    aStatusLineStands = true;
    if (status === "unmet") unmet.push(id);
  }
  if (!aStatusLineStands || unmet.length === 0) return undefined;
  return [...new Set(unmet)].sort();
}

/* ------------------------------------------------------------------ *
 * F101-FR-019 — the gist of a feedback.
 * ------------------------------------------------------------------ */

/** F101-FR-019 — the gist is cut to this many characters. */
export const GIST_MAX = 160 as const;

/** F101-FR-012 — the reason is cut to this many characters. */
export const REASON_MAX = 120 as const;

/**
 * The first choice of the gist: a line that says that something is not met,
 * not verified or not substantiated, without regard to case (F101-FR-019).
 */
const SAYS_UNMET = /\bnot\s+(met|verified|substantiated)\b/i;

/** The second choice: the first roster line of a failed or errored check. */
const ROSTER_FAILED_OR_ERRORED =
  /^[^\S\n\r]*[-*]?[^\S\n\r]*\S+[^\S\n\r]+(FAIL|FAILED|ERROR|ERRORED)\b/i;

/** A heading, a quotation, or the as-is lead line: none of them is the gist. */
function isNeitherHeadingNorQuotation(line: string, phase: number | undefined): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("#") || trimmed.startsWith(">")) return false;
  if (phase !== undefined && trimmed === feedbackLead(phase)) return false;
  // Without a phase the lead line is still recognised by its shape.
  if (/^The following must be addressed before re-writing GATE\d+-EVIDENCE\.md:$/.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * F101-FR-019 — the gist of a feedback: ONE line, chosen in this order.
 *
 *  1. the first line that says that something is not met, not verified or not
 *     substantiated, without regard to case;
 *  2. else the first roster line of a failed or errored check;
 *  3. else the first line that is no heading, no quotation and not the as-is
 *     line that says what must be addressed.
 *
 * Cut to 160 characters. An empty text has no gist: the result is the empty
 * text, never a line invented here.
 */
export function gistOf(feedback: string, phase?: number): string {
  const lines = feedback.split(/\r\n|\n|\r/);
  const pick = (test: (line: string) => boolean): string | undefined =>
    lines.find((line) => test(line));
  const chosen =
    pick((line) => SAYS_UNMET.test(line)) ??
    pick((line) => ROSTER_FAILED_OR_ERRORED.test(line)) ??
    pick((line) => isNeitherHeadingNorQuotation(line, phase));
  return (chosen ?? "").trim().slice(0, GIST_MAX);
}

/* ------------------------------------------------------------------ *
 * F101-FR-012 — the reason of a verdict that is not an approval.
 * ------------------------------------------------------------------ */

/** The leading list or heading marks the reason drops (F101-FR-012). */
const LEADING_MARKS = /^[-*#\s]+/;

/**
 * F101-FR-012 — the reason of a verdict that is not an approval: the first
 * non-empty line of the reply that is no verdict line, without leading list or
 * heading marks, cut to 120 characters; or the detail of the parse where no
 * such line exists.
 *
 * This is Lisa's `firstReasonLine` (`packages/core/src/critic/verdict.ts:258-264`
 * at `363e6a3`) with the fallback F101-FR-012 adds.
 */
export function reasonOf(reply: string | null | undefined, parseDetailText: string): string {
  for (const line of (reply ?? "").split(/\r\n|\n|\r/)) {
    const s = line.trim().replace(LEADING_MARKS, "").trim();
    if (s && !s.toUpperCase().startsWith("VERDICT")) return s.slice(0, REASON_MAX);
  }
  return parseDetailText;
}

/* ==================================================================== *
 * T042 — the feedback of the critic (F101-FR-012), and T039 — the
 * feedback the ENGINE writes after a failed verification gate
 * (F101-FR-005, F101-FR-013). Both are feedback of the phase attempt and
 * both replace earlier feedback of the phase; the second is "feedback like
 * any other", so it feeds the signature, the diagnostician and the
 * oscillation halt (F101-FR-017).
 * ==================================================================== */

/**
 * B-0880 — the quoted notice a MALFORMED feedback carries: the reply was
 * malformed, with the detail, and the phase is treated as REJECTED, which is
 * the safe failure.
 */
export function malformedNotice(detail: string): readonly string[] {
  return Object.freeze([
    `> The critic's reply was malformed (${detail}).`,
    "> The phase is treated as REJECTED, which is the safe failure.",
  ]);
}

/** F101-FR-012 — earlier feedback of the phase is REPLACED, never appended to. */
export const FEEDBACK_REPLACES_EARLIER_FEEDBACK = true as const;

/** F101-FR-012 — a failed write of the feedback is a warning only. */
export const A_FAILED_WRITE_OF_THE_FEEDBACK_IS_A_WARNING = true as const;

/**
 * F101-FR-012 — the feedback of a phase attempt the critic rejected.
 *
 * The order is the requirement's: the as-is heading with the verdict; for
 * MALFORMED the quoted notice with its detail; the as-is line that says what
 * must be addressed; then the reply of the critic AS IT WAS, or the as-is text
 * `(no critic output)` where it held no bytes.
 */
export function feedbackOfTheCritic(inputs: {
  readonly phase: number;
  readonly verdict: "REJECTED" | "MALFORMED";
  /** The as-is text of the detail of the parse; used for MALFORMED only. */
  readonly detailText?: string;
  readonly reply: string;
}): string {
  const lines: string[] = [feedbackHeading(inputs.phase, inputs.verdict), ""];
  if (inputs.verdict === "MALFORMED") {
    lines.push(...malformedNotice(inputs.detailText ?? ""), "");
  }
  lines.push(feedbackLead(inputs.phase), "");
  lines.push(inputs.reply.length === 0 ? EMPTY_REPLY : inputs.reply);
  return `${lines.join("\n")}\n`;
}

/**
 * F101-FR-005 and F101-FR-013 — the feedback the ENGINE writes after a failed
 * verification gate, from the RESULT RECORD of the gate. The critic was not
 * called, so there is no reply: what stands in place of it is the roster of the
 * checks that failed or errored, which `gistOf` then reads as the gist of a
 * failed check (its second choice).
 *
 * The heading says REJECTED, because the result of the phase attempt is forced
 * to a rejection (result code 10) and no verdict exists for it (B-0328).
 */
export function feedbackOfTheVerificationGate(inputs: {
  readonly phase: number;
  /** The mode the gate ran in; `required` is the mode that forces a rejection. */
  readonly mode: string;
  /** One roster line per check, as the result record of the gate gives them. */
  readonly roster: readonly { readonly name: string; readonly status: string }[];
  /** The criteria the failed checks carry, where the result record names them. */
  readonly criteria?: readonly string[];
}): string {
  const lines: string[] = [
    feedbackHeading(inputs.phase, "REJECTED"),
    "",
    `> The verification gate failed in mode \`${inputs.mode}\`, so the critic was not called.`,
    "",
    feedbackLead(inputs.phase),
    "",
  ];
  if (inputs.roster.length === 0) {
    lines.push("- the verification gate reported no check");
  } else {
    for (const check of inputs.roster) {
      lines.push(`- ${check.name} ${check.status.toUpperCase()}`);
    }
  }
  for (const criterion of inputs.criteria ?? []) {
    lines.push(`- ${criterion} is not met`);
  }
  return `${lines.join("\n")}\n`;
}
