/**
 * T066 — the mode selector (F106-FR-032, F106-FR-033; contracts/mode-selector.md).
 *
 * The learning mode of a supervised run is selected from the request by a fixed
 * rule; the default is `off`. Order of decision, first match wins:
 *
 *   1. a token `--learning-off` | `--learning-suggest` | `--learning-apply`,
 *      given by option or found as a flag-shaped word of the request — the
 *      given tokens are tried first; the token's mode, source `token`;
 *   2. a refusal phrase — `off`, source `refusal`;
 *   3. an apply phrase — `apply`, source `prose` (`apply` is never inferred
 *      from a vague wish);
 *   4. a suggest phrase — `suggest`, source `prose`;
 *   5. none — `off`, source `default`.
 *
 * The phrases are DATA (`packages/learning/data/mode-phrases.json`, T065),
 * matched in lower case. The verb `learning` of `supervise` prints the
 * `[MOL-LEARNING]` line (and, for `apply`, the `[MOL-NEXT]` line) and exits 0.
 *
 * F106-FR-033 lives here too: a derivation asked for `apply` that can bind no
 * decision (no `configuration.learning` block results) writes `suggest` and
 * says why. Purity: `node:fs` only to read the phrase table.
 */
import { readFileSync } from "node:fs";

/** The path of the phrase table, relative to this module. */
const PHRASES_URL = new URL("../data/mode-phrases.json", import.meta.url);

/** The closed set of modes the selector may return (F106-FR-032). */
export type SelectedLearningMode = "off" | "suggest" | "apply";

/** The closed set of sources the selector reports. */
export type LearningSelectionSource = "token" | "refusal" | "prose" | "default";

/** The result of the selector: the mode, its source and the matched evidence. */
export type LearningSelection = {
  readonly mode: SelectedLearningMode;
  readonly source: LearningSelectionSource;
  /** The token or phrase that decided it; empty for the default. */
  readonly evidence: string;
};

/** The phrase table as data: one entry per pattern of the baseline (T065). */
export type ModePhraseTable = {
  readonly schema: string;
  readonly tokens: Readonly<Record<string, SelectedLearningMode>>;
  readonly refusal: readonly string[];
  readonly apply: readonly string[];
  readonly suggest: readonly string[];
};

/** The explicit invocation tokens of the baseline, and the mode each selects. */
export const LEARNING_TOKEN_MODES: Readonly<Record<string, SelectedLearningMode>> = Object.freeze({
  "--learning-off": "off",
  "--learning-suggest": "suggest",
  "--learning-apply": "apply",
});

/** A flag-shaped word of the request: starts with two hyphens, at the start of the text or after white space. */
const FLAG_WORD = /(?<!\S)--[a-z-]+/g;

let cachedTable: ModePhraseTable | undefined;

/** Read the phrase table from the data file; the table is data, never code (F106-FR-033). */
export function loadModePhrases(): ModePhraseTable {
  if (cachedTable === undefined) {
    cachedTable = JSON.parse(readFileSync(PHRASES_URL, "utf8")) as ModePhraseTable;
  }
  return cachedTable;
}

/** The first pattern of the list that matches anywhere in the text; its match, trimmed. */
export function matchedPhrase(text: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    const found = new RegExp(pattern).exec(text);
    if (found !== null) return found[0].trim();
  }
  return null;
}

/**
 * F106-FR-032 — select the learning mode from the request. The tokens given by
 * option are tried first, in the order given, then the flag-shaped words of the
 * request in the order they appear; the first word that is one of the three
 * tokens wins. Phrases are matched in lower case, in the selector's order.
 */
export function selectLearningMode(
  request: string,
  tokens: readonly string[] = [],
  table: ModePhraseTable = loadModePhrases(),
): LearningSelection {
  const words = [...tokens, ...((request ?? "").match(FLAG_WORD) ?? [])];
  for (const word of words) {
    const mode = (table.tokens ?? LEARNING_TOKEN_MODES)[word];
    if (mode !== undefined) return { mode, source: "token", evidence: word };
  }
  const text = (request ?? "").toLowerCase();
  const refusal = matchedPhrase(text, table.refusal);
  if (refusal !== null) return { mode: "off", source: "refusal", evidence: refusal };
  const apply = matchedPhrase(text, table.apply);
  if (apply !== null) return { mode: "apply", source: "prose", evidence: apply };
  const suggest = matchedPhrase(text, table.suggest);
  if (suggest !== null) return { mode: "suggest", source: "prose", evidence: suggest };
  return { mode: "off", source: "default", evidence: "" };
}

/** The `[MOL-LEARNING]` line of the selector (F106-FR-032; C-254). */
export function learningSelectionLine(selection: LearningSelection): string {
  return `[MOL-LEARNING] mode=${selection.mode} source=${selection.source} evidence=${JSON.stringify(selection.evidence)}`;
}

/** The `[MOL-NEXT]` bootstrap hint that follows an `apply` selection (F106-FR-032). */
export const LEARNING_APPLY_NEXT_LINE =
  '[MOL-NEXT] next="bootstrap with --learning-mode apply; if it emits no ' +
  "configuration.learning block there are no applied decisions to bind: use suggest " +
  'and say so"';

/** The lines the verb `learning` of `supervise` prints: the `[MOL-LEARNING]` line, plus the `[MOL-NEXT]` hint for `apply`. */
export function learningSelectionLines(selection: LearningSelection): string[] {
  return selection.mode === "apply"
    ? [learningSelectionLine(selection), LEARNING_APPLY_NEXT_LINE]
    : [learningSelectionLine(selection)];
}

/** Why a derivation demoted an `apply` request (F106-FR-033). */
export type DerivationLearningMode = {
  readonly mode: SelectedLearningMode;
  /** Non-empty exactly when `apply` was asked and demoted to `suggest`. */
  readonly reason: string;
};

/**
 * F106-FR-033 — the consumer's comment cannot widen the mode. When the
 * selection says `apply` but the derivation can bind no decision (no
 * `configuration.learning` block results, F106-FR-027), the launch contract
 * carries `suggest` and the derivation names the reason. It never writes
 * `apply` without a block.
 */
export function derivationLearningMode(
  selection: LearningSelection,
  bindable: boolean,
): DerivationLearningMode {
  if (selection.mode === "apply" && !bindable) {
    return {
      mode: "suggest",
      reason:
        "asked for apply; the derivation binds no decision (no configuration.learning block results): there are no applied decisions to bind",
    };
  }
  return { mode: selection.mode, reason: "" };
}

/** The line a derivation prints when it demoted `apply` to `suggest` (F106-FR-033: it says why). */
export function derivationDemotedLine(demoted: DerivationLearningMode): string | null {
  if (demoted.reason === "") return null;
  return `[MOL-NEXT] learning=${demoted.mode} ${JSON.stringify(demoted.reason)}`;
}

/** The options of the verb `learning` of `supervise` (F106-FR-032). */
export type LearningVerbInput = {
  /** The request text, verbatim; default empty. */
  readonly request?: string | undefined;
  /** An explicit token; repeatable (annex G: the last occurrence wins is NOT used — every occurrence is a candidate). */
  readonly token?: readonly string[] | string | undefined;
};

/** The result of the verb: the lines on standard output and exit 0 (F106-FR-032). */
export type LearningVerbResult = {
  readonly exit: 0;
  readonly stdout: string;
  readonly stderr: string;
};

/** The handler of the verb `learning` of `supervise`: select, print the lines, exit 0. */
export function runLearningVerb(input: LearningVerbInput = {}): LearningVerbResult {
  const tokens =
    input.token === undefined ? [] : Array.isArray(input.token) ? input.token : [input.token];
  const selection = selectLearningMode(input.request ?? "", tokens);
  return {
    exit: 0,
    stdout: learningSelectionLines(selection).join("\n") + "\n",
    stderr: "",
  };
}
