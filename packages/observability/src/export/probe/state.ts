/**
 * T036 — the receiver state and the probe (F128-FR-028).
 *
 * F128-FR-028: *The receiver state of a sink MUST be the highest state that
 * can be proved among `configured`, `reachable`, `request_accepted` and
 * `query_verified`. `configured` MUST hold when the sink is on. `reachable`
 * MUST hold when a plain TCP connection to the host and port of the address
 * (default port 443 for `https`, else 80) succeeds within 1.5 seconds; any
 * failure means not reachable. `request_accepted` MUST hold when a delivery
 * record of the sink with the status `accepted` exists, and `query_verified`
 * when that record has a true `query_verified` field, which nothing in this
 * feature sets. The probe MUST be skipped on request, so that the state
 * starts at `configured`, and MUST read delivery records from the events of
 * the run, tolerating a missing file and malformed lines. The phrases MUST be
 * `export configured`, `endpoint reachable`, `events accepted` and
 * `query-verified`; a state line MUST be `<sink>: <phrase>` and a probe line
 * `<sink>: <phrase> (<url>)`. A call with the wrong number of arguments or an
 * unknown state MUST return the `exit_code` 2 in its result record, and every
 * other call 0, even when the endpoint cannot be reached.*
 */
import { connect, type TcpSocketConnectOpts } from "node:net";
import { readFileSync, existsSync } from "node:fs";

import {
  DELIVERY_EVENT_TYPE,
  deliveryRecordDataOf,
  type DeliveryRecordData,
} from "../delivery/record.ts";
import { okResult, usageErrorResult, type ResultRecord } from "../delivery/reasons.ts";

/** The four states, from the lowest that is merely configured to the highest. */
export const RECEIVER_STATES = Object.freeze([
  "configured",
  "reachable",
  "request_accepted",
  "query_verified",
] as const);
export type ReceiverState = (typeof RECEIVER_STATES)[number];

/** The phrase of each state (F128-FR-028). */
export const STATE_PHRASES: Readonly<Record<ReceiverState, string>> = Object.freeze({
  configured: "export configured",
  reachable: "endpoint reachable",
  request_accepted: "events accepted",
  query_verified: "query-verified",
});

/** The phrase of a state; an unknown state has none (the call returns exit 2). */
export function phraseForState(state: string): string | undefined {
  return (STATE_PHRASES as Record<string, string | undefined>)[state];
}

/** A state line: `<sink>: <phrase>`. */
export function stateLine(sink: string, state: ReceiverState): string {
  return `${sink}: ${STATE_PHRASES[state]}`;
}

/** A probe line, when the probe ran: `<sink>: <phrase> (<url>)`. */
export function probeLine(sink: string, state: ReceiverState, url: string): string {
  return `${sink}: ${STATE_PHRASES[state]} (${url})`;
}

/** Which of the proofs of a sink hold right now. */
export type StateProofs = {
  readonly enabled: boolean;
  /** The sink the proofs are for: only its own records count. */
  readonly sink?: string;
  /** A TCP connection succeeded within the time limit. */
  readonly reachable?: boolean;
  /** The delivery records read from the events of the run. */
  readonly records?: readonly DeliveryRecordData[];
};

/**
 * The highest state that can be proved: a record of THE SINK with the status
 * `accepted` proves `request_accepted`; if that record carries a true
 * `query_verified`, `query_verified`. A sink that is not on has no state to
 * prove beyond `configured`.
 */
export function receiverStateOf(proofs: StateProofs): ReceiverState {
  if (!proofs.enabled) return "configured";
  const mine = (proofs.records ?? []).filter(
    (r) => r.sink !== undefined && (proofs.sink === undefined || r.sink === proofs.sink),
  );
  const accepted = mine.filter((r) => r.status === "accepted");
  if (accepted.length === 0) {
    return proofs.reachable === true ? "reachable" : "configured";
  }
  if (accepted.some((r) => r.queryVerified === true)) return "query_verified";
  return "request_accepted";
}

/**
 * The highest of two states, for a caller that assembles proofs one at a time.
 */
export function highestState(a: ReceiverState, b: ReceiverState): ReceiverState {
  return RECEIVER_STATES.indexOf(a) >= RECEIVER_STATES.indexOf(b) ? a : b;
}

/* ------------------------------------------------------------------ *
 * The TCP probe.
 * ------------------------------------------------------------------ */

/** The time limit of the probe, in milliseconds. */
export const PROBE_TIMEOUT_MS = 1500 as const;

/** Host and port of an address, with the default port of its scheme. */
export function hostAndPortOf(url: string): { readonly host: string; readonly port: number } {
  const parsed = new URL(url);
  const port = parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  return { host: parsed.hostname, port };
}

/**
 * The plain TCP probe: a connection to the host and port of the address that
 * succeeds within 1.5 seconds proves `reachable`; any failure — refused,
 * timeout, a name that does not resolve — means not reachable. It never
 * throws.
 */
export function probeEndpoint(url: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((done) => {
    let settled = false;
    const finish = (reachable: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(reachable);
    };
    let socket!: ReturnType<typeof connect>;
    try {
      const target = hostAndPortOf(url);
      const options: TcpSocketConnectOpts = { host: target.host, port: target.port };
      socket = connect(options, () => finish(true));
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/* ------------------------------------------------------------------ *
 * The tolerant reader of the delivery records.
 * ------------------------------------------------------------------ */

/** What the reader of an events file found. */
export type RecordsRead = {
  readonly records: readonly DeliveryRecordData[];
  /** The file was not there (tolerated: the state simply stays `configured`). */
  readonly missingFile: boolean;
  /** How many lines were malformed (tolerated, never a failure). */
  readonly malformedLines: number;
};

/**
 * Read the delivery records of a sink out of the events file of the run. A
 * missing file is tolerated; a malformed line is tolerated; only events of
 * the type `telemetry.delivery` are read, and only their data.
 */
export function readDeliveryRecords(eventsFile: string): RecordsRead {
  if (!existsSync(eventsFile)) {
    return Object.freeze({ records: Object.freeze([]), missingFile: true, malformedLines: 0 });
  }
  let malformedLines = 0;
  const records: DeliveryRecordData[] = [];
  for (const line of readFileSync(eventsFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const event = JSON.parse(line) as { type?: string; data?: unknown };
      if (event?.type !== DELIVERY_EVENT_TYPE) continue;
      const data = event.data as unknown;
      // accept either envelope-shaped or plain data objects
      const rec = ((): DeliveryRecordData => {
        if (data && typeof data === "object") {
          const maybe = data as Partial<DeliveryRecordData>;
          if (
            typeof maybe.sink === "string" &&
            typeof maybe.batchId === "string" &&
            typeof maybe.eventCount === "number" &&
            typeof maybe.status === "string"
          ) {
            return deliveryRecordDataOf({
              sink: maybe.sink,
              batchId: maybe.batchId,
              eventCount: maybe.eventCount,
              status: maybe.status,
              httpStatus: (maybe as unknown as { httpStatus?: number | null }).httpStatus ?? null,
              reasonCode: (maybe as unknown as { reasonCode?: string | null }).reasonCode ?? null,
              queryVerified:
                (maybe as unknown as { queryVerified?: unknown }).queryVerified === true,
            });
          }
        }
        // fall back to tolerant shape: build a minimally typed object
        const obj = (data ?? {}) as Record<string, unknown>;
        const sink = typeof obj["sink"] === "string" ? (obj["sink"] as string) : "";
        const batchId = typeof obj["batchId"] === "string" ? (obj["batchId"] as string) : "";
        const eventCount =
          typeof obj["eventCount"] === "number" ? (obj["eventCount"] as number) : 0;
        const status = typeof obj["status"] === "string" ? (obj["status"] as string) : "unknown";
        const httpStatus =
          typeof obj["httpStatus"] === "number" ? (obj["httpStatus"] as number) : null;
        const reasonCode =
          typeof obj["reasonCode"] === "string" ? (obj["reasonCode"] as string) : null;
        const queryVerified = obj["queryVerified"] === true ? true : undefined;
        return deliveryRecordDataOf({
          sink,
          batchId,
          eventCount,
          status,
          httpStatus,
          reasonCode,
          queryVerified,
        });
      })();
      records.push(rec);
    } catch {
      malformedLines += 1;
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    missingFile: false,
    malformedLines,
  });
}

/** The delivery records of one sink, queried by the label the surfaces use. */
export function recordsForSink(
  records: readonly DeliveryRecordData[],
  sink: string,
): readonly DeliveryRecordData[] {
  return Object.freeze(records.filter((r) => r.sink === sink));
}

/* ------------------------------------------------------------------ *
 * The component call that stands for the as-is status command.
 * ------------------------------------------------------------------ */

/** The flags the status call takes, and how many arguments each wants. */
export const STATUS_CALL_FLAGS = Object.freeze({
  "--no-probe": 0, // skip the probe: the state starts at `configured`
  "--events": 1, // the events file the records are read from
  "--url": 1, // the address to probe
  "--sink": 1, // the label the surfaces query
} as const);

/**
 * The `exit_code` of one status call: 2 for a USAGE error — the wrong number
 * of arguments for a flag, an unknown flag, or an unknown state name — and 0
 * for every other call, EVEN WHEN THE ENDPOINT CANNOT BE REACHED.
 */
export function exitCodeForStatusCall(args: readonly string[]): ResultRecord {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--state") {
      const state = args[i + 1];
      if (state === undefined || phraseForState(state) === undefined) {
        return usageErrorResult(
          state === undefined ? "--state needs a state" : `unknown state: ${state}`,
        );
      }
      i += 1;
      continue;
    }
    const wanted = (STATUS_CALL_FLAGS as Record<string, number | undefined>)[arg];
    if (wanted === undefined) return usageErrorResult(`unknown argument: ${arg}`);
    // every value of a flag the call knows is acceptable; the COUNT is not
    const next = args[i + 1];
    if (wanted === 1 && (next === undefined || next.startsWith("--"))) {
      return usageErrorResult(`${arg} needs a value`);
    }
    if (wanted === 1) i += 1;
  }
  // the sink label is required: a call without one cannot name a state line
  const hasSink = args.some((arg, index) => arg === "--sink" && args[index + 1] !== undefined);
  if (!hasSink) return usageErrorResult("the call needs --sink");
  return okResult();
}

/**
 * One status call: the probe (unless `--no-probe`), the records (when
 * `--events` names a file), the highest state that is proved, and the result
 * record with its `exit_code`. The call never throws.
 */
export async function statusCall(args: readonly string[]): Promise<{
  readonly result: ResultRecord;
  readonly state: ReceiverState | undefined;
  readonly line: string | undefined;
}> {
  const result = exitCodeForStatusCall(args);
  if (!result.ok) return { result, state: undefined, line: undefined };
  const sink = args[args.indexOf("--sink") + 1] as string;
  const noProbe = args.includes("--no-probe");
  const urlIndex = args.indexOf("--url");
  const url = urlIndex >= 0 ? (args[urlIndex + 1] as string) : undefined;
  const eventsIndex = args.indexOf("--events");
  const eventsFile = eventsIndex >= 0 ? (args[eventsIndex + 1] as string) : undefined;

  const records = eventsFile === undefined ? [] : readDeliveryRecords(eventsFile).records;
  const reachable = noProbe || url === undefined ? undefined : await probeEndpoint(url);
  const state = receiverStateOf({ enabled: true, sink, reachable, records });
  return {
    result: okResult(),
    state,
    line: url === undefined || noProbe ? stateLine(sink, state) : probeLine(sink, state, url),
  };
}
