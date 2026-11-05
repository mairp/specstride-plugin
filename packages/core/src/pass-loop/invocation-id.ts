/**
 * T018 of feature 103 — the INVOCATION IDS of a phase attempt and the DEBUG
 * RETENTION SWITCH (F103-FR-009).
 *
 * ## The two forms of an id, and why there are two
 *
 * | Form | When | Shape |
 * |---|---|---|
 * | derived | a base is given | `<base>-iter-<n>` |
 * | minted | no base is given | `inv-<pass number, zero-padded to six>-<eight hexadecimal characters>` |
 *
 * The derived form is the one a run takes: the engine hands the base
 * `<run-id>-<role>-phase-<N>-attempt-<M>`, with the run id in the as-is form
 * of F100-FR-046, and every pass of the attempt is that base with its pass
 * number. It is stable across a resume, which is what lets the retention of a
 * pass be found again after a relaunch.
 *
 * The minted form is the fallback for a call that has no base — a test, a
 * tool, a layer's stub pass. Its eight hexadecimal characters are random, so
 * two minted ids of the same pass number never collide; the zero-padded pass
 * number keeps a listing of them in pass order, which a random id alone would
 * not.
 *
 * ## The debug retention switch
 *
 * With the debug switch set, EVERY invocation of the phase attempt retains its
 * raw prompt and reply — the proposer's passes and the critic-class calls
 * alike, which is the part a reader is most likely to get wrong. The names are
 * logical, `pass:<passId>:prompt` and `pass:<passId>:response`, and this
 * module forms them and nothing more: WHAT retention holds and FOR HOW LONG is
 * the content of the stream feature, which `RETENTION_IS_OWNED_BY` names.
 */
import { randomBytes } from "node:crypto";

/** The requirement this module carries out. */
export const REQUIREMENT = "F103-FR-009" as const;

/** The requirement that fixes the as-is form of the run id. */
export const RUN_ID_FORM_REQUIREMENT = "F100-FR-046" as const;

/* ------------------------------------------------------------------ *
 * The base.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-009 — the base of the invocation ids of a request:
 * `<run-id>-<role>-phase-<N>-attempt-<M>`. The run id is handed in already in
 * the as-is form of F100-FR-046; this module forms no run id.
 */
export function invocationBaseOf(
  runId: string,
  role: string,
  phase: number,
  phaseAttempt: number,
): string {
  return `${runId}-${role}-phase-${phase}-attempt-${phaseAttempt}`;
}

/** The pattern a base of the derived form matches, for a test and a reader. */
export const BASE_PATTERN =
  /^(?<runId>.+)-(?<role>[^-]+)-phase-(?<phase>\d+)-attempt-(?<attempt>\d+)$/;

/* ------------------------------------------------------------------ *
 * The id of one pass.
 * ------------------------------------------------------------------ */

/** The two forms of an invocation id (F103-FR-009). */
export const ID_FORMS = ["derived", "minted"] as const;
export type InvocationIdForm = (typeof ID_FORMS)[number];

/** F103-FR-009 — the width the minted form zero-pads the pass number to. */
export const MINTED_PASS_NUMBER_WIDTH = 6 as const;

/** F103-FR-009 — how many hexadecimal characters the minted form carries. */
export const MINTED_HEX_CHARACTERS = 8 as const;

/** The head of the minted form. */
export const MINTED_PREFIX = "inv-" as const;

/** The pattern the minted form matches. */
export const MINTED_PATTERN = /^inv-\d{6}-[0-9a-f]{8}$/;

/** The source of the eight hexadecimal characters; a test hands a fixed one. */
export type HexSource = (characters: number) => string;

/** The one implementation, over `node:crypto`. */
export const CRYPTO_HEX: HexSource = (characters) =>
  randomBytes(Math.ceil(characters / 2))
    .toString("hex")
    .slice(0, characters);

/**
 * F103-FR-009 — the id of the invocation of a pass.
 *
 *  - with a base: `<base>-iter-<n>`;
 *  - without one: `inv-<pass number zero-padded to six>-<eight hexadecimal characters>`.
 */
export function invocationIdOfPass(
  passNumber: number,
  base?: string | undefined,
  hex: HexSource = CRYPTO_HEX,
): string {
  if (base !== undefined && base.length > 0) return `${base}-iter-${passNumber}`;
  const padded = String(passNumber).padStart(MINTED_PASS_NUMBER_WIDTH, "0");
  return `${MINTED_PREFIX}${padded}-${hex(MINTED_HEX_CHARACTERS)}`;
}

/** Which form an id took. */
export function formOf(id: string): InvocationIdForm {
  return MINTED_PATTERN.test(id) ? "minted" : "derived";
}

/* ------------------------------------------------------------------ *
 * The debug retention switch.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-009 — the two logical names under which an invocation retains its
 * raw prompt and reply.
 */
export const RETAINED_LOGICAL_NAMES = ["prompt", "response"] as const;
export type RetainedPart = (typeof RETAINED_LOGICAL_NAMES)[number];

/** The logical name of the raw prompt of a pass: `pass:<passId>:prompt`. */
export function promptLogicalName(passId: string): string {
  return `pass:${passId}:prompt`;
}

/** The logical name of the raw reply of a pass: `pass:<passId>:response`. */
export function responseLogicalName(passId: string): string {
  return `pass:${passId}:response`;
}

/**
 * F103-FR-009 — with the debug switch set, EVERY invocation of the phase
 * attempt retains its raw prompt and reply: the proposer's passes AND the
 * critic-class calls. The classes are named so that a caller cannot read the
 * rule as "the proposer's passes only".
 */
export const CLASSES_THAT_RETAIN_UNDER_DEBUG = ["proposer", "critic-class"] as const;
export type RetainingClass = (typeof CLASSES_THAT_RETAIN_UNDER_DEBUG)[number];

/** True when the class retains under the debug switch; both classes do. */
export function retainsUnderDebug(invocationClass: string): boolean {
  return (CLASSES_THAT_RETAIN_UNDER_DEBUG as readonly string[]).includes(invocationClass);
}

/**
 * F103-FR-009 — what retention HOLDS and FOR HOW LONG is the content of the
 * stream feature. This module forms the names; it keeps nothing and expires
 * nothing.
 */
export const RETENTION_IS_OWNED_BY = Object.freeze({
  feature: "the stream feature",
  whatThisModuleDecides: "the two logical names, and whether the switch is on",
  whatItDoesNotDecide: "what retention holds, where it is stored, and for how long",
});

/** What the debug switch asks of one invocation. */
export type Retention = {
  /** True when the raw prompt and reply are retained. */
  readonly retained: boolean;
  /** The logical name of the raw prompt, when it is retained. */
  readonly promptName?: string;
  /** The logical name of the raw reply, when it is retained. */
  readonly responseName?: string;
};

/**
 * F103-FR-009 — the retention of one invocation under the debug switch. With
 * the switch off nothing is retained and no name is formed.
 */
export function retentionOf(passId: string, debug: boolean): Retention {
  if (!debug) return Object.freeze({ retained: false });
  return Object.freeze({
    retained: true,
    promptName: promptLogicalName(passId),
    responseName: responseLogicalName(passId),
  });
}
