/**
 * The tables of the presenter (T002): every literal line, glyph, ASCII
 * substitution and colour code of the baseline is DATA here; the code of the
 * later tasks (theme.ts, banner.ts, presenter.ts) only evaluates the tables.
 * covers: F145-FR-003; F145-FR-004; F145-FR-005; F145-FR-010; F145-FR-012;
 * F145-FR-014. No terminal library: escape sequences come from these tables
 * (plan.md, Constraints; research.md DV-3).
 */

/** One glyph of the presentation, with its ASCII substitution (F145-FR-014). */
export interface GlyphEntry {
  /** The Unicode form printed by default. */
  readonly unicode: string;
  /** The ASCII form used when ASCII is on (F145-FR-014). */
  readonly ascii: string;
}

/**
 * The glyph table (F145-FR-014). The substitutions are fixed by the spec:
 * track `=`, ahead `-`, gate `+`, tip `>`, approved `ok`, rejected `x`,
 * current `>`, pending `.`, times `x`, arrow `->`.
 */
export const GLYPHS: Readonly<Record<string, GlyphEntry>> = Object.freeze({
  track: Object.freeze({ unicode: "━", ascii: "=" }),
  ahead: Object.freeze({ unicode: "»", ascii: "-" }),
  gate: Object.freeze({ unicode: "┿", ascii: "+" }),
  tip: Object.freeze({ unicode: "▸", ascii: ">" }),
  approved: Object.freeze({ unicode: "✓", ascii: "ok" }),
  rejected: Object.freeze({ unicode: "✗", ascii: "x" }),
  current: Object.freeze({ unicode: "●", ascii: ">" }),
  pending: Object.freeze({ unicode: "○", ascii: "." }),
  times: Object.freeze({ unicode: "×", ascii: "x" }),
  arrow: Object.freeze({ unicode: "→", ascii: "->" }),
});

/** The names of every glyph, in table order. */
export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));

/**
 * The glyph of a name in the glyph set chosen by `ascii`.
 * An unknown name is a caller bug and reads as the plain name.
 */
export function glyphOf(name: string, ascii: boolean): string {
  const entry = GLYPHS[name];
  if (entry === undefined) return name;
  return ascii ? entry.ascii : entry.unicode;
}

/**
 * The ASCII substitutions as a flat name → ASCII map (F145-FR-014), the shape
 * the theme applies to rendered text when ASCII is on.
 */
export const ASCII_SUBSTITUTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(GLYPHS).map(([name, entry]) => [name, entry.ascii])),
);

/**
 * True when the environment asks for ASCII (F145-FR-014): `SPECSTRIDE_ASCII`
 * set to anything but empty or `0`, or `LC_ALL`, else `LC_CTYPE`, else `LANG`
 * non-empty without `utf8` or `utf-8`. (The theme resolves it; the rule lives
 * with the table so that the table and its trigger are one deliverable.)
 */
export function asciiWanted(env: Readonly<Record<string, string | undefined>>): boolean {
  const flag = env.SPECSTRIDE_ASCII;
  if (flag !== undefined && flag !== "" && flag !== "0") return true;
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? "";
  if (locale === "") return false;
  const lowered = locale.toLowerCase();
  return !(lowered.includes("utf8") || lowered.includes("utf-8"));
}

/** One colour role of the theme (F145-FR-012). */
export interface ColourRole {
  /** The SGR parameter on a dark background, 16-colour depth. */
  readonly dark: string;
  /** The SGR parameter on a light background, 16-colour depth. */
  readonly light: string;
  /** The reference hex colour for the 256 and truecolor depths; null for `brand`, which uses the terminal's own foreground. */
  readonly hex: string | null;
}

/**
 * The colour roles and their codes (F145-FR-012): accent 95/35,
 * approved 32/32, warn 33/33, reject 31/31, muted 90/2; `brand` uses the
 * terminal's own foreground (code 39).
 */
export const COLOUR_ROLES: Readonly<Record<string, ColourRole>> = Object.freeze({
  brand: Object.freeze({ dark: "39", light: "39", hex: null }),
  accent: Object.freeze({ dark: "95", light: "35", hex: "#c678dd" }),
  approved: Object.freeze({ dark: "32", light: "32", hex: "#98c379" }),
  warn: Object.freeze({ dark: "33", light: "33", hex: "#e5c07b" }),
  reject: Object.freeze({ dark: "31", light: "31", hex: "#e06c75" }),
  muted: Object.freeze({ dark: "90", light: "2", hex: "#5c6370" }),
});

/** The names of every colour role, in table order. */
export const COLOUR_ROLE_NAMES = Object.freeze(Object.keys(COLOUR_ROLES));

/** The reference hex of a role for quantization; null for `brand` (code 39). */
export function roleHex(role: string): string | null {
  return COLOUR_ROLES[role]?.hex ?? null;
}

/** The 16-colour SGR parameter of a role for a background. */
export function roleCode16(role: string, background: "dark" | "light"): string {
  const entry = COLOUR_ROLES[role];
  if (entry === undefined) return "39";
  return background === "light" ? entry.light : entry.dark;
}

/** A tool glyph row: the glyph and whether the role renders muted (F145-FR-010). */
export interface ToolGlyph {
  readonly glyph: string;
  readonly muted: boolean;
}

/**
 * The tool glyphs by tool name, lowercased (F145-FR-010). The task-list tools
 * render muted. `mcp__` names and the fallback are handled by `toolGlyph`.
 */
export const TOOL_GLYPHS: Readonly<Record<string, ToolGlyph>> = Object.freeze({
  read: Object.freeze({ glyph: "◎", muted: false }),
  write: Object.freeze({ glyph: "✚", muted: false }),
  edit: Object.freeze({ glyph: "✎", muted: false }),
  multiedit: Object.freeze({ glyph: "✎", muted: false }),
  notebookedit: Object.freeze({ glyph: "✎", muted: false }),
  bash: Object.freeze({ glyph: "❯", muted: false }),
  grep: Object.freeze({ glyph: "❍", muted: false }),
  glob: Object.freeze({ glyph: "❍", muted: false }),
  ls: Object.freeze({ glyph: "❍", muted: false }),
  task: Object.freeze({ glyph: "»", muted: false }),
  agent: Object.freeze({ glyph: "»", muted: false }),
  webfetch: Object.freeze({ glyph: "⇆", muted: false }),
  websearch: Object.freeze({ glyph: "⇆", muted: false }),
  todowrite: Object.freeze({ glyph: "≡", muted: true }),
  todoread: Object.freeze({ glyph: "≡", muted: true }),
  taskcreate: Object.freeze({ glyph: "≡", muted: true }),
  taskupdate: Object.freeze({ glyph: "≡", muted: true }),
  tasklist: Object.freeze({ glyph: "≡", muted: true }),
  taskget: Object.freeze({ glyph: "≡", muted: true }),
});

/** The glyph of a tool name (F145-FR-010), case-insensitive. */
export function toolGlyph(tool: string): ToolGlyph {
  const lowered = tool.toLowerCase();
  if (lowered.startsWith("mcp__")) return { glyph: "◇", muted: false };
  return TOOL_GLYPHS[lowered] ?? { glyph: "›", muted: false };
}

/**
 * The timeline line of each milestone event (F145-FR-003), as data. A token
 * `<name>` reads the event field `name`; a missing field reads `?`. The
 * `_reopen` line is emitted by the follower, never read from the file, and
 * prints without a timestamp.
 */
export const TIMELINE_LINES: Readonly<Record<string, string>> = Object.freeze({
  _reopen: "── new run detected — following it ──",
  run_start: "┏ run start — <phases> phases · <proposer>→<critic> · resume @ phase <resume>",
  phase_start: "◆ phase <phase>/<total><title>",
  proposer_start: "✱ proposer working — phase <p>, attempt <attempt>, <backend>",
  accelerator_start:
    "✚ accelerator acting on the hint — phase <p>, attempt <attempt>, <backend><criteria>",
  acceleration_note: "↦ acceleration note written (phase <p>, attempt <n>)",
  iter_start: "↻ pass <iter>/<max_iter>",
  evidence_writing: "↑ evidence being written (<tool> <target>)<match>",
  evidence_written: "◇ evidence → <file>  (<iters> iter)",
  evidence_present: "◇ evidence present (resume → critic)",
  diagnostician_trigger:
    "! diagnosing phase <p>, after attempt <n> — writing a hint for the next pass",
  attempt_archived: "↦ archived rejected attempt <attempt> (phase <p>)",
  phase_done: "◆ phase <p> done (attempt <n>)",
  git_checkpoint: "⎇ git checkpoint (phase <p>)",
  run_stop: "■ halt — <reason> (phase <p>)",
  run_end: "■ run complete — <outcome>",
  critic_start: "┿ critic judging phase <p>, <provider>",
});

/** The verdict lines by verdict result (F145-FR-005). */
export const VERDICT_LINES: Readonly<Record<string, string>> = Object.freeze({
  APPROVED: "✓ APPROVED phase <p>",
  REJECTED: "✗ REJECTED phase <p> (attempt <n>)<reasonClause>",
  MALFORMED: "✗ MALFORMED phase <p> (attempt <n>)",
});

/** The events the timeline consumes and never prints verbatim (F145-FR-005). */
export const CONSUMED_EVENTS: readonly string[] = Object.freeze(["reject"]);

/** The milestone events of the plain mode's timestamped listing (F145-FR-006). */
export const PLAIN_OMITTED_KEYS: readonly string[] = Object.freeze([
  "time",
  "ts",
  "event",
  "task",
  "backend",
  "run_id",
]);

/** The plain-mode line printed when the followed link is retargeted (F145-FR-006). */
export const PLAIN_REOPEN_LINE = "────── new run ──────";

/** The synthetic quiet-mode event object on a retarget (F145-FR-006). */
export const QUIET_REOPEN_EVENT = Object.freeze({ event: "_reopen" });

/** The plain line of an `agent_observability` event (F145-FR-006). */
export const PLAIN_OBSERVABILITY_PREFIX = "observability";

/** The run-stop line when the reason is the stop flag (F145-FR-003). */
export const RUN_STOP_CLEAN_LINE =
  "■ stopped cleanly at phase <p> — resume with: specstride resume";

/** The fields an `agent_tool` line reads, by status (F145-FR-004), as data. */
export const AGENT_TOOL_LINES: Readonly<Record<string, string>> = Object.freeze({
  progress: "… <tool> progress",
  done: "✓ <tool> done<summary>",
  failed: "✗ <tool> failed<summary>",
  start: "<glyph> <tool> start<target>",
  other: "<glyph> <tool><target>",
});

/** The `agent_text` lines at detail `full` (F145-FR-004). */
export const AGENT_TEXT_LINES: Readonly<Record<string, string>> = Object.freeze({
  final: "│ final <text>",
  partial: "│ partial <text>",
});

/** The `agent_diagnostic` line (F145-FR-004). */
export const AGENT_DIAGNOSTIC_LINE = "! <code> — <message>";

/** The `agent_observability` line (F145-FR-004). */
export const AGENT_OBSERVABILITY_LINE = "◈ observability <mode><reason>";

/** The `telemetry_delivery` lines, success and failure (F145-FR-004). */
export const TELEMETRY_DELIVERY_LINES: Readonly<Record<string, string>> = Object.freeze({
  ok: "✓ sink <sink> <status><detail>",
  failed: "! sink <sink> <status><detail>",
});

/** The `agent_result` line (F145-FR-004). */
export const AGENT_RESULT_LINE = "◦ pass <status><detail>";

/** The `agent_init` line (F145-FR-004). */
export const AGENT_INIT_LINE = "● agent up — <provider><detail>";

/** The separator between the parts of an agent line (F145-FR-004). */
export const AGENT_PART_SEPARATOR = " · ";

/**
 * The statuses of an `agent_result` that count as an error (F145-FR-004).
 */
export const AGENT_RESULT_ERROR_STATUSES: readonly string[] = Object.freeze([
  "error",
  "timeout",
  "cancelled",
  "degraded",
]);

/** The telemetry statuses that count as delivered (F145-FR-004). */
export const TELEMETRY_OK_STATUSES: readonly string[] = Object.freeze([
  "accepted",
  "ok",
  "success",
]);

/** The observability modes and their colour roles (F145-FR-004). */
export const OBSERVABILITY_ROLE_BY_MODE: Readonly<Record<string, string>> = Object.freeze({
  structured: "approved",
  degraded: "reject",
});

/** The role of every other observability mode (F145-FR-004). */
export const OBSERVABILITY_DEFAULT_ROLE = "warn";

/** The diagnostic severities that render red; every other severity is yellow (F145-FR-004). */
export const DIAGNOSTIC_ERROR_SEVERITIES: readonly string[] = Object.freeze(["error", "fatal"]);

/** The default terminal size when it cannot be detected (F145-FR-010). */
export const DEFAULT_COLUMNS = 100;
/** The default terminal height when it cannot be detected (F145-FR-010). */
export const DEFAULT_ROWS = 24;

/**
 * True when an event value reads as true (F145-FR-010): `true` or one of the
 * strings `1`, `true`, `yes`, `error`, `failed`, `failure`, case-insensitive.
 */
export function isTruthyValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "error", "failed", "failure"].includes(value.toLowerCase());
}

/**
 * The timestamp of an event (F145-FR-010): the 8 characters after `T` of the
 * event's `time`, else the local time of `ts`, else `--:--:--`.
 */
export function timestampOf(event: Readonly<Record<string, unknown>>): string {
  const time = event.time;
  if (typeof time === "string" && time.includes("T")) {
    const stamp = time.slice(time.indexOf("T") + 1, time.indexOf("T") + 9);
    if (stamp.length === 8) return stamp;
  }
  const ts = event.ts;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) return localClock(date);
  }
  if (typeof ts === "string" && ts !== "") {
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) return localClock(date);
  }
  return "--:--:--";
}

function localClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * A token count as `<n>`, `<n.n>k` from 1,000 and `<n.n>M` from 1,000,000
 * (F145-FR-010).
 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/**
 * A duration as `<s>s`, `<m>m<ss>s` or `<h>h<mm>m` (F145-FR-010).
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  if (whole < 3600) {
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;
    return `${minutes}m${String(rest).padStart(2, "0")}s`;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

/**
 * The timeline text of one milestone event (F145-FR-003): reads the template
 * of the table and fills every `<name>` token from the event's fields, with
 * `?` for a missing field. `run_stop` branches on its `reason`
 * (stop_flag prints the clean line); `verdict` events take `VERDICT_LINES`
 * by their result (F145-FR-005). An unknown event has no line: the caller
 * prints nothing unless `--debug` (data-model.md, validation rules).
 */
export function renderTimelineLine(
  event: string,
  fields: Readonly<Record<string, unknown>>,
): string | null {
  if (event === "verdict") {
    const result = fields.result;
    const name =
      typeof result === "string" && VERDICT_LINES[result] !== undefined ? result : "MALFORMED";
    return fill(VERDICT_LINES[name], fields);
  }
  if (event === "run_stop") {
    if (fields.reason === "stop_flag") return fill(RUN_STOP_CLEAN_LINE, fields);
    return fill(TIMELINE_LINES.run_stop, fields);
  }
  const template = TIMELINE_LINES[event];
  if (template === undefined) return null;
  return fill(template, fields);
}

/**
 * Fills one template: every `<name>` token reads the field `name`; a missing
 * field reads `?`. An empty auxiliary token (`<title>`, `<criteria>`,
 * `<match>`, `<reason>`, `<summary>`, `<target>`, `<detail>`) reads as the
 * empty string so that the fixed text around it stays well formed; the token
 * `<reasonClause>` renders ` — <reason>` only when a reason exists.
 */
function fill(template: string, fields: Readonly<Record<string, unknown>>): string {
  return template.replace(/<([A-Za-z_][A-Za-z0-9_]*)>/g, (whole, name: string) => {
    if (AUXILIARY_TOKENS.has(name)) {
      if (name === "reasonClause") {
        const reason = fields.reason;
        return reason === undefined || reason === null || reason === ""
          ? ""
          : ` — ${String(reason)}`;
      }
      const value = fields[name];
      if (value === undefined || value === null || value === "") return "";
      return String(value);
    }
    const value = fields[name];
    return value === undefined || value === null ? "?" : String(value);
  });
}

/** Tokens that read as the empty string when absent, never as `?`. */
const AUXILIARY_TOKENS: ReadonlySet<string> = new Set([
  "title",
  "criteria",
  "match",
  "reason",
  "summary",
  "target",
  "detail",
  "reasonClause",
]);
