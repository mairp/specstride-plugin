/**
 * The theme (T011): the one source of truth for how Specstride looks in a
 * terminal — colour depth, background and ASCII resolution (F145-FR-012,
 * F145-FR-013, F145-FR-014) and the presenter's colour-off rules
 * (F145-FR-021). A faithful port of the baseline `lib/theme.py` at 9cab15d:
 * the resolution orders, the palette, the quantization and the widths are the
 * baseline's own, so the escape sequences of the port compare byte for byte
 * (F145-SC-001, parity profile). No terminal library: the sequences come from
 * these tables (plan.md, Constraints).
 */

/** The depths the theme resolves to, in override order. */
export const DEPTHS = ["none", "16", "256", "truecolor"] as const;
export type Depth = (typeof DEPTHS)[number];

/** The names a renderer may ask the colour of. */
export const ROLES = ["brand", "accent", "approved", "warn", "reject", "muted"] as const;
export type Role = (typeof ROLES)[number];

/** One palette row: the hex on each background and the 16-colour SGR pair. */
export interface PaletteRow {
  readonly dark: string;
  readonly light: string;
  /** The SGR parameter on a dark background, then on a light one. */
  readonly sixteen: readonly [string, string];
  /** `brand` is ink: terminals get SGR 39 whatever the depth. */
  readonly ink?: boolean;
}

/**
 * The palette of the baseline `lib/theme.py` (B-1421, B-1422, B-1424,
 * B-1425): brand is the terminal's own foreground; muted on light is dim
 * (2), not 90 — some light themes map bright black to near-black.
 */
export const PALETTE: Readonly<Record<Role, PaletteRow>> = Object.freeze({
  brand: Object.freeze({
    dark: "#E8E6DF",
    light: "#1F2328",
    sixteen: ["39", "39"] as [string, string],
    ink: true,
  }),
  accent: Object.freeze({
    dark: "#F07CC0",
    light: "#B0287A",
    sixteen: ["95", "35"] as [string, string],
  }),
  approved: Object.freeze({
    dark: "#4ADE80",
    light: "#1A7F37",
    sixteen: ["32", "32"] as [string, string],
  }),
  warn: Object.freeze({
    dark: "#F5B342",
    light: "#9A5B00",
    sixteen: ["33", "33"] as [string, string],
  }),
  reject: Object.freeze({
    dark: "#FF6B6B",
    light: "#C62828",
    sixteen: ["31", "31"] as [string, string],
  }),
  muted: Object.freeze({
    dark: "#8A93A6",
    light: "#5E6778",
    sixteen: ["90", "2"] as [string, string],
  }),
});

export const RESET = "\x1b[0m";

/** Anything that answers `isatty()`; `process.stdout` and test doubles fit. */
export interface StreamLike {
  readonly isTTY?: boolean;
}

/** A plain record of variables, the shape of `process.env` for the tests. */
export type Env = Readonly<Record<string, string | undefined>>;

function flag(environ: Env, name: string): boolean {
  return Boolean(environ[name] ?? "");
}

function isatty(stream: StreamLike | undefined): boolean {
  try {
    return Boolean(stream?.isTTY);
  } catch {
    return false;
  }
}

function byTerminalDepth(environ: Env): Depth {
  const colorterm = (environ.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if ((environ.TERM ?? "").includes("256color")) return "256";
  return "16";
}

/**
 * The colour depth for `stream` (F145-FR-012), resolved in the baseline's
 * order: an explicit `arg` of `never` or `always`; then `NO_COLOR`; then
 * `FORCE_COLOR`; then a stream that is not a terminal or `TERM=dumb`; then
 * the terminal's own depth; `SPECSTRIDE_COLOR` overrides it all.
 */
export function resolveDepth(arg?: string | null, stream?: StreamLike, environ: Env = {}): Depth {
  const argument = (arg ?? "auto").toLowerCase();
  const term = environ.TERM ?? "";
  let depth: Depth;
  if (argument === "never") depth = "none";
  else if (argument === "always") depth = byTerminalDepth(environ);
  else if (flag(environ, "NO_COLOR")) depth = "none";
  else if (flag(environ, "FORCE_COLOR")) depth = byTerminalDepth(environ);
  else if (!isatty(stream) || term === "dumb") depth = "none";
  else depth = byTerminalDepth(environ);
  const override = (environ.SPECSTRIDE_COLOR ?? "").toLowerCase();
  if ((DEPTHS as readonly string[]).includes(override)) depth = override as Depth;
  return depth;
}

/* ── background ──────────────────────────────────────────────────────────── */

/**
 * The OSC 11 prober, injectable like the baseline's `query` (F145-FR-013).
 * The default here never opens a device: the presenter must never query the
 * terminal itself. The engine's foreground call (feature 145's start-up
 * record, F145-FR-018) is the caller that may pass a real query.
 */
export type Osc11Query = () => "dark" | "light" | null;

/** Never queries: the presenter's own prober (F145-FR-013). */
export const nullQuery: Osc11Query = () => null;

/**
 * `dark` or `light` (F145-FR-013): `SPECSTRIDE_BANNER_BG`, then the last
 * `;` field of `COLORFGBG` (light from 11), then `TMUX` or `STY` (dark, no
 * query), then the query on a terminal, then the `dark` fallback.
 */
export function detectBg(
  stream?: StreamLike,
  environ: Env = {},
  query: Osc11Query = nullQuery,
): "dark" | "light" {
  const value = (environ.SPECSTRIDE_BANNER_BG ?? "").toLowerCase();
  if (value === "dark" || value === "light") return value;
  const fgbg = environ.COLORFGBG ?? "";
  if (fgbg !== "") {
    const last = fgbg.split(";").pop() ?? "";
    if (/^\d+$/.test(last)) return Number.parseInt(last, 10) >= 11 ? "light" : "dark";
  }
  // tmux and screen answer OSC 11 unreliably (or late, into the shell).
  if (environ.TMUX || environ.STY) return "dark";
  try {
    if (isatty(stream)) {
      const got = query();
      if (got === "dark" || got === "light") return got;
    }
  } catch {
    // A failed or refused query falls through to the dark fallback.
  }
  return "dark";
}

/* ── colour ──────────────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.replace(/^#/, "");
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ];
}

const CUBE = [0, 95, 135, 175, 215, 255] as const;

/** The nearest xterm-256 index of an rgb triple (the 6x6x6 cube or the 24-step gray ramp). */
export function to256(rgb: readonly [number, number, number]): number {
  const nearest = (v: number): number => {
    let best = 0;
    for (let i = 1; i < 6; i += 1) {
      if (Math.abs(CUBE[i] - v) < Math.abs(CUBE[best] - v)) best = i;
    }
    return best;
  };
  const ci = [nearest(rgb[0]), nearest(rgb[1]), nearest(rgb[2])];
  const cube: [number, number, number] = [CUBE[ci[0]], CUBE[ci[1]], CUBE[ci[2]]];
  const cubeIndex = 16 + 36 * ci[0] + 6 * ci[1] + ci[2];
  const avg = Math.floor((rgb[0] + rgb[1] + rgb[2]) / 3);
  // Python's round() is banker's rounding; the baseline reads `round(...)`.
  const gi = Math.max(0, Math.min(23, pyRound((avg - 8) / 10)));
  const gray: [number, number, number] = [8 + 10 * gi, 8 + 10 * gi, 8 + 10 * gi];
  const dist = (a: readonly number[]): number =>
    (a[0] - rgb[0]) ** 2 + (a[1] - rgb[1]) ** 2 + (a[2] - rgb[2]) ** 2;
  return dist(cube) <= dist(gray) ? cubeIndex : 232 + gi;
}

/** Round-half-to-even, Python's `round`. */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Role -> escape codes for one (depth, bg) (F145-FR-012). Every method
 * returns plain text when the depth is `none`.
 */
export class Theme {
  readonly depth: Depth;
  readonly bg: "dark" | "light";
  readonly on: boolean;

  constructor(depth: string = "16", bg: string = "dark") {
    this.depth = ((DEPTHS as readonly string[]).includes(depth) ? depth : "16") as Depth;
    this.bg = bg === "light" ? "light" : "dark";
    this.on = this.depth !== "none";
  }

  /** The SGR parameter that opens `role`. */
  sgr(role: Role): string {
    if (!this.on) return "";
    const spec = PALETTE[role];
    if (spec.ink) return "\x1b[39m";
    if (this.depth === "16") return `\x1b[${spec.sixteen[this.bg === "dark" ? 0 : 1]}m`;
    const rgb = hexToRgb(spec[this.bg]);
    if (this.depth === "256") return `\x1b[38;5;${to256(rgb)}m`;
    return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  }

  get reset(): string {
    return this.on ? RESET : "";
  }

  get bold(): string {
    return this.on ? "\x1b[1m" : "";
  }

  /** The italic the presenter's `agent_text` lines use. */
  get italic(): string {
    return this.on ? "\x1b[3m" : "";
  }

  paint(role: Role, text: string): string {
    if (!this.on || text === "") return text;
    return this.sgr(role) + text + RESET;
  }
}

/** Resolves depth and background together (the baseline's `theme_for`). */
export function themeFor(
  arg?: string | null,
  stream?: StreamLike,
  environ: Env = {},
  bg?: "dark" | "light",
): Theme {
  const depth = resolveDepth(arg, stream, environ);
  if (depth === "none") return new Theme("none", bg ?? "dark");
  return new Theme(depth, bg ?? detectBg(stream, environ));
}

/* ── glyphs ──────────────────────────────────────────────────────────────── */

/** name -> (unicode, ascii). Every glyph here is one column wide. */
export const THEME_GLYPHS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  track: ["━", "="] as const,
  ahead: ["╍", "-"] as const,
  gate: ["┿", "+"] as const,
  tip: ["╸", ">"] as const,
  end: ["╸", "-"] as const,
  approved: ["✓", "ok"] as const,
  rejected: ["✗", "x"] as const,
  current: ["•", ">"] as const,
  pending: ["·", "."] as const,
  times: ["×", "x"] as const,
  divider: ["┄", "-"] as const,
  arrow: ["→", "->"] as const,
  prompt: ["›", ">"] as const,
  quote: ["│", "|"] as const,
});

/** Explicit display widths: there is no wcwidth in the runtime, so this table is the contract. */
const WIDTH: Readonly<Record<string, number>> = Object.fromEntries(
  "━╍┿╸╺┏┓┗┛┃✓✗•·×┄→›│◆⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("").map((ch) => [ch, 1]),
);

// The escapes are the point: this regex strips ANSI CSI/OSC sequences.
// eslint-disable-next-line no-control-regex -- matches literal ESC bytes by design
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\u0007\x1b]*(?:\u0007|\x1b\\)/g;

/** Strips every CSI and OSC sequence. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** East-asian wide and fullwidth ranges, as `unicodedata.east_asian_width` names them. */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fffd) ||
    (codePoint >= 0x30000 && codePoint <= 0x3fffd)
  );
}

function isCombining(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x0483 && codePoint <= 0x0489) ||
    (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
    (codePoint >= 0x0610 && codePoint <= 0x061a) ||
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    (codePoint >= 0x0e31 && codePoint <= 0x0e3a) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20f0) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

/** The columns `text` occupies once its escape sequences are gone. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (WIDTH[ch] !== undefined) width += WIDTH[ch];
    else if (isCombining(codePoint)) continue;
    else if (isWide(codePoint)) width += 2;
    else width += 1;
  }
  return width;
}

/**
 * True when glyphs must be pure ASCII (F145-FR-014): `SPECSTRIDE_ASCII` set
 * to anything but empty or `0`, or `LC_ALL`, else `LC_CTYPE`, else `LANG`
 * non-empty without `utf8` or `utf-8`.
 */
export function asciiMode(environ: Env = {}): boolean {
  const flagValue = environ.SPECSTRIDE_ASCII ?? "";
  if (flagValue !== "" && flagValue !== "0") return true;
  const locale = environ.LC_ALL ?? environ.LC_CTYPE ?? environ.LANG ?? "";
  if (locale === "") return false;
  return !/utf-?8/i.test(locale);
}

export const hexToRgbPort = hexToRgb;

/** The glyph of a name in the chosen set; an unknown name reads as itself. */
export function glyph(name: string, ascii = false): string {
  const entry = THEME_GLYPHS[name];
  if (entry === undefined) return name;
  return ascii ? entry[1] : entry[0];
}

/* ── the `theme bg` call ─────────────────────────────────────────────────── */

/** The result record of an internal call (annex A §A.2): the as-is exit code. */
export interface CallResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The internal call `theme bg` (F145-FR-013): prints `dark` or `light` once,
 * treating the stream as interactive when standard input or standard error
 * is a terminal; any other argument gives code 1 with the baseline's usage
 * line, the logical component name in place of the script name.
 */
export function themeBgCall(
  argv: readonly string[],
  options: {
    readonly stdinIsTTY?: boolean;
    readonly stderrIsTTY?: boolean;
    readonly environ?: Env;
    readonly query?: Osc11Query;
  } = {},
): CallResult {
  if (argv.length !== 1 || argv[0] !== "bg") {
    return { exit_code: 1, stdout: "", stderr: "usage: theme bg\n" };
  }
  const interactive: StreamLike = {
    get isTTY() {
      return Boolean(options.stdinIsTTY || options.stderrIsTTY);
    },
  };
  const bg = detectBg(interactive, options.environ ?? {}, options.query ?? nullQuery);
  return { exit_code: 0, stdout: `${bg}\n`, stderr: "" };
}
