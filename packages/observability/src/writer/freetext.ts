/**
 * T027 — the references and the caps of the free-text fields (F111-FR-016).
 *
 * *No event MUST hold content. A prompt, a reply, the body of a tool argument
 * and the output of a command MUST be referred to by logical name, hash and
 * size. Every free-text field of an event MUST have passed the redaction
 * ingress and MUST be cut to the cap of its class. The free-text fields are
 * those that the catalogue marks ... each with its ingress class; the mark is
 * the only list ... A type that is added with a field of free text MUST mark
 * it.*
 *
 * THE MARK IS THE ONLY LIST. `enforceFreeText` reads the marks of the row and
 * touches nothing else. A field the catalogue does not mark is left exactly as
 * it came — not because it is safe, but because the catalogue is where safety
 * is declared, and a second list here would be a second place to forget.
 * `unmarkedFreeTextCandidates` is the other half of that bargain: it looks for
 * a field that WOULD hold free text and carries no mark, and the build fails
 * on one.
 *
 * REDACT FIRST, CUT SECOND, MEASURE BEFORE (research D-7, B-2216). The order
 * matters in both directions. Cutting first could leave half of a secret
 * whose other half the pattern needed to match it. And `originalBytes` is
 * taken before redaction, because what a reader wants to know is how much
 * text there WAS, not how much was left after the placeholders went in.
 *
 * THE CUT IS IN BYTES AND NEVER SPLITS A CHARACTER. A cap is a byte budget,
 * but a half-written UTF-8 character is not text; `capBytes` steps back to the
 * last whole character rather than hand on a replacement glyph.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  AN_EVENT_HOLDS_CONTENT as F100_AN_EVENT_HOLDS_CONTENT,
  CONTENT_REFERENCE_FIELDS as F100_CONTENT_REFERENCE_FIELDS,
} from "@specstride/contracts/envelope/event";
import {
  CATALOGUE,
  CATALOGUE_BY_TYPE,
  closedSetMembersOf,
  isThirdPartyType,
  type FreeTextMark,
} from "../catalogue/index.ts";
import { refinedDataSchemaOf } from "../catalogue/types/index.ts";

/** F111-FR-016 — no event holds content. */
export const AN_EVENT_HOLDS_CONTENT = F100_AN_EVENT_HOLDS_CONTENT;

/** Content is referred to by logical name, hash and size. */
export const CONTENT_REFERENCE_FIELDS = F100_CONTENT_REFERENCE_FIELDS;

/** The nine ingress classes: annex X §X.6 row 89. */
export const INGRESS_CLASSES: readonly string[] = Object.freeze([
  ...(closedSet(89)?.members ?? []),
]);

/**
 * The cap of each class, in bytes (`data-model.md`, "Ingress classes and
 * limits"). The first five come from B-2213; the last four are the one
 * setting `observability.limits.freeText`, row 44 of annex X §X.7, which the
 * baseline does not have.
 */
export const CLASS_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  "stream-text": 4096,
  "tool-arguments": 2048,
  "tool-result": 4096,
  diagnostic: 1024,
  target: 512,
  "check-output": 1024,
  "critic-reply": 1024,
  comment: 1024,
  "free-text": 1024,
});

/** The setting that carries the cap of the last four classes. */
export const FREE_TEXT_LIMIT_SETTING = "observability.limits.freeText" as const;

/** At most eight targets (`data-model.md`, the class `target`). */
export const TARGET_MAX_ITEMS = 8;

/** The fourteen field names F111-FR-016 says are among the marked. */
export const NAMED_IN_THE_REQUIREMENT = [
  "message",
  "evidence",
  "target",
  "question",
  "detail",
  "reason",
  "title",
  "error",
  "summary",
  "cmd",
  "argv",
  "why",
  "needs",
  "options",
] as const;

/** The cap of a class, in bytes. */
export function capFor(ingressClass: string): number {
  return CLASS_LIMITS[ingressClass] ?? CLASS_LIMITS["free-text"] ?? 1024;
}

/** The marks of a type, from the catalogue: the ONLY list (F111-FR-016). */
export function freeTextFieldsOf(type: string): readonly FreeTextMark[] {
  return CATALOGUE_BY_TYPE.get(type)?.freeTextFields ?? Object.freeze([]);
}

/** The ingress class of a field, or undefined where the field is not marked. */
export function ingressClassOf(type: string, field: string): string | undefined {
  return freeTextFieldsOf(type).find((mark) => mark.field === field)?.ingressClass;
}

/** What a cut did: the value, whether it was cut, and the two sizes. */
export type CapResult = {
  readonly value: string;
  readonly truncated: boolean;
  readonly originalBytes: number;
  readonly retainedBytes: number;
};

/** Cut text to a byte cap without splitting a character in two. */
export function capBytes(text: string, limit: number): CapResult {
  const bytes = Buffer.from(text, "utf8");
  const originalBytes = bytes.length;
  if (originalBytes <= limit) {
    return Object.freeze({
      value: text,
      truncated: false,
      originalBytes,
      retainedBytes: originalBytes,
    });
  }
  // Step back to the start of the character that the cap falls inside.
  let end = limit;
  while (end > 0 && (bytes[end] as number) >= 0x80 && (bytes[end] as number) < 0xc0) end -= 1;
  const value = bytes.subarray(0, end).toString("utf8");
  return Object.freeze({
    value,
    truncated: true,
    originalBytes,
    retainedBytes: Buffer.byteLength(value, "utf8"),
  });
}

/** The redaction ingress, as this module calls it. */
export type IngressRedactor = (
  text: string,
  ingressClass: string,
) => {
  readonly text: string;
  readonly redacted: boolean;
};

/** The redactor that replaces nothing: for a caller that has none registered. */
export const NO_REDACTION: IngressRedactor = (text) => ({ text, redacted: false });

/** The four marks the ingress records, as `stream.text` and `tool.call` carry them. */
export type IngressMarks = {
  readonly redacted: boolean;
  readonly truncated: boolean;
  /** Measured BEFORE redaction (research D-7, B-2216). */
  readonly originalBytes: number;
  readonly retainedBytes: number;
};

/** What the ingress did to one field. */
export type AppliedMark = {
  readonly field: string;
  readonly ingressClass: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly originalBytes: number;
  readonly retainedBytes: number;
};

/** The result of the ingress over one event's `data`. */
export type EnforcedData = {
  readonly data: Record<string, unknown>;
  readonly marks: IngressMarks;
  readonly applied: readonly AppliedMark[];
};

function oneValue(
  text: string,
  ingressClass: string,
  redactor: IngressRedactor,
): {
  value: string;
  redacted: boolean;
  truncated: boolean;
  originalBytes: number;
  retainedBytes: number;
} {
  // Measure first, redact second, cut third.
  const originalBytes = Buffer.byteLength(text, "utf8");
  let redacted = false;
  let redactedText = text;
  try {
    const result = redactor(text, ingressClass);
    redactedText = result.text;
    redacted = result.redacted;
  } catch {
    // The redactor fails closed: with no result, the text does not pass.
    return { value: "", redacted: true, truncated: true, originalBytes, retainedBytes: 0 };
  }
  const cut = capBytes(redactedText, capFor(ingressClass));
  return {
    value: cut.value,
    redacted,
    truncated: cut.truncated,
    originalBytes,
    retainedBytes: cut.retainedBytes,
  };
}

/**
 * Put the marked fields of one event through the redaction ingress and the cap
 * of their class (F111-FR-016). A value that is a list is treated member by
 * member; a value that is not text is left as it is, because there is nothing
 * to redact and nothing to cut. Never throws.
 */
export function enforceFreeText(
  type: string,
  data: Readonly<Record<string, unknown>>,
  redactor: IngressRedactor = NO_REDACTION,
): EnforcedData {
  const out: Record<string, unknown> = { ...data };
  const applied: AppliedMark[] = [];
  let anyRedacted = false;
  let anyTruncated = false;
  let originalBytes = 0;
  let retainedBytes = 0;

  for (const mark of freeTextFieldsOf(type)) {
    if (!Object.hasOwn(data, mark.field)) continue;
    const value = data[mark.field];
    if (typeof value === "string") {
      const done = oneValue(value, mark.ingressClass, redactor);
      out[mark.field] = done.value;
      anyRedacted ||= done.redacted;
      anyTruncated ||= done.truncated;
      originalBytes += done.originalBytes;
      retainedBytes += done.retainedBytes;
      applied.push(
        Object.freeze({
          field: mark.field,
          ingressClass: mark.ingressClass,
          redacted: done.redacted,
          truncated: done.truncated,
          originalBytes: done.originalBytes,
          retainedBytes: done.retainedBytes,
        }),
      );
      continue;
    }
    if (Array.isArray(value)) {
      // A list is treated member by member (`data-model.md`, "Free-text fields").
      const members = mark.ingressClass === "target" ? value.slice(0, TARGET_MAX_ITEMS) : value;
      let listRedacted = false;
      let listTruncated = members.length < value.length;
      let listOriginal = 0;
      let listRetained = 0;
      const next = members.map((member) => {
        if (typeof member !== "string") return member;
        const done = oneValue(member, mark.ingressClass, redactor);
        listRedacted ||= done.redacted;
        listTruncated ||= done.truncated;
        listOriginal += done.originalBytes;
        listRetained += done.retainedBytes;
        return done.value;
      });
      out[mark.field] = next;
      anyRedacted ||= listRedacted;
      anyTruncated ||= listTruncated;
      originalBytes += listOriginal;
      retainedBytes += listRetained;
      applied.push(
        Object.freeze({
          field: mark.field,
          ingressClass: mark.ingressClass,
          redacted: listRedacted,
          truncated: listTruncated,
          originalBytes: listOriginal,
          retainedBytes: listRetained,
        }),
      );
      continue;
    }
    // null, a number, a flag: nothing to redact and nothing to cut.
  }

  return Object.freeze({
    data: out,
    marks: Object.freeze({
      redacted: anyRedacted,
      truncated: anyTruncated,
      originalBytes,
      retainedBytes,
    }),
    applied: Object.freeze(applied),
  });
}

/* ------------------------------------------------------------------ *
 * No content, and no free text without a mark.
 * ------------------------------------------------------------------ */

/** The names a body would go under, whatever the type. */
const BODY_NAMES = /^(text|prompt|reply|body|output|content|stdout|stderr|transcript|snippet)$/;

/**
 * The findings of one event's `data` against "no event holds content": a
 * field that is a body, or a reference that carries the body as well.
 */
export function contentFindings(
  type: string,
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  const findings: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    if (BODY_NAMES.test(field)) {
      findings.push(`${type}.${field} would hold content; content is referred to by reference`);
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const reference = value as Record<string, unknown>;
      const isReference = CONTENT_REFERENCE_FIELDS.every((name) => Object.hasOwn(reference, name));
      if (!isReference) continue;
      for (const inner of Object.keys(reference)) {
        if ((CONTENT_REFERENCE_FIELDS as readonly string[]).includes(inner)) continue;
        findings.push(
          `${type}.${field}.${inner}: a reference carries ` +
            `${CONTENT_REFERENCE_FIELDS.join(", ")} and nothing else`,
        );
      }
    }
  }
  return Object.freeze(findings);
}

/** One field that looks like free text and carries no mark, with the reason why it is not. */
export type NotFreeText = {
  readonly type: string;
  readonly field: string;
  readonly reason: string;
};

/**
 * The fields whose NAME is one of the fourteen of F111-FR-016 but whose VALUE
 * is not free text, each with the reading that says so. `data-model.md`
 * defines a free-text field as a `data` field whose value is text and is none
 * of: a member of a closed set, an id, a logical name, a hash, a time. These
 * nine are the cases where the value is one of those and the name alone would
 * suggest otherwise.
 *
 * Six of them are a CODE that a feature chooses from a fixed list which no row
 * of annex X §X.6 closes yet. They are recorded here rather than marked,
 * because marking a code would send it through a redactor that has nothing to
 * redact and a cap it can never reach, and would tell a reader that the value
 * is something a person typed. The owner of each type appends its row.
 */
export const NOT_FREE_TEXT: readonly NotFreeText[] = Object.freeze([
  Object.freeze({
    type: "blocked",
    field: "reason",
    reason:
      "a member of the six reasons of annex E §E.2, which `@specstride/contracts` holds as " +
      "`BLOCKED_REASONS`; the refinement of F111-FR-009 gives it as an `enum`",
  }),
  Object.freeze({
    type: "pass.killed",
    field: "reason",
    reason:
      "a kill reason of annex X §X.6 row 10, as `data-model.md` states for the end cause `killed`",
  }),
  Object.freeze({
    type: "pass.ended",
    field: "evidence",
    reason:
      "the LOGICAL NAME of the phase evidence that the end cause `evidence` goes with; a logical " +
      "name is none of the things `data-model.md` calls free text",
  }),
  Object.freeze({
    type: "stage.ended",
    field: "reason",
    reason:
      "a failure class of the pipeline (`@specstride/contracts/codes/pipeline`), a code the " +
      "runtime chooses and no text a person typed; no row of annex X §X.6 closes it yet, owner 119",
  }),
  Object.freeze({
    type: "supervisor.relaunch",
    field: "reason",
    reason:
      "the classified relaunch reason of the supervisor, chosen from the relaunch classifier " +
      "tables of annex B; a code and no text a person typed; no row closes it yet, owner 123",
  }),
  Object.freeze({
    type: "plugin.install_denied",
    field: "reason",
    reason:
      "the policy code of the plugin gate: the denial is by rule, unlike " +
      "`plugin.install_failed.reason`, which is the installer's own message and IS marked",
  }),
  Object.freeze({
    type: "check.excluded",
    field: "reason",
    reason:
      "a code of the check runner that names the rule which excluded the check; a code and no " +
      "text a person typed; no row closes it yet, owner 148",
  }),
  Object.freeze({
    type: "check.admission",
    field: "reason",
    reason:
      "a code of the check runner that names why the command was admitted or held; a code and " +
      "no text a person typed; no row closes it yet, owner 148",
  }),
  Object.freeze({
    type: "check.parallelism_lowered",
    field: "reason",
    reason:
      "a code of the check runner that names what lowered the parallelism; a code and no text " +
      "a person typed; no row closes it yet, owner 148",
  }),
]);

const RECORDED = new Set(NOT_FREE_TEXT.map((row) => `${row.type}\u0000${row.field}`));

/**
 * The fields that would hold free text and carry no mark (F111-FR-016, "a
 * type that is added with a field of free text MUST mark it"). The oracle is
 * the fourteen names the requirement itself gives: wherever one of them is a
 * `data` field, it is marked, unless the catalogue or a refinement makes it a
 * member of a closed set, or `NOT_FREE_TEXT` records why it is not free text.
 * The list must stay empty.
 */
export function unmarkedFreeTextCandidates(): readonly string[] {
  const findings: string[] = [];
  for (const entry of CATALOGUE) {
    const marked = new Set(entry.freeTextFields.map((mark) => mark.field));
    for (const field of entry.dataFields) {
      if (!(NAMED_IN_THE_REQUIREMENT as readonly string[]).includes(field)) continue;
      if (marked.has(field)) continue;
      if (closedSetMembersOf(entry.type, field) !== undefined) continue;
      if (refinedDataSchemaOf(entry.type)?.properties[field]?.enum !== undefined) continue;
      if (RECORDED.has(`${entry.type}\u0000${field}`)) continue;
      findings.push(
        `${entry.type}.${field}: a field of free text without a mark; mark it with its ingress ` +
          `class, or record in NOT_FREE_TEXT why its value is not free text`,
      );
    }
  }
  return Object.freeze(findings);
}

/**
 * The findings of the marks themselves: a mark on a field the row does not
 * have, or a class that is not one of the nine.
 */
export function markFindings(): readonly string[] {
  const findings: string[] = [];
  for (const entry of CATALOGUE) {
    if (isThirdPartyType(entry.type)) continue;
    for (const mark of entry.freeTextFields) {
      if (!entry.dataFields.includes(mark.field)) {
        findings.push(`${entry.type}: the mark on ${mark.field} names no field of the row`);
      }
      if (!INGRESS_CLASSES.includes(mark.ingressClass)) {
        findings.push(
          `${entry.type}.${mark.field}: the class ${mark.ingressClass} is none of the nine ` +
            `(${INGRESS_CLASSES.join(", ")})`,
        );
      }
    }
  }
  return Object.freeze(findings);
}
