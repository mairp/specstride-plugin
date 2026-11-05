/**
 * T040 — the lease probe through EP-13, and the handshake limit
 * (`packages/cli/src/status/probes.ts`; F129-FR-001, F129-FR-012, F129-FR-024).
 *
 * C-2 of `specs/129-run-view-and-status/contracts/observations.md`: the lease
 * probe is a RESULT, not a reading of the lease file. The shipped provider of
 * feature 122 answers with one of the six rows of its decision table
 * (`free`, `unknown`, `held-foreign`, `held-live`, `owner-dead-group-alive`,
 * `stale-owner-dead`); the caller of `status` hands that result in. Where no
 * provider is handed in, this module answers nothing — the read model reads a
 * lease it cannot see as `unknown`, which counts as held (F129-FR-012) — and
 * never guesses liveness from the age of a file (F122-FR-014).
 *
 * The handshake limit is ordinary configuration, `runtime.handshake.timeoutSec`
 * (observation 5; default 30 seconds, CQ-138 of feature 122).
 */

/** The result of a probe through the lock provider (EP-13), with its lease. */
export type LockProbeResult = {
  /** One row of the decision table of feature 122 (`contracts/observations.md`, C-2). */
  readonly result: string;
  /** The lease's own fields (`specstride.lease/1`), or `null`. */
  readonly lease: Readonly<Record<string, unknown>> | null;
};

/** The EP-13 port `status` uses: a probe of the lease of one run. */
export type LockProbePort = {
  /** Probe the lease of the run; `null` where the provider has no answer. */
  readonly probe: (runId: string) => LockProbeResult | null;
};

/**
 * The observation of the lease in the form `project` takes. The record is
 * declared here and not imported from `@specstride/view`: the import-boundary
 * check of feature 100 refuses an import between two packages of layer L6
 * that the `mayImport` of the graph does not name explicitly, and the entry
 * of `@specstride/cli` carries the prose "every package above"
 * (`packages/contracts/data/package-graph.json`). The request to feature 100
 * is open (R-129-04 of `specs/129-run-view-and-status/contracts/README.md`);
 * the record is structurally the same, so the caller's value is the view's
 * input without a conversion.
 */
export type LeaseObservation = {
  readonly probe: string;
  readonly lease: Readonly<Record<string, unknown>> | null;
};

/** A probe that answers nothing: the read model reads no lease as `unknown`. */
export const noProbe: LockProbePort | undefined = undefined;

/** The probe results the read model knows (the rows of the decision table). */
export const KNOWN_PROBE_RESULTS: readonly string[] = Object.freeze([
  "free",
  "unknown",
  "held-foreign",
  "held-live",
  "owner-dead-group-alive",
  "stale-owner-dead",
]);

/**
 * Probe the lease of one run through EP-13 and give the observation the shape
 * `project` takes. A row the read model does not know is read as `unknown`
 * (F129-FR-012); an absent answer is no observation at all.
 */
export function leaseObservationOf(
  lock: LockProbePort | undefined,
  runId: string,
): LeaseObservation | null {
  if (lock === undefined || runId === "") return null;
  const answer = lock.probe(runId);
  if (answer === null) return null;
  const result = KNOWN_PROBE_RESULTS.includes(answer.result) ? answer.result : "unknown";
  return { probe: result, lease: answer.lease };
}

/** The default of `runtime.handshake.timeoutSec` (CQ-138 of feature 122). */
export const DEFAULT_HANDSHAKE_LIMIT_SEC = 30 as const;

/**
 * The handshake limit in the form task T004 confirms: ordinary configuration,
 * the key `runtime.handshake.timeoutSec`, whole seconds, read from the
 * environment a fixture may set (`SPECSTRIDE_HANDSHAKE_LIMIT_SEC`), 30 where
 * nothing states one.
 */
export function handshakeLimitSecOf(
  config: Readonly<Record<string, unknown>> = {},
  environment: Readonly<Record<string, string | undefined>> = {},
): number {
  const fromConfig = config["runtime.handshake.timeoutSec"];
  if (typeof fromConfig === "number" && Number.isFinite(fromConfig) && fromConfig >= 0) {
    return Math.floor(fromConfig);
  }
  const fromEnvironment = environment["SPECSTRIDE_HANDSHAKE_LIMIT_SEC"];
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    const parsed = Number(fromEnvironment);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return DEFAULT_HANDSHAKE_LIMIT_SEC;
}

/* ---- T056 — the search of the process table for the run token (F129-FR-021) ---- */

/**
 * The registry of the run token: the logical name the process search of
 * observation 4 matches against (`run:<runId>:procs`, `specstride.procs/1`,
 * annex B §B.10). The registry is a pure mapping from the run id to the token
 * a holder of the run carries on its command line; it names no operating
 * system interface of its own.
 */
export function runTokenOf(runId: string): string {
  return `run:${runId}:procs`;
}

/** One row of the operating system's process table, as the caller reads it. */
export type ProcessRow = {
  readonly pid: number | null;
  /** The command line of the process, where the table gives one. */
  readonly command: string | null;
  /** The kind the row declares (`engine`, `worker`, ...), if any. */
  readonly kind: string | null;
  /** The class the row declares (`owned`, `adoptable`), if any. */
  readonly class: string | null;
};

/** The port of the process table: the caller reads it, the view never does. */
export type ProcessTablePort = {
  /** The rows of the table, as read at the moment of the call. */
  readonly list: () => readonly ProcessRow[];
};

/**
 * The observation of one holder of the run token, in the shape
 * `project` takes for `observations.processTableSearch`. `endCause` is always
 * `null`: the search is REPORT ONLY (F129-FR-021) — it never ends a process.
 */
export type ProcessHolderObservation = {
  readonly pid: number | null;
  readonly kind: string | null;
  readonly class: string;
  readonly endCause: null;
};

/** True when a command line carries the run token of the run. */
export function matchesRunToken(command: string | null, runId: string): boolean {
  if (command === null || runId === "") return false;
  return command.includes(runTokenOf(runId));
}

/**
 * Search the process table for the holders of the run token of one run, and
 * give the observation the shape `project` takes. The class of a holder is the
 * class its row declares; a row that declares none but carries the token is
 * `owned`. The search REPORTS ONLY: no signal is sent, no process is ended,
 * and `endCause` stays `null` on every holder.
 */
export function searchProcessTable(
  table: ProcessTablePort | undefined,
  runId: string,
): readonly ProcessHolderObservation[] {
  if (table === undefined || runId === "") return Object.freeze([]);
  const holders: ProcessHolderObservation[] = [];
  for (const row of table.list()) {
    if (!matchesRunToken(row.command, runId)) continue;
    holders.push(
      Object.freeze({
        pid: row.pid,
        kind: row.kind,
        class: row.class !== null && row.class !== "" ? row.class : "owned",
        endCause: null,
      }),
    );
  }
  return Object.freeze(holders);
}
