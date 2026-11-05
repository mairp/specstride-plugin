/**
 * T051 — the modes, the mode map and the argument handling of `launch`
 * (F107-FR-032, F107-FR-034, F107-FR-035; contracts/commands.md, row
 * "`launch`").
 *
 * The rules, and where each lives:
 *
 * - `launch` launches by default: the mode is `run` unless an argument says
 *   otherwise (F107-FR-032);
 * - the modes are `run` and `dry-run`, given by `--mode` or by the alias
 *   `--dry-run`;
 * - `--launcher <path>` names the launcher this call runs, where the call
 *   names one; the path is taken as it is given (the CLI resolves it against
 *   the launchers the state holds);
 * - the as-is names map as DATA (`MODE_MAP`): `generate` to `dry-run`,
 *   `run` and `auto` to `run` (research.md row 4; DV-009);
 * - an explicit mode beats a selection by the comment (`--comment-selects
 *   mode`), and a selection by the comment beats the default;
 * - the CLI reads NO prose (F107-FR-032: the host reads the comment and
 *   passes the mode as the argument). A selection of the mode by the comment
 *   is accepted only on a call that also carries `--comment` (F107-FR-035);
 *   no comment turns `dry-run` into `run`: an absent comment changes nothing
 *   about an explicit `dry-run`;
 * - an unknown mode withholds the launch: the refusal `unknown-mode` with the
 *   code of a refusal (annex G §G.4), and NO launch record is written —
 *   the verb wiring calls the handshake of feature 122 only for a resolved
 *   mode (F107-FR-032).
 */
import { COMMENT_TEXT_CAP_BYTES, redactAndCutComment } from "../kernel.ts";

/** The two modes of `launch` (F107-FR-032). */
export const LAUNCH_MODES = ["run", "dry-run"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

/** The default mode: `launch` launches by default (F107-FR-032). */
export const DEFAULT_MODE: LaunchMode = "run";

/**
 * The mode map of the as-is names, as data (research.md row 4; DV-009):
 * `generate` to `dry-run`, `run` and `auto` to `run`. A mode of this map is
 * accepted wherever `--mode` takes a name; anything else is unknown.
 */
export const MODE_MAP: Readonly<Record<string, LaunchMode>> = Object.freeze({
  run: "run",
  auto: "run",
  generate: "dry-run",
  "dry-run": "dry-run",
});

/** The exit code of a refusal of `launch` (annex G §G.4, row "`launch`"). */
export const LAUNCH_REFUSED_EXIT = 4 as const;

/** The reason a launch with an unknown mode is refused with (F107-FR-032). */
export const REFUSAL_OF_AN_UNKNOWN_MODE = "unknown-mode" as const;

/** The usage error of `launch` (a flag given without its value, and the like). */
export const LAUNCH_USAGE_EXIT = 2 as const;

/** One refusal of the argument handling of `launch`. */
export type LaunchArgRefusal = {
  readonly reason:
    | typeof REFUSAL_OF_AN_UNKNOWN_MODE
    | "comment-selects-without-comment"
    | "usage"
    | "comment-changed";
  /** The code of the refusal: 4 for `unknown-mode`, 2 for a usage error. */
  readonly exit: typeof LAUNCH_REFUSED_EXIT | typeof LAUNCH_USAGE_EXIT;
  readonly message: string;
  /** The `next` of the refusal line, when the refusal has one. */
  readonly next?: string;
};

/** What the argument handling of `launch` produces. */
export type LaunchArgs = {
  /** The resolved mode; absent when the arguments carry a refusal. */
  readonly mode?: LaunchMode;
  /** Where the mode came from, for the report of `dry-run`. */
  readonly modeSource?: "argument" | "comment" | "default";
  /** The comment as typed, when one was given (F107-FR-034). */
  readonly comment?: string;
  /** The comment, redacted and cut, as it may be printed (F107-FR-034). */
  readonly commentShown?: string;
  /** The options the comment named (`--comment-selects`); `mode` only here. */
  readonly commentSelects?: readonly string[];
  /** `--new-run`. */
  readonly newRun?: boolean;
  /** `--json`. */
  readonly json?: boolean;
  /**
   * `--launcher <path>`: the launcher this call runs, where the call names
   * one. Where it names none, the launcher under the state of the pipeline
   * stands (`packages/cli/src/commands/launch.ts`).
   */
  readonly launcher?: string;
  /** The refusal, when the arguments carry one. */
  readonly refusal?: LaunchArgRefusal;
};

/** True when the text names a mode, as-is name included. */
export function isKnownModeName(text: string): boolean {
  return text in MODE_MAP;
}

/**
 * Resolve one `--mode` value through the mode map. An unknown name gives the
 * refusal `unknown-mode` with the code of a refusal of `launch` (F107-FR-032).
 */
export function resolveModeName(
  text: string,
): { mode: LaunchMode } | { refusal: LaunchArgRefusal } {
  const mode = MODE_MAP[text];
  if (mode !== undefined) return { mode };
  return {
    refusal: {
      reason: REFUSAL_OF_AN_UNKNOWN_MODE,
      exit: LAUNCH_REFUSED_EXIT,
      message: `launch: the mode "${text}" is not a mode of launch; the modes are run and dry-run`,
      next: "pass --mode run or --mode dry-run",
    },
  };
}

/** The flags of `launch` the argument handling reads (contracts/commands.md). */
const FLAGS_WITH_VALUE = new Set(["--mode", "--comment", "--comment-selects", "--launcher"]);

/**
 * Parse and resolve the arguments of `launch` (F107-FR-032, F107-FR-035).
 * Precedence: an explicit `--mode`/`--dry-run` beats a selection by the
 * comment, which beats the default `run`. `--comment-selects` without
 * `--comment` is refused (F107-FR-035). Nothing here reads prose.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
  let explicit: LaunchMode | undefined;
  let comment: string | undefined;
  let selects: string[] = [];
  let newRun = false;
  let json = false;
  let launcher: string | undefined;

  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === "--dry-run") {
      explicit = "dry-run";
      continue;
    }
    if (arg === "--new-run") {
      newRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) {
        return {
          refusal: {
            reason: "usage",
            exit: LAUNCH_USAGE_EXIT,
            message: `launch: ${arg} needs a value`,
          },
        };
      }
      at += 1;
      if (arg === "--mode") {
        const resolved = resolveModeName(value);
        if ("refusal" in resolved) return { refusal: resolved.refusal };
        explicit = resolved.mode;
        continue;
      }
      if (arg === "--comment") {
        comment = value;
        continue;
      }
      if (arg === "--launcher") {
        launcher = value;
        continue;
      }
      // --comment-selects: repeatable; the value is the option, `mode` only
      // here (F107-FR-035), with the mode it selected as `mode=<name>` — the
      // host reads the prose and passes the choice as data (F107-FR-032).
      if (value !== "mode" && !value.startsWith("mode=")) {
        return {
          refusal: {
            reason: "usage",
            exit: LAUNCH_USAGE_EXIT,
            message:
              `launch: --comment-selects ${value} is not an option of launch; ` +
              `launch accepts only mode`,
          },
        };
      }
      if (value.startsWith("mode=")) {
        const selected = resolveModeName(value.slice("mode=".length));
        if ("refusal" in selected) return { refusal: selected.refusal };
        selects = [...selects, `mode=${selected.mode}`];
      } else {
        selects = [...selects, value];
      }
      continue;
    }
    return {
      refusal: {
        reason: "usage",
        exit: LAUNCH_USAGE_EXIT,
        message: `launch: unknown argument ${arg}`,
      },
    };
  }

  if (selects.length > 0 && comment === undefined) {
    return {
      refusal: {
        reason: "comment-selects-without-comment",
        exit: LAUNCH_USAGE_EXIT,
        message: "launch: --comment-selects needs --comment",
      },
    };
  }

  // F107-FR-032 — an explicit mode beats a selection by the comment, which
  // beats the default `run`. No comment turns `dry-run` into `run`: an
  // absent comment changes nothing about the mode in force.
  const selection = selects.find((one) => one.startsWith("mode="));
  const mode: LaunchMode =
    explicit ?? (selection !== undefined ? (selection.split("=")[1] as LaunchMode) : DEFAULT_MODE);
  return {
    mode,
    modeSource:
      explicit !== undefined ? "argument" : selection !== undefined ? "comment" : "default",
    ...(comment === undefined ? {} : { comment }),
    ...(comment === undefined
      ? {}
      : { commentShown: redactAndCutComment(comment, COMMENT_TEXT_CAP_BYTES) }),
    ...(selects.length > 0 ? { commentSelects: selects } : {}),
    ...(newRun ? { newRun } : {}),
    ...(json ? { json } : {}),
    ...(launcher === undefined ? {} : { launcher }),
  };
}

/**
 * Compare the comment of the call with the hash a promoted launch contract
 * recorded (F107-FR-034): a difference — or one side with a comment and the
 * other without — is the refusal `comment-changed`, with the code of a
 * refusal of `launch`, and nothing starts.
 */
export function commentChanged(input: {
  comment?: string | undefined;
  recordedHash?: string | undefined;
  hashOf(text: string): string;
}): { changed: false } | { changed: true; refusal: LaunchArgRefusal } {
  const given = input.comment !== undefined && input.comment !== "";
  const recorded = input.recordedHash !== undefined && input.recordedHash !== "";
  if (
    given !== recorded ||
    (given && input.hashOf(input.comment as string) !== input.recordedHash)
  ) {
    return {
      changed: true,
      refusal: {
        reason: "comment-changed",
        exit: LAUNCH_REFUSED_EXIT,
        message: "launch: the comment of this call is not the comment the launch contract recorded",
        next: "pass the same --comment as the call of `contract derive`, or none",
      },
    };
  }
  return { changed: false };
}
