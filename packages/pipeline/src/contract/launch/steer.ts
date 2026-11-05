/**
 * T045 — `--comment-selects` (F107-FR-035): the closed set of options a
 * comment may select, the check that a value NARROWS, and the record of what
 * changed.
 *
 * The rules of F107-FR-035, and where each lives:
 *
 * - the options are the members of the closed set "Options a comment may
 *   select" (annex X §X.6 row 283), read from `@specstride/contracts`
 *   through `src/contract/schemas/closed-sets.ts` — never copied by hand;
 * - the host reads the comment, sets the option by its ordinary argument,
 *   and names the option with `--comment-selects <option>` on the same call:
 *   `contract derive` for `features`, `relaunch` and `learning`, `launch`
 *   for `mode`. `--comment-selects` WITHOUT `--comment` is refused (the
 *   argument handling of `launch` refuses it; this module refuses it for
 *   `derive`);
 * - for a named option the CLI checks that the value narrows: every feature
 *   in scope is a candidate of F107-FR-002, so `features` narrows only to a
 *   strict subset of the features in scope; the relaunch budget narrows at
 *   or below its default (F107-FR-025: 2 relaunches — a value above the
 *   default widens spend and is refused, and a budget is never widened by
 *   the comment); the learning mode narrows to `off` or `suggest`
 *   (`apply` widens); the mode narrows to `dry-run` (`run` widens). A value
 *   that widens is refused — exit 2 of `contract derive`, the code of a
 *   refusal of `launch` — and NOTHING is written;
 * - the launch contract records, under `configuration.comment`, what was
 *   changed because of the comment: one entry per named option, with the
 *   option and the value in force. The runtime reads the record and shows it
 *   under the keys `comment` and `changed` of the line before the digest
 *   line (annex G §G.3; F123-FR-043).
 *
 * The comment itself is never read as prose here: a named option with no
 * value in force is a refusal, not an interpretation (F107-FR-032: the CLI
 * reads no prose).
 */
import { commentOptionSet } from "../schemas/closed-sets.ts";

/**
 * The closed set of row 283, as the CLI reads it: the options a comment may
 * select (F107-FR-035), read from `@specstride/contracts` — never copied.
 */
export const COMMENT_SELECT_OPTIONS = commentOptionSet.members;
export type SteerOption = (typeof COMMENT_SELECT_OPTIONS)[number];

/** One named option of `--comment-selects`, with its value in force when known. */
export type SteerSelection = {
  readonly option: SteerOption;
  readonly value?: unknown;
};

/** The code of a refusal of `contract derive` for a widening value (F107-FR-035). */
export const STEER_DERIVE_REFUSED_EXIT = 2 as const;

/** The code of a refusal of `launch` for a widening value (annex G §G.4). */
export const STEER_LAUNCH_REFUSED_EXIT = 4 as const;

/**
 * The default of the relaunch budget (F107-FR-025): 2 relaunches. A value at
 * or below the default narrows; above it widens.
 */
export const DEFAULT_RELAUNCH_MAX = 2 as const;

/** The learning modes a comment may narrow to (F107-FR-035). */
export const LEARNING_MODES_A_COMMENT_MAY_SELECT = ["off", "suggest"] as const;

/** A refusal of a `--comment-selects` call. */
export type SteerRefusal = {
  readonly reason:
    | "comment-selects-unknown-option"
    | "comment-selects-not-on-this-command"
    | "comment-selects-widens"
    | "comment-selects-without-comment";
  readonly exit: typeof STEER_DERIVE_REFUSED_EXIT | typeof STEER_LAUNCH_REFUSED_EXIT;
  readonly message: string;
  readonly next?: string;
};

/** What parsing `--comment-selects` values produces. */
export type SteerParse =
  | { readonly ok: true; readonly selects: readonly SteerSelection[] }
  | { readonly ok: false; readonly refusal: SteerRefusal };

/** The options each command accepts (F107-FR-035). */
export function optionsOfCommand(command: "derive" | "launch"): readonly string[] {
  return command === "derive" ? commentOptionSet.members.filter((one) => one !== "mode") : ["mode"];
}

/**
 * Parse the values of `--comment-selects` for one command (F107-FR-035).
 * Each value names an option of the closed set of row 283; an option the
 * command does not take is refused (`launch` takes `mode` only, `contract
 * derive` the other three). An unknown option is refused with the rule of
 * the closed set. The VALUE in force comes from the ordinary argument of the
 * same call, not from this flag: the caller pairs the selections with the
 * values in force through `narrowingProblem`/`selectionsWithValues`.
 */
export function parseCommentSelects(
  values: readonly string[],
  command: "derive" | "launch",
): SteerParse {
  const allowed = optionsOfCommand(command);
  const selects: SteerSelection[] = [];
  for (const raw of values) {
    // `option=value` is accepted as a shorthand of "name the option and show
    // the value in force on the same call"; a bare option names it only.
    const option = (raw.includes("=") ? raw.slice(0, raw.indexOf("=")) : raw).trim();
    if (!commentOptionSet.has(option)) {
      return {
        ok: false,
        refusal: {
          reason: "comment-selects-unknown-option",
          exit: command === "derive" ? STEER_DERIVE_REFUSED_EXIT : STEER_LAUNCH_REFUSED_EXIT,
          message:
            `${command}: --comment-selects ${option} is not an option a comment may select; ` +
            `the options are ${commentOptionSet.members.join(", ")} (annex X §X.6 row 283)`,
          next: `name one of ${allowed.join(", ")} on this command`,
        },
      };
    }
    if (!allowed.includes(option)) {
      return {
        ok: false,
        refusal: {
          reason: "comment-selects-not-on-this-command",
          exit: command === "derive" ? STEER_DERIVE_REFUSED_EXIT : STEER_LAUNCH_REFUSED_EXIT,
          message:
            `${command}: --comment-selects ${option} is not an option of ${command}; ` +
            `${command} accepts only ${allowed.join(", ")}`,
          next: `set ${option} on the command that owns it`,
        },
      };
    }
    if (raw.includes("=")) {
      const rawValue = raw.slice(raw.indexOf("=") + 1);
      // A whole number in the shorthand is the number in force (`relaunch=1`),
      // not its text: the budget check compares numbers (F107-FR-025).
      const trimmed = rawValue.trim();
      // `features` takes the slugs in force, comma-separated in the
      // shorthand; they are recorded as the list (F107-FR-035).
      const value =
        option === "features"
          ? trimmed
              .split(",")
              .map((one) => one.trim())
              .filter((one) => one !== "")
          : /^-?\d+$/.test(trimmed)
            ? Number(trimmed)
            : trimmed;
      selects.push({ option: option as SteerSelection["option"], value });
    } else {
      selects.push({ option: option as SteerSelection["option"] });
    }
  }
  return { ok: true, selects };
}

/** The context the narrowing check of one option reads. */
export type NarrowingContext = {
  /** The slugs of the features in scope (every one a candidate of F107-FR-002). */
  readonly featuresInScope?: readonly string[];
  /** The relaunch maximum in force; the default when absent. */
  readonly relaunchMaxInForce?: number;
  /** The learning mode in force. */
  readonly learningModeInForce?: string;
};

/**
 * `undefined` when the value NARROWS; the reason it widens otherwise
 * (F107-FR-035). The rules:
 *
 * - `features`: a non-empty strict subset of the features in scope — every
 *   feature in scope is a candidate, so a slug outside the candidates or the
 *   whole set does not narrow, and an empty set is not a run;
 * - `relaunch`: at or below the default of F107-FR-025 (2); a greater value
 *   widens spend, and a budget is never widened by the comment;
 * - `learning`: `off` or `suggest`; `apply` widens (it writes);
 * - `mode`: `dry-run`; `run` widens (it starts what the comment was asked to
 *   hold back).
 */
export function narrowingProblem(
  option: string,
  value: unknown,
  context: NarrowingContext = {},
): string | undefined {
  if (option === "features") {
    const scope = context.featuresInScope ?? [];
    if (!Array.isArray(value) || value.length === 0) {
      return "the option features needs the slugs of the features that stay in scope";
    }
    const unknown = value.filter((one) => typeof one === "string" && !scope.includes(one));
    if (unknown.length > 0) {
      return (
        `the option features names ${unknown.join(", ")}, which is not a feature in scope; ` +
        `every feature in scope is a candidate (F107-FR-002)`
      );
    }
    if (value.length >= scope.length) {
      return "the option features does not narrow: it names every feature in scope";
    }
    return undefined;
  }
  if (option === "relaunch") {
    const maximum = value ?? context.relaunchMaxInForce;
    if (typeof maximum !== "number" || !Number.isInteger(maximum) || maximum < 0) {
      return "the option relaunch needs the maximum of relaunches in force, as a whole number";
    }
    if (maximum > DEFAULT_RELAUNCH_MAX) {
      return (
        `the option relaunch widens: ${maximum} is above the default ` +
        `${DEFAULT_RELAUNCH_MAX} (F107-FR-025), and a budget is never widened by the comment`
      );
    }
    return undefined;
  }
  if (option === "learning") {
    const mode = value ?? context.learningModeInForce;
    if (
      typeof mode !== "string" ||
      !(LEARNING_MODES_A_COMMENT_MAY_SELECT as readonly string[]).includes(mode)
    ) {
      return (
        `the option learning widens: only ${LEARNING_MODES_A_COMMENT_MAY_SELECT.join(" and ")} ` +
        `narrow; ${String(mode)} writes`
      );
    }
    return undefined;
  }
  if (option === "mode") {
    if (value !== "dry-run") {
      return `the option mode widens: only dry-run narrows; ${String(value)} starts`;
    }
    return undefined;
  }
  return `--comment-selects ${option} is not an option a comment may select`;
}

/** Pair each named option with the value in force on the same call. */
export function selectionsWithValues(
  selects: readonly SteerSelection[],
  valuesInForce: Readonly<Record<string, unknown>>,
): readonly SteerSelection[] {
  return selects.map((one) => ({
    option: one.option,
    value: one.value !== undefined ? one.value : valuesInForce[one.option],
  }));
}

/**
 * The record of what changed (F107-FR-035): one entry per named option, with
 * the option and the value in force — the `changed` member of
 * `configuration.comment`, which the runtime reads for the key `changed` of
 * the line before the digest line.
 */
export function recordOfWhatChanged(
  selects: readonly SteerSelection[],
): readonly { readonly option: string; readonly value: unknown }[] {
  return selects.map((one) => ({ option: one.option, value: one.value }));
}
