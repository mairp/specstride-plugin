// Feature 117 (T037) — excerpts and byte budgets of the grounding snapshot
// (F117-FR-011), from the as-is numbers of `data/budgets.json`.
//
// The byte budget of the snapshot is 327680 bytes at a window of 200000
// tokens; every budget is scaled by the window divided by 200000, with 3.18
// bytes per token for every harness, and never below 65536 bytes. A priority
// file no larger than the anchor ceiling is given WHOLE, line-numbered. A
// whole file that would exceed the budget degrades to an ANCHORED excerpt,
// and that to a HEAD-AND-TAIL excerpt. Priority files draw on the full
// scaled budget, every other file on half of it, both from ONE running
// total. A file whose excerpt does not fit keeps its presence line and
// carries the as-is omitted line.
//
// Pure module: it holds bytes and texts only; the caller reads the file
// through the port.

import budgetsData from "../data/budgets.json" with { type: "json" };
import { canonicalHasher } from "@specstride/kernel/hasher";

export const BUDGETS = budgetsData;

/** The budget of the snapshot at the reference window (F117-FR-011). */
export const GROUNDING_BUDGET_BYTES = budgetsData.groundingBudgetBytes;
/** The reference window the budget is stated at. */
export const REFERENCE_WINDOW_TOKENS = budgetsData.referenceWindowTokens;
/** Bytes per token, for every harness. */
export const BYTES_PER_TOKEN = budgetsData.bytesPerToken;
/** The floor of every scaled budget. */
export const MIN_SCALED_BUDGET_BYTES = budgetsData.minScaledBudgetBytes;
/** The anchor ceiling (F117-FR-002, default 49152 bytes). */
export const ANCHOR_CEILING_BYTES = budgetsData.anchorCeilingBytes;
/** Lines before and after every anchor line of an anchored excerpt. */
export const ANCHOR_LINES_AROUND = budgetsData.anchorLinesAround;
/** The per-file floor of the anchored-excerpt cap. */
export const ANCHOR_MIN_CAP_BYTES = budgetsData.anchorMinCapBytes;
/** Only the first this many bytes of a file are searched for anchors. */
export const ANCHOR_SEARCH_BYTES = budgetsData.anchorSearchBytes;
/** Head-and-tail excerpt bytes. */
export const HEAD_BYTES = budgetsData.headBytes;
export const TAIL_BYTES = budgetsData.tailBytes;
/** A file longer than this gets a tail as well as a head. */
export const HEAD_TAIL_THRESHOLD_BYTES = budgetsData.headTailThresholdBytes;

/** The as-is texts the excerpt lines use (`data/as-is-literals.json`). */
import literals from "../data/as-is-literals.json" with { type: "json" };
export const EXCERPT_OMITTED_LINE = literals.excerptOmitted;
export const WHOLE_FILE_LABEL = literals.wholeFileLabel;
export const HEAD_TAIL_JOIN = literals.headTailJoin;
const ANCHOR_TRUNCATED_LINE = "… (anchored excerpt truncated at <n> bytes)";

/**
 * The scaled budget of the snapshot for one window (F117-FR-011): the as-is
 * budget scaled by the window divided by the 200000-token reference window,
 * never below 65536 bytes. The window is the consumer's set window where it
 * is set, else the window of the harness, converted with 3.18 bytes per
 * token for every harness.
 */
export function scaledBudgetBytes(windowTokens: number): number {
  const referenceBytes = REFERENCE_WINDOW_TOKENS * BYTES_PER_TOKEN;
  const scaled = Math.floor(
    (GROUNDING_BUDGET_BYTES * windowTokens * BYTES_PER_TOKEN) / referenceBytes,
  );
  return Math.max(MIN_SCALED_BUDGET_BYTES, scaled);
}

/** A whole file excerpt: every line, line-numbered, with the as-is label. */
export function wholeFileExcerpt(text: string): string {
  const numbered = text
    .split("\n")
    .map((line, i) => `${i + 1}\t${line}`)
    .join("\n");
  return `${numbered}\n${WHOLE_FILE_LABEL}`;
}

/**
 * The anchor tokens of a section (F117-FR-011): the backticked identifiers
 * and dotted calls of the section that hold no slash and no source
 * extension and have at least 3 characters; a dotted token also gives its
 * last segment.
 */
export function anchorTokensOf(section: string): string[] {
  const out = new Set<string>();
  for (const m of section.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1]!.trim();
    if (token.length < 3) continue;
    if (token.includes("/") || token.includes(" ") || /\.[A-Za-z][A-Za-z0-9]{1,11}$/.test(token)) {
      continue;
    }
    out.add(token);
    if (token.includes(".")) out.add(token.split(".").pop()!);
  }
  return [...out];
}

/** A line holds an anchor when the anchor stands in it as a whole word. */
function lineHoldsAnchor(line: string, anchors: readonly string[]): boolean {
  return anchors.some((anchor) =>
    new RegExp(`\\b${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line),
  );
}

/**
 * An anchored excerpt (F117-FR-011): 15 lines before and after every line
 * that holds an anchor token, with line numbers, merged windows separated by
 * `…`, capped per file at the smaller of the anchor ceiling and the larger
 * of 6000 bytes and the file size, searching only the first 512 KB, and
 * ending with the truncation line when cut.
 */
export function anchoredExcerpt(
  text: string,
  anchors: readonly string[],
  fileSize: number,
): { text: string; truncatedAt: number | undefined } {
  const cap = Math.min(ANCHOR_CEILING_BYTES, Math.max(ANCHOR_MIN_CAP_BYTES, fileSize));
  const searched = text.length > ANCHOR_SEARCH_BYTES ? text.slice(0, ANCHOR_SEARCH_BYTES) : text;
  const lines = searched.split("\n");
  const wanted = new Set<number>();
  if (anchors.length === 0) {
    for (let i = 0; i < Math.min(lines.length, 30); i++) wanted.add(i);
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (!lineHoldsAnchor(lines[i]!, anchors)) continue;
      for (
        let j = Math.max(0, i - ANCHOR_LINES_AROUND);
        j <= Math.min(lines.length - 1, i + ANCHOR_LINES_AROUND);
        j++
      ) {
        wanted.add(j);
      }
    }
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const pieces: string[] = [];
  let bytes = 0;
  let truncatedAt: number | undefined;
  let run: number[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    const block = run.map((i) => `${i + 1}\t${lines[i]}`).join("\n");
    if (bytes + block.length > cap && pieces.length > 0) {
      truncatedAt = cap;
      run = [];
      return;
    }
    if (bytes + block.length > cap) {
      // Keep the first lines of the first window that fit, then cut.
      const kept: string[] = [];
      for (const i of run) {
        const line = `${i + 1}\t${lines[i]}`;
        if (bytes + line.length + 1 > cap) break;
        kept.push(line);
        bytes += line.length + 1;
      }
      if (kept.length > 0) pieces.push(kept.join("\n"));
      truncatedAt = cap;
      run = [];
      return;
    }
    bytes += block.length + 1;
    pieces.push(block);
    run = [];
  };
  for (let k = 0; k < sorted.length; k++) {
    if (k > 0 && sorted[k] !== sorted[k - 1]! + 1) {
      flushRun();
      if (truncatedAt !== undefined) break;
    }
    run.push(sorted[k]!);
  }
  flushRun();
  let text2 = pieces.join("\n…\n");
  if (truncatedAt !== undefined) {
    text2 += "\n" + ANCHOR_TRUNCATED_LINE.replace("<n>", String(truncatedAt));
  }
  return { text: text2, truncatedAt };
}

/** A head-and-tail excerpt (F117-FR-011): the first 4000 bytes and, past 5000, the last 1000. */
export function headTailExcerpt(text: string): { text: string; head: string; tail: string } {
  const head = text.slice(0, HEAD_BYTES);
  const tail = text.length > HEAD_TAIL_THRESHOLD_BYTES ? text.slice(-TAIL_BYTES) : "";
  return {
    head,
    tail,
    text: tail === "" ? head : `${head}\n${HEAD_TAIL_JOIN}\n${tail}`,
  };
}

/** One file's excerpt decision, as the snapshot builder renders it. */
export type ExcerptKind = "whole" | "anchored" | "head-tail" | "omitted" | "none";

export interface Excerpt {
  readonly kind: ExcerptKind;
  /** The rendered excerpt text, without the fenced block. */
  readonly text: string;
}

export interface ExcerptFileInput {
  /** The path as the presence line shows it. */
  readonly label: string;
  /** The bytes of the file, as read through the port. */
  readonly bytes: Uint8Array;
  /** True when the file is a priority file (full budget; others get half). */
  readonly priority: boolean;
}

export interface ExcerptBudgetContext {
  /** The window of the call, in tokens (0 uses the reference window). */
  readonly windowTokens: number;
  /** The anchor tokens of the phase section (`anchorTokensOf`). */
  readonly anchors: readonly string[];
}

/** One running excerpt budget over the files of the snapshot (F117-FR-011). */
export class ExcerptBudget {
  readonly budget: number;
  used = 0;

  constructor(windowTokens: number) {
    this.budget =
      windowTokens > 0
        ? scaledBudgetBytes(windowTokens)
        : scaledBudgetBytes(REFERENCE_WINDOW_TOKENS);
  }

  get bytesLeft(): number {
    return Math.max(0, this.budget - this.used);
  }

  /**
   * The excerpt of one file: whole, anchored, head-and-tail, or the as-is
   * omitted line. A priority file draws on the FULL budget, every other file
   * on HALF of it — both from this one running total.
   */
  excerptOf(input: ExcerptFileInput, anchors: readonly string[]): Excerpt {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const size = input.bytes.length;
    const limit = input.priority ? this.bytesLeft : Math.floor(this.bytesLeft / 2);
    const charge = (n: number): void => {
      this.used += n;
    };
    // Whole file: a priority file no larger than the anchor ceiling.
    if (input.priority && size <= ANCHOR_CEILING_BYTES && size + 1 <= limit) {
      charge(size + 1);
      return { kind: "whole", text: wholeFileExcerpt(text) };
    }
    // Anchored excerpt, then head-and-tail; the budget decides the fallback.
    if (anchors.length > 0) {
      const anchored = anchoredExcerpt(text, anchors, size);
      if (anchored.truncatedAt === undefined && anchored.text.length + 1 <= limit) {
        charge(anchored.text.length + 1);
        return { kind: "anchored", text: anchored.text };
      }
    }
    if (size <= HEAD_TAIL_THRESHOLD_BYTES && size + 1 <= limit) {
      charge(size + 1);
      return { kind: "head-tail", text: headTailExcerpt(text).text };
    }
    const headTail = headTailExcerpt(text);
    const cost = headTail.text.length + 1;
    if (cost <= limit) {
      charge(cost);
      return { kind: "head-tail", text: headTail.text };
    }
    // The excerpt does not fit: the presence line stays, the as-is line follows.
    return { kind: "omitted", text: EXCERPT_OMITTED_LINE };
  }
}

/** The fingerprint of one excerpt, through the canonical hasher of annex X §X.5. */
export function excerptFingerprint(text: string): string {
  return canonicalHasher.contentHash(text).slice(0, 16);
}
