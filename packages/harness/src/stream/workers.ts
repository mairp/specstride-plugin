/**
 * T023 — several streams read at once inside the engine process
 * (F126-FR-025).
 *
 * With parallel units on, every stream of a worker is read by its own reader
 * with its own state; every record the worker produces carries `workerId` and
 * `wseq`, absent on the main line. The order of records between workers is
 * set by the parallel layer; the fields ride the event schema.
 */
import type { StreamReader } from "./claude-reader.ts";
import type { NormalizedRecord } from "./records.ts";

/** A record of a worker stream, tagged for the event envelope. */
export type WorkerTaggedRecord = NormalizedRecord & {
  readonly workerId: string;
  /** The sequence of the record inside its own worker stream, from 1. */
  readonly wseq: number;
};

/** True where the record belongs to a worker, not to the main line. */
export function isWorkerRecord(record: NormalizedRecord): record is WorkerTaggedRecord {
  return "workerId" in record && typeof record.workerId === "string";
}

/**
 * The reader of one worker stream: its own inner reader (its own state) and
 * its own sequence counter (F126-FR-025).
 */
export class WorkerStreamReader implements StreamReader {
  private wseq = 0;
  private readonly inner: StreamReader;
  private readonly workerId: string;

  constructor(inner: StreamReader, workerId: string) {
    this.inner = inner;
    this.workerId = workerId;
  }

  /** The worker this stream belongs to. */
  get id(): string {
    return this.workerId;
  }

  push(line: string): readonly WorkerTaggedRecord[] {
    return this.tag(this.inner.push(line));
  }

  finish(): readonly WorkerTaggedRecord[] {
    return this.tag(this.inner.finish());
  }

  private tag(records: readonly NormalizedRecord[]): readonly WorkerTaggedRecord[] {
    const out: WorkerTaggedRecord[] = [];
    for (const record of records) {
      this.wseq += 1;
      out.push({ ...record, workerId: this.workerId, wseq: this.wseq });
    }
    return out;
  }
}
