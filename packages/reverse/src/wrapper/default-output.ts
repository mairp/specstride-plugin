/**
 * F108-FR-034 and F108-SC-006 — **default output** of `reverse` and its verbs,
 * and the byte cap the host skill's budget puts on it.
 *
 * Everything else this package prints is COMPATIBILITY output: the dry-run
 * block, the plan JSON, the guard's `guard: <problem>` lines. Those reproduce
 * the baseline byte for byte and are the behaviour the oracle compares, so
 * they are never shortened. Default output is the other mode of annex G §G.2
 * (F100-FR-175) and has its own rules, which this module is the whole of:
 *
 *  1. one line for a success;
 *  2. for a failure, only the failing items, each with its fix;
 *  3. no command the host skill calls between invocation and launch prints
 *     more than 1,120 bytes in default output, or 2,240 bytes on a failure.
 *     `reverse lint` is outside the cap (it runs as a verification command
 *     inside the engine, not between invocation and launch); `reverse
 *     inventory` is inside it;
 *  4. a line that names state names it by its LOGICAL name, never by a
 *     physical path (F100-FR-177);
 *  5. under the `parity` profile none of these lines is printed at all,
 *     because none of them has an as-is equivalent (F100-FR-176, row 19 of
 *     annex X §X.7).
 *
 * Rule 3 is the reason this module exists rather than a `slice(0, 1120)` at
 * the call site: a cap met by cutting a sentence in half would hide the one
 * thing the consumer needs. Here a failure that does not fit keeps WHOLE
 * failing items, each with its fix, and ends with one line that says how many
 * were left out and where the complete list is — so the output is bounded by
 * construction and still true. The budget of the host skill itself is read
 * from the contract data (`@specstride/contracts/data/cli-protocol.json`, the
 * table of annex G §G.5), never restated here.
 */
import cliProtocol from "@specstride/contracts/data/cli-protocol.json" with { type: "json" };
import {
  mayBeWritten,
  modeInForce,
  type OutputMode,
} from "@specstride/contracts/grammar/output-modes";

import { PLAN_LOGICAL_NAMES, type PlanOutput } from "../plan/plan.ts";

/* ------------------------------------------------------------------------- *
 * The cap (F108-FR-034) and the budget it comes from (F108-SC-006)
 * ------------------------------------------------------------------------- */

/** F108-FR-034 — the cap of default output of one command, in bytes. */
export const BUDGET_BYTES = 1120 as const;

/** F108-FR-034 — the cap of default output of one command that FAILED. */
export const FAILURE_BUDGET_BYTES = 2240 as const;

/** F108-SC-006 — the measure of the build: bytes, at 2.8 bytes per token. */
export const BYTES_PER_TOKEN = 2.8 as const;

/** The host skill of annex G §G.5 whose budget F108-SC-006 measures against. */
export const HOST_SKILL = "specstride-reverse" as const;

/** The `Subject` cell of the budget table of §G.5 that names that skill. */
export const HOST_SKILL_BUDGET_SUBJECT = "Host skill `specstride-reverse`" as const;

type BudgetRow = { readonly Subject: string; readonly Budget: string };

/**
 * F108-SC-006 — the budget of the host skill in TOKENS, read from the table of
 * annex G §G.5 as feature 100 ships it. A missing row is an error and not a
 * default: a budget this feature invented would make the whole measure a
 * claim about nothing.
 */
export function hostSkillTokenBudget(): number {
  const rows = (cliProtocol as { readonly budgets: readonly BudgetRow[] }).budgets;
  const row = rows.find((entry) => entry.Subject === HOST_SKILL_BUDGET_SUBJECT);
  if (row === undefined) {
    throw new Error(
      `the budget table of annex G §G.5 holds no row \`${HOST_SKILL_BUDGET_SUBJECT}\`, so the ` +
        `byte budget of the host skill cannot be read (F100-FR-187)`,
    );
  }
  const digits = row.Budget.replace(/,/g, "").match(/\d+/);
  if (digits === null) {
    throw new Error(
      `the budget of \`${HOST_SKILL_BUDGET_SUBJECT}\` in annex G §G.5 is \`${row.Budget}\`, ` +
        `which names no number of tokens`,
    );
  }
  return Number(digits[0]);
}

/** F108-SC-006 — that budget in bytes, at 2.8 bytes per token. */
export function hostSkillByteBudget(): number {
  return Math.floor(hostSkillTokenBudget() * BYTES_PER_TOKEN);
}

/* ------------------------------------------------------------------------- *
 * Which commands the cap applies to (F108-FR-034)
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-034 — the commands the host skill calls between the invocation of
 * `specstride-reverse` and the launch. Each of them is inside the cap.
 */
export const COMMANDS_BETWEEN_INVOCATION_AND_LAUNCH = Object.freeze([
  "reverse",
  "reverse plan",
  "reverse inventory",
  "reverse guard",
] as const);

/**
 * F108-FR-034 — `reverse lint` is NOT called between invocation and launch: it
 * runs as a verification command of a phase inside the engine, and its output
 * (one as-is line per finding and a summary line, F140-FR-003) is outside this
 * cap.
 */
export const COMMANDS_OUTSIDE_THE_CAP = Object.freeze(["reverse lint"] as const);

/** Whether the cap of F108-FR-034 applies to a command. */
export function isInsideTheCap(command: string): boolean {
  return (COMMANDS_BETWEEN_INVOCATION_AND_LAUNCH as readonly string[]).includes(command);
}

/** The cap in force for one outcome of one command (F108-FR-034). */
export function budgetOf(outcome: "success" | "failure"): number {
  return outcome === "failure" ? FAILURE_BUDGET_BYTES : BUDGET_BYTES;
}

/* ------------------------------------------------------------------------- *
 * The measure
 * ------------------------------------------------------------------------- */

/**
 * The bytes a list of lines occupies when it is printed: each line with its
 * own line end, which is what a stream carries. An empty list is zero bytes,
 * because nothing is written at all.
 */
export function byteLengthOfOutput(lines: readonly string[]): number {
  if (lines.length === 0) return 0;
  return Buffer.byteLength(lines.map((line) => `${line}\n`).join(""), "utf8");
}

/** What the measure of one command's default output found. */
export type BudgetMeasure = {
  readonly bytes: number;
  readonly budget: number;
  readonly within: boolean;
};

/** Measure default output against the cap of F108-FR-034. */
export function measureAgainstTheBudget(
  lines: readonly string[],
  outcome: "success" | "failure",
): BudgetMeasure {
  const bytes = byteLengthOfOutput(lines);
  const budget = budgetOf(outcome);
  return Object.freeze({ bytes, budget, within: bytes <= budget });
}

/** Cut a line to a number of BYTES on a code-point boundary, with an ellipsis. */
export function clampToBytes(text: string, limit: number): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const ellipsis = "…";
  const room = limit - Buffer.byteLength(ellipsis, "utf8");
  if (room <= 0) return "";
  let kept = "";
  for (const character of text) {
    if (Buffer.byteLength(kept + character, "utf8") > room) break;
    kept += character;
  }
  return `${kept}${ellipsis}`;
}

/* ------------------------------------------------------------------------- *
 * The shape of the lines
 * ------------------------------------------------------------------------- */

/** The prefix every line of default output of this capability carries. */
export const PREFIX = "reverse: " as const;

/** One failing item of a failure, with the fix F108-FR-034 asks for. */
export type FailingItem = {
  /** What failed, in as few words as say it. */
  readonly item: string;
  /** What the consumer does about it. */
  readonly fix: string;
};

/** F108-FR-034 — one failing item with its fix, as one line. */
export function failingItemLine(item: FailingItem): string {
  return `${PREFIX}${item.item} — fix: ${item.fix}`;
}

/** The line that says how many failing items did not fit, and where they are. */
export function elidedLine(count: number): string {
  return (
    `${PREFIX}and ${count} more failing item(s); the whole list is in compatibility output ` +
    `(the key \`output.compat\`)`
  );
}

/**
 * F108-FR-034 — the default output of a FAILURE: only the failing items, each
 * with its fix, bounded by the cap.
 *
 * Whole items are kept while they fit; the rest are counted in one last line.
 * A single item longer than the whole cap is clamped on a code-point boundary,
 * so the bound holds for any input — a path of ten thousand characters
 * included.
 */
export function failureOutput(
  items: readonly FailingItem[],
  budget: number = FAILURE_BUDGET_BYTES,
): readonly string[] {
  if (items.length === 0) return Object.freeze([]);
  const cost = (line: string): number => Buffer.byteLength(`${line}\n`, "utf8");
  const lines: string[] = [];
  let used = 0;
  for (let index = 0; index < items.length; index += 1) {
    const line = failingItemLine(items[index] as FailingItem);
    const after = items.length - index - 1;
    // Room is kept for the elision line whenever items remain after this one,
    // so the bound holds for the output as a whole and not line by line.
    const reserve = after > 0 ? cost(elidedLine(after)) : 0;
    if (used + cost(line) + reserve <= budget) {
      lines.push(line);
      used += cost(line);
      continue;
    }
    const left = items.length - index;
    if (lines.length === 0) {
      // Not even the first item fits whole: keep as much of it as the budget
      // allows, still leaving room for the elision line that follows it.
      const reserveAfterTheFirst = left > 1 ? cost(elidedLine(left - 1)) : 0;
      const room = budget - reserveAfterTheFirst;
      if (room >= 2) {
        const clamped = clampToBytes(line, room - 1);
        if (clamped !== "") {
          lines.push(clamped);
          used += cost(clamped);
          if (left - 1 > 0 && used + cost(elidedLine(left - 1)) <= budget) {
            lines.push(elidedLine(left - 1));
          }
          return Object.freeze(lines);
        }
      }
    }
    // The items from here on are counted, where the count itself fits.
    if (used + cost(elidedLine(left)) <= budget) lines.push(elidedLine(left));
    return Object.freeze(lines);
  }
  return Object.freeze(lines);
}

/* ------------------------------------------------------------------------- *
 * Rule 5 — under `parity`, none of these lines is printed
 * ------------------------------------------------------------------------- */

/**
 * Every line of this module is a NEW line: default output is not a surface the
 * baseline had, so no line here has an as-is equivalent. That is the whole
 * input the predicate of F100-FR-176 needs.
 */
export const LINES_HAVE_AN_AS_IS_EQUIVALENT = false as const;

/** The output mode in force, from the key `output.compat` and the profile. */
export function outputModeInForce(context: {
  readonly outputCompat?: boolean | undefined;
  readonly profile?: string | undefined;
}): OutputMode {
  return modeInForce(context);
}

/**
 * F108-FR-034 — whether default output may be written at all. Under the
 * `parity` profile the answer is no, through the contract's own predicate:
 * a line with no as-is equivalent is printed on no stream.
 */
export function mayPrintDefaultOutput(context: {
  readonly outputCompat?: boolean | undefined;
  readonly profile?: string | undefined;
}): boolean {
  if (outputModeInForce(context) !== "default") return false;
  return mayBeWritten(
    {
      stream: "stdout",
      hasAnAsIsEquivalent: LINES_HAVE_AN_AS_IS_EQUIVALENT,
      featureIsOn: true,
    },
    context.profile,
  ).allowed;
}

/** The lines that are actually printed in the mode and profile in force. */
export function linesInForce(
  lines: readonly string[],
  context: { readonly outputCompat?: boolean | undefined; readonly profile?: string | undefined },
): readonly string[] {
  return mayPrintDefaultOutput(context) ? lines : Object.freeze([]);
}

/* ------------------------------------------------------------------------- *
 * State is named by logical name (F100-FR-177)
 * ------------------------------------------------------------------------- */

/** The logical name of one file of a plan, with the slug filled in. */
export function logicalNameOf(key: keyof typeof PLAN_LOGICAL_NAMES, slug: string): string {
  return PLAN_LOGICAL_NAMES[key].replace("<slug>", slug);
}

/** The logical name of the output directory of a run (annex B §B.5). */
export function outputLogicalName(slug: string): string {
  return `reverse:${slug}:output`;
}

/** The four files a plan writes, by the key of the plan output (F108-FR-014). */
export const PLAN_FILES_WRITTEN = Object.freeze([
  "inventory",
  "inventory_md",
  "driver",
  "verification_commands",
] as const);

/* ------------------------------------------------------------------------- *
 * The success lines, one per command
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-034 — the ONE line `reverse plan` prints on a success in default
 * output. It names every file it wrote by logical name, never by path, and it
 * says the two things the consumer acts on: how many phases the run has and
 * which tasks mode they carry.
 */
export function planSuccessLine(output: PlanOutput): string {
  const names = PLAN_FILES_WRITTEN.map((key) => logicalNameOf(key, output.slug)).join(", ");
  return (
    `${PREFIX}planned ${output.feature}: ${output.phases.length} phase(s), tasks ` +
    `${output.tasks_mode}${output.oversize ? ", oversize" : ""}; wrote ${names}`
  );
}

/** F108-FR-034 — the ONE line a launch prints in default output. */
export function launchSuccessLine(output: PlanOutput, detached: boolean): string {
  const where = detached ? "through a run request of kind engine" : "in the foreground";
  return (
    `${PREFIX}launched ${output.feature} ${where}: ${output.phases.length} phase(s) of ` +
    `${logicalNameOf("driver", output.slug)}`
  );
}

/** F108-FR-034 — the ONE line a dry run prints in default output. */
export function dryRunSuccessLine(output: PlanOutput): string {
  return (
    `${PREFIX}dry run of ${output.feature}: ${output.phases.length} phase(s) of ` +
    `${logicalNameOf("driver", output.slug)}; nothing launched`
  );
}

/** F108-FR-034 — the ONE line `reverse guard` prints on a success. */
export function guardSuccessLine(slug: string): string {
  return `${PREFIX}guard ok: the source is untouched outside ${outputLogicalName(slug)} and the workspace part`;
}

/**
 * F108-FR-034 — the ONE line `reverse inventory` prints on a success. The verb
 * itself belongs to feature 140; this is the line of the CALL this package
 * makes into it (F108-FR-014), which is what is inside the cap here.
 */
export function inventorySuccessLine(slug: string, files: number): string {
  return (
    `${PREFIX}inventory of ${files} file(s): wrote ${logicalNameOf("inventory", slug)} and ` +
    `${logicalNameOf("inventory_md", slug)}`
  );
}

/* ------------------------------------------------------------------------- *
 * The failing items of each command
 * ------------------------------------------------------------------------- */

/** The kinds of problem of the reverse guard (row 156 of annex X §X.6). */
export const GUARD_PROBLEM_KINDS = Object.freeze([
  "deleted",
  "added",
  "changed",
  "fingerprint differs",
  "git HEAD moved",
  "git status",
] as const);

export type GuardProblemKind = (typeof GUARD_PROBLEM_KINDS)[number];

/** The kind of one problem line of the guard, read off its own text. */
export function kindOfGuardProblem(problem: string): GuardProblemKind | undefined {
  if (problem.startsWith("deleted: ")) return "deleted";
  if (problem.startsWith("added: ")) return "added";
  if (problem.startsWith("changed: ")) return "changed";
  if (problem.startsWith("fingerprint differs")) return "fingerprint differs";
  if (problem.startsWith("git HEAD moved")) return "git HEAD moved";
  if (problem.startsWith("git status")) return "git status";
  return undefined;
}

/** The fix of each kind of guard problem — the "each with its fix" of F108-FR-034. */
export const FIX_OF_GUARD_PROBLEM: Readonly<Record<GuardProblemKind, string>> = Object.freeze({
  deleted: "restore the path in the source, or take a new baseline with `reverse inventory`",
  added: "remove the path from the source, or exclude it in a new baseline",
  changed: "restore the path to its baseline content; the source is never written by a run",
  "fingerprint differs": "take a new baseline with `reverse inventory` and guard against it",
  "git HEAD moved": "check the baseline's commit out again before the guard runs",
  "git status": "commit or revert the entry, or move it under the output directory",
});

/** F108-FR-034 — the failing items of a guard that found problems. */
export function guardFailingItems(problems: readonly string[]): readonly FailingItem[] {
  return Object.freeze(
    problems.map((problem) => {
      const kind = kindOfGuardProblem(problem);
      return Object.freeze({
        item: problem,
        fix:
          kind === undefined
            ? "read the problem and restore the source to its baseline"
            : FIX_OF_GUARD_PROBLEM[kind],
      });
    }),
  );
}

/**
 * F108-FR-034 — the failing item of a REFUSAL, whose message this package
 * already owns byte for byte. Default output prints the message as the item
 * and adds the fix, which compatibility output has no room for.
 */
export function refusalFailingItem(message: string, fix: string): FailingItem {
  return Object.freeze({ item: message, fix });
}

/** The fix of a refusal, chosen by the message the capability raised. */
export function fixOfARefusal(message: string): string {
  if (message.startsWith("source is not a directory")) {
    return "name an existing directory as the source";
  }
  if (message.includes("must be done or open")) return "pass --tasks done or --tasks open";
  if (message.startsWith("not an inventory") || message.startsWith("cannot read inventory")) {
    return "take a baseline with `reverse inventory` and pass it as --baseline";
  }
  if (message.includes("is set by the reverse run")) return "drop the flag; the run sets it itself";
  if (message.includes("unexpected argument")) {
    return "pass one source directory only; the options go behind their flags";
  }
  if (message.includes("--mode")) return "run with --mode source-aware, the only mode reverse has";
  if (message.startsWith("output dir") || message.includes("--out")) {
    return "pass an --out inside the source tree, outside .git and .specify, that is empty";
  }
  if (message.includes("already has gate state")) {
    return "resume the run, or pass --name to choose another slug";
  }
  return "read the message and correct the invocation; nothing was written";
}

/* ------------------------------------------------------------------------- *
 * The whole default output of one command
 * ------------------------------------------------------------------------- */

/** What one command of this capability did, in the terms default output needs. */
export type CommandOutcome = {
  /** The command, as `COMMANDS_BETWEEN_INVOCATION_AND_LAUNCH` spells it. */
  readonly command: string;
  /** The one success line, where the command succeeded. */
  readonly successLine?: string | undefined;
  /** The failing items, where it failed. */
  readonly failingItems?: readonly FailingItem[] | undefined;
  /** The mode and profile in force. */
  readonly outputCompat?: boolean | undefined;
  readonly profile?: string | undefined;
};

/** What default output of one command came to. */
export type DefaultOutput = {
  readonly command: string;
  readonly lines: readonly string[];
  readonly outcome: "success" | "failure";
  readonly measure: BudgetMeasure;
  /** True where the cap applies to this command at all (F108-FR-034). */
  readonly capped: boolean;
};

/**
 * F108-FR-034 — the default output of one command: one line for a success,
 * only the failing items with their fixes for a failure, nothing at all under
 * the `parity` profile, and never more than the cap.
 */
export function defaultOutputOf(outcome: CommandOutcome): DefaultOutput {
  const failed = (outcome.failingItems ?? []).length > 0;
  const kind: "success" | "failure" = failed ? "failure" : "success";
  const capped = isInsideTheCap(outcome.command);
  const budget = capped ? budgetOf(kind) : Number.POSITIVE_INFINITY;
  const raw = failed
    ? failureOutput(outcome.failingItems ?? [], budget)
    : outcome.successLine === undefined
      ? []
      : [clampToBytes(outcome.successLine, Math.max(budget - 1, 0))];
  const lines = linesInForce(raw, outcome);
  return Object.freeze({
    command: outcome.command,
    lines,
    outcome: kind,
    measure: measureAgainstTheBudget(lines, kind),
    capped,
  });
}
