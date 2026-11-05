/**
 * T001 — the ingress of `@specstride/observability` (feature 111).
 *
 * The package graph names this package the INGRESS package: all text that
 * enters from outside the runtime passes here, and nowhere else (F100-FR-009,
 * F111-FR-023). F100-FR-221 adds what the ingress must do with such text
 * before it can reach a prompt: it is wrapped in a RANDOM BOUNDARY PER CALL,
 * it is rendered as text, it is never echoed into a host session by default,
 * and it is never parsed for a control record.
 *
 * This module holds the boundary primitive alone. The redactor, the limits and
 * the retention policy arrive with T040 in `src/ingress/`; the rules and the
 * versioned pattern set with T042 in `@specstride/kernel`.
 */
import { randomBytes } from "node:crypto";

/** How many random bytes a boundary token carries (128 bits). */
export const BOUNDARY_BYTES = 16;

/** The stem every boundary token starts with, so a reader can see the frame. */
export const BOUNDARY_STEM = "SPECSTRIDE-OUTSIDE" as const;

/**
 * A fresh boundary token. A new random nonce is drawn on EVERY call, so no
 * outside text can close the frame that holds it (F100-FR-221).
 */
export function freshBoundary(): string {
  return `${BOUNDARY_STEM}-${randomBytes(BOUNDARY_BYTES).toString("hex")}`;
}

/** Outside text inside its frame, with the token that opens and closes it. */
export type FramedText = {
  /** The random boundary token of this call. */
  readonly boundary: string;
  /** The framed text: the open token, the text, the close token. */
  readonly framed: string;
};

/**
 * Wrap outside text in a random boundary per call. The text is rendered as
 * text: it is neither parsed nor interpreted here, and a value of the text
 * that looks like the token cannot forge the frame, because the token is drawn
 * fresh for this call and is returned beside the frame.
 */
export function frameOutsideText(text: string, boundary: string = freshBoundary()): FramedText {
  return Object.freeze({
    boundary,
    framed: `<<<${boundary}>>>\n${text}\n<<<END ${boundary}>>>`,
  });
}

/**
 * True when the token is a boundary this module drew: the stem, then exactly
 * `BOUNDARY_BYTES` bytes in lower-case hexadecimal.
 */
export function isBoundary(token: string): boolean {
  return new RegExp(`^${BOUNDARY_STEM}-[0-9a-f]{${BOUNDARY_BYTES * 2}}$`).test(token);
}

/**
 * F100-FR-221 — what the ingress does with text from outside the runtime. The
 * list is the record of the rule this module serves; the static check of the
 * test kit reads it.
 */
export const INGRESS_RULES = [
  "wrapped in random boundaries per call when it enters a prompt",
  "never echoed into a host session by default",
  "rendered as text",
  "never parsed for control records",
] as const;

/** Nothing of the ingress is echoed into a host session unless asked for. */
export const ECHOED_INTO_A_HOST_SESSION_BY_DEFAULT = false as const;
