/**
 * T040 — the invocation of a critic call (F130-FR-021, with F130-FR-022 to
 * F130-FR-029).
 *
 * The call starts the executable as
 * `<executable> --profile <profile> --patch <patch file> -- <task arguments>`
 * and takes standard output as the reply. Under the `parity` profile the
 * working directory is the one the engine hands over, as at the baseline;
 * outside the profile it is an EMPTY directory made for the call (the
 * placeholder `{emptyTmp}`), so the critic cannot read the project even if a
 * tool were to remain. The environment carries the permission mode `read-only`
 * of F130-FR-022 and the home (the throwaway home when a model override
 * exists, F130-FR-028). The process runs in a PROCESS GROUP OF ITS OWN
 * (`detached`) and MUST end with its call: the time limit ends it, and the
 * patch file and the working directory are removed on every arm, a kill
 * included.
 *
 * Before the call, under the proof switch `strict`, the coverage check of
 * F130-FR-024 and the version pin of F130-FR-025 refuse the role with
 * `critic_not_toolless`; under `parity` the switch is `none` and no proof is
 * made (row 117). A prompt is split at spaces (F130-FR-027, shared with the
 * proposer); a non-zero exit, an empty standard output, a time limit and a
 * launcher that cannot start fail the call as F130-FR-026 says.
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statSync } from "node:fs";
import {
  resolveExecutable,
  searchDirsFromPath,
  EXECUTABLE_NOT_FOUND_CODE,
} from "@specstride/harness";
import { resolveCriticSettings, type CriticSettings } from "./settings.ts";
import { resolveCriticModel, buildCriticOverlay } from "./model.ts";
import { resolveCriticWindow } from "./window.ts";
import { writeCriticPatch, type CriticPatchFile } from "./patch.ts";
import {
  enumerateDshToolIds,
  checkCriticCoverage,
  checkCriticVersionPin,
  buildCriticProof,
  CRITIC_NOT_TOOLLESS,
  type CriticProofRecord,
} from "../coverage/index.ts";
import {
  criticNonZeroExitMessage,
  criticEmptyStdoutMessage,
  criticTimeoutMessage,
  criticLaunchMessage,
} from "./errors.ts";
import { splitPromptAtSpaces, PromptTooLargeError } from "../proposer/chunks.ts";
import { resolvePermissionMode, type ConfigOrigin } from "../proposer/permission.ts";
import {
  runChildUnderTimeLimit,
  type RunSupervisionFacts,
  type AsyncRunInput,
} from "../proposer/index.ts";
import { DSH_NOT_FOUND_PREFIX, probeDshVersion } from "../detect/index.ts";
import type { DshOverlay } from "../overlay/index.ts";
import { resolveDshSettings, type ConfigSource } from "../proposer/settings.ts";
import type { BareModelRow } from "../model/index.ts";

/** The argv template of the critic role, as the argument table states it. */
export const CRITIC_ARGV_TEMPLATE: readonly string[] = Object.freeze([
  "{bin}",
  "--profile",
  "{profile}",
  "--patch",
  "{file:criticPatch}",
  "--",
  "{promptChunks...}",
]);

/** The environment variable the permission mode `read-only` is exported under. */
export const CRITIC_PERMISSION_ENV = "DSH_PERMISSION_MODE" as const;

/** The name prefix of the empty working directory made outside `parity`. */
export const CRITIC_EMPTY_CWD_PREFIX = "specstride-dsh-critic." as const;

/** The argument list of one critic call (F130-FR-021). */
export function criticArgv(input: {
  readonly bin: string;
  readonly profile: string;
  readonly patchPath: string;
  readonly chunks: readonly string[];
}): string[] {
  return [input.bin, "--profile", input.profile, "--patch", input.patchPath, "--", ...input.chunks];
}

/** The outcome of a critic call. */
export type CriticRun =
  | {
      readonly ok: true;
      /** The reply: standard output of the process (F130-FR-021). */
      readonly reply: string;
      readonly status: number;
      readonly argv: string[];
      readonly cwd: string;
      readonly permissionMode: "read-only";
      readonly patchHash: string;
      readonly patchLogicalName: string;
      readonly proof: CriticProofRecord;
      readonly overlay: string | null;
      readonly window: number | null;
    }
  | {
      readonly ok: false;
      readonly refused: typeof CRITIC_NOT_TOOLLESS;
      readonly message: string;
      readonly proof: CriticProofRecord | null;
    }
  | { readonly ok: false; readonly code: 127; readonly message: string }
  | {
      readonly ok: false;
      readonly result: 1;
      readonly message: string;
      readonly stopReason?: "critic_unavailable";
    };

/** The input of one critic call. */
export type CriticCallInput = {
  /** The prompt of the critic; split at spaces (F130-FR-027). */
  readonly prompt: string;
  /** The working directory the engine hands over (used under `parity`). */
  readonly cwd: string;
  /** The id of the pass, for the logical name of the patch file. */
  readonly passId?: string;
  /** A model override: the flag, the setting and the qualifier, in that role. */
  readonly model?: {
    readonly flag?: string | null;
    readonly qualifier?: string | null;
  };
  /** Rows of `harnesses.dsh.modelProviders` (user configuration or a fixture). */
  readonly modelProviders?: readonly BareModelRow[];
  /** Where the executable lives: the real search path, before any overlay. */
  readonly path?: string;
  /** The workspace root handed to the seam resolver. */
  readonly workspaceRoot?: string | null;
  /** The environment of the consumer (the as-is aliases are read from it). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Overrides for tests: the configuration source of the settings. */
  readonly config?: ConfigSource;
  /** The proposer fallbacks of F130-FR-022 (model, provider, effort). */
  readonly proposerFallback?: {
    readonly model?: string | null;
    readonly provider?: string | null;
    readonly effort?: string | null;
  };
  /** A permission mode the consumer configured: NEVER lifted for the critic. */
  readonly configuredMode?: { readonly mode: string; readonly origin: ConfigOrigin };
  /** The `--version` probe of the seam (a test overrides it). */
  readonly probeVersion?: (path: string) => string | null;
  /** The script steps of the stub, as a test plays them. */
  readonly script?: string;
  /** The time limit of the call, in milliseconds (F130-FR-026). */
  readonly timeoutMs?: number;
  /** `roles.critic.contextTokens` and `harnesses.dsh.contextWindows` (F130-FR-029). */
  readonly contextTokens?: number | null;
  readonly contextWindows?: Readonly<Record<string, number>>;
  /** The effective window of a gateway in front of the model, where known. */
  readonly effectiveWindow?: number | null;
};

/**
 * Runs one critic call (F130-FR-021 to F130-FR-029). Order: settings, then
 * permission mode, then the model reference, then detection, then (under
 * `strict`) the pin and the coverage check, then the patch file, then the
 * process. Every temporary thing — patch file, overlay, empty working
 * directory — is removed on every arm, a time limit included.
 */
/**
 * What preparation of a critic call hands the process runner: the argv, the
 * overlaid environment, the working directory, the proof finaliser and the
 * disposal of every temporary thing (patch file, overlay, empty working
 * directory), to be run on every arm, a kill included.
 */
type PreparedCriticCall =
  | {
      readonly ok: true;
      readonly argv: string[];
      readonly env: Record<string, string>;
      readonly cwd: string;
      readonly mode: "read-only";
      readonly patch: CriticPatchFile;
      readonly overlay: DshOverlay | null;
      readonly window: number | null;
      readonly finalizeProof: (patchHash: string) => CriticProofRecord;
      readonly dispose: () => void;
    }
  | Extract<CriticRun, { readonly ok: false }>;

function prepareDshCriticCall(input: CriticCallInput): PreparedCriticCall {
  const settings: CriticSettings = resolveCriticSettings(
    input.config ?? { env: input.env ?? {} },
    input.proposerFallback ?? {},
  );
  // F130-FR-022: the permission mode `read-only` is exported to EVERY critic
  // call, whatever the setting of the proposer. A configured mode cannot
  // lift it: the decision is recomputed and its stated mode is discarded.
  resolvePermissionMode({ role: "proposer", configured: input.configuredMode });
  const mode = settings.permissionMode;

  // F130-FR-028: the reference rules of the proposer, with the critic
  // settings and their fallbacks. A reference error fails the call. Where the
  // engine hands no proposer fallback, the settings of the proposer of the
  // same configuration source stand in (F130-FR-022: the model, the provider
  // and the effort of the proposer are the fallbacks of the critic).
  const fallback =
    input.proposerFallback ??
    (() => {
      const proposer = resolveDshSettings(input.config ?? { env: input.env ?? {} });
      return {
        model: proposer.model,
        provider: proposer.provider,
        effort: proposer.effort,
      };
    })();
  const model = resolveCriticModel(
    {
      flag: input.model?.flag ?? null,
      setting: settings.model,
      qualifier: input.model?.qualifier ?? null,
      providerSetting: settings.provider,
      modelProviders: input.modelProviders,
    },
    fallback,
  );
  if (!model.ok) {
    return { ok: false, result: 1, message: model.message, stopReason: "critic_unavailable" };
  }

  // F130-FR-029: the window. Under `parity` an unknown model gets the
  // default; outside it an unknown model is an error of the call.
  const windowResolution = resolveCriticWindow({
    reference: model.reference,
    criticContextTokens: input.contextTokens ?? settings.contextTokens,
    contextWindows: input.contextWindows,
    profile: settings.profile,
    effectiveWindow: input.effectiveWindow,
  });
  if (!windowResolution.ok) {
    return {
      ok: false,
      result: 1,
      message: windowResolution.message,
      stopReason: "critic_unavailable",
    };
  }

  // Detection before anything is built (F130-FR-009's rule for every role).
  const dirs = searchDirsFromPath(input.path ?? input.env?.PATH ?? process.env.PATH ?? "");
  const resolved = resolveExecutable(settings.bin, {
    dirs,
    exists: (dir: string, name: string) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    },
    workspaceRoot: input.workspaceRoot ?? null,
    previousPath: null,
    // F130-FR-002: the free `--version` probe, so the pin check of the
    // critic has the version of the pass. A test hands its own probe.
    probeVersion: input.probeVersion ?? probeDshVersion,
    component: "dsh",
  });
  if (!resolved.ok) {
    if ("resultCode" in resolved) {
      return {
        ok: false,
        code: EXECUTABLE_NOT_FOUND_CODE as 127,
        message:
          `${DSH_NOT_FOUND_PREFIX}: ${settings.bin} ` +
          `(change harnesses.dsh.bin or put the executable on the search path)`,
      };
    }
    return { ok: false, result: 1, message: resolved.message };
  }

  let overlay: DshOverlay | null = null;
  let patch: CriticPatchFile | null = null;
  let emptyCwd: string | null = null;
  try {
    // The proof of F130-FR-024/F130-FR-025, BEFORE the patch exists: the
    // enumeration is free of charge and refuses the role when stale.
    let proof: CriticProofRecord;
    if (settings.proof === "none") {
      proof = buildCriticProof("none", { patchHash: "" });
    } else {
      const pin = checkCriticVersionPin(resolved.version);
      if (!pin.ok) {
        return { ok: false, refused: CRITIC_NOT_TOOLLESS, message: pin.message, proof: null };
      }
      const enumerationEnv: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.env ?? {})) {
        if (value !== undefined) enumerationEnv[name] = value;
      }
      const toolIds = enumerateDshToolIds({
        binPath: resolved.path,
        profile: settings.profile,
        env: enumerationEnv,
      });
      const coverage = checkCriticCoverage(toolIds);
      if (!coverage.ok) {
        return {
          ok: false,
          refused: CRITIC_NOT_TOOLLESS,
          message: coverage.message,
          proof: null,
        };
      }
      // The hash is known once the patch is written, below; the record is
      // assembled after the call with all four facts.
      proof = buildCriticProof("strict", { patchHash: "" });
    }

    // F130-FR-028: the throwaway home, with the critic effort in the block.
    if (model.reference !== null) {
      overlay = buildCriticOverlay({
        realHome: settings.home,
        reference: model.reference,
        effort: settings.effort,
      });
    }

    // F130-FR-023: the patch file of 18 ids, written for the call only.
    patch = writeCriticPatch(input.passId ?? "pass");

    // F130-FR-021: the working directory. Under `parity` the engine's own;
    // outside it an EMPTY directory made for the call.
    const parity = settings.profile === "parity";
    const cwd = parity
      ? input.cwd
      : (emptyCwd = mkdtempSync(join(tmpdir(), CRITIC_EMPTY_CWD_PREFIX)));

    // F130-FR-027: the prompt split at spaces, no chunk starting with a dash;
    // one token over the limit fails the call with a message naming the limit.
    const chunks = splitPromptAtSpaces(input.prompt);

    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.env ?? {})) {
      if (value !== undefined) env[name] = value;
    }
    env["DSH_HOME"] = overlay !== null ? overlay.home : settings.home;
    env[CRITIC_PERMISSION_ENV] = mode;
    env["DSH_TELEMETRY_MODE"] = env["DSH_TELEMETRY_MODE"] ?? "";
    if (input.script !== undefined) env["FAKE_DSH_SCRIPT"] = input.script;

    const argv = criticArgv({
      bin: resolved.path,
      profile: settings.profile,
      patchPath: patch.path,
      chunks,
    });
    const finalizeProof = (patchHash: string): CriticProofRecord =>
      settings.proof === "none" ? proof : buildCriticProof("strict", { patchHash });
    return {
      ok: true,
      argv,
      env,
      cwd,
      mode,
      patch,
      overlay,
      window: windowResolution.window,
      finalizeProof,
      dispose: () => {
        patch?.remove();
        overlay?.remove();
        if (emptyCwd !== null) rmSync(emptyCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (error instanceof PromptTooLargeError) {
      patch?.remove();
      overlay?.remove();
      if (emptyCwd !== null) rmSync(emptyCwd, { recursive: true, force: true });
      return { ok: false, result: 1, message: `pass-loop: ${error.message}` };
    }
    throw error;
  }
}

/**
 * Runs one critic call (F130-FR-021 to F130-FR-029). The synchronous twin:
 * the caller waits for the call to end. Every temporary thing — patch file,
 * overlay, empty working directory — is removed on every arm, a time limit
 * included.
 */
export function runDshCritic(input: CriticCallInput): CriticRun {
  const prepared = prepareDshCriticCall(input);
  if (!prepared.ok) return prepared;
  try {
    // `detached` puts the child in a new process group; the runtime option
    // exists for spawnSync but the bundled type omits it.
    const spawnOptions = {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: true,
      // Standard input closed; the reply is standard output.
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: input.timeoutMs,
      shell: false,
    } as import("node:child_process").SpawnSyncOptionsWithStringEncoding;
    const run = spawnSync(prepared.argv[0]!, prepared.argv.slice(1), spawnOptions);

    // F130-FR-026: the failure arms, each with its own message.
    if (run.error !== undefined && (run.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      return {
        ok: false,
        result: 1,
        message: criticTimeoutMessage(input.timeoutMs ?? 0),
      };
    }
    if (run.error !== undefined) {
      return {
        ok: false,
        result: 1,
        message: criticLaunchMessage(String(run.error.message ?? run.error)),
      };
    }
    const status = run.status ?? 1;
    const stdout = typeof run.stdout === "string" ? run.stdout : "";
    const stderr = typeof run.stderr === "string" ? run.stderr : "";
    // F130-FR-026 (B-0990): the non-zero exit is diagnosed FIRST, so a call
    // that failed with its error on standard error (or on standard output,
    // where standard error is empty) reports THAT failure, not the missing
    // reply; the empty standard output of a call that exited 0 is its own
    // failure below.
    if (status !== 0) {
      return {
        ok: false,
        result: 1,
        message: criticNonZeroExitMessage({ status, stderr, stdout }),
      };
    }
    if (stdout === "") {
      return { ok: false, result: 1, message: criticEmptyStdoutMessage({ status }) };
    }
    return {
      ok: true,
      reply: stdout,
      status,
      argv: prepared.argv,
      cwd: prepared.cwd,
      permissionMode: prepared.mode,
      patchHash: prepared.patch.hash,
      patchLogicalName: prepared.patch.logicalName,
      proof: prepared.finalizeProof(prepared.patch.hash),
      overlay: prepared.overlay !== null ? prepared.overlay.home : null,
      window: prepared.window,
    };
  } finally {
    prepared.dispose();
  }
}

/** The outcome of one ASYNC critic call: the synchronous facts, plus the supervision facts. */
export type CriticAsyncRun = CriticRun & RunSupervisionFacts;

/** The input of one ASYNC critic call. */
export type CriticAsyncInput = CriticCallInput & AsyncRunInput;

/**
 * Runs one critic call ASYNCHRONOUSLY (F130-FR-021 to F130-FR-029). The argv,
 * the environment, the working directory and the proof are the ones the
 * synchronous twin builds; the process runs without blocking the caller in
 * its own process group, hands its PID over through `onStart` as soon as it
 * exists, is SIGTERMed at the time limit and SIGKILLed — as a GROUP, so no
 * grandchild survives — after the grace period, and the cost is read from a
 * `total_cost_usd` figure of the JSON stream when `dsh` emits one.
 */
export async function runDshCriticAsync(input: CriticAsyncInput): Promise<CriticAsyncRun> {
  const prepared = prepareDshCriticCall(input);
  if (!prepared.ok) return { ...prepared, pid: -1, timedOut: false, killedWith: null, costUsd: 0 };
  const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
    cwd: prepared.cwd,
    env: prepared.env,
    detached: true,
    // Standard input closed; the reply is standard output.
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (child.pid !== undefined) input.onStart?.(child.pid, (signal) => child.kill(signal));
  try {
    const outcome = await runChildUnderTimeLimit(
      child,
      input.timeoutMs,
      input.killGraceMs,
      /* groupKill */ true,
    );
    if (!outcome.ok) {
      return {
        ok: false,
        result: 1,
        message: criticLaunchMessage(outcome.message),
        pid: child.pid ?? -1,
        timedOut: false,
        killedWith: null,
        costUsd: 0,
      };
    }
    const status = outcome.status;
    const stdout = outcome.stdout;
    const stderr = outcome.stderr;
    // F130-FR-026: a child past its limit was ended by the watchdog.
    if (outcome.timedOut) {
      return {
        ok: false,
        result: 1,
        message: criticTimeoutMessage(input.timeoutMs ?? 0),
        pid: outcome.pid,
        timedOut: outcome.timedOut,
        killedWith: outcome.killedWith,
        costUsd: outcome.costUsd,
      };
    }
    // F130-FR-026 (B-0990): the non-zero exit is diagnosed FIRST (see the
    // synchronous twin); the empty standard output of a call that exited 0 is
    // its own failure.
    if (status !== 0) {
      return {
        ok: false,
        result: 1,
        message: criticNonZeroExitMessage({ status, stderr, stdout }),
        pid: outcome.pid,
        timedOut: outcome.timedOut,
        killedWith: outcome.killedWith,
        costUsd: outcome.costUsd,
      };
    }
    if (stdout === "") {
      return {
        ok: false,
        result: 1,
        message: criticEmptyStdoutMessage({ status }),
        pid: outcome.pid,
        timedOut: outcome.timedOut,
        killedWith: outcome.killedWith,
        costUsd: outcome.costUsd,
      };
    }
    return {
      ok: true,
      reply: stdout,
      status,
      argv: prepared.argv,
      cwd: prepared.cwd,
      permissionMode: prepared.mode,
      patchHash: prepared.patch.hash,
      patchLogicalName: prepared.patch.logicalName,
      proof: prepared.finalizeProof(prepared.patch.hash),
      overlay: prepared.overlay !== null ? prepared.overlay.home : null,
      window: prepared.window,
      pid: outcome.pid,
      timedOut: outcome.timedOut,
      killedWith: outcome.killedWith,
      costUsd: outcome.costUsd,
    };
  } finally {
    prepared.dispose();
  }
}
