/**
 * The typed failures: `classify` and the reader of the `failures` map
 * (T036; F109-FR-009).
 *
 * `classify` returns one member of the closed vocabulary of typed failures
 * (annex X §X.6, row 36): a structured code wins over a match on text; what
 * matches no entry is `agent_failure`. For a declared harness the
 * `failures` map of its descriptor is the ONLY source of the classification —
 * the built-in text rules do not run for it. An authentication failure is
 * reported as such and names what to fix. The typed failure is handed to the
 * quota classifier unchanged.
 */
import { TYPED_FAILURES, type TypedFailure } from "../port/port.ts";

export { TYPED_FAILURES };
export type { TypedFailure };

/** The classification `classify` returns. */
export type Classification = {
  /** One member of the closed vocabulary. */
  kind: TypedFailure;
  /** The structured code that decided, where there was one. */
  code: string | null;
  /** What to fix; an authentication failure always names it. */
  fix: string | null;
};

/** The text rules of the seam, in the order they are tried (undeclared harnesses). */
export const TEXT_RULES: readonly {
  match: RegExp;
  kind: TypedFailure;
  fix: string;
}[] = Object.freeze([
  {
    match:
      /(?:401|403|unauthorized|unauthorised|invalid[ _-]?api[ _-]?key|authentication|not logged in|login required|api key)/i,
    kind: "authentication_failed",
    fix: "check the credential of the harness: set the key the harness expects in the environment its allow-list carries",
  },
  {
    match: /(?:429|rate[ _-]?limit|too many requests|slow down)/i,
    kind: "rate_limited",
    fix: "wait and retry the pass; the harness is answering but is throttling",
  },
  {
    match:
      /(?:quota|billing|insufficient[ _-]*(?:funds|credit|balance)|exceeded your (?:current )?quota)/i,
    kind: "quota_exhausted",
    fix: "top up the account or raise the quota of the credential the harness uses",
  },
  {
    match: /(?:context[ _-]*(?:window|length)|maximum[ _-]*context|too many tokens|token limit)/i,
    kind: "context_window_exceeded",
    fix: "shrink the grounding or the spec the harness is given; the prompt exceeds the context window",
  },
  {
    match:
      /(?:econnrefused|econnreset|etimedout|enotfound|connection refused|network|fetch failed|socket|dns|tls|ssl)/i,
    kind: "transport_failed",
    fix: "check the network and the endpoint the harness reaches",
  },
]);

/** A failure that matches no entry. */
export const UNKNOWN_FAILURE: TypedFailure = "agent_failure";

/** The reader of a descriptor's `failures` map. */
export type FailuresMap = Readonly<Record<string, string>>;

/**
 * Reads one entry of a `failures` map. The entry must name a member of the
 * closed vocabulary; anything else reads as `agent_failure` (what matches no
 * entry). For a declared harness this reader is the only source.
 */
export function readFailuresMap(map: FailuresMap | null | undefined, code: string): TypedFailure {
  if (!map) return UNKNOWN_FAILURE;
  const kind = map[code];
  if (typeof kind !== "string") return UNKNOWN_FAILURE;
  return (TYPED_FAILURES as readonly string[]).includes(kind)
    ? (kind as TypedFailure)
    : UNKNOWN_FAILURE;
}

/** The input of `classify`. */
export type ClassifyInput = {
  /** A structured code the harness or its stream produced, if any. */
  structuredCode?: string | null;
  /** The text of the failure (stderr, a stream record, an HTTP body). */
  text?: string | null;
  /**
   * The `failures` map of the descriptor; present only where the harness is
   * declared. Its presence makes it the only source.
   */
  failuresMap?: FailuresMap | null;
  /** The id of the harness, for the fix text of an authentication failure. */
  harness?: string | null;
};

/**
 * Classifies one failure (F109-FR-009): a structured code wins over a match
 * on text; what matches no entry is `agent_failure`; for a declared harness
 * the `failures` map is the only source.
 */
export function classify(input: ClassifyInput): Classification {
  const code = input.structuredCode ?? null;
  const text = input.text ?? "";
  // A declared harness: its `failures` map is the ONLY source. The text
  // rules do not run for it.
  if (input.failuresMap) {
    const kind = code === null ? UNKNOWN_FAILURE : readFailuresMap(input.failuresMap, code);
    return { kind, code, fix: fixFor(kind, input.harness ?? null) };
  }
  // A structured code wins over a match on text: a known code decides
  // through the built-in mapping of code to kind, and an unknown one is
  // still a code — it decides too, and reads as `agent_failure`.
  if (code !== null) {
    const kind = builtinCodeKind(code, text);
    return { kind, code, fix: fixFor(kind, input.harness ?? null) };
  }
  for (const rule of TEXT_RULES) {
    if (rule.match.test(text)) {
      return { kind: rule.kind, code: null, fix: rule.fix };
    }
  }
  return { kind: UNKNOWN_FAILURE, code: null, fix: null };
}

/** The built-in mapping of a structured code to its kind. */
export const BUILTIN_CODES: readonly {
  code: RegExp;
  kind: TypedFailure;
}[] = Object.freeze([
  {
    code: /(?:401|403|unauthorized|invalid_api_key|authentication)/i,
    kind: "authentication_failed",
  },
  { code: /(?:429|rate_limit)/i, kind: "rate_limited" },
  { code: /(?:quota|billing|insufficient)/i, kind: "quota_exhausted" },
  { code: /(?:context_window|context_length|token_limit)/i, kind: "context_window_exceeded" },
  { code: /(?:econn|etimedout|enotfound|transport|network|fetch)/i, kind: "transport_failed" },
]);

function builtinCodeKind(code: string, text: string): TypedFailure {
  for (const rule of BUILTIN_CODES) {
    if (rule.code.test(code)) return rule.kind;
  }
  // The code decides, but names nothing the vocabulary knows: what matches
  // no entry is `agent_failure` — even where the text would have matched.
  void text;
  return UNKNOWN_FAILURE;
}

/** What to fix, per kind; an authentication failure always names it. */
function fixFor(kind: TypedFailure, harness: string | null): string | null {
  if (kind === "authentication_failed") {
    const who = harness ? ` for ${harness}` : "";
    return (
      `check the credential${who}: set the key the harness expects in the ` +
      "environment its allow-list carries"
    );
  }
  for (const rule of TEXT_RULES) {
    if (rule.kind === kind) return rule.fix;
  }
  return null;
}
