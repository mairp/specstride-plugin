/**
 * T007 — the spend ledger (F127-FR-028, F127-FR-029, F127-FR-030,
 * F127-FR-031).
 *
 * ONE ledger per run, `run:<runId>:spend` of annex B §B.5, in the form
 * `specstride.spend/1` of `specs/127-quota-budgets-and-pause/contracts/spend-ledger.schema.json`.
 * The engine is its one writer. Everything this module does is a pure function
 * over a ledger value and a usage record; the only port it touches is
 * `AtomicWrite`, and only in `writeLedger`.
 *
 * The eight rules T007 names, and where each is:
 *
 * | Rule | Where |
 * |---|---|
 * | atomic write | `writeLedger` — through `AtomicWrite` of annex A §A.3, never a writer of its own |
 * | previous generation | `writeLedger` — the last good copy is written BEFORE the ledger, so a failed write never leaves one generation |
 * | deduplication by `usageId` | `applyUsageRecord` — `seenUsageIds`, a bounded list, oldest dropped |
 * | cumulative to increment | `incrementsOf` — the new value minus the last seen, per session; a terminal total drops the running conversion |
 * | null as unknown | `addUnknownAware` — a value the harness did not report is `null`, sums as UNKNOWN and not as zero |
 * | coverage counters | `passesWithKnownCost` and `passesTotal` per role and billing mode |
 * | three billing modes apart | `byBilling` — `api`, `subscription`, `unknown`; real, notional and estimated cost are three fields and are never summed together |
 * | estimated cost | `estimateOf` — from a DECLARED rate table (`budget.rates`) only, into its own field, and `null` unless declared |
 *
 * F127-FR-029: a cost a harness reports under billing mode `subscription` is
 * NOTIONAL. It goes to `notionalCostUsd`, feeds the alerts of §Q.4 and the
 * digest as value used, and is never added to real spend and never checked
 * against a hard ceiling. A cost under billing mode `unknown` is treated the
 * same way — F127-FR-025 lets a record of `unknown` count towards the
 * observation and the soft budget and never towards a hard ceiling, so it
 * cannot be real spend either.
 *
 * F127-FR-031: the ledger survives a `resume`, and the reset flag of `resume`
 * does not reset it (CQ-130): only `emptyLedger` starts one, and only a new
 * run calls it.
 */
import type { AtomicWrite } from "../quota/ports.ts";

/** The schema id of the ledger (annex B §B.20). */
export const LEDGER_SCHEMA_ID = "specstride.spend/1" as const;

/** The logical name of the ledger (annex B §B.5). */
export const LEDGER_LOGICAL_NAME = "run:<runId>:spend" as const;

/**
 * The three billing modes a usage record carries (F127-FR-028). They are the
 * `propertyNames` of `byBilling` in the ledger schema.
 */
export const BILLING_MODES = ["api", "subscription", "unknown"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

/** A billing mode outside the three is read as `unknown` (F127-FR-028). */
export const BILLING_MODE_WHEN_UNKNOWN: BillingMode = "unknown";

/** Read a billing mode; one outside the three is `unknown`. */
export function readBillingMode(value: string | null | undefined): BillingMode {
  return typeof value === "string" && (BILLING_MODES as readonly string[]).includes(value)
    ? (value as BillingMode)
    : BILLING_MODE_WHEN_UNKNOWN;
}

/**
 * The five token fields of F127-FR-031. §Q.3 keeps cache and reasoning tokens
 * apart: a ceiling of `tokens` is input plus output, and these three are
 * shown beside it and never folded in.
 */
export const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;
export type TokenField = (typeof TOKEN_FIELDS)[number];

/** The two token fields a ceiling of `tokens` sums (§Q.3). */
export const TOKEN_FIELDS_OF_THE_CEILING: readonly TokenField[] = Object.freeze([
  "inputTokens",
  "outputTokens",
]);

/** The three cost fields, kept apart and never summed together (F127-FR-029, F127-FR-030). */
export const COST_FIELDS = ["realCostUsd", "notionalCostUsd", "estimatedCostUsd"] as const;
export type CostField = (typeof COST_FIELDS)[number];

/** How many `usageId` values the ledger remembers for deduplication. */
export const SEEN_USAGE_IDS_CAP = 1000;

/**
 * One bucket of the ledger: one role, one billing mode. A token or cost value
 * is `null` while nothing was ever reported for it — `null` is UNKNOWN and not
 * zero (F127-FR-028).
 */
export type SpendBucket = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  /** Real spend: only a record of billing mode `api` reaches it (F127-FR-025). */
  realCostUsd: number | null;
  /** Notional cost: a figure reported under a subscription (F127-FR-029). */
  notionalCostUsd: number | null;
  /** Estimated cost: computed from a declared rate table only (F127-FR-030). */
  estimatedCostUsd: number | null;
  calls: number;
  /** The coverage of F127-FR-028: how many passes came with a known cost. */
  passesWithKnownCost: number;
  /** The coverage of F127-FR-028: how many passes there were in all. */
  passesTotal: number;
};

/** One role of the ledger. */
export type RoleSpend = {
  byBilling: Partial<Record<BillingMode, SpendBucket>>;
  /** The spend of the confirming probes of the role (F127-FR-006); real spend. */
  probesUsd: number | null;
};

/** The last cumulative values seen for a session, for the conversion to increments. */
export type CumulativeSeen = Partial<Record<TokenField | "costUsd", number>>;

/** A limit-window fact, per harness and model tier (F127-FR-009, F127-FR-031). */
export type LimitWindowFact = {
  readonly quotaClass: string;
  readonly resetsAt: string | null;
  readonly utilization: number | null;
  readonly rateLimitType: string | null;
  readonly observedAt: string;
};

/** The ledger, in the form `specstride.spend/1`. */
export type SpendLedger = {
  schema: typeof LEDGER_SCHEMA_ID;
  runId: string;
  /** The generation; `writeLedger` raises it by one on every write. */
  generation: number;
  /** True where the ledger was rebuilt from zero (F127-FR-032). */
  partial?: boolean;
  /** The bounded list of `usageId` values already applied (F127-FR-028). */
  seenUsageIds: string[];
  /** Per session id: the last cumulative values seen (F127-FR-028). */
  lastSeen: Record<string, CumulativeSeen>;
  roles: Record<string, RoleSpend>;
  run: {
    /** The number of phase attempts STARTED (F127-FR-031). */
    phaseAttempts: number;
    /** The milliseconds spent in a quota pause (F127-FR-012). */
    pausedMs: number;
  };
  windows: {
    /** The start of the pause episode (decision D-3; F127-FR-014). */
    episodeStart: string | null;
    /** The limit-window facts, by `<harness>/<model tier>`. */
    byTarget: Record<string, LimitWindowFact>;
  };
  /** The deduplication keys of the alerts that have fired (§Q.4). */
  alertsFired: string[];
};

/** A usage record, as a harness adapter hands it over (F127-FR-028). */
export type UsageRecord = {
  /** The identity the record is deduplicated by (F127-FR-028). */
  readonly usageId: string;
  readonly role: string;
  /** `api`, `subscription` or `unknown`; another value is read as `unknown`. */
  readonly billingMode: string;
  /**
   * The session the figures belong to. A cumulative report is converted to an
   * increment PER SESSION, so two sessions never subtract from one another.
   */
  readonly sessionId?: string | undefined;
  /** True where the figures are cumulative for the session (F127-FR-028). */
  readonly cumulative?: boolean | undefined;
  /**
   * True where the record is the TERMINAL total of the session: the running
   * conversion is dropped in favour of it (F127-FR-028).
   */
  readonly terminal?: boolean | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
  readonly cacheReadTokens?: number | null | undefined;
  readonly cacheWriteTokens?: number | null | undefined;
  readonly reasoningTokens?: number | null | undefined;
  /** The cost the harness reported, or null where it reported none. */
  readonly costUsd?: number | null | undefined;
  /** True where the record closes a pass: the coverage counters move. */
  readonly closesAPass?: boolean | undefined;
  /** True where the record is a call of the `calls` ceiling (§Q.3). */
  readonly isCall?: boolean | undefined;
  /**
   * True where the record is a confirming probe: real spend, and never a pass,
   * a phase attempt or a call of the `calls` ceiling (F127-FR-006).
   */
  readonly isProbe?: boolean | undefined;
  /** The harness, for the rate table of F127-FR-030. */
  readonly harness?: string | undefined;
  /** The model, for the rate table of F127-FR-030. */
  readonly model?: string | undefined;
};

/**
 * A declared rate table, `budget.rates` (F127-FR-030). The key is
 * `<harness>/<model>`; the figures are US dollars per MILLION tokens. Absent
 * or empty: estimated cost is OFF and `estimatedCostUsd` stays `null`.
 */
export type RateTable = Readonly<
  Record<
    string,
    {
      readonly inputPerMillion?: number;
      readonly outputPerMillion?: number;
      readonly cacheReadPerMillion?: number;
      readonly cacheWritePerMillion?: number;
      readonly reasoningPerMillion?: number;
    }
  >
>;

/** How `applyUsageRecord` is configured. */
export type ApplyOptions = {
  /** The declared rate table; absent means estimated cost is off (F127-FR-030). */
  readonly rates?: RateTable | undefined;
  /** How many `usageId` values to remember; `SEEN_USAGE_IDS_CAP` by default. */
  readonly seenCap?: number;
};

/* ------------------------------------------------------------------ *
 * Construction.
 * ------------------------------------------------------------------ */

/** An empty bucket: every token and cost field unknown, every count zero. */
export function emptyBucket(): SpendBucket {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    realCostUsd: null,
    notionalCostUsd: null,
    estimatedCostUsd: null,
    calls: 0,
    passesWithKnownCost: 0,
    passesTotal: 0,
  };
}

/**
 * A fresh ledger. Only a NEW RUN calls this: the reset flag of `resume` does
 * not reset the ledger (F127-FR-031, CQ-130).
 */
export function emptyLedger(runId: string): SpendLedger {
  return {
    schema: LEDGER_SCHEMA_ID,
    runId,
    generation: 0,
    seenUsageIds: [],
    lastSeen: {},
    roles: {},
    run: { phaseAttempts: 0, pausedMs: 0 },
    windows: { episodeStart: null, byTarget: {} },
    alertsFired: [],
  };
}

function cloneBucket(bucket: SpendBucket): SpendBucket {
  return { ...bucket };
}

/** A deep enough copy that `applyUsageRecord` never mutates its argument. */
export function cloneLedger(ledger: SpendLedger): SpendLedger {
  const roles: Record<string, RoleSpend> = {};
  for (const [role, spend] of Object.entries(ledger.roles)) {
    const byBilling: Partial<Record<BillingMode, SpendBucket>> = {};
    for (const mode of BILLING_MODES) {
      const bucket = spend.byBilling[mode];
      if (bucket !== undefined) byBilling[mode] = cloneBucket(bucket);
    }
    roles[role] = { byBilling, probesUsd: spend.probesUsd };
  }
  const lastSeen: Record<string, CumulativeSeen> = {};
  for (const [session, seen] of Object.entries(ledger.lastSeen)) lastSeen[session] = { ...seen };
  const copy: SpendLedger = {
    schema: ledger.schema,
    runId: ledger.runId,
    generation: ledger.generation,
    seenUsageIds: [...ledger.seenUsageIds],
    lastSeen,
    roles,
    run: { ...ledger.run },
    windows: {
      episodeStart: ledger.windows.episodeStart,
      byTarget: { ...ledger.windows.byTarget },
    },
    alertsFired: [...ledger.alertsFired],
  };
  if (ledger.partial !== undefined) copy.partial = ledger.partial;
  return copy;
}

/** The bucket of a role and a billing mode, created on first use. */
export function bucketOf(ledger: SpendLedger, role: string, mode: BillingMode): SpendBucket {
  const spend = (ledger.roles[role] ??= { byBilling: {}, probesUsd: null });
  return (spend.byBilling[mode] ??= emptyBucket());
}

/* ------------------------------------------------------------------ *
 * null as unknown, and the conversion of cumulative to increment.
 * ------------------------------------------------------------------ */

/**
 * Add an increment to a running figure, UNKNOWN-AWARE (F127-FR-028):
 *
 *  - a `null` increment adds nothing and leaves the figure as it was, so a
 *    value the harness did not report sums as unknown and NOT as zero;
 *  - a figure that is still `null` and takes its first known increment
 *    becomes that increment;
 *  - a figure that is `null` and takes a `null` increment stays `null`.
 */
export function addUnknownAware(running: number | null, increment: number | null): number | null {
  if (increment === null || !Number.isFinite(increment)) return running;
  return (running ?? 0) + increment;
}

/** A number the harness reported, or null where it reported none or nonsense. */
function reported(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The fields a cumulative conversion covers: the five token fields and the cost. */
const CUMULATIVE_FIELDS: readonly (TokenField | "costUsd")[] = Object.freeze([
  ...TOKEN_FIELDS,
  "costUsd",
]);

/** What one usage record contributes, after the conversion of F127-FR-028. */
export type Increments = Partial<Record<TokenField | "costUsd", number | null>>;

/**
 * Turn a usage record into INCREMENTS (F127-FR-028).
 *
 * A record that is not cumulative is already an increment. A CUMULATIVE record
 * is converted per session: the increment is the new value minus the last seen
 * for that session, never below zero (a provider that restarts a counter must
 * not subtract). A record marked `terminal` is the total of the session: the
 * running conversion is DROPPED in favour of it — the increment is the
 * terminal total minus what the session has already contributed, and the
 * session's last-seen state is forgotten.
 *
 * A sum over cumulative records is never taken: every path here subtracts
 * first.
 *
 * Mutates `lastSeen` for the session, which is why `applyUsageRecord` works on
 * a clone.
 */
export function incrementsOf(
  record: UsageRecord,
  lastSeen: Record<string, CumulativeSeen>,
): Increments {
  const out: Increments = {};
  const raw: Increments = {};
  for (const field of CUMULATIVE_FIELDS) {
    raw[field] = reported(record[field as keyof UsageRecord] as number | null | undefined);
  }
  if (record.cumulative !== true) {
    // Already an increment. A terminal total that is not cumulative is itself
    // the increment of its own record.
    return raw;
  }
  const session = record.sessionId ?? `${record.role}\u0000(no session)`;
  const seen = lastSeen[session] ?? {};
  for (const field of CUMULATIVE_FIELDS) {
    const value = raw[field];
    if (value === null || value === undefined) {
      out[field] = null;
      continue;
    }
    const before = seen[field] ?? 0;
    out[field] = Math.max(0, value - before);
    seen[field] = value;
  }
  if (record.terminal === true) {
    // The terminal total ends the session: forget the running conversion.
    delete lastSeen[session];
  } else {
    lastSeen[session] = seen;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * F127-FR-030 — estimated cost, from a declared rate table only.
 * ------------------------------------------------------------------ */

/** The key of the rate table of a record: `<harness>/<model>` (F127-FR-030). */
export function rateKeyOf(record: UsageRecord): string {
  return `${record.harness ?? ""}/${record.model ?? ""}`;
}

/**
 * The estimated cost of one record's increments, from a DECLARED rate table
 * (F127-FR-030). `null` where no rate table is declared, where it holds no
 * entry for the harness and model, or where no token count is known: estimated
 * cost is OFF unless declared and is never merged with reported cost.
 */
export function estimateOf(
  record: UsageRecord,
  increments: Increments,
  rates: RateTable | undefined,
): number | null {
  if (rates === undefined) return null;
  const entry = rates[rateKeyOf(record)];
  if (entry === undefined) return null;
  const perMillion: Readonly<Record<TokenField, number | undefined>> = {
    inputTokens: entry.inputPerMillion,
    outputTokens: entry.outputPerMillion,
    cacheReadTokens: entry.cacheReadPerMillion,
    cacheWriteTokens: entry.cacheWritePerMillion,
    reasoningTokens: entry.reasoningPerMillion,
  };
  let total: number | null = null;
  for (const field of TOKEN_FIELDS) {
    const tokens = increments[field];
    const rate = perMillion[field];
    if (tokens === null || tokens === undefined) continue;
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
    total = (total ?? 0) + (tokens * rate) / 1_000_000;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Applying a usage record.
 * ------------------------------------------------------------------ */

/** What `applyUsageRecord` answers. */
export type ApplyResult = {
  /** The ledger after the record; the argument is never mutated. */
  readonly ledger: SpendLedger;
  /** False where the record was a duplicate and changed nothing. */
  readonly applied: boolean;
  /** Why, where `applied` is false. */
  readonly reason: string | null;
  /** The increments the record contributed, after the conversion. */
  readonly increments: Increments;
  /** The billing mode the record was read as. */
  readonly billingMode: BillingMode;
};

/**
 * Apply one usage record to the ledger (F127-FR-028 to F127-FR-031).
 *
 * Deduplication: a record whose `usageId` the ledger has already seen changes
 * NOTHING — not a token, not a count, not a coverage counter. `seenUsageIds`
 * is bounded and drops the oldest.
 *
 * The three cost fields: a record of billing mode `api` adds its reported cost
 * to `realCostUsd`; a record of `subscription` or `unknown` adds it to
 * `notionalCostUsd`, which no hard ceiling reads (F127-FR-029, F127-FR-025);
 * `estimatedCostUsd` takes only what a declared rate table computes
 * (F127-FR-030). The three are never summed together.
 *
 * The coverage counters: a record that closes a pass raises `passesTotal`, and
 * raises `passesWithKnownCost` only where the record came with a cost
 * (F127-FR-028). A probe raises neither, and is not a call either
 * (F127-FR-006); its spend goes to `probesUsd`.
 */
export function applyUsageRecord(
  ledger: SpendLedger,
  record: UsageRecord,
  options: ApplyOptions = {},
): ApplyResult {
  const billingMode = readBillingMode(record.billingMode);
  if (typeof record.usageId !== "string" || record.usageId.length === 0) {
    return Object.freeze({
      ledger,
      applied: false,
      reason:
        "the usage record carries no `usageId`, by which a record is deduplicated (F127-FR-028)",
      increments: {},
      billingMode,
    });
  }
  if (ledger.seenUsageIds.includes(record.usageId)) {
    return Object.freeze({
      ledger,
      applied: false,
      reason: `the usageId ${record.usageId} was already applied (F127-FR-028)`,
      increments: {},
      billingMode,
    });
  }

  const next = cloneLedger(ledger);
  const increments = incrementsOf(record, next.lastSeen);
  const bucket = bucketOf(next, record.role, billingMode);

  for (const field of TOKEN_FIELDS) {
    bucket[field] = addUnknownAware(bucket[field], increments[field] ?? null);
  }

  const cost = increments.costUsd ?? null;
  if (record.isProbe === true) {
    // F127-FR-006 — a probe is real spend, and never a pass or a call. Its cost
    // goes to `probesUsd` ALONE, the field the ledger schema gives it, and
    // `realCostUsd()` adds that field back in; putting it in the bucket as well
    // would count the same probe twice.
    next.roles[record.role].probesUsd = addUnknownAware(next.roles[record.role].probesUsd, cost);
  } else {
    if (billingMode === "api") {
      bucket.realCostUsd = addUnknownAware(bucket.realCostUsd, cost);
    } else {
      // F127-FR-029 — notional, in its own field, never real spend.
      bucket.notionalCostUsd = addUnknownAware(bucket.notionalCostUsd, cost);
    }
    if (record.isCall === true) bucket.calls += 1;
    if (record.closesAPass === true) {
      bucket.passesTotal += 1;
      if (cost !== null) bucket.passesWithKnownCost += 1;
    }
  }

  // F127-FR-030 — estimated cost, in its own field, off unless declared.
  bucket.estimatedCostUsd = addUnknownAware(
    bucket.estimatedCostUsd,
    estimateOf(record, increments, options.rates),
  );

  const cap = options.seenCap ?? SEEN_USAGE_IDS_CAP;
  next.seenUsageIds.push(record.usageId);
  while (next.seenUsageIds.length > cap) next.seenUsageIds.shift();

  return Object.freeze({
    ledger: next,
    applied: true,
    reason: null,
    increments,
    billingMode,
  });
}

/* ------------------------------------------------------------------ *
 * Reading the three figures apart.
 * ------------------------------------------------------------------ */

/** The sum of one field over the billing modes a reader asks for. */
export function sumOf(
  ledger: SpendLedger,
  field: TokenField | CostField | "calls" | "passesWithKnownCost" | "passesTotal",
  where: { readonly role?: string; readonly modes?: readonly BillingMode[] } = {},
): number | null {
  const modes = where.modes ?? BILLING_MODES;
  const roles = where.role === undefined ? Object.keys(ledger.roles) : [where.role];
  let total: number | null = null;
  for (const role of roles) {
    const spend = ledger.roles[role];
    if (spend === undefined) continue;
    for (const mode of modes) {
      const bucket = spend.byBilling[mode];
      if (bucket === undefined) continue;
      total = addUnknownAware(total, bucket[field]);
    }
  }
  return total;
}

/**
 * The real spend a HARD ceiling reads: `realCostUsd` of the billing mode `api`
 * alone, plus the probes of the role, which are real calls (F127-FR-025,
 * F127-FR-006). Notional and estimated cost are never part of it.
 */
export function realCostUsd(ledger: SpendLedger, role?: string): number | null {
  let total = sumOf(ledger, "realCostUsd", { role, modes: ["api"] });
  const roles = role === undefined ? Object.keys(ledger.roles) : [role];
  for (const name of roles) {
    total = addUnknownAware(total, ledger.roles[name]?.probesUsd ?? null);
  }
  return total;
}

/** The notional cost of F127-FR-029: never real spend, never a hard ceiling. */
export function notionalCostUsd(ledger: SpendLedger, role?: string): number | null {
  return sumOf(ledger, "notionalCostUsd", { role });
}

/** The estimated cost of F127-FR-030: its own field, never merged. */
export function estimatedCostUsd(ledger: SpendLedger, role?: string): number | null {
  return sumOf(ledger, "estimatedCostUsd", { role });
}

/**
 * F127-FR-029, the digest clause — "spend under a subscription that is shared
 * with interactive use MUST be marked `observed by Specstride only`". The
 * phrase is here, once, so that the digest and the announcement of
 * `./announce.ts` carry the same words.
 */
export const OBSERVED_BY_SPECSTRIDE_ONLY = "observed by Specstride only" as const;

/** What the digest shows as VALUE USED for a role (F127-FR-029). */
export type DigestValueUsed = {
  readonly role: string | null;
  /** The notional figure; it is NOT real spend. */
  readonly notionalCostUsd: number | null;
  /** The real spend of the role, kept apart. */
  readonly realCostUsd: number | null;
  /** True where the figure is notional, so the mark applies. */
  readonly notional: boolean;
  /** The mark, where the figure is notional; null where it is real spend. */
  readonly mark: typeof OBSERVED_BY_SPECSTRIDE_ONLY | null;
  /** The line the digest prints. */
  readonly line: string;
};

/**
 * The VALUE USED of the digest (F127-FR-029). Notional cost feeds it, marked
 * `observed by Specstride only` where the subscription is shared with
 * interactive use — the product sees its own calls and not the consumer's.
 * Real spend is reported in the same answer and never summed with it.
 */
export function digestValueUsed(
  ledger: SpendLedger,
  options: {
    readonly role?: string | undefined;
    /** True where the subscription is shared with interactive use. */
    readonly sharedWithInteractiveUse?: boolean | undefined;
  } = {},
): DigestValueUsed {
  const role = options.role ?? null;
  const notionalValue = notionalCostUsd(ledger, options.role);
  const realValue = realCostUsd(ledger, options.role);
  const notional = notionalValue !== null;
  const marked = notional && options.sharedWithInteractiveUse !== false;
  const figure = notionalValue === null ? "unknown" : String(notionalValue);
  return Object.freeze({
    role,
    notionalCostUsd: notionalValue,
    realCostUsd: realValue,
    notional,
    mark: marked ? OBSERVED_BY_SPECSTRIDE_ONLY : null,
    line: marked
      ? `${role ?? "run"}: value used ${figure} (notional, ${OBSERVED_BY_SPECSTRIDE_ONLY})`
      : `${role ?? "run"}: value used ${figure}`,
  });
}

/**
 * The tokens a ceiling of `tokens` reads: input plus output of the billing
 * mode `api` (§Q.3, F127-FR-025). Cache and reasoning tokens are never folded
 * in.
 */
export function hardTokens(ledger: SpendLedger, role?: string): number | null {
  let total: number | null = null;
  for (const field of TOKEN_FIELDS_OF_THE_CEILING) {
    total = addUnknownAware(total, sumOf(ledger, field, { role, modes: ["api"] }));
  }
  return total;
}

/**
 * The tokens a SOFT budget reads: every observed token of the role, whatever
 * the billing mode, including `unknown` (F127-FR-025).
 */
export function observedTokens(ledger: SpendLedger, role?: string): number | null {
  let total: number | null = null;
  for (const field of TOKEN_FIELDS_OF_THE_CEILING) {
    total = addUnknownAware(total, sumOf(ledger, field, { role }));
  }
  return total;
}

/** The coverage of F127-FR-028, per role or over the run. */
export function coverageOf(
  ledger: SpendLedger,
  role?: string,
): { readonly passesWithKnownCost: number; readonly passesTotal: number } {
  const known = sumOf(ledger, "passesWithKnownCost", { role }) ?? 0;
  const total = sumOf(ledger, "passesTotal", { role }) ?? 0;
  return { passesWithKnownCost: known, passesTotal: total };
}

/** The calls of the `calls` ceiling (§Q.3); a probe is not one (F127-FR-006). */
export function callCount(ledger: SpendLedger, role?: string): number {
  return sumOf(ledger, "calls", { role }) ?? 0;
}

/* ------------------------------------------------------------------ *
 * The atomic write, and the previous generation.
 * ------------------------------------------------------------------ */

/** Where the ledger and the copy beside it live. */
export type LedgerPaths = {
  /** The physical path of `run:<runId>:spend`. */
  readonly ledger: string;
  /** The previous generation, kept BESIDE the ledger (F127-FR-032). */
  readonly previous: string;
};

/** The suffix of the previous generation, kept beside the ledger. */
export const PREVIOUS_GENERATION_SUFFIX = ".prev" as const;

/** The two paths, from the physical path of the ledger. */
export function ledgerPaths(ledgerPath: string): LedgerPaths {
  return Object.freeze({
    ledger: ledgerPath,
    previous: `${ledgerPath}${PREVIOUS_GENERATION_SUFFIX}`,
  });
}

/** The ledger as text, in the field order of `specstride.spend/1`. */
export function serializeLedger(ledger: SpendLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

/**
 * Write the ledger ATOMICALLY, keeping the PREVIOUS GENERATION (F127-FR-031,
 * F127-FR-032).
 *
 * Order, and it matters: the content the ledger file holds now is copied to the
 * previous generation FIRST, and only then is the ledger replaced. So at every
 * instant at least one of the two files is a good copy, and an unreadable
 * ledger has somewhere to be rebuilt from (`./rebuild.ts`). The generation of
 * the written ledger is one higher than the one handed in.
 *
 * Both writes go through `AtomicWrite` of annex A §A.3: this module opens no
 * file of its own. A ledger that cannot be read while the previous generation
 * is being kept is left alone — overwriting a good previous generation with
 * nothing is the one thing F127-FR-032 cannot afford.
 */
export function writeLedger(
  writer: AtomicWrite,
  paths: LedgerPaths,
  ledger: SpendLedger,
): SpendLedger {
  if (writer.exists(paths.ledger)) {
    try {
      writer.write(paths.previous, writer.read(paths.ledger));
    } catch {
      // The ledger is unreadable: keep the previous generation as it stands.
    }
  }
  const written: SpendLedger = { ...cloneLedger(ledger), generation: ledger.generation + 1 };
  writer.write(paths.ledger, serializeLedger(written));
  return written;
}

/**
 * Apply a usage record and write the ledger at once (F127-FR-031: "written
 * atomically after every usage record"). A killed pass therefore loses nothing
 * already reported (F127-FR-028).
 */
export function recordUsage(
  writer: AtomicWrite,
  paths: LedgerPaths,
  ledger: SpendLedger,
  record: UsageRecord,
  options: ApplyOptions = {},
): ApplyResult {
  const result = applyUsageRecord(ledger, record, options);
  if (!result.applied) return result;
  return Object.freeze({ ...result, ledger: writeLedger(writer, paths, result.ledger) });
}

/* ------------------------------------------------------------------ *
 * Reading a ledger value back.
 * ------------------------------------------------------------------ */

/** A ledger value that is not of the form `specstride.spend/1`. */
export class LedgerShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a ledger from text and check it against the required fields of
 * `specs/127-quota-budgets-and-pause/contracts/spend-ledger.schema.json`
 * (`schema`, `runId`, `generation`, `roles`, `run`, `windows`). Throws
 * `LedgerShapeError` on anything else, which `./rebuild.ts` reads as
 * "unreadable" (F127-FR-032).
 */
export function parseLedger(text: string): SpendLedger {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new LedgerShapeError(`the ledger is not JSON: ${String(error)}`);
  }
  if (!isRecord(value)) throw new LedgerShapeError("the ledger is not a record");
  if (value.schema !== LEDGER_SCHEMA_ID) {
    throw new LedgerShapeError(
      `the ledger carries the schema id ${JSON.stringify(value.schema)}, not ${LEDGER_SCHEMA_ID}`,
    );
  }
  for (const field of ["runId", "generation", "roles", "run", "windows"] as const) {
    if (value[field] === undefined) {
      throw new LedgerShapeError(`the ledger has no \`${field}\` (${LEDGER_SCHEMA_ID})`);
    }
  }
  if (typeof value.runId !== "string") throw new LedgerShapeError("`runId` is not text");
  if (!Number.isInteger(value.generation) || (value.generation as number) < 0) {
    throw new LedgerShapeError("`generation` is not a whole number of 0 or more");
  }
  const base = emptyLedger(value.runId);
  const ledger: SpendLedger = {
    ...base,
    generation: value.generation as number,
    seenUsageIds: Array.isArray(value.seenUsageIds) ? (value.seenUsageIds as string[]) : [],
    lastSeen: isRecord(value.lastSeen) ? (value.lastSeen as Record<string, CumulativeSeen>) : {},
    roles: isRecord(value.roles) ? (value.roles as Record<string, RoleSpend>) : {},
    run: {
      phaseAttempts:
        isRecord(value.run) && typeof value.run.phaseAttempts === "number"
          ? value.run.phaseAttempts
          : 0,
      pausedMs:
        isRecord(value.run) && typeof value.run.pausedMs === "number" ? value.run.pausedMs : 0,
    },
    windows: {
      episodeStart:
        isRecord(value.windows) && typeof value.windows.episodeStart === "string"
          ? value.windows.episodeStart
          : null,
      byTarget:
        isRecord(value.windows) && isRecord(value.windows.byTarget)
          ? (value.windows.byTarget as Record<string, LimitWindowFact>)
          : {},
    },
    alertsFired: Array.isArray(value.alertsFired) ? (value.alertsFired as string[]) : [],
  };
  if (typeof value.partial === "boolean") ledger.partial = value.partial;
  return ledger;
}
