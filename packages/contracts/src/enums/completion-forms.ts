/**
 * T162 — the two forms of the `completion` level, the proof each needs, and
 * the type of the proof result that a call record carries (annex C, §C.3;
 * F100-FR-087, F100-FR-088, F100-FR-230).
 *
 * The table of the two forms is the key `completionForms` of
 * `data/harness-tables.json`. Row 28 of `data/closed-sets.json` ("Forms of the
 * `completion` level") registers through the mechanism of T070 in
 * `src/enums/sets-105-109.ts`, with `COMPLETION_FORMS` as its members and the
 * unknown-value rule `critic_not_toolless`.
 */
import harnessTables from "../../data/harness-tables.json" with { type: "json" };

/** The section of annex C that owns the table. */
export const ANNEX_SECTION = "annex C, §C.3" as const;

/** The row of annex X §X.6 that closes the set. */
export const CLOSED_SET_ROW = 28 as const;

/**
 * F100-FR-087 — the `completion` level has exactly the two forms of §C.3, in
 * the order of the table. The literal tuple is the members of row 28;
 * `COMPLETION_FORM_ROWS` asserts at load that it is exactly the table of
 * `data/harness-tables.json`, so the two cannot drift.
 */
export const COMPLETION_FORMS = ["tool-less", "read-only-tools"] as const;
export type CompletionForm = (typeof COMPLETION_FORMS)[number];

/** F100-FR-087 — exactly two forms, no third. */
export const COMPLETION_FORM_COUNT = 2 as const;

type RawForm = {
  Form: string;
  Id: string;
  Meaning: string;
  "Open to": string;
  Proof: string;
};

/** Who a form is open to (the column "Open to" of §C.3). */
export const OPEN_TO = ["every-qualifying-harness", "tested-harness-adapter-only"] as const;
export type OpenTo = (typeof OPEN_TO)[number];

/** One row of the table of the two forms (§C.3). */
export type CompletionFormRow = {
  /** `First` or `Second`, as the table names the form. */
  readonly form: string;
  readonly id: CompletionForm;
  readonly meaning: string;
  readonly openTo: OpenTo;
  /** The proof the form needs, in the words of the table. */
  readonly proof: string;
};

const RAW = (harnessTables as { completionForms: RawForm[] }).completionForms;

/** A table of `data/harness-tables.json` that is not the two forms of §C.3. */
export class CompletionFormTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionFormTableError";
  }
}

/** The id of a row, without the back-ticks the table writes it in. */
function idOf(raw: string): string {
  return raw.replace(/`/g, "").trim();
}

function openToOf(raw: string): OpenTo {
  return /tested harness adapter only/i.test(raw)
    ? "tested-harness-adapter-only"
    : "every-qualifying-harness";
}

function rows(): readonly CompletionFormRow[] {
  const ids = RAW.map((row) => idOf(row.Id));
  if (ids.length !== COMPLETION_FORM_COUNT || ids.some((id, i) => id !== COMPLETION_FORMS[i])) {
    throw new CompletionFormTableError(
      `the key \`completionForms\` of \`data/harness-tables.json\` holds ${ids.join(", ")}; ` +
        `annex C §C.3 holds exactly the two forms ${COMPLETION_FORMS.join(", ")} ` +
        `(F100-FR-087)`,
    );
  }
  return Object.freeze(
    RAW.map((row) =>
      Object.freeze({
        form: row.Form,
        id: idOf(row.Id) as CompletionForm,
        meaning: row.Meaning,
        openTo: openToOf(row["Open to"]),
        proof: row.Proof,
      }),
    ),
  );
}

/** The two forms with their meaning, who they are open to, and their proof. */
export const COMPLETION_FORM_ROWS: readonly CompletionFormRow[] = rows();

/** The row of a form. */
export function rowOfForm(form: CompletionForm): CompletionFormRow {
  const row = COMPLETION_FORM_ROWS.find((r) => r.id === form);
  if (row === undefined) throw new CompletionFormTableError(`no row of §C.3 for "${form}"`);
  return row;
}

/** True for a member of the set (annex X §X.6 row 28). */
export function isCompletionForm(value: unknown): value is CompletionForm {
  return typeof value === "string" && (COMPLETION_FORMS as readonly string[]).includes(value);
}

/**
 * Unknown-value rule of row 28, and the refusal of F100-FR-087: a
 * critic-class call whose proof is missing or fails is refused with
 * `critic_not_toolless`.
 */
export const FAILURE_WHEN_THE_PROOF_IS_MISSING = "critic_not_toolless" as const;

/** F100-FR-087 — a critic path never receives a flag that allows all tools. */
export const CRITIC_NEVER_RECEIVES_AN_ALL_TOOLS_FLAG = true as const;

/** F100-FR-087 — the result of the proof is recorded for every critic-class call. */
export const PROOF_IS_RECORDED_FOR_EVERY_CALL = true as const;

/** The second form is open to a tested harness adapter only (§C.3). */
export const SECOND_FORM: CompletionForm = "read-only-tools";
export const FIRST_FORM: CompletionForm = "tool-less";

/** True when only a tested harness adapter may offer the form. */
export function needsATestedHarnessAdapter(form: CompletionForm): boolean {
  return rowOfForm(form).openTo === "tested-harness-adapter-only";
}

/* ------------------------------------------------------------------ *
 * The proof each form needs (§C.3, the column "Proof").
 * ------------------------------------------------------------------ */

/**
 * What the proof of a form rests on.
 *
 * The first form: the initial record of the call shows an empty tool list and
 * the session identity of F100-FR-230; for a harness whose stream has no
 * initial record, the exact version pin together with the preflight of the
 * harness adapter and the flag set of the call, open to a tested harness
 * adapter only, and recorded as the weaker proof.
 *
 * The second form: the call record shows the read-only sandbox mode, the
 * network off, and the confirmation of the harness adapter that the withheld
 * paths of §C.4 cannot be read.
 */
export const PROOF_KINDS = ["initial-record", "version-pin-and-flags", "call-record"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/** The facts the proof of the first form needs from the initial record. */
export const FIRST_FORM_FACTS = ["emptyToolList", "sessionIdentity"] as const;

/** The facts the weaker proof of the first form needs (F100-FR-230, case 3). */
export const WEAKER_PROOF_FACTS = ["versionPin", "preflight", "flagSet"] as const;

/** The facts the proof of the second form needs from the call record. */
export const SECOND_FORM_FACTS = [
  "readOnlySandboxMode",
  "networkOff",
  "withheldPathsConfirmed",
] as const;

/** The three ways F100-FR-230 admits of showing a session of its own. */
export const SESSION_PROOF_CASES = [
  "caller-minted-id",
  "harness-given-id",
  "no-session-in-the-initial-record",
] as const;
export type SessionProofCase = (typeof SESSION_PROOF_CASES)[number];

/** The one case that is the weaker proof, for a tested harness adapter only. */
export const WEAKER_SESSION_PROOF_CASE: SessionProofCase = "no-session-in-the-initial-record";

/** What a form needs to be proved, as data. */
export type ProofRequirement = {
  readonly form: CompletionForm;
  /** The proof the table names first. */
  readonly kind: ProofKind;
  /** The facts that proof rests on. */
  readonly facts: readonly string[];
  /** The fallback the table admits, where there is one. */
  readonly fallback?: {
    readonly kind: ProofKind;
    readonly facts: readonly string[];
    readonly testedHarnessAdapterOnly: true;
    readonly recordedAsTheWeakerProof: true;
  };
};

/** The proof each form needs (§C.3, the column "Proof"). */
export const PROOF_REQUIREMENTS: Readonly<Record<CompletionForm, ProofRequirement>> = Object.freeze(
  {
    "tool-less": Object.freeze({
      form: "tool-less" as CompletionForm,
      kind: "initial-record" as ProofKind,
      facts: FIRST_FORM_FACTS,
      fallback: Object.freeze({
        kind: "version-pin-and-flags" as ProofKind,
        facts: WEAKER_PROOF_FACTS,
        testedHarnessAdapterOnly: true as const,
        recordedAsTheWeakerProof: true as const,
      }),
    }),
    "read-only-tools": Object.freeze({
      form: "read-only-tools" as CompletionForm,
      kind: "call-record" as ProofKind,
      facts: SECOND_FORM_FACTS,
    }),
  },
);

/** The proof a form needs. */
export function proofRequiredFor(form: CompletionForm): ProofRequirement {
  return PROOF_REQUIREMENTS[form];
}

/* ------------------------------------------------------------------ *
 * The proof result a call record carries (F100-FR-087).
 * ------------------------------------------------------------------ */

/** The outcome of a proof. */
export const PROOF_OUTCOMES = ["passed", "failed", "not-made"] as const;
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number];

/**
 * The result of the proof that a call record of a critic-class call carries
 * (F100-FR-087, "The result of the proof MUST be recorded for every
 * critic-class call"; the field `criticProof` of the run record of annex E
 * §E.2).
 */
export type CriticProofResult = {
  readonly form: CompletionForm;
  readonly outcome: ProofOutcome;
  /** Which proof was made. */
  readonly kind: ProofKind;
  /** Which of the three ways of F100-FR-230 the session proof took. */
  readonly sessionProofCase: SessionProofCase;
  /** True where the weaker proof of F100-FR-230 case 3 was used. */
  readonly weakerProof: boolean;
  /** The facts the proof rests on, each with whether it held. */
  readonly facts: Readonly<Record<string, boolean>>;
  /** The failure a refused proof raises; absent where the proof passed. */
  readonly failure?: typeof FAILURE_WHEN_THE_PROOF_IS_MISSING;
  /** Under the `parity` profile no proof is made, as at the baseline. */
  readonly underParity: boolean;
};

/**
 * F100-FR-087 — a critic-class call whose proof is missing or fails is
 * refused with `critic_not_toolless`. Under the `parity` profile no proof is
 * made, as at the baseline (rows 28 and 117 of annex X §X.7), so the call is
 * not refused for want of one (F100-FR-230).
 */
export function callIsRefused(result: CriticProofResult): boolean {
  if (result.underParity) return false;
  return result.outcome !== "passed";
}

/** F100-FR-230 — under the `parity` profile no proof is made, for any harness. */
export const PROOF_IS_MADE_UNDER_PARITY = false as const;

/* ------------------------------------------------------------------ *
 * What a critic of either form receives (F100-FR-088).
 * ------------------------------------------------------------------ */

/**
 * F100-FR-088 — a critic of either form receives the grounding snapshot and,
 * where one exists, the fact block, and its verdict is bound to the nonce of
 * the call.
 */
export const CRITIC_PROMPT_HOLDS = ["grounding-snapshot", "fact-block-where-one-exists"] as const;
export const VERDICT_IS_BOUND_TO_THE_NONCE = true as const;

/**
 * F100-FR-088 — before a critic of the second form starts, the runtime moves
 * the proposer's notebook, handoff and outbox out of the working tree, and
 * moves them back after the call. The move holds for every critic-class call,
 * the diagnostician included.
 */
export const FILES_MOVED_OUT_OF_THE_WORKING_TREE = ["notebook", "handoff", "outbox"] as const;
export const FILES_ARE_MOVED_BACK_AFTER_THE_CALL = true as const;
export const MOVE_HOLDS_FOR_EVERY_CRITIC_CLASS_CALL = true as const;

/** True where the runtime must move the proposer's files before the call. */
export function movesTheProposersFiles(form: CompletionForm): boolean {
  // The move holds for every critic-class call (F100-FR-088), the
  // diagnostician included, so it does not depend on the form.
  return isCompletionForm(form);
}

/**
 * F100-FR-088 — the second form is a stated exception to the rules that the
 * critic judges from the grounding snapshot only and holds no tools, and it
 * is limited to reading project files.
 */
export const STATED_EXCEPTION: CompletionForm = SECOND_FORM;
export const EXCEPTION_IS_LIMITED_TO = "reading project files" as const;
