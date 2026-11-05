/**
 * T039 — the state headline and the halted-text table of `status` in
 * compatibility output (F119-FR-022, F119-FR-023, F119-FR-028).
 *
 * The first line is `specstride status — <workdir>  (feature: <slug>)`, with
 * TWO spaces before the bracket (F119-FR-022). The one state line that follows
 * is mapped from the read model (F119-FR-028): the written state of the run
 * record names the row, and the terminal event of the newest events — the last
 * `run_stop` or `run_end`, unparseable lines skipped — fills it in. A live run
 * is found by a PROBE of the lease (`<control>/lock/`): the front door never
 * takes the lock to look (F119-FR-028, DV-042).
 *
 * In DEFAULT output `status` belongs to feature 129: the handler here is
 * mounted only for compatibility output and says so truthfully otherwise.
 *
 * Nothing here writes a file (F119-FR-016).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ControlPlane } from "../router/guards.ts";
import { eventsPathOf } from "../router/guards.ts";
import {
  DEFAULT_FEATURE,
  featureOfTheLastRun,
  parseInspectArgs,
  sanitizeFeature,
} from "../router/inspect-args.ts";
import { VerbNotMountedError, type RoutedCall } from "../router/route.ts";
import {
  deliveryStatusSink,
  observabilitySectionLines,
  phaseSectionLines,
  telemetrySectionLines,
  type StatusSink,
} from "./status-sections.ts";

/** The written states of annex E §E.2 that read as RUNNING (F119-FR-028). */
export const RUNNING_VIEW_STATES: readonly string[] = Object.freeze([
  "starting",
  "running",
  "paused-quota",
  "relaunching",
  "stopping",
]);

/** The cap of the owner text of the lock, in BYTES (F119-FR-022). */
export const OWNER_TEXT_CAP_BYTES = 200 as const;

/** The state line texts of the baseline (F119-FR-022, quirks included). */
export const NO_RUN_TEXT = "no run recorded yet" as const;
export const DEAD_TEXT =
  "not running (no clean end recorded — crashed or never finished a run)" as const;
/** The outcome a terminal `run_end` without one names (F119-FR-028). */
export const DEFAULT_OUTCOME = "all_approved" as const;

/** The first line of `status` in compatibility output (F119-FR-022). */
export function statusHeadline(workdir: string, feature: string): string {
  return `specstride status — ${workdir}  (feature: ${feature})`;
}

/** The state line of a live run (F119-FR-022). */
export function runningLine(owner: string): string {
  return `  state: RUNNING (${owner})`;
}

/** The state line after a `run_end` (F119-FR-022). */
export function doneLine(outcome: string): string {
  return `  state: DONE — ${outcome}`;
}

/** The state line of a crashed or never-finished run (F119-FR-022). */
export function deadLine(): string {
  return `  state: ${DEAD_TEXT}`;
}

/** The state line of a workspace with no events and no live run. */
export function noRunLine(): string {
  return `  state: ${NO_RUN_TEXT}`;
}

/**
 * F119-FR-023 — the halted-text table. `<p>` is the `phase` field of the
 * terminal event, or `?` when it is absent. The location of the job logs
 * names where the logical name `job:<jobId>:log` lives in the port
 * (normalization rule N-02 maps both spellings to one logical name).
 */
export function haltedTextOf(
  reason: string,
  phase: number | string,
  jobLogsLocation: string,
): string {
  const p = String(phase);
  if (reason === "stop_flag") {
    return `  state: STOPPED at phase ${p} — resume with: specstride resume`;
  }
  if (reason === "max_rejects") {
    return `  state: HALTED at phase ${p} — needs human (max-rejects exceeded)`;
  }
  if (reason === "proposer_yield_budget" || reason === "proposer_yield_timeout") {
    return (
      `  state: HALTED at phase ${p} — a declared yield's wait ran out ` +
      `(deadline, wall budget, or too many yields in one attempt). ` +
      `The job was left running, not killed: read its log under ${jobLogsLocation}`
    );
  }
  if (reason === "proposer_cap_exhausted") {
    return (
      `  state: HALTED at phase ${p} — the phase's work does not fit one pass ` +
      `(consecutive hard_cap kills). Make the long step outlive the pass ` +
      `(--long-job-cmd) or split the phase; raising the cap is the last resort`
    );
  }
  return `  state: HALTED at phase ${p} — ${reason}`;
}

/** One terminal event of the events file: its type and its fields. */
export type TerminalEvent = {
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/**
 * The terminal event of the newest events: the last `run_stop` or `run_end`
 * of the file; lines that do not parse are skipped (F119-FR-022).
 */
export function terminalEventOf(eventsText: string | undefined): TerminalEvent | null {
  if (eventsText === undefined) return null;
  let terminal: TerminalEvent | null = null;
  for (const line of eventsText.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // a line that does not parse is skipped, never a failure
    }
    const event = parsed["event"];
    if (event === "run_stop" || event === "run_end") {
      terminal = Object.freeze({ event, fields: parsed });
    }
  }
  return terminal;
}

/** The `phase` field of a terminal event, `?` when it is absent (F119-FR-023). */
export function phaseOfTerminal(terminal: TerminalEvent | null): number | string {
  const phase = terminal?.fields["phase"];
  return typeof phase === "number" ? phase : "?";
}

/** The stop reason of a terminal `run_stop`; `stop_flag` for a written stop. */
export function reasonOfTerminal(terminal: TerminalEvent | null, writtenStop = false): string {
  const reason = terminal?.fields["reason"];
  if (typeof reason === "string" && reason !== "") return reason;
  return writtenStop ? "stop_flag" : "?";
}

/** The `outcome` of a terminal `run_end`. */
export function outcomeOfTerminal(terminal: TerminalEvent | null): string | undefined {
  const outcome = terminal?.fields["outcome"];
  return typeof outcome === "string" && outcome !== "" ? outcome : undefined;
}

/** What the state mapping reads, besides the written state. */
export type StateLineInput = {
  /** The written state of the run record (annex E §E.2), `null` where none. */
  readonly state: string | null;
  /** The terminal event of the newest events, when one is recorded. */
  readonly terminal: TerminalEvent | null;
  /** True when an events file exists at all. */
  readonly hasEventsFile: boolean;
  /** True when the probe of the lease holds a live owner. */
  readonly liveRun: boolean;
  /** The owner text of the lock (first line, at most 200 bytes). */
  readonly owner: string | null;
  /** Where the logical name `job:<jobId>:log` lives (F119-FR-023). */
  readonly jobLogsLocation: string;
};

/**
 * F119-FR-028 — the state line of `status`, mapped from the read model. The
 * written state names the row; where no state is written (`created`, `none`,
 * or an unknown state read as `dead`), the newest events decide.
 */
export function stateLineOf(input: StateLineInput): string {
  const state = input.state;
  if (state !== null && (RUNNING_VIEW_STATES as readonly string[]).includes(state)) {
    if (input.liveRun) return runningLine(input.owner ?? "");
  }
  if (state === "finished") {
    return doneLine(outcomeOfTerminal(input.terminal) ?? DEFAULT_OUTCOME);
  }
  if (state === "stopped") {
    return haltedTextOf(
      reasonOfTerminal(input.terminal, true),
      phaseOfTerminal(input.terminal),
      input.jobLogsLocation,
    );
  }
  if (state === "failed" || state === "blocked-on-human") {
    return haltedTextOf(
      reasonOfTerminal(input.terminal, false),
      phaseOfTerminal(input.terminal),
      input.jobLogsLocation,
    );
  }
  if (state === "dead" || state === "unknown") {
    // F119-FR-028 — `dead` is derived, and an unknown state reads as `dead`.
    return deadLine();
  }
  // No written state (`created`, `none`): the events decide (F119-FR-022).
  if (!input.hasEventsFile && !input.liveRun) return noRunLine();
  if (state === "created" && input.terminal === null) return noRunLine();
  const terminal = input.terminal;
  if (terminal === null) return deadLine();
  if (terminal.event === "run_stop") {
    return haltedTextOf(
      reasonOfTerminal(terminal, false),
      phaseOfTerminal(terminal),
      input.jobLogsLocation,
    );
  }
  return doneLine(outcomeOfTerminal(terminal) ?? DEFAULT_OUTCOME);
}

/* ------------------------------------------------------------------ *
 * The probe of the lease (F119-FR-028: a probe, never a lock).
 * ------------------------------------------------------------------ */

/** What the probe of the lease found. */
export type LeaseProbe = {
  /** A member of the closed set of EP-13 `probe` (§F.5). */
  readonly probe: string;
  /** The owner record the lock holds, when one is there. */
  readonly lease: Readonly<Record<string, unknown>> | null;
};

/**
 * The probe of the workspace lock at the logical name `workspace:lock`
 * (`<control>/lock/`): a read of the owner record, never a lock, never a
 * write (F119-FR-028, DV-042).
 */
export function probeLeaseOf(cp: ControlPlane): LeaseProbe {
  const ownerPath = join(cp.stateDir, "lock", "owner.json");
  if (!existsSync(ownerPath)) return Object.freeze({ probe: "free", lease: null });
  try {
    const lease = JSON.parse(readFileSync(ownerPath, "utf8")) as Record<string, unknown>;
    return Object.freeze({ probe: "held-live", lease });
  } catch {
    return Object.freeze({ probe: "unknown", lease: null });
  }
}

/**
 * The owner text of the lock: the as-is run id and the time the lock was
 * taken, FIRST LINE ONLY, at most 200 BYTES (F119-FR-022).
 */
export function ownerTextOf(lease: Readonly<Record<string, unknown>> | null): string {
  if (lease === null) return "";
  const raw =
    lease["ownerText"] !== undefined
      ? String(lease["ownerText"])
      : `${lease["runId"] ?? ""} ${lease["since"] ?? lease["takenAt"] ?? ""}`.trim();
  const firstLine = raw.split("\n")[0] ?? "";
  let out = "";
  for (const ch of firstLine) {
    if (Buffer.byteLength(out + ch, "utf8") > OWNER_TEXT_CAP_BYTES) break;
    out += ch;
  }
  return out;
}

/** Where the logical name `job:<jobId>:log` lives (§B.5: `<attempt-dir>/jobs/<jobId>/job.log`). */
export function jobLogsLocationOf(
  cp: ControlPlane,
  slug: string,
  runId: string | undefined,
): string {
  const run = runId ?? "current";
  return `${cp.label}/features/${slug}/runs/${run}/jobs`;
}

/** The text of a file, `undefined` where it is not there or cannot be read. */
export function readTextOf(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The newest run directory of one feature (its name is the run id). */
export function newestRunDirOf(cp: ControlPlane, slug: string): string | undefined {
  const runs = join(cp.stateDir, "features", slug, "runs");
  let entries: string[];
  try {
    entries = readdirSync(runs);
  } catch {
    return undefined;
  }
  let newest: { readonly name: string; readonly at: number } | undefined;
  for (const name of entries) {
    const path = join(runs, name);
    try {
      const at = statSync(path).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { name, at };
    } catch {
      /* a vanished entry is passed over */
    }
  }
  return newest === undefined ? undefined : join(runs, newest.name);
}

/** The settings the newest run recorded (its `snapshot`, KEY=VALUE lines). */
export function snapshotSettingsOf(
  cp: ControlPlane,
  slug: string,
): Readonly<Record<string, string>> {
  const runDir = newestRunDirOf(cp, slug);
  const text = runDir === undefined ? undefined : readTextOf(join(runDir, "snapshot"));
  const settings: Record<string, string> = {};
  for (const line of (text ?? "").split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    settings[line.slice(0, at)] = line.slice(at + 1);
  }
  return Object.freeze(settings);
}

/* ------------------------------------------------------------------ *
 * The handler of `status` in compatibility output.
 * ------------------------------------------------------------------ */

/**
 * What a composed host may hand the handler: the read model (`project` of
 * `@specstride/view`, held as a PARAMETER and not an import, for the reason
 * the import-boundary check of feature 100 refuses an import between two L6
 * packages the graph does not name) and the sinks whose delivery status the
 * telemetry section prints (EP-08). The characterization test CT-119-10
 * passes the REAL `project` and proves the mapping row by row.
 */
export type StatusDeps = {
  readonly project?:
    | ((inputs: {
        events: { readonly events: readonly unknown[] };
        stateFiles: {
          readonly runRecord: Readonly<Record<string, unknown>> | null;
          readonly terminalRecord: Readonly<Record<string, unknown>> | null;
          readonly pauseRecord: Readonly<Record<string, unknown>> | null;
        };
        observations: Readonly<Record<string, unknown>>;
        now: string;
      }) => { readonly state?: string | null })
    | undefined;
  readonly sinks?: readonly StatusSink[] | undefined;
  readonly now?: string | undefined;
};

/** The handler of `status` (F119-FR-022 to F119-FR-026, F119-FR-028). */
export async function statusHandler(call: RoutedCall, deps: StatusDeps = {}): Promise<number> {
  const args = parseInspectArgs(call.extras);
  if (args.all) {
    const statusAll = await import("./status-all.ts");
    return statusAll.statusAllHandler(call, deps);
  }
  // The default output of `status` belongs to feature 129 (out of scope).
  if (call.mode !== "compat") throw new VerbNotMountedError("status");
  const cp = call.controlPlane;
  const slug =
    args.feature !== undefined
      ? sanitizeFeature(args.feature)
      : ((args.extras[0] !== undefined
          ? sanitizeFeature(args.extras[0])
          : featureOfTheLastRun(cp.stateDir)) ?? DEFAULT_FEATURE);
  const probe = probeLeaseOf(cp);
  const eventsText = readTextOf(eventsPathOf(cp));
  const terminal = terminalEventOf(eventsText);
  const writtenState = writtenStateOf(cp, slug, terminal, probe, deps);
  call.io.out(`${statusHeadline(cp.workdir, slug)}\n`);
  call.io.out(
    `${stateLineOf({
      state: writtenState,
      terminal,
      hasEventsFile: eventsText !== undefined,
      liveRun: probe.probe === "held-live",
      owner: ownerTextOf(probe.lease),
      jobLogsLocation: jobLogsLocationOf(cp, slug, newestRunIdOf(cp, slug)),
    })}\n`,
  );
  for (const line of await phaseSectionLines(
    cp,
    slug,
    join(call.workdir, args.spec ?? "SPECS.md"),
  )) {
    call.io.out(`${line}\n`);
  }
  const settings = snapshotSettingsOf(cp, slug);
  for (const line of telemetrySectionLines(
    settings,
    await sinksOf(deps, eventsPathOf(cp), settings),
  )) {
    call.io.out(`${line}\n`);
  }
  for (const line of observabilitySectionLines(eventsText)) {
    call.io.out(`${line}\n`);
  }
  return 0;
}

/**
 * The run directory named for the job-logs location: the run id itself when
 * the newest run directory is there, `current` otherwise.
 */
export function newestRunIdOf(cp: ControlPlane, slug: string): string | undefined {
  const dir = newestRunDirOf(cp, slug);
  return dir === undefined ? undefined : dir.split("/").pop();
}

/** The run record of the newest run, `null` where it is not there. */
function readJsonOf(path: string | undefined): Readonly<Record<string, unknown>> | null {
  if (path === undefined || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The written state of the run, from the read model when the host composed
 * one (`deps.project`), else from the run record file alone. The state files
 * and the observations are the four inputs of F129-FR-001 and nothing else.
 */
function writtenStateOf(
  cp: ControlPlane,
  slug: string,
  terminal: TerminalEvent | null,
  probe: LeaseProbe,
  deps: StatusDeps,
): string | null {
  const runDir = newestRunDirOf(cp, slug);
  const runRecord = readJsonOf(runDir === undefined ? undefined : join(runDir, "run-record.json"));
  if (deps.project === undefined) {
    const state = runRecord?.["state"];
    return typeof state === "string" ? state : null;
  }
  const view = deps.project({
    events: { events: [] },
    stateFiles: {
      runRecord,
      terminalRecord: terminal === null ? null : { ...terminal.fields },
      pauseRecord: null,
    },
    observations: {
      lease: probe.lease === null ? null : { probe: probe.probe, lease: probe.lease },
      newestLaunchRecord: null,
      supervisionRecord: null,
      processTableSearch: null,
      handshakeLimitSec: null,
    },
    now: deps.now ?? new Date().toISOString(),
  });
  const state = view?.state;
  return typeof state === "string" && state !== "" ? state : null;
}

/**
 * The sinks the telemetry section prints (EP-08): Loki first, then OTLP, each
 * reporting its delivery status through the probe state of feature 128 —
 * `configured`, `reachable`, `request-accepted` and `query-verified`, never a
 * collapsed `true` (F119-FR-025). A host may hand its own sinks in.
 */
function sinksOf(
  deps: StatusDeps,
  eventsPath: string,
  settings: Readonly<Record<string, string>>,
): Promise<readonly StatusSink[]> {
  if (deps.sinks !== undefined) return Promise.resolve(deps.sinks);
  const pending: Promise<StatusSink>[] = [];
  if (isOn(settings["TELEMETRY"])) {
    pending.push(
      deliveryStatusSink(
        "loki",
        addressOf(settings, ["LOKI_ADDRESS", "LOKI_URL"], "http://localhost:3100"),
        eventsPath,
      ),
    );
  }
  if (isOn(settings["OTEL"])) {
    pending.push(
      deliveryStatusSink(
        "otlp",
        addressOf(settings, ["OTEL_ADDRESS", "OTEL_URL"], "http://localhost:4318"),
        eventsPath,
      ),
    );
  }
  return Promise.all(pending);
}

/** A saved address, or the default when the saved value is empty (F119-FR-025). */
function addressOf(
  settings: Readonly<Record<string, string>>,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = settings[key];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return fallback;
}

function isOn(value: string | undefined): boolean {
  return value === "true" || value === "on" || value === "1";
}
