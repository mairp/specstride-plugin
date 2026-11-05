/**
 * T023 — the exit path of the front door (F119-FR-011).
 *
 * The front door ends with the code of the command it ran: the engine's code
 * for `run`, and for every other command the code of its row in annex G
 * §G.4. An error that nothing catches, in ANY command, ends 70 — Lisa's rule,
 * which the baseline is silent on. In default output the uncaught path prints
 * ONE product line with the reason `internal` and no stack trace unless
 * `--verbose` is given; in compatibility output it prints no line that has no
 * as-is equivalent (F119-FR-029), so it prints nothing.
 */
// F119-FR-015 — the product-line modules load on the error path only, so a
// successful read command never pays for them.
import type { FailureReason } from "../output/closed-sets.ts";

/** The exit of an error that nothing catches (F119-FR-011). */
export const UNCAUGHT_EXIT = 70 as const;

/** The reason the uncaught path reports (a member of the closed set). */
export const INTERNAL_REASON: FailureReason = "internal";

/** The streams and the mode the exit path writes with; injectable. */
export type ExitIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

/** The one product line of the uncaught path in default output (F119-FR-011). */
export async function internalErrorLine(cmd: string): Promise<string> {
  const { errorLine } = await import("../output/lines.ts");
  return errorLine(cmd, INTERNAL_REASON);
}

/**
 * F119-FR-011 — run one command of the front door and end with its code;
 * an error nothing catches ends 70. `verbose` is `--verbose` of the call:
 * with it the stack of the error is printed, without it never.
 */
export async function runCommand(
  cmd: string,
  run: () => number | Promise<number>,
  options?: {
    readonly io?: ExitIo;
    readonly verbose?: boolean | undefined;
    readonly mode?: "compat" | "default" | undefined;
  },
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    const io = options?.io ?? defaultIo();
    if (options?.mode !== "compat") {
      io.err(`${await internalErrorLine(cmd)}\n`);
      if (options?.verbose === true) {
        io.err(`${(error instanceof Error && error.stack) || String(error)}\n`);
      }
    }
    return UNCAUGHT_EXIT;
  }
}

/** The default product line's fix text, for the tests of the closed set. */
export async function internalFixText(): Promise<string> {
  const { fixTextOf } = await import("../output/closed-sets.ts");
  return fixTextOf(INTERNAL_REASON);
}

function defaultIo(): ExitIo {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
  };
}
