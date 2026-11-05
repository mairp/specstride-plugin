/**
 * T020 — the source `host` (F127-FR-007).
 *
 * A host — Claude Code is the first one — sometimes sees a limit of its own
 * before the run's own call fails: the interactive session shares the window
 * with the run. The host hands that fact to the run as an INBOX REQUEST of the
 * type `host-event` (annex B §B.11, `inbox:host-events:<launchId>`), and the
 * classifier reads it with the confidence `host` (row 47 of annex X §X.6).
 *
 * Three rules, and they are the whole of this module:
 *
 *  1. **it informs only** — a host fact MUST never pause, stop or relaunch a
 *     run by itself. `HOST_FACT_INFORMS_ONLY` of `@specstride/contracts` says
 *     the same of the inbox request;
 *  2. **it is probed** — `host` is one of the three confidences of §Q.2 that
 *     pause only after the confirming probe of `./probe.ts`;
 *  3. **it raises the window-use estimate under auth tier 1** — tier 1 is the
 *     subscription of the person at the keyboard, so the host's use and the
 *     run's use come out of ONE window. The estimate the run keeps of that
 *     window therefore rises by what the host reports, and the estimate is an
 *     alert input (`observe` of `./classify.ts`, §Q.4).
 *
 * The module reads no clock and no file: the inbox request is handed in, and
 * the instant of the observation comes from the request's own field `at`.
 */
import { validate } from "@specstride/contracts/records/compile";
import { observe, type ObserveLevel, type ResetSource } from "./classify.ts";
import { needsAConfirmingProbe } from "./probe.ts";
import type { Confidence } from "@specstride/contracts/ep/quota-classifier";
import type { QuotaClassifyInput } from "./classify.ts";
import type { ProbeDecision } from "./probe.ts";

/* ------------------------------------------------------------------ *
 * The inbox request type and the three rules, as data.
 * ------------------------------------------------------------------ */

/**
 * The inbox request of annex B §B.11, `specstride.inbox/1`, as the fields this
 * module reads.
 *
 * Feature 100's own module for the record (`src/records/inbox-request.ts`) is
 * not in the export map of `@specstride/contracts`, so the shape is declared
 * here and the record is validated against feature 100's SCHEMA, which the
 * package does export (`validate` of `records/compile`). Reported to feature
 * 100 beside the three differences of `packages/policy/test/closed-sets-100.md`;
 * nothing is written into `packages/contracts/`.
 */
export type InboxRequest = {
  readonly schema?: string | undefined;
  /** A member of the closed set of inbox request types (row 21 of §X.6). */
  readonly type?: string | undefined;
  readonly at?: string | undefined;
  /** What the host observed, for example a limit of the host. */
  readonly kind?: string | undefined;
  /** Facts of the observation, redacted by the host. */
  readonly data?: Readonly<Record<string, unknown>> | undefined;
};

/** The schema id of the inbox request (annex B §B.11). */
export const INBOX_SCHEMA_ID = "specstride.inbox/1" as const;

/** The three inbox request types of §B.11 (row 21 of annex X §X.6). */
export const INBOX_REQUEST_TYPES = ["stop", "hold-relaunch", "host-event"] as const;

/** The inbox request type a host fact arrives as (annex B §B.11). */
export const HOST_EVENT_TYPE = "host-event" as const;

/** The logical name of the inbox the request is read from (annex B §B.5). */
export const HOST_EVENT_INBOX = "inbox:host-events:<launchId>" as const;

/** The confidence a classification from a host fact carries (row 47). */
export const HOST_CONFIDENCE: Confidence = "host";

/**
 * F127-FR-007 — a host fact informs ONLY. Each of the three is false, and the
 * contracts package carries the same rule for the inbox request itself
 * (`HOST_EVENT_INFORMS_ONLY`).
 */
export const A_HOST_FACT_BY_ITSELF = Object.freeze({
  pausesTheRun: false,
  stopsTheRun: false,
  relaunchesTheRun: false,
  /** It must pass the confirming probe of §Q.2 before a pause. */
  needsTheConfirmingProbe: true,
  /** It is an alert input (§Q.4). */
  isAnAlertInput: true,
});

/** §B.11's own statement of the same rule, for a reader of this module. */
export const INFORMS_ONLY = true as const;

/** The auth tier whose window the host and the run share (F127-FR-007). */
export const SHARED_WINDOW_AUTH_TIER = 1 as const;

/* ------------------------------------------------------------------ *
 * 1. Reading the inbox request.
 * ------------------------------------------------------------------ */

/** A fact a host observed, as this module reads it from the inbox request. */
export type HostFact = {
  /** Always `host`: the source of the evidence (§Q.2). */
  readonly source: "host";
  /** What the host observed, from the field `kind` of the request. */
  readonly kind: string;
  /** The facts of the observation, redacted by the host (field `data`). */
  readonly data: Readonly<Record<string, unknown>>;
  /** The time of the request (field `at`), or null. */
  readonly at: string | null;
  /** The share of the window the host reports as used, 0 to 1, or null. */
  readonly utilization: number | null;
  /** The reset time the host reported, or null. */
  readonly resetsAt: string | null;
  /** The source of `resetsAt`: a host reports a time, never a stream field. */
  readonly resetsAtSource: ResetSource | null;
  /** The class the host named, where it named one. */
  readonly namedClass: string | null;
};

function fraction(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read an inbox request of the type `host-event` as a host fact (F127-FR-007).
 *
 * A request of another type gives null: this module reads the one type it
 * owns, and a request of the type `stop` or `hold-relaunch` belongs to the
 * run-state machine and not to the classifier.
 */
export function readHostEvent(request: InboxRequest | null | undefined): HostFact | null {
  if (request === null || request === undefined) return null;
  if (request.type !== HOST_EVENT_TYPE) return null;
  if (!(INBOX_REQUEST_TYPES as readonly string[]).includes(String(request.type))) return null;
  if (request.schema !== undefined) {
    const read = validate<InboxRequest>(INBOX_SCHEMA_ID, request);
    if (!read.ok) return null;
  }
  const data = (request.data ?? {}) as Readonly<Record<string, unknown>>;
  return Object.freeze({
    source: "host" as const,
    kind: request.kind ?? "",
    data: Object.freeze({ ...data }),
    at: text(request.at),
    utilization: fraction(data.utilization),
    resetsAt: text(data.resetsAt),
    resetsAtSource: text(data.resetsAt) === null ? null : ("parsed_text" as ResetSource),
    namedClass: text(data.class),
  });
}

/* ------------------------------------------------------------------ *
 * 2. The classification: the input the classifier is handed.
 * ------------------------------------------------------------------ */

/**
 * The classifier input of a host fact: the class the host named with the
 * confidence `host` (F127-FR-007). The fact carries no stream record and no
 * status, so the table fires on `structuredClass` alone, and the confidence of
 * the row is overridden by `host` — the fact is a host's observation and not
 * a structured record of this run's own stream.
 */
export function classifyInputOf(fact: HostFact): QuotaClassifyInput {
  return Object.freeze({
    structuredClass: fact.namedClass,
    confidence: HOST_CONFIDENCE,
    utilization: fact.utilization,
    resetsAt: fact.resetsAt === null ? undefined : { parsedText: fact.resetsAt },
  });
}

/* ------------------------------------------------------------------ *
 * 3. What a host fact may and may not do.
 * ------------------------------------------------------------------ */

/** What `decideOnAHostFact` answers. */
export type HostDecision = {
  /** True where the run may enter the pause now. */
  readonly pauses: boolean;
  /** True where the fact still needs the confirming probe of §Q.2. */
  readonly needsTheProbe: boolean;
  /** The alert level the fact raises, or undefined (§Q.4). */
  readonly alertLevel: ObserveLevel | undefined;
  /** Always false: a host fact never stops or relaunches a run by itself. */
  readonly stops: false;
  readonly relaunches: false;
  /** Why, in one line. */
  readonly note: string;
};

/**
 * F127-FR-007 — what a host fact leads to.
 *
 * With no probe decision the answer is "informs only": the fact raises an
 * alert and the run goes on. With a probe decision that CONFIRMED a limit
 * class the pause may begin; a refuted probe leaves the run running.
 */
export function decideOnAHostFact(fact: HostFact, probe?: ProbeDecision | null): HostDecision {
  const alertLevel = observe({ kind: "host-fact", fact: fact.kind });
  if (probe === null || probe === undefined) {
    return Object.freeze({
      pauses: false,
      needsTheProbe: needsAConfirmingProbe(HOST_CONFIDENCE),
      alertLevel,
      stops: false as const,
      relaunches: false as const,
      note:
        `the host fact ${fact.kind || "(unnamed)"} informs only: it raises an alert and never ` +
        `pauses, stops or relaunches the run by itself; a pause needs the confirming probe ` +
        `of §Q.2 first (F127-FR-007)`,
    });
  }
  return Object.freeze({
    pauses: probe.outcome === "confirmed" && probe.pauses,
    needsTheProbe: false,
    alertLevel,
    stops: false as const,
    relaunches: false as const,
    note:
      `the host fact ${fact.kind || "(unnamed)"} was probed: the probe ${probe.outcome}; ` +
      `${probe.note}`,
  });
}

/* ------------------------------------------------------------------ *
 * 4. The window-use estimate shared with the interactive session.
 * ------------------------------------------------------------------ */

/** The estimate the run keeps of the window it shares with the host. */
export type WindowUseEstimate = {
  /** The share of the window used, 0 to 1, or null where nothing is known. */
  readonly used: number | null;
  /** True where the window is shared with the interactive session (tier 1). */
  readonly sharedWithTheInteractiveSession: boolean;
  /** The auth tier the estimate was computed under. */
  readonly authTier: number | null;
  /** By how much the host fact raised the estimate; 0 where it did not. */
  readonly raisedBy: number;
  /** The alert level of the estimate, or undefined (§Q.4 through `observe`). */
  readonly alertLevel: ObserveLevel | undefined;
  /** Why, in one line. */
  readonly note: string;
};

/** How the estimate is computed. */
export type WindowUseOptions = {
  /** The auth tier of the role (F127-FR-007: tier 1 shares the window). */
  readonly authTier: number | null;
  /** The estimate before this fact, 0 to 1, or null. */
  readonly previous?: number | null | undefined;
};

/**
 * F127-FR-007 — a host fact under auth tier 1 RAISES the estimate of the
 * window use shared with the interactive session, and is an alert input.
 *
 * Under tier 1 the host's use and the run's use come out of one window, so the
 * two are ADDED and the sum is capped at 1. Under any other tier the window is
 * not shared: the estimate is left where it was, and the fact informs only.
 */
export function estimateWindowUse(fact: HostFact, options: WindowUseOptions): WindowUseEstimate {
  const previous = fraction(options.previous ?? null);
  const shared = options.authTier === SHARED_WINDOW_AUTH_TIER;
  const reported = fact.utilization;

  if (!shared || reported === null) {
    const used = previous;
    return Object.freeze({
      used,
      sharedWithTheInteractiveSession: shared,
      authTier: options.authTier,
      raisedBy: 0,
      alertLevel:
        used === null ? undefined : observe({ kind: "gauge", remaining: 1 - used, of: "window" }),
      note: shared
        ? `the host fact reports no utilization, so the estimate of the shared window stays ` +
          `where it was (F127-FR-007)`
        : `the auth tier is ${String(options.authTier)} and not ${SHARED_WINDOW_AUTH_TIER}, so ` +
          `the window is not shared with the interactive session and the estimate is ` +
          `unchanged (F127-FR-007)`,
    });
  }

  const used = Math.min(1, (previous ?? 0) + reported);
  return Object.freeze({
    used,
    sharedWithTheInteractiveSession: true,
    authTier: options.authTier,
    raisedBy: used - (previous ?? 0),
    alertLevel: observe({ kind: "gauge", remaining: 1 - used, of: "window" }),
    note:
      `under auth tier ${SHARED_WINDOW_AUTH_TIER} the host and the run share one window, so ` +
      `the host's ${reported} raises the estimate from ${String(previous)} to ${used} ` +
      `(F127-FR-007)`,
  });
}
