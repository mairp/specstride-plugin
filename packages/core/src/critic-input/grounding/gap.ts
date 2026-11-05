// Feature 117 (T039) — the grounding gap and its prompt section
// (F117-FR-014), and the transparency section that is handed to the writer
// of the feedback (F117-FR-016).
//
// The grounding gap is every token that is loosely cited in the phase
// evidence or the section, that the extraction of F117-FR-003 did not
// return, and that resolves to a FILE on disk; a directory never is a gap.
// A gap that is not empty adds the as-is section
// `## CITED BUT NOT AUTO-GROUNDED — verified PRESENT by direct stat` to the
// prompt, and the feedback of the phase attempt ends with the as-is
// transparency section, one backticked line per gap file.

import { join } from "node:path";
import literals from "../data/as-is-literals.json" with { type: "json" };

import { resolveCitation, type ResolveContext } from "./resolve.ts";
import { throughIngress, type OutsideTextIngress } from "../ingress.ts";

export const GAP_HEADING = literals.gapHeading;
export const GAP_BODY = literals.gapBody;
export const GAP_LINE = literals.gapLine;
export const TRANSPARENCY_HEADING = literals.transparencyHeading;

/** One line of the gap section, in the as-is shape. */
export function gapLine(token: string): string {
  return GAP_LINE.replace("<token>", token);
}

/** The gap section of the prompt, or `undefined` when the gap is empty. */
export function renderGapSection(gap: readonly string[]): string | undefined {
  if (gap.length === 0) return undefined;
  const out: string[] = ["", GAP_HEADING, GAP_BODY, ""];
  for (const token of gap) out.push(gapLine(token));
  return out.join("\n");
}

/**
 * The transparency section of the feedback (F117-FR-016): the as-is heading
 * and one backticked line per gap file, which tells the proposer not to
 * create the file again. It is handed to the writer of the feedback; this
 * module writes nothing itself.
 *
 * The gap token comes from the phase evidence (outside text), so it passes the
 * ONE ingress of F100-FR-009 when the composition root wired one (T097);
 * where the ingress drops it the mark of dropped content stands in the
 * token's place and the line keeps its fixed sentence (F117-FR-044). Without
 * a wired ingress the token stands as it is, which is the shape the parity
 * fixtures compare.
 */
export function transparencySection(
  gap: readonly string[],
  ingress?: OutsideTextIngress | undefined,
): string | undefined {
  if (gap.length === 0) return undefined;
  const out: string[] = ["", TRANSPARENCY_HEADING];
  for (const token of gap) {
    const shown = throughIngress(token, ingress);
    out.push(
      `- \`${shown}\` exists on disk (verified by a direct read-only stat) — do not claim it is missing; do not create it again.`,
    );
  }
  return out.join("\n");
}

/** Tokens loosely cited (F117-FR-014) in one text: backticked or slash tokens. */
function looselyCited(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1]!.trim().replace(/[.,:;)]+$/, "");
    if (!token || /\s/.test(token)) continue;
    if (/^(?:https?|ftp):\/\//.test(token)) continue;
    if (!token.includes(".") && !token.includes("/")) continue;
    out.add(token);
  }
  return [...out].sort();
}

export interface GapInputs {
  /** The phase evidence of the attempt. */
  readonly phaseEvidence: string;
  /** The section of the phase. */
  readonly sectionText?: string;
  /** The tokens the extraction DID return (F117-FR-003), grounded or not. */
  readonly extractedTokens: readonly string[];
}

/**
 * The grounding gap (F117-FR-014): every token loosely cited in the phase
 * evidence or the section, that the extraction did not return, and that
 * resolves to a FILE on disk. A directory never is a gap; a refused path
 * never is one either (F117-FR-018).
 */
export function groundingGap(inputs: GapInputs, context: ResolveContext): string[] {
  const { workdir, io } = context;
  const extracted = new Set(inputs.extractedTokens);
  const gap: string[] = [];
  for (const token of looselyCited(inputs.phaseEvidence)) {
    if (extracted.has(token) || gap.includes(token)) continue;
    const resolution = resolveCitation(token, context);
    if (resolution.kind === "refused") continue;
    if (resolution.realPath === undefined) continue;
    if (
      io.stat(join(workdir, resolution.realPath))?.isFile !== true &&
      io.stat(resolution.realPath)?.isFile !== true
    ) {
      continue;
    }
    gap.push(token);
  }
  return gap;
}
