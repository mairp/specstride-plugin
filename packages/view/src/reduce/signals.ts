/**
 * T020 — ONE FUNCTION PER SIGNAL of the signal table.
 *
 * No function here names an event type: `src/signals/table.ts` maps the type to
 * the signal, and this map gives the one function of that signal. A type the
 * table does not hold reaches no function at all and changes no field
 * (F129-FR-005, rule 3 of `contracts/signal-table.md`).
 */
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import type { Signal } from "../signals/table.ts";
import { safeText, type Redactor } from "../text/index.ts";
import type { BudgetDraft, ViewDraft } from "./draft.ts";
import { isNotionalCostClass } from "../budget/index.ts";

/** What a signal function is given besides the draft and the event. */
export type FoldContext = {
  readonly redactor: Redactor | null;
  readonly timelineRows: number;
  readonly textCap: number;
};

/** A function of one signal. */
export type SignalFunction = (draft: ViewDraft, event: EventEnvelope, ctx: FoldContext) => void;

/* ------------------------------------------------------------------ *
 * Reading one field of `data` without trusting its type.
 * ------------------------------------------------------------------ */

function data(event: EventEnvelope): Readonly<Record<string, unknown>> {
  const value = (event as { data?: unknown }).data;
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function num(source: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function text(source: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function _truth(source: Readonly<Record<string, unknown>>, key: string): boolean {
  return source[key] === true;
}

/** A free-text field of the view: redacted, without control characters, cut. */
function freeText(
  draft: ViewDraft,
  ctx: FoldContext,
  field: string,
  raw: string | null,
): string | null {
  if (raw === null) return null;
  const outcome = safeText(raw, ctx.redactor, ctx.textCap);
  if (outcome.dropped) {
    if (!draft.diagnostics.fieldsDropped.includes(field))
      draft.diagnostics.fieldsDropped.push(field);
    if (outcome.dropReason === "no-redactor" || outcome.dropReason === "redactor-failed") {
      draft.diagnostics.redactorFailed = true;
    }
    return null;
  }
  if (outcome.cut && !draft.diagnostics.fieldsCut.includes(field)) {
    draft.diagnostics.fieldsCut.push(field);
  }
  return outcome.value;
}

/** Add one row to the timeline, keeping the newest `timelineRows` of them. */
function timelineRow(
  draft: ViewDraft,
  ctx: FoldContext,
  event: EventEnvelope,
  rowText: string | null,
): void {
  draft.timeline.rows.push({
    seq: event.seq,
    ts: event.ts ?? null,
    kind: event.type,
    text: freeText(draft, ctx, "timeline.text", rowText),
  });
  while (draft.timeline.rows.length > ctx.timelineRows) {
    draft.timeline.rows.shift();
    draft.timeline.omitted += 1;
  }
}

function phaseEntry(draft: ViewDraft, number: number): (typeof draft.phases)[number] {
  const found = draft.phases.find((phase) => phase.number === number);
  if (found !== undefined) return found;
  const made = { number, title: null, evidence: false, approved: false, feedback: false };
  draft.phases.push(made);
  draft.phases.sort((a, b) => a.number - b.number);
  return made;
}

function phaseNumberOf(event: EventEnvelope): number | null {
  const d = data(event);
  return num(d, "phase") ?? num(d, "number") ?? num({ phaseId: event.phaseId } as never, "phaseId");
}

function budgetRow(draft: ViewDraft, event: EventEnvelope): BudgetDraft {
  const d = data(event);
  const scope = text(d, "scope") ?? "run";
  const role = event.role ?? text(d, "role");
  const costClass = text(d, "costClass") ?? text(d, "class");
  const found = draft.budget.find(
    (row) => row.scope === scope && row.role === role && row.costClass === costClass,
  );
  if (found !== undefined) return found;
  const made: BudgetDraft = {
    scope,
    role,
    costClass,
    spent: null,
    tokens: null,
    cap: null,
    fraction: null,
    level: "unknown",
    // F129-FR-020: the cost class `subscription` is the notional one from the
    // row's birth; `fallback.switched` marks its row notional later (below).
    notional: isNotionalCostClass(costClass),
    quota: "ok",
  };
  draft.budget.push(made);
  return made;
}

/* ------------------------------------------------------------------ *
 * The functions, one per signal.
 * ------------------------------------------------------------------ */

const run: SignalFunction = (draft, event, ctx) => {
  if (event.type === "run.started") {
    if (draft.stream.runStartedAt === null) draft.stream.runStartedAt = event.ts ?? null;
    // F129-FR-010: the number of phases the run declared, stated by
    // `run.started` (`phases`) and by `run.launched` (`pending`'s length at
    // most; the view takes the stated number).
    const total = num(data(event), "phases");
    if (total !== null) draft.progress.phases = total;
  } else {
    draft.stream.runEndedAt = event.ts ?? null;
  }
  timelineRow(draft, ctx, event, text(data(event), "endCause"));
};

const launch: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  draft.launch.launchId = event.launchId ?? draft.launch.launchId;
  draft.launch.reason = text(d, "reason") ?? draft.launch.reason;
  draft.launch.engineStartId = event.engineStartId ?? draft.launch.engineStartId;
  if (draft.stream.runStartedAt === null) draft.stream.runStartedAt = event.ts ?? null;
  // F129-FR-010: the reject count and the MALFORMED count are counts of the
  // current phase and SURVIVE a resume, so a relaunching `run.launched` — even
  // one whose engine reset its own counters (`countsReset`) — clears none of
  // them. The units of work belong to one attempt and start again.
  draft.progress.units = null;
  timelineRow(draft, ctx, event, text(d, "reason"));
};

const pause: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "reason"));
};

const quota: SignalFunction = (draft, event, ctx) => {
  budgetRow(draft, event).quota = "signalled";
  timelineRow(draft, ctx, event, text(data(event), "reason"));
};

const billing: SignalFunction = (draft, event) => {
  const row = budgetRow(draft, event);
  row.costClass = text(data(event), "costClass") ?? row.costClass;
  row.notional =
    event.type === "fallback.switched" || isNotionalCostClass(row.costClass) || row.notional;
};

const alert: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  const row = budgetRow(draft, event);
  const level = text(d, "level");
  if (level === "info" || level === "warn" || level === "loud" || level === "over") {
    row.level = level;
  }
  row.cap = num(d, "threshold") ?? row.cap;
  timelineRow(draft, ctx, event, text(d, "kind"));
};

const capExceeded: SignalFunction = (draft, event, ctx) => {
  budgetRow(draft, event).level = "over";
  timelineRow(draft, ctx, event, text(data(event), "scope"));
};

const usage: SignalFunction = (draft, event) => {
  const d = data(event);
  const row = budgetRow(draft, event);
  if (event.type === "usage.unavailable") {
    row.spent = null;
    row.notional = true;
    return;
  }
  const spent = num(d, "spent") ?? num(d, "cost");
  if (spent !== null) row.spent = (row.spent ?? 0) + spent;
  const tokens = num(d, "tokens");
  if (tokens !== null) row.tokens = (row.tokens ?? 0) + tokens;
  const cap = num(d, "cap");
  if (cap !== null) row.cap = cap;
  if (row.cap !== null && row.cap > 0 && row.spent !== null) row.fraction = row.spent / row.cap;
};

const strategy: SignalFunction = (draft, event) => {
  const d = data(event);
  const chosen = text(d, "strategy");
  if (chosen === "classic" || chosen === "micro") draft.strategy.strategy = chosen;
  draft.strategy.microLevel = num(d, "level") ?? draft.strategy.microLevel;
  draft.strategy.layerOffReason = text(d, "reason") ?? draft.strategy.layerOffReason;
};

const phase: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  const number = phaseNumberOf(event);
  const total = num(d, "total") ?? num(d, "phases");
  if (total !== null) draft.progress.phases = total;
  if (number !== null) {
    const entry = phaseEntry(draft, number);
    const title = text(d, "title");
    if (title !== null) entry.title = freeText(draft, ctx, "phases.title", title);
    if (event.type === "phase.started") {
      draft.progress.phase = number;
      draft.progress.phaseAttempt = null;
      draft.progress.pass = null;
    } else if (text(d, "outcome") === "approved") {
      entry.approved = true;
    }
  }
  timelineRow(draft, ctx, event, text(d, "outcome"));
};

const phaseAttempt: SignalFunction = (draft, event) => {
  const d = data(event);
  const ordinal = num(d, "attempt") ?? (typeof event.attempt === "number" ? event.attempt : null);
  if (event.type === "attempt.started" && ordinal !== null) draft.progress.phaseAttempt = ordinal;
  const chosen = event.strategy ?? text(d, "strategy");
  if (chosen === "classic" || chosen === "micro") draft.strategy.strategy = chosen;
};

const pass: SignalFunction = (draft, event) => {
  const d = data(event);
  const ordinal = num(d, "pass") ?? (typeof event.pass === "number" ? event.pass : null);
  // T074 (F129-FR-022) — the agent hours of the group `parallel` are the sum
  // of the durations of EVERY pass of the run, the passes of workers included.
  // A pass states its own `durationSec` where it has one; otherwise the
  // duration is the time from `pass.started` to `pass.ended`. The sum lives on
  // the view (the field `passSeconds` of the group `stream`), so folding one
  // event at a time and one
  // batch derive the same hours (F129-FR-002). Parsing the times the events
  // themselves record reads no clock.
  if (event.type === "pass.started") {
    if (ordinal !== null) draft.progress.pass = ordinal;
    draft.stream.passStartedAt = event.ts ?? draft.stream.passStartedAt;
    return;
  }
  if (event.type === "pass.ended") {
    let seconds = num(d, "durationSec") ?? num(d, "duration");
    if (seconds === null && draft.stream.passStartedAt !== null && event.ts !== null) {
      const start = Date.parse(draft.stream.passStartedAt);
      const end = Date.parse(event.ts);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        seconds = (end - start) / 1000;
      }
    }
    if (seconds !== null) draft.stream.passSeconds += seconds;
    draft.stream.passStartedAt = null;
  }
};

const yieldSignal: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "predicate"));
};

const evidence: SignalFunction = (draft, event) => {
  const number = phaseNumberOf(event) ?? draft.progress.phase;
  if (number !== null) phaseEntry(draft, number).evidence = true;
};

const verification: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "outcome"));
};

const check: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "checkId"));
};

const job: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "jobId"));
};

const unit: SignalFunction = (draft, event) => {
  const d = data(event);
  const units = draft.progress.units ?? { done: 0, declared: null };
  const declared = num(d, "declared") ?? num(d, "total");
  if (declared !== null) units.declared = declared;
  const done = num(d, "done");
  units.done = done !== null ? done : units.done + 1;
  draft.progress.units = units;
  draft.strategy.layerOffReason = text(d, "layerOff") ?? draft.strategy.layerOffReason;
};

const criticSelected: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "strategy"));
};

const criticCall: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "verdict"));
};

const verdict: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  // The field the event grammar binds (annex X §X.6 row 92: `result`), written
  // upper case: APPROVED, REJECTED, MALFORMED.
  const value = text(d, "result")?.toUpperCase() ?? text(d, "verdict");
  if (value === "REJECTED") draft.progress.rejects += 1;
  if (value === "MALFORMED") draft.progress.malformed += 1;
  const number = phaseNumberOf(event) ?? draft.progress.phase;
  if (number !== null && (value === "REJECTED" || value === "MALFORMED")) {
    phaseEntry(draft, number).feedback = true;
  }
  timelineRow(draft, ctx, event, value);
};

const blocked: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  // T055 — the event `blocked` is the second source of the item
  // `blocked-on-human` / `source-changed` (`contracts/lane-and-attention.md`):
  // the terminal record stands over it, so it fills only a gap the settle left.
  if (draft.raise.blocked === null) {
    const rawOptions = d["options"];
    draft.raise.blocked = {
      reason: text(d, "reason"),
      question: text(d, "question"),
      options: Array.isArray(rawOptions)
        ? Object.freeze(rawOptions.filter((entry): entry is string => typeof entry === "string"))
        : Object.freeze([]),
      need: freeText(draft, ctx, "blocked.need", text(d, "need") ?? text(d, "message")),
    };
  }
  timelineRow(draft, ctx, event, text(d, "reason"));
};

const supervision: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "justification"));
};

const countsReset: SignalFunction = (draft, event, ctx) => {
  // The engine says it reset its own counters (`which`); the view follows only
  // the ones the event names (F129-FR-010: a relaunching `run.launched` clears
  // none of the counts — this is the engine's own event, not a relaunch).
  const raw = data(event)["which"];
  const which = Array.isArray(raw) ? raw.map(String) : raw !== undefined ? [String(raw)] : [];
  resetCounts(draft, which);
  timelineRow(draft, ctx, event, text(data(event), "by"));
};

function resetCounts(draft: ViewDraft, which: readonly string[]): void {
  for (const name of which) {
    if (name === "rejects") draft.progress.rejects = 0;
    if (name === "malformed") draft.progress.malformed = 0;
  }
}

const latestTool: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  draft.activity.latestTool = {
    name: text(d, "name") ?? text(d, "tool"),
    summary: freeText(draft, ctx, "activity.latestTool.summary", text(d, "summary")),
  };
};

const observability: SignalFunction = (draft, event, ctx) => {
  const d = data(event);
  draft.activity.observabilityMode = text(d, "mode") ?? draft.activity.observabilityMode;
  draft.activity.observabilityReason =
    freeText(draft, ctx, "activity.observabilityReason", text(d, "reason")) ??
    draft.activity.observabilityReason;
};

const streamDiagnostic: SignalFunction = (draft, event, ctx) => {
  timelineRow(draft, ctx, event, text(data(event), "detail") ?? text(data(event), "kind"));
};

const telemetry: SignalFunction = (draft, event) => {
  const d = data(event);
  const sink = text(d, "sink");
  if (sink === null) return;
  const delivery = text(d, "state") ?? text(d, "delivery");
  const index = draft.telemetry.findIndex((row) => row.sink === sink);
  if (index < 0) draft.telemetry.push({ sink, delivery });
  else draft.telemetry[index] = { sink, delivery };
};

const parallel: SignalFunction = (draft, event) => {
  const d = data(event);
  const group = draft.parallel ?? {
    workers: null,
    groups: null,
    groupFailures: null,
    refusals: null,
    fallbackReason: null,
  };
  const next = { ...group };
  if (event.type === "parallel.plan") {
    next.workers = num(d, "workers") ?? next.workers;
    next.groups = num(d, "groups") ?? next.groups;
  }
  if (event.type === "parallel.admission" && text(d, "outcome") === "refused") {
    next.refusals = (next.refusals ?? 0) + 1;
  }
  if (event.type === "parallel.group.ended" && text(d, "outcome") === "failed") {
    next.groupFailures = (next.groupFailures ?? 0) + 1;
  }
  if (event.type === "parallel.worker.started") {
    next.workers = (next.workers ?? 0) >= 1 ? next.workers : 1;
    draft.progress.pass = (draft.progress.pass ?? 0) + 1;
  }
  next.fallbackReason = text(d, "fallbackReason") ?? next.fallbackReason;
  draft.parallel = next;
};

/** The one function of each signal of the table. */
export const SIGNAL_FUNCTIONS: Readonly<Record<Signal, SignalFunction>> = Object.freeze({
  run,
  launch,
  pause,
  quota,
  billing,
  alert,
  capExceeded,
  usage,
  strategy,
  phase,
  phaseAttempt,
  pass,
  yield: yieldSignal,
  evidence,
  verification,
  check,
  job,
  unit,
  criticSelected,
  criticCall,
  verdict,
  blocked,
  supervision,
  countsReset,
  latestTool,
  observability,
  streamDiagnostic,
  telemetry,
  parallel,
});
