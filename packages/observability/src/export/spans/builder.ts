/**
 * T053 — the span builder from the pairs at emit time (F128-FR-014,
 * F128-FR-015; C-188; B-2340–B-2362; B-2368; B-2372; B-2373; B-2374).
 *
 * F128-FR-014: *A span MUST be built at the moment the event that closes it
 * arrives, from the pair of events that bracket it, and not reconstructed at
 * shipping time. A span MUST be sent when it closes, with the true start time
 * taken from the opening event. The opening and closing types of every scope
 * MUST be those of the table "Scopes of a span". In the as-is form the scope
 * `yield` MUST open at the first event shipped as `yield_wait` (the type
 * `yield.waiting`), as at the baseline, and not at `yield.started`, which the
 * baseline ships as `pass_yield` and does not treat as an opener; in the new
 * form it MUST open at `yield.started`. An event that closes a scope with a
 * failed result MUST give the span the status error with a message that is the
 * reason or the event name; the status code MUST be 2. A pause for quota and a
 * blocked state MUST end their spans without the status error.*
 *
 * F128-FR-015: *Opening a scope type that is already open MUST close that span
 * and everything nested above it, marked `specstride.closed_by` `superseded`.
 * Closing a scope MUST close everything nested above it. Every event that
 * neither opens nor closes a scope MUST become a zero-length point span under
 * the innermost open scope, carrying the event name in `specstride.event`; the
 * name of the span MUST be `tool <tool>` for a tool call and the event name
 * otherwise. A point span of a tool call MUST stay open until the next event
 * that the process sees, or the flush, and take that time as its end. The
 * events that the as-is form knows as `critic_malformed`, `pass_killed`,
 * `yield_invalid` and `plugin_install_failed` MUST give their point spans the
 * status error with the reason or the event name as message. A `run` closer of
 * a stop MUST give the `run` span the status error, except a stop from inside
 * a pass, which MUST give a point span.*
 *
 * The scopes, their opening and closing types, the span names of both forms
 * and the parent scopes are read from `data/span-scopes.tsv`; the as-is
 * openers, closers and point-error events from `data/as-is-openers-closers.tsv`
 * (the tables of the feature's contracts, copied into the package).
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newSpanId, SPAN_ID_PATTERN } from "./identity.ts";
import {
  contentAttributesOf,
  pointErrorOf,
  pointSpanAttributesOf,
  pointSpanNameOf,
  scopeSpanAttributesOf,
  type ClosedBy,
  type SpanContent,
} from "./attributes.ts";
import { applyDialects, type Dialect } from "./dialects.ts";

const DATA_DIR = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  "data",
  "export",
);

/** The file of the sixteen scopes (the contract table "Scopes of a span"). */
export const SPAN_SCOPES_FILE = join(DATA_DIR, "span-scopes.tsv");
/** The file of the as-is openers, closers and point-error events. */
export const AS_IS_OPENERS_CLOSERS_FILE = join(DATA_DIR, "as-is-openers-closers.tsv");

/** One row of the span-scopes table. */
export type SpanScopeRow = {
  readonly scope: string;
  /** The opening event types of the new form (the tokens of the cell). */
  readonly opens: readonly string[];
  /** The closing event types of the new form (the tokens of the cell). */
  readonly closes: readonly string[];
  readonly spanNameNew: string;
  readonly spanNameAsIs: string;
  readonly parentScope: string;
};

/** One row of the as-is openers/closers table. */
export type AsIsRow = {
  readonly event: string;
  readonly scope: string;
  readonly role: "open" | "close" | "close-error" | "point-error";
};

/** The event-name tokens of a table cell (`a|b`, prose around them ignored). */
function eventTokens(cell: string): string[] {
  return [...cell.matchAll(/[a-z][a-z_]*(?:\.[a-z_]+)+/g)].map((m) => m[0]);
}

function parseSpanScopes(path: string): ReadonlyMap<string, SpanScopeRow> {
  const rows = new Map<string, SpanScopeRow>();
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const [scope, opens, closes, nameNew, nameAsIs, parent] = line.split("\t");
    if (!scope || !opens) continue;
    rows.set(scope.trim(), {
      scope: scope.trim(),
      opens: eventTokens(opens),
      closes: eventTokens(closes ?? ""),
      spanNameNew: (nameNew ?? "").trim(),
      spanNameAsIs: (nameAsIs ?? "").trim(),
      parentScope: (parent ?? "none").trim(),
    });
  }
  return rows;
}

function parseAsIsRows(path: string): ReadonlyMap<string, AsIsRow> {
  const rows = new Map<string, AsIsRow>();
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const [event, scope, role] = line.split("\t");
    if (!event || !role) continue;
    // The role cell can carry a rule ("close (error unless result is
    // APPROVED, case-insensitive)"); the role is its first word.
    const bare = role.trim().split(/[\s(]/)[0] ?? "";
    rows.set(event.trim(), {
      event: event.trim(),
      scope: (scope ?? "").trim(),
      role: bare as AsIsRow["role"],
    });
  }
  return rows;
}

let scopesCache: ReadonlyMap<string, SpanScopeRow> | undefined;
let asIsCache: ReadonlyMap<string, AsIsRow> | undefined;

/** The sixteen scopes of the table "Scopes of a span", read from the package data. */
export function spanScopes(): ReadonlyMap<string, SpanScopeRow> {
  scopesCache ??= parseSpanScopes(SPAN_SCOPES_FILE);
  return scopesCache;
}

/** The as-is table of openers, closers and point-error events. */
export function asIsOpenersClosers(): ReadonlyMap<string, AsIsRow> {
  asIsCache ??= parseAsIsRows(AS_IS_OPENERS_CLOSERS_FILE);
  return asIsCache;
}

/** The forms of a payload, as the builder sees them. */
export type PayloadForm = "as-is" | "new";

/* ------------------------------------------------------------------ *
 * The status rule of a closer (F128-FR-014; B-2360; B-2361; B-2362).
 * ------------------------------------------------------------------ */

const FAILED_RESULTS = new Set(["failed", "error", "killed", "refused", "rejected"]);

/**
 * The error message a closer gives its span, or `null` when the span closes
 * without the status error (the verdict rule B-2361, `run_stop` B-2362, the
 * error closers of the table).
 */
export function errorCloseMessageOf(
  eventName: string,
  data: Record<string, unknown>,
): string | null {
  const reason = () => {
    const r = data["reason"];
    return typeof r === "string" && r.length > 0 ? r : eventName;
  };
  switch (eventName) {
    // The hard error closers of the as-is table (role `close-error`).
    case "reject":
    case "iter_error":
    case "verification_failed":
    case "yield_timeout":
      return reason();
    // The verdict rule: error unless the result is APPROVED, case-insensitive.
    case "verdict":
    case "verdict.recorded":
    case "critic.call": {
      const result = data["result"];
      if (typeof result === "string" && result.toUpperCase() === "APPROVED") return null;
      return typeof result === "string" && result.length > 0 ? result : eventName;
    }
    // `run_stop` closes the run with error only without an `iter` field;
    // inside a pass it is a point span (B-2362) — the caller decides.
    case "run_stop":
      return data["iter"] === undefined ? reason() : null;
    case "run.ended":
      // A stop reason on the end of a run is an error close (the table).
      if (typeof data["stopReason"] === "string" && data["stopReason"].length > 0) {
        return data["stopReason"];
      }
      return null;
    case "attempt.ended":
      return data["rejected"] === true ? reason() : null;
    default: {
      // A failed result on any other closer: status error (F128-FR-014).
      const outcome = data["result"] ?? data["status"] ?? data["outcome"];
      if (typeof outcome === "string" && FAILED_RESULTS.has(outcome.toLowerCase())) {
        const r = data["reason"];
        return typeof r === "string" && r.length > 0 ? r : outcome;
      }
      return null;
    }
  }
}

/** The scopes that never take the status error (a quota pause, a block). */
const NEVER_ERROR_SCOPES = new Set(["pause", "blocked"]);

/**
 * The scope-table opener tokens that are the as-is form's alone: in the new
 * form `yield.waiting` is a sample of a running yield, not the opener — the
 * scope opens at `yield.started` (F128-FR-014).
 */
const NEW_FORM_OPENER_EXCLUSIONS: readonly string[] = Object.freeze(["yield.waiting"]);

/* ------------------------------------------------------------------ *
 * The span names of both forms (the table columns, placeholders filled).
 * ------------------------------------------------------------------ */

/** The span name of a scope in the form in force, from the table. */
export function spanNameOf(
  scope: string,
  data: Record<string, unknown>,
  form: PayloadForm,
  runId: string,
): string {
  const row = spanScopes().get(scope);
  const template = form === "as-is" ? (row?.spanNameAsIs ?? "") : (row?.spanNameNew ?? "");
  if (template === "" || template === "-") {
    // The table holds no name: the scope name is the name in both forms.
    return row?.scope ?? scope;
  }
  const feature = firstString(data, ["feature", "featureId"]) ?? (runId || "run");
  const phase = firstString(data, ["phase", "phaseId"]) ?? "?";
  const attempt = firstString(data, ["attempt", "attemptId"]) ?? "?";
  const iter = firstString(data, ["iter", "passId"]) ?? "?";
  const title = firstString(data, ["title"]) ?? null;
  // The name cell can hold two alternatives separated by a top-level `|`
  // (`phase <n>: <title>|phase <n>`): pick the first whose placeholders the
  // event can fill — the titled alternative only with a title.
  const alternatives = splitAlternatives(template);
  const chosen =
    title === null
      ? (alternatives.find((alt) => !alt.includes("<title>")) ?? alternatives[0]!)
      : alternatives[0]!;
  return chosen
    .replaceAll("<feature|task|run_id>", feature)
    .replaceAll("<n>: <title>", `${phase}: ${title}`)
    .replaceAll("<n>", phase)
    .replaceAll("<phase>#<attempt>", `${phase}#${attempt}`)
    .replaceAll("<phase>", phase)
    .replaceAll("<iter>", iter);
}

/** Split a name cell on `|` separators that are not inside `<…>`. */
function splitAlternatives(template: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of template) {
    if (ch === "<") depth += 1;
    if (ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "|" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function firstString(data: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The builder.
 * ------------------------------------------------------------------ */

/** A finished span, ready for the traces request (F128-FR-019). */
export type BuiltSpan = {
  readonly scope: string | null;
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: Record<string, string | number | boolean>;
  /** The status: `null` is unset; code 2 with the message on error. */
  readonly status: { readonly code: 2; readonly message: string } | null;
};

/** One open scope of the stack. */
export type OpenScope = {
  readonly scope: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly startTimeUnixNano: string;
  /** The span name and, for the state file, the opener's raw fields. */
  readonly attributes: Record<string, unknown>;
};

/** One event as the builder sees it, in the form in force. */
export type BuilderEvent = {
  /** The event name in the form in force (the catalogue type or the as-is name). */
  readonly name: string;
  readonly data: Record<string, unknown>;
  /** The event time, in Unix nanoseconds (`null` uses the exporter clock). */
  readonly timeNanos?: string | null;
};

export type SpanBuilderOptions = {
  readonly form: PayloadForm;
  readonly runId: string;
  readonly traceId: string;
  /** Injectable id source (tests pin ids). */
  readonly rng?: (n: number) => Buffer;
  /** The exporter clock, in nanoseconds (the time of an event without one). */
  readonly nowNanos?: () => bigint;
  /** Called with every span at the moment it closes (F128-FR-014). */
  readonly onSpan?: (span: BuiltSpan) => void;
  /**
   * Content capture follows traces (F128-FR-036): when true, the content the
   * `contentOf` accessor returns is put on the span attributes.
   */
  readonly captureContent?: boolean;
  /**
   * The content accessor: the prompt and the reply of the pair, or `null`
   * when the event carries neither. The result always passes the redaction
   * point before it reaches here (F128-FR-036, ruling 43).
   */
  readonly contentOf?: (context: {
    readonly scope: string | null;
    readonly eventName: string;
    readonly openData: Record<string, unknown>;
    readonly closeData: Record<string, unknown>;
  }) => { readonly prompt?: SpanContent | null; readonly reply?: SpanContent | null } | null;
  /**
   * The resolved attribute dialects in force (F128-FR-033): each closed span
   * gains the attributes the enabled dialects derive from its own base
   * attributes. The base attributes are never renamed or dropped.
   */
  readonly dialects?: readonly Dialect[];
};

/**
 * The span builder: it keeps the stack of open scopes, builds each span from
 * the pair of events that bracket it at the moment the closer arrives, and
 * turns every other event into a point span.
 */
export class SpanBuilder {
  private readonly stack: (OpenScope & { readonly data: Record<string, unknown> })[] = [];
  private readonly spans: BuiltSpan[] = [];
  private readonly rng: (n: number) => Buffer;
  private readonly clock: () => bigint;
  /** A tool-call point span stays open until the next event or the flush. */
  private pendingToolSpan: BuiltSpan | null = null;

  private readonly options: SpanBuilderOptions;

  constructor(options: SpanBuilderOptions) {
    this.options = options;
    this.rng = options.rng ?? randomBytes;
    this.clock = options.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
  }

  /** The trace id every span of the builder carries (F128-FR-017). */
  get traceId(): string {
    return this.options.traceId;
  }

  /** The stack of open scopes, as the span state holds it (F128-FR-018). */
  openStack(): readonly OpenScope[] {
    return this.stack.map(({ data: _data, ...rest }) => rest);
  }

  /**
   * Take over the open spans a dead engine start left in the state file
   * (F128-FR-018): the stack continues with the saved span ids, start times
   * and opener fields, so the synthesized closures close the very spans.
   */
  restore(stack: readonly OpenScope[]): void {
    for (const open of stack) {
      this.stack.push({
        scope: open.scope,
        spanId: open.spanId,
        parentSpanId: open.parentSpanId,
        startTimeUnixNano: open.startTimeUnixNano,
        attributes: open.attributes,
        data: (open.attributes["__openData"] as Record<string, unknown> | undefined) ?? {},
      });
    }
  }

  /** Every span closed so far, oldest first. */
  closedSpans(): readonly BuiltSpan[] {
    return [...this.spans];
  }

  private timeOf(event: BuilderEvent): string {
    return event.timeNanos ?? this.clock().toString();
  }

  private emit(span: BuiltSpan): BuiltSpan {
    this.spans.push(span);
    this.options.onSpan?.(span);
    return span;
  }

  /** The opener of an event name in the form in force, or `null`. */
  private openerScopeOf(name: string): string | null {
    if (this.options.form === "as-is") {
      const row = asIsOpenersClosers().get(name);
      return row?.role === "open" ? row.scope || null : null;
    }
    for (const [scope, row] of spanScopes()) {
      if (row.opens.includes(name) && !NEW_FORM_OPENER_EXCLUSIONS.includes(name)) return scope;
    }
    return null;
  }

  /** The closer of an event name in the form in force, or `null`. */
  private closerScopeOf(name: string): string | null {
    if (this.options.form === "as-is") {
      const row = asIsOpenersClosers().get(name);
      if (row === undefined) return null;
      if (row.role === "close" || row.role === "close-error") return row.scope || null;
      return null;
    }
    for (const [scope, row] of spanScopes()) {
      if (row.closes.includes(name)) return scope;
    }
    // `run_stop` inside a pass is a point span, not a closer (B-2362); the
    // as-is table holds it as a conditional closer, so the new form's `run`
    // closer alone is `run.ended`.
    return null;
  }

  /** Whether `run_stop` closes the run here (no `iter` field — B-2362). */
  private runStopCloses(data: Record<string, unknown>): boolean {
    return this.options.form === "as-is" && data["iter"] === undefined;
  }

  /** Close every scope above (and including) the innermost of `scope`. */
  private closeUpTo(
    scope: string,
    closedBy: ClosedBy,
    timeNanos: string,
    closeData: Record<string, unknown>,
    forcedError?: string | null,
  ): BuiltSpan[] {
    const out: BuiltSpan[] = [];
    let index = this.stack.length - 1;
    while (index >= 0) {
      const open = this.stack[index];
      const closed = this.emit(
        this.closeOne(
          open,
          closedBy,
          timeNanos,
          closeData,
          closedBy === "close" ? forcedError : null,
        ),
      );
      out.unshift(closed);
      this.stack.pop();
      if (open.scope === scope) break;
      index -= 1;
    }
    return out;
  }

  /** Build one span from the pair: the opener fields plus the closer's new ones. */
  private closeOne(
    open: OpenScope & { readonly data: Record<string, unknown> },
    closedBy: ClosedBy,
    timeNanos: string,
    closeData: Record<string, unknown>,
    forcedError?: string | null,
  ): BuiltSpan {
    const attributes = scopeSpanAttributesOf({
      scope: open.scope,
      closedBy,
      openData: open.data,
      closeData: closedBy === "close" ? closeData : {},
    });
    // Content follows traces (F128-FR-036): only while capture is on.
    if (this.options.captureContent && this.options.contentOf !== undefined) {
      const content = this.options.contentOf({
        scope: open.scope,
        eventName: String(closeData["__name"] ?? ""),
        openData: open.data,
        closeData,
      });
      if (content) Object.assign(attributes, contentAttributesOf(content));
    }
    // The dialects of F128-FR-033: they only ever ADD to the base attributes.
    const dialectAttributes = applyDialects(attributes, this.options.dialects ?? []);
    const message =
      forcedError !== undefined
        ? forcedError
        : NEVER_ERROR_SCOPES.has(open.scope)
          ? null
          : errorCloseMessageOf((closeData["__name"] as string) ?? "", closeData);
    return {
      scope: open.scope,
      name: open.attributes["__name"] as string,
      traceId: this.options.traceId,
      spanId: open.spanId,
      parentSpanId: open.parentSpanId,
      kind: 1,
      startTimeUnixNano: open.startTimeUnixNano,
      endTimeUnixNano: timeNanos,
      attributes: dialectAttributes,
      status: message !== null && message !== undefined ? { code: 2, message } : null,
    };
  }

  /**
   * Feed one event; the spans it closes come back, oldest first, built at the
   * moment this closer arrived (F128-FR-014).
   */
  feed(event: BuilderEvent): readonly BuiltSpan[] {
    const timeNanos = this.timeOf(event);
    const data = event.data ?? {};
    const name = event.name;
    const closed: BuiltSpan[] = [];

    // A pending tool-call point span takes the time of the next event as its
    // end (B-2374) — whatever this event turns out to be.
    if (this.pendingToolSpan !== null) {
      const pending = this.pendingToolSpan;
      this.pendingToolSpan = null;
      closed.push(this.emit({ ...pending, endTimeUnixNano: timeNanos }));
    }

    // 1. A closer of the run from a stop without `iter` (as-is; B-2362).
    if (name === "run_stop" && this.runStopCloses(data) && this.hasOpen("run")) {
      return [...closed, ...this.closeUpTo("run", "close", timeNanos, { ...data, __name: name })];
    }

    // 2. An opener. Supersession: the scope type already open closes it and
    //    everything nested above it, marked `superseded` (B-2372).
    const opens = this.openerScopeOf(name);
    if (opens !== null) {
      if (this.hasOpen(opens)) {
        closed.push(...this.closeUpTo(opens, "superseded", timeNanos, data));
      }
      const parent = this.parentSpanIdOf(opens);
      this.stack.push({
        scope: opens,
        spanId: newSpanId(this.rng),
        parentSpanId: parent,
        startTimeUnixNano: timeNanos,
        attributes: {
          __name: spanNameOf(opens, data, this.options.form, this.options.runId),
          // The opener's raw fields travel with the state file, so a later
          // engine start can close the span with them (F128-FR-018).
          __openData: data,
        },
        data,
      });
      return closed;
    }

    // 3. A closer (including the error closers of the table). A `run_stop`
    //    with an `iter` field never closes here: it was a point span above.
    const closes =
      name === "run_stop" && data["iter"] !== undefined ? null : this.closerScopeOf(name);
    if (closes !== null && this.hasOpen(closes)) {
      const errorMessage = errorCloseMessageOf(name, data);
      return [
        ...closed,
        ...this.closeUpTo(closes, "close", timeNanos, { ...data, __name: name }, errorMessage),
      ];
    }

    // 4. Everything else is a point span (B-2373), under the innermost open
    //    scope, at the top of the trace when no scope is open.
    return [...closed, ...this.pointSpanOf(name, data, timeNanos)];
  }

  /** A tool-call point span stays open until the next event or the flush. */
  private pointSpanOf(
    name: string,
    data: Record<string, unknown>,
    timeNanos: string,
  ): readonly BuiltSpan[] {
    const innermost = this.stack[this.stack.length - 1];
    const error = pointErrorOf(name, data);
    const attributes = pointSpanAttributesOf({
      eventName: name,
      data,
      scope: innermost?.scope ?? null,
    });
    // The critic call content rides its point span when no critic scope is
    // open to carry it (F128-FR-036); only while capture is on.
    if (
      this.options.captureContent &&
      name === "critic.call" &&
      this.options.contentOf !== undefined
    ) {
      const content = this.options.contentOf({
        scope: innermost?.scope ?? null,
        eventName: name,
        openData: {},
        closeData: data,
      });
      if (content) Object.assign(attributes, contentAttributesOf(content));
    }
    // The dialects of F128-FR-033 apply to a point span as well.
    const dialectAttributes = applyDialects(attributes, this.options.dialects ?? []);
    const span: BuiltSpan = {
      scope: null,
      name: pointSpanNameOf(name, data),
      traceId: this.options.traceId,
      spanId: newSpanId(this.rng),
      parentSpanId: innermost?.spanId,
      kind: 1,
      startTimeUnixNano: timeNanos,
      endTimeUnixNano: timeNanos,
      attributes: dialectAttributes,
      status: error !== null ? { code: 2, message: error } : null,
    };
    if (pointSpanNameOf(name, data).startsWith("tool ")) {
      // Kept open (F128-FR-015): no end time yet, closed by the next event or
      // the flush.
      this.pendingToolSpan = span;
      return [];
    }
    return [this.emit(span)];
  }

  /** The flush closes a pending tool-call point span (B-2374). */
  flush(): readonly BuiltSpan[] {
    if (this.pendingToolSpan === null) return [];
    const pending = this.pendingToolSpan;
    this.pendingToolSpan = null;
    return [this.emit({ ...pending, endTimeUnixNano: this.clock().toString() })];
  }

  /** Whether a scope of this type is open. */
  hasOpen(scope: string): boolean {
    return this.stack.some((open) => open.scope === scope);
  }

  /** The parent span id of a new scope, from the parent scope of the table. */
  private parentSpanIdOf(scope: string): string | undefined {
    const row = spanScopes().get(scope);
    const parentScope = row?.parentScope ?? "none";
    if (parentScope === "none") return undefined;
    if (parentScope === "-") return this.stack[this.stack.length - 1]?.spanId;
    // `pipeline|stage|none`: the innermost open scope of the listed parents.
    for (const candidate of parentScope.split("|")) {
      const open = [...this.stack].reverse().find((o) => o.scope === candidate.trim());
      if (open !== undefined) return open.spanId;
    }
    return undefined;
  }

  /**
   * Close what a dead engine start left open, from the events the next writer
   * synthesizes, marked as synthesized (F128-FR-018). The spans come back
   * innermost-first in closure order.
   */
  synthesizeClosures(timeNanos?: string): readonly BuiltSpan[] {
    const at = timeNanos ?? this.clock().toString();
    const out: BuiltSpan[] = [];
    while (this.stack.length > 0) {
      const open = this.stack[this.stack.length - 1];
      out.push(this.emit(this.closeOneSynthesized(open, at)));
      this.stack.pop();
    }
    return out;
  }

  private closeOneSynthesized(
    open: OpenScope & { readonly data: Record<string, unknown> },
    timeNanos: string,
  ): BuiltSpan {
    const span = this.closeOne(open, "synthesized", timeNanos, {}, null);
    return {
      ...span,
      attributes: { ...span.attributes, "specstride.closed_by": "synthesized" },
      status: null,
    };
  }
}

/** Re-export so the tests of the identity rule can reach it from one module. */
export { SPAN_ID_PATTERN };
