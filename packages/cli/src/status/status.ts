/**
 * T041 — `status` (`packages/cli/src/status/status.ts`; F129-FR-024 to
 * F129-FR-027, F129-SC-005, F129-SC-009).
 *
 * The command:
 *
 * - resolves the CURRENT RUN — the run of the newest launch record of the
 *   workspace, or the run `<control>/current.json` names (F129-FR-024);
 * - reads the state files and the observations, and takes every fact it
 *   prints from ONE projection of the read model (F129-FR-011, F129-SC-009);
 * - prints the default output, `--json` or `--line`;
 * - exits 0 where it printed (including where the workspace holds state but
 *   no run), 1 where the workspace holds no state at all, and 2 for a usage
 *   refusal;
 * - starts no process and writes no file of any kind (F129-FR-015):
 *   `dead`, `stale` and `launch-abandoned` are derived, never written.
 *
 * The read model is a PARAMETER and not an import, for the reason
 * `cached-view.ts` records: the import-boundary check of feature 100 refuses
 * an import between two packages of layer L6 that the `mayImport` of the
 * graph does not name explicitly, and the entry of `@specstride/cli` carries
 * the prose "every package above" (`packages/contracts/data/package-graph.json`).
 * The request to feature 100 is open (R-129-04 of
 * `specs/129-run-view-and-status/contracts/README.md`). The host hands in
 * `project`, `renderLine` and `renderView` of `@specstride/view`; a real host
 * is composed once, at the composition root, and the command stays clean of
 * the import.
 *
 * Under the `parity` profile (annex X §X.7, selected by ordinary
 * configuration) `status` prints the compatibility output through the
 * presenter interface of annex G §G.10 of feature 100 (implemented by feature
 * 119) from the same view, and `--line` and `--json` print nothing
 * (F129-SC-009).
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
  leaseObservationOf,
  handshakeLimitSecOf,
  searchProcessTable,
  type LockProbePort,
  type ProcessTablePort,
} from "./probes.ts";
import {
  compatibilityLines,
  isParityProfile,
  statusJson,
  statusLineText,
  statusTextLines,
  type RenderLine,
  type RenderView,
  type ViewRecord,
} from "./output.ts";

/** The pure read model, as the host hands it in (`project` of `@specstride/view`). */
export type ProjectView = (inputs: unknown, ports?: unknown) => unknown;

/** The exit codes of `status` (F129-FR-024). */
export const EXIT_CODES = Object.freeze({
  /** The command printed. */
  ok: 0,
  /** The workspace holds no state at all. */
  noState: 1,
  /** A usage refusal. */
  usage: 2,
} as const);

/** What one run of `status` did. */
export type StatusRun = {
  readonly exit: number;
  /** The bytes printed to the standard output, in one string. */
  readonly stdout: string;
  readonly stderr: string;
  /** The view the output came from, where one was projected. */
  readonly view: unknown;
};

/** The environment `runStatus` may be handed; every part defaults to the host. */
export type StatusOptions = {
  /** The pure read model (`project`); required — see the header. */
  readonly project: ProjectView;
  /** The renderer of the status line (`renderLine`); required with it. */
  readonly renderLine: RenderLine;
  /** The renderer of the whole view (`renderView`); required with it. */
  readonly renderView: RenderView;
  /** The ports of the read model, handed through to `project`. */
  readonly ports?: unknown;
  /** The control plane and the working tree; the default takes
   * `SPECSTRIDE_STATE_DIR` for the control root and `cwd` for the tree. */
  readonly place?: ControlPlace;
  /** The EP-13 probe; the shipped provider of feature 122 in a real host. */
  readonly lock?: LockProbePort;
  /**
   * T056 — the port of the process table; the search for the run token is
   * REPORT ONLY (F129-FR-021). Where none is handed in, no holder is listed.
   */
  readonly procs?: ProcessTablePort;
  /** The selected profile; the `parity` profile changes what is printed. */
  readonly profile?: string;
  /** The time of the projection; the default is the clock of the host. */
  readonly now?: () => string;
  /** The configuration, for `runtime.handshake.timeoutSec`. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** The environment, for the handshake limit a fixture sets. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Where the bytes go; the default is the standard output of the process. */
  readonly write?: ((text: string) => void) | undefined;
  readonly writeError?: ((text: string) => void) | undefined;
};

/** The parsed arguments. */
type ParsedArgv = {
  readonly json: boolean;
  readonly line: boolean;
  readonly feature: string | null;
  readonly error: string | null;
};

const USAGE = "usage: specstride status [--json | --line] [--feature <slug>] [--workspace <dir>]\n";

function parseArgv(argv: readonly string[]): ParsedArgv {
  let json = false;
  let line = false;
  let feature: string | null = null;
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === "--json") {
      if (line) return { json, line, feature, error: "--json and --line are alternatives" };
      json = true;
    } else if (arg === "--line") {
      if (json) return { json, line, feature, error: "--json and --line are alternatives" };
      line = true;
    } else if (arg === "--feature") {
      const value = argv[++at];
      if (value === undefined) return { json, line, feature, error: "--feature needs a value" };
      feature = value;
    } else if (arg.startsWith("--feature=")) {
      feature = arg.slice("--feature=".length);
    } else if (arg === "--workspace" || arg.startsWith("--workspace=")) {
      // The working tree is fixed by the place; the flag is accepted and read
      // where a caller hands no place (the control root names its workspace).
      if (arg === "--workspace" && argv[++at] === undefined) {
        return { json, line, feature, error: "--workspace needs a value" };
      }
    } else {
      return { json, line, feature, error: `unknown argument ${arg}` };
    }
  }
  return { json, line, feature, error: null };
}

/** One run of `status`: the whole behaviour of the command, with no process. */
export function runStatus(argv: readonly string[], options: StatusOptions): StatusRun {
  const out: string[] = [];
  const err: string[] = [];
  const print = options.write ?? ((text: string): void => void out.push(text));
  const printError = options.writeError ?? ((text: string): void => void err.push(text));

  const parsed = parseArgv(argv);
  if (parsed.error !== null) {
    printError(`specstride status: ${parsed.error}\n${USAGE}`);
    return Object.freeze({
      exit: EXIT_CODES.usage,
      stdout: out.join(""),
      stderr: err.join(""),
      view: null,
    });
  }

  const controlRoot = options.place?.controlRoot ?? options.environment?.["SPECSTRIDE_STATE_DIR"];
  const workspaceRealPath = options.place?.workspaceRealPath ?? process.cwd();
  const now = options.now ?? ((): string => new Date().toISOString());
  const parity = isParityProfile(options.profile, PROFILE_NAME);

  // No state at all: no control plane is reachable (F129-FR-024, exit 1).
  if (controlRoot === undefined || controlRoot === "") {
    print("status: the workspace holds no state\n");
    return Object.freeze({
      exit: EXIT_CODES.noState,
      stdout: out.join(""),
      stderr: err.join(""),
      view: null,
    });
  }
  const place: ControlPlace = options.place ?? { controlRoot, workspaceRealPath };

  if (holdsNoState(place)) {
    print("status: the workspace holds no state\n");
    return Object.freeze({
      exit: EXIT_CODES.noState,
      stdout: out.join(""),
      stderr: err.join(""),
      view: null,
    });
  }

  // Resolve the current run (F129-FR-024): the pointer of the newest engine
  // start, else the newest launch record of the workspace.
  const pointer = readCurrentPointer(place);
  const newest = newestLaunchRecordOf(place);
  const runId =
    pointer.runId ??
    (typeof newest.record?.["runId"] === "string" ? String(newest.record["runId"]) : null);
  const slug =
    parsed.feature ??
    pointer.feature ??
    (typeof newest.record?.["feature"] === "string" ? String(newest.record["feature"]) : null);

  // State, but no run: the command says so and exits 0 (F129-FR-024).
  if (runId === null || slug === null) {
    print("status: no run is recorded yet\n");
    return Object.freeze({
      exit: EXIT_CODES.ok,
      stdout: out.join(""),
      stderr: err.join(""),
      view: null,
    });
  }

  // The observations the caller supplies (F129-FR-001).
  const newestLaunchRecord = newest.launchId === null ? null : newest.record;
  const launchId =
    newest.launchId ??
    pointer.launchId ??
    (typeof newestLaunchRecord?.["launchId"] === "string"
      ? String(newestLaunchRecord["launchId"])
      : null);
  const supervisionRecord = launchId === null ? null : readSupervisionRecord(place, launchId);
  const handshakeLimitSec = handshakeLimitSecOf(options.config ?? {}, options.environment ?? {});

  const runRecord = readRunRecord(place, slug, runId);
  const terminalRecord = readTerminalRecord(place, slug, runId);
  const pauseRecord = readPauseRecord(place, slug, runId);

  const events = readEvents(eventsPathOf(place, slug, runId));
  const view = options.project(
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
        handshakeLimitSec,
      },
      now: now(),
    },
    options.ports,
  ) as ViewRecord | null;

  if (view === null || typeof view !== "object") {
    printError("specstride status: the read model gave no view\n");
    return Object.freeze({
      exit: EXIT_CODES.usage,
      stdout: out.join(""),
      stderr: err.join(""),
      view: null,
    });
  }

  // The output (F129-FR-025, F129-FR-026, F129-FR-027, F129-SC-009). Under the
  // parity profile `status` prints the compatibility output from the same
  // view, and `--line` and `--json` print nothing.
  const lines: readonly string[] = parity
    ? parsed.json || parsed.line
      ? []
      : compatibilityLines(view)
    : parsed.json
      ? [statusJson(view, options.renderView)]
      : parsed.line
        ? [statusLineText(view, options.renderLine)]
        : statusTextLines(view, options.renderLine);
  for (const line of lines) print(`${line}\n`);

  return Object.freeze({ exit: EXIT_CODES.ok, stdout: out.join(""), stderr: err.join(""), view });
}

/**
 * One poll of `wait --until-change` (F129-FR-029): the same projection, the
 * status line WITH the cursor token, and nothing else. Under the `parity`
 * profile it prints 0 bytes (F129-SC-009). The loop over the cursor is the
 * work of the phase that owns `wait`; this is the print of one reading, shared
 * by both callers so that parity holds for either. The cursor token is read
 * off the view structurally (`cur=<offset>.<seq>.<sig>`), and the status line
 * comes from the renderer the host hands in.
 */
export function waitOnce(
  view: unknown,
  options: { readonly profile?: string; readonly renderLine: RenderLine },
): string {
  if (isParityProfile(options.profile, PROFILE_NAME)) return "";
  const record = view as {
    cursor?: { offset?: unknown; lastSeq?: unknown };
    signature?: { token?: unknown };
  } | null;
  if (record === null || typeof record !== "object") return "";
  const line = options.renderLine(view);
  const cursor = record.cursor;
  const token = record.signature?.token;
  if (cursor === undefined || token === undefined) return `${line}\n`;
  return `${line} cur=${String(cursor.offset)}.${String(cursor.lastSeq)}.${String(token)}\n`;
}
