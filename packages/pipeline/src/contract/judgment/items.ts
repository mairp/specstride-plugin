/**
 * T022 — the judgment items of a draft (F107-FR-009; data-model.md,
 * "Judgment item").
 *
 * One item per UNSETTLED thing the draft holds, of the four kinds of row 259:
 * `classify-obligation` (a coverage entry that is `unresolved` in no phase),
 * `settle-prerequisite` (an absent prerequisite candidate), `map-declared-command`
 * (a declared command of the plan) and `resolve-blocker` (a candidate blocker
 * the plan names). Item ids are deterministic: `JT-` + the id rule over
 * `<kind>:<anchor>`. An excerpt is redacted and cut at a line end under its
 * cap with the cut marker `…` — redaction first, then the cut.
 */
import type { LaunchContractDraft } from "../draft/build.ts";
import { idFromName } from "../inventory/features.ts";
import { redactor } from "../kernel.ts";

/** The marker that says an excerpt was cut. */
export const EXCERPT_CUT_MARKER = "…" as const;

/** The cap of an excerpt, in characters (F107-FR-009; data-model.md). */
export const EXCERPT_CAP = 240 as const;

/** One judgment item, with the members of data-model.md. */
export type JudgmentItem = {
  readonly id: string;
  readonly kind:
    "classify-obligation" | "settle-prerequisite" | "map-declared-command" | "resolve-blocker";
  readonly anchor: string;
  readonly question: string;
  readonly choices: readonly string[];
  readonly excerpt?: string;
  readonly source: { readonly path: string; readonly line: number };
};

/** Redact a text, then cut it at a line end under the cap with the marker. */
export function excerptOf(text: string): string {
  const redacted = redactor().redact(text, EXCERPT_CAP * 4).text;
  if (redacted.length <= EXCERPT_CAP) return redacted;
  const slice = redacted.slice(0, EXCERPT_CAP);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
  return `${slice.slice(0, lastBreak > 0 ? lastBreak : EXCERPT_CAP).trimEnd()}${EXCERPT_CUT_MARKER}`;
}

/** The id of an item: `JT-` + the id rule over `<kind>:<anchor>`. */
export function itemIdOf(kind: string, anchor: string): string {
  return `JT-${idFromName(`${kind}:${anchor}`)}`;
}

/** The choices of a classification (row 285 of the closed sets). */
export const CLASSIFY_CHOICES = Object.freeze(["mapped", "optional", "out-of-scope"] as const);

/** The choices of a prerequisite settlement (row 285). */
export const PREREQUISITE_CHOICES = Object.freeze(["mapped", "optional", "keep-blocker"] as const);

/** The choices of a declared-command mapping (row 285). */
export const COMMAND_CHOICES = Object.freeze([
  "specstride-phase:1",
  "specstride-phase:2",
  "specstride-phase:3",
  "out-of-scope",
] as const);

/** The choices of a blocker resolution (row 285). */
export const BLOCKER_CHOICES = Object.freeze(["accepted", "keep-blocker"] as const);

/** Every judgment item the draft needs, in a deterministic order. */
export function judgmentItemsOf(draft: LaunchContractDraft): readonly JudgmentItem[] {
  const items: JudgmentItem[] = [];
  for (const entry of draft.coverage) {
    if (entry.disposition !== "unresolved") continue;
    if (entry.timing !== "unclassified") continue;
    items.push({
      id: itemIdOf("classify-obligation", entry.id),
      kind: "classify-obligation",
      anchor: entry.id,
      question: `Which way is ${entry.source.anchor} carried out?`,
      choices: CLASSIFY_CHOICES,
      excerpt: excerptOf(entry.rationale),
      source: { path: entry.source.path, line: entry.source.line },
    });
  }
  for (const candidate of draft.inventory.prerequisites) {
    if (candidate.present) continue;
    items.push({
      id: itemIdOf("settle-prerequisite", candidate.id),
      kind: "settle-prerequisite",
      anchor: candidate.id,
      question: `Is the prerequisite ${candidate.resolved} mapped, optional, or a kept blocker?`,
      choices: PREREQUISITE_CHOICES,
      excerpt: excerptOf(`${candidate.source.path}:${candidate.source.line}`),
      source: { path: candidate.source.path, line: candidate.source.line },
    });
  }
  for (const candidate of draft.inventory.shell_candidates) {
    items.push({
      id: itemIdOf("map-declared-command", `${candidate.path}:${candidate.start_line}`),
      kind: "map-declared-command",
      anchor: `${candidate.path}:${candidate.start_line}`,
      question: `Which phase does the command on ${candidate.path}:${candidate.start_line} belong to?`,
      choices: COMMAND_CHOICES,
      excerpt: excerptOf(candidate.text),
      source: { path: candidate.path, line: candidate.start_line },
    });
  }
  for (const finding of draft.findings) {
    if (finding.severity !== "blocker" || finding.status !== "open") continue;
    if (finding.id === "semantic-derivation-required") continue;
    items.push({
      id: itemIdOf("resolve-blocker", finding.id),
      kind: "resolve-blocker",
      anchor: finding.id,
      question: `Is the blocker ${finding.id} accepted, or kept open?`,
      choices: BLOCKER_CHOICES,
      excerpt: excerptOf(finding.message),
      source: { path: finding.source.path, line: finding.source.line },
    });
  }
  return items;
}
