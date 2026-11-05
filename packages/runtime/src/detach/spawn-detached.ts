/**
 * T040 — the strategy `spawn-detached`, the default of EP-17 (F122-FR-001,
 * F122-FR-002, F122-FR-003; annex F §F.6; research D-7).
 *
 * It is built ON TOP of `startDetached` of the kernel primitive (T075) and
 * starts no process itself. That is the point of D-7: the knowledge of how a
 * process is detached on this platform lives in ONE place, the kernel, and
 * this module is the run policy around it — which log, which environment,
 * which tokens. `node:child_process` is not imported here, and a test greps
 * for exactly that.
 *
 * What the kernel guarantees, so that this module need not ask for it
 * (`@specstride/contracts/ep/kernel-services`): a group and a session of its
 * own, standard input on the null device, no shell. Those are properties of
 * the primitive and not options of a call.
 *
 * What this module adds, which is the list F122-FR-001 and the task give:
 *
 *   - **the runtime log on both outputs**: standard output and standard error
 *     are APPENDED to `launch:<launchId>:runtime-log`, resolved from the layout
 *     table and never written out as a path here;
 *   - **the environment allow-list**: the environment of the root holds only
 *     the names the allow-list of the call gives — every other name of this
 *     process's environment is dropped, which is the difference between an
 *     allow-list and a deny-list;
 *   - **the run token and the launch id in the environment**: so that the
 *     identity check of the process registry can find the processes of this
 *     launch (F122-FR-024), and so that the root knows which launch record it
 *     is answering.
 */
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import {
  NO_SHELL_IS_USED,
  STANDARD_INPUT_IS_CLOSED,
  STARTS_IN_A_SESSION_OF_ITS_OWN,
  type ProcessPrimitive,
} from "@specstride/contracts/ep/kernel-services";
import {
  DEFAULT_STRATEGY,
  STRATEGY_WITHOUT_DETACHING,
  type AvailableResult,
  type DetachStrategy,
  type StartInput,
  type StartedProcess,
  type StrategyDescription,
} from "@specstride/contracts/ep/detach";
import { processPrimitive } from "@specstride/kernel";
import type { LockPlace } from "../lock/paths.ts";
import { RUN_TOKEN_VAR, type MintedToken } from "../procs/run-token.ts";

/** The requirements this strategy carries. */
export const SPAWN_DETACHED_REQUIREMENTS = ["F122-FR-001", "F122-FR-002", "F122-FR-003"] as const;

/** The decision of `research.md` this strategy follows. */
export const SPAWN_DETACHED_DECISION = "D-7" as const;

/** The id of the strategy. It is the default (annex F §F.6). */
export const STRATEGY_ID = DEFAULT_STRATEGY;

/**
 * D-7 — the detach is the kernel's. This module names no platform call of its
 * own, and the constant is what a test asserts against the source.
 */
export const BUILT_ON = "startDetached of the process primitive of the kernel" as const;
export const IMPORTS_CHILD_PROCESS = false as const;

/** The logical name of the runtime log (annex B, §B.5; F122-FR-001). */
export const RUNTIME_LOG_LOGICAL_NAME = "launch:<launchId>:runtime-log" as const;

/** The logical name of the status record the kernel's waiter writes. */
export const STATUS_RECORD_FILE = "runtime.status.json" as const;

/** The name the launch id is carried under in the environment of the root. */
export const LAUNCH_ID_VAR = "SPECSTRIDE_LAUNCH_ID" as const;

/** And the launch nonce, which the root writes into its lease (F122-FR-005). */
export const LAUNCH_NONCE_VAR = "SPECSTRIDE_LAUNCH_NONCE" as const;

/**
 * The two names this strategy adds to the environment beyond the run token.
 * They are not part of the allow-list a caller gives: the allow-list says
 * which of the CALLER's environment survives, and these are values of the
 * launch itself.
 */
export const VARIABLES_OF_THE_LAUNCH = [LAUNCH_ID_VAR, LAUNCH_NONCE_VAR] as const;

/**
 * F122-FR-003 — what `spawn-detached` survives, as the closed subset of
 * `parent-end`, `session-end`, `reboot`. No Wave 1 strategy claims `reboot`.
 *
 * This is the strategy's DESIGN CLAIM and not a measurement. Whether the claim
 * holds on a given host is a FACT of the spike, and the doctor reports that
 * separately: on a host without a fact of the spike the doctor says survival
 * of the end of a session is unverified (F122-FR-041,
 * `../doctor/detach-checks.ts`). A `describe` that lied about the design would
 * make the registry useless; a `describe` that reported the verification
 * status would make every host's answer differ, which is the doctor's job.
 */
export const SURVIVES = Object.freeze({
  endOfTheParent: true,
  endOfTheHostSession: true,
  reboot: false,
});

/** What the strategy needs of its launch, beyond the inputs of EP-17 §F.6. */
export type SpawnDetachedContext = {
  readonly place: LockPlace;
  readonly launchId: string;
  /** The run token of this launch; its secret reaches the environment only. */
  readonly runToken: MintedToken;
  /** Where the root is started; the control root's workspace by default. */
  readonly cwd?: string | undefined;
  /** The environment the allow-list is applied to; this process's by default. */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  /** The primitive; a test hands in its own (T075). */
  readonly primitive?: ProcessPrimitive | undefined;
};

/** The paths of one launch under the control root (annex B, §B.5). */
export function runtimeLogPathOf(place: LockPlace, launchId: string): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  return resolve(RUNTIME_LOG_LOGICAL_NAME, { "<launchId>": launchId }, roots);
}

/** The status record of the kernel's waiter, beside the runtime log. */
export function statusRecordPathOf(place: LockPlace, launchId: string): string {
  const log = runtimeLogPathOf(place, launchId);
  return log.replace(/[^/]+$/, STATUS_RECORD_FILE);
}

/**
 * F122-FR-001 — the environment of the root: **only** the names of the
 * allow-list, plus the run token and the two values of the launch.
 *
 * An allow-list and not a deny-list: a name that is not listed is absent, so a
 * variable a consumer's shell happens to export can never reach the root. A
 * listed name that this process does not hold is absent too, rather than empty
 * — an empty value is a value, and a consumer who reads `LANG=""` is told
 * something false.
 */
export function environmentOfTheRoot(input: {
  readonly allowList: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly launchId: string;
  readonly launchNonce: string;
  readonly runToken: MintedToken;
}): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of input.allowList) {
    const value = input.environment[name];
    if (typeof value === "string") out[name] = value;
  }
  out[LAUNCH_ID_VAR] = input.launchId;
  out[LAUNCH_NONCE_VAR] = input.launchNonce;
  // Last, and through the minted token's own accessor: the secret exists in
  // this object and in no record, no log and no argument list (F122-FR-024).
  out[RUN_TOKEN_VAR] = input.runToken.secret();
  return Object.freeze(out);
}

/** The names the environment of the root holds, for a reader that asks. */
export function namesOfTheEnvironment(allowList: readonly string[]): readonly string[] {
  return Object.freeze([...allowList, LAUNCH_ID_VAR, LAUNCH_NONCE_VAR, RUN_TOKEN_VAR]);
}

/** §F.6 — the error of a strategy that cannot start the root. */
export class DetachUnavailableError extends Error {
  readonly error = "unavailable" as const;
  readonly refusal = "detach-unavailable" as const;
  /** §F.6 — the message names `foreground` as the way to run without detaching. */
  readonly namesTheStrategy = STRATEGY_WITHOUT_DETACHING;
  constructor(detail: string) {
    super(
      `the detach strategy \`${STRATEGY_ID}\` could not start the runtime root: ${detail}. ` +
        `Run without detaching with the strategy \`${STRATEGY_WITHOUT_DETACHING}\``,
    );
    this.name = "DetachUnavailableError";
  }
}

/**
 * Build the strategy over one launch. It is a factory and not a module-level
 * object because the runtime log, the run token and the launch id are of the
 * launch and not of the process: a strategy registered once and started twice
 * would otherwise write the second root's output into the first one's log.
 */
export function createSpawnDetachedStrategy(context: SpawnDetachedContext): DetachStrategy {
  const primitive = context.primitive ?? processPrimitive;
  return Object.freeze({
    available(): AvailableResult {
      // The kernel's primitive is always there; what can fail is the log, and
      // that is the control root's writability, which the launch checks
      // already cover (F122-FR-039). So `available` reports yes with the
      // reason, and a real failure arrives as `start` throwing.
      return Object.freeze({
        available: true,
        reason:
          `\`${STRATEGY_ID}\` starts the runtime root through ${BUILT_ON}; the platform offers ` +
          `it on this host`,
      });
    },

    async start(input: StartInput): Promise<StartedProcess> {
      if (input.runtimeEntry.length === 0) {
        throw new DetachUnavailableError("the runtime entry is an empty argument list");
      }
      if (input.runtimeLogLogicalName !== RUNTIME_LOG_LOGICAL_NAME) {
        throw new DetachUnavailableError(
          `the runtime log must be named by the logical name ` +
            `\`${RUNTIME_LOG_LOGICAL_NAME}\` and not \`${input.runtimeLogLogicalName}\` ` +
            `(annex B, §B.5)`,
        );
      }
      const log = runtimeLogPathOf(context.place, context.launchId);
      const environment = environmentOfTheRoot({
        allowList: input.environmentAllowList,
        environment: context.environment ?? process.env,
        launchId: context.launchId,
        launchNonce: input.launchNonce,
        runToken: context.runToken,
      });
      let started;
      try {
        started = await primitive.startDetached({
          argv: input.runtimeEntry,
          cwd: context.cwd ?? context.place.workspaceRealPath,
          env: environment,
          // F122-FR-001 — BOTH outputs on the runtime log, appended. The
          // kernel opens each with `a`, so two launches never truncate one
          // another's log and the order of lines is the order they were written.
          stdoutFile: log,
          stderrFile: log,
          statusFile: statusRecordPathOf(context.place, context.launchId),
        });
      } catch (error) {
        throw new DetachUnavailableError(error instanceof Error ? error.message : String(error));
      }
      return Object.freeze({
        pid: started.pid,
        startTime: new Date(started.startedAtMs).toISOString(),
        // The kernel calls `setsid`: the started process leads the new session
        // (`STARTS_IN_A_SESSION_OF_ITS_OWN` of the primitive's own contract).
        sessionLeader: STARTS_IN_A_SESSION_OF_ITS_OWN,
      });
    },

    describe(): StrategyDescription {
      return Object.freeze({ id: STRATEGY_ID, survives: SURVIVES });
    },
  });
}

/** The three guarantees this strategy takes from the primitive, as data. */
export const TAKEN_FROM_THE_PRIMITIVE = Object.freeze({
  aSessionOfItsOwn: STARTS_IN_A_SESSION_OF_ITS_OWN,
  standardInputClosed: STANDARD_INPUT_IS_CLOSED,
  noShell: NO_SHELL_IS_USED,
});
