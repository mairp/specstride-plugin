/**
 * T087 — the one ingress of learning (F106-FR-040, F106-FR-021): the point
 * every text from outside the runtime passes BEFORE learning writes it.
 *
 * F106-FR-040: *Text that comes from outside the runtime and that learning
 * writes — the free-text `reason` of a learning event, the free-text members
 * of a decision entry, and every evaluation line the retrospective copies —
 * MUST pass the one ingress (the redaction point of annex A F100-FR-009,
 * F100-FR-205, LR-9) before it is written to the learning stream or to any
 * file of the learning writer domain. The learning stream is one sink of
 * F100-FR-205: it receives only the redacted form, and the ingress fails
 * closed as F100-FR-205 requires.*
 *
 * THERE IS ONE REDACTOR AND LEARNING HOLDS NO PATTERN SET. The redaction is
 * done by the redactor of annex X §X.4 (`@specstride/kernel`, the folder the
 * workspace's `redactionOutsideTheIngress` check names as allowed); this
 * module reaches it through ONE aliased import and adds nothing to it — no
 * pattern, no placeholder, no second implementation. The layering table
 * (`packages/contracts/data/package-graph.json`) forbids learning to import
 * `@specstride/observability`, so learning cannot call the sink wrapper of
 * feature 111 directly; it adapts the same kernel redactor that wrapper calls.
 *
 * FAIL CLOSED (F100-FR-205). The outcome is a union: a caller that ignores
 * `ok: false` has no text to write — the type carries the rule that a sink
 * never sees what the ingress refused. A redactor that cannot run (an
 * invalid pattern set) drops every text; the writers of this package treat a
 * drop as "write nothing" (F106-FR-021).
 */
import {
  createRedactor as theOneRedactorOfAnnexX4,
  type SpecstrideRedactor,
} from "@specstride/kernel";

/** Why a text was dropped, in the words of F100-FR-205. */
export type IngressDropMark = "redactor-unavailable" | "pattern-set-invalid";

/** The result of the ingress for one text: redacted text, or nothing. */
export type IngressOutcome =
  | {
      readonly ok: true;
      /** The redacted form — the ONLY form a sink of learning may write. */
      readonly text: string;
      /** True when the redactor replaced something. */
      readonly redacted: boolean;
    }
  | {
      readonly ok: false;
      readonly dropped: true;
      readonly mark: IngressDropMark;
      /** How many bytes arrived (the only honest fact about refused content). */
      readonly originalBytes: number;
      readonly reason: string;
    };

/** The ingress as learning's writers take it. */
export type LearningIngress = {
  /** Pass one text from outside the runtime through the redactor. */
  readonly text: (value: string) => IngressOutcome;
};

/** The ingress class every free text of learning travels under (annex X §X.6 row 89). */
export const LEARNING_INGRESS_CLASS = "free-text" as const;

/** The cap of that class, in bytes (annex X §X.6 row 89 / F111-FR-027). */
export const LEARNING_INGRESS_CAP_BYTES = 1024 as const;

/** Adapt the one redactor of annex X §X.4 into learning's ingress. */
export function ingressFromRedactor(redactor: SpecstrideRedactor): LearningIngress {
  return Object.freeze({
    text(value: string): IngressOutcome {
      const originalBytes = Buffer.byteLength(value, "utf8");
      if (redactor.unavailable !== undefined) {
        return {
          ok: false,
          dropped: true,
          mark: "redactor-unavailable",
          originalBytes,
          reason: `the redactor cannot run (${redactor.unavailable})`,
        };
      }
      try {
        const result = redactor.redact(value, LEARNING_INGRESS_CAP_BYTES);
        if (result.dropped) {
          return {
            ok: false,
            dropped: true,
            mark: "pattern-set-invalid",
            originalBytes,
            reason: result.reason ?? "the redactor refused the text",
          };
        }
        return Object.freeze({ ok: true, text: result.text, redacted: result.replacements > 0 });
      } catch (error) {
        // A throwing rule is a redactor that cannot run: drop (F100-FR-205).
        return {
          ok: false,
          dropped: true,
          mark: "redactor-unavailable",
          originalBytes,
          reason: (error as Error).message,
        };
      }
    },
  });
}

/** The ingress that refuses everything: what a caller uses with no redactor handed in. */
export function failClosedIngress(reason: string): LearningIngress {
  return Object.freeze({
    text(value: string): IngressOutcome {
      return {
        ok: false,
        dropped: true,
        mark: "redactor-unavailable",
        originalBytes: Buffer.byteLength(value, "utf8"),
        reason,
      };
    },
  });
}

let shared: LearningIngress | undefined;

/**
 * The ingress of the learning writer domain: the one redactor of annex X
 * §X.4, adapted once. A redactor that cannot be built makes an ingress that
 * drops everything — the writers then write nothing, which is the rule.
 */
export function learningIngress(): LearningIngress {
  if (shared === undefined) {
    try {
      shared = ingressFromRedactor(theOneRedactorOfAnnexX4());
    } catch (error) {
      shared = failClosedIngress(
        `the redactor of annex X §X.4 could not be built: ${(error as Error).message}`,
      );
    }
  }
  return shared;
}

/** The error a writer raises when the ingress refused a text: nothing is written. */
export class IngressRefused extends Error {
  readonly mark: IngressDropMark;
  constructor(mark: IngressDropMark, reason: string) {
    super(`learning ingress refused a text (${mark}): ${reason}; nothing was written`);
    this.name = "IngressRefused";
    this.mark = mark;
  }
}

/** The free-text members of a decision entry (F106-FR-040). */
export const DECISION_ENTRY_FREE_TEXT_MEMBERS: readonly string[] = Object.freeze([
  "reason",
  "note",
  "guardrail",
]);

/** The free-text members of a learning event (F106-FR-040). */
export const LEARNING_EVENT_FREE_TEXT_MEMBERS: readonly string[] = Object.freeze([
  "reason",
  "note",
  "guardrail",
]);

/**
 * Walk one written value and pass every free-text string through the
 * ingress, returning the redacted copy. A drop raises `IngressRefused`
 * BEFORE anything is opened for write, so the caller writes nothing
 * (F106-FR-040, F106-FR-021). Only the members the spec names free text are
 * touched; numbers, ids, enum members and the schema id go through as they
 * are.
 */
export function redactWrittenValue<T>(
  value: T,
  freeTextMembers: readonly string[],
  ingress: LearningIngress,
): T {
  return walk(value, "", ingress, freeTextMembers) as T;
}

function walk(
  value: unknown,
  member: string,
  ingress: LearningIngress,
  freeText: readonly string[],
): unknown {
  if (typeof value === "string") {
    if (!freeText.includes(member)) return value;
    const outcome = ingress.text(value);
    if (!outcome.ok) throw new IngressRefused(outcome.mark, outcome.reason);
    return outcome.text;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, member, ingress, freeText));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(item, key, ingress, freeText);
    }
    return out;
  }
  return value;
}

/**
 * Pass one copied line of text (an evaluation line the retrospective copies,
 * F106-FR-040) through the ingress. A dropped line comes back as `null`: the
 * caller writes nothing in its place and records that a line was withheld.
 */
export function ingressCopiedLine(
  line: string,
  ingress: LearningIngress = learningIngress(),
): string | null {
  const outcome = ingress.text(line);
  return outcome.ok ? outcome.text : null;
}
