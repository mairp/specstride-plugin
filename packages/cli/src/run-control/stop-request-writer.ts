/**
 * T004 — the writer of the stop request (F102-FR-001;
 * contracts/stop-request.md).
 *
 * `stop` writes ONE stop request per workspace, into the inbox, under the
 * logical name `inbox:stop`, schema `specstride.inbox/1`, type `stop`. The
 * write goes through the atomic write of the kernel
 * (`@specstride/kernel/atomic-write`): a temporary name in the same
 * directory, fsync, rename — no reader ever sees a partial request
 * (F102-FR-001; F100-FR-036).
 *
 * The two forms the writer produces:
 *
 * - The FULL request: the fields `schema`, `type`, `at` (annex B §B.11),
 *   `now` and `jobs` (false unless asked), and `runTokenHash` when a run was
 *   active. Every full request is validated with the schema-validated reader
 *   of `records.ts` (`readStopRequest`) BEFORE it is written, so the runtime
 *   never writes a request it would itself refuse.
 * - The EMPTY request: a zero-byte file. It carries no field at all,
 *   `schema` included (F100-FR-065). Together with a request that cannot be
 *   read it means a CLEAN stop with every default, and it never carries
 *   `now` or `jobs` (F102-FR-001; contracts/stop-request.md) — the reader of
 *   `records.ts` reports it as `clean`.
 *
 * Nothing outside the runtime tree is touched: the writer writes the one
 * file the caller names and nothing else.
 */
import {
  atomicWrite,
  atomicWriteJson,
  isTemporaryName,
  temporaryNameFor,
} from "@specstride/kernel";
import { STOP_REQUEST_TYPE, readStopRequest, type RecordRead } from "./records.ts";
import type { InboxRequest } from "@specstride/contracts/records/inbox-request";

/** The section of annex B that owns the field list of the request. */
export const ANNEX_SECTION = "annex B, §B.11" as const;

/** The requirement this module carries out. */
export const REQUIREMENT = "F102-FR-001" as const;

/** The write is atomic: temporary name in the same directory, fsync, rename. */
export const WRITE_IS_ATOMIC = true as const;

/** The engine removes the request when it honours it; the CLI never does. */
export const THE_CLI_REMOVES_THE_REQUEST = false as const;

/** What the caller of `writeStopRequest` may ask for. */
export type StopRequestInput = {
  /** End owned processes at once (`stop --now`). Default false. */
  readonly now?: boolean | undefined;
  /** Also end adoptable jobs (`--jobs`). Default false. */
  readonly jobs?: boolean | undefined;
  /** Hash of the run token, when a run was active. Absent otherwise. */
  readonly runTokenHash?: string | undefined;
  /** Time of the request, ISO 8601 UTC. The caller's clock; never read here. */
  readonly at?: string | undefined;
};

/**
 * Build the full stop request from what the caller asked. `now` and `jobs`
 * are written as false unless asked (F102-FR-001); `runTokenHash` is present
 * only when the caller gives one.
 */
export function buildStopRequest(input: StopRequestInput = {}): InboxRequest {
  const request: Record<string, unknown> = {
    schema: "specstride.inbox/1",
    type: STOP_REQUEST_TYPE,
    at: input.at ?? new Date().toISOString(),
    now: input.now === true,
    jobs: input.jobs === true,
  };
  if (input.runTokenHash !== undefined) request.runTokenHash = input.runTokenHash;
  return request as unknown as InboxRequest;
}

/**
 * Validate a request with the schema-validated reader BEFORE it is written
 * (F102-FR-001: the runtime validates the request before it acts on it — the
 * writer applies the same gate to what it produces).
 */
export function validateStopRequest(value: unknown): RecordRead<InboxRequest> {
  return readStopRequest(value);
}

/** What `writeStopRequest` reports. */
export type StopRequestWrite = {
  /** The path the request was renamed into. */
  readonly path: string;
  /** The temporary name the bytes were written to first (F102-FR-001). */
  readonly temporaryPath: string;
  /** True for the empty request: a clean stop with every default. */
  readonly empty: boolean;
  /** The request written; `undefined` for the empty request. */
  readonly request: InboxRequest | undefined;
};

/**
 * Write the stop request atomically (F102-FR-001).
 *
 * Called with NO input (or with `empty: true`) it writes the EMPTY request —
 * a zero-byte file that carries no field and reads back as a clean stop with
 * the defaults. Called with an input it builds the full request, validates
 * it with `readStopRequest`, and refuses the write when the validation
 * refuses: nothing invalid ever reaches the inbox.
 *
 * The write itself is the kernel's: a temporary name in the same directory,
 * fsync, rename into place — a concurrent reader sees the old file or the
 * new one, never a partial request.
 */
export function writeStopRequest(
  path: string,
  input?: StopRequestInput,
  options: { readonly root?: string | undefined; readonly empty?: boolean | undefined } = {},
): StopRequestWrite {
  const temporaryPath = temporaryNameFor(path);
  if (input === undefined || options.empty === true) {
    atomicWrite(path, "", { root: options.root, createDirectory: true });
    return { path, temporaryPath, empty: true, request: undefined };
  }
  const request = buildStopRequest(input);
  const validated = validateStopRequest(request);
  if (!validated.ok) {
    throw validated.error;
  }
  atomicWriteJson(path, request, { root: options.root, createDirectory: true });
  return { path, temporaryPath, empty: false, request };
}

/** True for a name the kernel's atomic write produces as its temporary name. */
export function isAStopRequestTemporaryName(name: string): boolean {
  return isTemporaryName(name);
}
