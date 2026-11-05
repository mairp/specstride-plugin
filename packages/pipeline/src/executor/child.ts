/**
 * T014 — the stage child runner (F123-FR-011).
 *
 * One stage attempt runs its action from a fixed argument list without a
 * shell, in the working directory of the stage, with standard input closed
 * and in a process session of its own.
 *
 * Streams of a stage of kind `specstride`: shown as the child produced it —
 * with a terminal when colour is on and standard output is not a terminal
 * (the `script` tool of the platform; the product ships none), else through a
 * pipe, echoed and logged with escape sequences removed. Where no terminal
 * can be given the child runs through the pipe as with colour off, the run
 * goes on, and the pipeline entry prints one `[WARN]` line that names the
 * missing tool; the absence never fails a stage, a preflight or a launch
 * check. Every other kind inherits the streams and is not logged.
 *
 * An action that exceeds its time limit (default 3,600 seconds) gets the
 * termination signal to its process group and the kill signal after 5
 * seconds; the child code is 124 and the stage reason `timeout`. An action
 * that cannot start has the child code 127 and the reason `exec-error:`.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** The kill grace after the termination signal, in seconds. */
export const KILL_AFTER_SECONDS = 5;

/** The default time limit of an action, in seconds. */
export const DEFAULT_TIME_LIMIT_SECONDS = 3_600;

/** The child code of a timed-out action. */
export const TIMEOUT_EXIT_CODE = 124;

/** The child code of an action that cannot start. */
export const EXEC_ERROR_EXIT_CODE = 127;

/** How the streams of an attempt are wired. */
export type StreamMode = "terminal" | "pipe" | "inherited";

/**
 * The stream mode of one attempt: `terminal` for a `specstride` stage with
 * colour on and standard output not a terminal, `pipe` otherwise for that
 * kind, `inherited` for every other kind.
 */
export function streamMode(input: {
  kind: string;
  colourOn: boolean;
  stdoutIsTerminal: boolean;
}): StreamMode {
  if (input.kind !== "specstride") return "inherited";
  if (input.colourOn && !input.stdoutIsTerminal) return "terminal";
  return "pipe";
}

/** The result of one attempt, as the retry driver sees it. */
export type ChildRun = {
  code: number;
  signal: string | null;
  timedOut: boolean;
  error?: string;
};

/** The injectable spawner: the real `spawn` of the platform, or a test double. */
export type SpawnFunction = (
  file: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env: Record<string, string>;
    stdio: ["ignore", "inherit" | "pipe", "inherit" | "pipe"];
    detached: true;
  },
) => ChildProcess;

/**
 * The kill of a timed-out child: the termination signal to its process
 * group, then the kill signal after 5 seconds (F123-FR-011). The group id is
 * refused unless it is an integer above one (the ruling on process signals).
 */
export function signalTimedOutChild(
  child: ChildProcess,
  kill: (pid: number, signal: number) => void,
  graceSeconds: number = KILL_AFTER_SECONDS,
): NodeJS.Timeout {
  const group = child.pid;
  if (typeof group === "number" && Number.isInteger(group) && group > 1) {
    kill(-group, 15); // SIGTERM to the process group
  }
  return setTimeout(() => {
    if (typeof group === "number" && Number.isInteger(group) && group > 1) {
      try {
        kill(-group, 9); // SIGKILL after 5 seconds
      } catch {
        /* already gone */
      }
    }
  }, graceSeconds * 1_000);
}

/**
 * Run one stage attempt. `spawnFn` is injectable; `hasTerminalTool` says
 * whether the platform offers `script` (probed once by the caller); when the
 * mode is `terminal` but the tool is absent, the child runs through the pipe
 * and the returned `warn` names the missing tool (F123-FR-011).
 */
export async function runStageChild(input: {
  argv: readonly string[];
  cwd?: string;
  env: Record<string, string>;
  kind: string;
  colourOn: boolean;
  stdoutIsTerminal: boolean;
  timeLimitSeconds?: number;
  hasTerminalTool?: boolean;
  spawnFn?: SpawnFunction;
  log?: (line: string) => void;
}): Promise<ChildRun & { warn?: string }> {
  const spawnFn: SpawnFunction = input.spawnFn ?? spawn;
  const wanted: StreamMode = streamMode({
    kind: input.kind,
    colourOn: input.colourOn,
    stdoutIsTerminal: input.stdoutIsTerminal,
  });
  let warn: string | undefined;
  let mode: StreamMode = wanted;
  if (wanted === "terminal" && input.hasTerminalTool === false) {
    mode = "pipe";
    warn = "terminal tool `script` not available; running the stage through a pipe";
  }
  // The argument array is fixed, the shell is never used, standard input is
  // closed, and the child sits in a process session of its own (F123-FR-011).
  const stdio: ["ignore", "inherit" | "pipe", "inherit" | "pipe"] =
    mode === "inherited" ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"];
  const child = spawnFn(input.argv[0], input.argv.slice(1), {
    cwd: input.cwd,
    env: input.env,
    stdio,
    detached: true,
  });

  const limitMs = (input.timeLimitSeconds ?? DEFAULT_TIME_LIMIT_SECONDS) * 1_000;
  let timedOut = false;
  let killer: NodeJS.Timeout | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    killer = signalTimedOutChild(child, (pid, signal) => process.kill(pid, signal));
  }, limitMs);

  if (mode === "pipe") {
    const strip = (text: string): string =>
      text.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      process.stdout.write(strip(chunk));
      input.log?.(strip(chunk));
    });
    child.stderr?.on("data", (chunk: string) => {
      process.stderr.write(strip(chunk));
      input.log?.(strip(chunk));
    });
  }

  const result = await new Promise<ChildRun>((resolve) => {
    let errorCause: string | undefined;
    child.once("error", (error: NodeJS.ErrnoException) => {
      errorCause = error.code === "ENOENT" ? `${input.argv[0]}: command not found` : error.message;
    });
    child.once("close", (code: number | null, signal: string | null) => {
      if (errorCause !== undefined && code === null) {
        resolve({ code: EXEC_ERROR_EXIT_CODE, signal: null, timedOut: false, error: errorCause });
        return;
      }
      if (timedOut) {
        resolve({
          code: TIMEOUT_EXIT_CODE,
          signal,
          timedOut: true,
          error: `timeout after ${limitMs / 1_000}s`,
        });
        return;
      }
      resolve({ code: code ?? 1, signal, timedOut: false });
    });
  });

  clearTimeout(timer);
  if (killer !== undefined) clearTimeout(killer);
  return { ...result, warn };
}
