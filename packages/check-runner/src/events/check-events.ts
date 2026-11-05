/**
 * T024 — the events of a check: one `check.started` and one `check.ended` for
 * EVERY execution of a command, by whatever check (F148-FR-007).
 *
 * The types and the `data` fields are the event catalogue's (feature 100,
 * annex X §X.1; feature 111 owns the content). The catalogue rows are:
 *
 * | Type | Kind | Partner | `data` fields |
 * |---|---|---|---|
 * | the started event | open | the ended event | `checkId`, `commandRef`, `runner`, `unitId`, `batch`, `slot` |
 * | the ended event | close | the started event | `checkId`, `result`, `durationMs`, `unitId`, `condition`, `batch`, `slot`, `concurrent`, `synthesized` |
 *
 * F148-FR-007 names the fields this feature fills: the id of the command is
 * `checkId`, the command by reference `commandRef`, the runner `runner`, the
 * duration `durationMs`, the result `result`, the conditions `condition`.
 *
 * Two rules hold here and are code, not prose:
 *
 *  1. **No event holds output of a command.** Output is referred to by
 *     logical name, hash and size. `holdsNoOutput` is the reader of that rule
 *     and `checkStartedData`/`checkEndedData` cannot be given a stream.
 *  2. **An event that cannot be written never changes a result.** `emit` is
 *     best effort: a sink that throws, rejects or hangs leaves the result it
 *     was called with untouched and returns the failure as a value
 *     (Principle V; the edge case of `spec.md`).
 *
 * This module builds the `data` of the two events and nothing else. The
 * envelope, the sequence and the append belong to the one event writer
 * (F100-FR-198), and the sinks to EP-08.
 */
import {
  conditionField,
  statedAsPass,
  type ResultConditions,
  type RunnerResult,
} from "../result/result.ts";

/** The two event types of one execution of a command. */
export const CHECK_STARTED = "check.started" as const;
export const CHECK_ENDED = "check.ended" as const;

/** The pair, in the order the catalogue gives it: an open and its close. */
export const CHECK_EVENT_TYPES = Object.freeze([CHECK_STARTED, CHECK_ENDED] as const);

/** The `data` fields of each type, as the catalogue spells them. */
export const CHECK_STARTED_FIELDS = Object.freeze([
  "checkId",
  "commandRef",
  "runner",
  "unitId",
  "batch",
  "slot",
] as const);

export const CHECK_ENDED_FIELDS = Object.freeze([
  "checkId",
  "result",
  "durationMs",
  "unitId",
  "condition",
  "batch",
  "slot",
  "concurrent",
  "synthesized",
] as const);

/** F111-FR-008 — who ran the check. A check of this runner is the runtime's. */
export const CHECK_RUNNERS = Object.freeze(["runtime", "proposer"] as const);
export type CheckEventRunner = (typeof CHECK_RUNNERS)[number];
export const RUNNER_OF_THIS_FEATURE: CheckEventRunner = "runtime";

/**
 * F148-FR-007, F100-FR-200 — a reference to content: a logical name, a hash
 * and a size, and never a body.
 */
export type ContentReference = {
  readonly logicalName: string;
  readonly hash: string;
  readonly size: number;
};

/** The fields of a content reference, which are the only ones it may carry. */
export const CONTENT_REFERENCE_FIELDS = Object.freeze(["logicalName", "hash", "size"] as const);

/** True where the value is a content reference and holds nothing else. */
export function isContentReference(value: unknown): value is ContentReference {
  if (value === null || typeof value !== "object") return false;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    keys.length === CONTENT_REFERENCE_FIELDS.length &&
    keys.every((key) => (CONTENT_REFERENCE_FIELDS as readonly string[]).includes(key))
  );
}

/** The results the field `result` of the ended event may carry. */
export const CHECK_EVENT_RESULTS = Object.freeze(["passed", "failed"] as const);
export type CheckEventResult = (typeof CHECK_EVENT_RESULTS)[number];

/**
 * F148-FR-003, F148-FR-007 — the value of `result`. A result with `tainted`,
 * `unchecked` or `interrupted` is never stated as a pass IN AN EVENT either,
 * so the field is read through `statedAsPass` and not from `passed` alone.
 */
export function resultField(result: RunnerResult): CheckEventResult {
  return statedAsPass(result) ? "passed" : "failed";
}

/** What the caller gives for the started event. */
export type StartedInput = {
  readonly checkId: string;
  readonly commandRef: ContentReference | null;
  readonly runner?: CheckEventRunner;
  readonly unitId?: string | null;
  readonly batch?: number | null;
  readonly slot?: number | null;
};

/** The `data` of the started event (F148-FR-007). */
export function checkStartedData(input: StartedInput): Readonly<Record<string, unknown>> {
  if (input.commandRef !== null && !isContentReference(input.commandRef)) {
    throw new EventHoldsOutputError(CHECK_STARTED, "commandRef");
  }
  return Object.freeze({
    checkId: input.checkId,
    commandRef: input.commandRef,
    runner: input.runner ?? RUNNER_OF_THIS_FEATURE,
    unitId: input.unitId ?? null,
    batch: input.batch ?? null,
    slot: input.slot ?? null,
  });
}

/** What the caller gives for the ended event. */
export type EndedInput = {
  readonly checkId: string;
  readonly result: RunnerResult;
  readonly unitId?: string | null;
  readonly synthesized?: boolean;
};

/** The `data` of the ended event (F148-FR-007). */
export function checkEndedData(input: EndedInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    checkId: input.checkId,
    result: resultField(input.result),
    durationMs: input.result.durationMs,
    unitId: input.unitId ?? null,
    condition: conditionField(input.result as ResultConditions),
    batch: input.result.batch,
    slot: input.result.slot,
    concurrent: input.result.concurrent,
    synthesized: input.synthesized ?? false,
  });
}

/** Raised where a caller puts output of a command into an event. */
export class EventHoldsOutputError extends Error {
  readonly type: string;
  readonly field: string;
  constructor(type: string, field: string) {
    super(
      `no event holds output of a command: output is referred to by logical name, hash and ` +
        `size (F148-FR-007, F100-FR-200); \`${field}\` of \`${type}\` is not a content reference`,
    );
    this.name = "EventHoldsOutputError";
    this.type = type;
    this.field = field;
  }
}

/** The names of the streams an event must never carry. */
export const STREAM_FIELDS = Object.freeze(["stdout", "stderr", "output", "text"] as const);

/**
 * F148-FR-007 — true where the `data` holds no output of a command: no stream
 * field, and every reference a content reference.
 */
export function holdsNoOutput(data: Readonly<Record<string, unknown>>): boolean {
  for (const name of STREAM_FIELDS) {
    if (name in data && typeof data[name] === "string" && (data[name] as string).length > 0) {
      return false;
    }
  }
  const ref = data["commandRef"];
  if (ref === undefined || ref === null) return true;
  return isContentReference(ref);
}

/** The pair of events of one execution, in order. */
export type CheckEventPair = {
  readonly started: {
    readonly type: typeof CHECK_STARTED;
    readonly data: Readonly<Record<string, unknown>>;
  };
  readonly ended: {
    readonly type: typeof CHECK_ENDED;
    readonly data: Readonly<Record<string, unknown>>;
  };
};

/**
 * F148-FR-007 — the two events of ONE execution of a command: one
 * `check.started` and one `check.ended`, never more and never fewer.
 */
export function checkEventsOf(
  input: StartedInput & { readonly result: RunnerResult; readonly synthesized?: boolean },
): CheckEventPair {
  // F148-FR-017 — the batch fields of the started event and of the result can
  // never disagree: where the caller names neither, they are READ FROM THE
  // RESULT, which `withBatchFields` of `batch-fields.ts` put them on.
  const started: StartedInput = {
    ...input,
    batch: input.batch ?? input.result.batch,
    slot: input.slot ?? input.result.slot,
  };
  return Object.freeze({
    started: Object.freeze({ type: CHECK_STARTED, data: checkStartedData(started) }),
    ended: Object.freeze({
      type: CHECK_ENDED,
      data: checkEndedData({
        checkId: input.checkId,
        result: input.result,
        unitId: input.unitId ?? null,
        ...(input.synthesized === undefined ? {} : { synthesized: input.synthesized }),
      }),
    }),
  });
}

/** What a sink is handed. The runner never writes the envelope itself. */
export type CheckEventWriter = (
  type: string,
  data: Readonly<Record<string, unknown>>,
) => void | Promise<void>;

/** What an emission did, as a value: it is never an exception at the caller. */
export type Emission = {
  readonly written: readonly string[];
  readonly failed: readonly { readonly type: string; readonly message: string }[];
  /** The result as it stood before the emission, unchanged by it. */
  readonly result: RunnerResult;
};

/**
 * F148-FR-007, Principle V — write the two events, best effort. A writer that
 * throws or rejects is recorded in `failed`; the result is returned as it
 * came in, so an event that cannot be written never changes the result of the
 * check.
 */
export async function emitCheckEvents(
  write: CheckEventWriter,
  input: StartedInput & { readonly result: RunnerResult; readonly synthesized?: boolean },
): Promise<Emission> {
  const pair = checkEventsOf(input);
  const written: string[] = [];
  const failed: { type: string; message: string }[] = [];
  for (const event of [pair.started, pair.ended]) {
    try {
      await write(event.type, event.data);
      written.push(event.type);
    } catch (thrown) {
      failed.push({
        type: event.type,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      });
    }
  }
  return Object.freeze({
    written: Object.freeze(written),
    failed: Object.freeze(failed),
    result: input.result,
  });
}
