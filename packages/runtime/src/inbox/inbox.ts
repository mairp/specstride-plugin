/**
 * T060 — the inbox (F122-FR-029, F122-FR-030; annex B §B.11, F100-FR-065).
 *
 * *After launch, the inbox MUST be the only place where a process outside the
 * runtime tree writes, apart from launch records and the supervision record,
 * which the CLI writes. The inbox MUST accept exactly the request types of
 * feature 100 annex B §B.11. A request MUST be written to a temporary name and
 * renamed. The runtime MUST validate every request against its schema before
 * it acts on it, MUST ignore and report a request of an unknown type or one
 * that fails validation, and MUST read requests at boundaries and never be
 * interrupted by one. A request found anywhere else, the workspace part
 * included, MUST NOT be read.*
 *
 * *A stop request MUST be accepted when no run is active, and MUST stay in the
 * inbox until it is honoured: the next engine start MUST read it at its first
 * boundary and stop as at the baseline. An empty stop request MUST be valid and
 * MUST mean a clean stop with every default. The process that honours a request
 * MUST remove it.*
 *
 * Four sentences of mechanism, and each one is a decision here:
 *
 *   - **the inbox** is three logical names and nothing else. `inboxPathOf`
 *     resolves them out of the layout table of feature 100, so the only paths
 *     this module will ever open are the ones `readableInboxPaths` lists. That
 *     is how *a request found anywhere else, the workspace part included, is
 *     not read*: not by a check that rejects the other path, but because no
 *     code here can name it. `requestIsNotRead` is the same fact, written so a
 *     test can read it.
 *   - **written to a temporary name and renamed** is the atomic write of the
 *     kernel, which the CLI calls through `writeRequest`. The writer validates
 *     before it renames, so the inbox never holds a request this product wrote
 *     and would then refuse.
 *   - **validate before it acts** is `validateRequest`, and it runs on the
 *     BYTES, before any reader sees a field. A request of an unknown type or
 *     one that fails its schema becomes an `IgnoredReport` and never a value.
 *     The report is an event of the run, so "reported" is durable and a reader
 *     outside this process can find it.
 *   - **at boundaries and never interrupted** is why the reading is a POLL and
 *     nothing else: `readInboxAtBoundary` opens the files, reads them and
 *     returns. No watcher, no signal handler, no timer (`A_WATCHER`,
 *     `NEVER_INTERRUPTS_A_PASS`) — the control path of the constitution's
 *     Principle I. A pass that is running cannot be reached by a request; the
 *     boundary after it can.
 *
 * The record itself belongs to feature 100: every request goes out through,
 * and comes in through, `tryReadRecord` of `@specstride/contracts`, keyed by
 * the logical name of the inbox entry, so a request the owning feature would
 * refuse never reaches a reader of this one.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { atomicWrite } from "@specstride/kernel";
import { systemClock } from "@specstride/kernel";
import type { Clock } from "@specstride/contracts/ep/kernel-services";
import { inboxRequestTypes } from "@specstride/contracts/enums/all-sets";
import { engineExitOf } from "@specstride/contracts/codes/stop-reasons";
import { readersOf, resolve, rootPathsOf, writerOf } from "@specstride/contracts/ids/logical-names";
import { schemaIdOfLogicalName, tryReadRecord } from "@specstride/contracts/records/validate";
import { appendEvent, type RootPlace } from "../root/start.ts";

/** The requirements this module carries. */
export const INBOX_REQUIREMENTS = ["F122-FR-029", "F122-FR-030"] as const;

/** The schema id of every inbox request (annex B, §B.11). */
export const INBOX_SCHEMA_ID = "specstride.inbox/1" as const;

/** The three request types, read from row 21 of annex X §X.6. */
export const INBOX_REQUEST_TYPES = inboxRequestTypes.members;
export type InboxRequestType = (typeof INBOX_REQUEST_TYPES)[number];

/** The three logical names of the inbox (annex B, §B.5, §B.11). */
export const STOP_NAME = "inbox:stop" as const;
export const HOLD_RELAUNCH_NAME = "inbox:hold-relaunch" as const;
export const HOST_EVENTS_NAME = "inbox:host-events:<launchId>" as const;

/** Which logical name carries which request type (annex B, §B.11). */
export const LOGICAL_NAME_OF_TYPE: Readonly<Record<InboxRequestType, string>> = Object.freeze({
  stop: STOP_NAME,
  "hold-relaunch": HOLD_RELAUNCH_NAME,
  "host-event": HOST_EVENTS_NAME,
});

/** Owner-only, as every file of the control plane (F100-FR-043). */
export const FILE_MODE = 0o600 as const;
export const DIRECTORY_MODE = 0o700 as const;

/**
 * F122-FR-029 — the reading is a poll at a boundary. There is no watcher in
 * the control path (the constitution, Principle I), so a request can never
 * interrupt a pass: it waits in the inbox until a reader comes past.
 */
export const A_WATCHER = false as const;
export const READ_AT_BOUNDARIES_ONLY = true as const;
export const NEVER_INTERRUPTS_A_PASS = true as const;

/** F122-FR-030 — a stop request is accepted while no run is active. */
export const STOP_ACCEPTED_WITH_NO_RUN_ACTIVE = true as const;

/** F100-FR-065 — a host event informs only; it stops nothing by itself. */
export const HOST_EVENT_INFORMS_ONLY = true as const;

/**
 * F122-FR-030 — *stop as at the baseline*: the stop reason `stop_flag` of
 * annex E §E.3 and the engine exit code that the table of feature 100 gives
 * it. Both are READ from that table and not written out here.
 */
export const BASELINE_STOP_REASON = "stop_flag" as const;
export const BASELINE_STOP_EXIT: number = engineExitOf(BASELINE_STOP_REASON) ?? -1;

/** The two readers of the inbox, as the `Readers` column of §B.5 names them. */
export const READERS = ["engine", "runtime-root"] as const;
export type Reader = (typeof READERS)[number];

/** The one writer of every inbox entry, from the table itself (F100-FR-051). */
export const WRITER_OF_THE_INBOX: string = writerOf(STOP_NAME);

const normaliseReader = (cell: string): string => cell.trim().toLowerCase().split(" ").join("-");

/**
 * The readers the table names for a request type (annex B §B.5): a reader acts
 * only on the types it is named for, so the runtime root never reads a host
 * event and the engine never reads a hold of a relaunch.
 */
export function readersOfType(type: InboxRequestType): readonly string[] {
  return Object.freeze(readersOf(LOGICAL_NAME_OF_TYPE[type]).map(normaliseReader));
}

/** True where the table names `reader` as a reader of that request type. */
export function readerActsOn(reader: Reader, type: InboxRequestType): boolean {
  return readersOfType(type).includes(reader);
}

/** Where an inbox lives: the control root of one workspace. */
export type InboxPlace = {
  readonly controlRoot: string;
  /** The REAL path of the workspace root, for the workspace part. */
  readonly workspaceRealPath: string;
};

function rootsOf(place: InboxPlace): Readonly<Record<string, string>> {
  return rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
}

/**
 * The path of one inbox entry, resolved from the layout table (F100-FR-053).
 * `host-event` needs the launch id its file is named after.
 */
export function inboxPathOf(type: InboxRequestType, place: InboxPlace, launchId?: string): string {
  const name = LOGICAL_NAME_OF_TYPE[type];
  const parameters: Readonly<Record<string, string>> =
    type === "host-event" ? { "<launchId>": launchId ?? "" } : {};
  if (type === "host-event" && (launchId === undefined || launchId === "")) {
    throw new InboxRefusedError(
      "missing-launch-id",
      `the logical name "${name}" needs the launch id of the run (annex B, §B.5)`,
    );
  }
  return resolve(name, parameters, rootsOf(place));
}

/** The directory the inbox entries live in, under the control root. */
export function inboxDirectoryOf(place: InboxPlace): string {
  return dirname(inboxPathOf("stop", place));
}

/** The workspace part of the tree: state of the run is never read from it. */
export function workspacePartOf(place: InboxPlace): string {
  return rootsOf(place)["<workspace-part>"] ?? "";
}

/** One entry of the inbox: its type, its logical name and its path. */
export type InboxEntry = {
  readonly type: InboxRequestType;
  readonly logicalName: string;
  readonly path: string;
};

/**
 * F122-FR-029 — the ONLY paths a reader of this module ever opens. A request
 * that lies anywhere else is not read, because nothing here can name it.
 */
export function readableInboxPaths(place: InboxPlace, launchId?: string): readonly InboxEntry[] {
  const entries: InboxEntry[] = [
    { type: "stop", logicalName: STOP_NAME, path: inboxPathOf("stop", place) },
    {
      type: "hold-relaunch",
      logicalName: HOLD_RELAUNCH_NAME,
      path: inboxPathOf("hold-relaunch", place),
    },
  ];
  if (launchId !== undefined && launchId !== "") {
    entries.push({
      type: "host-event",
      logicalName: HOST_EVENTS_NAME,
      path: inboxPathOf("host-event", place, launchId),
    });
  }
  return Object.freeze(entries.map((e) => Object.freeze(e)));
}

/** True where the path is one of the inbox entries of this place. */
export function isInsideTheInbox(path: string, place: InboxPlace, launchId?: string): boolean {
  const real = resolvePath(path);
  const directory = resolvePath(inboxDirectoryOf(place));
  if (!(real === directory || real.startsWith(directory + sep))) return false;
  return readableInboxPaths(place, launchId).some((e) => resolvePath(e.path) === real);
}

/**
 * F122-FR-029, last sentence — *a request found anywhere else, the workspace
 * part included, MUST NOT be read*. True for every path that is not an entry
 * of the inbox, whatever it holds.
 */
export function requestIsNotRead(path: string, place: InboxPlace, launchId?: string): boolean {
  return !isInsideTheInbox(path, place, launchId);
}

/* ================================================================== *
 * The write of the CLI: a temporary name, then a rename.
 * ================================================================== */

/** Why a write or a path was refused. */
export const INBOX_REFUSALS = [
  "unknown-type",
  "missing-launch-id",
  "missing-required-field",
  "schema-refused",
] as const;
export type InboxRefusal = (typeof INBOX_REFUSALS)[number];

/** A request the writer refused to write (F122-FR-029). */
export class InboxRefusedError extends Error {
  readonly reason: InboxRefusal;
  constructor(reason: InboxRefusal, message: string) {
    super(message);
    this.name = "InboxRefusedError";
    this.reason = reason;
  }
}

/** What the CLI brings to a write. */
export type WriteRequestInput = {
  readonly place: InboxPlace;
  readonly type: string;
  readonly launchId?: string | undefined;
  /** The fields of the type, from the table of §B.11. */
  readonly fields?: Readonly<Record<string, unknown>> | undefined;
  readonly clock?: Clock | undefined;
};

/** What a write left on the disk. */
export type WrittenRequest = {
  readonly type: InboxRequestType;
  readonly logicalName: string;
  readonly path: string;
  /** The bytes as they lie on the disk. */
  readonly bytes: string;
  /** The hash of those bytes; it names the request in a report. */
  readonly hash: string;
};

/** The hash of the bytes of a request: a content identity a reader can check. */
export function hashOfRequest(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/**
 * F122-FR-029 — the write of the CLI: the record is built, VALIDATED, written
 * to a temporary name in the same directory and renamed into place. A reader
 * at a boundary therefore sees either no request or a whole one.
 */
export function writeRequest(input: WriteRequestInput): WrittenRequest {
  const type = input.type;
  if (!inboxRequestTypes.has(type)) {
    throw new InboxRefusedError("unknown-type", inboxRequestTypes.onUnknown(type).message);
  }
  const clock = input.clock ?? systemClock;
  const record: Record<string, unknown> = {
    schema: INBOX_SCHEMA_ID,
    type,
    at: clock.nowIso(),
    ...(input.fields ?? {}),
  };
  const missing = missingRequiredFieldOf(type, record);
  if (missing !== undefined) {
    throw new InboxRefusedError(
      "missing-required-field",
      `a request of type \`${type}\` needs the field \`${missing}\` (annex B, §B.11)`,
    );
  }
  const refusal = tryReadRecord(LOGICAL_NAME_OF_TYPE[type], record);
  if (!refusal.ok) {
    throw new InboxRefusedError("schema-refused", refusal.error.message);
  }
  const path = inboxPathOf(type, input.place, input.launchId);
  const line = JSON.stringify(record);
  // A host event is one line of a stream of host events: the file is read,
  // the line is appended and the WHOLE file is renamed into place, so the
  // write stays the atomic write of F122-FR-029 and no reader sees a half line.
  const bytes = type === "host-event" ? textOf(path) + line + "\n" : line + "\n";
  atomicWrite(path, bytes, {
    mode: FILE_MODE,
    createDirectory: true,
    root: input.place.controlRoot,
    controlRoot: input.place.controlRoot,
  });
  return Object.freeze({
    type,
    logicalName: LOGICAL_NAME_OF_TYPE[type],
    path,
    bytes,
    hash: hashOfRequest(bytes),
  });
}

/**
 * F122-FR-030 — *an empty stop request MUST be valid and MUST mean a clean
 * stop with every default*. It is the one record of annex B that carries no
 * field, `schema` included (F100-FR-065), so it is written as empty bytes and
 * never passed through the schema.
 */
export function writeEmptyStopRequest(place: InboxPlace): WrittenRequest {
  const path = inboxPathOf("stop", place);
  atomicWrite(path, "", {
    mode: FILE_MODE,
    createDirectory: true,
    root: place.controlRoot,
    controlRoot: place.controlRoot,
  });
  return Object.freeze({
    type: "stop" as const,
    logicalName: STOP_NAME,
    path,
    bytes: "",
    hash: hashOfRequest(""),
  });
}

/**
 * The bytes of a file, or the empty text where there is none. A missing inbox
 * entry is the normal case and never an error.
 */
function textOf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The required field of a type that the record does not carry (§B.11). */
function missingRequiredFieldOf(
  type: InboxRequestType,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const field of REQUIRED_FIELDS_OF_TYPE[type]) {
    const value = record[field];
    if (value === undefined || value === null) return field;
    if (field === "kind" && (typeof value !== "string" || value.trim() === "")) return field;
    if (field === "hold" && typeof value !== "boolean") return field;
  }
  return undefined;
}

/**
 * The fields the table of §B.11 marks `Yes` for a type, beyond the three every
 * request carries. `stop` has none, which is what makes the empty stop request
 * possible.
 */
export const REQUIRED_FIELDS_OF_TYPE: Readonly<Record<InboxRequestType, readonly string[]>> =
  Object.freeze({
    stop: Object.freeze([]),
    "hold-relaunch": Object.freeze(["hold"]),
    "host-event": Object.freeze(["kind"]),
  });

/* ================================================================== *
 * Validation: on the bytes, before a reader sees a field.
 * ================================================================== */

/** Why a request was ignored (F122-FR-029). */
export const IGNORED_REASONS = [
  "unknown-type",
  "malformed",
  "schema-refused",
  "missing-required-field",
  "wrong-type-for-the-name",
] as const;
export type IgnoredReason = (typeof IGNORED_REASONS)[number];

/** What a reader learns about a request it ignored. */
export type IgnoredRequest = {
  readonly reason: IgnoredReason;
  readonly detail: string;
  readonly logicalName: string;
  readonly path: string;
  /** The hash of the bytes that were ignored. */
  readonly hash: string;
};

/** A stop request as a reader reads it (§B.11, with every default). */
export type StopRequest = {
  readonly type: "stop";
  readonly now: boolean;
  readonly jobs: boolean;
  readonly causedBy: string;
  /** True for the empty stop request: a clean stop with every default. */
  readonly empty: boolean;
  readonly at?: string | undefined;
};

/** A hold of a relaunch as a reader reads it (§B.11). */
export type HoldRelaunchRequest = {
  readonly type: "hold-relaunch";
  readonly hold: boolean;
  readonly reason?: string | undefined;
  readonly at?: string | undefined;
};

/** A host event as a reader reads it (§B.11). */
export type HostEventRequest = {
  readonly type: "host-event";
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly at?: string | undefined;
};

export type ValidRequest = StopRequest | HoldRelaunchRequest | HostEventRequest;

/** The answer of the validation of one request. */
export type Validation =
  | { readonly ok: true; readonly request: ValidRequest; readonly hash: string }
  | { readonly ok: false; readonly ignored: IgnoredRequest };

/** The defaults of a stop request (§B.11). */
export const STOP_DEFAULTS = Object.freeze({ now: false, jobs: false, causedBy: "operator" });

/**
 * F122-FR-029 — validate one request against its schema before anything acts
 * on it. The input is the BYTES and the logical name they were found under: a
 * request whose `type` is not the type of its name is not read as that type,
 * so a hold of a relaunch dropped into the stop entry stops nothing.
 */
export function validateRequest(input: {
  readonly text: string;
  readonly expected: InboxRequestType;
  readonly path: string;
}): Validation {
  const { text, expected, path } = input;
  const logicalName = LOGICAL_NAME_OF_TYPE[expected];
  const hash = hashOfRequest(text);
  const ignore = (reason: IgnoredReason, detail: string): Validation =>
    Object.freeze({
      ok: false as const,
      ignored: Object.freeze({ reason, detail, logicalName, path, hash }),
    });

  // F122-FR-030 — the empty stop request: valid, every default, no field.
  if (text.trim() === "") {
    if (expected === "stop") {
      return Object.freeze({
        ok: true as const,
        hash,
        request: Object.freeze({ type: "stop" as const, ...STOP_DEFAULTS, empty: true }),
      });
    }
    return ignore(
      "malformed",
      `the entry "${logicalName}" is empty; only a stop request may carry no field (F100-FR-065)`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return ignore("malformed", `the request is no record: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return ignore("malformed", "the request is no record (annex B, §B.4)");
  }
  const record = parsed as Record<string, unknown>;

  const carried = record["type"];
  if (typeof carried !== "string" || !inboxRequestTypes.has(carried)) {
    const outcome = inboxRequestTypes.onUnknown(String(carried));
    return ignore("unknown-type", outcome.message);
  }
  if (carried !== expected) {
    return ignore(
      "wrong-type-for-the-name",
      `the entry "${logicalName}" carries a request of type \`${carried}\` (annex B, §B.11)`,
    );
  }

  const read = tryReadRecord(logicalName, record);
  if (!read.ok) return ignore("schema-refused", read.error.message);

  const missing = missingRequiredFieldOf(expected, record);
  if (missing !== undefined) {
    return ignore(
      "missing-required-field",
      `a request of type \`${expected}\` needs the field \`${missing}\` (annex B, §B.11)`,
    );
  }

  const at = typeof record["at"] === "string" ? (record["at"] as string) : undefined;
  if (expected === "stop") {
    return Object.freeze({
      ok: true as const,
      hash,
      request: Object.freeze({
        type: "stop" as const,
        now: record["now"] === true,
        jobs: record["jobs"] === true,
        causedBy:
          typeof record["causedBy"] === "string"
            ? (record["causedBy"] as string)
            : STOP_DEFAULTS.causedBy,
        empty: false,
        at,
      }),
    });
  }
  if (expected === "hold-relaunch") {
    return Object.freeze({
      ok: true as const,
      hash,
      request: Object.freeze({
        type: "hold-relaunch" as const,
        hold: record["hold"] === true,
        reason: typeof record["reason"] === "string" ? (record["reason"] as string) : undefined,
        at,
      }),
    });
  }
  return Object.freeze({
    ok: true as const,
    hash,
    request: Object.freeze({
      type: "host-event" as const,
      kind: record["kind"] as string,
      data: Object.freeze(
        (typeof record["data"] === "object" && record["data"] !== null
          ? (record["data"] as Record<string, unknown>)
          : {}) as Record<string, unknown>,
      ),
      at,
    }),
  });
}

/* ================================================================== *
 * Reporting: durable, so that "reported" is not a word of this process.
 * ================================================================== */

/** The two events this module writes into the stream of the run. */
export const IGNORED_EVENT = "inbox.request_ignored" as const;
export const HONOURED_EVENT = "inbox.request_honoured" as const;

/** What a reader records about a request it ignored or honoured. */
export type InboxReport = {
  readonly event: typeof IGNORED_EVENT | typeof HONOURED_EVENT;
  readonly logicalName: string;
  readonly path: string;
  readonly hash: string;
  readonly reason?: IgnoredReason | undefined;
  readonly detail?: string | undefined;
  readonly requestType?: InboxRequestType | undefined;
  readonly reader: Reader;
};

/** Where a report goes. */
export type Reporter = (report: InboxReport) => void;

/**
 * F122-FR-029 — *ignore and report*. The report is an event of the run, so a
 * process that was not there can read afterwards that a request arrived and
 * was not acted on. `data` carries the hash of the bytes and never the bytes:
 * outside text is data and is not pasted into state.
 */
export function reportToTheEventStream(where: RootPlace, launchId: string): Reporter {
  return (report: InboxReport): void => {
    appendEvent({
      where,
      type: report.event,
      launchId,
      data: {
        name: report.logicalName,
        requestHash: report.hash,
        reader: report.reader,
        ...(report.requestType === undefined ? {} : { requestType: report.requestType }),
        ...(report.reason === undefined ? {} : { reason: report.reason }),
        ...(report.detail === undefined ? {} : { detail: report.detail }),
      },
    });
  };
}

/* ================================================================== *
 * Reading at a boundary, and the removal when a request is honoured.
 * ================================================================== */

/** What a reader brings to a boundary. */
export type BoundaryInput = {
  readonly place: InboxPlace;
  /** Which reader this is; it reads only the types the table names it for. */
  readonly reader: Reader;
  /** The launch id, where host events are to be read. */
  readonly launchId?: string | undefined;
  /** Where a report goes; none means the reading reports in its answer only. */
  readonly report?: Reporter | undefined;
  /**
   * F122-FR-029 — *ignored and reported*, once per arrival. An ignored request
   * is not honoured, so it is NOT removed and the next boundary meets it
   * again. A reader that polls at every boundary of a run that lasts hours
   * passes the same set here, keyed by the entry and the hash of its bytes, so
   * that one arrival leaves one report and the run goes on.
   */
  readonly reported?: Set<string> | undefined;
};

/** A valid request a reader found, with the removal that honours it. */
export type HonourableRequest = {
  readonly request: ValidRequest;
  readonly logicalName: string;
  readonly path: string;
  readonly hash: string;
  /**
   * F122-FR-030 — *the process that honours a request MUST remove it*. True
   * where this call removed it; false where it was gone already.
   */
  readonly honour: () => boolean;
};

/** Everything one boundary saw. */
export type BoundaryReading = {
  /** The valid requests, in the order of the entries of the inbox. */
  readonly requests: readonly HonourableRequest[];
  /** The requests that were ignored, each with its reason. */
  readonly ignored: readonly IgnoredRequest[];
  /** The stop request, where one was found and this reader reads stops. */
  readonly stop: HonourableRequest | undefined;
};

/**
 * F122-FR-029 — read the inbox at a boundary. One poll: every entry the table
 * names this reader for is opened, validated and either returned as a request
 * or reported as ignored. Nothing here waits, watches or signals, so a pass
 * that is running is never interrupted by a request.
 */
export function readInboxAtBoundary(input: BoundaryInput): BoundaryReading {
  const requests: HonourableRequest[] = [];
  const ignored: IgnoredRequest[] = [];
  for (const entry of readableInboxPaths(input.place, input.launchId)) {
    if (!readerActsOn(input.reader, entry.type)) continue;
    let text: string;
    try {
      text = readFileSync(entry.path, "utf8");
    } catch {
      continue; // no request of that type; the normal case
    }
    if (entry.type === "host-event") {
      for (const line of linesOf(text)) {
        const one = validateRequest({ text: line, expected: "host-event", path: entry.path });
        if (one.ok) {
          requests.push(
            honourable(one.request, entry, one.hash, input, () =>
              removeHostEventLine(entry.path, line),
            ),
          );
        } else {
          ignored.push(one.ignored);
          reportOnce(input, one.ignored);
        }
      }
      continue;
    }
    const one = validateRequest({ text, expected: entry.type, path: entry.path });
    if (one.ok) {
      requests.push(honourable(one.request, entry, one.hash, input, () => removeFile(entry.path)));
    } else {
      ignored.push(one.ignored);
      reportOnce(input, one.ignored);
    }
  }
  const stop = requests.find((r) => r.request.type === "stop");
  return Object.freeze({
    requests: Object.freeze(requests),
    ignored: Object.freeze(ignored),
    stop,
  });
}

function honourable(
  request: ValidRequest,
  entry: InboxEntry,
  hash: string,
  input: BoundaryInput,
  remove: () => boolean,
): HonourableRequest {
  return Object.freeze({
    request,
    logicalName: entry.logicalName,
    path: entry.path,
    hash,
    honour: (): boolean => {
      const removed = remove();
      if (removed) {
        input.report?.({
          event: HONOURED_EVENT,
          logicalName: entry.logicalName,
          path: entry.path,
          hash,
          requestType: request.type,
          reader: input.reader,
        });
      }
      return removed;
    },
  });
}

/** Report an ignored request, once per arrival where the caller keeps a set. */
function reportOnce(input: BoundaryInput, ignored: IgnoredRequest): void {
  const key = `${ignored.path}\u0000${ignored.hash}`;
  if (input.reported !== undefined) {
    if (input.reported.has(key)) return;
    input.reported.add(key);
  }
  input.report?.(reportOfIgnored(ignored, input.reader));
}

function reportOfIgnored(ignored: IgnoredRequest, reader: Reader): InboxReport {
  return {
    event: IGNORED_EVENT,
    logicalName: ignored.logicalName,
    path: ignored.path,
    hash: ignored.hash,
    reason: ignored.reason,
    detail: ignored.detail,
    reader,
  };
}

/** The lines of a stream of host events, empty lines dropped. */
function linesOf(text: string): readonly string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** Remove one entry of the inbox. False where it was gone already. */
function removeFile(path: string): boolean {
  try {
    statSync(path);
  } catch {
    return false;
  }
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove ONE honoured host event from its stream and leave the rest: the
 * requirement removes the request that was honoured, not the file it shared
 * with requests that were not. The rewrite is the atomic write again.
 *
 * The line is found by its own BYTES and not by the ordinal it had when it was
 * read, because honouring the earlier of two events moves the later one: an
 * ordinal would then name the wrong request.
 */
function removeHostEventLine(path: string, line: string): boolean {
  const lines = [...linesOf(textOf(path))];
  const index = lines.indexOf(line);
  if (index < 0) return false;
  lines.splice(index, 1);
  if (lines.length === 0) return removeFile(path);
  atomicWrite(path, lines.join("\n") + "\n", { mode: FILE_MODE });
  return true;
}

/**
 * F122-FR-030 — honour the request of a type directly, for a caller that has
 * no reading in hand. It removes the entry and answers whether one was there.
 */
export function honourRequest(input: {
  readonly place: InboxPlace;
  readonly type: InboxRequestType;
  readonly launchId?: string | undefined;
}): boolean {
  return removeFile(inboxPathOf(input.type, input.place, input.launchId));
}

/* ================================================================== *
 * The first boundary of an engine start.
 * ================================================================== */

/** What the first boundary of an engine start decided. */
export type FirstBoundary = {
  readonly reading: BoundaryReading;
  /** True where this engine start stops before it does any work. */
  readonly stops: boolean;
  /** The stop reason of the baseline, where it stops. */
  readonly stopReason: typeof BASELINE_STOP_REASON | undefined;
  /** The exit code the engine ends with, from the table of annex E §E.3. */
  readonly engineExit: number | undefined;
  /** The stop request, where one was found. */
  readonly stop: HonourableRequest | undefined;
};

/**
 * F122-FR-030 — *the next engine start MUST read it at its first boundary and
 * stop as at the baseline*. The engine is not of this feature; what is of this
 * feature is that the request SURVIVED the absence of a run and is there to be
 * read, with the stop reason and the exit code of the baseline beside it.
 */
export function firstBoundaryOfAnEngineStart(input: BoundaryInput): FirstBoundary {
  const reading = readInboxAtBoundary({ ...input, reader: "engine" });
  const stop = reading.stop;
  return Object.freeze({
    reading,
    stops: stop !== undefined,
    stopReason: stop === undefined ? undefined : BASELINE_STOP_REASON,
    engineExit: stop === undefined ? undefined : BASELINE_STOP_EXIT,
    stop,
  });
}

/** Make the inbox directory of a place, owner-only. */
export function makeInboxDirectory(place: InboxPlace): string {
  const directory = inboxDirectoryOf(place);
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  return directory;
}

/** Remove the whole inbox of a place; for a test that cleans up after itself. */
export function removeInbox(place: InboxPlace): void {
  rmSync(inboxDirectoryOf(place), { recursive: true, force: true });
}

/** The schema id the layout table gives the inbox entries (annex B, §B.5). */
export const SCHEMA_ID_OF_THE_INBOX: string | undefined = schemaIdOfLogicalName[STOP_NAME];
