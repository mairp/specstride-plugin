/**
 * T010 — the classifier of feature 127 (F127-FR-001, F127-FR-002,
 * F127-FR-003); the content of EP-12, `specstride.quota-classifier/1`.
 *
 * It is a PURE TABLE evaluated by the table evaluator of feature 100
 * (`evaluateTable` of `@specstride/kernel`, annex X §X.3): versioned data, no
 * I/O, no clock, no randomness and no model (F127-FR-003). The table and the
 * pattern set are the two data files of T005, validated at load by
 * `./table.ts`.
 *
 * Three things happen here and nowhere else:
 *
 *  1. **the pattern signals** — the default text classifier is data, so the
 *     table holds no regular expression. `patternSignal` tries the groups of
 *     `text-patterns.json` in the order the file gives and names the group of
 *     the first matching pattern; that name is the signal `textGroup`
 *     (decision D-1 of `research.md`);
 *  2. **the table evaluation** — the signal vector is built in the order of
 *     evidence of §Q.2 (a structured signal of the stream, then an HTTP status
 *     or code, then a text pattern, then the stall watchdog), which is the row
 *     order of the table, so the first row that fires is the strongest
 *     evidence present. The RULE ID of the row that fired is recorded with
 *     every classification, and the DEFAULT ROW (`Q-99`) fires for a vector
 *     no other row matches: an input that matches nothing gives
 *     `provider_other` with the confidence `text` (F127-FR-001);
 *  3. **the unknown-value rules** — a class an implementation names that is
 *     outside the closed set of row 46 is read as `provider_other`, a
 *     confidence outside row 47 as `text`, and a source of a reset time
 *     outside row 207 as `parsed_text` (annex X §X.6; F127-FR-001).
 *
 * A classifier that FAILS gives `provider_other`, and the failure takes the
 * as-is path of consecutive errors (F127-FR-003): `classify` never throws —
 * `classifierFailed` is the classification it returns, and `./actions.ts`
 * reads it as a failure that counts.
 *
 * Purity and the redactor: F127-FR-002 asks for "a fragment of the evidence
 * that has passed the redactor", and the one redactor of the product reads its
 * pattern set from a file (`@specstride/kernel`, `createRedactor`). So the
 * redactor is INJECTED: the composition root hands `classify` the one
 * redactor it already holds. With none handed, the evidence is DROPPED with
 * the mark `redactor-unavailable` rather than carried in the clear — the
 * fail-closed rule of F100-FR-205.
 */
import { evaluateTable } from "@specstride/kernel";
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  CLASS_WHEN_UNKNOWN,
  CONFIDENCE_WHEN_UNKNOWN,
  CLASSES,
  CONFIDENCES,
  type AlertLevel,
  type Classification,
  type Confidence,
  type Observation,
  type QuotaClass,
} from "@specstride/contracts/ep/quota-classifier";
import type { RedactResult } from "@specstride/contracts/ep/redactor";
import {
  CLASSIFY_POINT,
  DEFAULT_CLASSIFIER_TABLE,
  DEFAULT_TEXT_PATTERNS,
  RETRYABLE_BY_CLASS,
  type ClassifierTable,
  type TextPatterns,
} from "./table.ts";

/* ------------------------------------------------------------------ *
 * The closed sets this module reads, and their unknown-value rules.
 * ------------------------------------------------------------------ */

/** Row 46 of annex X §X.6 — the quota classes; its members are `CLASSES` of EP-12. */
export const QUOTA_CLASSES: readonly QuotaClass[] = CLASSES;

/** Row 207 of annex X §X.6 — the sources of a reset time (§Q.2). */
export const RESET_SOURCES = ["structured", "header", "parsed_text"] as const;
export type ResetSource = (typeof RESET_SOURCES)[number];

/** Row 207's unknown-value rule: a source outside the set is read as `parsed_text`. */
export const RESET_SOURCE_WHEN_UNKNOWN: ResetSource = "parsed_text";

/**
 * Read a class through the unknown-value rule of row 46: a class outside the
 * closed set is read as `provider_other` (F127-FR-001).
 */
export function readQuotaClass(value: string | null | undefined): QuotaClass | null {
  if (value === null || value === undefined) return null;
  return (CLASSES as readonly string[]).includes(value)
    ? (value as QuotaClass)
    : CLASS_WHEN_UNKNOWN;
}

/**
 * Read a confidence through the unknown-value rule of row 47: a confidence
 * outside the closed set is read as `text` (F127-FR-001).
 */
export function readConfidence(value: string | null | undefined): Confidence | null {
  if (value === null || value === undefined) return null;
  return (CONFIDENCES as readonly string[]).includes(value)
    ? (value as Confidence)
    : CONFIDENCE_WHEN_UNKNOWN;
}

/**
 * Read a source of a reset time through the unknown-value rule of row 207: a
 * source outside the closed set is read as `parsed_text` (§Q.2).
 */
export function readResetSource(value: string | null | undefined): ResetSource | null {
  if (value === null || value === undefined) return null;
  return (RESET_SOURCES as readonly string[]).includes(value)
    ? (value as ResetSource)
    : RESET_SOURCE_WHEN_UNKNOWN;
}

/* ------------------------------------------------------------------ *
 * The input, the signal vector and the output.
 * ------------------------------------------------------------------ */

/**
 * The instants a reset time may be read from, each already an absolute
 * instant. A relative delay (a `retry-after` header of seconds) is turned
 * into an instant by the caller through its clock port, because this module
 * reads no clock (F127-FR-003).
 */
export type ResetsAtCandidates = {
  /** A field of a structured record of the stream. */
  readonly structured?: string | null | undefined;
  /** A reply header, such as a retry delay the caller resolved. */
  readonly header?: string | null | undefined;
  /** A time read from a message; the last resort of §Q.2. */
  readonly parsedText?: string | null | undefined;
};

/** What the harness adapter saw, as `classify` is handed it (F127-FR-001). */
export type QuotaClassifyInput = {
  /**
   * A class a structured record of the stream named, or a `failures` map of a
   * harness descriptor declared (F127-FR-008). Read through the unknown-value
   * rule of row 46.
   */
  readonly structuredClass?: string | null | undefined;
  /** An HTTP status, or a body code the adapter mapped to one. */
  readonly status?:
    | { readonly code?: number | null; readonly headers?: Readonly<Record<string, string>> }
    | undefined;
  /** The exit code of the harness process, where there was one. */
  readonly exitCode?: number | null | undefined;
  /** The error text: the body, the last line of the stream, or the message. */
  readonly errorText?: string | null | undefined;
  /** True where the stall watchdog fired with no other signal (§Q.2). */
  readonly stalled?: boolean | undefined;
  /** The instants a reset time may be read from, in the order of §Q.2. */
  readonly resetsAt?: ResetsAtCandidates | undefined;
  /** The rate-limit type where the harness names one (F127-FR-002). */
  readonly rateLimitType?: string | null | undefined;
  /** The utilization where the harness gives one, 0 to 1 (F127-FR-002). */
  readonly utilization?: number | null | undefined;
  /**
   * The confidence an entry of a harness adapter states, where it states one.
   * Read through the unknown-value rule of row 47; the table's own confidence
   * stands where the entry states none.
   */
  readonly confidence?: string | null | undefined;
  /**
   * The `retryable` an entry states. §Q.1 gives one value per class: an entry
   * that states none takes the value of the class, and one that states
   * another value is INVALID and is ignored with a note (item W-127-02).
   */
  readonly retryable?: boolean | null | undefined;
};

/** The vector of signals the table of T005 declares for the point `classify`. */
export type ClassifySignals = {
  readonly structuredClass: string | null;
  readonly httpStatus: number | null;
  readonly textGroup: string | null;
  readonly stalled: boolean;
};

/** A classification, with every field F127-FR-002 names. */
export type QuotaClassification = Classification & {
  /** The source of `resetsAt`, a member of row 207, or null (F127-FR-002). */
  readonly resetsAtSource: ResetSource | null;
  /** The rate-limit type the harness named, or null. */
  readonly rateLimitType: string | null;
  /** The utilization the harness gave, or null. */
  readonly utilization: number | null;
  /** A fragment of the evidence that has passed the redactor, or null. */
  readonly evidence: string | null;
  /** Why the evidence is null, where it is: a drop mark of the redactor. */
  readonly evidenceDropped: string | null;
  /** The rule id of the row that fired, recorded with every classification. */
  readonly ruleId: string;
  /** The version of the table (F127-FR-002). */
  readonly tableVersion: string;
  /** The signals the row that fired read, for the event `quota.signal`. */
  readonly signals: Readonly<Record<string, unknown>>;
  /** True where the classifier itself failed (F127-FR-003). */
  readonly failed: boolean;
  /** Notes the classification carries: an invalid `retryable`, a failure. */
  readonly notes: readonly string[];
};

/** How `classify` is configured. The defaults are the data files of T005. */
export type ClassifyOptions = {
  readonly table?: ClassifierTable;
  readonly patterns?: TextPatterns;
  /**
   * The one redactor of the product, handed in by the composition root. With
   * none, the evidence is dropped with the mark `redactor-unavailable`.
   */
  readonly redact?: ((text: string, sizeCap: number) => RedactResult) | undefined;
  /** The byte cap of the evidence fragment; 512 by default. */
  readonly evidenceCapBytes?: number;
};

/** The byte cap of the evidence fragment of a classification (F127-FR-002). */
export const EVIDENCE_CAP_BYTES = 512;

/** The mark the evidence carries where no redactor was handed in (F100-FR-205). */
export const REDACTOR_UNAVAILABLE = "redactor-unavailable" as const;

/** The rule id a failure of the classifier itself records (F127-FR-003). */
export const CLASSIFIER_FAILED_RULE_ID = "Q-FAIL" as const;

/* ------------------------------------------------------------------ *
 * 1. The pattern signals (the default text classifier, as data).
 * ------------------------------------------------------------------ */

/**
 * The group of the first matching pattern of `text-patterns.json`, or null.
 * The groups are tried in the order the file's `order` gives, and the match
 * is a case-insensitive substring — no regular expression, so no input can
 * cost more than the length of the text (decision D-1).
 */
export function patternSignal(
  text: string | null | undefined,
  patterns: TextPatterns = DEFAULT_TEXT_PATTERNS,
): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const haystack = text.toLowerCase();
  for (const group of patterns.order) {
    for (const pattern of patterns.groups.get(group) ?? []) {
      if (haystack.includes(pattern.toLowerCase())) return group;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 2. The signal vector and the table evaluation.
 * ------------------------------------------------------------------ */

/**
 * Build the vector of signals in the order of evidence of §Q.2. The order is
 * the row order of the table, so a stronger signal always fires first.
 */
export function signalsOf(
  seen: QuotaClassifyInput,
  patterns: TextPatterns = DEFAULT_TEXT_PATTERNS,
): ClassifySignals {
  const code = seen.status?.code;
  return Object.freeze({
    structuredClass: readQuotaClass(seen.structuredClass),
    httpStatus: typeof code === "number" && Number.isFinite(code) ? code : null,
    textGroup: patternSignal(seen.errorText, patterns),
    stalled: seen.stalled === true,
  });
}

/**
 * The reset time and its source, in the order of §Q.2: a structured field,
 * then a header, then a time read from text — "a time read from text MUST be
 * used only when no structured or header value exists" (F127-FR-002).
 */
export function resolveResetsAt(candidates: ResetsAtCandidates | undefined): {
  resetsAt: string | null;
  resetsAtSource: ResetSource | null;
} {
  const order: readonly [ResetSource, string | null | undefined][] = [
    ["structured", candidates?.structured],
    ["header", candidates?.header],
    ["parsed_text", candidates?.parsedText],
  ];
  for (const [source, value] of order) {
    if (typeof value === "string" && value.length > 0) {
      return { resetsAt: value, resetsAtSource: source };
    }
  }
  return { resetsAt: null, resetsAtSource: null };
}

/**
 * Classify what the harness adapter saw (F127-FR-001 to F127-FR-003).
 *
 * Never throws: a failure of the classifier itself gives `provider_other`
 * with `failed: true`, which `./actions.ts` reads as a failure that counts
 * towards the consecutive errors (F127-FR-003).
 */
export function classify(
  seen: QuotaClassifyInput,
  options: ClassifyOptions = {},
): QuotaClassification {
  const table = options.table ?? DEFAULT_CLASSIFIER_TABLE;
  const patterns = options.patterns ?? DEFAULT_TEXT_PATTERNS;
  const cap = options.evidenceCapBytes ?? EVIDENCE_CAP_BYTES;
  const notes: string[] = [];
  let signals: ClassifySignals;
  let decision;
  try {
    signals = signalsOf(seen, patterns);
    decision = evaluateTable(table.table, CLASSIFY_POINT, { ...signals });
  } catch (error) {
    return classifierFailed(String(error), table, evidenceOf(seen, options, cap, notes), notes);
  }
  const facts = table.facts.get(decision.ruleId);
  if (facts === undefined) {
    return classifierFailed(
      `the table ${table.table.id} gave the rule id ${decision.ruleId}, for which the load ` +
        `recorded no class, confidence and \`retryable\``,
      table,
      evidenceOf(seen, options, cap, notes),
      notes,
    );
  }

  // The class: the row's choice, read through the unknown-value rule of row 46.
  const quotaClass = readQuotaClass(facts.quotaClass) ?? CLASS_WHEN_UNKNOWN;

  // The confidence: an entry of an adapter may state one; else the row's.
  const stated = readConfidence(seen.confidence);
  const confidence = stated ?? readConfidence(facts.confidence) ?? CONFIDENCE_WHEN_UNKNOWN;

  // `retryable`: a constant of the class (§Q.1). An entry that states another
  // value is invalid; the value of the class stands and a note records it.
  const constant = RETRYABLE_BY_CLASS[quotaClass];
  if (typeof seen.retryable === "boolean" && seen.retryable !== constant) {
    notes.push(
      `the entry states \`retryable\` ${String(seen.retryable)} for the class ${quotaClass}, ` +
        `whose constant value in §Q.1 is ${String(constant)}; the entry is invalid and the ` +
        `value of the class stands (item W-127-02)`,
    );
  }

  const reset = resolveResetsAt(seen.resetsAt);
  const evidence = evidenceOf(seen, options, cap, notes);
  return Object.freeze({
    quotaClass,
    confidence,
    resetsAt: reset.resetsAt,
    resetsAtSource: reset.resetsAtSource,
    retryable: constant,
    rateLimitType: typeof seen.rateLimitType === "string" ? seen.rateLimitType : null,
    utilization:
      typeof seen.utilization === "number" && Number.isFinite(seen.utilization)
        ? seen.utilization
        : null,
    evidence: evidence.text,
    evidenceDropped: evidence.dropped,
    ruleId: decision.ruleId,
    tableVersion: table.version,
    signals: Object.freeze({ ...decision.signals }),
    failed: false,
    notes: Object.freeze([...notes]),
  });
}

/**
 * F127-FR-003 — a classifier that fails gives `provider_other`, and the
 * failure takes the as-is path of consecutive errors.
 */
export function classifierFailed(
  reason: string,
  table: ClassifierTable = DEFAULT_CLASSIFIER_TABLE,
  evidence: { text: string | null; dropped: string | null } = { text: null, dropped: null },
  notes: readonly string[] = [],
): QuotaClassification {
  return Object.freeze({
    quotaClass: CLASS_WHEN_UNKNOWN,
    confidence: CONFIDENCE_WHEN_UNKNOWN,
    resetsAt: null,
    resetsAtSource: null,
    retryable: RETRYABLE_BY_CLASS[CLASS_WHEN_UNKNOWN],
    rateLimitType: null,
    utilization: null,
    evidence: evidence.text,
    evidenceDropped: evidence.dropped,
    ruleId: CLASSIFIER_FAILED_RULE_ID,
    tableVersion: table.version,
    signals: Object.freeze({}),
    failed: true,
    notes: Object.freeze([
      ...notes,
      `the classifier failed and gives ${CLASS_WHEN_UNKNOWN}; the failure takes the as-is path ` +
        `of consecutive errors (F127-FR-003): ${reason}`,
    ]),
  });
}

/**
 * A fragment of the evidence that has passed the redactor, cut to the cap.
 * With no redactor handed in, the fragment is DROPPED with the mark
 * `redactor-unavailable` rather than carried in the clear (F100-FR-205).
 */
function evidenceOf(
  seen: QuotaClassifyInput,
  options: ClassifyOptions,
  cap: number,
  notes: string[],
): { text: string | null; dropped: string | null } {
  const text = typeof seen.errorText === "string" ? seen.errorText : "";
  if (text.length === 0) return { text: null, dropped: null };
  if (options.redact === undefined) {
    notes.push(
      `the evidence was dropped: no redactor was handed to \`classify\`, and a fragment is ` +
        `carried only after it has passed the redactor (F127-FR-002, F100-FR-205)`,
    );
    return { text: null, dropped: REDACTOR_UNAVAILABLE };
  }
  try {
    const result = options.redact(text, cap);
    if (result.dropped === true)
      return { text: null, dropped: result.reason ?? REDACTOR_UNAVAILABLE };
    return { text: result.text, dropped: null };
  } catch (error) {
    notes.push(`the redactor threw; the evidence was dropped: ${String(error)}`);
    return { text: null, dropped: REDACTOR_UNAVAILABLE };
  }
}

/* ------------------------------------------------------------------ *
 * `observe` — the second operation of EP-12 (F127-FR-001).
 * ------------------------------------------------------------------ */

/**
 * The alert levels of row 48 of annex X §X.6: `info`, `warn`, `loud`. EP-12's
 * own `ALERT_LEVELS` of `@specstride/contracts` names `critical` where row 48
 * names `loud`; row 48 is the closed set this feature owns and stands
 * (reported to feature 100 by T006, `packages/policy/test/closed-sets-100.md`).
 */
export const OBSERVE_LEVELS = ["info", "warn", "loud"] as const;
export type ObserveLevel = (typeof OBSERVE_LEVELS)[number];

/** Row 48's unknown-value rule: a level outside the set is read as `warn`. */
export const LEVEL_WHEN_UNKNOWN: ObserveLevel = "warn";

/** The thresholds of §Q.4, as fractions of the allowance that remains. */
export const OBSERVE_THRESHOLDS = Object.freeze([
  { usedAtLeast: 0.9, level: "loud" as ObserveLevel },
  { usedAtLeast: 0.75, level: "warn" as ObserveLevel },
  { usedAtLeast: 0.5, level: "info" as ObserveLevel },
]);

/**
 * `observe` — a gauge of the remaining allowance, or a fact a host observed,
 * gives an alert level or nothing (F127-FR-001).
 *
 * A gauge whose `remaining` is a fraction in `[0, 1]` is read as the share
 * left; the level is the highest threshold of §Q.4 the use has reached. A
 * fact a host observed is an alert input and informs only (F127-FR-007): it
 * gives `warn` and never a pause by itself.
 */
export function observe(observation: Observation): ObserveLevel | undefined {
  if (observation.kind === "host-fact") return "warn";
  const remaining = observation.remaining;
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return undefined;
  if (remaining < 0 || remaining > 1) return undefined;
  const used = 1 - remaining;
  for (const threshold of OBSERVE_THRESHOLDS) {
    if (used >= threshold.usedAtLeast) return threshold.level;
  }
  return undefined;
}

/** Row 48 as the contracts package registers it, for a reader of this module. */
export const ALERT_LEVEL_SET = closedSet(48);

/** The two operations of EP-12, as this module implements them (F127-FR-001). */
export const OPERATIONS = ["classify", "observe"] as const;

/** EP-12's own alert-level type, for a caller that needs it. */
export type { AlertLevel };

/* ------------------------------------------------------------------ *
 * F127-FR-008 — the entries of a harness, read through the harness port.
 * ------------------------------------------------------------------ */

/**
 * The classifier entries of a harness come from its harness adapter or from
 * the `failures` map of its harness descriptor (annex C §C.2), and are read
 * through the harness port's `classify` (EP-02, annex C §C.1) — never by
 * testing a harness name, which is the rule that keeps the registry open
 * (F127-FR-008, "No shared code MUST test a harness name").
 *
 * The port answers in the typed failure vocabulary of §C.1, eight members.
 * This map refines each into the class of §Q.1 the engine acts on, which is
 * the sentence of §C.1: "the typed failure `classify` returns, which the quota
 * classifier refines".
 */
export const CLASS_OF_TYPED_FAILURE: Readonly<Record<string, QuotaClass>> = Object.freeze({
  authentication_failed: "auth",
  rate_limited: "rate_limit_transient",
  quota_exhausted: "quota_window",
  context_window_exceeded: "context_window",
  transport_failed: "agent_failure",
  agent_failure: "agent_failure",
  capability_absent: "provider_other",
  critic_not_toolless: "provider_other",
});

/**
 * §C.1's unknown-value rule for a failure: an unknown failure is
 * `agent_failure`, whose class takes the error path of §Q.1.
 */
export const TYPED_FAILURE_WHEN_UNKNOWN = "agent_failure" as const;

/** The class of a typed failure of §C.1, through the rule above. */
export function classOfTypedFailure(failure: string | null | undefined): QuotaClass {
  if (typeof failure !== "string") return CLASS_OF_TYPED_FAILURE[TYPED_FAILURE_WHEN_UNKNOWN];
  return CLASS_OF_TYPED_FAILURE[failure] ?? CLASS_OF_TYPED_FAILURE[TYPED_FAILURE_WHEN_UNKNOWN];
}

/** The one operation of the harness port this feature calls (EP-02, §C.1). */
export type HarnessClassifyPort = {
  classify(seen: {
    readonly streamRecord?: unknown;
    readonly status?: { readonly code: number; readonly headers: Readonly<Record<string, string>> };
    readonly bodyCode?: string;
    readonly exitCode?: number;
    readonly errorText?: string;
  }): { readonly failure: string; readonly detail?: string };
};

/** How a classification through the harness port is configured. */
export type ThroughThePortOptions = ClassifyOptions & {
  /**
   * The confidence the adapter's entry states, where it states one. A
   * `failures` map that matched a structured record of the stream states
   * `structured`; one that matched a status states `status`; a text pattern of
   * the descriptor states `text`, which §Q.2 puts behind the confirming probe.
   * With none stated, `structured` stands: the adapter named the class itself.
   */
  readonly confidence?: string | undefined;
};

/**
 * F127-FR-008 — classify what a harness saw, through the harness port's
 * `classify`.
 *
 * The port is the only thing this function knows about the harness: there is
 * no harness name anywhere in it, so a harness whose adapter or descriptor
 * declares an entry pauses a run, and one that declares none takes the error
 * path, with no change to any shared code.
 */
export function classifyThroughTheHarnessPort(
  port: HarnessClassifyPort,
  seen: QuotaClassifyInput,
  options: ThroughThePortOptions = {},
): QuotaClassification {
  let typed: { readonly failure: string; readonly detail?: string };
  try {
    typed = port.classify({
      ...(typeof seen.status?.code === "number"
        ? { status: { code: seen.status.code, headers: seen.status.headers ?? {} } }
        : {}),
      ...(seen.exitCode === null || seen.exitCode === undefined ? {} : { exitCode: seen.exitCode }),
      ...(seen.errorText === null || seen.errorText === undefined
        ? {}
        : { errorText: seen.errorText }),
    });
  } catch (error) {
    // "Failure of an implementation" of §C.1: `classify` gives `agent_failure`.
    typed = { failure: TYPED_FAILURE_WHEN_UNKNOWN, detail: String(error) };
  }
  return classify(
    {
      ...seen,
      structuredClass: classOfTypedFailure(typed.failure),
      confidence: options.confidence ?? "structured",
    },
    options,
  );
}

/**
 * The classes a `failures` map of a harness descriptor declares, as this
 * feature reads them (annex C §C.2, field `failures`). The map's keys are the
 * typed failure vocabulary of §C.1; the values say what signals each one and
 * belong to the generic harness adapter of feature 109.
 */
export function classesOfADeclaredMap(
  failures: Readonly<Record<string, unknown>> | null | undefined,
): readonly QuotaClass[] {
  if (failures === null || failures === undefined) return Object.freeze([]);
  const classes: QuotaClass[] = [];
  for (const failure of Object.keys(failures)) {
    const quotaClass = CLASS_OF_TYPED_FAILURE[failure];
    if (quotaClass !== undefined && !classes.includes(quotaClass)) classes.push(quotaClass);
  }
  return Object.freeze(classes);
}

/** True where a `failures` map declares a LIMIT signal (F127-FR-008). */
export function declaresALimitSignal(
  failures: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  const classes = classesOfADeclaredMap(failures);
  return classes.includes("quota_window") || classes.includes("quota_credit");
}
