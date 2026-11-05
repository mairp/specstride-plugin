/**
 * T073 — `startPass` of the dsh adapter: one WORKER pass of a group
 * (`specstride.harness/1`, annex C §C.1; F142-FR-020, F143-FR-010).
 *
 * A group of parallel units needs one harness process per worker, in a
 * process group of its own, with its tree as the write root and a fresh
 * session whose id is the worker id. The pass loop starts its passes through
 * `services.runPass` and keeps its own single-pass shape; this module is the
 * OTHER door, the port operation `startPass` the group executor calls once
 * per worker (annex C §C.1, Inputs). It prepares the pass exactly as the
 * pass loop does — `prepareDshProposerPass`, one preparation, no drift — and
 * then starts the process through the process primitive of the kernel
 * (F100-FR-234): a session and a group of its own, standard input closed, no
 * shell, the two outputs on files the caller reads when it waits.
 *
 * The write root of dsh is the WORKING DIRECTORY of the process: the
 * contained mode `workspace-write` roots the writes of the pass at the tree
 * the process runs in, so a write root that is not the working directory is
 * refused — the adapter cannot point the sandbox of this harness anywhere
 * else. The session directive must be `fresh`: dsh declares no continuation
 * (F130-FR-016), and a worker is one of the eight occasions of a fresh
 * session (F100-FR-083). Where the directive names no session id, one is
 * minted; the group executor always names the worker id.
 */
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { StartPassInput } from "@specstride/contracts/ep/harness";
import { processPrimitive } from "@specstride/kernel";
import type { GroupSignal, ProcessEnd } from "@specstride/contracts/ep/kernel-services";
import { prepareDshProposerPass } from "../proposer/index.ts";
import type { ProposerPassInput } from "../proposer/index.ts";

/** The section of annex C this operation belongs to. */
export const START_PASS_ANNEX_SECTION = "annex C, §C.1" as const;

/** The write root of dsh is the working directory; nothing else can be named. */
export const WRITE_ROOT_IS_THE_WORKING_DIRECTORY = true as const;

/** dsh declares no continuation: a worker pass is always a fresh session. */
export const WORKER_SESSION_IS_ALWAYS_FRESH = true as const;

/** The prefix of the directory the two output files of a pass live in. */
export const START_PASS_OUTPUT_PREFIX = "specstride-dsh-pass." as const;

/** The refusal of a session directive this adapter cannot run. */
export function sessionDirectiveRefusal(session: StartPassInput["session"]): string {
  return (
    "dsh: startPass runs a fresh session only (the harness declares no continuation); " +
    `the directive named \`${session.kind}\``
  );
}

/** The refusal of a write root the sandbox of this harness cannot name. */
export function writeRootRefusal(writeRoot: string, workingDirectory: string): string {
  return (
    "dsh: the write root of a pass is its working directory " +
    `(\`${workingDirectory}\`); \`${writeRoot}\` cannot be named`
  );
}

/**
 * What `startPass` is handed: the port input of annex C §C.1, the worker
 * environment of F143-FR-009 the group executor adds, and the caller's knobs.
 */
export type DshStartPassInput = StartPassInput & {
  /** The worker environment (F143-FR-009): token, run token, temporary directory. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Where the two output files go; a fresh directory when none is named. */
  readonly outputDirectory?: string;
  /* The seams of the proposer, handed through unchanged. */
  /** The environment of the consumer (as-is aliases are read from it). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the stub lives: the real search path, before any overlay variable. */
  readonly path?: string;
  /** The workspace root handed to the seam resolver. */
  readonly workspaceRoot?: string | null;
  /** Overrides for tests: the configuration source of the settings. */
  readonly config?: ProposerPassInput["config"];
  /** The permission mode the consumer configured, with its origin. */
  readonly configuredMode?: ProposerPassInput["configuredMode"];
  /** The containment opt-in, with its origin (user configuration only). */
  readonly containmentLevel?: ProposerPassInput["containmentLevel"];
  /** The `--version` probe of the seam (a test overrides it). */
  readonly probeVersion?: (path: string) => string | null;
  /** The `--version` script step of the stub, as a test plays it. */
  readonly script?: string;
  /** Milliseconds between the SIGTERM of the limit and the SIGKILL (default 5 000). */
  readonly killGraceMs?: number;
};

/** The handle of a started worker pass. */
export type DshPassHandle = {
  /** The pid of the harness process. */
  readonly pid: number;
  /** When the process started, ISO, from the clock of the kernel. */
  readonly startTime: string;
  /** The process group of the process — its own; `signalGroup` takes it. */
  readonly processGroup: number;
  /** The minted session id: the worker id of the pass. */
  readonly sessionId: string;
  /** The write root the pass runs under. */
  readonly writeRoot: string;
  /** The permission mode the pass runs in, stated (F130-FR-010). */
  readonly permissionMode: string;
  /** The argument list the process was given. */
  readonly argv: readonly string[];
  /** The model reference the pass was asked for, or null where none was named. */
  readonly model: string | null;
  /** The throwaway home of the pass, where one was built; else null. */
  readonly overlay: string | null;
  /** Standard output of the process, on a file. */
  readonly stdoutFile: string;
  /** Standard error of the process, on a file. */
  readonly stderrFile: string;
  /** The reply of the pass: its standard output, read after the process ended. */
  readonly reply: () => Promise<string>;
  /** The stream of the pass: its standard output, line by line, as it appears. */
  readonly stream: AsyncIterable<string>;
  /** The end of the process: exit code or signal, once it has ended. */
  readonly ended: Promise<ProcessEnd>;
  /** Signal the process GROUP: polite, terminate or kill (F100-FR-234). */
  readonly signalGroup: (signal: GroupSignal) => void;
};

/** The outcome of `startPass`: a handle, or a refusal with the one line. */
export type DshStartPassResult =
  | { readonly ok: true; readonly handle: DshPassHandle }
  | { readonly ok: false; readonly result: 1 | 127; readonly message: string };

/**
 * The prompt of a pass: a `promptReference` that names an existing FILE is
 * that file's content; any other reference is the prompt text itself.
 */
export function promptOfAReference(reference: string): string {
  if (existsSync(reference)) return readFileSync(reference, "utf8");
  return reference;
}

/** The names of the worker environment that travel, as the port's allow-list states them. */
function allowedWorkerEnvironment(
  environment: Readonly<Record<string, string>> | undefined,
  allowList: readonly string[] | undefined,
): Record<string, string> {
  if (environment === undefined) return {};
  const allowed = new Set(allowList ?? Object.keys(environment));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (allowed.has(name)) out[name] = value;
  }
  return out;
}

/** The stream of one output file: its lines, as they appear, until the pass ends. */
async function* fileStream(
  file: string,
  ended: Promise<unknown>,
): AsyncGenerator<string, void, unknown> {
  // The primitive creates the file before the process starts, so the stream
  // opens at once and reads what is there; each poll yields the lines that
  // appeared, and the generator ends when the process has ended and the tail
  // of the file is read.
  let done = false;
  ended.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  let settled = false;
  let yielded = 0;
  while (!settled) {
    const lines: string[] = [];
    if (existsSync(file)) {
      await new Promise<void>((resolve) => {
        const input = createReadStream(file, { encoding: "utf8" });
        const reader = createInterface({ input });
        reader.on("line", (line) => lines.push(line));
        reader.on("close", () => resolve());
        input.on("error", () => {
          reader.close();
          resolve();
        });
      });
    }
    for (; yielded < lines.length; yielded += 1) yield lines[yielded] as string;
    if (done) settled = true;
    else await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * `startPass` of the dsh adapter (annex C §C.1): one worker pass of a group,
 * prepared as the pass loop prepares its own, started in a session and a
 * group of its own through the process primitive, with its tree as the write
 * root, a fresh session under the minted worker id, and the two outputs on
 * files the caller reads when it waits. The time limit of the port input is
 * enforced on the GROUP: SIGTERM at the limit, SIGKILL after the grace
 * period — the same ladder the async proposer twin runs.
 */
export async function dshStartPass(input: DshStartPassInput): Promise<DshStartPassResult> {
  if (input.session.kind !== "fresh") {
    return { ok: false, result: 1, message: sessionDirectiveRefusal(input.session) };
  }
  if (input.writeRoot !== input.workingDirectory) {
    return {
      ok: false,
      result: 1,
      message: writeRootRefusal(input.writeRoot, input.workingDirectory),
    };
  }
  const prompt = promptOfAReference(input.promptReference);
  const prepared = prepareDshProposerPass({
    prompt,
    cwd: input.workingDirectory,
    model: { flag: input.model === "" ? null : input.model },
    path: input.path,
    workspaceRoot: input.workspaceRoot ?? null,
    env: input.env,
    config: input.config,
    configuredMode: input.configuredMode,
    containmentLevel: input.containmentLevel,
    probeVersion: input.probeVersion,
    script: input.script,
    ...(input.traceParent === undefined ? {} : { traceparent: input.traceParent }),
  });
  if (!prepared.ok) {
    return "code" in prepared
      ? { ok: false, result: 127, message: prepared.message }
      : { ok: false, result: 1, message: prepared.message };
  }

  const outputDirectory =
    input.outputDirectory ?? mkdtempSync(join(tmpdir(), START_PASS_OUTPUT_PREFIX));
  const stdoutFile = join(outputDirectory, "stdout.log");
  const stderrFile = join(outputDirectory, "stderr.log");

  // The environment of the pass: the preparation's own (the consumer's
  // environment with the harness's three variables set), then the worker
  // environment the caller allow-listed (F143-FR-009).
  const env: Record<string, string> = { ...prepared.env };
  for (const [name, value] of Object.entries(
    allowedWorkerEnvironment(input.environment, input.environmentAllowList),
  )) {
    env[name] = value;
  }

  const started = await processPrimitive.start({
    argv: prepared.argv,
    cwd: input.workingDirectory,
    env,
    stdoutFile,
    stderrFile,
  });
  const ended = processPrimitive.waitForEnd(started.pid);

  // The ladder of the time limit, on the GROUP (F100-FR-234): SIGTERM at the
  // limit, SIGKILL after the grace period. The timers never hold the event
  // loop of the caller open.
  const limit = input.timeLimitMs;
  let grace: NodeJS.Timeout | undefined;
  let limitTimer: NodeJS.Timeout | undefined;
  const stop = (signal: GroupSignal): void => {
    processPrimitive.signalGroup(started.pgid, signal);
  };
  if (limit > 0) {
    limitTimer = setTimeout(() => {
      stop("terminate");
      grace = setTimeout(() => stop("kill"), input.killGraceMs ?? 5_000);
      grace.unref?.();
    }, limit);
    limitTimer.unref?.();
  }

  const overlay = prepared.overlay;
  const cleanup = (): void => {
    if (limitTimer !== undefined) clearTimeout(limitTimer);
    if (grace !== undefined) clearTimeout(grace);
    overlay?.remove();
  };
  ended.then(
    () => cleanup(),
    () => cleanup(),
  );

  const sessionId = input.session.sessionId ?? randomUUID();
  const handle: DshPassHandle = Object.freeze({
    pid: started.pid,
    startTime: new Date(started.startedAtMs).toISOString(),
    processGroup: started.pgid,
    sessionId,
    writeRoot: input.writeRoot,
    permissionMode: prepared.mode,
    argv: prepared.argv,
    model: input.model === "" ? null : input.model,
    overlay: overlay !== null ? overlay.home : null,
    stdoutFile,
    stderrFile,
    reply: async () => {
      await ended;
      return existsSync(stdoutFile) ? readFileSync(stdoutFile, "utf8") : "";
    },
    stream: fileStream(stdoutFile, ended),
    ended,
    signalGroup: stop,
  });
  return { ok: true, handle };
}

/** Removes the output directory of a pass; a convenience for the caller. */
export function removePassOutput(handle: DshPassHandle): void {
  rmSync(dirname(handle.stdoutFile), { recursive: true, force: true });
}
