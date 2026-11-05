/**
 * T053 of feature 118 — the failure ledger of the baseline (F118-FR-036,
 * F118-FR-037; PT-118-C-044 to C-049).
 *
 * An internal component that never breaks a resume prompt: any exception
 * prints nothing and the status stays 0. Parameters: log file, ledger file,
 * job key, `--max` (default 150) and `--pattern` (overridden by
 * `SPECSTRIDE_FAILURE_PATTERN`, key `loop.yield.failurePattern`, when the
 * parameter is absent; an empty value reads as unset). Its file holds one
 * line `{"kind":"job","job","ts","log","failures"}` per job and one line
 * `{"kind":"failure","job","sig"}` per distinct signature; a job already in
 * the ledger is not appended again. The job key is
 * `<run-id>:attempt<A>:yield<k>` and the section is produced only when the
 * job's log exists and the ledger setting is exactly `true`.
 *
 * Every text here — the example lines and the signatures — comes from the job
 * log, outside the runtime (F118-FR-044): when the ingress is handed in, this
 * module admits them itself, through `../ingress.ts`, before it writes them.
 */
import { FAILURE_PATTERN_DEFAULT } from "../yield/settings.ts";
import type { Ingress } from "../ports.ts";
import { admitForWrite, admissionRecord, type AdmissionOutcome } from "../ingress.ts";

/** One line of the ledger file (as-is JSON, F118-FR-036). */
export type FailureLedgerLine =
  | {
      readonly kind: "job";
      readonly job: string;
      readonly ts: string;
      readonly log: string;
      readonly failures: number;
    }
  | { readonly kind: "failure"; readonly job: string; readonly sig: string };

/** The default failure pattern of the baseline (F118-FR-037). */
export const DEFAULT_FAILURE_PATTERN = FAILURE_PATTERN_DEFAULT;

/**
 * Match one line of a log against the failure pattern: `FAIL`, `FAILED`,
 * `FAILURE` and `ERROR` as whole words, `Traceback (most recent`, `RC=<n>`
 * with a non-zero n and `exit [code] <n>` with a non-zero n.
 */
export function matchesFailurePattern(
  line: string,
  pattern: string = DEFAULT_FAILURE_PATTERN,
): boolean {
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return false;
  }
  return compiled.test(line);
}

/** Strip timestamps, hex identifiers of 12 or more characters, UUIDs and numbers. */
export function signatureOf(line: string): string {
  const sig = line
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "")
    .replace(/\b[0-9a-fA-F]{12,}\b/g, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sig.length > 300 ? sig.slice(0, 300) : sig;
}

/** Cut an example line to 240 characters (F118-FR-037). */
export function exampleOf(line: string): string {
  return line.length > 240 ? line.slice(0, 240) : line;
}

/** The job key of one yield job (F118-FR-036). */
export function jobKey(runId: string, attempt: number, yieldIndex: number): string {
  return `${runId}:attempt${attempt}:yield${yieldIndex}`;
}

/** One entry of a scan: the signature and its admitted example line. */
export interface LedgerFailure {
  readonly sig: string;
  /** The first example line seen for this signature (after the ingress). */
  readonly example: string;
  count: number;
}

/**
 * Scan the whole log (not only the slice) and deduplicate by signature. When
 * the ingress is handed in, every matching line — the log is outside the
 * runtime — is admitted before its signature and example are taken, class
 * `check-output` (T077, F118-FR-044). Whether any text was dropped is
 * reported by `scanLogAdmission`.
 */
export function scanLog(
  logText: string,
  pattern: string = DEFAULT_FAILURE_PATTERN,
  ingress?: Ingress | undefined,
): readonly LedgerFailure[] {
  return scanLogAdmission(logText, pattern, ingress).failures;
}

/** A scan together with its admission record (F100-FR-205: the record says so). */
export interface ScannedLog {
  readonly failures: readonly LedgerFailure[];
  /** True when the redactor could not run and at least one line was dropped. */
  readonly dropped: boolean;
  readonly outcome: AdmissionOutcome;
}

/** `scanLog` that also reports the admission outcome of the example lines. */
export function scanLogAdmission(
  logText: string,
  pattern: string = DEFAULT_FAILURE_PATTERN,
  ingress?: Ingress | undefined,
): ScannedLog {
  const bySig = new Map<string, LedgerFailure>();
  let dropped = false;
  for (const line of logText.split("\n")) {
    if (line === "") continue;
    if (!matchesFailurePattern(line, pattern)) continue;
    let taken = line;
    if (ingress !== undefined) {
      const one = admitForWrite(ingress, line, "check-output");
      if (one.held) dropped = true;
      taken = one.text;
    }
    const sig = signatureOf(taken);
    const seen = bySig.get(sig);
    if (seen === undefined) {
      bySig.set(sig, { sig, example: exampleOf(taken), count: 1 });
    } else {
      seen.count += 1;
    }
  }
  return { failures: [...bySig.values()], dropped, outcome: admissionRecord(dropped) };
}

/** The section of F118-FR-037, or the pieces the caller composes. */
export interface FailureSection {
  /** The heading, always `### Every failure the job reported (<n> distinct, <m> matching lines in the whole log)`. */
  readonly heading: string;
  /** The list, recurring failures first, at most `max` entries. */
  readonly items: readonly string[];
  /** The summary line for the failures past `max`, when there are any. */
  readonly more?: string | undefined;
  /** The no-failure text, when the log matched nothing. */
  readonly none?: string | undefined;
  /** The admission record of the example lines (`dropped` when the redactor could not run). */
  readonly admission?: AdmissionOutcome | undefined;
}

/**
 * Build the section from a scan of the whole log and the earlier jobs per
 * signature. When the ingress is handed in the example lines are admitted
 * inside this writer (T077, F118-FR-044) and the record says so.
 */
export function failureSection(input: {
  readonly logText: string;
  readonly pattern?: string | undefined;
  readonly max: number;
  /** Signatures already seen in earlier jobs of this feature, with their job counts. */
  readonly earlierSigJobs?: Readonly<Record<string, number>> | undefined;
  readonly totalJobs?: number | undefined;
  readonly ingress?: Ingress | undefined;
}): FailureSection {
  const scan = scanLogAdmission(
    input.logText,
    input.pattern ?? DEFAULT_FAILURE_PATTERN,
    input.ingress,
  );
  const failures = scan.failures;
  const matchingLines = input.logText
    .split("\n")
    .filter((line) => matchesFailurePattern(line, input.pattern ?? DEFAULT_FAILURE_PATTERN)).length;
  const heading = `### Every failure the job reported (${failures.length} distinct, ${matchingLines} matching lines in the whole log)`;
  if (failures.length === 0) {
    return {
      heading,
      items: [],
      none: "None: no line of the log matched the failure pattern.",
      ...(input.ingress !== undefined ? { admission: admissionRecord(scan.dropped) } : {}),
    };
  }
  const earlier = input.earlierSigJobs ?? {};
  const totalJobs = input.totalJobs ?? 0;
  const recurring = failures.filter((f) => (earlier[f.sig] ?? 0) > 0);
  const fresh = failures.filter((f) => (earlier[f.sig] ?? 0) === 0);
  const ordered = [...recurring, ...fresh];
  const items: string[] = [];
  for (const failure of ordered.slice(0, input.max)) {
    const earlierJobs = earlier[failure.sig] ?? 0;
    items.push(
      earlierJobs > 0
        ? `- [RECURRING ${earlierJobs}/${totalJobs} earlier jobs] (x${failure.count}) ${failure.example}`
        : `- [NEW] ${failure.example}`,
    );
  }
  const hidden = ordered.length - items.length;
  return {
    heading,
    items,
    ...(input.ingress !== undefined ? { admission: admissionRecord(scan.dropped) } : {}),
    ...(hidden > 0
      ? { more: `- ... ${hidden} more distinct failure(s) not shown; grep the log for the rest` }
      : {}),
  };
}

/**
 * Append the entries of one job to the ledger lines: the `job` line once, and
 * one `failure` line per distinct signature — unless the job is already in
 * the ledger (F118-FR-036).
 */
export function appendJobToLedger(input: {
  readonly existingJobs: readonly string[];
  readonly job: string;
  readonly ts: string;
  readonly log: string;
  readonly failures: readonly LedgerFailure[];
}): readonly FailureLedgerLine[] {
  if (input.existingJobs.includes(input.job)) return [];
  return [
    {
      kind: "job",
      job: input.job,
      ts: input.ts,
      log: input.log,
      failures: input.failures.length,
    },
    ...input.failures.map((failure) => ({
      kind: "failure" as const,
      job: input.job,
      sig: failure.sig,
    })),
  ];
}

/** The status the component always ends with (F118-FR-036): never breaks the prompt. */
export const FAILURE_LEDGER_STATUS = 0;

/** Render the ledger lines as the JSON lines of the file (as-is order of fields). */
export function renderLedgerLine(line: FailureLedgerLine): string {
  if (line.kind === "job") {
    return JSON.stringify({
      kind: "job",
      job: line.job,
      ts: line.ts,
      log: line.log,
      failures: line.failures,
    });
  }
  return JSON.stringify({ kind: "failure", job: line.job, sig: line.sig });
}
