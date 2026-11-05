// Feature 117 (T040) — the deterministic probes of the grounding pass
// (F117-FR-017).
//
// The grounding pass NEVER executes a command of the project. The only
// process it starts is the check of the version-control tool whether a path
// is ignored, with a FIXED argument list, through the process port of
// `ports.ts`, with a time limit of 10 seconds and a fallback to an exact
// match of the base name in the ignore file. It runs ONLY when the section
// or the phase evidence mentions `gitignore`. The secret scan runs ONLY when
// they mention `secret`; it scans files of configuration shape (not the
// environment file itself, not ignored files, at most 512 KB) at most two
// directory levels deep, skipping state, vendor and output directories, and
// its result line names the variable and NEVER the value. Result lines are
// appended under the as-is heading
// `## Deterministic probe results (harness-computed, not LLM)`.

import { basename, join, relative, sep } from "node:path";
import budgetsData from "../data/budgets.json" with { type: "json" };
import type { FileReadingPort, ProcessPort } from "../ports.ts";

/** The time limit of the ignore probe, in seconds (F117-FR-017). */
export const IGNORE_PROBE_TIMEOUT_SEC = budgetsData.ignoreProbeTimeoutSec;
export const IGNORE_PROBE_TIMEOUT_MS = IGNORE_PROBE_TIMEOUT_SEC * 1000;
/** The secret scan reads at most this many bytes per file. */
export const SECRET_SCAN_MAX_BYTES = budgetsData.secretScanMaxBytes;
/** The secret scan descends at most this many directory levels. */
export const SECRET_SCAN_DEPTH = budgetsData.secretScanDepth;

/** The probe results are appended under this as-is heading. */
export const PROBE_HEADING = "## Deterministic probe results (harness-computed, not LLM)";

/** The word that switches the ignore probe on (F117-FR-17 runs only on mention). */
const IGNORE_PROBE_TRIGGER = /gitignore/;
/** The word that switches the secret scan on. */
const SECRET_SCAN_TRIGGER = /secret/;

/** Files of configuration shape the secret scan reads. */
const CONFIG_SHAPES: readonly string[] = Object.freeze([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".config",
  ".conf",
]);

/** Directories the secret scan skips (state, vendor and output directories). */
const SECRET_SCAN_SKIP: readonly string[] = Object.freeze([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".specstride",
  "vendor",
]);

/** True when the ignore probe runs for these texts (F117-FR-017). */
export function shouldRunIgnoreProbe(texts: readonly string[]): boolean {
  return texts.some((t) => IGNORE_PROBE_TRIGGER.test(t));
}

/** True when the secret scan runs for these texts (F117-FR-017). */
export function shouldRunSecretScan(texts: readonly string[]): boolean {
  return texts.some((t) => SECRET_SCAN_TRIGGER.test(t));
}

/** The fixed argument list of the ignore probe: tool, subcommands, path. */
export function ignoreProbeArgv(tool: string, path: string): readonly [string, ...string[]] {
  return [tool, "check-ignore", "--", path];
}

/** The cited environment files inside the workspace, example files excluded; else the default one. */
export function environmentFilesUnderProbe(
  citedTokens: readonly string[],
  workdir: string,
  io: FileReadingPort,
): string[] {
  const cited = citedTokens.filter((token) => {
    if (token.includes("example")) return false;
    const base = basename(token);
    return base.startsWith(".env") || base === "gitignore" || base === ".gitignore";
  });
  if (cited.length > 0) return cited;
  const defaults = [".gitignore", ".ignore"];
  return defaults.filter((name) => io.stat(join(workdir, name)) !== undefined);
}

export interface IgnoreProbeOutcome {
  /** The result lines, in the as-is shape. */
  readonly lines: readonly string[];
  /** True when the version-control probe ran (false means the fallback decided). */
  readonly ranProcess: boolean;
}

/**
 * The ignore probe (F117-FR-017): for every environment file under probe,
 * the fixed-argument check of the version-control tool through the process
 * port, with the as-is time limit of 10 seconds; where it cannot run, an
 * exact match of the base name in the ignore file decides. Lines:
 * `<path> — IGNORED: PASS (<how>)`, `<path> — NOT ignored: FAIL (<how>)` or
 * `gitignore status UNKNOWN (<why>)`.
 */
export function runIgnoreProbe(
  citedTokens: readonly string[],
  context: {
    readonly workdir: string;
    readonly io: FileReadingPort;
    readonly process?: ProcessPort;
    readonly tool?: string;
  },
): IgnoreProbeOutcome {
  const lines: string[] = [];
  let ranProcess = false;
  const targets = environmentFilesUnderProbe(citedTokens, context.workdir, context.io);
  const ignoreFile = targets.find(
    (t) => basename(t) === ".gitignore" || basename(t) === "gitignore",
  );
  const ignoreNames =
    ignoreFile !== undefined
      ? new TextDecoder("utf-8", { fatal: false })
          .decode(context.io.read(join(context.workdir, ignoreFile), 0, 262144) ?? new Uint8Array())
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "" && !l.startsWith("#"))
      : [];
  for (const target of targets) {
    const base = basename(target);
    if (context.process !== undefined) {
      ranProcess = true;
      const result = context.process.probe(ignoreProbeArgv(context.tool ?? "git", target));
      if (result.timedOut) {
        lines.push(
          `gitignore status UNKNOWN (${base}: probe passed its limit of ${IGNORE_PROBE_TIMEOUT_SEC} seconds)`,
        );
        continue;
      }
      if (result.code === 0) {
        lines.push(`${target} — IGNORED: PASS (version-control check)`);
        continue;
      }
      if (result.code === 1) {
        lines.push(`${target} — NOT ignored: FAIL (version-control check)`);
        continue;
      }
      lines.push(`gitignore status UNKNOWN (${base}: probe exited ${result.code})`);
      continue;
    }
    // The fallback: an exact match of the base name in the ignore file.
    if (ignoreNames.includes(base)) {
      lines.push(`${target} — IGNORED: PASS (exact match in ${ignoreFile})`);
    } else {
      lines.push(`${target} — NOT ignored: FAIL (exact match in ${ignoreFile})`);
    }
  }
  return { lines, ranProcess };
}

/** A finding of the secret scan: the VARIABLE, never the value (F117-FR-017). */
export interface SecretFinding {
  readonly file: string;
  readonly variable: string;
}

const SECRET_ASSIGNMENT_RE =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(?!\s*$)(?!\s*["']?\s*["']?\s*$).+$/;

/** The files of configuration shape at most two levels deep, skipping state, vendor and output directories. */
export function secretScanFiles(workdir: string, io: FileReadingPort): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > SECRET_SCAN_DEPTH) return;
    const entries = io.listDirectory(dir);
    if (entries === undefined) return;
    for (const name of [...entries].sort()) {
      if (SECRET_SCAN_SKIP.includes(name)) continue;
      const full = join(dir, name);
      const st = io.stat(full);
      if (st === undefined) continue;
      if (st.isDirectory) {
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile) continue;
      if (name.startsWith(".env")) continue; // not the environment file itself (F117-FR-017)
      if (CONFIG_SHAPES.some((shape) => name.endsWith(shape))) out.push(full);
    }
  };
  walk(workdir, 0);
  return out;
}

/**
 * The secret scan (F117-FR-017): assignments of upper-case variables with a
 * non-empty value in files of configuration shape. The result line names the
 * variable and never the value.
 */
export function runSecretScan(context: {
  readonly workdir: string;
  readonly io: FileReadingPort;
}): { lines: readonly string[]; findings: readonly SecretFinding[] } {
  const findings: SecretFinding[] = [];
  for (const file of secretScanFiles(context.workdir, context.io)) {
    const st = context.io.stat(file);
    if (st === undefined || st.size > SECRET_SCAN_MAX_BYTES) continue;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      context.io.read(file, 0, SECRET_SCAN_MAX_BYTES) ?? new Uint8Array(),
    );
    for (const line of text.split("\n")) {
      const m = SECRET_ASSIGNMENT_RE.exec(line);
      if (m === null) continue;
      findings.push({ file: relative(context.workdir, file), variable: m[1]! });
    }
  }
  const lines = findings.map(
    (f) => `- ${f.file}: variable ${f.variable} holds a non-empty value (value not shown)`,
  );
  return { lines, findings };
}

/** The probe lines of one grounding pass, in order, under their heading. */
export function probeLines(
  inputs: { readonly texts: readonly string[]; readonly citedTokens: readonly string[] },
  context: {
    readonly workdir: string;
    readonly io: FileReadingPort;
    readonly process?: ProcessPort;
  },
): string[] {
  const lines: string[] = [];
  if (shouldRunIgnoreProbe(inputs.texts)) {
    lines.push(...runIgnoreProbe(inputs.citedTokens, context).lines);
  }
  if (shouldRunSecretScan(inputs.texts)) {
    lines.push(...runSecretScan(context).lines);
  }
  return lines;
}

/** True when a path stays below `root` (defence in depth for the scan). */
export function staysBelowRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return !rel.startsWith("..") && !rel.includes(sep + "..");
}
