/**
 * T040 — THE ingress: the one point where text from outside the runtime enters
 * (F111-FR-023, F111-FR-024).
 *
 * F111-FR-023: *Text from outside the runtime (a harness stream, the output of a
 * check, a critic reply, the consumer's comment) MUST enter through one ingress
 * with a class from the closed set of "Closed sets", where it is redacted first
 * and cut second. `original_bytes` MUST be measured before redaction. Every sink,
 * every prompt and every record MUST receive only the result. No code outside the
 * ingress MUST redact.*
 *
 * F111-FR-024: *The redaction point MUST fail closed. When the redactor cannot
 * run, or its pattern set is invalid, the content MUST be dropped, the record MUST
 * say so by a mark of the closed set of "Closed sets", and the reference MUST be
 * delivered in its place. A sink MUST never see the unredacted text.*
 *
 * "NO CODE OUTSIDE THE INGRESS REDACTS" IS CHECKED AND NOT ASKED FOR.
 * `redactionOutsideTheIngress` walks the `src/` of every package of the workspace
 * for the names of the redaction primitives and for the placeholder literal, and
 * reports every file that is neither the redactor's own folder nor this one. A
 * rule that is only written in a comment is a rule that holds until the first
 * person who did not read the comment; this one fails the build.
 *
 * THE RESULT IS A UNION AND THAT IS THE FAIL-CLOSED DESIGN. `text()` returns
 * either an `ok` result with the redacted text, or a DROPPED result that has no
 * `text` field at all. A caller cannot write `result.text` on the failure path,
 * because on the failure path there is no such field to write — the type system
 * carries the requirement that a sink never sees the unredacted text, instead of
 * trusting every caller to test a flag first.
 *
 * `original_bytes` IS MEASURED ON THE WAY IN. Every path here takes the size of
 * the arriving text before anything touches it, including the dropped path: a
 * reader of `redaction.dropped` can still learn how much was refused, which is
 * the only honest thing to say about content nobody may see.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ContentReference } from "@specstride/contracts/ep/event-sink";
import {
  DROP_MARKS,
  markOfReason,
  type DropMark,
  type SpecstrideRedactor,
} from "@specstride/kernel";
import { INGRESS_CLASSES, capFor } from "../writer/freetext.ts";
import {
  byteLength,
  defaultRedactor,
  resolveLimits,
  truncateUtf8,
  type EventMarks,
  type LimitName,
  type Limits,
  type SanitizedMetadata,
} from "./limits.ts";
import { scanCommitFiles, type CommitScanResult } from "@specstride/kernel/redactor/scan";
import { summarizeTargets, type TargetSummary } from "./targets.ts";

/** Row 89's rule for a value outside the set: treated as `free-text`. */
export const UNKNOWN_CLASS_IS = "free-text" as const;

/**
 * The type of the event a drop writes. It is NOT `event.dropped` of
 * `writer/besteffort.ts`: that one says an event could not be written, this one
 * says a text could not be redacted and so was not carried.
 */
export const REDACTION_DROPPED_EVENT_TYPE = "redaction.dropped" as const;

/** F111-FR-023 — there is ONE ingress. */
export const ONE_INGRESS = true as const;

/** The classes of text F111-FR-023 names as arriving from outside the runtime. */
export const TEXT_FROM_OUTSIDE = [
  "a harness stream",
  "the output of a check",
  "a critic reply",
  "the consumer's comment",
] as const;

/** The class a text of an unknown class is given (row 89). */
export function classOf(ingressClass: string): string {
  return INGRESS_CLASSES.includes(ingressClass) ? ingressClass : UNKNOWN_CLASS_IS;
}

/** A text that passed the ingress. */
export type IngressOk = {
  readonly ok: true;
  readonly ingressClass: string;
  readonly text: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly retained_bytes: number;
  readonly patternSetVersion: string;
  metadata(): SanitizedMetadata;
  marks(): EventMarks;
};

/** The event a drop writes: the class, the mark and the count. */
export type DroppedEvent = {
  readonly type: typeof REDACTION_DROPPED_EVENT_TYPE;
  readonly data: {
    readonly ingressClass: string;
    readonly mark: DropMark;
    readonly count: number;
  };
};

/** A text the ingress refused. It has NO `text` field: nothing passed. */
export type IngressDropped = {
  readonly ok: false;
  readonly ingressClass: string;
  readonly dropped: true;
  readonly mark: DropMark;
  readonly original_bytes: number;
  /** The reference that is delivered in the content's place (F111-FR-024). */
  readonly reference: ContentReference | undefined;
  readonly event: DroppedEvent;
};

export type IngressResult = IngressOk | IngressDropped;

/** What a tool argument comes back as: the summary, or a drop. */
export type ToolArgumentResult = (TargetSummary & { readonly ok: true }) | IngressDropped;

/** What the ingress is built with. */
export type IngressOptions = {
  /** The one redactor. Absent: the one the product ships. */
  readonly redactor?: SpecstrideRedactor;
  /** The limits in force. Absent: the defaults of F111-FR-027. */
  readonly limits?: Partial<Record<LimitName, unknown>>;
};

function okResult(
  ingressClass: string,
  text: string,
  redacted: boolean,
  truncated: boolean,
  originalBytes: number,
  patternSetVersion: string,
): IngressOk {
  const retainedBytes = byteLength(text);
  return Object.freeze({
    ok: true as const,
    ingressClass,
    text,
    redacted,
    truncated,
    original_bytes: originalBytes,
    retained_bytes: retainedBytes,
    patternSetVersion,
    metadata(): SanitizedMetadata {
      return Object.freeze({
        redacted,
        truncated,
        original_bytes: originalBytes,
        retained_bytes: retainedBytes,
      });
    },
    marks(): EventMarks {
      return Object.freeze({
        redacted,
        truncated,
        originalBytes,
        retainedBytes,
      });
    },
  });
}

/**
 * The one ingress. Every text from outside the runtime passes through an
 * instance of this class and through nothing else.
 */
export class Ingress {
  readonly #redactor: SpecstrideRedactor;
  readonly #limits: Limits;
  #drops = 0;

  constructor(options: IngressOptions = {}) {
    this.#redactor = options.redactor ?? defaultRedactor();
    this.#limits = resolveLimits(options.limits ?? {});
  }

  /** The limits in force. */
  get limits(): Limits {
    return this.#limits;
  }

  /** The version of the pattern set: what the run record records (§X.4). */
  get patternSetVersion(): string {
    return this.#redactor.patternSetVersion;
  }

  /** How many texts have been dropped: the count the event carries. */
  get drops(): number {
    return this.#drops;
  }

  /** The cap of a class, in bytes. */
  capOf(ingressClass: string): number {
    const resolved = classOf(ingressClass);
    switch (resolved) {
      case "stream-text":
        return this.#limits.textMaxBytes;
      case "tool-arguments":
        return this.#limits.toolArgsMaxBytes;
      case "tool-result":
        return this.#limits.toolResultMaxBytes;
      case "diagnostic":
        return this.#limits.diagnosticMaxBytes;
      case "target":
        return this.#limits.targetMaxBytes;
      default:
        // The four classes the baseline has no cap for: row 44 of annex X §X.7.
        return capFor(resolved);
    }
  }

  #drop(
    ingressClass: string,
    mark: DropMark,
    originalBytes: number,
    reference: ContentReference | undefined,
  ): IngressDropped {
    this.#drops += 1;
    return Object.freeze({
      ok: false as const,
      ingressClass,
      dropped: true as const,
      mark,
      original_bytes: originalBytes,
      reference,
      event: Object.freeze({
        type: REDACTION_DROPPED_EVENT_TYPE,
        data: Object.freeze({ ingressClass, mark, count: this.#drops }),
      }),
    });
  }

  /**
   * ONE TEXT THROUGH THE INGRESS: measured, redacted, cut, in that order. On a
   * redactor that cannot run the content is dropped with its mark and the
   * reference is handed back in its place (F111-FR-024).
   */
  text(value: string, ingressClass: string, reference?: ContentReference): IngressResult {
    const resolved = classOf(ingressClass);
    const text = String(value);
    const originalBytes = byteLength(text);
    const cap = this.capOf(resolved);

    let result;
    try {
      result = this.#redactor.redact(text, Number.MAX_SAFE_INTEGER);
    } catch (error) {
      return this.#drop(resolved, markOfReason(String(error)), originalBytes, reference);
    }
    if (result.dropped === true) {
      return this.#drop(resolved, markOfReason(result.reason), originalBytes, reference);
    }
    const cut = truncateUtf8(result.text, cap);
    return okResult(
      resolved,
      cut.value,
      result.replacements > 0,
      cut.truncated,
      originalBytes,
      result.patternSetVersion,
    );
  }

  /**
   * A whole value through the ingress: the thinking keys dropped, the values of
   * the secret keys replaced, every text redacted, then rendered and cut to the
   * cap of the class.
   */
  value(value: unknown, ingressClass: string, reference?: ContentReference): IngressResult {
    const resolved = classOf(ingressClass);
    let walked: unknown;
    let replacements: number;
    try {
      const done = this.#redactor.redactValue(value);
      walked = done.value;
      replacements = done.replacements;
    } catch (error) {
      return this.#drop(
        resolved,
        markOfReason(this.#redactor.unavailable ?? String(error)),
        byteLength(JSON.stringify(value) ?? ""),
        reference,
      );
    }
    const rendered = JSON.stringify(walked) ?? "";
    const originalBytes = byteLength(JSON.stringify(value) ?? "");
    const cut = truncateUtf8(rendered, this.capOf(resolved));
    return okResult(
      resolved,
      cut.value,
      replacements > 0,
      cut.truncated,
      originalBytes,
      this.#redactor.patternSetVersion,
    );
  }

  /**
   * A whole document for a critic prompt, with the caller's cap: a change is far
   * larger than any class of the event stream holds. It fails closed like every
   * other path: a redactor that cannot run gives no text.
   */
  document(text: string, capBytes: number): { readonly text: string; readonly dropped: boolean } {
    const result = this.#redactor.redact(text, capBytes);
    return result.dropped === true
      ? Object.freeze({ text: "", dropped: true })
      : Object.freeze({ text: result.text, dropped: false });
  }

  /** The scan before a commit (F111-FR-031), with the one redactor. */
  scanCommit(files: readonly string[], root: string): CommitScanResult {
    return scanCommitFiles(files, { root, redactor: this.#redactor });
  }

  /**
   * A tool argument: the targets, the redacted JSON cut to the argument limit,
   * and the four marks (F111-FR-026). It fails closed like every other path.
   */
  toolArgument(value: unknown, reference?: ContentReference): ToolArgumentResult {
    if (this.#redactor.unavailable !== undefined) {
      return this.#drop(
        "tool-arguments",
        this.#redactor.unavailable,
        byteLength(JSON.stringify(value) ?? ""),
        reference,
      );
    }
    try {
      const summary = summarizeTargets(value, this.#limits, this.#redactor);
      return Object.freeze({ ...summary, ok: true as const });
    } catch (error) {
      return this.#drop(
        "tool-arguments",
        markOfReason(String(error)),
        byteLength(JSON.stringify(value) ?? ""),
        reference,
      );
    }
  }
}

/** Build the ingress. */
export function createIngress(options: IngressOptions = {}): Ingress {
  return new Ingress(options);
}

/* ------------------------------------------------------------------ *
 * "No code outside the ingress redacts" — the check.
 * ------------------------------------------------------------------ */

/**
 * The names that only the redactor and the ingress may carry. The placeholder
 * literal is among them: a file that writes `[REDACTED]` is a file that decided
 * for itself what a redaction looks like.
 */
export const REDACTION_PRIMITIVES: readonly string[] = Object.freeze([
  "[REDACTED]",
  "redactText(",
  "redactValue(",
  "createRedactor(",
  "BASELINE_SECRET_VALUE_PATTERNS",
  "patternSetInForce(",
]);

/** The two folders where redaction belongs: the redactor, and this ingress. */
export const REDACTION_ALLOWED_IN: readonly string[] = Object.freeze([
  join("packages", "kernel", "src", "redactor"),
  join("packages", "observability", "src", "ingress"),
]);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  let packages: string[];
  try {
    packages = readdirSync(join(root, "packages"));
  } catch {
    return out;
  }
  for (const name of packages) {
    const src = join(root, "packages", name, "src");
    const walk = (directory: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(directory);
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(directory, entry);
        let stats;
        try {
          stats = statSync(path);
        } catch {
          continue;
        }
        if (stats.isDirectory()) walk(path);
        else if (entry.endsWith(".ts")) out.push(path);
      }
    };
    walk(src);
  }
  return out;
}

/**
 * Every file of a package's `src/` that names a redaction primitive and is
 * neither the redactor's folder nor the ingress (F111-FR-023). The list must
 * stay empty.
 */
export function redactionOutsideTheIngress(root: string): readonly string[] {
  const findings: string[] = [];
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file);
    if (REDACTION_ALLOWED_IN.some((folder) => rel.startsWith(`${folder}${sep}`))) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const primitive of REDACTION_PRIMITIVES) {
      if (!text.includes(primitive)) continue;
      findings.push(
        `${rel} redacts outside the ingress: it names \`${primitive}\`. Redaction belongs to ` +
          `${REDACTION_ALLOWED_IN.join(" and ")} (F111-FR-023).`,
      );
    }
  }
  return Object.freeze(findings);
}

/** The marks of dropped content, re-exported for a caller of the ingress. */
export { DROP_MARKS };
export type { DropMark, ContentReference };
