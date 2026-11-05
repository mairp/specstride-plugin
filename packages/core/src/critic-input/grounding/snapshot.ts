// Feature 117 (T038) — the builder of the grounding snapshot (F117-FR-007,
// F117-FR-008, F117-FR-010, F117-FR-012, F117-FR-020).
//
// The snapshot is the block the critic is given about the files the phase
// evidence cites: one presence line per cited path in the as-is shape, the
// excerpts and budgets of `excerpt.ts`, the cap of presence lines with the
// as-is NOT-SHOWN line, wildcards expanded HERE (never at extraction,
// research D-1), a priority directory expanded into its files only at or
// below 40 files and at most 45 added files in total with build, vendor and
// lock names skipped, the modification times AS THE FILE SYSTEM GIVES THEM
// (F117-FR-020, never coarsened), the NEEDS-GROUNDING line for a declared
// build export that is not on disk, and the refusal line of `refuse.ts` for
// every path the refusal guard refuses (F117-FR-018).
//
// Every file-system call goes through the file-reading port of `ports.ts`.

import { isAbsolute, join, relative } from "node:path";
import literals from "../data/as-is-literals.json" with { type: "json" };
import budgetsData from "../data/budgets.json" with { type: "json" };
import type { FileReadingPort } from "../ports.ts";
import { buildPathList, type PathListInputs } from "./path-list.ts";
import { resolveCitation, resolveContextWithManifests, type ResolveContext } from "./resolve.ts";
import { ExcerptBudget, anchorTokensOf, type Excerpt } from "./excerpt.ts";
import { refusalLine } from "./refuse.ts";

/** The cap of presence lines (F117-FR-008; as-is 80). */
export const PRESENCE_LINE_CAP = budgetsData.presenceLineCap;
/** A directory expands only at or below this many files (F117-FR-012). */
export const DIRECTORY_MAX_FILES = budgetsData.directoryMaxFiles;
/** Expansion is capped at this many added files in total (F117-FR-012). */
export const DIRECTORY_EXPANSION_TOTAL = budgetsData.directoryExpansionTotal;
/** At most this many names on a wildcard line (F117-FR-010). */
export const WILDCARD_NAME_CAP = budgetsData.wildcardNames;
/** A file whose first probe holds a NUL byte is binary (F117-FR-007). */
export const BINARY_PROBE_BYTES = budgetsData.binaryProbeBytes;

/** The as-is names a directory expansion skips (build and vendor directories and lock files). */
export const EXPANSION_SKIP_NAMES: readonly string[] = Object.freeze([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".specstride",
  ".git",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** The as-is lines and heading, byte for byte (`data/as-is-literals.json`). */
export const SNAPSHOT_HEADING = literals.snapshotHeading;
export const SNAPSHOT_INTRO = literals.snapshotIntro;
export const NO_PATHS_BLOCK: readonly [string, string] = [
  literals.noPaths[0]!,
  literals.noPaths[1]!,
];
export const MISSING_LINE = literals.missing;
export const DIRECTORY_LINE = literals.directory;
export const FILE_LINE = literals.file;
export const NEEDS_GROUNDING_LINE = literals.needsGrounding;
export const NOT_SHOWN_LINE = literals.notShown;
export const EXCERPT_OMITTED_LINE = literals.excerptOmitted;

/** One line of the snapshot, in order. */
export interface SnapshotLine {
  readonly kind:
    | "file"
    | "directory"
    | "missing"
    | "needs-grounding"
    | "wildcard"
    | "binary"
    | "unreadable"
    | "refused"
    | "not-shown"
    | "excerpt";
  readonly text: string;
}

/** The grounding snapshot, as the data model of the plan describes it. */
export interface GroundingSnapshot {
  /** The rendered block, without the block framing. */
  readonly text: string;
  /** The presence lines, in order, at most the cap. */
  readonly lines: readonly SnapshotLine[];
  /** Number of paths beyond the cap. */
  readonly notShown: number;
  /** Tokens of the grounding gap (F117-FR-014). */
  readonly gap: readonly string[];
  /** Lines of the ignore probe and of the secret scan (F117-FR-017). */
  readonly probes: readonly string[];
  /** Running total and scaled budget. */
  readonly bytesUsed: number;
  readonly budget: number;
  /** The refusal records; no content (F117-FR-018). */
  readonly refusals: readonly { readonly token: string; readonly root: string }[];
  /** Tokens of the cited paths that did not resolve, at most 20 (F117-FR-015). */
  readonly unresolved: readonly string[];
}

export interface SnapshotInputs extends PathListInputs {
  /** The window of the call, in tokens (0 uses the reference window). */
  readonly windowTokens?: number;
  /** The proofs directory beside the phase evidence, relative to the root. */
  readonly proofsDir?: string;
  /** The directory of the phase evidence, relative to the root. */
  readonly evidenceDir?: string;
  /** The directory of the spec file, where it lies inside the workspace. */
  readonly specDir?: string;
  /** Probe result lines to append under the as-is heading (F117-FR-017). */
  readonly probeLines?: readonly string[];
}

export interface SnapshotContext extends ResolveContext {
  /** The section text, for the anchor tokens (F117-FR-011). */
  readonly sectionText?: string;
}

/** The modification time as the file system gives it, in local time (F117-FR-007, F117-FR-020). */
export function formatMtime(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Best-effort binary kind from the leading bytes (F117-FR-007). */
export function binaryKind(head: Uint8Array): string {
  const b = Buffer.from(head);
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    b.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return `PNG, ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "JPEG";
  const sig6 = b.subarray(0, 6).toString("latin1");
  if (sig6 === "GIF87a" || sig6 === "GIF89a") {
    return b.length >= 10 ? `GIF, ${b.readUInt16LE(6)}x${b.readUInt16LE(8)}` : "GIF";
  }
  if (
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "WEBP";
  }
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return "PDF";
  return "binary data";
}

function readFile(io: FileReadingPort, path: string, limit: number): Uint8Array | undefined {
  const bytes = io.read(path, 0, limit);
  return bytes;
}

/** The files matching a wildcard citation, below the workspace root, sorted. */
function wildcardMatches(token: string, workdir: string, io: FileReadingPort): string[] {
  return io
    .matchBelow(workdir, token)
    .map((m) => (isAbsolute(m) ? m : join(workdir, m)))
    .filter((m) => io.stat(m)?.isFile === true)
    .sort();
}

/** Render one file line in the as-is shape, with the resolved label. */
function filePresenceLine(label: string, size: number, mtimeMs: number): string {
  return FILE_LINE.replace("<path>", label)
    .replace("<bytes>", String(size))
    .replace("<YYYY-MM-DDTHH:MM:SS>", formatMtime(mtimeMs));
}

/** The fenced block of one excerpt. */
function excerptBlock(excerpt: Excerpt): SnapshotLine {
  const fenced =
    "  ```\n" +
    excerpt.text
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n") +
    "\n  ```";
  return { kind: "excerpt", text: fenced };
}

/**
 * Build the grounding snapshot (F117-FR-007 to F117-FR-012, F117-FR-018,
 * F117-FR-020).
 */
export function buildGroundingSnapshot(
  inputs: SnapshotInputs,
  context: SnapshotContext,
): GroundingSnapshot {
  const { workdir, io } = context;
  const entries = buildPathList(inputs, { workdir, io });
  const scoped = resolveContextWithManifests({
    ...context,
    hintText: `${inputs.sectionText ?? ""}\n${inputs.phaseEvidence ?? ""}`,
  });
  const anchors = anchorTokensOf(inputs.sectionText ?? "");
  const budget = new ExcerptBudget(inputs.windowTokens ?? 0);
  const lines: SnapshotLine[] = [];
  const refusals: { token: string; root: string }[] = [];
  const unresolved: string[] = [];
  const gap: string[] = [];
  let shown = 0;
  let notShown = 0;
  let expansionBudget = DIRECTORY_EXPANSION_TOTAL;

  const emitPresence = (line: SnapshotLine): boolean => {
    if (shown >= PRESENCE_LINE_CAP) return false;
    lines.push(line);
    shown++;
    return true;
  };

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (shown >= PRESENCE_LINE_CAP) {
      notShown = entries.length - shown;
      break;
    }

    // The refusal guard first: a refused citation is one line and nothing
    // else — no size, no time, no content, no root (F117-FR-018).
    const resolution = resolveCitation(entry.token, scoped);
    if (resolution.kind === "refused") {
      refusals.push({ token: entry.token, root: resolution.refusedRoot ?? "" });
      if (emitPresence({ kind: "refused", text: refusalLine(entry.token) })) continue;
      notShown = entries.length - shown;
      break;
    }

    // A declared build export that is not on disk is NEEDS-GROUNDING (F117-FR-007).
    if (resolution.kind === "build-export") {
      if (
        emitPresence({
          kind: "needs-grounding",
          text: NEEDS_GROUNDING_LINE.replace("<path>", entry.token),
        })
      ) {
        continue;
      }
      notShown = entries.length - shown;
      break;
    }

    if (resolution.kind === "missing") {
      // A wildcard citation is tried HERE, at snapshot time, and only when
      // the literal path does not resolve (F117-FR-010, research D-1).
      const matches = wildcardMatches(entry.token, workdir, io);
      if (matches.length > 0) {
        const rels = matches.map((m) => relative(workdir, m));
        const names = rels
          .slice(0, WILDCARD_NAME_CAP)
          .map((r) => `\`${r}\``)
          .join(", ");
        const ellipsis = rels.length > WILDCARD_NAME_CAP ? " …" : "";
        if (
          emitPresence({
            kind: "wildcard",
            text: `- \`${entry.token}\` — present: wildcard matches ${rels.length} file(s) on disk: ${names}${ellipsis}`,
          })
        ) {
          continue;
        }
        notShown = entries.length - shown;
        break;
      }
      if (entry.source === "evidence" && !entry.token.includes("/")) continue; // dropped candidate
      unresolved.push(entry.token);
      if (emitPresence({ kind: "missing", text: MISSING_LINE.replace("<path>", entry.token) }))
        continue;
      notShown = entries.length - shown;
      break;
    }

    const realPath = resolution.realPath!;
    const st = io.stat(realPath);
    if (st === undefined) {
      unresolved.push(entry.token);
      if (emitPresence({ kind: "missing", text: MISSING_LINE.replace("<path>", entry.token) }))
        continue;
      notShown = entries.length - shown;
      break;
    }

    // A directory: one line with the number of entries; a priority directory
    // expands into its files (F117-FR-012).
    if (st.isDirectory) {
      const names = io.listDirectory(realPath) ?? [];
      if (
        !emitPresence({
          kind: "directory",
          text: DIRECTORY_LINE.replace("<path>", resolution.label ?? entry.token).replace(
            "<n>",
            String(names.length),
          ),
        })
      ) {
        notShown = entries.length - shown;
        break;
      }
      if (entry.priority && names.length <= DIRECTORY_MAX_FILES) {
        const files = names
          .filter((n) => !EXPANSION_SKIP_NAMES.includes(n))
          .sort()
          .filter((n) => io.stat(join(realPath, n))?.isFile === true);
        for (const name of files) {
          if (expansionBudget <= 0) break;
          const child = relative(workdir, join(realPath, name));
          expansionBudget--;
          const childResolution = resolveCitation(child, scoped);
          if (childResolution.kind === "refused") {
            refusals.push({ token: child, root: childResolution.refusedRoot ?? "" });
            if (emitPresence({ kind: "refused", text: refusalLine(child) })) continue;
            break;
          }
          const childStat = io.stat(join(realPath, name));
          if (childStat === undefined) continue;
          emitFilePresence(child, join(realPath, name), childStat, true);
        }
      }
      continue;
    }

    emitFilePresence(resolution.label ?? entry.token, realPath, st, entry.priority);
  }
  if (shown >= PRESENCE_LINE_CAP && entries.length > shown) notShown = entries.length - shown;
  if (notShown > 0)
    lines.push({ kind: "not-shown", text: NOT_SHOWN_LINE.replace("<n>", String(notShown)) });

  /** One file presence line, its excerpt, and the gap decision. */
  function emitFilePresence(
    label: string,
    realPath: string,
    stat: { size: number; mtimeMs: number },
    priority: boolean,
  ): void {
    if (!emitPresence({ kind: "file", text: filePresenceLine(label, stat.size, stat.mtimeMs) })) {
      notShown++;
      return;
    }
    const bytes = readFile(io, realPath, Math.max(BINARY_PROBE_BYTES, 1));
    if (bytes === undefined) {
      lines.push({ kind: "unreadable", text: "  (could not read: not readable)" });
      return;
    }
    const head = bytes.subarray(0, BINARY_PROBE_BYTES);
    if (head.includes(0)) {
      lines.push({
        kind: "binary",
        text: `- \`${label}\` — binary (${binaryKind(head)}); content not excerpted`,
      });
      return;
    }
    const full = readFile(io, realPath, Math.max(stat.size, BINARY_PROBE_BYTES));
    if (full === undefined) {
      lines.push({ kind: "unreadable", text: "  (could not read: not readable)" });
      return;
    }
    const excerpt = budget.excerptOf({ label, bytes: full, priority }, anchors);
    if (excerpt.kind === "omitted") {
      lines.push({ kind: "excerpt", text: `  ${EXCERPT_OMITTED_LINE}` });
      return;
    }
    lines.push(excerptBlock(excerpt));
  }

  // The grounding gap (F117-FR-014): tokens loosely cited that resolve to
  // files and that the extraction did not return; a directory never is one.
  const extracted = new Set(entries.map((e) => e.token));
  for (const token of looselyCited(inputs.phaseEvidence, inputs.sectionText ?? "")) {
    if (extracted.has(token) || gap.includes(token)) continue;
    const g = resolveCitation(token, scoped);
    if (g.kind === "resolved" && io.stat(g.realPath!)?.isFile === true) gap.push(token);
  }

  const body: string[] = ["", SNAPSHOT_HEADING, SNAPSHOT_INTRO, ""];
  for (const line of lines) body.push(line.text);
  if (entries.length === 0) {
    body.length = 0;
    body.push("", NO_PATHS_BLOCK[0], NO_PATHS_BLOCK[1]);
  }
  if (inputs.probeLines !== undefined && inputs.probeLines.length > 0) {
    body.push("", literals.probeHeading, ...inputs.probeLines);
  }
  if (gap.length > 0) {
    body.push("", literals.gapHeading, literals.gapBody, "");
    for (const token of gap) body.push(literals.gapLine.replace("<token>", token));
  }

  return Object.freeze({
    text: body.join("\n"),
    lines: Object.freeze(lines),
    notShown,
    gap: Object.freeze(gap),
    probes: Object.freeze([...(inputs.probeLines ?? [])]),
    bytesUsed: budget.used,
    budget: budget.budget,
    refusals: Object.freeze(refusals),
    unresolved: Object.freeze(unresolved.slice(0, 20)),
  });
}

/** Tokens loosely cited (F117-FR-014): backticked or slash tokens the strict extractor may have missed. */
function looselyCited(evidence: string, section: string): string[] {
  const out = new Set<string>();
  for (const text of [evidence, section]) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1]!.trim().replace(/[.,:;)]+$/, "");
      if (!token || /\s/.test(token)) continue;
      if (/^(?:https?|ftp):\/\//.test(token)) continue;
      if (!token.includes(".") && !token.includes("/")) continue;
      out.add(token);
    }
  }
  return [...out].sort();
}
