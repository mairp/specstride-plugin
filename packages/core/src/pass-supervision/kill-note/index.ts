/**
 * T029 of feature 118 — the kill note, its two sidecars, the pass-in-flight
 * entry and the previous-pass prompt block (F118-FR-010, F118-FR-026;
 * C-056, C-011, C-057; B-0177, B-0620, B-0628 to B-0632, B-0638, B-0643 to
 * B-0645).
 *
 * Logical names (feature 100 annex B §B.5): the kill note lives at
 * `pass:<passId>:kill-note` (as-is
 * `pass-checkpoints/<run-id>-phase<P>-attempt<A>-pass<i>-<time>.md`); the
 * two sidecars of the last kill are the path of the note and the one line
 * `<reason>|<elapsed>|<detail>`, both removed at the start of the next pass
 * after their content entered the prompt; the entry of the pass in flight is
 * the registry entry of kind `harness-pass` (replacing `proposer.pid`),
 * written after the pass starts and removed when it ends and on exit.
 *
 * The next pass prompt carries the block headed
 * `## Your previous pass was terminated by the harness, not by you`, with
 * `Reason: **<reason>** after <n>s.`, the advice specific to the reason and
 * the path of the kill note. Standard error gets the line
 * `run_with_idle_watchdog: <message> -- killing pid <pid>.`
 *
 * Everything that came from outside the runtime (the detail, the tool calls,
 * the text blocks) is written after the one ingress (F118-FR-044).
 */

import type { Ingress, IngressClass, RegistryEntry, RegistryIdentity } from "../ports.ts";
import { admitForWrite } from "../ingress.ts";

/** The heading of every kill note (F118-FR-010). */
export const KILL_NOTE_HEADING = "# Pass terminated by the specstride watchdog";

/** How many tool calls the note keeps. */
export const KILL_NOTE_TOOL_CALLS = 25;

/** How many text blocks the note keeps, and how many characters each keeps. */
export const KILL_NOTE_TEXT_BLOCKS = 5;
export const KILL_NOTE_TEXT_BLOCK_CHARS = 600;

/** The heading of the previous-pass block of the next prompt (F118-FR-010). */
export const PREVIOUS_PASS_BLOCK_HEADING =
  "## Your previous pass was terminated by the harness, not by you";

/** The inputs of the note that the supervision itself knows. */
export interface KillNoteFacts {
  readonly runId: string;
  readonly phase: number;
  readonly attempt: number;
  readonly passIndex: number;
  readonly reason: string;
  readonly killClass: string;
  readonly elapsedSec: number;
  /** Optional detail (outside text; written after the ingress). */
  readonly detail?: string | undefined;
  /** The as-is path of the note inside the feature directory. */
  readonly notePath: string;
}

/** The last tool calls and text blocks of the pass (outside text). */
export interface KillNoteTail {
  readonly toolCalls: readonly string[];
  readonly textBlocks: readonly string[];
}

/** Cut one text block to the cap of the note. */
function cutBlock(block: string): string {
  return block.length > KILL_NOTE_TEXT_BLOCK_CHARS
    ? block.slice(0, KILL_NOTE_TEXT_BLOCK_CHARS)
    : block;
}

/**
 * Admit one outside text through the one ingress (T077, F118-FR-044); a drop
 * becomes `(redacted)`. The decision lives in `../ingress.ts` — this module
 * redacts nothing by itself.
 */
function admitted(ingress: Ingress, text: string, ingressClass: IngressClass): string {
  return admitForWrite(ingress, text, ingressClass).text;
}

/**
 * Render the kill note (markdown). The detail, the tool calls and the text
 * blocks are written after the ingress (F118-FR-044); the last 25 tool
 * calls and the last 5 text blocks of 600 characters each are kept.
 */
export function renderKillNote(facts: KillNoteFacts, tail: KillNoteTail, ingress: Ingress): string {
  const lines: string[] = [
    KILL_NOTE_HEADING,
    "",
    `- run: ${facts.runId}`,
    `- phase: ${facts.phase}`,
    `- attempt: ${facts.attempt}`,
    `- pass: ${facts.passIndex}`,
    `- kill reason: ${facts.reason}`,
    `- class: ${facts.killClass}`,
    `- elapsed: ${facts.elapsedSec}s`,
    `- note: ${facts.notePath}`,
  ];
  if (facts.detail !== undefined && facts.detail !== "") {
    lines.push("", `## Detail`, "", admitted(ingress, facts.detail, "free-text"));
  }
  const calls = tail.toolCalls.slice(-KILL_NOTE_TOOL_CALLS);
  if (calls.length > 0) {
    lines.push("", `## Last ${calls.length} tool calls`, "");
    for (const call of calls) lines.push(`- ${admitted(ingress, call, "tool-arguments")}`);
  }
  const blocks = tail.textBlocks.slice(-KILL_NOTE_TEXT_BLOCKS).map(cutBlock);
  if (blocks.length > 0) {
    lines.push("", `## Last ${blocks.length} text blocks`, "");
    for (const block of blocks) {
      lines.push("", "```", admitted(ingress, block, "stream-text"), "```");
    }
  }
  return lines.join("\n") + "\n";
}

/** The two sidecars of the last kill (F118-FR-026). */
export interface KillSidecars {
  /** The sidecar that holds the path of the note. */
  readonly notePath: string;
  /** The one-line sidecar `<reason>|<elapsed>|<detail>`. */
  readonly oneLine: string;
}

/**
 * Render the two sidecars of the last kill. The one-line sidecar carries the
 * detail, which came from outside the runtime: when the ingress is handed in
 * the detail is admitted first (F118-FR-044).
 */
export function renderKillSidecars(
  facts: KillNoteFacts,
  ingress?: Ingress | undefined,
): KillSidecars {
  const rawDetail = facts.detail ?? "";
  const detail =
    ingress !== undefined && rawDetail !== ""
      ? admitForWrite(ingress, rawDetail, "free-text").text
      : rawDetail;
  return {
    notePath: facts.notePath,
    oneLine: `${facts.reason}|${facts.elapsedSec}|${detail}`,
  };
}

/** The advice of the block, per kill reason (F118-FR-010). */
export function reasonAdvice(reason: string): string {
  switch (reason) {
    case "idle_timeout":
      return "The pass used no CPU for the whole idle period. Start the pass with the work you actually have, and yield while a long step runs instead of idling.";
    case "repeat_stall":
      return "The pass repeated one command or one tool call past the repeat limit. Change the approach instead of running the same step again.";
    case "progress_stall":
      return "Nothing under the progress roots changed for the whole progress period. Write your progress to disk as you go, or yield on the long step.";
    case "hard_cap":
      return "The pass reached the pass ceiling. Split the phase, or declare the long step as a yield or a verification command; do not just raise the cap.";
    default:
      return "The pass was ended by the harness. Continue from the last checkpoint and avoid whatever stalled the pass.";
  }
}

/** The block of the next prompt after a watchdog kill (F118-FR-010). */
export function previousPassBlock(
  input: {
    reason: string;
    elapsedSec: number;
    notePath: string;
  },
  ingress?: Ingress | undefined,
): string {
  const reason =
    ingress !== undefined ? admitForWrite(ingress, input.reason, "free-text").text : input.reason;
  return [
    PREVIOUS_PASS_BLOCK_HEADING,
    "",
    `Reason: **${reason}** after ${input.elapsedSec}s.`,
    "",
    "What it caught:",
    reasonAdvice(reason),
    "",
    `The kill note: ${input.notePath}`,
  ].join("\n");
}

/**
 * The line on standard error at every watchdog kill (F118-FR-010). The
 * message carries the detail the watchdog read from the pass (outside text):
 * when the ingress is handed in it is admitted first (F118-FR-044).
 */
export function watchdogStderrLine(
  message: string,
  pid: number,
  ingress?: Ingress | undefined,
): string {
  const text =
    ingress !== undefined ? admitForWrite(ingress, message, "tool-arguments").text : message;
  return `run_with_idle_watchdog: ${text} -- killing pid ${pid}.`;
}

/** The watchdog line of the pass loop (rule N-15; F118-FR-030). */
export function watchdogPassLine(passIndex: number, reason: string, killClass: string): string {
  return (
    `pass ${passIndex} was terminated by the watchdog (${reason}, class ${killClass}); ` +
    `its checkpoint is carried into the next pass.`
  );
}

/** The as-is name of the kill note inside the feature directory (F118-FR-026). */
export function killNoteAsIsPath(input: {
  runId: string;
  phase: number;
  attempt: number;
  passIndex: number;
  timeMs: number;
}): string {
  const time = new Date(input.timeMs).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `pass-checkpoints/${input.runId}-phase${input.phase}-attempt${input.attempt}-pass${input.passIndex}-${time}.md`;
}

/**
 * The entry of the pass in flight: the registry entry of kind `harness-pass`
 * (replacing `proposer.pid`), written after the pass starts and removed when
 * it ends and on exit (F118-FR-026).
 */
export function passInFlightEntry(input: {
  runId: string;
  identity: RegistryIdentity;
}): RegistryEntry {
  return {
    logicalName: `run:${input.runId}:pass-in-flight`,
    identity: input.identity,
    registryClass: "pass",
    survivesStop: false,
  };
}
