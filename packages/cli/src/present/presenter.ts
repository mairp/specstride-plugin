/**
 * The presenter core (T013): modes, options, detail levels (F145-FR-001 to
 * F145-FR-006) and the timeline, plain and quiet lines the fixtures compare
 * (F145-FR-003, F145-FR-004, F145-FR-005, F145-FR-010, F145-FR-021). A
 * faithful port of the baseline `lib/present.py` at 9cab15d: every literal is
 * the baseline's own, so the lines compare byte for byte through the theme's
 * resolved codes (F145-SC-001, parity profile).
 */
import * as banner from "./banner.ts";
import { followEventsFile } from "./follow.ts";
import type { PresentEvent } from "./follow.ts";
import { RailTracker, Totals, fmtMs, liveRailLines, present } from "./rail.ts";
import { Theme, asciiMode, detectBg, resolveDepth } from "./theme.ts";
import type { Env, StreamLike } from "./theme.ts";

/** The detail levels, low to high. */
export const DETAILS = ["milestones", "tools", "full"] as const;
export type Detail = (typeof DETAILS)[number];

/** The modes of the presenter. */
export const MODES = ["timeline", "card", "plain"] as const;
export type Mode = (typeof MODES)[number];

/** `HH:MM:SS` of an event: the `time` field's clock, else the local time of `ts`. */
export function hhmmss(ev: PresentEvent): string {
  const t = ev.time;
  if (typeof t === "string" && t.includes("T")) {
    return t.split("T", 2)[1].slice(0, 8);
  }
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

/** `<n>`, `<n.n>k`, `<n.n>M`, or the value back when it does not read as a number. */
export function fmtTokens(n: unknown): string {
  let value: number;
  try {
    value = Math.trunc(Number.parseFloat(String(n)));
  } catch {
    return String(n);
  }
  if (!Number.isFinite(value)) return String(n);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** Booleans of both typed normalized events and legacy shell events. */
function eventBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "error", "failed", "failure"].includes(
    String(value).trim().toLowerCase(),
  );
}

/** The first bounded display summary supplied by an event. */
function summaryOf(ev: PresentEvent, ...keys: string[]): string {
  for (const key of keys) {
    const value = ev[key];
    if (present(value)) {
      if (Array.isArray(value)) return value.map((one) => String(one)).join(", ");
      if (typeof value === "object" && value !== null) {
        return pyCompactJsonSorted(value as Record<string, unknown>);
      }
      return String(value);
    }
  }
  return "";
}

/** Compact, key-sorted JSON with the non-ASCII characters kept. */
function pyCompactJsonSorted(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`);
  return `{${parts.join(",")}}`;
}

/** The (colour code, glyph) of a tool call — the glyph tells families apart. */
export function toolStyle(name: unknown, th: Theme): readonly [string, string] {
  const BWHITE = th.sgr("brand");
  const GRAY = th.sgr("muted");
  const n = String(name ?? "").toLowerCase();
  if (n === "read") return [BWHITE, "◎"];
  if (n === "write") return [BWHITE, "✚"];
  if (["edit", "multiedit", "notebookedit"].includes(n)) return [BWHITE, "✎"];
  if (n === "bash") return [BWHITE, "❯"];
  if (["grep", "glob", "ls"].includes(n)) return [BWHITE, "❍"];
  if (["task", "agent"].includes(n)) return [BWHITE, "»"];
  if (["webfetch", "websearch"].includes(n)) return [BWHITE, "⇆"];
  if (["todowrite", "taskcreate", "taskupdate", "taskget", "tasklist"].includes(n)) {
    return [GRAY, "≡"];
  }
  if (n.startsWith("mcp__")) return [BWHITE, "◇"];
  return [BWHITE, "›"];
}

/**
 * One timeline line of `ev` (F145-FR-003 to F145-FR-005), coloured through
 * `th`'s roles, or null when the detail level hides it and `debug` does not
 * rescue it. The literals are the baseline's own (C-099).
 */
export function narrate(
  ev: PresentEvent,
  th: Theme,
  detail: string = "tools",
  debug = false,
): string | null {
  const e = ev.event ?? "";
  const ts = hhmmss(ev);
  const p = ev.phase === undefined || ev.phase === null ? "?" : String(ev.phase);
  const level = (DETAILS as readonly string[]).indexOf(detail);
  const lvl = level === -1 ? 1 : level;

  const G = th.sgr("approved");
  const BGREEN = G;
  const BRED = th.sgr("reject");
  const BYELLOW = th.sgr("warn");
  const Y = BYELLOW;
  const BCYAN = th.sgr("accent");
  const C = BCYAN;
  const GRAY = th.sgr("muted");
  const DIM = GRAY;
  const BMAGENTA = th.sgr("brand");
  const MAG = BMAGENTA;
  const BLUE = MAG;
  const BBLUE = MAG;
  const BWHITE = th.sgr("brand");
  const RS = th.reset;
  const BOLD = th.bold;
  const ITALIC = th.on ? "\x1b[3m" : "";

  const stamp = `${GRAY}${ts}${RS}`;

  if (e === "_reopen") return `${BCYAN}── new run detected — following it ──${RS}`;
  if (e === "run_start") {
    return (
      `${stamp}  ${BOLD}${BWHITE}┏ run start${RS} ${DIM}—${RS} ` +
      `${BCYAN}${ev.phases ?? "?"}${RS} phases · ` +
      `${BMAGENTA}${ev.proposer ?? "?"}${RS}${DIM}→${RS}${BWHITE}${ev.critic ?? "?"}${RS} · ` +
      `resume @ phase ${BOLD}${ev.resume ?? "?"}${RS}`
    );
  }
  if (e === "phase_start") {
    const tot = ev.total === undefined ? "?" : ev.total;
    const title = typeof ev.title === "string" ? ev.title : "";
    const totText = String(tot);
    const last = /^\d+$/.test(totText) ? String(Number.parseInt(totText, 10)) : totText;
    const titlePart = title !== "" ? ` ${DIM}—${RS} ${BWHITE}${title}${RS}` : "";
    return `${stamp}  ${BOLD}${BCYAN}◆ phase ${p}/${last}${RS}${titlePart}`;
  }
  if (e === "proposer_start") {
    return (
      `${stamp}  ${BMAGENTA}✱ proposer${RS} ${DIM}working — phase ${p}, ` +
      `attempt ${BOLD}${ev.attempt ?? "?"}${RS}${DIM}, ${ev.backend ?? "?"}${RS}`
    );
  }
  if (e === "accelerator_start") {
    const criteria = present(ev.criteria) ? ` · ${String(ev.criteria)}` : "";
    return (
      `${stamp}  ${BMAGENTA}✚ accelerator${RS} ${DIM}acting on the hint — phase ${p}, ` +
      `attempt ${BOLD}${ev.attempt ?? "?"}${RS}${DIM}, ${ev.backend ?? "?"}` +
      `${criteria}${RS}`
    );
  }
  if (e === "acceleration_note") {
    return `${stamp}  ${GRAY}↦ acceleration note written (phase ${p}, attempt ${ev.attempt ?? "?"})${RS}`;
  }
  if (e === "iter_start") {
    if (lvl < 1) return null;
    return (
      `${stamp}  ${BLUE}↻${RS} ${DIM}pass${RS} ${BOLD}${BBLUE}${ev.iter ?? "?"}${RS}` +
      `${DIM}/${ev.max_iter ?? "?"}${RS}`
    );
  }
  if (e === "agent_init") {
    if (lvl < 1) return null;
    const identity: string[] = [];
    if (present(ev.provider)) identity.push(String(ev.provider));
    if (present(ev.model)) identity.push(String(ev.model));
    if (identity.length === 0) identity.push(String(ev.backend ?? "?"));
    const meta: string[] = [];
    if (present(ev.session_id)) meta.push(`session ${String(ev.session_id)}`);
    if (present(ev.schema_version)) meta.push(`schema v${String(ev.schema_version)}`);
    if (present(ev.tools)) meta.push(`${String(ev.tools)} tools`);
    if (present(ev.update)) meta.push("updated");
    const suffix = meta.length > 0 ? ` ${DIM}(${meta.join(", ")})${RS}` : "";
    return `${stamp}  ${G}●${RS} ${DIM}agent up —${RS} ${C}${identity.join(" / ")}${RS}${suffix}`;
  }
  if (e === "agent_tool") {
    if (lvl < 1) return null;
    const name = ev.tool === undefined ? "?" : String(ev.tool);
    const status = ev.status;
    let target = summaryOf(ev, "target", "summary", "targets");
    const [accent, glyphChar] = toolStyle(name, th);
    let lead: string;
    if (status === "progress") {
      lead = `${accent}… ${name}${RS} ${DIM}progress${RS}`;
    } else if (status === "end") {
      const failed = eventBool(ev.is_error);
      lead = failed ? `${BRED}✗ ${name} failed${RS}` : `${BGREEN}✓ ${name} done${RS}`;
      target = summaryOf(ev, "result_summary", "summary", "target");
    } else {
      const lifecycle = status === "start" ? ` ${DIM}start${RS}` : "";
      lead = `${accent}${glyphChar} ${name}${RS}${lifecycle}`;
    }
    const extras: string[] = [];
    if (target !== "") extras.push(`${GRAY}${target}${RS}`);
    if (status === "end" && present(ev.duration_ms))
      extras.push(`${DIM}${fmtMs(ev.duration_ms)}${RS}`);
    return `${stamp}  ${lead}` + (extras.length > 0 ? ` ${extras.join(`${DIM}·${RS} `)}` : "");
  }
  if (e === "agent_text") {
    if (lvl < 2) return null;
    const fragment = eventBool(ev.final_fragment) ? "final" : "partial";
    return `${stamp}  ${GRAY}│${RS} ${DIM}${fragment}${RS} ${ITALIC}${GRAY}${ev.text ?? ""}${RS}`;
  }
  if (e === "evidence_writing") {
    const exact = present(ev.match) ? ev.match : ev.detection_reason;
    const suffix = present(exact) ? ` ${DIM}· ${String(exact)}${RS}` : "";
    return (
      `${stamp}  ${BOLD}${BMAGENTA}↑ evidence being written${RS} ` +
      `${DIM}(${ev.tool ?? "?"} ${ev.target === undefined ? "" : String(ev.target)})${RS}${suffix}`
    );
  }
  if (e === "agent_diagnostic") {
    if (lvl < 1) return null;
    const severity = String(ev.severity ?? "warning").toLowerCase();
    const col = severity === "error" || severity === "fatal" ? BRED : BYELLOW;
    return (
      `${stamp}  ${col}! ${ev.code === undefined ? "diagnostic" : String(ev.code)}${RS} ${DIM}—${RS} ` +
      `${Y}${ev.message ?? ""}${RS}`
    );
  }
  if (e === "agent_observability") {
    if (lvl < 1) return null;
    const mode = ev.mode === undefined ? "?" : String(ev.mode);
    const col = mode === "structured" ? BGREEN : mode === "degraded" ? BRED : BYELLOW;
    const reason = typeof ev.reason === "string" ? ev.reason : "";
    const bits: string[] = [];
    if (present(ev.provider_format)) bits.push(`${C}${String(ev.provider_format)}${RS}`);
    let signals: unknown = present(ev.signals) ? ev.signals : ev.supported_signals;
    if (Array.isArray(signals)) signals = signals.map((one) => String(one)).join(", ");
    if (present(signals)) bits.push(`${DIM}signals: ${String(signals)}${RS}`);
    if (present(ev.role)) bits.push(`${DIM}${String(ev.role)}${RS}`);
    const tail = reason !== "" ? ` ${DIM}—${RS} ${Y}${reason}${RS}` : "";
    const extras = bits.length > 0 ? ` ${DIM}·${RS} ${bits.join(` ${DIM}·${RS} `)}` : "";
    return `${stamp}  ${col}◈ observability ${mode}${RS}${tail}${extras}`;
  }
  if (e === "telemetry_delivery") {
    if (lvl < 1) return null;
    const sink = ev.sink === undefined ? "?" : String(ev.sink);
    const status = String(ev.status ?? "?");
    const failed = !["accepted", "ok", "success"].includes(status);
    if (!failed && lvl < 2) return null;
    const col = failed ? BRED : BGREEN;
    const glyphChar = failed ? "!" : "✓";
    const bits: string[] = [];
    if (present(ev.http_status)) bits.push(`${DIM}HTTP ${String(ev.http_status)}${RS}`);
    if (present(ev.batch_id)) bits.push(`${DIM}${String(ev.batch_id)}${RS}`);
    if (present(ev.event_count)) bits.push(`${DIM}${String(ev.event_count)} events${RS}`);
    const reason = typeof ev.reason === "string" ? ev.reason : "";
    const tail = reason !== "" ? ` ${DIM}—${RS} ${Y}${reason}${RS}` : "";
    const extras = bits.length > 0 ? ` ${DIM}·${RS} ${bits.join(` ${DIM}·${RS} `)}` : "";
    return `${stamp}  ${col}${glyphChar} sink ${sink} ${status}${RS}${tail}${extras}`;
  }
  if (e === "agent_result") {
    if (lvl < 1) return null;
    const status = ev.status;
    const err =
      eventBool(ev.is_error) ||
      (typeof status === "string" &&
        ["error", "timeout", "cancelled", "degraded"].includes(status));
    const label = present(status) ? String(status) : err ? "error" : "success";
    const mark = err ? `${BRED}◦ pass ${label}${RS}` : `${G}◦ pass done${RS}`;
    const bits: string[] = [];
    const costValue = present(ev.cost) ? ev.cost : ev.cost_usd;
    if (present(costValue)) {
      const cost = Number.parseFloat(String(costValue));
      bits.push(
        Number.isFinite(cost)
          ? `${BGREEN}$${cost.toFixed(2)}${RS}`
          : `${BGREEN}$${String(costValue)}${RS}`,
      );
    }
    if (present(ev.output_tokens))
      bits.push(`${BCYAN}${fmtTokens(ev.output_tokens)}${RS}${DIM} tok out${RS}`);
    if (present(ev.input_tokens))
      bits.push(`${BCYAN}${fmtTokens(ev.input_tokens)}${RS}${DIM} tok in${RS}`);
    if (present(ev.duration_ms)) bits.push(`${BYELLOW}${fmtMs(ev.duration_ms)}${RS}`);
    const turns = present(ev.turns) ? ev.turns : ev.num_turns;
    if (present(turns)) bits.push(`${BBLUE}${String(turns)}${RS}${DIM} turns${RS}`);
    const reason = present(ev.reason) ? ev.reason : ev.reason_code;
    if (present(reason)) bits.push(`${Y}${String(reason)}${RS}`);
    if (present(ev.source)) bits.push(`${DIM}${String(ev.source)}${RS}`);
    return (
      `${stamp}  ${mark}` + (bits.length > 0 ? ` ${DIM}·${RS} ${bits.join(` ${DIM}·${RS} `)}` : "")
    );
  }
  if (e === "evidence_written") {
    return (
      `${stamp}  ${BOLD}${BWHITE}◇ evidence${RS} ${DIM}→${RS} ${BWHITE}${ev.file ?? "?"}${RS}  ` +
      `${DIM}(${ev.iters ?? "?"} iter)${RS}`
    );
  }
  if (e === "evidence_present") {
    return `${stamp}  ${BOLD}${BWHITE}◇ evidence present${RS} ${DIM}(resume → critic)${RS}`;
  }
  if (e === "diagnostician_trigger") {
    return (
      `${stamp}  ${BYELLOW}! diagnosing${RS} ${DIM}phase ${p}, after attempt ` +
      `${ev.attempt ?? "?"} — writing a hint for the next pass${RS}`
    );
  }
  if (e === "critic_start") {
    return `${stamp}  ${BWHITE}┿ critic judging${RS} ${DIM}phase ${p}, ${ev.provider ?? "?"}${RS}`;
  }
  if (e === "verdict") {
    const res = ev.result === undefined ? "?" : String(ev.result);
    if (res === "APPROVED") {
      return `${stamp}  ${BOLD}${BGREEN}✓ APPROVED${RS} ${G}phase ${p}${RS}`;
    }
    const reason = typeof ev.reason === "string" ? ev.reason : "";
    const att = ev.attempt === undefined ? "?" : String(ev.attempt);
    const tag = res === "REJECTED" ? "REJECTED" : "MALFORMED";
    const col = res === "REJECTED" ? BRED : BYELLOW;
    const reasonPart = reason !== "" ? ` ${DIM}—${RS} ${Y}${reason}${RS}` : "";
    return (
      `${stamp}  ${BOLD}${col}✗ ${tag}${RS} ${col}phase ${p}${RS} ${DIM}(attempt ${att})${RS}` +
      reasonPart
    );
  }
  if (e === "reject") return null; // already covered by verdict
  if (e === "attempt_archived") {
    return `${stamp}  ${GRAY}↦ archived rejected attempt ${ev.attempt ?? "?"} (phase ${p})${RS}`;
  }
  if (e === "phase_done") {
    return `${stamp}  ${BOLD}${BGREEN}◆ phase ${p} done${RS} ${DIM}(attempt ${ev.attempt ?? "?"})${RS}`;
  }
  if (e === "git_checkpoint") {
    return `${stamp}  ${BBLUE}⎇${RS} ${DIM}git checkpoint (phase ${p})${RS}`;
  }
  if (e === "run_stop") {
    const reason = ev.reason === undefined ? "?" : String(ev.reason);
    if (reason === "stop_flag") {
      return (
        `${stamp}  ${BOLD}${BYELLOW}■ stopped cleanly${RS} ${Y}at phase ${p}${RS} ${DIM}—${RS} ` +
        `resume with: ${BOLD}${BWHITE}specstride resume${RS}`
      );
    }
    return `${stamp}  ${BOLD}${BYELLOW}■ halt${RS} ${DIM}—${RS} ${Y}${reason}${RS} ${DIM}(phase ${p})${RS}`;
  }
  if (e === "run_end") {
    return `${stamp}  ${BOLD}${BGREEN}■ run complete${RS} ${DIM}—${RS} ${G}${ev.outcome ?? "?"}${RS}`;
  }
  if (debug) {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ev)) {
      if (key !== "event" && key !== "time" && key !== "ts") rest[key] = value;
    }
    return `${DIM}${ts}  · ${e} ${dumpsJson(rest)}${RS}`;
  }
  return null;
}

/**
 * `json.dumps` with its defaults: `", "` between items, `": "` after keys and
 * every non-ASCII character escaped — the exact form `--quiet` and `--debug`
 * pass through (C-100).
 */
export function dumpsJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return pyString(value);
  if (Array.isArray(value)) return `[${value.map((one) => dumpsJson(one)).join(", ")}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, one]) => `${pyString(key)}: ${dumpsJson(one)}`,
    );
    return `{${parts.join(", ")}}`;
  }
  return String(value);
}

function pyString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (codePoint < 0x20 || codePoint > 0x7e) {
      if (codePoint > 0xffff) {
        // Python escapes astral planes as a surrogate pair.
        const hi = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800;
        const lo = ((codePoint - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return `${out}"`;
}

/** `str(value)` the way Python writes it inside `key=value` rest lines. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((one) => pyStr(one)).join(", ")}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, one]) => `${pyString(key)}: ${pyStr(one)}`,
    );
    return `{${parts.join(", ")}}`;
  }
  return String(value);
}

/** One `plain` line of `ev` (C-102), the raw RPC view. */
export function plainLine(ev: PresentEvent): string {
  const ts = hhmmss(ev);
  const e = ev.event ?? "";
  if (e === "agent_observability") {
    const mode = ev.mode === undefined ? "?" : String(ev.mode);
    const reason = typeof ev.reason === "string" ? ev.reason : "";
    let tail = `  observability ${mode}`;
    if (reason !== "") tail += ` — ${reason}`;
    const extras = Object.entries(ev)
      .filter(
        ([key]) =>
          !["time", "ts", "event", "task", "backend", "run_id", "mode", "reason"].includes(key),
      )
      .map(([key, value]) => `${key}=${pyStr(value)}`)
      .join(" ");
    if (extras !== "") tail += `  ${extras}`;
    return `${ts}${tail}`;
  }
  const rest = Object.entries(ev)
    .filter(([key]) => !["time", "ts", "event", "task", "backend", "run_id"].includes(key))
    .map(([key, value]) => `${key}=${pyStr(value)}`)
    .join(" ");
  return `${ts}  ${e.padEnd(18)} ${rest}`;
}

/* ───────────────────────────────────────────────────────────────────────────
 *  The theme the presenter resolves for itself (F145-FR-021).
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The colour the presenter runs with (baseline `resolve_theme`): `--no-color`,
 * NO_COLOR and FORCE_COLOR are honored; card mode redraws a screen, so it
 * stays coloured off a terminal unless told not to. The background comes from
 * SPECSTRIDE_BANNER_BG or COLORFGBG — a presenter in the background must
 * never query the terminal itself.
 */
export function resolveTheme(options: {
  mode: Mode;
  noColor: boolean;
  env?: Env;
  stream?: StreamLike;
}): Theme {
  const env = options.env ?? {};
  let arg: string | null = options.noColor ? "never" : null;
  if (arg === null && options.mode === "card" && !env.NO_COLOR) arg = "always";
  const depth = resolveDepth(arg, options.stream, env);
  const bg = detectBg(options.stream, env, () => null);
  return new Theme(depth, bg);
}

/* ───────────────────────────────────────────────────────────────────────────
 *  The presenter call (F145-FR-001, F145-FR-002).
 * ───────────────────────────────────────────────────────────────────────── */

export interface PresenterOptions {
  readonly mode?: string;
  readonly follow?: boolean;
  readonly detail?: string;
  readonly events?: string;
  readonly workdir?: string;
  readonly noColor?: boolean;
  readonly debug?: boolean;
  readonly quiet?: boolean;
}

/** A line sink: everything the presenter prints goes here, never to a run. */
export interface Sink {
  write(text: string): void;
}

/** An in-memory sink for tests and callers that want the text back. */
export function memorySink(): Sink & { text(): string; lines(): string[] } {
  const chunks: string[] = [];
  return {
    write: (text) => chunks.push(text),
    text: () => chunks.join(""),
    lines: () => chunks.join("").split("\n"),
  };
}

/** The shape of the card runner, matching the timeline runner's signature. */
type runCardShape = (
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
  },
) => Promise<void>;

const USAGE_FLAGS =
  "[-h] [--events EVENTS] [--workdir WORKDIR] [--mode {timeline,card,plain}] [--follow] " +
  "[--detail {milestones,tools,full}] [--quiet] [--debug] [--no-color]";

function usageError(
  flagName: string,
  value: string,
  choices: readonly string[],
): {
  exit_code: number;
  stdout: string;
  stderr: string;
} {
  return {
    exit_code: 2,
    stdout: "",
    stderr:
      `usage: specstride presenter ${USAGE_FLAGS}\n` +
      `specstride presenter: error: argument --${flagName}: invalid choice: '${value}' ` +
      `(choose from ${choices.map((one) => `'${one}'`).join(", ")})\n`,
  };
}

/**
 * The internal presenter call (F145-FR-001, F145-FR-002): renders one run's
 * events to `sink` and ends 0 whatever happens — best effort, never on the
 * path of control (F145-FR-001, F145-SC-003). A usage error ends 2. The
 * follow loops end when `signal` ends them.
 */
export async function presenterCall(
  options: PresenterOptions = {},
  sink: Sink = memorySink(),
  context: {
    readonly env?: Env;
    readonly stream?: StreamLike;
    readonly signal?: AbortSignal;
    readonly now?: () => number;
    readonly size?: { cols: number; rows: number };
    /** The card runner, wired by the module entry to keep the tree one-directional. */
    readonly runCard?: runCardShape;
  } = {},
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  const write = (text: string): void => sink.write(text);
  try {
    const mode = options.mode ?? "timeline";
    if (!(MODES as readonly string[]).includes(mode)) return usageError("mode", mode, MODES);
    const env = context.env ?? {};
    const hasFlagDetail = options.detail !== undefined;
    const flagDetail = options.detail ?? env.SPECSTRIDE_LIVE_DETAIL ?? "tools";
    if (!(DETAILS as readonly string[]).includes(flagDetail)) {
      // An invalid SPECSTRIDE_LIVE_DETAIL falls back to `tools` (F145-FR-002);
      // an invalid --detail flag is a usage error with code 2.
      if (hasFlagDetail) return usageError("detail", flagDetail, DETAILS);
    }
    const detail = (DETAILS as readonly string[]).includes(flagDetail) ? flagDetail : "tools";
    const workdir = options.workdir ?? ".";
    const path =
      options.events ??
      `${workdir === "." ? ".specstride" : `${workdir}/.specstride`}/events.jsonl`;
    const th = resolveTheme({
      mode: mode as Mode,
      noColor: options.noColor === true,
      env,
      stream: context.stream,
    });
    const ascii = asciiMode(env);
    const follow = options.follow === true;

    if (options.quiet === true) {
      // C-100: each parsed event back as one JSON line; bad lines skipped.
      for await (const ev of followEventsFile(path, { follow, signal: context.signal })) {
        write(`${dumpsJson(ev)}\n`);
      }
    } else if (mode === "card") {
      const runner = context.runCard;
      if (runner === undefined) throw new Error("the card runner is not wired");
      await runner(path, follow, detail, options.debug === true, th, ascii, write, context);
    } else if (mode === "plain") {
      for await (const ev of followEventsFile(path, { follow, signal: context.signal })) {
        if ((ev.event ?? "") === "_reopen") write("────── new run ──────\n");
        else write(`${plainLine(ev)}\n`);
      }
    } else {
      await runTimeline(path, follow, detail, options.debug === true, th, ascii, write, context);
    }
    return { exit_code: 0, stdout: memoryText(sink), stderr: "" };
  } catch {
    // Best effort (Principle V): a failing presenter never raises, never writes state.
    return { exit_code: 0, stdout: memoryText(sink), stderr: "" };
  }
}

function memoryText(sink: Sink): string {
  const maybe = sink as Sink & { text?: () => string };
  return typeof maybe.text === "function" ? maybe.text() : "";
}

/** The timeline without a live terminal: lines and rails only, no heartbeat (F145-FR-010). */
export async function runTimeline(
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
  const totals = new Totals(context.now);
  const rails = new RailTracker(context.now);
  const railOn = !banner.liveRailOff(context.env ?? {});
  const cols = context.size?.cols ?? 100;
  for await (const ev of followEventsFile(path, { follow, signal: context.signal })) {
    totals.update(ev);
    rails.update(ev);
    const line = narrate(ev, th, detail, debug);
    if (line !== null) write(`${line}\n`);
    if (railOn && rails.stamp !== null) {
      const states = rails.railStates();
      if (states !== null) {
        for (const railLine of liveRailLines(states, cols, th, ascii, rails.tail)) {
          write(`${railLine}\n`);
        }
      }
    }
  }
}
