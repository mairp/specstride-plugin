/**
 * T018 — the emit helpers that fill the envelope and the ids (F111-FR-002,
 * F111-FR-003).
 *
 * F111-FR-002: *Every event MUST carry the envelope of annex X §X.1 with typed
 * values, null for an unknown value and absence for a value that does not
 * apply. The identity of the feature in an event MUST be `featureId` and the
 * working-directory name MUST be `project` in `data` where a type needs it;
 * the as-is field name `task` MUST NOT appear in the primary stream. `ts` MUST
 * be on every event of every writer, the supervisor's included, in UTC to the
 * millisecond. `strategy` MUST be present on every event of a phase attempt
 * and of a pass.*
 *
 * F111-FR-003: *Ids MUST be stable and MUST be on every event that has them,
 * as in annex B §B.3. `attemptId` MUST be minted once and never change across
 * a relaunch or a resume; the ordinal `attempt` MUST be carried over a resume
 * and changes only through `counters.reset`. `passId` MUST be unique per start
 * of a session; a resume after a yield MUST give a new `passId` with the same
 * `attemptId`; the ordinal `pass` MUST rise per phase attempt and never be
 * reused.*
 *
 * Three ideas carry the module.
 *
 * NULL IS NOT ABSENCE. `fillEnvelope` copies a field the caller GAVE, null
 * included, and leaves out a field the caller did not give. So `harness: null`
 * means "this event had a harness and it is unknown" and no `harness` key at
 * all means "a harness does not apply here". The two are different facts and
 * a reader that folds the stream needs both.
 *
 * `strategy` IS NOT OPTIONAL WHERE IT APPLIES. Which types are "of a phase
 * attempt and of a pass" is read FROM THE CATALOGUE — every type whose name
 * begins `attempt.` or `pass.`, plus the closers their rows name — and not
 * from a list written here that the catalogue could outgrow.
 *
 * AN ID IS MINTED ONCE AND THE PROOF IS ON DISK. `IdBook` keeps no identity in
 * a closure: everything it knows is in `state()`, a plain record that a
 * relaunch restores. That is what makes "never change across a relaunch" a
 * thing a test can show rather than assert. The mint counter inside the state
 * never goes backwards, so `counters.reset`, which returns the ORDINALS to
 * zero, can never hand out an id that was used before.
 */
import { basename } from "node:path";
import { CATALOGUE_BY_TYPE } from "../catalogue/index.ts";
import {
  NULL_WHERE_UNKNOWN,
  STRATEGIES,
  WORKER_FIELDS,
  type EventEnvelope,
  type Strategy,
} from "@specstride/contracts/envelope/event";
import { BestEffortEmitter, type EmitOutcome } from "./besteffort.ts";
import type { DropCount } from "./validate.ts";
import type { EventSink, WriteRequest } from "./writer.ts";

/** F111-FR-002 — the identity of the feature in an event. */
export const FEATURE_IDENTITY_FIELD = "featureId" as const;

/** F111-FR-002 — the working-directory NAME, where a type carries it. */
export const PROJECT_FIELD = "project" as const;

/** F111-FR-002 — the as-is name that must not appear in the primary stream. */
export const FORBIDDEN_AS_IS_FIELD = "task" as const;

/** F111-FR-002 — present on every event of a phase attempt and of a pass. */
export const STRATEGY_FIELD = "strategy" as const;

/** UTC to the millisecond, and nothing else (F111-FR-002). */
export const TIMESTAMP_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The time of an event: UTC, to the millisecond. */
export function timestampOf(at: Date): string {
  return at.toISOString();
}

/** The NAME of the working directory, never its path (F111-FR-002). */
export function projectNameOf(workdir: string): string {
  return basename(workdir.replace(/\/+$/, ""));
}

/**
 * The types that are events of a phase attempt or of a pass, read from the
 * catalogue: every type whose first segment is `attempt` or `pass`.
 */
export const STRATEGY_BEARING_PREFIXES = ["attempt.", "pass."] as const;

/** True where `strategy` must be on the event (F111-FR-002). */
export function needsStrategy(type: string): boolean {
  return STRATEGY_BEARING_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/** What a caller knows about where an event comes from. */
export type EmitContext = {
  readonly runId: string;
  readonly launchId: string;
  readonly engineStartId?: string;
  readonly featureId?: string;
  readonly phaseId?: string;
  readonly attemptId?: string;
  readonly attempt?: number;
  readonly passId?: string;
  readonly pass?: number;
  readonly sessionId?: string;
  readonly parentSessionId?: string;
  readonly role?: string;
  readonly harness?: string | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly strategy?: Strategy;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly workerId?: string;
  readonly wseq?: number;
  /** The working directory; its NAME fills `project` where a type carries it. */
  readonly workdir?: string;
};

/** The envelope fields a context can fill, in the order of annex X §X.1. */
const CONTEXT_FIELDS = [
  "engineStartId",
  "featureId",
  "phaseId",
  "attemptId",
  "attempt",
  "passId",
  "pass",
  "sessionId",
  "parentSessionId",
  "role",
  "harness",
  "provider",
  "model",
  "strategy",
  "traceId",
  "spanId",
  "cause",
  "workerId",
  "wseq",
] as const;

/**
 * Fill the envelope of one event (F111-FR-002). A field the context or the
 * request GAVE is copied, null included; a field neither gave is left out.
 * `seq` is not this module's to give — the writer gives it at the append under
 * the lock (F111-FR-017) — so the number is a parameter here.
 */
export function fillEnvelope(
  context: EmitContext,
  request: WriteRequest,
  seq: number,
  at: Date,
): EventEnvelope {
  const { type, data, ...overrides } = request;
  const event: Record<string, unknown> = {
    schema: "specstride.event",
    v: 1,
    seq,
    ts: timestampOf(at),
    type,
    runId: context.runId,
    launchId: context.launchId,
  };
  for (const field of CONTEXT_FIELDS) {
    const value = (context as Record<string, unknown>)[field];
    // Absence is a value that does not apply: `undefined` writes no key.
    if (value !== undefined) event[field] = value;
  }
  for (const [field, value] of Object.entries(overrides)) {
    if (value !== undefined) event[field] = value;
  }
  // The working-directory NAME, where the type carries the field.
  const body: Record<string, unknown> = { ...((data ?? {}) as Record<string, unknown>) };
  if (Object.hasOwn(body, PROJECT_FIELD) && context.workdir !== undefined) {
    body[PROJECT_FIELD] = projectNameOf(context.workdir);
  }
  event.data = body;
  return event as unknown as EventEnvelope;
}

/**
 * The findings of an envelope against F111-FR-002. An empty list means the
 * envelope keeps the rule. The function never throws.
 */
export function envelopeFindings(event: unknown): readonly string[] {
  const findings: string[] = [];
  if (typeof event !== "object" || event === null) {
    return Object.freeze(["an event is a record"]);
  }
  const record = event as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (typeof record.ts !== "string" || !TIMESTAMP_FORM.test(record.ts)) {
    findings.push(
      `\`ts\` is on every event of every writer, in UTC to the millisecond; this one reads ` +
        `${JSON.stringify(record.ts)}`,
    );
  }
  if (Object.hasOwn(record, FORBIDDEN_AS_IS_FIELD)) {
    findings.push(
      `the as-is field name \`${FORBIDDEN_AS_IS_FIELD}\` does not appear in the primary ` +
        `stream; the identity of the feature is \`${FEATURE_IDENTITY_FIELD}\``,
    );
  }
  const data = record.data;
  if (typeof data === "object" && data !== null && Object.hasOwn(data, FORBIDDEN_AS_IS_FIELD)) {
    findings.push(
      `the \`data\` of ${type || "an event"} holds the as-is field name ` +
        `\`${FORBIDDEN_AS_IS_FIELD}\``,
    );
  }
  if (needsStrategy(type)) {
    const strategy = record[STRATEGY_FIELD];
    if (typeof strategy !== "string" || !(STRATEGIES as readonly string[]).includes(strategy)) {
      findings.push(
        `\`${STRATEGY_FIELD}\` is on every event of a phase attempt and of a pass; ` +
          `${type} carries ${JSON.stringify(strategy)}`,
      );
    }
  }
  for (const field of WORKER_FIELDS) {
    if (Object.hasOwn(record, field) && record[field] === null) {
      findings.push(`${field} does not apply on the main line: it is absent, never null`);
    }
  }
  for (const field of NULL_WHERE_UNKNOWN) {
    const value = record[field];
    if (Object.hasOwn(record, field) && value !== null && typeof value !== "string") {
      findings.push(`${field} is text where it is known and null where it is not`);
    }
  }
  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * The ids (F111-FR-003).
 * ------------------------------------------------------------------ */

/** A phase attempt belongs to one phase of one feature. */
export type AttemptKey = { readonly featureId: string; readonly phaseId: string };

/** The id and the ordinal of one phase attempt. */
export type AttemptIdentity = { readonly attemptId: string; readonly attempt: number };

/** The id and the ordinal of one pass, with the attempt it belongs to. */
export type PassIdentity = {
  readonly passId: string;
  readonly pass: number;
  readonly attemptId: string;
};

/** One phase, as the book keeps it. */
type PhaseState = {
  attemptId: string | null;
  attempt: number;
  pass: number;
};

/** Everything the book knows; a plain record, so that a relaunch restores it. */
export type IdBookState = {
  /** Never goes backwards, so an id is never handed out twice. */
  readonly minted: number;
  readonly phases: Readonly<Record<string, PhaseState>>;
};

function keyOf(key: AttemptKey): string {
  return `${key.featureId}\u0000${key.phaseId}`;
}

/**
 * The book of the ids of a run (F111-FR-003). Everything it knows is in
 * `state()`, so a relaunch that restores the state hands out the same
 * `attemptId` the first launch minted.
 */
export class IdBook {
  #minted: number;
  readonly #phases = new Map<string, PhaseState>();

  constructor(state?: IdBookState) {
    this.#minted = state?.minted ?? 0;
    for (const [key, phase] of Object.entries(state?.phases ?? {})) {
      this.#phases.set(key, { ...phase });
    }
  }

  /** The book a relaunch reads back from disk. */
  static restore(state: IdBookState): IdBook {
    return new IdBook(state);
  }

  /** What survives: the whole of what the book knows. */
  state(): IdBookState {
    return Object.freeze({
      minted: this.#minted,
      phases: Object.freeze(
        Object.fromEntries([...this.#phases.entries()].map(([key, p]) => [key, { ...p }])),
      ),
    });
  }

  #phase(key: AttemptKey): PhaseState {
    const id = keyOf(key);
    const found = this.#phases.get(id);
    if (found !== undefined) return found;
    const fresh: PhaseState = { attemptId: null, attempt: 0, pass: 0 };
    this.#phases.set(id, fresh);
    return fresh;
  }

  #mint(prefix: string, key: AttemptKey): string {
    this.#minted += 1;
    return `${prefix}-${key.phaseId}-${this.#minted}`;
  }

  /**
   * Start a new phase attempt: a new id, minted once, and the next ordinal.
   * An id is never reused, whatever the ordinal does.
   */
  beginAttempt(key: AttemptKey): AttemptIdentity {
    const phase = this.#phase(key);
    phase.attempt += 1;
    phase.attemptId = this.#mint("at", key);
    // The pass ordinal rises PER phase attempt, so a new attempt starts over.
    phase.pass = 0;
    return Object.freeze({ attemptId: phase.attemptId, attempt: phase.attempt });
  }

  /** The phase attempt that is open, or undefined where none is. */
  currentAttempt(key: AttemptKey): AttemptIdentity | undefined {
    const phase = this.#phase(key);
    if (phase.attemptId === null) return undefined;
    return Object.freeze({ attemptId: phase.attemptId, attempt: phase.attempt });
  }

  /**
   * A resume or a relaunch: the SAME `attemptId` and the SAME ordinal. Nothing
   * is minted and nothing is counted.
   */
  resume(key: AttemptKey): AttemptIdentity | undefined {
    return this.currentAttempt(key);
  }

  /** The phase attempt ended. Its id stays in no slot to be handed out again. */
  endAttempt(key: AttemptKey): void {
    this.#phase(key).attemptId = null;
  }

  /**
   * `counters.reset` — the ONLY thing that changes the ordinal of a phase
   * attempt (F111-FR-003). The mint counter is untouched, so no id comes back.
   */
  resetCounters(): void {
    for (const phase of this.#phases.values()) {
      phase.attempt = 0;
      phase.pass = 0;
      phase.attemptId = null;
    }
  }

  /** One start of a session: a new `passId`, and the next ordinal. */
  startPass(key: AttemptKey): PassIdentity {
    const phase = this.#phase(key);
    if (phase.attemptId === null) phase.attemptId = this.#mint("at", key);
    phase.pass += 1;
    return Object.freeze({
      passId: this.#mint("pass", key),
      pass: phase.pass,
      attemptId: phase.attemptId,
    });
  }

  /**
   * A resume after a yield: a NEW `passId` with the SAME `attemptId`, and an
   * ordinal that rises and is never reused (F111-FR-003).
   */
  resumeAfterYield(key: AttemptKey): PassIdentity {
    return this.startPass(key);
  }
}

/* ------------------------------------------------------------------ *
 * The emitter that puts the two together.
 * ------------------------------------------------------------------ */

export type EmitterOptions = {
  readonly file: string | null;
  readonly context: EmitContext;
  readonly holder?: string;
  readonly now?: () => Date;
  readonly maxEventBytes?: number;
};

/**
 * The face a feature that owns a behaviour uses: it names a type and its
 * `data`, and the envelope, the ids and the number come from here, the
 * catalogue and the writer. Best effort throughout (F111-FR-019).
 */
export class Emitter {
  readonly #emitter: BestEffortEmitter;
  readonly #now: () => Date;
  #context: EmitContext;

  private constructor(options: EmitterOptions, emitter: BestEffortEmitter) {
    this.#context = options.context;
    this.#now = options.now ?? (() => new Date());
    this.#emitter = emitter;
  }

  static open(options: EmitterOptions): Emitter {
    const emitter = BestEffortEmitter.open({
      destination: options.file,
      runId: options.context.runId,
      launchId: options.context.launchId,
      holder: options.holder,
      now: options.now,
      maxEventBytes: options.maxEventBytes,
    });
    return new Emitter(options, emitter);
  }

  get context(): EmitContext {
    return this.#context;
  }

  /** Change what the next events know: a new pass, a new session, a new role. */
  withContext(changes: Partial<EmitContext>): void {
    this.#context = { ...this.#context, ...changes };
  }

  addSink(sink: EventSink): void {
    this.#emitter.addSink(sink);
  }

  pending(): readonly DropCount[] {
    return this.#emitter.pending();
  }

  get nextSeq(): number {
    return this.#emitter.nextSeq;
  }

  /** Emit one event with the envelope and the ids of the context. */
  emit(request: WriteRequest): EmitOutcome {
    const filled = fillEnvelope(this.#context, request, this.#emitter.nextSeq, this.#now());
    const {
      schema: _schema,
      v: _v,
      seq: _seq,
      ts: _ts,
      ...rest
    } = filled as unknown as Record<string, unknown>;
    // The writer gives `seq` and `ts` at the append; the rest of the envelope
    // travels with the request, so the one ordering of T008 is not forked.
    return this.#emitter.emit(rest as WriteRequest);
  }

  /** True where the type of the catalogue carries the field `project`. */
  static typeCarriesProject(type: string): boolean {
    return CATALOGUE_BY_TYPE.get(type)?.dataFields.includes(PROJECT_FIELD) ?? false;
  }

  close(): void {
    this.#emitter.close();
  }
}
