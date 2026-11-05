/**
 * The rail, totals, heartbeat and helpers (T014): the A/R/C/P bookkeeping the
 * card and the timeline share (F145-FR-007), the run totals and the heartbeat
 * line they feed (F145-FR-008), and the presenter's fixed forms
 * (F145-FR-010). Ported from the baseline `lib/present.py` at 9cab15d with
 * the clock injectable so the parity comparison is of bytes and not of
 * moments.
 */
import * as banner from "./banner.ts";
import { displayWidth, pyRound } from "./theme.ts";
import type { Theme } from "./theme.ts";
import type { PresentEvent } from "./follow.ts";

/** The braille spinner frames of the heartbeat and the card. */
export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** The pulse ramp that breathes the heartbeat line. */
export const PULSE = "▁▂▃▄▅▆▇█▇▆▅▄▃▂";

/** Clears to end of line: the heartbeat draws in place. */
export const CLR_EOL = "\x1b[K";
/** Clears the screen and homes the cursor: the card redraws a whole screen. */
export const CLEAR = "\x1b[2J\x1b[H";

/** The rail starts in the message column (`HH:MM:SS` plus two spaces). */
export const RAIL_INDENT = "HH:MM:SS".length + 2;
/** Under this many columns the live rail collapses to one line. */
export const ONE_LINE_BELOW = 40;

/** A duration as `<s>s`, `<m>m<ss>s` or `<h>h<mm>m` (baseline `fmt_secs`). */
export function fmtSecs(seconds: number): string {
  const s = Math.trunc(seconds);
  if (s >= 3600)
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Milliseconds as a duration, or `?` when they do not read as a number. */
export function fmtMs(ms: unknown): string {
  const value = typeof ms === "number" ? ms : Number.parseFloat(String(ms));
  if (!Number.isFinite(value)) return "?";
  return fmtSecs(value / 1000.0);
}

/** True when a value is present in an event (not null and not the empty string). */
export function present(value: unknown): boolean {
  return !(value === null || value === undefined || value === "");
}

/** The first bounded display summary an event supplies. */
export function summaryOf(ev: PresentEvent, ...keys: string[]): string {
  for (const key of keys) {
    const value = ev[key];
    if (present(value)) {
      if (Array.isArray(value)) return value.map((one) => String(one)).join(", ");
      if (typeof value === "object" && value !== null) {
        return pyCompactJson(value as Record<string, unknown>);
      }
      return String(value);
    }
  }
  return "";
}

/** Compact, key-sorted JSON — the baseline's `json.dumps(..., sort_keys=True)`. */
export function pyCompactJson(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`);
  return `{${parts.join(",")}}`;
}

/** The event's wall-clock time in seconds, or null (baseline `_epoch`). */
export function epochOf(ev: PresentEvent): number | null {
  const ts = ev.ts;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts === "string" && ts.trim() !== "") {
    const parsed = Number.parseFloat(ts);
    if (Number.isFinite(parsed)) return parsed;
  }
  const time = ev.time;
  if (typeof time === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2})(\d{2})$/.exec(time);
    if (match !== null) {
      const [, y, mo, d, h, mi, s, oh, om] = match;
      const offsetMinutes =
        (Number.parseInt(oh, 10) * 60 + Number.parseInt(om, 10)) * (oh.startsWith("-") ? -1 : 1);
      const asUTC = Date.UTC(
        Number.parseInt(y, 10),
        Number.parseInt(mo, 10) - 1,
        Number.parseInt(d, 10),
        Number.parseInt(h, 10),
        Number.parseInt(mi, 10),
        Number.parseInt(s, 10),
      );
      return (asUTC - offsetMinutes * 60_000) / 1000;
    }
  }
  return null;
}

/** Where the clock comes from; injectable so the tests fix the instant. */
export type Now = () => number;

export const defaultNow: Now = () => Date.now() / 1000;

/* ───────────────────────────────────────────────────────────────────────────
 *  Run totals + current activity — shared by the timeline heartbeat, the
 *  final summary and the card.
 * ───────────────────────────────────────────────────────────────────────── */

/** Cost, tokens and passes, plus the activity the heartbeat renders. */
export class Totals {
  cost = 0;
  outTokens = 0;
  inTokens = 0;
  passes = 0;
  readonly started: number;
  workdir = "";
  phase: unknown = null;
  attempt: unknown = null;
  itr: unknown = null;
  maxIter: unknown = null;
  activity = "starting";
  activitySince: number;
  private readonly now: Now;

  constructor(now: Now = defaultNow) {
    this.now = now;
    this.started = now();
    this.activitySince = now();
  }

  private setActivity(text: string): void {
    if (text !== this.activity) {
      this.activity = text;
      this.activitySince = this.now();
    }
  }

  update(ev: PresentEvent): void {
    const e = ev.event ?? "";
    if (e === "run_start") {
      if ("workdir" in ev)
        this.workdir = ev.workdir === undefined ? this.workdir : String(ev.workdir);
      this.setActivity("run starting");
    } else if (e === "phase_start") {
      this.phase = ev.phase;
      this.setActivity(`phase ${String(this.phase)} starting`);
    } else if (e === "proposer_start") {
      if ("phase" in ev) this.phase = ev.phase;
      if (present(ev.attempt)) this.attempt = ev.attempt;
      this.setActivity("proposer working");
    } else if (e === "accelerator_start") {
      if ("phase" in ev) this.phase = ev.phase;
      if (present(ev.attempt)) this.attempt = ev.attempt;
      this.setActivity("accelerator working");
    } else if (e === "iter_start") {
      this.itr = ev.iter;
      this.maxIter = ev.max_iter;
      this.setActivity(`proposer pass ${String(this.itr)}/${String(this.maxIter)}`);
    } else if (e === "agent_tool") {
      const tool = present(ev.tool) ? String(ev.tool) : "?";
      const status = ev.status;
      const target = summaryOf(ev, "target", "summary", "targets");
      const action =
        status !== undefined && status !== null && status !== "" ? ` ${String(status)}` : "";
      this.setActivity(
        target !== "" ? `› ${tool}${action} ${target.slice(0, 40)}` : `› ${tool}${action}`,
      );
    } else if (e === "agent_text") {
      this.setActivity("agent responding");
    } else if (e === "evidence_writing") {
      this.setActivity("writing evidence");
    } else if (e === "agent_diagnostic") {
      this.setActivity(`agent diagnostic: ${present(ev.code) ? String(ev.code) : "unknown"}`);
    } else if (e === "agent_result") {
      this.passes += 1;
      const costValue = present(ev.cost) ? ev.cost : ev.cost_usd;
      const cost = Number.parseFloat(String(costValue));
      if (Number.isFinite(cost)) this.cost += cost;
      for (const [src, attr] of [
        ["output_tokens", "outTokens"],
        ["input_tokens", "inTokens"],
      ] as const) {
        const raw = Number.parseFloat(String(ev[src] ?? 0));
        if (Number.isFinite(raw)) this[attr] += Math.trunc(raw);
      }
    } else if (e === "critic_start") {
      this.setActivity(
        `critic judging phase ${"phase" in ev ? String(ev.phase) : String(this.phase)}`,
      );
    } else if (e === "verdict") {
      this.setActivity(`verdict: ${"result" in ev ? String(ev.result) : "?"}`);
    } else if (e === "run_stop" || e === "run_end") {
      this.setActivity(e === "run_stop" ? "stopped" : "complete");
    }
  }

  /** `$cost · <tokens> tok out · <elapsed>` — the uncoloured run totals. */
  summaryBits(): string {
    const bits: string[] = [];
    if (this.cost !== 0) bits.push(`$${this.cost.toFixed(2)}`);
    if (this.outTokens !== 0) bits.push(`${formatTokensOf(this.outTokens)} tok out`);
    bits.push(fmtSecs(this.now() - this.started));
    return bits.join(" · ");
  }

  /** The same totals, each value tinted so the numbers read at a glance. */
  summaryBitsColored(th: Theme): string {
    const G = th.sgr("approved");
    const C = th.sgr("accent");
    const B = th.sgr("brand");
    const Y = th.sgr("warn");
    const DIM = th.sgr("muted");
    const RS = th.reset;
    const bits: string[] = [];
    if (this.cost !== 0) bits.push(`${G}$${this.cost.toFixed(2)}${RS}`);
    if (this.outTokens !== 0)
      bits.push(`${C}${formatTokensOf(this.outTokens)}${RS}${DIM} tok out${RS}`);
    if (this.passes !== 0) bits.push(`${B}${this.passes}${RS}${DIM} pass${RS}`);
    bits.push(`${Y}${fmtSecs(this.now() - this.started)}${RS}`);
    return bits.join(`${DIM} · ${RS}`);
  }
}

/** Token counts as `<n>`, `<n.n>k`, `<n.n>M` (baseline `fmt_tokens`). */
export function formatTokensOf(value: unknown): string {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return String(value);
  const whole = Math.trunc(n);
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(1)}M`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(1)}k`;
  return String(whole);
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Gate rail state — shared by the card and the timeline, so both draw the
 *  same rail the splash printed.
 * ───────────────────────────────────────────────────────────────────────── */

/** Why the rail should be re-stamped now. */
export type StampKind = "verdict" | "phase_done" | "run_stop" | "run_end";

/**
 * The banner's A/R/C/P bookkeeping (F145-FR-007), fed one event at a time. A
 * resumed run's events file holds no verdicts for the phases before it, so
 * `run_start` carries `states` and the tracker seeds from it; an older file
 * without it starts all-pending and fills in from the verdicts that follow.
 */
export class RailTracker {
  private readonly now: Now;
  phasesTotal: unknown = null;
  curPhase: unknown = null;
  lastVerdict = new Map<string, string>();
  started: number | null = null;
  stamp: StampKind | null = null;
  tail = "";
  private lastStamp: string | null = null;

  constructor(now: Now = defaultNow) {
    this.now = now;
  }

  update(ev: PresentEvent): void {
    const e = ev.event ?? "";
    this.stamp = null;
    if (e === "run_start") {
      this.phasesTotal = ev.phases;
      this.started = epochOf(ev);
      const seed = banner.parseStates(null, typeof ev.states === "string" ? ev.states : null);
      if (seed !== null && seed.length > 0) {
        const seeded = new Map<string, string>();
        seed.forEach((s, i) => {
          if (s === "A" || s === "R") seeded.set(String(i + 1), s);
        });
        this.lastVerdict = seeded;
        const cur = seed.findIndex((s) => s === "C");
        if (cur !== -1) this.curPhase = cur + 1;
      }
    } else if (e === "phase_start") {
      this.curPhase = ev.phase;
      if ("total" in ev) this.phasesTotal = ev.total;
    } else if (e === "proposer_start" || e === "accelerator_start") {
      if (present(ev.phase)) this.curPhase = ev.phase;
    } else if (e === "verdict") {
      const res = ev.result;
      const ph = String(ev.phase);
      // MALFORMED is a critic parse failure, not a judgment: the gate holds.
      if (res === "APPROVED") this.lastVerdict.set(ph, "A");
      else if (res === "REJECTED") {
        this.lastVerdict.set(ph, "R");
        const att = ev.attempt;
        const most = present(ev.max_rejects) ? ev.max_rejects : ev.MAX_REJECTS;
        const extra = present(att) && present(most) ? `attempt ${String(att)}/${String(most)}` : "";
        this.stampOf("verdict", extra);
      }
    } else if (e === "phase_done") {
      this.lastVerdict.set(String(ev.phase), "A");
      this.stampOf("phase_done", this.elapsedOf(ev));
    } else if (e === "run_stop") {
      if (present(ev.phase)) this.curPhase = ev.phase;
      this.stampOf("run_stop", "");
    } else if (e === "run_end") {
      const total = this.phasesTotal;
      if (typeof total === "number" || (typeof total === "string" && /^\d+$/.test(total))) {
        const n = Number(total);
        for (let i = 1; i <= n; i += 1) this.lastVerdict.set(String(i), "A");
      }
      this.stampOf("run_end", this.elapsedOf(ev));
    }
  }

  private elapsedOf(ev: PresentEvent): string {
    const now = epochOf(ev);
    if (this.started === null || now === null || now < this.started) return "";
    return fmtSecs(now - this.started);
  }

  private stampOf(kind: StampKind, extra: string): void {
    const states = this.railStates();
    if (states === null) return;
    // the proposer and the orchestrator can both report one halt: stamp it once
    const key = `${kind}:${states.join(",")}`;
    if (kind === "run_stop" && this.lastStamp === key) return;
    this.lastStamp = key;
    this.stamp = kind;
    const bits = [`${states.filter((s) => s === "A").length}/${states.length} approved`];
    if (extra !== "") bits.push(extra);
    this.tail = bits.join(" · ");
  }

  /** The banner's A/R/C/P states, one per phase (1..total), or null. */
  railStates(): string[] | null {
    const total = this.phasesTotal;
    const asText = String(total ?? "");
    if (!/^\d+$/.test(asText) || Number.parseInt(asText, 10) < 1) return null;
    const n = Number.parseInt(asText, 10);
    const out: string[] = [];
    for (let i = 1; i <= n; i += 1) {
      const v = this.lastVerdict.get(String(i));
      if (v !== undefined) out.push(v);
      else if (String(i) === String(this.curPhase)) out.push("C");
      else out.push("P");
    }
    return out;
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 *  The live rail, re-stamped under a timeline line.
 * ───────────────────────────────────────────────────────────────────────── */

/** (compact, shown) for the layout that shows the most gates; full wins a tie. */
function railLayout(
  states: readonly string[],
  width: number,
  ascii: boolean,
): { compact: boolean; shown: number } | null {
  let best: { compact: boolean; shown: number } | null = null;
  for (const compact of [false, true]) {
    const [lead, tail, gap] = compact ? [3, 3, 7] : [4, 4, 10];
    const got = banner.layoutRail(states, width, ascii, lead, tail, gap);
    const shown = got === null ? 0 : got.length;
    if (best === null || shown > best.shown) best = { compact, shown };
  }
  return best;
}

/**
 * The gate rail re-stamped under a timeline line (F145-FR-007): indented to
 * the message column, sized to the terminal, with a muted status `tail` when
 * it fits. No line is wider than `cols`.
 */
export function liveRailLines(
  states: readonly string[],
  cols: number,
  th: Theme,
  ascii: boolean,
  tail = "",
  progress?: number,
): string[] {
  const pad = " ".repeat(RAIL_INDENT);
  const width = cols - RAIL_INDENT - 1;
  if (width < 1) return [];

  const withTail = (line: string): string => {
    if (tail !== "" && displayWidth(line) + 3 + displayWidth(tail) <= width) {
      return `${line}   ${th.paint("muted", tail)}`;
    }
    return line;
  };

  if (cols < ONE_LINE_BELOW) {
    let line = banner.onelineRail(states, th, ascii);
    if (displayWidth(line) > width) line = banner.summary(states, th, ascii);
    if (displayWidth(line) > width) return [];
    return [pad + withTail(line)];
  }
  const chosen = railLayout(states, width, ascii);
  const [rail, labels] = banner.renderRail(
    states,
    width,
    th,
    ascii,
    chosen?.compact ?? false,
    progress,
  );
  return [pad + withTail(rail), ...(labels !== "" ? [pad + labels] : [])];
}

/** The frames of one gate settling: the tip walks from the old frontier. */
export function railFrames(
  states: readonly string[],
  before: readonly string[] | null,
  cols: number,
  th: Theme,
  ascii: boolean,
  tail: string,
): string[][] {
  const width = cols - RAIL_INDENT - 1;
  const fOld = before === null || before.length === 0 ? null : banner.frontier(before);
  const fNew = banner.frontier(states);
  if (
    cols < ONE_LINE_BELOW ||
    before === null ||
    before.length !== states.length ||
    (fOld ?? states.length) >= (fNew ?? states.length)
  ) {
    return [];
  }
  const chosen = railLayout(states, width, ascii);
  if (chosen === null) return [];
  const got = banner.layoutRail(states, width, ascii, ...(chosen.compact ? [3, 3, 7] : [4, 4, 10]));
  if (got === null) return [];
  const colOf = new Map<number, number>();
  for (const one of got.gates) if (one.index !== null) colOf.set(one.index, one.col);
  const start = colOf.get(fOld ?? -1) ?? 0;
  const target = fNew === null ? got.length - 1 : colOf.get(fNew);
  if (target === undefined || target <= start) return [];
  const out: string[][] = [];
  for (let k = 0; k < 3; k += 1) {
    const p = pyRound(start + ((target - start) * k) / 3);
    const frameLines = liveRailLines(states, cols, th, ascii, "", p);
    out.push(frameLines.length >= 2 ? frameLines.slice(0, 2) : [...frameLines, ""]);
  }
  const final = liveRailLines(states, cols, th, ascii, tail);
  out.push(final.length >= 2 ? final.slice(0, 2) : [...final, ""]);
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Stop requests.
 * ───────────────────────────────────────────────────────────────────────── */

import { existsSync } from "node:fs";
import { dirname, join, normalize as normalizePath } from "node:path";

/**
 * True when a stop request exists next to the events file or two levels above
 * it (`inbox:stop`, F145-FR-008) — both layouts: the flat `.specstride`
 * events file and the per-run state directory two levels above it.
 */
export function stopRequested(eventsPath: string): boolean {
  const dir = dirname(eventsPath);
  return [".", "../.."].some((rel) => existsSync(normalizePath(join(dir, rel, "stop.flag"))));
}

/** One drawn heartbeat line (F145-FR-008), without the leading carriage return. */
export function heartbeatLine(options: {
  th: Theme;
  frame: string;
  pulse: string;
  stopPending: boolean;
  activity: string;
  dwellSeconds: number;
  totals: string;
}): string {
  const { th, frame, pulse, stopPending, activity, dwellSeconds, totals } = options;
  const BOLD = th.bold;
  const Y = th.sgr("warn");
  const W = th.sgr("brand");
  const C = th.sgr("accent");
  const B = th.sgr("brand");
  const DIM = th.sgr("muted");
  const RS = th.reset;
  const status = stopPending
    ? `${BOLD}${Y}‖ stop requested — finishing current pass…${RS}`
    : `${W}${activity}${RS} ${DIM}·${RS} ${Y}${fmtSecs(dwellSeconds)}${RS}`;
  return `${CLR_EOL}  ${C}${frame}${RS}${B}${pulse}${RS} ${status}  ${DIM}· run${RS} ${totals}`;
}
