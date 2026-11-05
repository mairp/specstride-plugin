/**
 * T023 — usage accounting, session facts and the time breakdown of a pass
 * (F126-FR-022, F126-FR-023, F126-FR-024; the pass side of F126-FR-036).
 *
 * The accountant consumes the normalized records of one pass and emits the
 * usage events: one `usage.reported` per model call as it completes, as an
 * increment and never a running total; a running total in the stream is
 * converted to increments per session id; a replay is deduplicated by
 * `usageId`. A pass killed before its terminal ends with the last partial
 * usage and `usageComplete=false`; a harness whose usage source is `none`
 * ends with `usage.unavailable` and the reason. A value the harness did not
 * report is null, with the reason as a separate field; a cost under a
 * subscription is labelled `notional`.
 *
 * Every event carries the session of the pass (F126-FR-022); subagent usage
 * carries the parent session id. The transcript of the pass is referenced by
 * path and hash, never by content.
 */
import { createHash } from "node:crypto";
import type { NormalizedRecord, UsageRecord } from "./records.ts";

/** Where the usage of a harness comes from (F126-FR-023). */
export type UsageSource = "stream" | "trace-plugin" | "none";

/** The basis of a cost figure (F126-FR-023: notional under a subscription). */
export type CostBasis = "measured" | "notional";

/** `usage.reported` — one increment, emitted as the model call completes. */
export type UsageReportedEvent = {
  readonly type: "usage.reported";
  readonly sessionId: string | null;
  /** The parent session, where the usage is subagent activity (F126-FR-022). */
  readonly parentSessionId: string | null;
  readonly usageId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cost: number | null;
  readonly costBasis: CostBasis | null;
  /** Always true: an increment, never a running total (F126-FR-023). */
  readonly increment: true;
};

/** `usage.unavailable` — the explicit reason a pass carries no full usage. */
export type UsageUnavailableEvent = {
  readonly type: "usage.unavailable";
  readonly reason: "killed" | "harness-does-not-report" | "no-usage-in-stream";
  readonly detail: string;
  readonly sessionId: string | null;
  /** The last partial usage, kept on a killed pass (F126-FR-023). */
  readonly lastUsage: UsageRecord | null;
};

/** Either usage event of the seam. */
export type UsageEvent = UsageReportedEvent | UsageUnavailableEvent;

/** The usage facts of one finished pass (F126-FR-023, F126-FR-036). */
export type UsageFacts = {
  /** True only where every reported value of the pass arrived. */
  readonly usageComplete: boolean;
  /** True where the pass is accounted for (F126-FR-036). */
  readonly accounted: boolean;
  readonly reportedCalls: number;
  readonly totalInputTokens: number | null;
  readonly totalOutputTokens: number | null;
  readonly totalCost: number | null;
  readonly costBasis: CostBasis | null;
  readonly unavailableReason: UsageUnavailableEvent["reason"] | null;
  readonly lastUsage: UsageRecord | null;
};

/** Options of the accountant: the usage source and the subscription state. */
export type UsageAccountantOptions = {
  readonly usageSource?: UsageSource | undefined;
  /** True where the pass runs under a subscription: cost is notional. */
  readonly subscription?: boolean | undefined;
  /** The parent session id, where the pass is subagent activity. */
  readonly parentSessionId?: string | null | undefined;
};

/** The totals one usage record contributes, after the increment conversion. */
type Increment = {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cost: number | null;
};

/** Options for stamping the session facts of a record (F126-FR-022). */
export type SessionFacts = {
  readonly sessionId: string | null;
  readonly parentSessionId: string | null;
};

/** A record with the parent session id the event layer carries. */
export type SessionTaggedRecord = NormalizedRecord & SessionFacts;

/**
 * Stamp the session facts of a record (F126-FR-022): the session the record
 * itself carries wins, the session of the pass fills the gap, and the parent
 * session id of subagent activity is carried alongside.
 */
export function withSessionFacts(
  record: NormalizedRecord,
  session: SessionFacts,
): SessionTaggedRecord {
  return {
    ...record,
    sessionId: record.sessionId ?? session.sessionId,
    parentSessionId: session.parentSessionId,
  };
}

/**
 * The reference to the transcript of a pass: path and hash, never the content
 * (F126-FR-022). Null where the harness keeps no transcript.
 */
export function transcriptReference(
  path: string | null | undefined,
  content: string | null | undefined,
): { readonly path: string; readonly sha256: string } | null {
  if (path === null || path === undefined || path.length === 0) return null;
  const sha256 = createHash("sha256")
    .update(content ?? "", "utf8")
    .digest("hex");
  return { path, sha256 };
}

/** The time breakdown of a pass, taken from the stream (F126-FR-024). */
export type TimeBreakdown = {
  readonly modelMs: number | null;
  readonly toolMs: number | null;
  readonly waitMs: number | null;
  readonly idleMs: number | null;
  /** The time of the first productive edit, else null (F126-FR-024). */
  readonly firstProductiveEditMs: number | null;
};

/**
 * The time breakdown the records of a pass state (F126-FR-024). Tool time is
 * the sum of the durations the tool records carry; the first productive edit
 * is the duration of the first tool record of category `edit` that carries a
 * duration. Where the stream gives no time, the value is null, never a guess.
 */
export function timeBreakdownOf(records: readonly NormalizedRecord[]): TimeBreakdown {
  let toolMs: number | null = null;
  let firstEdit: number | null = null;
  for (const record of records) {
    if (record.kind !== "tool") continue;
    if (record.durationMs !== null) {
      toolMs = (toolMs ?? 0) + record.durationMs;
    }
    if (record.category === "edit" && record.durationMs !== null && firstEdit === null) {
      firstEdit = record.durationMs;
    }
  }
  return {
    modelMs: null,
    toolMs,
    waitMs: null,
    idleMs: null,
    firstProductiveEditMs: firstEdit,
  };
}

/** A whole, non-negative number, else null. */
function nonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** The increment one usage record contributes, cumulative totals converted. */
function incrementOf(
  record: UsageRecord,
  lastCumulative: { input: number; output: number; cost: number } | undefined,
): Increment {
  if (!record.cumulative) {
    return {
      inputTokens: nonNegative(record.inputTokens),
      outputTokens: nonNegative(record.outputTokens),
      cost: nonNegative(record.cost),
    };
  }
  // A running total becomes an increment per session id (F126-FR-023).
  const previous = lastCumulative ?? { input: 0, output: 0, cost: 0 };
  const input = record.inputTokens;
  const output = record.outputTokens;
  const cost = record.cost;
  return {
    inputTokens: input === null ? null : nonNegative(input - previous.input),
    outputTokens: output === null ? null : nonNegative(output - previous.output),
    cost: cost === null ? null : nonNegative(cost - previous.cost),
  };
}

/** The usage accountant of one pass (F126-FR-023). */
export class UsageAccountant {
  private readonly usageSource: UsageSource;
  private readonly subscription: boolean;
  private readonly parentSessionId: string | null;
  private readonly seenUsageIds = new Set<string>();
  private readonly lastCumulativeBySession = new Map<
    string,
    { input: number; output: number; cost: number }
  >();
  private sessionId: string | null = null;
  private lastUsage: UsageRecord | null = null;
  private reportedCalls = 0;
  private totalInput: number | null = null;
  private totalOutput: number | null = null;
  private totalCost: number | null = null;
  private unavailableReason: UsageUnavailableEvent["reason"] | null = null;
  private killed = false;
  private finished = false;

  constructor(options: UsageAccountantOptions = {}) {
    this.usageSource = options.usageSource ?? "stream";
    this.subscription = options.subscription ?? false;
    this.parentSessionId = options.parentSessionId ?? null;
  }

  /** The session facts the pass has seen so far (F126-FR-022). */
  sessionFacts(): SessionFacts {
    return { sessionId: this.sessionId, parentSessionId: this.parentSessionId };
  }

  /** Consume one normalized record; the usage events it produces, in order. */
  push(record: NormalizedRecord): readonly UsageEvent[] {
    if (record.kind === "init" && record.sessionId !== null) {
      this.sessionId = record.sessionId;
    }
    if (record.kind !== "usage") return [];
    return this.accountUsage(record);
  }

  /**
   * The pass was killed before its terminal: the last partial usage is kept
   * and the pass ends with `usageComplete=false` (F126-FR-023).
   */
  kill(): readonly UsageEvent[] {
    this.killed = true;
    this.unavailableReason = "killed";
    return [
      {
        type: "usage.unavailable",
        reason: "killed",
        detail:
          "the pass was killed before its terminal; the last partial usage is kept and usageComplete is false",
        sessionId: this.sessionId,
        lastUsage: this.lastUsage,
      },
    ];
  }

  /** The stream ended; the usage events of the end, at most once. */
  finish(): readonly UsageEvent[] {
    if (this.finished) return [];
    this.finished = true;
    if (this.reportedCalls > 0 || this.unavailableReason !== null) return [];
    // No usage reached the accountant: the explicit reason is carried.
    this.unavailableReason =
      this.usageSource === "none" ? "harness-does-not-report" : "no-usage-in-stream";
    return [
      {
        type: "usage.unavailable",
        reason: this.unavailableReason,
        detail:
          this.usageSource === "none"
            ? "the harness reports no usage (usage source none)"
            : "the stream of the pass carried no usage record",
        sessionId: this.sessionId,
        lastUsage: null,
      },
    ];
  }

  /** The usage facts of the pass, once it has ended (F126-FR-036). */
  facts(): UsageFacts {
    const complete = this.reportedCalls > 0 && this.unavailableReason === null;
    return {
      usageComplete: complete,
      accounted: complete || this.unavailableReason !== null,
      reportedCalls: this.reportedCalls,
      totalInputTokens: this.totalInput,
      totalOutputTokens: this.totalOutput,
      totalCost: this.totalCost,
      costBasis: this.subscription && this.totalCost !== null ? "notional" : null,
      unavailableReason: this.unavailableReason,
      lastUsage: this.lastUsage,
    };
  }

  private accountUsage(record: UsageRecord): readonly UsageEvent[] {
    if (record.usageId !== null) {
      if (this.seenUsageIds.has(record.usageId)) return []; // deduplicated by usageId
      this.seenUsageIds.add(record.usageId);
    }
    const key = record.sessionId ?? this.sessionId ?? "";
    const increment = incrementOf(record, this.lastCumulativeBySession.get(key));
    if (record.cumulative) {
      this.lastCumulativeBySession.set(key, {
        input: record.inputTokens ?? this.lastCumulativeBySession.get(key)?.input ?? 0,
        output: record.outputTokens ?? this.lastCumulativeBySession.get(key)?.output ?? 0,
        cost: record.cost ?? this.lastCumulativeBySession.get(key)?.cost ?? 0,
      });
    }
    this.lastUsage = record;
    this.reportedCalls += 1;
    if (increment.inputTokens !== null) {
      this.totalInput = (this.totalInput ?? 0) + increment.inputTokens;
    }
    if (increment.outputTokens !== null) {
      this.totalOutput = (this.totalOutput ?? 0) + increment.outputTokens;
    }
    if (increment.cost !== null) {
      this.totalCost = (this.totalCost ?? 0) + increment.cost;
    }
    return [
      {
        type: "usage.reported",
        sessionId: record.sessionId ?? this.sessionId,
        parentSessionId: this.parentSessionId,
        usageId: record.usageId,
        inputTokens: increment.inputTokens,
        outputTokens: increment.outputTokens,
        cacheReadTokens: nonNegative(record.cacheReadTokens),
        cacheWriteTokens: nonNegative(record.cacheWriteTokens),
        reasoningTokens: nonNegative(record.reasoningTokens),
        cost: increment.cost,
        costBasis: this.subscription ? "notional" : "measured",
        increment: true,
      },
    ];
  }
}
