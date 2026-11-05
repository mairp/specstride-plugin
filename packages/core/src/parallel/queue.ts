/**
 * T064 — ONE QUEUE FOR THE RECORDS OF N STREAM READERS (F143-FR-024; R29
 * PU-57, PU-59; R29v PU-98).
 *
 * WHAT THE REQUIREMENT ASKS, clause by clause, and where each is kept here:
 *
 *  1 "The records of N stream readers MUST pass one queue inside the engine."
 *    `oneQueue()` below is that queue. A stream reader does not write: it
 *    `offer`s a record and gets a promise that settles when the record is on
 *    disk. There is exactly ONE drain loop, so there is exactly one writer
 *    (F143-FR-023, R29 PU-56) however many readers there are.
 *
 *  2 "`seq` MUST be assigned at the append, rising and without gaps." The
 *    counter is read and raised INSIDE the drain, in the line that builds the
 *    bytes — never at `offer`. That is the whole difference between a `seq`
 *    that survives a crash and one that does not: a record that was offered
 *    and never appended consumes no number, so the file a reader finds after a
 *    SIGKILL still runs 1, 2, 3, … to its last whole line.
 *
 *  3 "Within one worker, records MUST keep the order of its stream, with
 *    `wseq` rising." The queue is first-in first-out and a reader offers in
 *    the order of its stream, so the order is kept by construction; `wseq` is
 *    a second counter, PER `workerId`, raised beside `seq`.
 *
 *  4 "The ordinal of a worker pass MUST be the triple of group ordinal,
 *    position of the task and restart index, so that it does not depend on
 *    timing" (R29v PU-98). That triple is `passOrdinalOf` of the group
 *    executor; it is re-exported here as `ordinalOfAWorkerPass` so that the
 *    whole of F143-FR-024 can be read in one file without a second definition
 *    of it existing anywhere.
 *
 * THE TWO OPTIONAL FIELDS OF THE ENVELOPE. `workerId` and `wseq` are present
 * on a worker's record and ABSENT ON THE MAIN LINE (R29 PU-57). A record
 * offered without a `workerId` therefore gets no `wseq` at all, and not a
 * `wseq` of zero.
 *
 * NO TORN LINE. The queue hands the port ONE WHOLE LINE, newline included, and
 * the port's contract is that it writes it in ONE call. A single writer that
 * never splits a line cannot tear one; a crash can lose a line's tail, which
 * is why `readAppendedRecords` below reports the torn last line as torn rather
 * than hiding it or throwing.
 *
 * THIS FILE WRITES NOTHING ITSELF. It is a module of the core: the append is a
 * PORT (`QueuePorts.appendLine`), as is the clock (annex A, §A.3).
 */
import { passOrdinalOf } from "./group-executor.ts";

/* ------------------------------------------------------------------ *
 * What the requirement fixes, as values.
 * ------------------------------------------------------------------ */

/** F143-FR-024 — `seq` starts at one and rises by one. */
export const SEQ_STARTS_AT = 1 as const;

/** F143-FR-024 — `wseq` starts at one and rises by one, per worker. */
export const WSEQ_STARTS_AT = 1 as const;

/** R29 PU-57 — the two optional fields the envelope gains. */
export const OPTIONAL_ENVELOPE_FIELDS = ["workerId", "wseq"] as const;

/** R29 PU-57 — both are ABSENT on the main line. */
export const FIELDS_ABSENT_ON_THE_MAIN_LINE = OPTIONAL_ENVELOPE_FIELDS;

/** F143-FR-023, R29 PU-56 — one queue means one writer, readers notwithstanding. */
export const WRITERS = 1 as const;

/** The queue is first-in first-out: that is what keeps a stream's order. */
export const ORDER = "first-in first-out" as const;

/** `seq` is assigned AT THE APPEND and never when a record is offered. */
export const SEQ_IS_ASSIGNED_AT = "the append" as const;
export const SEQ_IS_ASSIGNED_AT_THE_OFFER = false as const;

/**
 * R29v PU-98 — the ordinal of a worker pass is the triple of group ordinal,
 * task position and restart index. One definition, in the group executor;
 * this name is the same function, so that F143-FR-024 reads whole.
 */
export const ordinalOfAWorkerPass = passOrdinalOf;

/** R29 PU-59 — the ordinal does not depend on timing. */
export const THE_ORDINAL_DEPENDS_ON_TIMING = false as const;

/* ------------------------------------------------------------------ *
 * The records.
 * ------------------------------------------------------------------ */

/** What a stream reader offers: everything but the numbers the queue assigns. */
export type OfferedRecord = {
  /** The worker whose stream carried it; absent on the main line. */
  readonly workerId?: string;
  /** Everything else of the record, as the reader read it. */
  readonly [field: string]: unknown;
};

/** What the queue appended: the offered record with `seq` and, per worker, `wseq`. */
export type AppendedRecord = OfferedRecord & {
  /** Assigned at the append: rising, without gaps, from one. */
  readonly seq: number;
  /** Rising within one `workerId`; absent where `workerId` is absent. */
  readonly wseq?: number;
};

/** What the queue is handed. Each member is something the core may not do. */
export type QueuePorts = {
  /**
   * Append ONE WHOLE LINE, newline included, in ONE call. The contract of the
   * single call is what makes "no torn line" a property of the queue and not
   * a hope: a port that split the line could tear one and the queue could not
   * tell.
   */
  appendLine(line: string): void;
  /**
   * The hash of one appended line, for the field `prev` of the record after
   * it (annex B, §B.13; F100-FR-068). The core does not hash, so this is a
   * port; where it is absent no `prev` is written and the chain is simply not
   * claimed.
   */
  hashOf?(line: string): string;
};

/**
 * Where a queue of a RELAUNCHED engine carries on from. F143-FR-024 says
 * `seq` is "rising and without gaps" over THE LEDGER OF THE RUN, not over one
 * engine start, so a queue opened over a file that already holds records must
 * be told where the file left off. `continuationOf` below reads it from the
 * records themselves, so no caller has to count.
 */
export type QueueContinuation = {
  /** The last `seq` the file holds. */
  readonly seq: number;
  /** The hash of its last whole line, for the `prev` of the next record. */
  readonly prev?: string;
  /** The last `wseq` of each worker the file holds. */
  readonly wseq?: Readonly<Record<string, number>>;
};

/** The queue itself. */
export type OneQueue = {
  /**
   * Offer one record from a stream reader. The promise settles when the
   * record is on disk, with the record as it was appended.
   */
  offer(record: OfferedRecord): Promise<AppendedRecord>;
  /** A reader bound to one worker, so `workerId` cannot be forgotten. */
  readerFor(workerId: string): { offer(record: OfferedRecord): Promise<AppendedRecord> };
  /** Settle when everything offered so far is on disk. */
  drained(): Promise<void>;
  /** The last `seq` the queue assigned; `0` before the first append. */
  lastSeq(): number;
  /** The last `wseq` the queue assigned to a worker; `0` before its first. */
  lastWseq(workerId: string): number;
  /** How many records are waiting to be appended. */
  waiting(): number;
  /**
   * APPEND ONE RECORD NOW, synchronously, and give it back. Everything already
   * offered is appended first, so the order of the file is still the order of
   * the queue and there is still ONE writer.
   *
   * This is the form a WRITE-AHEAD record needs (F143-FR-023): a record that
   * must be on disk before an irreversible effect cannot be left to a
   * microtask, because the effect would be scheduled first.
   */
  appendNow(record: OfferedRecord): AppendedRecord;
  /** Append everything offered so far, synchronously. */
  drainNow(): void;
};

/**
 * F143-FR-024 — THE ONE QUEUE. Every reader offers into it; one drain loop
 * assigns `seq` and `wseq` and calls the port once per record.
 *
 * WHY THE DRAIN IS A LOOP AND NOT A `Promise.all`. The numbers must be
 * assigned in the order the records leave the queue, and the port must be
 * called once at a time: two appends in flight at once are two writers, which
 * is the thing R29 PU-56 forbids. `draining` is the flag that keeps exactly
 * one loop alive; a reader that offers while it runs joins the same loop.
 */
export function oneQueue(ports: QueuePorts, continuation?: QueueContinuation): OneQueue {
  type Waiting = {
    readonly record: OfferedRecord;
    readonly settle: (appended: AppendedRecord) => void;
    readonly fail: (reason: unknown) => void;
  };
  const queue: Waiting[] = [];
  const wseqOf = new Map<string, number>(Object.entries(continuation?.wseq ?? {}));
  let seq = continuation?.seq ?? SEQ_STARTS_AT - 1;
  let previous = continuation?.prev;
  let draining = false;
  let drainedWaiters: (() => void)[] = [];

  /**
   * Build the bytes of one record and append them. THE NUMBERS ARE ASSIGNED
   * HERE AND COMMITTED ONLY WHEN THE APPEND HAS RETURNED.
   *
   * The order of the three lines at the end is the requirement: the candidate
   * numbers are computed, `appendLine` is called, and ONLY THEN are the
   * counters moved. So a record whose append THREW consumes no number at all
   * and the next record takes the one it did not get — which is what "`seq`
   * assigned at the append, rising and WITHOUT GAPS" means when a write can
   * fail. Assigning first and appending after would leave a hole in the file
   * for every failed write.
   */
  const append = (record: OfferedRecord): AppendedRecord => {
    const nextSeq = seq + 1;
    const workerId =
      typeof record["workerId"] === "string" ? (record["workerId"] as string) : undefined;
    // `wseq` only where there is a worker: both fields are absent on the
    // main line (R29 PU-57), and an absent field is not a zero.
    const nextWseq =
      workerId === undefined ? undefined : (wseqOf.get(workerId) ?? WSEQ_STARTS_AT - 1) + 1;
    const appended = Object.freeze({
      ...record,
      seq: nextSeq,
      ...(previous === undefined ? {} : { prev: previous }),
      ...(nextWseq === undefined ? {} : { wseq: nextWseq }),
    }) as AppendedRecord;
    const line = JSON.stringify(appended) + "\n";
    // ONE CALL, ONE WHOLE LINE. A throw here commits nothing below it.
    ports.appendLine(line);
    seq = nextSeq;
    if (workerId !== undefined && nextWseq !== undefined) wseqOf.set(workerId, nextWseq);
    previous = ports.hashOf?.(line);
    return appended;
  };

  /** Append everything waiting, in order. Synchronous: `append` is. */
  const drainNow = (): void => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) break;
      try {
        next.settle(append(next.record));
      } catch (reason) {
        next.fail(reason);
      }
    }
  };

  const drain = (): void => {
    if (draining) return;
    draining = true;
    // A microtask, so that readers that offer in the same turn queue up
    // behind one another instead of each starting a loop of its own.
    void Promise.resolve().then(() => {
      try {
        drainNow();
      } finally {
        draining = false;
        const waiters = drainedWaiters;
        drainedWaiters = [];
        for (const waiter of waiters) waiter();
      }
    });
  };

  const offer = (record: OfferedRecord): Promise<AppendedRecord> =>
    new Promise<AppendedRecord>((settle, fail) => {
      queue.push({ record, settle, fail });
      drain();
    });

  return Object.freeze({
    offer,
    readerFor(workerId: string) {
      return Object.freeze({
        offer: (record: OfferedRecord) => offer({ ...record, workerId }),
      });
    },
    drained(): Promise<void> {
      if (!draining && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        drainedWaiters.push(resolve);
      });
    },
    lastSeq: () => seq,
    lastWseq: (workerId: string) => wseqOf.get(workerId) ?? WSEQ_STARTS_AT - 1,
    waiting: () => queue.length,
    appendNow(record: OfferedRecord): AppendedRecord {
      drainNow();
      return append(record);
    },
    drainNow,
  });
}

/* ------------------------------------------------------------------ *
 * Reading the file back, torn last line and all.
 * ------------------------------------------------------------------ */

/** What a reader found in the file the queue wrote. */
export type QueueFileReading = {
  /** Every whole line, parsed, in the order the file holds them. */
  readonly records: readonly AppendedRecord[];
  /** The bytes of the last line where it has no newline: the torn tail. */
  readonly tornLastLine?: string;
  /** The lines that were whole but did not parse. There must be none. */
  readonly unparsable: readonly string[];
};

/**
 * R29 PU-57 — read the file a crash may have cut. A reader TOLERATES THE TORN
 * LAST LINE AND NOTHING ELSE: a line without its newline is reported as torn,
 * and a whole line that does not parse is reported as unparsable, which is a
 * failure of the queue and not of the crash.
 */
export function readAppendedRecords(text: string): QueueFileReading {
  const records: AppendedRecord[] = [];
  const unparsable: string[] = [];
  let tornLastLine: string | undefined;
  const lines = text.split("\n");
  // `split` leaves "" after a final newline; anything else is a torn tail.
  const tail = lines.pop();
  if (tail !== undefined && tail !== "") tornLastLine = tail;
  for (const line of lines) {
    if (line === "") continue;
    try {
      records.push(JSON.parse(line) as AppendedRecord);
    } catch {
      unparsable.push(line);
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    ...(tornLastLine === undefined ? {} : { tornLastLine }),
    unparsable: Object.freeze(unparsable),
  });
}

/**
 * F143-FR-024 — WHERE A RELAUNCHED QUEUE CARRIES ON FROM, read from the
 * records a file already holds. `prev` needs the BYTES of the last whole
 * line, which `readAppendedRecords` does not keep, so the hash is taken by
 * the caller's port over the line it reconstructs; where no hash is given,
 * none is claimed.
 */
export function continuationOf(
  reading: QueueFileReading,
  hashOf?: (line: string) => string,
): QueueContinuation {
  const records = reading.records;
  const last = records[records.length - 1];
  const wseq: Record<string, number> = {};
  for (const record of records) {
    if (record.workerId === undefined || record.wseq === undefined) continue;
    wseq[record.workerId] = record.wseq;
  }
  return Object.freeze({
    seq: last?.seq ?? SEQ_STARTS_AT - 1,
    ...(last === undefined || hashOf === undefined
      ? {}
      : { prev: hashOf(JSON.stringify(last) + "\n") }),
    wseq: Object.freeze(wseq),
  });
}

/** What `seq` looked like over a reading. */
export type SeqReport = {
  /** True where `seq` is `1, 2, … n` with no gap and no repeat. */
  readonly risingWithoutGaps: boolean;
  readonly first?: number;
  readonly last?: number;
  readonly count: number;
  /** The `seq` values that broke the run, named for a failure message. */
  readonly gaps: readonly number[];
};

/** F143-FR-024 — is `seq` rising and without gaps over these records? */
export function seqReportOf(records: readonly AppendedRecord[]): SeqReport {
  const gaps: number[] = [];
  for (const [index, record] of records.entries()) {
    if (record.seq !== SEQ_STARTS_AT + index) gaps.push(record.seq);
  }
  return Object.freeze({
    risingWithoutGaps: gaps.length === 0,
    ...(records.length === 0
      ? {}
      : {
          first: (records[0] as AppendedRecord).seq,
          last: (records[records.length - 1] as AppendedRecord).seq,
        }),
    count: records.length,
    gaps: Object.freeze(gaps),
  });
}

/**
 * F143-FR-024 — does every worker's `wseq` rise, in the order of the file?
 * Returns the workers whose records are out of order; an empty list is the
 * requirement kept.
 */
export function workersWhoseWseqDoesNotRise(records: readonly AppendedRecord[]): readonly string[] {
  const last = new Map<string, number>();
  const broken = new Set<string>();
  for (const record of records) {
    const workerId = record.workerId;
    if (workerId === undefined) {
      // R29 PU-57 — absent on the main line, and a `wseq` without a worker
      // would be a field the envelope does not have.
      if (record.wseq !== undefined) broken.add("<the main line>");
      continue;
    }
    const wseq = record.wseq;
    if (wseq === undefined || wseq !== (last.get(workerId) ?? WSEQ_STARTS_AT - 1) + 1) {
      broken.add(workerId);
    }
    last.set(workerId, wseq ?? last.get(workerId) ?? 0);
  }
  return Object.freeze([...broken].sort());
}
