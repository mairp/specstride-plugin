/**
 * T063 — the two forms of the `completion` level and their admission
 * (F109-FR-037; annex X §X.6 row 28).
 *
 * The level `completion` has exactly two forms: `tool-less` and
 * `read-only-tools`. The form is fixed per entry of the role plan BEFORE the
 * call, and it cannot change afterwards. The second form, and the proof by
 * pinned configuration of F109-FR-038, are open to a tested harness adapter
 * only. No critic path ever receives a flag or a mode that allows all tools,
 * and a critic-class call runs on a model whose context window is known with
 * its source: there is no default window for an unknown model.
 *
 * Every refusal here is the typed failure `critic_not_toolless` (row 28's
 * unknown-value rule): a critic configuration error that halts the run with
 * the engine exit code 3 and the stop reason `critic_config`.
 */

/** Row 28 — the two forms of the `completion` level, in their order. */
export const COMPLETION_FORMS = ["tool-less", "read-only-tools"] as const;
export type CompletionForm = (typeof COMPLETION_FORMS)[number];

/** The first form: no tool at all, proved by the initial record. */
export const FIRST_FORM: CompletionForm = "tool-less";
/** The second form: read-only tools in a sandbox, proved by the call record. */
export const SECOND_FORM: CompletionForm = "read-only-tools";

/** True when the value is a member of row 28. */
export function isCompletionForm(value: unknown): value is CompletionForm {
  return typeof value === "string" && (COMPLETION_FORMS as readonly string[]).includes(value);
}

/** The typed failure every refusal of a critic form carries (row 28). */
export const CRITIC_NOT_TOOLLESS = "critic_not_toolless" as const;

/** The stop reason a refused critic configuration halts the run with. */
export const CRITIC_CONFIG_STOP_REASON = "critic_config" as const;

/** The engine exit code of a critic configuration error. */
export const ENGINE_EXIT_CODE_OF_CRITIC_CONFIG = 3 as const;

/** The forms a tested harness adapter must have offered (F109-FR-014). */
export type TestedAdapter = {
  /** `origin: "adapter"` with a version range and a verified date. */
  readonly tested: boolean;
};

/** True when the form is open to a harness that is not tested: only the first form is. */
export function formNeedsTestedAdapter(form: CompletionForm): boolean {
  return form === SECOND_FORM;
}

/* ------------------------------------------------------------------ *
 * Fixing the form before the call (F109-FR-037).
 * ------------------------------------------------------------------ */

/** A form that has been fixed for one entry of the role plan. */
export type FixedForm = {
  readonly form: CompletionForm;
  readonly fixedBeforeCall: true;
};

/**
 * Fixes the form of one entry before the call. A value outside row 28 (or a
 * missing one) is refused with `critic_not_toolless`: the entry cannot be a
 * critic of a known form.
 */
export function fixFormBeforeCall(declared: unknown): FixedForm | FormRefusal {
  if (!isCompletionForm(declared)) {
    return refusal(
      `the form of the completion level must be one of ${COMPLETION_FORMS.join(", ")}` +
        (declared === undefined ? "; none was fixed before the call" : ""),
    );
  }
  return { form: declared, fixedBeforeCall: true };
}

/** True when the fixed form is still the one the call asks for. */
export function formIsUnchanged(fixed: FixedForm, asked: CompletionForm): boolean {
  return fixed.form === asked;
}

/* ------------------------------------------------------------------ *
 * Refusals.
 * ------------------------------------------------------------------ */

/** One refusal to admit a form or a proof, with the typed failure. */
export type FormRefusal = {
  readonly accepted: false;
  readonly failure: typeof CRITIC_NOT_TOOLLESS;
  readonly reason: string;
  /** The run-level consequence, fixed here: a critic configuration error. */
  readonly stopReason: typeof CRITIC_CONFIG_STOP_REASON;
  readonly engineExitCode: typeof ENGINE_EXIT_CODE_OF_CRITIC_CONFIG;
};

/** Build one refusal with the typed failure and the run-level consequence. */
export function refusal(reason: string): FormRefusal {
  return {
    accepted: false,
    failure: CRITIC_NOT_TOOLLESS,
    reason,
    stopReason: CRITIC_CONFIG_STOP_REASON,
    engineExitCode: ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  };
}

/* ------------------------------------------------------------------ *
 * No flag that allows all tools (F109-FR-037).
 * ------------------------------------------------------------------ */

/**
 * The flags and modes that allow all tools. A critic path that is offered any
 * of them is refused, whatever its form.
 */
export const ALL_TOOLS_FLAGS = [
  "--allow-all-tools",
  "--tools=all",
  "--dangerously-skip-permissions",
  "--yolo",
] as const;

/** True when the flag or mode name allows all tools. */
export function isAllToolsFlag(flag: string): boolean {
  const lowered = flag.trim().toLowerCase();
  return (ALL_TOOLS_FLAGS as readonly string[]).some(
    (candidate) => lowered === candidate || lowered.startsWith(`${candidate}=`),
  );
}

/* ------------------------------------------------------------------ *
 * The context window: known with its source, never defaulted.
 * ------------------------------------------------------------------ */

/** A context window that is known, with the source that named it. */
export type KnownContextWindow = {
  readonly tokens: number;
  /** Where the number came from: a declaration of the consumer or the model list. */
  readonly source: string;
};

/**
 * The context window of the model a critic-class call runs on. There is no
 * default window for an unknown model: a model that is neither declared nor
 * listed is refused (F109-FR-037; feature 100, F100-FR-231).
 */
export function knownContextWindow(options: {
  readonly model: string;
  /** The window the consumer declared, with its source. */
  readonly declared?: KnownContextWindow | null;
  /** The windows the model list of the endpoint reports, by model id. */
  readonly knownModels?: Readonly<Record<string, number>>;
}): KnownContextWindow | FormRefusal {
  if (options.declared && Number.isFinite(options.declared.tokens) && options.declared.tokens > 0) {
    return options.declared;
  }
  const listed = options.knownModels?.[options.model];
  if (typeof listed === "number" && Number.isFinite(listed) && listed > 0) {
    return { tokens: listed, source: "model-list" };
  }
  return refusal(
    `the context window of the model "${options.model}" is not known; ` +
      `a critic-class call runs only on a model whose window is known with its source, ` +
      `and there is no default window for an unknown model`,
  );
}

/* ------------------------------------------------------------------ *
 * The admission of one form for one critic-class call.
 * ------------------------------------------------------------------ */

/** What the seam asks before it admits one critic-class call of a form. */
export type FormAdmission = {
  /** The fixed form of the entry (it was fixed before the call). */
  readonly fixed: FixedForm;
  /** The kind of proof the call rests on (F109-FR-038, F109-FR-039). */
  readonly proofKind: "initial-record" | "pinned-configuration" | "read-only-sandbox";
  /** Whether the harness adapter is a tested one (F109-FR-014). */
  readonly tested: boolean;
  /** The flag set of the call; a flag that allows all tools is refused. */
  readonly flags?: readonly string[];
  /** The context window of the model of the call. */
  readonly contextWindow: KnownContextWindow | FormRefusal;
};

/** The admission: the form may be used, or the typed refusal. */
export type FormAdmissionResult =
  { readonly accepted: true; readonly form: CompletionForm } | FormRefusal;

/**
 * Admits one critic-class call of a form (F109-FR-037): the form must be one
 * of row 28; the second form and the proof by pinned configuration are open
 * to a tested harness adapter only; no flag that allows all tools is ever
 * admitted; the context window must be known with its source.
 */
export function admitForm(options: FormAdmission): FormAdmissionResult {
  const { form } = options.fixed;
  if (!isCompletionForm(form)) return refusal("the form is not a member of row 28");
  if (formNeedsTestedAdapter(form) && !options.tested) {
    return refusal(`the form "${SECOND_FORM}" is open to a tested harness adapter only`);
  }
  if (options.proofKind === "pinned-configuration" && !options.tested) {
    return refusal("the proof by pinned configuration is open to a tested harness adapter only");
  }
  const flag = (options.flags ?? []).find((candidate) => isAllToolsFlag(candidate));
  if (flag !== undefined) {
    return refusal(`no critic path receives a flag that allows all tools; refused "${flag}"`);
  }
  if ("accepted" in options.contextWindow) return options.contextWindow;
  return { accepted: true, form };
}
