// Feature 117 (T035) — the path list of the grounding pass (F117-FR-004,
// F117-FR-013).
//
// The list is built in the AS-IS order of sources: the paths of the proofs
// directory beside the phase evidence (`gate:<N>:proofs`, read as claims)
// first and as priority paths, then the paths carried by the feedback of the
// phase attempt before (`NEEDS-GROUNDING:` marks, at most 12, priority), then
// the paths extracted from the phase evidence, then the paths of the phase
// section, then the directories the section names. Extraction is capped, the
// phase evidence is read up to 60000 characters, and the block of inherited
// verification obligations is left OUT of the extraction of priority paths,
// of directories and of anchors (F117-FR-004).
//
// Every file-system call goes through the file-reading port of `ports.ts`.

import { join, relative } from "node:path";
import budgetsData from "../data/budgets.json" with { type: "json" };
import {
  EXTRACTION_CAP,
  extractCitations,
  formOf,
  type Citation,
  type CitationSource,
} from "./extract.ts";
import type { FileReadingPort } from "../ports.ts";

/** The phase evidence is read up to this many characters (F117-FR-004). */
export const EVIDENCE_MAX_CHARS = budgetsData.evidenceMaxChars;

/** At most this many carried paths join the path list (F117-FR-013). */
export const CARRIED_PATH_CAP = budgetsData.carriedPaths;

/** The marker a truncated phase evidence carries (F117-FR-004). */
export const EVIDENCE_TRUNCATION_MARK = "… (evidence truncated) …";

/** The mark of a carried path in the feedback of the phase attempt before. */
const CARRIED_MARK_RE = /NEEDS-GROUNDING:\s*`?([^\s`]+)/g;

/**
 * The heading of the block of inherited verification obligations inside the
 * phase section. Everything from this heading to the next `###` heading (or
 * the end of the section) is INHERITED text: it stays in the prompt and is
 * left out of the extraction of priority paths, of directories and of
 * anchors (F117-FR-004).
 */
export const INHERITED_OBLIGATIONS_HEADING = "### Inherited obligations";

/** The phase evidence, cut at the as-is length, with the marker when cut. */
export function truncateEvidence(evidence: string): { text: string; truncated: boolean } {
  if (evidence.length <= EVIDENCE_MAX_CHARS) return { text: evidence, truncated: false };
  return {
    text: evidence.slice(0, EVIDENCE_MAX_CHARS) + "\n" + EVIDENCE_TRUNCATION_MARK,
    truncated: true,
  };
}

/** The section without the inherited-obligations block (F117-FR-004). */
export function sectionWithoutInheritedObligations(section: string): string {
  const at = section.indexOf(INHERITED_OBLIGATIONS_HEADING);
  if (at === -1) return section;
  const from = section.indexOf("\n### ", at);
  return from === -1 ? section.slice(0, at) : section.slice(0, at) + section.slice(from + 1);
}

/** True when the path stays inside the workspace root after normalization. */
function insideWorkspace(path: string, workdir: string): boolean {
  const rel = relative(workdir, path);
  return rel !== "" && !rel.startsWith("..");
}

/**
 * The backticked tokens of the section that name a DIRECTORY inside the
 * workspace (F117-FR-004: "Backticked tokens of the section that name a
 * directory inside the workspace MUST be added as directories").
 */
export function sectionDirectories(
  section: string,
  workdir: string,
  io: FileReadingPort,
): string[] {
  const out: string[] = [];
  const scoped = sectionWithoutInheritedObligations(section);
  for (const m of scoped.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1]!.trim();
    if (!token || token.includes("*") || token.includes("?")) continue;
    const full = join(workdir, token);
    if (!insideWorkspace(full, workdir)) continue;
    if (io.stat(full)?.isDirectory === true && !out.includes(token)) out.push(token);
  }
  return out;
}

/** The carried paths of the feedback: `NEEDS-GROUNDING:` marks that resolve to FILES, at most 12 (F117-FR-013). */
export function carriedPaths(feedback: string, workdir: string, io: FileReadingPort): string[] {
  const out: string[] = [];
  for (const m of feedback.matchAll(CARRIED_MARK_RE)) {
    if (out.length >= CARRIED_PATH_CAP) break;
    const token = m[1]!.trim();
    if (!token || out.includes(token)) continue;
    const stat = io.stat(join(workdir, token));
    if (stat?.isFile === true) out.push(token);
  }
  return out;
}

/** One entry of the path list, with its source and its priority. */
export interface PathEntry extends Citation {
  /** True when the path lies under the proofs directory of the phase evidence. */
  readonly fromProofsDir: boolean;
  /** True when the path lies under the proofs directory of the phase evidence. */
  readonly isDirectory: boolean;
}

export interface PathListInputs {
  /** The phase evidence of the attempt (read up to 60000 characters). */
  readonly phaseEvidence: string;
  /** The section of the phase in the canonical spec model. */
  readonly sectionText: string;
  /** The proofs directory beside the phase evidence, relative to the root, when it exists. */
  readonly proofsDir?: string;
  /** The feedback of the phase attempt before, when there is one. */
  readonly feedbackText?: string;
}

export interface PathListContext {
  /** The workspace root. */
  readonly workdir: string;
  readonly io: FileReadingPort;
}

/**
 * The path list in the as-is order of sources (F117-FR-004): the proofs
 * directory first and as priority, then the carried paths (priority), then
 * the phase evidence, then the phase section, then the directories of the
 * section. A path of the proofs directory, a carried path and — where the
 * section names no path of its own — every path of the phase evidence are
 * priority paths.
 */
export function buildPathList(inputs: PathListInputs, context: PathListContext): PathEntry[] {
  const { workdir, io } = context;
  const out: PathEntry[] = [];
  const seen = new Set<string>();
  const push = (
    token: string,
    source: CitationSource,
    priority: boolean,
    fromProofsDir = false,
    isDirectory = false,
  ): void => {
    if (seen.has(token)) {
      const at = out.findIndex((e) => e.token === token);
      if (at !== -1 && priority && !out[at]!.priority) {
        out[at] = { ...out[at]!, priority: true };
      }
      return;
    }
    seen.add(token);
    out.push({ token, source, priority, form: formOf(token), fromProofsDir, isDirectory });
    if (out.length >= EXTRACTION_CAP) return;
  };

  // 1. The proofs directory beside the phase evidence, first, as priority
  //    (F117-FR-004): every FILE of it, sorted, read as claims.
  if (inputs.proofsDir !== undefined) {
    const proofs = join(workdir, inputs.proofsDir);
    const entries = io.listDirectory(proofs);
    if (entries !== undefined) {
      for (const name of [...entries].sort()) {
        push(join(inputs.proofsDir, name), "evidence", true, true, false);
      }
    }
  }

  // 2. The carried paths of the feedback (F117-FR-013), at most 12, priority.
  if (inputs.feedbackText !== undefined) {
    for (const token of carriedPaths(inputs.feedbackText, workdir, io)) {
      push(token, "carried", true);
    }
  }

  // 3. The phase evidence first (F117-FR-004), read up to 60000 characters.
  const evidence = truncateEvidence(inputs.phaseEvidence).text;
  for (const citation of extractCitations(evidence, "evidence")) {
    push(citation.token, "evidence", false);
  }

  // 4. The phase section second. Its paths are the priority paths; where it
  //    names none, every path of the phase evidence stays priority.
  const scopedSection = sectionWithoutInheritedObligations(inputs.sectionText);
  const sectionCitations = extractCitations(scopedSection, "section");
  const sectionNamesPaths = sectionCitations.some((c) => c.token.includes("/"));
  for (const citation of sectionCitations) {
    push(citation.token, "section", true);
  }
  if (!sectionNamesPaths) {
    for (const entry of out) {
      if (entry.source === "evidence" && !entry.isDirectory) {
        out[out.indexOf(entry)] = { ...entry, priority: true };
      }
    }
  }

  // 5. The directories of the section (F117-FR-004).
  for (const dir of sectionDirectories(scopedSection, workdir, io)) {
    push(dir, "directory", true, false, true);
  }
  return out.slice(0, EXTRACTION_CAP);
}
