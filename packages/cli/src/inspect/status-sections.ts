/**
 * T040 — the phase table, the telemetry section and the observability
 * sections of `status` in compatibility output (F119-FR-024, F119-FR-025,
 * F119-FR-026).
 *
 * The columns are the baseline's (F119-FR-024): the header reads
 * `  PHASE  TITLE                        EVIDENCE APPROVED FEEDBACK` with the
 * columns of width 6, 28, 8, 8 and 8 separated by one space, the rule row is
 * dashes of the same widths, and a data row pads the MARKS to six — the
 * as-is quirk the FX-28 captures pin (`gates/proofs/` of this feature holds
 * the measurement). The mark of an approval is the one of the phase's
 * approval record as the engine accepts it (CQ-041: a phase is approved when
 * its record verifies, read through `approvedByVerdict` of `phases.ts`, the
 * same record the engine accepts).
 *
 * The telemetry section is printed only when the settings the newest run
 * recorded hold `TELEMETRY` or `OTEL` as true, and each sink line is what
 * the sink reports as its delivery status through EP-08 (F119-FR-025) — the
 * four states of `@specstride/observability/export/probe/state`, never a
 * collapsed `true`.
 *
 * The observability section names the mode, the latest tool and the last
 * events from the last 400 and 200 lines of the events (F119-FR-026).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ControlPlane } from "../router/guards.ts";
import { approvedByVerdict, evidencePathOf, feedbackPathOfPhase } from "./phases.ts";

/** The widths of the phase table (F119-FR-024). */
export const PHASE_TABLE_COLUMNS = Object.freeze({
  phase: 6,
  title: 28,
  headerMark: 8,
  mark: 6,
} as const);

/** The line for a workspace whose spec is not there (F119-FR-024). */
export const NO_SPEC_LINE = "  (no SPECS.md found)" as const;

/** The literal the current-phase line names when everything is approved. */
export const ALL_APPROVED_TEXT = "<all approved>" as const;

/** One row of the phase table. */
export type PhaseRow = {
  readonly number: number;
  readonly title: string;
  readonly evidence: boolean;
  readonly approved: boolean;
  readonly feedback: boolean;
};

/** The header row of the phase table (F119-FR-024). */
export function phaseTableHeader(): string {
  return (
    `  ${"PHASE".padEnd(PHASE_TABLE_COLUMNS.phase)} ` +
    `${"TITLE".padEnd(PHASE_TABLE_COLUMNS.title)} ` +
    `${"EVIDENCE".padEnd(PHASE_TABLE_COLUMNS.headerMark)} ` +
    `${"APPROVED".padEnd(PHASE_TABLE_COLUMNS.headerMark)} ` +
    "FEEDBACK"
  );
}

/** The rule row of the phase table (the capture pins 5→6, 28, 8, 8, 8 dashes). */
export function phaseTableRule(): string {
  const phase = "-".repeat(PHASE_TABLE_COLUMNS.phase - 1).padEnd(PHASE_TABLE_COLUMNS.phase);
  return (
    `  ${phase} ` +
    `${"-".repeat(PHASE_TABLE_COLUMNS.title)} ` +
    `${"-".repeat(PHASE_TABLE_COLUMNS.headerMark)} ` +
    `${"-".repeat(PHASE_TABLE_COLUMNS.headerMark)} ` +
    `${"-".repeat(PHASE_TABLE_COLUMNS.headerMark)}`
  );
}

const mark = (on: boolean): string => (on ? "✓" : "✗");

/** One data row of the phase table: the title cut to 28, the marks padded to six. */
export function phaseTableRow(row: PhaseRow): string {
  return (
    `  ${String(row.number).padEnd(PHASE_TABLE_COLUMNS.phase)} ` +
    `${row.title.slice(0, PHASE_TABLE_COLUMNS.title).padEnd(PHASE_TABLE_COLUMNS.title)} ` +
    `${mark(row.evidence).padEnd(PHASE_TABLE_COLUMNS.mark)} ` +
    `${mark(row.approved).padEnd(PHASE_TABLE_COLUMNS.mark)} ` +
    `${mark(row.feedback).padEnd(PHASE_TABLE_COLUMNS.mark)}`
  );
}

/** The lines of the phase table of a spec that exists (F119-FR-024). */
export function phaseTableLines(
  rows: readonly PhaseRow[],
  current: number | "all",
): readonly string[] {
  return Object.freeze([
    "",
    phaseTableHeader(),
    phaseTableRule(),
    ...rows.map(phaseTableRow),
    "",
    current === "all"
      ? `  current phase: ${ALL_APPROVED_TEXT}`
      : `  current phase: ${String(current)}`,
  ]);
}

/** The lines of the whole phase section (F119-FR-024). */
export async function phaseSectionLines(
  cp: ControlPlane,
  slug: string,
  specPath: string,
): Promise<readonly string[]> {
  if (!existsSync(specPath)) return Object.freeze(["", NO_SPEC_LINE]);
  const specfmt = await import("@specstride/spec-formats");
  const report = specfmt.validate.validateFile(specPath, {
    file: specPath,
    format: "native",
    feature: slug,
  });
  if (!report.valid) return Object.freeze(["", NO_SPEC_LINE]);
  const model = specfmt.validate.parseFile(specPath, {
    file: specPath,
    format: "native",
    feature: slug,
  });
  const rows: PhaseRow[] = model.phases.map((phase) => ({
    number: phase.number,
    title: specfmt.validate.titleOf(model, phase.number),
    evidence: existsSync(evidencePathOf(cp, slug, phase.number)),
    approved: approvedByVerdict(cp, slug, phase.number),
    feedback: existsSync(feedbackPathOfPhase(cp, slug, phase.number)),
  }));
  const firstOpen = rows.findIndex((row) => !row.approved);
  return phaseTableLines(rows, firstOpen === -1 ? "all" : (rows[firstOpen] as PhaseRow).number);
}

/* ------------------------------------------------------------------ *
 * The telemetry section (F119-FR-025).
 * ------------------------------------------------------------------ */

/**
 * The delivery status a sink reports through EP-08 (annex C §C.10): one line
 * and the record behind it. The line is never a collapsed `true`.
 */
export type SinkDeliveryStatus = {
  readonly line: string;
  readonly record: {
    readonly sinkLabel: string;
    readonly receiverState: string;
    readonly lastDeliveryStatus: string;
    readonly reason: string | null;
  };
};

/** The EP-08 surface the telemetry section prints (F119-FR-025). */
export type StatusSink = {
  readonly label: string;
  /** The saved address of the sink, or the default the section names. */
  readonly address: string;
  status(): SinkDeliveryStatus;
};

/** True when a settings value holds the sink on. */
export function telemetrySettingOn(value: string | undefined): boolean {
  return value === "true" || value === "on" || value === "1";
}

/**
 * A sink over the delivery records of the events file (F128): its state is
 * the highest that can be proved — `configured`, `reachable`,
 * `request_accepted`, `query_verified` — with no probe of the network here,
 * because a read command starts no connection (F119-FR-016, and the state
 * starts at `configured` when the probe is skipped). The reader tolerates a
 * missing file and malformed lines.
 */
export async function deliveryStatusSink(
  label: string,
  address: string,
  eventsPath: string,
): Promise<StatusSink> {
  const probe = await import("@specstride/observability/export/probe/state");
  const sink: StatusSink = {
    label,
    address,
    status(): SinkDeliveryStatus {
      const records = probe.readDeliveryRecords(eventsPath).records;
      const mine = probe.recordsForSink(records, label);
      const state = probe.receiverStateOf({ enabled: true, sink: label, records: mine });
      const last = mine[mine.length - 1] as { readonly status?: string } | undefined;
      return Object.freeze({
        line: probe.stateLine(label, state),
        record: Object.freeze({
          sinkLabel: label,
          receiverState: String(state),
          lastDeliveryStatus: String(last?.status ?? "unknown"),
          reason: null,
        }),
      });
    },
  };
  return sink;
}

/** The lines of the telemetry section (F119-FR-025). */
export function telemetrySectionLines(
  settings: Readonly<Record<string, string>>,
  sinks: readonly StatusSink[],
): readonly string[] {
  const enabled = sinks.filter((sink) =>
    sink.label === "loki"
      ? telemetrySettingOn(settings["TELEMETRY"])
      : sink.label === "otlp"
        ? telemetrySettingOn(settings["OTEL"])
        : true,
  );
  if (enabled.length === 0) return Object.freeze([]);
  return Object.freeze(["", "  telemetry:", ...enabled.map((s) => `    ${s.status().line}`)]);
}

/* ------------------------------------------------------------------ *
 * The observability section (F119-FR-026).
 * ------------------------------------------------------------------ */

/** The keys the last-events lines leave out (F119-FR-026). */
export const LAST_EVENTS_OMITTED_KEYS: readonly string[] = Object.freeze([
  "time",
  "ts",
  "event",
  "task",
  "backend",
  "run_id",
]);

/** The window of lines the observability and latest-tool lines read. */
export const OBSERVABILITY_WINDOW = 400 as const;
/** The window of lines the last-events lines read. */
export const LAST_EVENTS_WINDOW = 200 as const;
/** The most last-events lines the section prints. */
export const LAST_EVENTS_MAX = 5 as const;

/** One parsed event line, or `null` where the line does not parse. */
function parseEvent(line: string): Record<string, unknown> | null {
  if (line.trim() === "") return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The last 8 characters of the time value of an event (F119-FR-026). */
export function lastEightOfTime(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.slice(-8);
}

/** The `k=v` pairs of an event, in insertion order, without the omitted keys. */
export function pairsOf(event: Record<string, unknown>): string {
  return Object.entries(event)
    .filter(([key]) => !(LAST_EVENTS_OMITTED_KEYS as readonly string[]).includes(key))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

/** The lines of the observability section (F119-FR-026). */
export function observabilitySectionLines(eventsText: string | undefined): readonly string[] {
  if (eventsText === undefined) return Object.freeze([]);
  const lines = eventsText.split("\n");
  const window400 = lines.slice(-OBSERVABILITY_WINDOW);
  const window200 = lines.slice(-LAST_EVENTS_WINDOW);

  const out: string[] = [];
  for (let at = window400.length - 1; at >= 0; at -= 1) {
    const event = parseEvent(window400[at] as string);
    if (event === null || event["event"] !== "agent_observability") continue;
    let line = `  observability: ${String(event["mode"] ?? "?")}`;
    const reason = event["reason"];
    if (reason !== undefined && reason !== null && String(reason) !== "") {
      line += ` — ${String(reason)}`;
    }
    out.push(line);
    break;
  }
  for (let at = window400.length - 1; at >= 0; at -= 1) {
    const event = parseEvent(window400[at] as string);
    if (event === null || event["event"] !== "agent_tool") continue;
    const tool = event["tool"] ?? event["name"];
    const summary = event["summary"] ?? event["status"];
    if (tool === undefined && summary === undefined) break;
    let line = `  latest tool: ${tool === undefined ? "" : String(tool)}`;
    if (summary !== undefined && summary !== null && String(summary) !== "") {
      line += ` (${String(summary)})`;
    }
    out.push(line);
    break;
  }

  const lastEvents: string[] = [];
  for (let at = window200.length - 1; at >= 0 && lastEvents.length < LAST_EVENTS_MAX; at -= 1) {
    const event = parseEvent(window200[at] as string);
    if (event === null) continue;
    const type = event["event"];
    if (typeof type !== "string") continue;
    if (type.startsWith("agent_") || type.startsWith("iter_")) continue;
    const pairs = pairsOf(event);
    lastEvents.push(
      `    ${lastEightOfTime(event["time"])}  ${type}${pairs === "" ? "" : `  ${pairs}`}`,
    );
  }
  if (lastEvents.length > 0) out.push("  last events:", ...lastEvents.reverse());
  return Object.freeze(out);
}

/** The feature directory of one slug (the logical namespace of its records). */
export function featureDirOf(cp: ControlPlane, slug: string): string {
  return join(cp.stateDir, "features", slug);
}
