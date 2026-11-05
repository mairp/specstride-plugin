/**
 * T006 and T011 of feature 101 — the nonce verdict parser, EXTRACTED AS SOURCE
 * from the Lisa baseline and then brought to the grammar of the Specstride
 * baseline (F101-FR-007, F101-FR-008).
 *
 * ## Extraction (T006)
 *
 * | Item | Value |
 * |---|---|
 * | Source tree | `<lisa>` at local `main` `363e6a392ff6e59ec4905c044fb3b0a5239cbffc` ("chore: license the project under MIT", 2026-09-27 22:19:19 +0400), the tree DP-013 names for the 18 packages |
 * | Source file | `packages/core/src/critic/verdict.ts`, 332 lines, sha256 `b9150be02cc646274f4ed782279f544b30d7707edc13e03526f5244d7d1c33ba` |
 * | Read with | `git -C <lisa> show 363e6a3:packages/core/src/critic/verdict.ts` — the baseline is read-only and was never written to |
 * | What was taken | The nonce verdict parser: `newNonce` (to `./nonce.ts`), `ParsedVerdict`, `parseVerdict`, `isApproval` and the helper `escapeRegExp`. The prompt assembly, the grounding assembly and the feedback assembly of the same file were NOT taken: they belong to other tasks of this feature and to feature 110 |
 *
 * **Licence note.** `<lisa>` at `363e6a3` carries `LICENSE` = the MIT
 * Licence, "Copyright (c) 2026 mairp", sha256
 * `ebcf480ee37cc93ed60bd5c460b5f1453ca008a0818469a7a8e51e9c8487e8ab`.
 * This repository's own `LICENSE` has the SAME sha256 and the same holder, and
 * `packages/core/package.json` at `363e6a3` declares `"license": "MIT"` for
 * `@lisa/core`, the package the file comes from. MIT into MIT with one holder:
 * compatible, and the attribution above is the notice the licence asks for.
 * The full record, with every mechanical change, is `packages/core/EXTRACTED.md`.
 *
 * The extracted parser is kept VERBATIM in behaviour as
 * `parseVerdictAsExtracted` below, so that the characterization tests
 * CT-101-8 and CT-101-10 can pin what was extracted and the differences T011
 * repairs are observable and not merely asserted.
 *
 * ## The grammar of the baseline (T011)
 *
 * `parseVerdict` is the parser the feature uses. It carries out
 * `specs/101-gate-and-verdict/contracts/verdict-grammar.md`: a WHOLE line,
 * ANYWHERE in the reply, case NOT regarded, EXACTLY ONE matching line, and
 * agreeing duplicates are MALFORMED (B-0975, B-0978, B-0979). The three
 * differences from the extracted parser are listed at `parseVerdict` and
 * recorded in `tests/characterization/101/README.md`.
 *
 * A verdict comes from the reply of a critic call and from nothing else
 * (F101-FR-008): this module is handed a reply and knows no file, so a line in
 * the form of a verdict in phase evidence, in a grounded file, in feedback, in
 * a ledger record, in a row of the fact block or in the result of an inner
 * check can never reach it.
 */
import { type MalformedDetail, isMalformedDetail } from "@specstride/contracts/enums/gate";

/* ------------------------------------------------------------------ *
 * The three verdicts.
 * ------------------------------------------------------------------ */

/**
 * The three verdicts, as the baseline's `VERDICT_RESULTS` holds them
 * (`packages/core/src/domain/index.ts:391` at `363e6a3`). MALFORMED is a
 * recorded outcome of its own that counts as a rejection (F101-FR-008).
 */
export const VERDICT_RESULTS = ["APPROVED", "REJECTED", "MALFORMED"] as const;

/** One of the three verdicts (F101-FR-008). */
export type VerdictResult = (typeof VERDICT_RESULTS)[number];

/** F101-FR-008 — only APPROVED counts as an approval; MALFORMED is a rejection. */
export const MALFORMED_COUNTS_AS_A_REJECTION = true as const;

/* ------------------------------------------------------------------ *
 * The extracted parser, unchanged in behaviour (T006).
 * ------------------------------------------------------------------ */

/** The shape the extracted parser returns (Lisa `ParsedVerdict`, lines 45-48). */
export interface ParsedVerdictAsExtracted {
  result: VerdictResult;
  /** The as-is text of the parse: one of the three MALFORMED texts, or `ok`. */
  detail: string;
}

/**
 * Lisa's `escapeRegExp` (lines 330-332), taken verbatim. Kept because
 * `parseVerdictAsExtracted` interpolates the nonce into a pattern and the
 * extraction may not change what it does.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The EXTRACTED parser, unchanged in behaviour (T006): Lisa's `parseVerdict`
 * of `packages/core/src/critic/verdict.ts:56-76` at `363e6a3`, with the two
 * mechanical changes `packages/core/EXTRACTED.md` records (the non-null
 * assertions become a guard that cannot change the outcome, and the return
 * type is this module's interface). The regular expressions, their flags, the
 * order of the three branches and all three detail texts are the baseline's.
 *
 * It is NOT the parser the feature uses — `parseVerdict` below is. It stands
 * so that T011's repairs are witnessed against what was extracted.
 */
export function parseVerdictAsExtracted(
  reply: string | null | undefined,
  nonce: string,
): ParsedVerdictAsExtracted {
  const text = reply ?? "";
  const strict = new RegExp(
    `^\\s*VERDICT\\s+${escapeRegExp(nonce)}\\s*:\\s*(APPROVED|REJECTED)\\s*$`,
    "gim",
  );
  const matches = [...text.matchAll(strict)];
  if (matches.length === 0) {
    // Did the model emit a verdict with the WRONG (or no) nonce? Record why.
    const loose = /^\s*VERDICT\b.*:(.*)$/im.test(text);
    if (loose) {
      return { result: "MALFORMED", detail: "verdict line present but nonce missing/mismatched" };
    }
    return { result: "MALFORMED", detail: "no verdict line found" };
  }
  if (matches.length > 1) {
    return { result: "MALFORMED", detail: `multiple verdict lines (${matches.length})` };
  }
  const found = (matches[0]?.[1] ?? "").toUpperCase();
  return { result: found === "APPROVED" ? "APPROVED" : "REJECTED", detail: "ok" };
}

/**
 * Lisa's `isApproval` (lines 79-81), taken verbatim: ONLY a clean APPROVED
 * approves the gate (F101-FR-008).
 */
export function isApproval(result: VerdictResult): boolean {
  return result === "APPROVED";
}

/* ------------------------------------------------------------------ *
 * The grammar of the baseline (T011).
 * ------------------------------------------------------------------ */

/**
 * A blank of the grammar: white space that is NOT a line end. The grammar says
 * "a whole line", so no blank of it may cross a line end — this is the class
 * that makes the difference D-1 below impossible.
 */
const BLANK = "[^\\S\\n\\r\\u2028\\u2029]";

/** The three kinds of line end the grammar accepts, longest first. */
export const LINE_ENDS = ["\r\n", "\n", "\r"] as const;

/** The splitter of the three kinds of line end (T108: line ends of three kinds). */
const LINE_END = /\r\n|\n|\r/;

/**
 * The whole-line rule of `contracts/verdict-grammar.md`, row "Line": optional
 * blanks, `VERDICT`, blanks, the nonce, optional blanks, a colon, optional
 * blanks, `APPROVED` or `REJECTED`, optional blanks — and nothing else on the
 * line. Case is not regarded (`i`, B-0975, B-0979). The nonce is CAPTURED and
 * compared afterwards; it is never interpolated into the pattern, so no reply
 * can shape the pattern itself.
 */
const VERDICT_LINE = new RegExp(
  `^${BLANK}*VERDICT${BLANK}+([^\\s:]+)${BLANK}*:${BLANK}*(APPROVED|REJECTED)${BLANK}*$`,
  "i",
);

/**
 * A line that LOOKS like a verdict line, as the baseline decides whether to
 * say `nonce-mismatch` rather than `no-verdict-line`. It is the baseline's
 * loose pattern, applied to ONE line, so the `.` of it cannot reach a second
 * line (B-0976).
 */
const LOOKS_LIKE_A_VERDICT_LINE = /^\s*VERDICT\b.*:/i;

/** A nonce of a call: 16 lower-case hexadecimal characters (F101-FR-006). */
export const NONCE_PATTERN = /^[0-9a-f]{16}$/;

/** True when the text is a nonce of a call in the form F101-FR-006 asks for. */
export function isNonce(value: string): boolean {
  return NONCE_PATTERN.test(value);
}

/**
 * The as-is text of each detail of a MALFORMED verdict
 * (`contracts/verdict-grammar.md`, section MALFORMED; B-0976, B-0977, B-0978;
 * 002 FR-011 for `call-failed`). `multiple-verdict-lines` takes the count, and
 * `call-failed` takes the text the harness adapter gives.
 */
export const MALFORMED_TEXT: Readonly<Record<MalformedDetail, (argument?: unknown) => string>> =
  Object.freeze({
    "nonce-mismatch": () => "verdict line present but nonce missing/mismatched",
    "no-verdict-line": () => "no verdict line found",
    "multiple-verdict-lines": (count?: unknown) => `multiple verdict lines (${String(count)})`,
    "call-failed": (text?: unknown) => String(text ?? ""),
  });

/** The as-is text of the field `parse:` of a verdict record for a verdict that parsed (B-0876). */
export const PARSE_OK = "ok" as const;

/** What `parseVerdict` returns for a reply that gave a verdict. */
export type VerdictParsed = {
  readonly result: "APPROVED" | "REJECTED";
  /** No detail: a detail stands only with MALFORMED (row 251 of annex X §X.6). */
  readonly detail?: undefined;
  /** The as-is text of `parse:`. */
  readonly detailText: typeof PARSE_OK;
  /** The whole line the verdict was read from, as it stood in the reply. */
  readonly line: string;
};

/** What `parseVerdict` returns for every other reply: MALFORMED, the safe failure. */
export type VerdictMalformed = {
  readonly result: "MALFORMED";
  /** A member of the closed set of row 251 of annex X §X.6. */
  readonly detail: MalformedDetail;
  /** The as-is text of the detail. */
  readonly detailText: string;
  readonly line?: undefined;
};

/** The result of the parse: a verdict, or MALFORMED with a detail of the closed set. */
export type ParsedVerdict = VerdictParsed | VerdictMalformed;

/** MALFORMED with a detail of the closed set and its as-is text. */
function malformed(detail: MalformedDetail, argument?: unknown): VerdictMalformed {
  return { result: "MALFORMED", detail, detailText: MALFORMED_TEXT[detail](argument) };
}

/**
 * The reply as text. Bytes that are no valid text are decoded with the
 * replacement character and never thrown on (T108): a gate that throws on a
 * reply would be a gate that stops, and MALFORMED is the safe failure.
 */
function asText(reply: string | Uint8Array | null | undefined): string {
  if (reply === null || reply === undefined) return "";
  if (typeof reply === "string") return reply;
  return new TextDecoder("utf-8", { fatal: false }).decode(reply);
}

/**
 * F101-FR-007 — parse the verdict from the reply of ONE critic call, by the
 * grammar of `contracts/verdict-grammar.md`. The reply is split into lines on
 * all three kinds of line end and every line is matched WHOLE, so the place of
 * the line in the reply does not matter and a verdict inside a longer line is
 * no verdict. Exactly one line that carries the nonce of the call gives its
 * verdict, read in upper case. Every other reply gives MALFORMED with one of
 * the three details, agreeing duplicates included (B-0978).
 *
 * ### The three differences from `parseVerdictAsExtracted` (T011)
 *
 * | # | The extracted behaviour | The grammar of the baseline | Why it matters |
 * |---|---|---|---|
 * | D-1 | `\s` of `^\s*VERDICT\s+<nonce>…$` matches a line end too, so `VERDICT` on one line and `<nonce>: APPROVED` on the next IS a match | `BLANK` holds no line end, so such a reply is `nonce-mismatch` | A partial line split over two lines must not approve: the grammar says "a whole line" (B-0975) |
 * | D-2 | The nonce is interpolated into the pattern through `escapeRegExp` | The nonce is CAPTURED and compared | The pattern no longer depends on the reply or on the nonce at all |
 * | D-3 | `detail` is an as-is text, and `ok` on success; there is no member of a closed set | `detail` is a member of row 251 of annex X §X.6 and `detailText` carries the as-is text | The verdict record and the ledger need the member; compatibility output needs the text (F101-FR-012) |
 *
 * Everything else is the extracted behaviour: the three detail texts, the
 * order of the branches, the count in `multiple verdict lines (<n>)`, the
 * upper-case reading of the word, and MALFORMED as the safe failure.
 *
 * A nonce that is not of the form F101-FR-006 asks for belongs to no call, so
 * nothing can carry it: the result is MALFORMED `nonce-mismatch`, never a
 * thrown error and never an approval.
 */
export function parseVerdict(
  reply: string | Uint8Array | null | undefined,
  nonce: string,
): ParsedVerdict {
  const text = asText(reply);
  const lines = text.split(LINE_END);
  if (!isNonce(nonce)) return malformed("nonce-mismatch");

  const carriesTheNonce: { word: string; line: string }[] = [];
  let looksLikeOne = false;
  for (const line of lines) {
    const match = VERDICT_LINE.exec(line);
    if (match === null) {
      if (LOOKS_LIKE_A_VERDICT_LINE.test(line)) looksLikeOne = true;
      continue;
    }
    // Case is not regarded (B-0975): a hexadecimal nonce in another case is
    // the same 64 bits, which is what "the exact nonce" means here.
    if ((match[1] ?? "").toLowerCase() === nonce) {
      carriesTheNonce.push({ word: (match[2] ?? "").toUpperCase(), line });
    } else {
      looksLikeOne = true;
    }
  }

  if (carriesTheNonce.length === 0) {
    return malformed(looksLikeOne ? "nonce-mismatch" : "no-verdict-line");
  }
  if (carriesTheNonce.length > 1) {
    // Agreeing duplicates are MALFORMED as well (B-0978).
    return malformed("multiple-verdict-lines", carriesTheNonce.length);
  }
  const only = carriesTheNonce[0] as { word: string; line: string };
  return {
    result: only.word === "APPROVED" ? "APPROVED" : "REJECTED",
    detailText: PARSE_OK,
    line: only.line,
  };
}

/**
 * The detail of a parse as a member of row 251, for a reader that holds only
 * the as-is text. `call-failed` is the unknown value of the row, so a text no
 * rule of this module wrote is read as a failed call and the verdict stays
 * MALFORMED.
 */
export function detailOfText(text: string): MalformedDetail {
  if (text === MALFORMED_TEXT["no-verdict-line"]()) return "no-verdict-line";
  if (text === MALFORMED_TEXT["nonce-mismatch"]()) return "nonce-mismatch";
  if (/^multiple verdict lines \(\d+\)$/.test(text)) return "multiple-verdict-lines";
  return "call-failed";
}

/** A failed call of the transport: MALFORMED `call-failed` with the adapter's text (002 FR-011). */
export function verdictOfAFailedCall(asIsText: string): VerdictMalformed {
  return malformed("call-failed", asIsText);
}

/** Every detail this module can return is a member of row 251 (F101-FR-007). */
export function detailIsAMemberOfTheClosedSet(detail: string): boolean {
  return isMalformedDetail(detail);
}
