/**
 * The banner (T012): the Specstride start-up splash — mark, name, caption and
 * the gate rail — with its options, environment switches, width tiers and
 * animation (F145-FR-015, F145-FR-016, F145-FR-017). A faithful port of the
 * baseline `lib/banner.py` at 9cab15d: the layout search, the tiers, the
 * motion and the plain copy are the baseline's own, so the splash compares
 * byte for byte with it (F145-SC-002, parity profile).
 */
import {
  Theme,
  asciiMode,
  displayWidth,
  glyph,
  pyRound,
  resolveDepth,
  detectBg,
  themeFor,
} from "./theme.ts";
import type { Env, StreamLike } from "./theme.ts";

/** The mark: the track folded into an S, a switchback rail with gate posts. */
export const MARK_FULL = [
  "┏━━━━┿━━━━┿━━━━╸",
  "┃",
  "┗━━━━┿━━━━┿━━━━┓",
  "               ┃",
  "╺━━━━┿━━━━┿━━━━┛",
];
export const MARK_FULL_ASCII = [
  ".====+====+====-",
  "|",
  "'====+====+====.",
  "               |",
  "-====+====+===='",
];
export const MARK_COMPACT = ["┏━━┿━━╸", "┗━━┿━━┓", "╺━━┿━━┛"];
export const MARK_COMPACT_ASCII = [".==+==-", "'==+==.", "-==+=='"];
export const MARK_LINE = "┗┓";
export const MARK_LINE_ASCII = "'.";

export const NAME = "specstride";
export const DESCRIPTION = "From specs to tested code.";
export const CAPTION = "Every step, signed off.";

export const INDENT = "  ";
export const FULL_MIN_COLS = 72;
export const COMPACT_MIN_COLS = 40;
export const MIN_ROWS = 14;
export const FRAME_SECONDS = 0.075;
export const FRAMES = 9;

export const STATE_ROLE: Readonly<Record<string, string>> = Object.freeze({
  A: "approved",
  R: "reject",
  C: "accent",
  P: "muted",
});
export const STATE_GLYPH: Readonly<Record<string, string>> = Object.freeze({
  A: "approved",
  R: "rejected",
  C: "current",
  P: "pending",
});
export const ASCII_WORD: Readonly<Record<string, string>> = Object.freeze({
  A: "ok",
  R: "rej",
  C: "now",
  P: "-",
});
export const ASCII_SHORT: Readonly<Record<string, string>> = Object.freeze({
  A: "+",
  R: "x",
  C: ">",
  P: ".",
});

/* ── states ──────────────────────────────────────────────────────────────── */

/**
 * The A/R/C/P list of `--states` (F145-FR-015): first letter, case-insensitive;
 * an unknown letter becomes `P`; with `phases` the list is padded to it and
 * clamped to 1..40; without it, at most 40 given states stand and `None`
 * (an empty list) is the decorative rail.
 */
export function parseStates(phases?: number | null, states?: string | null): string[] | null {
  const given = (states ?? "")
    .split(",")
    .map((one) => one.trim().toUpperCase().slice(0, 1))
    .filter((one) => one !== "")
    .map((one) => (Object.hasOwn(STATE_ROLE, one) ? one : "P"));
  if (phases === null || phases === undefined) {
    return given.length === 0 ? null : given.slice(0, 40);
  }
  const n = Math.max(1, Math.min(40, Math.trunc(phases)));
  return [...given, ...Array<string>(n).fill("P")].slice(0, n);
}

/** Index of the first gate that is not approved; null when all are. */
export function frontier(states: readonly string[]): number | null {
  const index = states.findIndex((one) => one !== "A");
  return index === -1 ? null : index;
}

/* ── the rail ────────────────────────────────────────────────────────────── */

interface Gate {
  readonly col: number;
  readonly index: number | null;
  readonly state: string;
}
interface Label {
  readonly col: number;
  readonly text: string;
  readonly state: string;
}
interface Layout {
  readonly gates: Gate[];
  readonly labels: Label[];
  readonly length: number;
}

function labelOf(state: string, num: number, ascii: boolean, spaced: boolean): string {
  if (ascii) return spaced ? `${num} ${ASCII_WORD[state]}` : `${num}${ASCII_SHORT[state]}`;
  const g = glyph(STATE_GLYPH[state]);
  return spaced ? `${g} ${num}` : `${g}${num}`;
}

function groupLabelOf(state: string, count: number, ascii: boolean, first = 1): string {
  if (ascii) return `${first}-${first + count - 1} ${ASCII_WORD[state]}`;
  return `${glyph(STATE_GLYPH[state])}${glyph("times")}${count}`;
}

/**
 * Fits the rail into `width` columns (B-1170): the gates, their labels and
 * the total length, or null when nothing fits. The full layout wins a tie;
 * wider gaps are tried before tighter ones, spaced labels before tight ones.
 */
export function layoutRail(
  states: readonly string[],
  width: number,
  ascii = false,
  lead = 4,
  tail = 4,
  maxGap = 10,
): Layout | null {
  const n = states.length;
  const f = frontier(states);
  const frontierIndex = f === null ? n - 1 : f;

  const attempt = (start: number, k: number, spaced: boolean, gap: number): Layout | null => {
    const pre = start;
    const post = n - start - k;
    const gates: Gate[] = [];
    const labels: Label[] = [];
    let col = lead;
    if (pre > 0) {
      const pl = groupLabelOf("A", pre, ascii);
      labels.push({ col: 0, text: pl, state: "A" });
      col = Math.max(lead, displayWidth(pl) + 2);
    }
    for (let j = 0; j < k; j += 1) {
      const i = start + j;
      gates.push({ col, index: i, state: states[i] });
      labels.push({ col, text: labelOf(states[i], i + 1, ascii, spaced), state: states[i] });
      col += gap;
    }
    let end = gates[gates.length - 1].col + 1;
    if (post > 0) {
      const rest = states.slice(start + k);
      const same = rest.every((one) => one === rest[0]);
      const st = same ? rest[0] : "P";
      const gl = groupLabelOf(st, post, ascii, start + k + 1);
      labels.push({ col: gates[gates.length - 1].col + gap, text: gl, state: st });
      end = gates[gates.length - 1].col + gap + displayWidth(gl);
    }
    const length = Math.max(end + tail, ...labels.map((one) => one.col + displayWidth(one.text)));
    for (let i = 0; i < labels.length - 1; i += 1) {
      if (labels[i].col + displayWidth(labels[i].text) >= labels[i + 1].col) return null;
    }
    return { gates, labels, length };
  };

  for (const spaced of [true, false]) {
    for (let k = n; k >= 1; k -= 1) {
      const start = Math.max(0, Math.min(k > 1 ? frontierIndex - 1 : frontierIndex, n - k));
      const widest = Math.max(
        ...Array.from({ length: k }, (_, j) =>
          displayWidth(labelOf(states[start + j], start + j + 1, ascii, spaced)),
        ),
      );
      for (let gap = maxGap; gap > widest; gap -= 1) {
        const got = attempt(start, k, spaced, gap);
        if (got !== null && got.length <= width) return got;
      }
    }
  }
  return null;
}

/**
 * The two rail lines (F145-FR-007): the track with its gate posts, then the
 * labels. `progress` (a column) draws one motion frame: the track walked up
 * to the cursor and only the labels already passed.
 */
export function renderRail(
  states: readonly string[] | null,
  width: number,
  th: Theme,
  ascii = false,
  compact = false,
  progress?: number,
): [string, string] {
  const [lead, tail, gap] = compact ? [3, 3, 7] : [4, 4, 10];
  if (states === null) {
    // decorative: five posts, all ink
    let line = "";
    const total = lead + 4 * gap + 1 + tail;
    for (let c = 0; c < total; c += 1) {
      const isGate = c >= lead && (c - lead) % gap === 0 && c <= lead + 4 * gap;
      line += glyph(isGate ? "gate" : "track", ascii);
    }
    return [th.paint("brand", line.slice(0, width)), ""];
  }
  const got = layoutRail(states, width, ascii, lead, tail, gap);
  if (got === null) return [summary(states, th, ascii).slice(0, width), ""];
  const { gates, labels, length } = got;
  const f = frontier(states);
  const allDone = f === null;
  const gateCols = new Set(gates.map((one) => one.col));
  const frontCol = allDone ? null : gates.find((one) => one.index === f)!.col;
  const walkedTo: number = allDone ? length : frontCol!;

  const out: string[] = [];
  let roleRun: string | null = null;
  let buf = "";
  const flush = (): void => {
    if (roleRun !== null && buf !== "") out.push(th.paint(roleRun as never, buf));
  };
  for (let c = 0; c < length; c += 1) {
    let ch: string;
    let role: string;
    if (gateCols.has(c)) {
      ch = glyph("gate", ascii);
      if (progress !== undefined) role = c <= progress ? "brand" : "muted";
      else if (c === frontCol) role = "accent";
      else role = c < walkedTo ? "brand" : "muted";
    } else {
      const earned = progress === undefined ? c < walkedTo : c < progress;
      if (allDone && c === length - 1 && progress === undefined) ch = glyph("end", ascii);
      else if (progress !== undefined && c === progress) ch = glyph("tip", ascii);
      else ch = glyph(earned ? "track" : "ahead", ascii);
      role = earned ? "brand" : "muted";
      if (progress !== undefined && c === progress) role = "accent";
    }
    if (role !== roleRun) {
      flush();
      roleRun = role;
      buf = "";
    }
    buf += ch;
  }
  flush();
  const rail = out.join("");

  const lab: string[] = [];
  let col = 0;
  for (const one of labels) {
    if (progress !== undefined && one.col > progress) continue;
    lab.push(" ".repeat(Math.max(0, one.col - col)));
    const role = progress !== undefined && one.state === "C" ? "muted" : STATE_ROLE[one.state];
    lab.push(th.paint(role as never, one.text));
    col = one.col + displayWidth(one.text);
  }
  return [rail, lab.join("")];
}

/** The summary a too-narrow rail collapses to (F145-FR-017). */
export function summary(states: readonly string[], th: Theme, ascii: boolean): string {
  const f = frontier(states);
  const n = states.length;
  if (f === null) return th.paint("approved", `${glyph("approved", ascii)} ${n}/${n}`);
  const st = states[f];
  return th.paint(STATE_ROLE[st] as never, `${glyph(STATE_GLYPH[st], ascii)}${f + 1}/${n}`);
}

/** States on the posts, one line; runs of 3 or more equal states collapse. */
export function onelineRail(states: readonly string[], th: Theme, ascii: boolean): string {
  const f = frontier(states);
  const tokens: string[] = [];
  let i = 0;
  while (i < states.length) {
    let j = i;
    while (j < states.length && states[j] === states[i]) j += 1;
    const run = j - i;
    const st = states[i];
    const g = glyph(STATE_GLYPH[st], ascii);
    const earned = f === null || i < f;
    const sep = th.paint(
      (earned || i === f ? "brand" : "muted") as never,
      glyph(earned || i === f ? "track" : "ahead", ascii),
    );
    if (run >= 3) {
      tokens.push(sep + th.paint(STATE_ROLE[st] as never, g + glyph("times", ascii) + String(run)));
    } else {
      for (let k = 0; k < run; k += 1) tokens.push(sep + th.paint(STATE_ROLE[st] as never, g));
    }
    i = j;
  }
  return tokens.join("");
}

/* ── tiers ───────────────────────────────────────────────────────────────── */

export type Tier = "full" | "compact" | "line";

/** full from 72 columns, compact from 40, one line under 40 columns or 14 rows. */
export function tierFor(cols: number, rows: number): Tier {
  if (rows < MIN_ROWS || cols < COMPACT_MIN_COLS) return "line";
  return cols >= FULL_MIN_COLS ? "full" : "compact";
}

/** The mark with the name beside it — the part that never animates. */
function head(tier: Tier, th: Theme, ascii: boolean): string[] {
  const name = th.bold + th.paint("brand", NAME) + (th.on ? th.reset : "");
  if (tier === "full") {
    const m = ascii ? MARK_FULL_ASCII : MARK_FULL;
    const ink = m.map((one) => th.paint("brand", one));
    const pad = m.map((one) => one.length);
    const col = 16 + 4;
    const beside = (k: number, text: string): string =>
      INDENT + ink[k] + " ".repeat(col - pad[k]) + text;
    return [
      INDENT + ink[0],
      beside(1, name),
      beside(2, DESCRIPTION),
      beside(3, th.paint("muted", CAPTION)),
      INDENT + ink[4],
    ];
  }
  const m = ascii ? MARK_COMPACT_ASCII : MARK_COMPACT;
  const ink = m.map((one) => th.paint("brand", one));
  return [INDENT + ink[0], INDENT + ink[1] + "   " + name, INDENT + ink[2] + "   " + DESCRIPTION];
}

/** The splash as a list of lines, none wider than `cols`. */
export function render(
  states: readonly string[] | null,
  cols: number,
  rows: number,
  th: Theme = new Theme("none"),
  ascii = false,
  tier?: Tier,
  progress?: number,
): string[] {
  const theTier = tier ?? tierFor(cols, rows);
  if (theTier === "line") {
    const mark = ascii ? MARK_LINE_ASCII : MARK_LINE;
    const headText =
      th.paint("brand", mark) + " " + th.bold + th.paint("brand", NAME) + (th.on ? th.reset : "");
    const indent = cols >= 30 ? INDENT : "";
    const base = displayWidth(indent + mark + " " + NAME);
    const room = cols - base - 2;
    let rail = states ? onelineRail(states, th, ascii) : "";
    if (rail !== "" && displayWidth(rail) > room) {
      rail = summary(states as readonly string[], th, ascii);
      if (displayWidth(rail) > room) rail = "";
    }
    let line = indent + headText + (rail !== "" ? "  " + rail : "");
    if (displayWidth(line) > cols) line = NAME.slice(0, Math.max(0, cols));
    return [line];
  }
  const lines = [...head(theTier, th, ascii), ""];
  lines.push(
    ...renderRail(states, cols - INDENT.length - 1, th, ascii, theTier === "compact", progress).map(
      (one) => (one !== "" ? INDENT + one : ""),
    ),
  );
  return lines;
}

/** The motion: 9 frames; only the two rail lines change (F145-FR-017). */
export function frames(
  states: readonly string[] | null,
  cols: number,
  rows: number,
  th: Theme,
  ascii: boolean,
): string[][] {
  const tier = tierFor(cols, rows);
  const final = render(states, cols, rows, th, ascii, tier);
  if (tier === "line" || states === null) return [final];
  const width = cols - INDENT.length - 1;
  const got = layoutRail(states, width, ascii, ...(tier === "compact" ? [3, 3, 7] : [4, 4, 10]));
  if (got === null) return [final];
  const { gates, length } = got;
  const f = frontier(states);
  const target = f === null ? length - 1 : gates.find((one) => one.index === f)!.col;
  const out: string[][] = [];
  const walk = FRAMES - 3;
  for (let k = 0; k < FRAMES - 1; k += 1) {
    const p = walk !== 0 ? Math.min(target, pyRound((target * k) / walk)) : target;
    out.push(render(states, cols, rows, th, ascii, tier, p));
  }
  out.push(final);
  return out;
}

/* ── output ──────────────────────────────────────────────────────────────── */

export const HIDE = "\x1b[?25l";
export const SHOW = "\x1b[?25h";
export const SYNC_ON = "\x1b[?2026h";
export const SYNC_OFF = "\x1b[?2026l";

export interface Writer {
  write(text: string): void;
}

/**
 * Draws the frames in place (F145-FR-017): one write per frame, synchronized
 * output, cursor hidden; the cursor and the attributes are restored whatever
 * happens. The sleeps are injectable so tests read the frames without the
 * 75 ms wait.
 */
export function play(
  frameList: readonly string[][],
  out: Writer,
  sleep: (seconds: number) => void = () => undefined,
): void {
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    try {
      out.write(Theme.prototype.reset + SHOW);
    } catch {
      // a failed restore must never raise (best effort, Principle V)
    }
  };
  try {
    const first = frameList[0];
    out.write(HIDE + first.join("\n") + "\n");
    const moving = 2; // only the rail and its labels are redrawn
    for (const frame of frameList.slice(1)) {
      sleep(FRAME_SECONDS);
      const buf = [SYNC_ON, `\x1b[${moving}A`];
      for (const one of frame.slice(-moving)) buf.push(`\r\x1b[K${one}\n`);
      buf.push(SYNC_OFF);
      out.write(buf.join(""));
    }
  } finally {
    restore();
  }
}

/** True when animation may run (F145-FR-016): not off, not CI, not dumb, on a terminal. */
export function motionAllowed(stream?: StreamLike, environ: Env = {}, noMotion = false): boolean {
  if (noMotion || (environ.SPECSTRIDE_MOTION ?? "") === "0") return false;
  if (environ.CI || (environ.TERM ?? "") === "dumb") return false;
  return Boolean(stream?.isTTY);
}

/** `SPECSTRIDE_BANNER` off: off, 0, false or no, case-insensitive. */
export function bannerOff(environ: Env = {}): boolean {
  return ["off", "0", "false", "no"].includes((environ.SPECSTRIDE_BANNER ?? "").toLowerCase());
}

/** The rail re-stamps: off with their own switch, and off when the splash is off. */
export function liveRailOff(environ: Env = {}): boolean {
  return (
    bannerOff(environ) ||
    ["off", "0", "false", "no"].includes((environ.SPECSTRIDE_LIVE_RAIL ?? "").toLowerCase())
  );
}

/** The splash's two rail lines alone, laid out exactly as under the mark. */
export function railOnly(
  states: readonly string[] | null,
  cols: number,
  th: Theme,
  ascii: boolean,
): string[] {
  const tier: Tier = cols >= FULL_MIN_COLS ? "full" : "compact";
  return render(states, cols, 24, th, ascii, tier).slice(-2);
}

/** Every tier, background and depth, the motion frames and the plain copy. */
export function preview(states?: readonly string[] | null): string[] {
  const theStates = states ?? parseStates(5, "A,A,C,P,P")!;
  const out: string[] = [];
  const tiers: readonly (readonly [Tier, number, number])[] = [
    ["full", 80, 24],
    ["compact", 56, 20],
    ["line", 36, 12],
  ];
  for (const [tier, cols, rows] of tiers) {
    for (const bg of ["dark", "light"] as const) {
      for (const depth of ["16", "256", "truecolor"] as const) {
        out.push(`── ${tier} tier, ${cols} columns, ${bg} background, ${depth} colors`);
        out.push(...render(theStates, cols, rows, new Theme(depth, bg), false, tier));
        out.push("");
      }
    }
  }
  for (const [tier, cols, rows] of tiers.slice(0, 2)) {
    out.push(
      `── motion, ${tier} tier: ${FRAMES} frames, ${Math.trunc(FRAME_SECONDS * 1000)} ms each`,
    );
    const list = frames(theStates, cols, rows, new Theme("16", "dark"), false);
    for (let k = 0; k < list.length; k += 1) {
      out.push(`   frame ${k}, ${Math.trunc(k * FRAME_SECONDS * 1000)} ms`);
      out.push(...list[k].slice(-2));
    }
    out.push("");
  }
  out.push("── plain (the run.log copy)");
  out.push(...render(theStates, 80, 24, new Theme("none"), true, "full"));
  return out;
}

/* ── the banner call ─────────────────────────────────────────────────────── */

/** The options of the banner call (F145-FR-015). */
export interface BannerOptions {
  readonly states?: string;
  readonly phases?: number;
  readonly plain?: boolean;
  readonly bg?: "dark" | "light";
  readonly color?: "always" | "never" | "auto";
  readonly noMotion?: boolean;
  readonly railOnly?: boolean;
  readonly preview?: boolean;
  readonly cols?: number;
  readonly rows?: number;
}

/**
 * The internal banner call (F145-FR-015): prints the splash and always ends
 * 0 — including switched off and on a closed pipe (a failed write is
 * swallowed here, the caller's stream reports it).
 */
export function bannerCall(
  options: BannerOptions = {},
  env: Env = {},
  stream?: StreamLike,
  size: { cols: number; rows: number } = { cols: 80, rows: 24 },
  sleep: (seconds: number) => void = () => undefined,
): { exit_code: number; stdout: string } {
  const states = parseStates(options.phases ?? null, options.states ?? "");
  if (options.preview) {
    return { exit_code: 0, stdout: preview(states).join("\n") + "\n" };
  }
  if (bannerOff(env) || (options.railOnly === true && liveRailOff(env))) {
    return { exit_code: 0, stdout: "" };
  }
  const cols = options.cols ?? size.cols;
  const rows = options.rows ?? size.rows;
  const color = options.color ?? "auto";
  const plain = options.plain === true || (color !== "always" && !stream?.isTTY);
  if (plain) {
    // the log copy: full-width ASCII, no escapes, whatever the terminal is
    const lines =
      options.railOnly === true
        ? railOnly(states, Math.max(cols, 80), new Theme("none"), true)
        : render(states, Math.max(cols, 80), 24, new Theme("none"), true, "full");
    return { exit_code: 0, stdout: lines.join("\n") + "\n" };
  }
  const th = themeFor(color, stream, env, options.bg);
  const ascii = asciiMode(env);
  if (options.railOnly === true) {
    return { exit_code: 0, stdout: railOnly(states, cols, th, ascii).join("\n") + "\n" };
  }
  const frameList = frames(states, cols, rows, th, ascii);
  if (frameList.length > 1 && motionAllowed(stream, env, options.noMotion === true)) {
    const chunks: string[] = [];
    play(frameList, { write: (text) => chunks.push(text) }, sleep);
    return { exit_code: 0, stdout: chunks.join("") };
  }
  return { exit_code: 0, stdout: frameList[frameList.length - 1].join("\n") + "\n" };
}

/** The depth the banner alone would resolve (used by the start-up record). */
export function bannerDepthOf(color: string, stream: StreamLike | undefined, env: Env): string {
  return resolveDepth(color, stream, env);
}

/** The background the banner alone would detect (used by the start-up record). */
export const bannerBgOf = detectBg;
