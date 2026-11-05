/**
 * T007 — the writers of the invocation artifacts, atomic and exclusive
 * (F126-FR-032).
 *
 * The result record is written once: a temporary file in the same directory,
 * sorted keys, 2-space indent, a final line end, then a rename; an existing
 * file makes the write fail. The other artifacts (invocation record,
 * producer status, provider terminal) are written atomically through the
 * kernel write.
 */
import {
  closeSync,
  existsSync,
  linkSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { atomicWriteJson } from "@specstride/kernel/atomic-write";
import { identityFields, type InvocationIdentity } from "./identity.ts";
import { sourceOfResult } from "../stream/closed-sets.ts";

/** The schema ids of the four artifacts (contracts/README.md of feature 126). */
export const SCHEMA_IDS = {
  invocation: "specstride.invocation/1",
  producerStatus: "specstride.producer-status/1",
  providerTerminal: "specstride.provider-terminal/1",
  result: "specstride.invocation-result/1",
} as const;

/** The as-is contract strings of the compatibility projection. */
export const AS_IS_CONTRACTS = {
  invocation: "specstride-invocation/v1",
  producerStatus: "specstride-producer-status/v1",
  providerTerminal: "specstride-provider-terminal/v1",
  result: "specstride-invocation-result/v1",
} as const;

/** A write that would overwrite an existing artifact. */
export class AlreadyFinalizedError extends Error {
  constructor(path: string) {
    super(`the artifact ${path} exists and is never overwritten (F126-FR-032)`);
    this.name = "AlreadyFinalizedError";
  }
}

/** JSON with the keys of every object sorted, recursively. */
export function sortedJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** Sort the keys of an object, recursively; arrays keep their order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Write once, atomically and without overwriting (F126-FR-032): the bytes go
 * to a temporary name in the same directory, then the artifact is linked
 * into place, which fails where the target exists, and the temporary name is
 * removed. The rename of a link is atomic; the link is the exclusivity.
 */
export function writeJsonOnce(path: string, record: unknown): void {
  if (existsSync(path)) throw new AlreadyFinalizedError(path);
  const bytes = sortedJsonStringify(record);
  const temporary = join(dirname(path), `.${basename(path)}.once-${process.pid}-${counter++}`);
  const {
    writeFileSync: write,
    closeSync: close,
    openSync: open,
  } = {
    writeFileSync,
    closeSync,
    openSync,
  };
  let fd: number | undefined;
  try {
    fd = open(temporary, "wx", 0o600);
    write(fd, bytes);
    close(fd);
    fd = undefined;
    linkSync(temporary, path);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* the write already failed */
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      /* the link moved it, or it was never created */
    }
  }
}

let counter = 0;

/** The invocation record, written atomically (data-model; annex B §B.20). */
export function writeInvocationRecord(
  path: string,
  identity: InvocationIdentity,
  fields: {
    readonly observabilityMode: string;
    readonly providerFormat: string | null;
    readonly expectedEvidence: string;
    readonly createdAt: string;
  },
): void {
  atomicWriteJson(path, {
    schema: SCHEMA_IDS.invocation,
    ...identityFields(identity),
    observabilityMode: fields.observabilityMode,
    providerFormat: fields.providerFormat,
    expectedEvidence: fields.expectedEvidence,
    createdAt: fields.createdAt,
  });
}

/** The producer status, written atomically. */
export function writeProducerStatus(
  path: string,
  fields: {
    readonly producer_exit_code: number | null;
    readonly producer_signal: string | null;
    readonly parser_exit_code: number | null;
    readonly timed_out: boolean;
    readonly launch_failed: boolean;
    readonly duration_ms: number;
  },
): void {
  atomicWriteJson(path, { schema: SCHEMA_IDS.producerStatus, ...fields });
}

/** The provider terminal, written atomically; unknown is null. */
export function writeProviderTerminal(
  path: string,
  provider_terminal: Record<string, unknown> | null,
  malformed_stream: boolean,
): void {
  atomicWriteJson(path, {
    schema: SCHEMA_IDS.providerTerminal,
    provider_terminal,
    malformed_stream,
  });
}

/** The keys of the result that are never copied from the provider terminal.
 * The outcome keys are never copied (B-2197); the producer fields come only
 * from the producer status (B-2164). */
const NEVER_COPIED = new Set([
  "status",
  "reason",
  "reason_code",
  "stop_reason",
  "is_error",
  "source",
  "producer_exit_code",
  "producer_signal",
  "parser_exit_code",
  "timed_out",
  "launch_failed",
  "duration_ms",
  "finalized_at",
  "schema",
]);

/** The producer fields of the result, whole and at least 0 (F126-FR-032). */
export type ProducerFields = {
  readonly producer_exit_code: number | null;
  readonly producer_signal: string | null;
  readonly parser_exit_code: number | null;
  readonly timed_out: boolean;
  readonly launch_failed: boolean;
  readonly duration_ms: number;
};

/** The input of a result record, as finalization reconciles it. */
export type ResultInput = {
  readonly identity: InvocationIdentity;
  readonly status: string;
  readonly reason_code: string;
  readonly reason: string;
  readonly provider_status: number | string | null;
  readonly provider_stop_reason: string | null;
  readonly producer: ProducerFields;
  readonly finalized_at?: string | undefined;
  /** The provider terminal record, whose non-null keys are copied. */
  readonly providerTerminal?: Record<string, unknown> | null | undefined;
  /** Extra metrics (`model`, `cost_usd`, `input_tokens`, ...). */
  readonly extraMetrics?: Record<string, unknown> | undefined;
};

/** The instant the process took its first clock reading, in microseconds. */
const CLOCK_ORIGIN = { micros: BigInt(Date.now()) * 1000n, hr: process.hrtime.bigint() };

/** The current wall time in microseconds, via the monotonic anchor. */
export function currentMicros(): bigint {
  const elapsed = Number((process.hrtime.bigint() - CLOCK_ORIGIN.hr) / 1000n);
  return CLOCK_ORIGIN.micros + BigInt(elapsed);
}

/** `finalized_at`: UTC, with microseconds (F126-FR-032). */
export function finalizedAtNow(totalMicros: bigint = currentMicros()): string {
  const millis = totalMicros / 1000n;
  const fraction = Number(totalMicros % 1000n);
  return `${new Date(Number(millis)).toISOString().slice(0, 23)}${String(fraction).padStart(3, "0")}Z`;
}

/** The result record, with every field F126-FR-032 names. */
export function buildResultRecord(input: ResultInput): Record<string, unknown> {
  const duration = Math.max(0, Math.trunc(input.producer.duration_ms));
  const producer: ProducerFields = { ...input.producer, duration_ms: duration };
  const record: Record<string, unknown> = {
    schema: SCHEMA_IDS.result,
    ...identityFields(input.identity),
    status: input.status,
    is_error: input.status !== "success",
    reason_code: input.reason_code,
    reason: input.reason,
    source: sourceOfResult(input.reason_code),
    provider_status: input.provider_status,
    provider_stop_reason: input.provider_stop_reason,
    ...producer,
    finalized_at: input.finalized_at ?? finalizedAtNow(),
  };
  const terminal = input.providerTerminal ?? {};
  for (const [key, value] of Object.entries(terminal)) {
    if (value === null || value === undefined) continue;
    if (NEVER_COPIED.has(key)) continue;
    record[key] = value;
  }
  for (const [key, value] of Object.entries(input.extraMetrics ?? {})) {
    if (value === null || value === undefined) continue;
    if (NEVER_COPIED.has(key)) continue;
    record[key] = value;
  }
  return record;
}

/**
 * Finalize: write the result record once (F126-FR-032). A second call with
 * the same path fails with `AlreadyFinalizedError` and changes nothing.
 */
export function writeResultRecord(path: string, input: ResultInput): void {
  writeJsonOnce(path, buildResultRecord(input));
}

/** The byte size of a written artifact, for the retention decisions. */
export function artifactBytes(path: string): number {
  return statSync(path).size;
}

/** The rename is kept atomic: it stays inside one directory. */
export function sameDirectoryGuard(path: string, temporary: string): boolean {
  return dirname(path) === dirname(temporary);
}
