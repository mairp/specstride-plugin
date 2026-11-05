/**
 * T020 — the pair table and the synthesis of closers by the next writer
 * (F111-FR-004, F111-FR-005).
 *
 * F111-FR-004: *Every event whose type opens something MUST have a partner
 * that closes it, as in the table "Pairs" of the catalogue. The span of an
 * exporter MUST be built from the pair at the moment of emission. Where a
 * process died before it wrote a closer, the next writer MUST write the
 * closers, marked `synthesized: true` with the cause of the death, innermost
 * first, before any new event.*
 *
 * F111-FR-005: *Every engine start MUST end on record ... Liveness MUST never
 * be an event: no heartbeat is written.*
 *
 * THE TABLE IS THE CATALOGUE. `PAIR_TABLE` is `PAIRS` of T004 and holds no
 * type name of its own, so a pair that is added to the data is a pair here
 * with nothing to edit.
 *
 * INNERMOST FIRST, AND WHY. The open spans are a stack: a closer closes the
 * opener that was opened last. When a process dies, the spans that are still
 * open are exactly that stack, and the stack unwinds from the top — the pass
 * before the phase attempt, the phase attempt before the phase, the phase
 * before the engine start. Any other order would say that a phase ended while
 * a pass of it was still running, which no reader could fold.
 *
 * TWO END-CAUSE SETS THAT DO NOT COMPETE. Row 5 of annex X §X.6 is what an
 * engine says of its OWN end; row 96 is what the next writer found of an end
 * that left no `run.ended`. The flag `synthesized` is what tells a reader
 * which set to read the value against, and `crash` means the same in both.
 * `endCauseSetFor` is that rule as one function, and `synthesizedClosersFor`
 * refuses a cause of row 5: a synthesis cannot claim to know what the dead
 * process would have said.
 *
 * NO HEARTBEAT. `heartbeatTypes()` reads the catalogue and must stay empty.
 * It is a test that keeps a liveness type out of the data, not a comment.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import {
  LIVENESS_IS_AN_EVENT as F100_LIVENESS_IS_AN_EVENT,
  SYNTHESIZED_FIELD as F100_SYNTHESIZED_FIELD,
} from "@specstride/contracts/envelope/event";
import { CATALOGUE, PAIRS } from "../catalogue/index.ts";
import type { PrimaryWriter, WriteRequest, WrittenEvent } from "./writer.ts";

/** The pairs of the catalogue (F111-FR-004). */
export const PAIR_TABLE = PAIRS;

/** The type that opens an engine start, and the one that closes it. */
export const RUN_STARTED = "run.started" as const;
export const RUN_ENDED = "run.ended" as const;

/** F111-FR-005 — the `data` field is `endCause`, not the envelope's `cause`. */
export const RUN_ENDED_CAUSE_FIELD = "endCause" as const;

/** F111-FR-004 — the mark a closer the next writer wrote carries. */
export const SYNTHESIZED_FIELD = F100_SYNTHESIZED_FIELD;

/** F111-FR-005 — liveness is never an event. */
export const LIVENESS_IS_AN_EVENT = F100_LIVENESS_IS_AN_EVENT;

/** The cause of a death that is a crash; a member of both row 5 and row 96. */
export const CRASH = "crash" as const;

/**
 * The closer of an opener comes from the `open` rows; the opener of a closer
 * from the `close` rows. The two are NOT one map read both ways: one opener
 * may have more than one closer (`recovery.diagnosis_started` ends in
 * `recovery.diagnosis_done` or in `recovery.diagnosis_failed`), and the
 * `open` row names the canonical one.
 */
const CLOSER_OF: ReadonlyMap<string, string> = new Map(
  CATALOGUE.filter((entry) => entry.kind === "open").map((entry) => [entry.type, entry.partner]),
);
const OPENER_OF: ReadonlyMap<string, string> = new Map(
  CATALOGUE.filter((entry) => entry.kind === "close").map((entry) => [entry.type, entry.partner]),
);

/** The closer of an opener, or undefined where the type opens nothing. */
export function closerOf(type: string): string | undefined {
  return CLOSER_OF.get(type);
}

/** The opener of a closer, or undefined where the type closes nothing. */
export function openerOf(type: string): string | undefined {
  return OPENER_OF.get(type);
}

export function isOpener(type: string): boolean {
  return CLOSER_OF.has(type);
}

export function isCloser(type: string): boolean {
  return OPENER_OF.has(type);
}

/**
 * The end causes an ENGINE writes of its own end: the members of row 5 of
 * annex X §X.6 that are a cause and not a `causedBy` (F111-FR-005 names the
 * three).
 */
export const ENGINE_WRITTEN_END_CAUSES: readonly string[] = Object.freeze(
  ["normal", "crash", "owner-lost"].filter((member) =>
    (closedSet(5)?.members ?? []).includes(member),
  ),
);

/** The end causes of a SYNTHESIZED end of a run: row 96 (F111-FR-005). */
export const SYNTHESIZED_END_CAUSES: readonly string[] = Object.freeze([
  ...(closedSet(96)?.members ?? []),
]);

/** Which set an `endCause` of `run.ended` is read against (F111-FR-005). */
export function endCauseSetFor(synthesized: boolean): readonly string[] {
  return synthesized ? SYNTHESIZED_END_CAUSES : ENGINE_WRITTEN_END_CAUSES;
}

/** The least an event has to be for the pair rules to apply to it. */
export type PairedEvent = {
  readonly type: string;
  readonly seq?: number;
  readonly engineStartId?: string;
  readonly data?: Record<string, unknown>;
} & Record<string, unknown>;

/** One span that was opened and not closed. */
export type OpenSpan = {
  readonly type: string;
  readonly closer: string;
  readonly seq: number;
  readonly engineStartId?: string;
};

/**
 * The spans that are open at the end of the stream, OUTERMOST FIRST — the
 * stack as a reader built it (F111-FR-004).
 */
export function openSpans(events: readonly PairedEvent[]): readonly OpenSpan[] {
  const stack: OpenSpan[] = [];
  for (const event of events) {
    const closer = closerOf(event.type);
    if (closer !== undefined) {
      stack.push(
        Object.freeze({
          type: event.type,
          closer,
          seq: event.seq ?? 0,
          ...(event.engineStartId === undefined ? {} : { engineStartId: event.engineStartId }),
        }),
      );
      continue;
    }
    const opener = openerOf(event.type);
    if (opener === undefined) continue;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]?.type === opener) {
        stack.splice(index, 1);
        break;
      }
    }
  }
  return Object.freeze(stack);
}

/**
 * The findings of a stream against F111-FR-004: a closer that closes nothing.
 * A span that is still open is no finding — it is what the next writer closes.
 */
export function pairFindings(events: readonly PairedEvent[]): readonly string[] {
  const stack: string[] = [];
  const findings: string[] = [];
  for (const event of events) {
    if (isOpener(event.type)) {
      stack.push(event.type);
      continue;
    }
    const opener = openerOf(event.type);
    if (opener === undefined) continue;
    const index = stack.lastIndexOf(opener);
    if (index < 0) {
      findings.push(
        `${event.type} at seq ${event.seq ?? "?"} closes ${opener}, which no event opened`,
      );
      continue;
    }
    stack.splice(index, 1);
  }
  return Object.freeze(findings);
}

/** What a synthesis knows about the death it is recording. */
export type SynthesisContext = {
  /** A member of row 96: `crash`, `host_exit` or `operator_stop`. */
  readonly cause: string;
  /** The exit code of the terminal record, where one is known. */
  readonly exitCode?: number;
  /** The stop reason of the terminal record, where one is known. */
  readonly stopReason?: string;
};

/** One closer the next writer will append. */
export type SynthesizedCloser = WriteRequest & {
  /** The `seq` of the opener this closes; the envelope `cause` carries it. */
  readonly closes: number;
};

/**
 * The closers for every span that is still open, INNERMOST FIRST, each marked
 * `synthesized: true` with the cause of the death (F111-FR-004, F111-FR-005).
 *
 * The cause must be of row 96: the next writer reports what it FOUND, and
 * `normal` or `owner-lost` is what an engine says of its own end.
 */
export function synthesizedClosersFor(
  events: readonly PairedEvent[],
  context: SynthesisContext,
): readonly SynthesizedCloser[] {
  if (!SYNTHESIZED_END_CAUSES.includes(context.cause)) {
    throw new RangeError(
      `a synthesized end carries a cause of annex X §X.6 row 96 ` +
        `(${SYNTHESIZED_END_CAUSES.join(", ")}); it reads ${JSON.stringify(context.cause)}`,
    );
  }
  const open = openSpans(events);
  const closers: SynthesizedCloser[] = [];
  // Innermost first: the stack unwinds from the top.
  for (let index = open.length - 1; index >= 0; index -= 1) {
    const span = open[index];
    if (span === undefined) continue;
    const data: Record<string, unknown> = { [SYNTHESIZED_FIELD]: true };
    if (span.closer === RUN_ENDED) {
      data[RUN_ENDED_CAUSE_FIELD] = context.cause;
      if (context.stopReason !== undefined) data.stopReason = context.stopReason;
      if (context.exitCode !== undefined) data.exitCode = context.exitCode;
    }
    closers.push(
      Object.freeze({
        type: span.closer,
        closes: span.seq,
        ...(span.engineStartId === undefined ? {} : { engineStartId: span.engineStartId }),
        data: Object.freeze(data),
      }) as SynthesizedCloser,
    );
  }
  return Object.freeze(closers);
}

/**
 * Close every span the file left open, innermost first, BEFORE any new event
 * (F111-FR-004). The writer reads its own file, so the closers are built from
 * what is on disk and not from what this process remembers.
 */
export function closeAllOpenSpans(
  writer: PrimaryWriter,
  context: SynthesisContext,
  events?: readonly PairedEvent[],
): readonly WrittenEvent[] {
  const stream = events ?? readStreamOf(writer);
  const written: WrittenEvent[] = [];
  for (const closer of synthesizedClosersFor(stream, context)) {
    const { closes, ...request } = closer;
    written.push(
      writer.append(
        closes > 0
          ? ({ ...request, cause: String(closes) } as WriteRequest)
          : (request as WriteRequest),
      ),
    );
  }
  return Object.freeze(written);
}

/** The stream of the writer's own file, read back through the reader of T010. */
function readStreamOf(writer: PrimaryWriter): readonly PairedEvent[] {
  // Imported lazily through the module graph: `seq.ts` is the read side.
  return readEventsOf(writer.file);
}

import { readEvents } from "./seq.ts";

function readEventsOf(file: string): readonly PairedEvent[] {
  return readEvents(file).events as unknown as readonly PairedEvent[];
}

/** How many engine starts there are, and how many ended on record (F111-SC-002). */
export type TerminalMeasure = {
  readonly starts: number;
  readonly onRecord: number;
  readonly missing: readonly string[];
};

/**
 * F111-SC-002 — every engine start ends on record, whether the engine wrote
 * `run.ended` itself or the next writer synthesized it. An engine start
 * without an `engineStartId` counts under the empty name, so a stream that
 * carries none is still measured rather than silently skipped.
 */
export function engineStartsOnRecord(events: readonly PairedEvent[]): TerminalMeasure {
  const started: string[] = [];
  const ended = new Set<string>();
  for (const event of events) {
    const id = event.engineStartId ?? "";
    if (event.type === RUN_STARTED && !started.includes(id)) started.push(id);
    if (event.type === RUN_ENDED) ended.add(id);
  }
  const missing = started.filter((id) => !ended.has(id));
  return Object.freeze({
    starts: started.length,
    onRecord: started.length - missing.length,
    missing: Object.freeze(missing),
  });
}

/**
 * The types of the catalogue that would be a heartbeat. F111-FR-005 makes
 * liveness no event at all, so this is always empty — and it is read from the
 * data, so a type that was added would show here.
 */
export function heartbeatTypes(): readonly string[] {
  return Object.freeze(
    CATALOGUE.map((entry) => entry.type).filter((type) =>
      /heartbeat|liveness|keepalive|(^|\.)ping(\.|$)|(^|\.)alive(\.|$)/.test(type),
    ),
  );
}
