/**
 * T019 — usage, help and the unknown-verb message of the front door
 * (F119-FR-003, F119-FR-004, F119-FR-014).
 *
 * Two usage texts, one per output mode (F119-FR-004):
 *
 * - In compatibility output the usage is the baseline's text, the header of
 *   the front-door script with the leading `# ` removed; where that text
 *   names an implementation file it names the logical component of annex X
 *   §X.8 instead.
 * - In default output the usage lists every command of the table of annex G
 *   §G.1 (the verb table, `verbs.ts`) on one line each, is at most 2,240
 *   bytes, and names no harness.
 *
 * F119-FR-014: nothing here enumerates harnesses. The only way a harness
 * name enters the front door is the resolved registry of annex C §C.6, and
 * `harnessNamesOf` below is the single accessor that reads it.
 */
import { VERBS } from "./verbs.ts";
import type { ResolvedRegistry } from "@specstride/contracts/records/resolved-registry";

/** The byte limit of the usage in default output (F119-FR-004, CQ-095). */
export const DEFAULT_USAGE_LIMIT = 2_240 as const;

/** The usage mode, as the output modes of annex G §G.2 name them. */
export type UsageMode = "compat" | "default";

/** The logical components of annex X §X.8 the compat usage may name. */
export const LOGICAL_COMPONENTS: readonly string[] = Object.freeze([
  "front door",
  "engine call",
  "inspection reads",
]);

/** The usage in default output: one line per verb of the table (F119-FR-004). */
export function defaultUsageText(): string {
  const lines = ["usage: specstride <verb> [arguments...]"];
  for (const row of VERBS) {
    lines.push(`  ${row.verb}  ${row.what}`);
  }
  lines.push("Every verb: --json, --verbose, -h.");
  return lines.join("\n");
}

/**
 * The usage in compatibility output: the header of the front-door component,
 * leading `# ` removed, implementation files named as the logical components
 * of annex X §X.8 (F119-FR-004).
 */
export function compatUsageText(): string {
  return [
    "specstride — the front door of the product.",
    "",
    "usage: specstride [verb] [arguments...]",
    "",
    "The front door reads the first argument and hands the call to the command",
    "that owns it: the engine call runs a run, the inspection reads look at one,",
    "and every other verb belongs to the feature that owns its row.",
    "With no argument, or with -h, --help or help, it prints this usage and",
    "ends 0. An unknown verb ends 1. An error nothing catches ends 70.",
  ].join("\n");
}

/** The usage of one mode (F119-FR-004). */
export function usageText(mode: UsageMode): string {
  return mode === "compat" ? compatUsageText() : defaultUsageText();
}

/** The usage of the mode fits the byte limit of F119-FR-004 (CQ-095). */
export function usageWithinLimit(mode: UsageMode = "default"): boolean {
  return Buffer.byteLength(usageText(mode), "utf8") <= DEFAULT_USAGE_LIMIT;
}

/**
 * F119-FR-003 — the unknown-verb message. Lisa's wording
 * `unknown subcommand: <verb>` is NOT used.
 */
export function unknownVerbMessage(sub: string): string {
  return `specstride: unknown subcommand '${sub}'`;
}

/** The streams a printer writes to; injectable. */
export type UsageIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

/** F119-FR-004 — print the usage on standard output and end 0. */
export function printUsage(mode: UsageMode, io: UsageIo): number {
  io.out(`${usageText(mode)}\n`);
  return 0;
}

/**
 * F119-FR-003 — the unknown first argument: the message and then the usage,
 * both on standard error, exit 1.
 */
export function unknownVerbExit(sub: string, mode: UsageMode, io: UsageIo): number {
  io.err(`${unknownVerbMessage(sub)}\n${usageText(mode)}\n`);
  return 1;
}

/**
 * F119-FR-014 — the harness names a caller may see, read ONLY out of the
 * resolved registry of annex C §C.6. Nothing else in the front door reads,
 * holds or tests a harness name.
 */
export function harnessNamesOf(registry: ResolvedRegistry): readonly string[] {
  return Object.freeze(registry.harnesses.map((entry) => entry.id));
}
