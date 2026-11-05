// Feature 117 — the read-only grounding snapshot (extraction, resolution,
// snapshot, gap). Extracted from the Lisa baseline at `363e6a3`
// (packages/core/src/critic/grounding.ts) and brought to the behaviour of
// F117-FR-003 to F117-FR-012 before any characterization test is written
// (F117-FR-009). Every difference from Lisa is listed, with its reason, in
// LISA-ALIGNMENT.md beside this file.
//
// Read-only throughout: stat, bounded reads, one fixed-argv `git ls-files`
// fallback. No shell, no network, no model call.

import { basename, isAbsolute, join, relative, sep } from "node:path";

// ── the file-system port (F100-FR-012) ───────────────────────────────────────
// A core package reads no file itself: every file-system call of the grounding
// pass goes through this port, implemented by the kernel services and the edge
// packages (`node:fs` is a core-forbidden import). The tests of
// `packages/core/test/critic-input/grounding.test.ts` carry a Node adapter.

/** Everything the grounding pass needs from the file system, read-only. */
export interface GroundingIo {
  /** The real path of an existing file or directory, or undefined. */
  realpath(path: string): string | undefined;
  /** The stat of a path, or undefined when it does not exist. */
  stat(
    path: string,
  ): { isDirectory: boolean; isFile: boolean; size: number; mtimeMs: number } | undefined;
  /** Sorted names of a directory, or undefined when it is not readable. */
  listDir(path: string): string[] | undefined;
  /**
   * A bounded read of a file: the first `headBytes` bytes and, for a file longer
   * than `threshold` bytes, the last `tailBytes` bytes. The result is the head,
   * the tail, and the size; undefined when the file cannot be read.
   */
  readHeadTail(
    path: string,
    headBytes: number,
    tailBytes: number,
    threshold: number,
  ): { head: Uint8Array; tail: Uint8Array; size: number } | undefined;
  /** The files matching a wildcard pattern, or an empty list. */
  glob(pattern: string): string[];
  /** The bounded repository inventory (tracked and untracked, non-ignored). */
  repositoryFiles(workdir: string): string[];
}

// ── as-is numbers (contracts/budgets.json — the single data source) ─────────
import budgetsData from "../data/budgets.json" with { type: "json" };

export const BUDGETS = budgetsData;

/** Hard cap on presence lines (one per cited path). F117-FR-008/F117-FR-009. */
export const GROUNDING_MAX_FILES: number = BUDGETS.presenceLineCap;
/** Extraction stops after three times the cap of candidates per text. F117-FR-003. */
export const GROUNDING_EXTRACTION_FACTOR: number = BUDGETS.extractionCapFactor;
/** Brace shorthand expands into at most this many alternatives per citation. F117-FR-003. */
export const GROUNDING_BRACE_EXPANSIONS: number = BUDGETS.braceExpansions;
/** A wildcard presence line names at most this many files. F117-FR-010. */
export const GROUNDING_WILDCARD_NAMES: number = BUDGETS.wildcardNames;
/** Head-and-tail excerpt bytes. F117-FR-011. */
export const GROUNDING_HEAD_BYTES: number = BUDGETS.headBytes;
export const GROUNDING_TAIL_BYTES: number = BUDGETS.tailBytes;
export const GROUNDING_HEAD_TAIL_THRESHOLD: number = BUDGETS.headTailThresholdBytes;
/** A file whose first probe holds a NUL byte is binary. F117-FR-007. */
export const GROUNDING_BINARY_PROBE_BYTES: number = BUDGETS.binaryProbeBytes;
/** A priority directory expands into its files only at or below this many files. F117-FR-012. */
export const GROUNDING_DIRECTORY_MAX_FILES: number = BUDGETS.directoryMaxFiles;
export const GROUNDING_DIRECTORY_EXPANSION_TOTAL: number = BUDGETS.directoryExpansionTotal;

// ── citation extraction (strict) — F117-FR-003 ───────────────────────────────
const PATH_RE = new RegExp(
  "`([^`\\n]+)`" +
    "|(?<![\\w/])((?:\\./|/)?[\\w.\\-]+(?:/[\\w.\\-]+)+)" +
    "|(?<![\\w./])(\\.?[\\w\\-]+\\.[A-Za-z][\\w]{0,11})(?![\\w.-])" +
    "|(?<![\\w./])(\\.[A-Za-z][\\w\\-]{1,})(?![\\w.-])",
  "g",
);

/** Line locators stripped before resolution: `x.py:101`, `x.py:10-20`, `x.py:12:5`, `x.py#L12-L20`, `test_x.py::test_y`. */
const LOCATOR_RE = /(?::\d+|::\d+:\d+|#L\d+(?:-L\d+)?|::[A-Za-z0-9_]+)$/;

/** A leading ellipsis prefix is stripped before resolution. */
const ELLIPSIS_PREFIX_RE = /^(?:\u2026|\.\.\.)\s*/;

const TRAILING_RE = /[.,:;)]+$/;
const SCHEME_RE = /^(?:https?|ftp):\/\//;
/** `@v` followed by a digit is a version tag of an RPC method, not a path. */
const VERSION_TAG_RE = /@v\d/;

export function extractPaths(evidenceText: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const stop = GROUNDING_MAX_FILES * GROUNDING_EXTRACTION_FACTOR;
  for (const m of evidenceText.matchAll(PATH_RE)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    const quoted = m[1] !== undefined;
    for (let cand of expandBraceCitation(raw)) {
      cand = cand
        .replace(ELLIPSIS_PREFIX_RE, "")
        .replace(LOCATOR_RE, "")
        .trim()
        .replace(TRAILING_RE, "");
      if (!cand) continue;
      if (SCHEME_RE.test(cand)) continue;
      if (/\s/.test(cand)) continue;
      if (VERSION_TAG_RE.test(cand)) continue;
      const hasSlash = cand.includes("/");
      let looksPath: boolean;
      if (!hasSlash && cand.startsWith(".")) {
        // A bare leading-dot token is a dotfile only when the character after the
        // dot is a lower-case letter, with an optional extension of 1 to 11 chars.
        looksPath = /^\.[a-z][\w-]*(\.[A-Za-z0-9]{1,11})?$/.test(cand);
      } else {
        // Any other token counts as a path only when it ends in an extension of
        // 2 to 12 characters that starts with a letter, or is a slash path with a
        // segment that has an extension.
        const hasExt = /\.[A-Za-z][A-Za-z0-9]{1,11}$/.test(cand);
        looksPath =
          hasExt || (hasSlash && /\/[\w.-]+\.[A-Za-z]/.test(cand)) || (quoted && hasSlash);
      }
      if (!looksPath) continue;
      if (!seen.has(cand)) {
        seen.add(cand);
        out.push(cand);
      }
      if (out.length >= stop) break;
    }
    if (out.length >= stop) break;
  }
  return out;
}

/** Brace shorthand `{a,b}` expands into each alternative, at most 16 per citation. */
export function expandBraceCitation(raw: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(raw);
  if (!match) return [raw];
  const items = match[2]!
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0 || items.length > GROUNDING_BRACE_EXPANSIONS) return [raw];
  return items.map((item) => `${match[1]}${item}${match[3]}`);
}

// ── resolution — F117-FR-005, F117-FR-006 ────────────────────────────────────
export type CitationResolutionKind =
  "resolved" | "missing" | "ambiguous" | "unresolved" | "placeholder";

export interface CitationResolution {
  kind: CitationResolutionKind;
  path?: string;
  matches?: string[];
  detail: string;
}

/** A placeholder citation `<...>` of 1 to 40 characters without a slash. */
const PLACEHOLDER_RE = /^<[^<>/\n]{1,40}>$/;

/**
 * Search directories, in the as-is order of F117-FR-005: the workspace root, the
 * proofs directory beside the phase evidence, the directory of the phase evidence,
 * `out`, every immediate subdirectory of those two, and the directory of the spec
 * file. The caller passes the relative names; the root comes first.
 */
export function groundingSearchDirs(
  io: GroundingIo,
  proofsDir?: string,
  evidenceDir?: string,
  specDir?: string,
): string[] {
  const dirs = [""];
  for (const d of [proofsDir, evidenceDir, "out", specDir]) {
    if (d !== undefined && !dirs.includes(d)) dirs.push(d);
  }
  for (const d of [proofsDir, evidenceDir]) {
    if (d === undefined) continue;
    const entries = io.listDir(d);
    if (entries === undefined) continue;
    for (const name of [...entries].sort()) {
      const sub = join(d, name);
      if (!dirs.includes(sub)) dirs.push(sub);
    }
  }
  return dirs;
}

/** Resolve an existing path only when its real target stays inside the workspace root. */
function resolveInsideWorkdir(
  candidate: string,
  workdir: string,
  io: GroundingIo,
): string | undefined {
  const root = io.realpath(workdir);
  const full = io.realpath(candidate);
  if (root === undefined || full === undefined) return undefined;
  const rel = relative(root, full);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    return full;
  }
  return undefined;
}

function safeIsDir(p: string, io: GroundingIo): boolean {
  return io.stat(p)?.isDirectory === true;
}

/** A relative citation that leaves the workspace root after normalization never resolves. */
function escapesWorkspace(p: string): boolean {
  const resolved = relative(".", join(".", p));
  return resolved === ".." || resolved.startsWith(`..${sep}`) || isAbsolute(resolved);
}

export function resolveCitedDetailed(
  p: string,
  workdir: string,
  searchDirs: readonly string[],
  io: GroundingIo,
  repositoryFiles: readonly string[] = io.repositoryFiles(workdir),
): CitationResolution {
  // An absolute citation is honoured as it is, workspace or not (F117-FR-006);
  // the refusal test of F117-FR-018 is applied by the caller before printing.
  if (isAbsolute(p)) {
    if (p.startsWith(workdir + sep)) {
      const direct = resolveInsideWorkdir(p, workdir, io);
      if (direct !== undefined)
        return { kind: "resolved", path: direct, detail: "exact absolute path" };
    }
    return { kind: "resolved", path: p, detail: "absolute path honoured as cited" };
  }
  if (PLACEHOLDER_RE.test(p)) {
    const pattern = p.slice(1, -1);
    const entries = [...(io.listDir(workdir) ?? [])].sort();
    // Only the placeholder is a wildcard; the first match in sorted order wins.
    const re = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : `\\${ch}`)) + "$",
    );
    const hit = entries.find((name) => re.test(name));
    if (hit !== undefined) {
      const full = resolveInsideWorkdir(join(workdir, hit), workdir, io);
      if (full !== undefined)
        return { kind: "placeholder", path: full, detail: "placeholder pattern match" };
    }
    return { kind: "missing", detail: "placeholder matched nothing on disk" };
  }
  if (escapesWorkspace(p)) {
    return { kind: "missing", detail: "relative citation leaves the workspace root" };
  }
  const direct = resolveInsideWorkdir(join(workdir, p), workdir, io);
  if (direct !== undefined)
    return { kind: "resolved", path: direct, detail: "exact workspace path" };

  const base = basename(p.replace(/\/+$/, ""));
  for (const d of searchDirs) {
    const cand = resolveInsideWorkdir(join(workdir, d, base), workdir, io);
    if (cand !== undefined)
      return { kind: "resolved", path: cand, detail: `search dir ${d || "."}` };
  }
  if (p.includes("/")) {
    return { kind: "missing", detail: "explicit workspace-relative path does not exist" };
  }
  const matches = new Set<string>();
  for (const rel of repositoryFiles) {
    if (basename(rel) !== base) continue;
    const cand = resolveInsideWorkdir(join(workdir, rel), workdir, io);
    if (cand !== undefined) matches.add(cand);
  }
  if (matches.size === 1) {
    const only = matches.values().next().value as string;
    return { kind: "resolved", path: only, detail: "unique repository basename" };
  }
  if (matches.size > 1) {
    return {
      kind: "ambiguous",
      matches: [...matches].map((match) => relative(workdir, match)).sort(),
      detail: `ambiguous basename (${matches.size} on-disk matches)`,
    };
  }
  // F117-FR-003: a token without a slash that does not resolve on disk is dropped —
  // the caller filters this kind out of the path list. A slash path is always kept.
  return { kind: "unresolved", detail: "bare basename does not resolve on disk" };
}

export function resolveCited(
  p: string,
  workdir: string,
  searchDirs: readonly string[],
  io: GroundingIo,
  repositoryFiles?: readonly string[],
): string | undefined {
  return resolveCitedDetailed(p, workdir, searchDirs, io, repositoryFiles).path;
}

// ── the grounding snapshot — F117-FR-007 to F117-FR-012 ─────────────────────
export interface SnapshotLine {
  kind:
    | "file"
    | "directory"
    | "missing"
    | "needs-grounding"
    | "wildcard"
    | "binary"
    | "unreadable"
    | "not-shown";
  text: string;
}

export interface GroundingSnapshot {
  lines: SnapshotLine[];
  notShown: number;
}

export const SNAPSHOT_HEADING = "## Grounding snapshot (verified by the critic, read-only)";
export const SNAPSHOT_INTRO =
  "The following is the ACTUAL on-disk state of files the evidence cites.\n" +
  "Claims about files that do not exist, are empty, or contradict this snapshot are NOT substantiated — weigh them accordingly.";
export const NEEDS_GROUNDING_LINE =
  "- `<path>` — **NEEDS-GROUNDING** (declared build export not found on disk; the " +
  "build likely did not run — treat as a build-output gap, NOT as an unmet criterion; " +
  "do not reject on this alone)";
export const NOT_SHOWN_LINE =
  "- … (<n> further cited path(s) omitted: presence-line cap reached — omission here " +
  "means NOT-SHOWN, it does NOT mean the file is missing from disk)";
export const MISSING_LINE = "- `<path>` — **MISSING** (does not exist on disk)";
export const EXCERPT_OMITTED_LINE =
  "(content excerpt omitted — grounding byte budget reached; file verified present above)";
export const HEAD_TAIL_JOIN = "… (truncated) …";

/** Wildcards are never expanded at extraction; they are tried here, at snapshot time. */
function wildcardMatches(p: string, workdir: string, io: GroundingIo): string[] {
  if (!/[*?[]/.test(p)) return [];
  return io.glob(join(workdir, p)).filter((m) => io.stat(m)?.isFile === true);
}

export function groundingSnapshot(
  paths: readonly string[],
  workdir: string,
  searchDirs: readonly string[],
  io: GroundingIo,
  repositoryFiles?: readonly string[],
): GroundingSnapshot {
  const repoFiles = repositoryFiles ?? io.repositoryFiles(workdir);
  const lines: SnapshotLine[] = [];
  let notShown = 0;
  let shown = 0;
  for (const p of paths) {
    // Only the presence-line cap ends the loop. A path beyond the cap is NOT-SHOWN,
    // never MISSING (F117-FR-008, F117-FR-009).
    if (shown >= GROUNDING_MAX_FILES) {
      notShown = paths.length - shown;
      break;
    }
    // F117-FR-010: a wildcard citation is tried when the literal path does not resolve.
    const resolution = resolveCitedDetailed(p, workdir, searchDirs, io, repoFiles);
    if (resolution.kind !== "resolved" && /[*?[]/.test(p)) {
      const matches = wildcardMatches(p, workdir, io);
      if (matches.length > 0) {
        const rels = matches.map((m) => relative(workdir, m));
        lines.push({
          kind: "wildcard",
          text:
            `- \`${p}\` — present: wildcard matches ${rels.length} file(s) on disk: ` +
            rels
              .slice(0, GROUNDING_WILDCARD_NAMES)
              .map((r) => `\`${r}\``)
              .join(", ") +
            (rels.length > GROUNDING_WILDCARD_NAMES ? " …" : ""),
        });
        shown++;
        continue;
      }
    }
    // A bare token without a slash that does not resolve is dropped (F117-FR-003);
    // a slash path is always kept.
    if (resolution.kind === "unresolved" && !p.includes("/")) continue;
    if (resolution.kind === "unresolved" || resolution.kind === "missing") {
      lines.push({ kind: "missing", text: MISSING_LINE.replace("<path>", p) });
      shown++;
      continue;
    }
    if (resolution.kind === "ambiguous") {
      lines.push({ kind: "missing", text: MISSING_LINE.replace("<path>", p) });
      shown++;
      continue;
    }
    const full = resolution.path as string;
    const st = io.stat(full);
    if (st === undefined) {
      lines.push({ kind: "missing", text: MISSING_LINE.replace("<path>", p) });
      shown++;
      continue;
    }
    const rel = relative(workdir, full);
    const disp = isAbsolute(p) || p === rel || rel.startsWith("..") ? p : rel;
    if (st.isDirectory) {
      const n = io.listDir(full)?.length ?? "?";
      lines.push({ kind: "directory", text: `- \`${disp}\` — directory, ${n} entries` });
      shown++;
      continue;
    }
    const mtime = formatLocalMtime(st.mtimeMs);
    const range = io.readHeadTail(
      full,
      GROUNDING_HEAD_BYTES,
      GROUNDING_TAIL_BYTES,
      GROUNDING_HEAD_TAIL_THRESHOLD,
    );
    if (range === undefined) {
      lines.push({
        kind: "file",
        text: `- \`${disp}\` — exists, ${st.size} bytes, mtime ${mtime}`,
      });
      lines.push({ kind: "unreadable", text: "  (could not read: not readable)" });
      shown++;
      continue;
    }
    const head = Buffer.from(range.head);
    const tail = Buffer.from(range.tail);
    if (head.includes(0)) {
      const { kind, dims } = sniffBinary(head);
      const desc = dims ? `${kind}, ${dims}` : kind;
      lines.push({
        kind: "binary",
        text: `- \`${disp}\` — exists, ${st.size} bytes, mtime ${mtime} — binary (${desc}); content not excerpted`,
      });
      shown++;
      continue;
    }
    lines.push({ kind: "file", text: `- \`${disp}\` — exists, ${st.size} bytes, mtime ${mtime}` });
    shown++;
    let excerpt = decodeReplace(head);
    if (tail.length > 0) excerpt += "\n" + HEAD_TAIL_JOIN + "\n" + decodeReplace(tail);
    const block =
      "  ```\n" +
      excerpt
        .split("\n")
        .map((l) => "  " + l)
        .join("\n") +
      "\n  ```";
    lines.push({ kind: "file", text: block });
  }
  if (notShown > 0) {
    lines.push({ kind: "not-shown", text: NOT_SHOWN_LINE.replace("<n>", String(notShown)) });
  }
  return { lines, notShown };
}

/** Render the snapshot block byte for byte in the as-is shape. */
export function renderSnapshot(snapshot: GroundingSnapshot): string {
  const out: string[] = ["", SNAPSHOT_HEADING, SNAPSHOT_INTRO, ""];
  for (const line of snapshot.lines) out.push(line.text);
  return out.join("\n");
}

// ── the grounding gap — F117-FR-014 ─────────────────────────────────────────
const LOOSE_RE = new RegExp(
  "`([^`\\n]+)`" + "|(?<![\\w./])((?:\\./|/)?\\.?[\\w.\\-]+(?:/[\\w.\\-]+)*)",
  "g",
);

function looseCitations(evidenceText: string): Set<string> {
  const out = new Set<string>();
  for (const m of evidenceText.matchAll(LOOSE_RE)) {
    const cand = (m[1] ?? m[2] ?? "").trim().replace(TRAILING_RE, "");
    if (!cand || /\s/.test(cand)) continue;
    if (SCHEME_RE.test(cand)) continue;
    if (!cand.includes(".") && !cand.includes("/")) continue;
    out.add(cand);
  }
  return out;
}

/** Tokens loosely cited that the strict extractor did not return and that resolve to files. */
export function groundingGap(
  evidenceText: string,
  grounded: Iterable<string>,
  workdir: string,
  searchDirs: readonly string[],
  io: GroundingIo,
  repositoryFiles?: readonly string[],
): string[] {
  const repoFiles = repositoryFiles ?? io.repositoryFiles(workdir);
  const groundedSet = new Set(grounded);
  const gap: string[] = [];
  for (const c of [...looseCitations(evidenceText)].sort()) {
    if (groundedSet.has(c)) continue;
    const resolved = resolveCited(c, workdir, searchDirs, io, repoFiles);
    if (resolved !== undefined && !safeIsDir(resolved, io)) gap.push(c);
  }
  return gap;
}

// ── small pure helpers ───────────────────────────────────────────────────────
function decodeReplace(buf: Buffer): string {
  // eslint-disable-next-line no-control-regex
  return buf.toString("utf8").replace(/\x00/g, "\uFFFD");
}

function formatLocalMtime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Best-effort (kind, dims) from a file's leading bytes — no image library. F117-FR-007. */
export function sniffBinary(head: Buffer): { kind: string; dims: string } {
  if (
    head.length >= 24 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    head.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    const w = head.readUInt32BE(16);
    const h = head.readUInt32BE(20);
    return { kind: "PNG", dims: `${w}x${h}` };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: "JPEG", dims: "" };
  }
  const sig6 = head.subarray(0, 6).toString("latin1");
  if (sig6 === "GIF87a" || sig6 === "GIF89a") {
    if (head.length >= 10) {
      return { kind: "GIF", dims: `${head.readUInt16LE(6)}x${head.readUInt16LE(8)}` };
    }
    return { kind: "GIF", dims: "" };
  }
  if (
    head.subarray(0, 4).toString("latin1") === "RIFF" &&
    head.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { kind: "WEBP", dims: "" };
  }
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return { kind: "PDF", dims: "" };
  return { kind: "binary data", dims: "" };
}

/** Sorted names of a directory, through the port (for the expansion rule of F117-FR-012). */
export function directoryEntries(dir: string, io: GroundingIo): string[] {
  return [...(io.listDir(dir) ?? [])].sort();
}
