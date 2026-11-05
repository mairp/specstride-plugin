/**
 * T008 — the bounded probe runner of discovery (F146-FR-014; D-5 of the
 * plan).
 *
 * Every probe is bounded: standard input closed, a time limit, a cap on
 * output, and no terminal. Probes run in parallel, at most `parallel` of
 * them at once. A probe that fails, runs over its time or exceeds its cap
 * yields null for its value and one doctor finding, and NEVER makes
 * discovery itself fail: only the reader of a harness that plays a role of
 * the run can fail the launch. The limits and caps are data, in
 * `data/probe-limits.json` (T003), read at call time.
 *
 * The runner takes the process primitive as an injected port, so a test
 * replaces it and traces it. The default port starts no shell, pipes the
 * three standard streams (so the probe holds no terminal and its output can
 * be cut), and closes standard input.
 */
import { spawn as spawnOfNode, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CandidateFinding } from "../types.ts";

/** The requirement this module carries. */
export const PROBE_RUNNER_REQUIREMENT = "F146-FR-014" as const;

/** Where the limits and caps of the probes ship, as data. */
export const PROBE_LIMITS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "data",
  "probe-limits.json",
);

/** The limits and caps of a probe, read from `data/probe-limits.json`. */
export type ProbeLimits = {
  readonly processTimeLimitMs: number;
  readonly requestTimeLimitMs: number;
  readonly outputCapBytes: number;
  readonly parallel: number;
  /** Standard input of every probe is closed. */
  readonly stdin: "closed";
  /** No probe holds a terminal. */
  readonly terminal: "none";
};

/** Read the limits at call time, so the data file stays their only home. */
export function loadProbeLimits(path: string = PROBE_LIMITS_PATH): ProbeLimits {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const number = (key: string): number => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`probe-limits.json holds no positive number for \`${key}\``);
    }
    return value;
  };
  if (raw.stdin !== "closed") throw new Error("probe-limits.json: stdin must be `closed`");
  if (raw.terminal !== "none") throw new Error("probe-limits.json: terminal must be `none`");
  return Object.freeze({
    processTimeLimitMs: number("processTimeLimitMs"),
    requestTimeLimitMs: number("requestTimeLimitMs"),
    outputCapBytes: number("outputCapBytes"),
    parallel: number("parallel"),
    stdin: "closed",
    terminal: "none",
  });
}

/** One probe to run: a fixed file, a fixed argument list, no shell. */
export type ProbeRequest = {
  /** A name the finding and the caller know the probe by. */
  readonly id: string;
  readonly file: string;
  readonly args: readonly string[];
  /** Extra environment, over the environment of the run. */
  readonly env?: Readonly<Record<string, string>>;
};

/** What one probe answered. */
export type ProbeResult = {
  readonly id: string;
  /** The standard output of the probe, or null wherever the probe failed. */
  readonly value: string | null;
  /** The one finding of the failure, or null where the probe passed. */
  readonly finding: CandidateFinding | null;
};

/**
 * The process primitive as a port: it starts the probe and gives back the
 * two output streams and the end of the process. A test replaces this port
 * and traces it.
 */
export type ProbeProcess = {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  /** Close the standard input of the probe. */
  endInput(): void;
  /** End the probe: the time limit calls this. */
  kill(): void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  onStartError(callback: (error: Error) => void): void;
};

export type ProbeSpawn = (request: ProbeRequest) => ProbeProcess;

/** The default port: the `spawn` of the runtime, no shell, no terminal. */
export const defaultSpawn: ProbeSpawn = (request) => {
  const child: ChildProcess = spawnOfNode(request.file, [...request.args], {
    // Standard input closed; the two outputs piped, so there is no terminal.
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: request.env === undefined ? process.env : { ...process.env, ...request.env },
  });
  return {
    stdout: child.stdout as unknown as ProbeProcess["stdout"],
    stderr: child.stderr as unknown as ProbeProcess["stderr"],
    endInput: () => {
      // Standard input is closed at birth: the probe can read nothing.
    },
    kill: () => {
      child.kill("SIGKILL");
    },
    onExit: (callback) => {
      child.once("exit", (code, signal) => callback(code, signal));
    },
    onStartError: (callback) => {
      child.once("error", (error) => callback(error));
    },
  };
};

/**
 * Collect one output stream of the probe up to the cap. Past the cap the
 * chunks are dropped at once and never held; `burst` records the excess.
 */
async function collect(
  stream: AsyncIterable<Uint8Array>,
  state: { chunks: Buffer[]; bytes: number; burst: boolean },
  cap: number,
): Promise<void> {
  for await (const chunk of stream) {
    if (state.burst) continue;
    state.bytes += chunk.byteLength;
    if (state.bytes > cap) {
      state.burst = true;
      state.chunks = [];
      continue;
    }
    state.chunks.push(Buffer.from(chunk));
  }
}

/**
 * Run one probe under its bounds. This function never throws: a failure of
 * any kind becomes a null value and one finding.
 */
async function runOne(
  request: ProbeRequest,
  limits: ProbeLimits,
  spawn: ProbeSpawn,
): Promise<ProbeResult> {
  const result = (code: string, message: string): ProbeResult => ({
    id: request.id,
    value: null,
    finding: { code, message, probe: request.id },
  });
  try {
    const probe = spawn(request);
    // Standard input is closed before the probe can ask for it.
    probe.endInput();
    const stdout = { chunks: [] as Buffer[], bytes: 0, burst: false };
    const stderr = { chunks: [] as Buffer[], bytes: 0, burst: false };
    let exitCode: number | null = 0;
    let failedToStart = false;
    let ended = false;
    const exit = new Promise<void>((resolveExit) => {
      probe.onExit((code) => {
        exitCode = code;
        ended = true;
        resolveExit();
      });
      probe.onStartError(() => {
        failedToStart = true;
        ended = true;
        resolveExit();
      });
    });
    // The time limit ends the probe; the other probes are not delayed.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      probe.kill();
    }, limits.processTimeLimitMs);
    const streams = Promise.all([
      collect(probe.stdout, stdout, limits.outputCapBytes),
      collect(probe.stderr, stderr, limits.outputCapBytes),
    ]);
    await Promise.race([exit, streams]);
    if (!ended) {
      // The streams can be seen to close a moment before the `exit` of the
      // process is delivered: give the end of the process a short grace
      // before the run calls the probe over its time.
      await Promise.race([exit, new Promise((r) => setTimeout(r, 100))]);
      if (!ended) {
        timedOut = true;
        probe.kill();
        await exit;
      }
    }
    // Wherever the probe is gone, the streams close; a stream that lingers
    // is cut here so one probe can never hold the run.
    await Promise.race([streams, new Promise((r) => setTimeout(r, 500))]);
    clearTimeout(timer);
    if (failedToStart) return result("probe-failed", "the probe could not be started");
    if (timedOut) {
      return result("probe-time-limit", "the probe did not end within its time limit");
    }
    if (stdout.burst || stderr.burst) {
      return result("probe-output-cap", "the probe printed more than the cap of output");
    }
    if (exitCode !== 0) {
      return result("probe-failed", `the probe ended with ${String(exitCode)}`);
    }
    return {
      id: request.id,
      value: Buffer.concat(stdout.chunks).toString("utf8"),
      finding: null,
    };
  } catch (error) {
    // A throw of the port itself is a failed probe, never a failed run.
    return result(
      "probe-failed",
      `the probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run the probes in parallel, at most `limits.parallel` at once, and answer
 * one result per probe, in the order the probes were given. This function
 * never rejects: a probe of any kind of failure yields null and a finding.
 */
export async function runProbes(
  requests: readonly ProbeRequest[],
  options: {
    readonly limits: ProbeLimits;
    readonly spawn?: ProbeSpawn;
  },
): Promise<readonly ProbeResult[]> {
  const spawn = options.spawn ?? defaultSpawn;
  const limits = options.limits;
  const results: ProbeResult[] = new Array(requests.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const at = next++;
      if (at >= requests.length) return;
      results[at] = await runOne(requests[at]!, limits, spawn);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limits.parallel, requests.length) }, () => worker()),
  );
  return results;
}
