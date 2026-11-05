/**
 * T014 — the preflight of a role (F131-FR-003).
 *
 * At auth tier 1 the preflight asks the login status command of the harness
 * and reads its exit code and its first line of output. At auth tier 2 it
 * asks the secret resolver whether the key reference exists. The adapter
 * NEVER opens, reads or copies the harness's credential file or key store,
 * and NEVER passes a credential in an argument list. The preflight makes no
 * model call. Its result is `present`, `absent` or `unprobed`; an exit code
 * the adapter does not know gives `unprobed`, never `present`.
 */

import { spawnSync } from "node:child_process";

/** The login status command of the harness (contracts/argument-table.json). */
export const CODEX_LOGIN_CHECK_COMMAND = ["login", "status"] as const;

/** The results of the preflight. */
export const PREFLIGHT_RESULTS = ["present", "absent", "unprobed"] as const;
export type PreflightResult = (typeof PREFLIGHT_RESULTS)[number];

/** The auth tiers the adapter runs at (F131-FR-001). */
export const AUTH_TIERS = [1, 2] as const;
export type AuthTier = 1 | 2;

/** The exit codes of the login status command the adapter knows. */
export const LOGIN_EXIT_CODES = { present: 0, absent: 1 } as const;

/** How the login status command runs; the default runs the real process. */
export type LoginRunner = (
  path: string,
  args: readonly string[],
) => { readonly code: number; readonly stdout: string } | null;

/** What the preflight of one role reports. */
export type Preflight = {
  readonly result: PreflightResult;
  /** The auth tier the preflight ran at. */
  readonly tier: AuthTier;
  /**
   * The commands the preflight ran — the proof that it made no model call:
   * the login status command at tier 1, and nothing at all at tier 2.
   */
  readonly invocations: readonly { readonly path: string; readonly args: readonly string[] }[];
  /** The first line of the login output, where a login command ran. */
  readonly firstLine: string | null;
};

/** The secret resolver of auth tier 2: existence only, never a value. */
export type SecretResolver = (reference: string) => boolean;

/** The variable that carries the API key at auth tier 2 (F131-FR-027). */
export const CODEX_KEY_VARIABLE = "OPENAI_API_KEY" as const;

/**
 * F131-FR-003 — run the preflight of one role at one auth tier.
 *
 * The credential file of the harness is never touched: at tier 1 only the
 * login status command is asked, and its exit code is the whole answer.
 * An exit code the adapter does not know — anything but 0 and 1, or a run
 * that failed to start — gives `unprobed`.
 */
export function runPreflight(input: {
  readonly tier: AuthTier;
  /** The harness executable; only run at tier 1. */
  readonly executable: string;
  /** Overrides the login runner, for tests. */
  readonly runLogin?: LoginRunner;
  /** The secret resolver of tier 2; existence only. */
  readonly secretResolver?: SecretResolver;
  /** The name of the key reference at tier 2; defaults to the as-is variable. */
  readonly keyReference?: string;
}): Preflight {
  if (input.tier === 2) {
    const resolver: SecretResolver =
      input.secretResolver ??
      ((reference) => {
        // Existence of the reference in the process environment: never a value.
        return typeof process.env[reference] === "string" && process.env[reference] !== "";
      });
    const reference = input.keyReference ?? CODEX_KEY_VARIABLE;
    return {
      result: resolver(reference) ? "present" : "absent",
      tier: 2,
      invocations: [],
      firstLine: null,
    };
  }
  const invocations: { path: string; args: string[] }[] = [];
  const runLogin: LoginRunner = input.runLogin ?? realLoginRunner;
  invocations.push({ path: input.executable, args: [...CODEX_LOGIN_CHECK_COMMAND] });
  const outcome = runLogin(input.executable, CODEX_LOGIN_CHECK_COMMAND);
  if (outcome === null) {
    return { result: "unprobed", tier: 1, invocations, firstLine: null };
  }
  let result: PreflightResult;
  if (outcome.code === LOGIN_EXIT_CODES.present) {
    result = "present";
  } else if (outcome.code === LOGIN_EXIT_CODES.absent) {
    result = "absent";
  } else {
    // An exit code the adapter does not know is `unprobed`, never `present`.
    result = "unprobed";
  }
  const firstLine = outcome.stdout.split("\n", 1)[0] ?? null;
  return { result, tier: 1, invocations, firstLine: firstLine === "" ? null : firstLine };
}

/** Real runner: spawn the login status command, no shell, output captured. */
function realLoginRunner(
  path: string,
  args: readonly string[],
): { readonly code: number; readonly stdout: string } | null {
  const result = spawnSync(path, [...args], { encoding: "utf8" });
  if (result.error !== undefined && result.error !== null) return null;
  return { code: result.status ?? -1, stdout: result.stdout ?? "" };
}
