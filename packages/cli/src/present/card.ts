/**
 * The card (T015): the fixed status block that redraws in place — phase
 * trail, current activity, run totals, rolling feed and outcome
 * (F145-FR-009). Ported from the baseline `lib/present.py` at 9cab15d (`class
 * State`), with the terminal size and the clock injectable so the redraw
 * compares byte for byte on the fixtures.
 */
import * as banner from "./banner.ts";
import { CLEAR, CLR_EOL, RailTracker, SPINNER, Totals, fmtSecs, present } from "./rail.ts";
import type { Env, Theme } from "./theme.ts";
import type { PresentEvent } from "./follow.ts";
import { narrate } from "./presenter.ts";

/** One line of the rolling feed: the narrated line with its timestamp cut. */
function feedText(narrated: string): string {
  const cut = narrated.split("  ");
  const head = cut.shift() ?? "";
  return cut.length > 0 ? narrated.slice(head.length + 2) : narrated;
}

/** The card's aggregate state: feed one event at a time, then render. */
export class CardState {
  private readonly detail: string;
  private readonly rail = new RailTracker();
  private readonly totals: Totals;
  private curTitle = "";
  private readonly attempt = new Map<string, unknown>();
  private proposer = "?";
  private critic = "?";
  private lastReason = "";
  private outcome: string | null = null;
  private lastTs = "";
  private lastEventEpoch: number;
  private readonly feed: { ts: string; text: string }[] = [];
  private readonly now: () => number;

  constructor(detail: string = "tools", now: () => number = () => Date.now() / 1000) {
    this.detail = detail;
    this.now = now;
    this.totals = new Totals(now);
    this.lastEventEpoch = now();
  }

  private feedLine(ts: string, text: string): void {
    const last = this.feed[this.feed.length - 1];
    if (last !== undefined && last.text === text) return;
    this.feed.push({ ts, text });
    if (this.feed.length > 200) this.feed.splice(0, this.feed.length - 200);
  }

  update(ev: PresentEvent, th: Theme): void {
    const e = ev.event ?? "";
    this.lastTs = hhmmssPort(ev);
    this.lastEventEpoch = this.now();
    this.totals.update(ev);
    this.rail.update(ev);
    const narrated = narrate(ev, th, this.detail, false);
    if (narrated !== null) this.feedLine(this.lastTs, feedText(narrated));
    if (e === "_reopen") {
      this.feedLine("--:--:--", "── new run — following it ──");
    } else if (e === "run_start") {
      this.proposer = ev.proposer === undefined ? "?" : String(ev.proposer);
      this.critic = ev.critic === undefined ? "?" : String(ev.critic);
      this.outcome = null;
    } else if (e === "phase_start") {
      this.curTitle = typeof ev.title === "string" ? ev.title : "";
    } else if (e === "proposer_start" || e === "accelerator_start") {
      this.attempt.set(String(ev.phase), ev.attempt);
    } else if (e === "verdict") {
      if (ev.result !== "APPROVED")
        this.lastReason = typeof ev.reason === "string" ? ev.reason : "";
    } else if (e === "run_stop") {
      this.outcome =
        ev.reason === "stop_flag"
          ? "STOPPED — resume with: specstride resume"
          : `HALT: ${ev.reason === undefined ? "?" : String(ev.reason)}`;
    } else if (e === "run_end") {
      this.outcome = ev.outcome === undefined ? "done" : String(ev.outcome);
    }
  }

  /** The card's lines for one frame (baseline `State.render`). */
  render(frame: string, th: Theme, ascii: boolean, cols: number, rows: number): string {
    void ascii;
    const BOLD = th.bold;
    const G = th.sgr("approved");
    const Y = th.sgr("warn");
    const C = th.sgr("accent");
    const W = th.sgr("brand");
    const DIM = th.sgr("muted");
    const RS = th.reset;
    const feedRows = Math.max(4, rows - 9);
    const lines: string[] = [""];
    // the rail the splash printed, so startup and live read as one object
    const states = this.rail.railStates();
    if (states !== null) {
      const rail = banner.renderRail(states, Math.max(20, cols - 3), th, ascii, false);
      for (const one of rail) lines.push(one !== "" ? `  ${one}` : "");
      lines.push("");
    }
    const total = this.rail.phasesTotal;
    const att = this.attempt.get(String(this.rail.curPhase));
    const attemptPart =
      att !== undefined && att !== null && String(att) !== "1" && String(att) !== "None"
        ? ` ${DIM}(attempt ${String(att)})${RS}`
        : "";
    const cur =
      this.rail.curPhase === null || this.rail.curPhase === undefined
        ? "?"
        : String(this.rail.curPhase);
    const totalText = String(total ?? "");
    const head = `${BOLD}${cur}${RS}${/^\d+$/.test(totalText) ? `/${Number.parseInt(totalText, 10)}` : ""}`;
    const idle = Math.trunc(this.now() - this.lastEventEpoch);
    const heartbeat = idle > 2 ? ` ${DIM}(+${idle}s)${RS}` : "";
    lines.push(`  phase ${head}${attemptPart}  ${DIM}${this.curTitle.slice(0, 40)}${RS}`);
    lines.push(
      `  ${C}${frame}${RS} ${W}${this.totals.activity}${RS} ${DIM}(${fmtSecs(this.now() - this.totals.activitySince)})${RS}${heartbeat}`,
    );
    lines.push(`  ${DIM}run:${RS} ${this.totals.summaryBitsColored(th)}`);
    lines.push(`${DIM}  ${"┄".repeat(Math.max(10, cols - 4))}${RS}`);
    for (const one of this.feed.slice(-feedRows)) {
      lines.push(`  ${DIM}${one.ts}${RS} ${one.text}`.slice(0, cols + 30));
    }
    if (this.outcome !== null) {
      const col = this.outcome.includes("HALT") || this.outcome.includes("STOP") ? Y : G;
      lines.push(`  ${col}${BOLD}■ ${this.outcome}${RS}`);
    }
    lines.push(`${DIM}  Ctrl-C to detach — the run keeps going${RS}`);
    return lines.map((one) => one + CLR_EOL).join("\n");
  }

  get phasesTotal(): unknown {
    return this.rail.phasesTotal;
  }

  get curPhase(): unknown {
    return this.rail.curPhase;
  }

  get outcomeValue(): string | null {
    return this.outcome;
  }

  get proposerCritic(): readonly [string, string] {
    return [this.proposer, this.critic];
  }

  get lastReasonValue(): string {
    return this.lastReason;
  }

  get feedLines(): readonly { ts: string; text: string }[] {
    return this.feed;
  }

  railStates(): string[] | null {
    return this.rail.railStates();
  }
}

/** The presenter's clock reader, imported late to keep the module tree simple. */
function hhmmssPort(ev: PresentEvent): string {
  const t = ev.time;
  if (typeof t === "string" && t.includes("T")) return t.split("T", 2)[1].slice(0, 8);
  let seconds = 0;
  const ts = ev.ts;
  if (typeof ts === "number" && Number.isFinite(ts)) seconds = ts;
  else if (typeof ts === "string" && ts.trim() !== "") {
    const parsed = Number.parseFloat(ts);
    if (Number.isFinite(parsed)) seconds = parsed;
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/**
 * One full draw of the card from an events file: the state the file holds so
 * far, rendered once with a fixed frame and instant.
 */
export function drawCard(options: {
  events: readonly PresentEvent[];
  title?: string;
  cols?: number;
  rows?: number;
  now: number;
  th: Theme;
  ascii: boolean;
  frameIndex?: number;
}): string {
  const { events, cols = 100, rows = 24, now, th, ascii } = options;
  const st = new CardState("tools", () => now);
  for (const ev of events) st.update(ev, th);
  const frameIndex = options.frameIndex ?? Math.floor(now) % SPINNER.length;
  const frame = SPINNER[frameIndex % SPINNER.length] ?? "·";
  return CLEAR + st.render(frame, th, ascii, cols, rows) + "\n";
}

export { CLEAR, present };

/* ── the card's follow loop ──────────────────────────────────────────────── */

import { followEventsFile } from "./follow.ts";

/**
 * The card's runner (baseline `run_card`, F145-FR-009): one non-following
 * pass to build the state fast, then a redraw per followed event. Ends when
 * the caller's signal ends it or when an outcome lands (F145-FR-001).
 */
export async function runCard(
  path: string,
  follow: boolean,
  detail: string,
  debug: boolean,
  th: Theme,
  ascii: boolean,
  write: (text: string) => void,
  context: {
    readonly env?: Env;
    readonly signal?: AbortSignal;
    readonly now?: () => number;
    readonly size?: { cols: number; rows: number };
  } = {},
): Promise<void> {
  void follow;
  void debug;
  void context.env;
  const cols = context.size?.cols ?? 100;
  const rows = context.size?.rows ?? 24;
  const now = context.now ?? (() => Date.now() / 1000);
  const st = new CardState(detail, now);
  for await (const ev of followEventsFile(path, { follow: false, signal: context.signal })) {
    st.update(ev, th);
  }
  write(CLEAR);
  let spinI = 0;
  for await (const ev of followEventsFile(path, { follow: true, signal: context.signal })) {
    st.update(ev, th);
    spinI += 1;
    const outcome = st.outcomeValue;
    const frame = outcome !== null ? "■" : (SPINNER[spinI % SPINNER.length] ?? "·");
    write(`${CLEAR}${st.render(frame, th, ascii, cols, rows)}\n`);
    if (outcome !== null) break;
  }
}
