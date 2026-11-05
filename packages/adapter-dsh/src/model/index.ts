/**
 * T029 — the model reference rules, the precedence and the table of bare ids
 * (F130-FR-012, F130-FR-013).
 *
 * Precedence: the flag, then the model setting of F130-FR-008
 * (`roles.proposer.model`), then the qualifier of the entry. With none of the
 * three there is NO overlay and the profile's own settings select the model.
 * A reference `provider/model` is used as given. A bare id takes the provider
 * setting, or the table of F130-FR-013 (`harnesses.dsh.modelProviders`, user
 * configuration, plus ONE built-in row: a bare id that begins with `glm-`
 * maps to the provider `zai`); otherwise the pass fails with the as-is
 * message. A provider that differs from the provider setting is a conflict; a
 * provider or model outside its character class is an invalid reference; a
 * qualifier together with the flag fails with result 1. Every failure line
 * starts with the component name `pass-loop` (rule N-15). The same table and
 * the same rules serve the critic (F130-FR-028).
 */

/** The component name every failure line starts with (rule N-15). */
export const PASS_LOOP_COMPONENT = "pass-loop" as const;

/** The provider character class of F130-FR-012. */
const PROVIDER_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The model character class of F130-FR-012. */
const MODEL_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** The as-is message for a bare id with no provider anywhere. */
export const NO_PROVIDER_MESSAGE =
  "needs a provider; use provider/model or set the provider setting";

/** The as-is message for a provider that differs from the provider setting. */
export const CONFLICTING_PROVIDERS_MESSAGE = "conflicting DSH providers";

/** The as-is message for a reference outside its character classes. */
export const INVALID_MODEL_REF_MESSAGE = "invalid DSH model ref";

/** The as-is message and result for a qualifier together with the flag. */
export const QUALIFIER_AND_FLAG_MESSAGE =
  "use either --backend dsh:<provider/model> or --model, not both";

/** The one built-in row of the table of bare ids (F130-FR-013). */
export const BUILT_IN_BARE_MODEL_ROWS = Object.freeze([
  Object.freeze({ pattern: "glm-*", provider: "zai", model: null }),
]);

/** A row of the table of bare ids, as user configuration states it. */
export type BareModelRow = {
  /** A bare id, or a prefix pattern ending in `*`. */
  readonly pattern: string;
  readonly provider: string;
  /** Where the row maps the id to a model that differs from the id. */
  readonly model?: string | null;
};

/** A resolved model reference: provider and model, used as given. */
export type ModelReference = { readonly provider: string; readonly model: string };

/** The outcome of a model resolution. */
export type ModelResolution =
  | {
      readonly ok: true; /** null: no override, no overlay, profile settings select. */
      readonly reference: ModelReference | null;
      readonly bare: boolean;
    }
  | { readonly ok: false; readonly result: 1; readonly message: string };

/** The input: the three sources in precedence order, the provider setting, the table. */
export type ResolveModelInput = {
  /** The `--model` flag; highest precedence. */
  readonly flag?: string | null;
  /** The model setting `roles.proposer.model`; over the qualifier. */
  readonly setting?: string | null;
  /** The qualifier of the entry, `provider/model`; lowest precedence. */
  readonly qualifier?: string | null;
  /** The provider setting `harnesses.dsh.provider`, for bare ids. */
  readonly providerSetting?: string | null;
  /** Rows of `harnesses.dsh.modelProviders`, before the built-in row. */
  readonly modelProviders?: readonly BareModelRow[];
};

/** The rows that match a bare id: exact keys first, then prefix patterns. */
function matchingRows(rows: readonly BareModelRow[], bare: string): BareModelRow[] {
  return rows.filter(
    (row) =>
      row.pattern === bare ||
      (row.pattern.endsWith("*") && bare.startsWith(row.pattern.slice(0, -1))),
  );
}

/**
 * The table of bare ids (F130-FR-013): the user-configuration rows of
 * `harnesses.dsh.modelProviders` first, then the ONE built-in row. No row of
 * the baseline's own table ships: a consumer or a fixture supplies its rows.
 */
export function bareModelTable(userRows: readonly BareModelRow[] = []): BareModelRow[] {
  return [...userRows, ...BUILT_IN_BARE_MODEL_ROWS.map((row) => ({ ...row }))];
}

/** Resolves a bare id through the provider setting, then the table. */
function resolveBare(
  bare: string,
  providerSetting: string | null,
  userRows: readonly BareModelRow[],
): { ok: true; reference: ModelReference; bare: true } | { ok: false; message: string } {
  if (providerSetting !== null) {
    return { ok: true, reference: { provider: providerSetting, model: bare }, bare: true };
  }
  const row = matchingRows(bareModelTable(userRows), bare)[0];
  if (row !== undefined) {
    return {
      ok: true,
      reference: { provider: row.provider, model: row.model ?? bare },
      bare: true,
    };
  }
  return {
    ok: false,
    message: `${PASS_LOOP_COMPONENT}: DSH model '${bare}' ${NO_PROVIDER_MESSAGE}`,
  };
}

/**
 * F130-FR-012 — resolves the model of a pass. `reference: null` means: no
 * override, no overlay built, the profile's own settings select the model.
 */
export function resolveDshModel(input: ResolveModelInput = {}): ModelResolution {
  const flag = input.flag ?? null;
  const setting = input.setting ?? null;
  const qualifier = input.qualifier ?? null;
  if (flag !== null && qualifier !== null) {
    return {
      ok: false,
      result: 1,
      message: `${PASS_LOOP_COMPONENT}: ${QUALIFIER_AND_FLAG_MESSAGE}`,
    };
  }
  const raw = flag ?? setting ?? qualifier;
  if (raw === null || raw === "") {
    return { ok: true, reference: null, bare: false };
  }
  const slash = raw.indexOf("/");
  const provider = slash < 0 ? null : raw.slice(0, slash);
  const model = slash < 0 ? raw : raw.slice(slash + 1);
  let reference: ModelReference;
  let bare: boolean;
  if (provider === null) {
    const resolved = resolveBare(raw, input.providerSetting ?? null, input.modelProviders ?? []);
    if (!resolved.ok) return { ok: false, result: 1, message: resolved.message };
    reference = resolved.reference;
    bare = true;
  } else {
    if (!PROVIDER_PATTERN.test(provider) || !MODEL_PATTERN.test(model)) {
      return {
        ok: false,
        result: 1,
        message: `${PASS_LOOP_COMPONENT}: ${INVALID_MODEL_REF_MESSAGE}: ${raw}`,
      };
    }
    reference = { provider, model };
    bare = false;
  }
  if (
    input.providerSetting !== null &&
    input.providerSetting !== undefined &&
    input.providerSetting !== reference.provider
  ) {
    return {
      ok: false,
      result: 1,
      message:
        `${PASS_LOOP_COMPONENT}: ${CONFLICTING_PROVIDERS_MESSAGE}: ` +
        `${input.providerSetting} != ${reference.provider}`,
    };
  }
  return { ok: true, reference, bare };
}
