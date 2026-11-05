/**
 * T049 — `wait --until-change` (`packages/cli/src/status/wait.ts`;
 * F129-FR-029, F129-FR-031, F129-SC-002).
 *
 * The command lets a host wait for a change WITHOUT spending its context:
 *
 * - it prints NOTHING while nothing changes (F129-SC-002): the only thing it
 *   compares from poll to poll is the change signature of F129-FR-030, so a
 *   stream of progress events that moves no field of the signature costs
 *   zero bytes;
 * - it polls the files at `wait.pollSec` (default 5 s), compares the change
 *   signature of the fresh projection with the one in the cursor token the
 *   caller passed — or, without a token, with the signature at the time of
 *   the call — and prints EXACTLY ONE line as soon as the signatures differ:
 *   the status line with `cur=<offset>.<seq>.<signature>` as its last key,
 *   at most 170 bytes as a whole (F129-FR-031);
 * - it ends without printing when `wait.timeoutSec` (default 600 s) or the
 *   value of `--timeout` has passed;
 * - exit code 0 when a line was printed AND when the time limit passed with
 *   nothing printed, 1 when there is no state, 3 for a usage error, including
 *   a call without `--until-change`;
 * - a workspace that holds state and no run has a change signature like any
 *   other (run id and state `none`), so the first run that appears is a
 *   change;
 * - it holds no state between calls, is no service, starts no process and
 *   writes no file (F129-FR-015); no run depends on it;
 * - under the `parity` profile it prints nothing (F129-SC-009).
 *
 * The read model is a PARAMETER and not an import, for the reason
 * `status.ts` records: the import-boundary check of feature 100 refuses an
 * import between two packages of layer L6 that the `mayImport` of the graph
 * does not name explicitly (R-129-04 of
 * `specs/129-run-view-and-status/contracts/README.md`). The host hands in
 * `project` and `renderLine` of `@specstride/view`; the cursor token and the
 * change signature are read STRUCTURALLY off the view record, exactly as
 * `cached-view.ts` and `waitOnce` read them. The clock and the wait between
 * polls are parameters too: a real host hands the clock of the process and a
 * real sleep, a test hands a fake clock and a step function, and the command
 * never reads the host clock itself (F129-FR-036).
 */
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import type { ControlPlace } from "./state-readers.ts";
import {
  eventsPathOf,
  holdsNoState,
  newestLaunchRecordOf,
  readCurrentPointer,
  readPauseRecord,
  readRunRecord,
  readSupervisionRecord,
  readTerminalRecord,
} from "./state-readers.ts";
import { readEvents } from "./event-reader.ts";
import {
  handshakeLimitSecOf,
  leaseObservationOf,
  searchProcessTable,
  type LockProbePort,
  type ProcessTablePort,
} from "./probes.ts";
import { isParityProfile, type RenderLine } from "./output.ts";
import { waitOnce } from "./status.ts";

/** The exit codes of `wait` (F129-FR-029). */
export const WAIT_EXIT_CODES = Object.freeze({
  /** A line was printed, or the time limit passed with nothing printed. */
  ok: 0,
  /** The workspace holds no state at all. */
  noState: 1,
  /** A usage refusal, including a call without `--until-change`. */
  usage: 3,
} as const);

/** The default of `wait.pollSec` (the table of `spec.md`). */
export const DEFAULT_POLL_SEC = 5 as const;
/** The default of `wait.timeoutSec` (the table of `spec.md`). */
export const DEFAULT_TIMEOUT_SEC = 600 as const;

/**
 * The signature token of a workspace that holds state and no run (F129-FR-029):
 * eight hexadecimal characters, as every real token is, chosen so that the
 * first run that appears — whose token is the hash of a real signature — is a
 * change.
 */
export const NO_RUN_TOKEN = "00000000" as const;

/** What one run of `wait` did. */
export type WaitRun = {
  readonly exit: number;
  /** The bytes printed to the standard output, in one string. */
  readonly stdout: string;
  readonly stderr: string;
  /** How many projections were taken (including the first). */
  readonly polls: number;
  /** True where the command ended by its time limit with nothing printed. */
  readonly timedOut: boolean;
  /** The signature token the command ended on. */
  readonly token: string;
  /** The last view projected, where one was. */
  readonly view: unknown;
};

/** The environment `runWait` may be handed; every part defaults to the host. */
export type WaitOptions = {
  /** The pure read model (`project` of `@specstride/view`); required. */
  readonly project: (inputs: unknown, ports?: unknown) => unknown;
  /** The renderer of the status line (`renderLine`); required with it. */
  readonly renderLine: RenderLine;
  /** The ports of the read model, handed through to `project`. */
  readonly ports?: unknown;
  /** The control plane and the working tree. */
  readonly place?: ControlPlace;
  /** The EP-13 probe; the shipped provider of feature 122 in a real host. */
  readonly lock?: LockProbePort;
  /**
   * T056 — the port of the process table; the search for the run token is
   * REPORT ONLY (F129-FR-021). Where none is handed in, no holder is listed.
   */
  readonly procs?: ProcessTablePort;
  /** The selected profile; the `parity` profile prints nothing. */
  readonly profile?: string;
  /** The time of the projection, as an ISO-8601 stamp. */
  readonly now?: () => string;
  /** The clock of the wait loop, in whole milliseconds since an epoch. */
  readonly clock?: () => number;
  /** The wait between polls; the default blocks the caller with `Atomics.wait`. */
  readonly sleep?: (millis: number) => void;
  /** The configuration, for `wait.pollSec` and `wait.timeoutSec`. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** The environment, for the handshake limit a fixture sets. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Where the bytes go; the default is the standard output of the process. */
  readonly write?: ((text: string) => void) | undefined;
  readonly writeError?: ((text: string) => void) | undefined;
};

/** The parsed arguments of `wait`. */
type ParsedWaitArgv = {
  readonly untilChange: boolean;
  readonly timeoutSec: number | null;
  readonly cursor: string | null;
  readonly feature: string | null;
  readonly error: string | null;
};

const USAGE =
  "usage: specstride wait --until-change [--cursor <offset>.<seq>.<sig>] [--timeout <seconds>] [--feature <slug>]\n";

function parseWaitArgv(argv: readonly string[]): ParsedWaitArgv {
  let untilChange = false;
  let timeoutSec: number | null = null;
  let cursor: string | null = null;
  let feature: string | null = null;
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === "--until-change") {
      untilChange = true;
    } else if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const value = arg === "--timeout" ? argv[++at] : arg.slice("--timeout=".length);
      const parsed = value === undefined ? Number.NaN : Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return {
          untilChange,
          timeoutSec,
          cursor,
          feature,
          error: "--timeout needs a number of seconds",
        };
      }
      timeoutSec = Math.floor(parsed);
    } else if (arg === "--cursor" || arg.startsWith("--cursor=")) {
      const value = arg === "--cursor" ? argv[++at] : arg.slice("--cursor=".length);
      if (value === undefined || value === "") {
        return { untilChange, timeoutSec, cursor, feature, error: "--cursor needs a token" };
      }
      cursor = value;
    } else if (arg === "--feature") {
      const value = argv[++at];
      if (value === undefined)
        return { untilChange, timeoutSec, cursor, feature, error: "--feature needs a value" };
      feature = value;
    } else if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      if (arg === "--workspace" && argv[++at] === undefined) {
        return { untilChange, timeoutSec, cursor, feature, error: "--workspace needs a value" };
      }
    } else {
      return { untilChange, timeoutSec, cursor, feature, error: `unknown argument ${arg}` };
    }
  }
  // F129-FR-029: a call without `--until-change` is a usage error (exit 3).
  if (!untilChange) {
    return { untilChange, timeoutSec, cursor, feature, error: "wait needs --until-change" };
  }
  return { untilChange, timeoutSec, cursor, feature, error: null };
}

/** A whole number of seconds out of the flat configuration, or the default. */
function secondsOf(
  config: Readonly<Record<string, unknown>> | undefined,
  key: string,
  fallback: number,
): number {
  const value = config?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/** The last field of a cursor token `offset.seq.sig`, lower case, or null. */
export function signaturePartOf(token: string | null): string | null {
  if (token === null) return null;
  const parts = token.split(".");
  const signature = parts[2];
  return parts.length === 3 && signature !== undefined && /^[0-9a-fA-F]{8}$/u.test(signature)
    ? signature.toLowerCase()
    : null;
}

/** The signature token the view record carries, or the no-run token. */
function tokenOfView(view: unknown): string {
  const record = view as { signature?: { token?: unknown } } | null;
  const token = record !== null && typeof record === "object" ? record.signature?.token : undefined;
  return typeof token === "string" && /^[0-9a-f]{8}$/u.test(token) ? token : NO_RUN_TOKEN;
}

/**
 * Block the caller for whole milliseconds without a timer of the event loop:
 * the same primitive the runtime uses where a test hands no sleep. A test
 * always hands its own sleep and never reaches this.
 */
function blockFor(millis: number): void {
  if (millis <= 0) return;
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, millis);
}

/** One projection of the current run, exactly as `status` takes it. */
function projectCurrentView(
  options: WaitOptions,
  place: ControlPlace,
  slug: string | null,
  runId: string | null,
  launchId: string | null,
  now: () => string,
): unknown {
  if (runId === null || slug === null) return null;
  const newestLaunchRecord = launchId === null ? null : newestLaunchRecordOf(place).record;
  const supervisionRecord = launchId === null ? null : readSupervisionRecord(place, launchId);
  const runRecord = readRunRecord(place, slug, runId);
  const terminalRecord = readTerminalRecord(place, slug, runId);
  const pauseRecord = readPauseRecord(place, slug, runId);
  const events = readEvents(eventsPathOf(place, slug, runId));
  return options.project(
    {
      events: {
        events: events.events,
        file: eventsPathOf(place, slug, runId),
        offset: events.offset,
        diagnostics: events.diagnostics,
      },
      stateFiles: { runRecord, terminalRecord, pauseRecord },
      observations: {
        lease: leaseObservationOf(options.lock, runId),
        newestLaunchRecord,
        supervisionRecord,
        processTableSearch: searchProcessTable(options.procs, runId),
        handshakeLimitSec: handshakeLimitSecOf(options.config ?? {}, options.environment ?? {}),
      },
      now: now(),
    },
    options.ports,
  );
}

/** A safety ceiling on polls: the command must end by its time limit (F129-FR-029). */
const MAX_POLLS = 1_000_000 as const;

/**
 * F129-FR-029 — one run of `wait --until-change`. The loop, the comparison of
 * the change signature, the single line with `cur=`, the exit codes and the
 * time limit.
 */
export function runWait(argv: readonly string[], options: WaitOptions): WaitRun {
  const out: string[] = [];
  const err: string[] = [];
  const print = options.write ?? ((text: string): void => void out.push(text));
  const printError = options.writeError ?? ((text: string): void => void err.push(text));
  const finish = (
    exit: number,
    polls: number,
    timedOut: boolean,
    token: string,
    view: unknown,
  ): WaitRun =>
    Object.freeze({
      exit,
      stdout: out.join(""),
      stderr: err.join(""),
      polls,
      timedOut,
      token,
      view,
    });

  const parsed = parseWaitArgv(argv);
  if (parsed.error !== null) {
    printError(`specstride wait: ${parsed.error}\n${USAGE}`);
    return finish(WAIT_EXIT_CODES.usage, 0, false, NO_RUN_TOKEN, null);
  }

  const controlRoot = options.place?.controlRoot ?? options.environment?.["SPECSTRIDE_STATE_DIR"];
  const workspaceRealPath = options.place?.workspaceRealPath ?? process.cwd();
  const now = options.now ?? ((): string => new Date().toISOString());
  const clock = options.clock ?? ((): number => Date.now());
  const sleep = options.sleep ?? blockFor;
  const parity = isParityProfile(options.profile, PROFILE_NAME);

  // No state at all: exit 1, and nothing on the standard output (F129-FR-031:
  // an unchanged state costs zero bytes on `wait`).
  if (
    controlRoot === undefined ||
    controlRoot === "" ||
    holdsNoState(options.place ?? { controlRoot, workspaceRealPath })
  ) {
    printError("specstride wait: the workspace holds no state\n");
    return finish(WAIT_EXIT_CODES.noState, 0, false, NO_RUN_TOKEN, null);
  }
  const place: ControlPlace = options.place ?? { controlRoot, workspaceRealPath };

  const pollSec = secondsOf(options.config, "wait.pollSec", DEFAULT_POLL_SEC);
  const timeoutSec =
    parsed.timeoutSec ?? secondsOf(options.config, "wait.timeoutSec", DEFAULT_TIMEOUT_SEC);
  const startMs = clock();
  const deadlineMs = startMs + timeoutSec * 1000;

  // The baseline: the signature in the cursor token the caller passed, or the
  // signature at the time of the call (F129-FR-029). Two hosts that hold their
  // own cursors never consume each other's changes: each compares against its
  // own token, and a change one host has consumed is still a change to the
  // other (F129-FR-003).
  const passedToken = signaturePartOf(parsed.cursor);

  const projectOnce = (): { view: unknown; token: string } => {
    const pointer = readCurrentPointer(place);
    const newest = newestLaunchRecordOf(place);
    const runId =
      pointer.runId ??
      (typeof newest.record?.["runId"] === "string" ? String(newest.record["runId"]) : null);
    const slug =
      parsed.feature ??
      pointer.feature ??
      (typeof newest.record?.["feature"] === "string" ? String(newest.record["feature"]) : null);
    const launchId = newest.launchId ?? pointer.launchId;
    const view = projectCurrentView(options, place, slug, runId, launchId, now);
    return { view, token: tokenOfView(view) };
  };

  const first = projectOnce();
  const baseline = passedToken ?? first.token;
  let polls = 1;

  while (true) {
    const { view, token } = polls === 1 ? first : projectOnce();
    if (token !== baseline) {
      // Exactly one line, the status line with `cur=` as its last key, at most
      // 170 bytes (F129-FR-029, F129-FR-031). Under `parity`, 0 bytes.
      const line = parity
        ? ""
        : waitOnce(view, { profile: options.profile, renderLine: options.renderLine });
      if (line !== "") print(line);
      return finish(WAIT_EXIT_CODES.ok, polls, false, token, view);
    }
    if (clock() >= deadlineMs || polls >= MAX_POLLS) {
      // The time limit passed with nothing printed: exit 0, no bytes.
      return finish(WAIT_EXIT_CODES.ok, polls, true, token, view);
    }
    const remainingMs = deadlineMs - clock();
    sleep(Math.max(0, Math.min(pollSec * 1000, remainingMs)));
    polls += 1;
  }
}

// The digest a host skill ends its supervision with (F100-FR-180) is part of
// the surface of `wait`: the reading itself stays with the state readers of
// the control plane, where every other record of a launch is read (T024,
// CT-129-39), and `wait` itself opens no file.
export { digestLineOfThePipeline } from "./state-readers.ts";
