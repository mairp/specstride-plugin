/**
 * T042 — `supervise mode`: the mode of a launch from a request text and
 * tokens (F123-FR-025).
 *
 * A token `--auto`, `--run` or `--generate` — from `--token` or found in the
 * text — wins over all prose; the first matching token decides. Otherwise the
 * refusal phrases give `generate` with the source `refusal`, the auto phrases
 * give `auto` with the source `prose`, and the run phrases give `run` (or
 * `auto` when a generation word is also present); a bare dry-run mention
 * gives `generate` with the evidence `dry-run`. The flags `implement` and
 * `smoke` are read from the tokens or their phrases. The mode maps to the
 * modes of the host skill: `generate` to `dry-run`, `run` and `auto` to
 * `run`. The default mode is `run`. No text switches off a launch check, the
 * terms gate or a budget.
 */

/** A mode of the launch: `run`, `auto` or `generate`. */
export type RequestedMode = "run" | "auto" | "generate";

/** Where the mode came from: a token, refusal prose, other prose, or the default. */
export type ModeSource = "token" | "refusal" | "prose" | "default";

/** The chosen mode, with its source, its optional evidence and the flags. */
export type ModeChoice = {
  readonly mode: RequestedMode;
  readonly source: ModeSource;
  /** The token that decided, when the source is `token`. */
  readonly token?: string;
  /** `dry-run` when a bare dry-run mention decided. */
  readonly evidence?: string;
  readonly flags: { readonly implement: boolean; readonly smoke: boolean };
};

/** The mode tokens, in the order in which the first match decides. */
export const MODE_TOKENS = ["--auto", "--run", "--generate"] as const;
export type ModeToken = (typeof MODE_TOKENS)[number];

const MODE_OF_TOKEN: Record<ModeToken, RequestedMode> = {
  "--auto": "auto",
  "--run": "run",
  "--generate": "generate",
};

/** The ten refusal phrases (§R.7 via F123-FR-025); a match gives `generate`. */
export const REFUSAL_PHRASES: readonly string[] = Object.freeze([
  "do not run",
  "do not execute",
  "do not launch",
  "do not start",
  "without running",
  "no execution",
  "do not auto",
  "only derive",
  "generation only",
  "dry-run only",
]);

/** The auto phrases; a match gives `auto`. */
export const AUTO_PHRASES: readonly RegExp[] = Object.freeze([
  /\bauto\b/,
  /\b(?:generate|derive|create)\s+(?:and\s+)?run\b/,
]);

/** The run phrases; a match gives `run` (or `auto` with a generation word). */
export const RUN_PHRASES: readonly RegExp[] = Object.freeze([
  /\brun (?:it|this|that|them)\b/,
  /\brun (?:the )?(?:pipeline|launcher|script|loop|stage)\b/,
  /\b(?:execute|launch|start|kick off) (?:it|the launcher)\b/,
  /\bresume (?:the )?(?:run|pipeline)\b/,
  /\bfor real\b/,
  /\bthen run\b/,
  /\band run it\b/,
]);

/** A generation word that upgrades `run` to `auto`. */
const GENERATION_WORD = /\b(?:generate|generate it|generation|derive)\b/;

/** A bare dry-run mention (without the refusal phrase `dry-run only`). */
const DRY_RUN_MENTION = /\bdry[- ]?run\b/;

const IMPLEMENT_PHRASES: readonly RegExp[] = Object.freeze([
  /--implement\b/,
  /\bimplement setup\b/,
]);
const SMOKE_PHRASES: readonly RegExp[] = Object.freeze([/--smoke\b/, /\bsmoke stages?\b/]);

/** Read the flags `implement` and `smoke` from the tokens and the text. */
function readFlags(
  tokens: readonly string[],
  text: string,
): { implement: boolean; smoke: boolean } {
  const haystack = `${tokens.join(" ")} ${text}`;
  return {
    implement: IMPLEMENT_PHRASES.some((phrase) => phrase.test(haystack)),
    smoke: SMOKE_PHRASES.some((phrase) => phrase.test(haystack)),
  };
}

/**
 * Choose the mode (F123-FR-025). `tokens` are the values of `--token`; `text`
 * is the request text. The default mode is `run`.
 */
export function chooseMode(input: { tokens?: readonly string[]; text: string }): ModeChoice {
  const tokens = input.tokens ?? [];
  const text = input.text;
  const flags = readFlags(tokens, text);
  // 1. A token wins over all prose; the first matching token decides.
  const allTokens = [...tokens, ...text.split(/\s+/)];
  for (const candidate of allTokens) {
    if ((MODE_TOKENS as readonly string[]).includes(candidate)) {
      const token = candidate as ModeToken;
      return { mode: MODE_OF_TOKEN[token], source: "token", token, flags };
    }
  }
  // 2. A refusal phrase gives `generate` with the source `refusal`.
  const lowered = text.toLowerCase();
  if (REFUSAL_PHRASES.some((phrase) => lowered.includes(phrase))) {
    return { mode: "generate", source: "refusal", flags };
  }
  // 3. An auto phrase gives `auto` with the source `prose`.
  if (AUTO_PHRASES.some((phrase) => phrase.test(lowered))) {
    return { mode: "auto", source: "prose", flags };
  }
  // 4. A run phrase gives `run`, or `auto` when a generation word is present.
  if (RUN_PHRASES.some((phrase) => phrase.test(lowered))) {
    if (GENERATION_WORD.test(lowered)) {
      return { mode: "auto", source: "prose", flags };
    }
    return { mode: "run", source: "prose", flags };
  }
  // 5. A bare dry-run mention gives `generate` with the evidence `dry-run`.
  if (DRY_RUN_MENTION.test(lowered)) {
    return { mode: "generate", source: "prose", evidence: "dry-run", flags };
  }
  // 6. The default is `run`.
  return { mode: "run", source: "default", flags };
}

/** The mode map to the modes of the host skill: `generate` to `dry-run`. */
export function mapMode(mode: RequestedMode): "run" | "dry-run" {
  return mode === "generate" ? "dry-run" : "run";
}

/** The default mode of a launch: `run` for `launch`, `auto` for `auto`. */
export function defaultModeOfVerb(verb: "launch" | "auto"): "run" | "auto" {
  return verb === "auto" ? "auto" : "run";
}

/** The flags of the mode line, as `[MOL-MODE]` prints them. */
export function modeFlagsOf(choice: ModeChoice): readonly string[] {
  const flags: string[] = [];
  if (choice.flags.implement) flags.push("--implement");
  if (choice.flags.smoke) flags.push("--smoke");
  return flags;
}
