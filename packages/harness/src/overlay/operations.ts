/**
 * T087 — the overlay operations and their result codes (F109-FR-034).
 *
 * The six operations `scope`, `populate`, `remove`, `reap`, `sweep` and
 * `startup` are internal operations of the harness layer, each returning a
 * result record whose field `exit_code` carries the code of the as-is
 * process. `scope` and `startup` return 3 for an invalid declaration or
 * scope value. `populate` fills an existing empty directory and returns 1 on
 * failure after the as-is message. `remove`, `reap` and `sweep` always
 * return 0. When the directory of an overlay cannot be created, the message
 * carries the cause `mktemp failed` and the pass fails. The pass loop ends
 * with the code of `startup` when `startup` fails, and with 1 when the
 * overlay of scope `attempt` cannot be created or populated. With an overlay
 * of scope `attempt`, and with no other scope, an interrupt ends the pass
 * loop with 130 and a request to terminate with 143.
 */
import {
  resolveScopes,
  startup,
  type OverlayScope,
  type ScopeResult,
  type StartupResult,
} from "./scope.ts";
import { populateFailureMessage, buildOverlay, type BuildOutcome } from "./build.ts";
import { reap, sweep } from "./sweep.ts";
import { releaseOverlay, type ReleaseResult } from "./lifecycle.ts";
import type { AcceptedDeclaration, DeclarationEntry } from "./declaration.ts";

/** The names of the six internal overlay operations. */
export const OVERLAY_OPERATIONS = [
  "scope",
  "populate",
  "remove",
  "reap",
  "sweep",
  "startup",
] as const;
export type OverlayOperationName = (typeof OVERLAY_OPERATIONS)[number];

/** The result codes of the pass loop (F109-FR-034). */
export const PASS_LOOP_CODES = {
  startupFailed: 3,
  internalFailure: 1,
  interruptWithAttemptScope: 130,
  terminateWithAttemptScope: 143,
} as const;

/** The union of result records the six operations return. */
export type OverlayOperationResult =
  | ScopeResult
  | StartupResult
  | PopulateResult
  | (ReleaseResult & { readonly operation: "remove" })
  | {
      readonly operation: "reap" | "sweep";
      readonly exit_code: 0;
      readonly removed: readonly string[];
      readonly lines: readonly string[];
    };

/** The result record of `populate` (F109-FR-034). */
export type PopulateResult =
  | {
      readonly operation: "populate";
      readonly exit_code: 0;
      readonly root: string;
      readonly env: Record<string, string>;
    }
  | {
      readonly operation: "populate";
      readonly exit_code: 1;
      readonly message: string;
    };

/** `scope`, with its quiet mode (F109-FR-034). */
export function operationScope(
  entries: readonly DeclarationEntry[],
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly quiet?: boolean } = {},
): ScopeResult {
  return resolveScopes(entries, env, options);
}

/** `startup`, which sweeps, validates and returns the scope word. */
export function operationStartup(
  entries: readonly DeclarationEntry[],
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly quiet?: boolean; readonly tmpDir?: string } = {},
): StartupResult {
  return startup(entries, env, options);
}

/**
 * `populate` — fills an existing empty directory for a scope, an owner and a
 * working directory; returns 1 on failure after the as-is message.
 */
export function operationPopulate(input: {
  readonly declaration: AcceptedDeclaration;
  readonly scope: OverlayScope;
  readonly ownerPid: number;
  readonly ownerStart: string | number | null;
  readonly workDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly component?: string;
  readonly tmpRoot?: string;
}): PopulateResult {
  const outcome: BuildOutcome = buildOverlay({
    declaration: input.declaration,
    scopeWord: input.scope,
    ownerPid: input.ownerPid,
    ownerStart: input.ownerStart,
    env: input.env,
    tmpRoot: input.tmpRoot,
    component: input.component ?? "specstride",
  });
  if (outcome.ok) {
    return { operation: "populate", exit_code: 0, root: outcome.root, env: outcome.env };
  }
  return { operation: "populate", exit_code: 1, message: outcome.message };
}

/** The as-is populate failure message, exported for the parity tests. */
export { populateFailureMessage };

/** `remove` — always 0 (F109-FR-034). */
export function operationRemove(root: string): ReleaseResult & { readonly operation: "remove" } {
  const outcome = releaseOverlay(root);
  return { operation: "remove", ...outcome };
}

/** `reap` — always 0 (F109-FR-034). */
export function operationReap(options: {
  readonly tmpDir?: string;
  readonly ownerPid: number;
  readonly scope?: string;
}): {
  readonly operation: "reap";
  readonly exit_code: 0;
  readonly removed: readonly string[];
  readonly lines: readonly string[];
} {
  const outcome = reap(options);
  return { ...outcome, operation: "reap" as const };
}

/** `sweep` — always 0 (F109-FR-034). */
export function operationSweep(options: { readonly tmpDir?: string } = {}): {
  readonly operation: "sweep";
  readonly exit_code: 0;
  readonly removed: readonly string[];
  readonly lines: readonly string[];
} {
  const outcome = sweep(options);
  return { ...outcome, operation: "sweep" as const };
}

/**
 * F109-FR-034 — the exit code of the pass loop for a signal, with an overlay
 * of scope `attempt` and with no other scope: an interrupt ends the loop
 * with 130, a request to terminate with 143. Every other scope re-raises the
 * default disposition (null: not overridden).
 */
export function signalExitCode(scope: OverlayScope, signal: "SIGINT" | "SIGTERM"): number | null {
  if (scope !== "attempt") return null;
  return signal === "SIGINT" ? 130 : 143;
}

/**
 * F109-FR-034 — the code the pass loop ends with on a failed start-up or a
 * failed overlay: the code of `startup` when `startup` fails (3, or 1 for an
 * internal failure), after the fast exit on existing phase evidence and
 * before the first pass; 1 when the overlay of scope `attempt` cannot be
 * created or populated.
 */
export function passLoopExitCode(input: {
  readonly startupFailed?: boolean;
  readonly startupCode?: number;
  readonly attemptOverlayFailed?: boolean;
}): number | null {
  if (input.startupFailed) return input.startupCode ?? PASS_LOOP_CODES.startupFailed;
  if (input.attemptOverlayFailed) return PASS_LOOP_CODES.internalFailure;
  return null;
}
