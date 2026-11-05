/**
 * T027 of feature 140 — the INVENTORY SUMMARY: the renderer, its budget rule
 * and the atomic write (F140-FR-025).
 *
 * The summary is the part of the inventory a PROPOSER reads, so it is capped
 * at `reverse.contextBudget` CHARACTERS (24,000 by default). The cap bites in
 * one place only: the per-file table at the end. Project facts — the
 * manifests, the entry points, the workspaces, the units and the skipped
 * entries — are never dropped, because a run that silently lost them would
 * describe a tree it never saw. When rows are dropped the summary SAYS SO and
 * names the full inventory, so a reader always knows the table is partial.
 *
 * The budget is counted in Python's `len`, which is CODE POINTS. JavaScript's
 * `String.prototype.length` is UTF-16 units and would admit fewer rows for a
 * tree with astral characters in its paths, so the count here is by code
 * point and is carried incrementally rather than recomputed per row.
 *
 * Every file the inventory writes goes through the atomic write of
 * `@specstride/kernel` (F140-FR-025, F100-FR-036): a temporary name in the
 * same directory, `fsync`, then the rename. No reader ever sees half a
 * summary or half an inventory.
 */
import { basename } from "node:path";

import { atomicWrite } from "@specstride/kernel/atomic-write";

import type { Inventory } from "./document.ts";
import { DEFAULT_CONTEXT_BUDGET } from "./limits.ts";
import type { JsonValue } from "./serialize.ts";
import { serializeJson } from "./serialize.ts";

/** The characters of a manifest's facts the summary quotes (F140-FR-025). */
export const MANIFEST_FACTS_CUT = 600;

/**
 * The headroom the row loop keeps for the drop note and the final line end
 * (F140-FR-025: "until the text, the row and 200 characters would exceed the
 * budget").
 */
export const ROW_HEADROOM = 200;

/** The number of CODE POINTS of a string, as Python's `len` counts them. */
export function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** The first `limit` code points of a string. */
function cut(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

/**
 * The facts of one manifest as the summary quotes them: every key but
 * `manifest` and `kind`, as sorted-key JSON, cut to 600 characters. The cut is
 * by code point, as Python's slice of a `str` is.
 */
export function manifestFactsText(manifest: Readonly<Record<string, JsonValue>>): string {
  const rest: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === "manifest" || key === "kind") continue;
    rest[key] = value;
  }
  return cut(
    serializeJson(rest, { sortKeys: true, ensureAscii: true, separators: [", ", ": "] }),
    MANIFEST_FACTS_CUT,
  );
}

/**
 * The head of the summary: everything but the file table (F140-FR-025). The
 * title, the introduction, the eight bullets and the five sections, in the
 * order the requirement fixes them.
 */
export function summaryHead(inventory: Inventory, jsonPath: string): readonly string[] {
  const project = inventory.project;
  const specify = inventory.specify;
  const languages = Object.entries(project.languages)
    .map(([language, count]) => `${language} (${count})`)
    .join(", ");
  const head: string[] = [
    `# Inventory — ${basename(inventory.src)}`,
    "",
    `Deterministic, LLM-free inventory of \`${inventory.src}\` (walk: ${inventory.walk}). It is` +
      ` the ground truth for **what exists**. The full record, with every file's hash, is` +
      ` \`${jsonPath}\`.`,
    "",
    `- Files: ${inventory.totals.files} text (${inventory.totals.lines} lines,` +
      ` ${inventory.totals.text_bytes} bytes); ${inventory.totals.skipped} skipped`,
    `- Oversize: ${inventory.oversize ? "yes" : "no"} (limit` +
      ` ${inventory.limits.max_total_bytes} bytes of text)`,
    `- git HEAD: ${inventory.git_head ?? "not a git work tree"}`,
    `- Fingerprint: \`${inventory.fingerprint}\``,
    `- Languages: ${languages === "" ? "none" : languages}`,
    `- Frameworks: ${project.frameworks.length === 0 ? "none detected" : project.frameworks.join(", ")}`,
    `- Existing Spec Kit: ${specify.present ? "yes" : "no"}; constitution` +
      ` ${specify.constitution ? "present" : "absent"}; specs` +
      ` ${specify.spec_numbers.length === 0 ? "none" : specify.spec_numbers.map((n) => String(n).padStart(3, "0")).join(", ")}`,
    "",
    "## Manifests",
    "",
  ];
  for (const manifest of project.manifests) {
    head.push(
      `- \`${String(manifest["manifest"])}\` (${String(manifest["kind"])}): ${manifestFactsText(manifest)}`,
    );
  }
  if (project.manifests.length === 0) head.push("- none");
  head.push("", "## Entry points", "");
  if (project.entry_points.length === 0) {
    head.push("- none detected");
  } else {
    for (const entry of project.entry_points) {
      const manifest = entry.manifest === undefined ? "" : ` (${entry.manifest})`;
      head.push(`- ${entry.kind}: \`${entry.target}\`${manifest}`);
    }
  }
  head.push("", "## Workspaces and units", "");
  for (const workspace of project.workspaces) {
    head.push(`- workspace ${workspace.kind}: \`${workspace.path}\` (${workspace.name})`);
  }
  for (const unit of inventory.units) {
    head.push(`- unit \`${unit.path}\`: ${unit.files} files, ${unit.bytes} bytes`);
  }
  head.push("", "## Skipped", "");
  if (inventory.skipped.length === 0) {
    head.push("- none");
  } else {
    for (const entry of inventory.skipped) head.push(`- \`${entry.path}\`: ${entry.reason}`);
  }
  head.push("", "## Files", "", "| Path | Lines | Language | Role |", "|---|---|---|---|");
  return Object.freeze(head);
}

/** The table row of one file (F140-FR-025). */
export function fileRow(entry: Inventory["files"][number]): string {
  return `| \`${entry.path}\` | ${entry.lines} | ${entry.language} | ${entry.role} |`;
}

/** What the renderer produced, and how much of the table it kept. */
export type RenderedSummary = {
  readonly text: string;
  /** The file rows that fitted. */
  readonly keptRows: number;
  /** The file rows there were. */
  readonly totalRows: number;
};

/**
 * Render the summary of an inventory (F140-FR-025).
 *
 * File rows are added in order until the text, the row and 200 characters
 * would exceed the budget; the head is never trimmed. When rows are dropped
 * the summary ends with the sentence that says how many and where the whole
 * record is — so the budget is visible and never silent.
 */
export function renderSummary(
  inventory: Inventory,
  jsonPath: string,
  budget: number = DEFAULT_CONTEXT_BUDGET,
): RenderedSummary {
  const head = summaryHead(inventory, jsonPath);
  const rows = inventory.files.map((entry) => fileRow(entry));
  let text = head.join("\n");
  let length = codePoints(text);
  let kept = 0;
  for (const row of rows) {
    const rowLength = codePoints(row);
    if (length + rowLength + ROW_HEADROOM > budget) break;
    kept += 1;
    text += `\n${row}`;
    length += rowLength + 1;
  }
  if (kept < rows.length) {
    text +=
      `\n\n_${rows.length - kept} of ${rows.length} file rows dropped to stay within ` +
      `${budget} characters; every file is in \`${jsonPath}\`._`;
  }
  return Object.freeze({ text: `${text}\n`, keptRows: kept, totalRows: rows.length });
}

/**
 * Write a file of the inventory atomically (F140-FR-025, F100-FR-036). The
 * directory of the path is created when it is missing, as the baseline's
 * `write_atomic` did.
 */
export function writeAtomic(path: string, text: string): void {
  atomicWrite(path, text, { createDirectory: true });
}
