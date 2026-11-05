/**
 * T041 — the output functions of `status`
 * (`packages/cli/src/status/output.ts`; F129-FR-025, F129-FR-026, F129-FR-027).
 *
 * Everything printed here is DERIVED FROM THE VIEW and from nothing else: the
 * renderer takes a view record and is given no file handle (F129-FR-032), and
 * no free text of the run is echoed (F129-FR-009 — `need` comes from the fixed
 * table of `contracts/lane-and-attention.md`).
 *
 * The renderers of the view (`renderLine`, `renderView`) are PARAMETERS and
 * not imports, for the reason `cached-view.ts` records: the import-boundary
 * check of feature 100 refuses an import between two packages of layer L6
 * that the `mayImport` of the graph does not name explicitly, and the entry of
 * `@specstride/cli` carries the prose "every package above"
 * (`packages/contracts/data/package-graph.json`). The request to feature 100
 * is open (R-129-04 of `specs/129-run-view-and-status/contracts/README.md`).
 *
 * The compatibility output is the seam of the presenter interface of annex G
 * §G.10 of feature 100 (`specstride.presenter/1`, mode `plain`), the
 * implementation of which is feature 119's: `compatibilityLines` is what
 * feature 119's presenter replaces, and it takes the same view. In
 * compatibility output the lines are those the baseline prints, byte for byte;
 * the comparison of the bytes belongs to feature 119 (F129-FR-011).
 */

/** The fields of an attention item the text output prints. */
export type AttentionItemView = {
  readonly kind: string;
  readonly need?: string | null;
  readonly next: string;
};

/** The fields of the view the status outputs read. All reading is structural. */
export type ViewRecord = {
  readonly runId: string | null;
  readonly feature: string | null;
  readonly display: string;
  readonly attention: readonly AttentionItemView[];
  readonly attentionOmitted: number;
  readonly progress: {
    readonly phase: number | null;
    readonly phases: number | null;
    readonly units: { readonly done: number; readonly declared: number | null } | null;
    readonly rejects: number;
    readonly elapsedSeconds: number;
  };
  readonly strategy: { readonly strategy: string | null };
};

/** A renderer of the status line (`renderLine` of `@specstride/view`). */
export type RenderLine = (view: unknown) => string;

/** A renderer of the whole view (`renderView` of `@specstride/view`). */
export type RenderView = (view: unknown) => string;

/** The label of an attention line of the text output (annex G §G.3). */
export const ATTENTION_LABEL = "[SPECSTRIDE-ATTENTION]" as const;

/** The cap of one attention line, in bytes (F129-FR-025). */
export const ATTENTION_LINE_CAP_BYTES = 120 as const;

/** The cap of the whole text output, in bytes (F129-FR-025). */
export const OUTPUT_CAP_BYTES = 420 as const;

/** The text a cut value carries at the point of the cut (F129-FR-009's mark). */
export const CUT_MARK = "..." as const;

/** The text of a value as JSON quotes it: a command with a flag stays one value. */
export function jsonQuote(value: string): string {
  return JSON.stringify(value);
}

/** One line of the text output per attention item (F129-FR-025). */
export function attentionLine(item: AttentionItemView, cap = ATTENTION_LINE_CAP_BYTES): string {
  const head = `${ATTENTION_LABEL} kind=${item.kind} `;
  const tail = ` next=${jsonQuote(item.next)}`;
  const fixed = Buffer.byteLength(head, "utf8") + "need=".length + Buffer.byteLength(tail, "utf8");
  const quotes = 2 * jsonQuote("").length;
  const full = item.need ?? "";
  // The whole need fits: no mark, one value, quoted.
  if (fixed + quotes + Buffer.byteLength(full, "utf8") <= cap) {
    return `${head}need=${jsonQuote(full)}${tail}`;
  }
  // Cut the need inside the quotes, whole characters at a time, until the
  // line fits the cap with the mark at the point of the cut (F129-FR-009).
  let cut = full;
  while (cut.length > 0) {
    const marked = `${cut}${CUT_MARK}`;
    if (fixed + quotes + Buffer.byteLength(marked, "utf8") <= cap) {
      return `${head}need=${jsonQuote(marked)}${tail}`;
    }
    cut = cut.slice(0, -1);
  }
  return `${head}need=${jsonQuote(CUT_MARK)}${tail}`;
}

/**
 * F129-FR-025 — the default output: the first line is the status line
 * (F129-FR-027), then one line per attention item, then `more=<n>` for the
 * items that did not fit the cap of 420 bytes. No free text of the run.
 */
export function statusTextLines(view: ViewRecord, renderLine: RenderLine): readonly string[] {
  const lines: string[] = [renderLine(view)];
  const head = Buffer.byteLength(lines[0] ?? "", "utf8") + 1;
  let more = 0;
  for (const item of view.attention) {
    const line = attentionLine(item);
    if (head + Buffer.byteLength(line, "utf8") + 1 > OUTPUT_CAP_BYTES) {
      more += 1;
      continue;
    }
    lines.push(line);
  }
  // `more` counts the items left out of the output, whether by the cap or by
  // the bound of the view itself (F129-FR-025).
  more += view.attentionOmitted;
  if (more > 0) lines.push(`more=${more}`);
  return Object.freeze(lines);
}

/**
 * F129-FR-026 — `status --json`: the view in the canonical serialization, one
 * record, keys sorted, bounded by the bounds of the schema. What the bounds
 * cut is counted in the view itself (`attentionOmitted`, `budgetOmitted`,
 * `timeline.omitted`, `processes.omitted`), so the output carries the counts
 * of what was cut.
 */
export function statusJson(view: unknown, renderView: RenderView): string {
  return renderView(view);
}

/** F129-FR-027 — `status --line`: the precomputed form, at most 170 bytes. */
export function statusLineText(view: unknown, renderLine: RenderLine): string {
  return renderLine(view);
}

/**
 * The compatibility output of `status` (annex G §G.10 of feature 100, mode
 * `plain`): every fact on a line is a field of the view, and no fact of the
 * view is missing from it that the baseline prints (F129-FR-011). Feature
 * 119's presenter compares the bytes; this seam derives them from the view.
 */
export function compatibilityLines(view: ViewRecord): readonly string[] {
  const lines: string[] = [];
  if (view.runId !== null) lines.push(`run: ${view.runId}`);
  lines.push(`state: ${view.display}`);
  if (view.feature !== null) lines.push(`feature: ${view.feature}`);
  if (view.progress.phase !== null && view.progress.phases !== null) {
    lines.push(`phase: ${view.progress.phase}/${view.progress.phases}`);
  }
  if (view.progress.units !== null) {
    lines.push(
      view.progress.units.declared === null
        ? `units: ${view.progress.units.done}`
        : `units: ${view.progress.units.done}/${view.progress.units.declared}`,
    );
  }
  lines.push(`rejects: ${view.progress.rejects}`);
  lines.push(`elapsed: ${view.progress.elapsedSeconds}s`);
  if (view.strategy.strategy !== null) lines.push(`strategy: ${view.strategy.strategy}`);
  lines.push(`attention: ${view.attention.map((item) => item.kind).join(", ")}`);
  return Object.freeze(lines);
}

/**
 * The profile under which the compatibility output is printed and `--line`,
 * `--json` and `wait` print nothing (F129-SC-009): the `parity` profile,
 * selected by ordinary configuration (F100-FR-210).
 */
export function isParityProfile(profile: string | undefined, parityName: string): boolean {
  return profile === parityName;
}
