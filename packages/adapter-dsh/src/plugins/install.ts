/**
 * T057 — the installer call of the plugin request protocol
 * (F130-FR-032, F130-FR-033).
 *
 * The installer runs as the FIXED argument list
 * `<executable> plugin --profile <profile> add --save-exact <plugins...>`,
 * without a shell, with the configured time limit
 * (`harnesses.dsh.pluginTimeoutSec`, default 600). The time limit is a
 * watchdog of the adapter: an installer past it is killed, the request is
 * refused and no receipt is written.
 */
import { spawnSync } from "node:child_process";

/** The default time limit of the installer, in seconds (F130-FR-033). */
export const INSTALLER_TIMEOUT_DEFAULT_SEC = 600 as const;

/** The argv template of the installer, as F130-FR-032 states it. */
export const INSTALLER_ARGV_TEMPLATE: readonly string[] = Object.freeze([
  "{bin}",
  "plugin",
  "--profile",
  "{profile}",
  "add",
  "--save-exact",
  "{plugins...}",
]);

/** The fixed argument list of one install. */
export function installerArgv(input: {
  readonly bin: string;
  readonly profile: string;
  readonly plugins: readonly string[];
}): string[] {
  return [input.bin, "plugin", "--profile", input.profile, "add", "--save-exact", ...input.plugins];
}

/** The outcome of one installer run. */
export type InstallerRun =
  | { readonly ok: true; readonly exit: number }
  | {
      readonly ok: false;
      readonly cause: string;
      readonly kind: "failed" | "timed_out" | "not_started";
    };

/** The input of `runInstaller`. */
export type InstallerInput = {
  readonly argv: readonly string[];
  readonly timeoutSec: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
};

/**
 * Runs the installer with NO shell and the configured time limit
 * (F130-FR-032). Standard input is closed: the installer never waits on a
 * human. A time limit past is a killed installer, reported as `timed_out`.
 */
export function runInstaller(input: InstallerInput): InstallerRun {
  const [bin, ...args] = input.argv;
  if (bin === undefined) {
    return { ok: false, cause: "installer argument list is empty", kind: "not_started" };
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env ?? {})) {
    if (value !== undefined) env[name] = value;
  }
  const run = spawnSync(bin, args, {
    cwd: input.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: input.timeoutSec * 1000,
    shell: false,
  });
  if (run.error !== undefined && run.error !== null) {
    const timedOut = (run.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return timedOut
      ? { ok: false, cause: `installer timed out after ${input.timeoutSec}s`, kind: "timed_out" }
      : {
          ok: false,
          cause: `installer could not start: ${run.error.message}`,
          kind: "not_started",
        };
  }
  if (run.status === null) {
    return {
      ok: false,
      cause: `installer timed out after ${input.timeoutSec}s`,
      kind: "timed_out",
    };
  }
  if (run.status !== 0) {
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    return {
      ok: false,
      cause: `installer exited with ${run.status}${output !== "" ? `: ${output}` : ""}`,
      kind: "failed",
    };
  }
  return { ok: true, exit: run.status };
}
