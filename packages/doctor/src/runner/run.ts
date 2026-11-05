/**
 * T009 (feature 112) — the runner of the doctor (F112-FR-003, F112-FR-007,
 * F112-FR-008).
 *
 * One function that runs registered checks: selected checks are probed in
 * parallel, each inside its bounds (F112-FR-007, R16 F2):
 * - a probe time limit of 5 s (overridable through the bag, for tests);
 * - a subprocess whose stdin is closed, whose output is cut at 64 KiB and
 *   whose process group is ended at the limit;
 * - a probe that does not end in time gives a warning `probe timed out`;
 * - a probe that throws ends the run with exit 1 and touches no run
 *   (F112-FR-008): the runner writes nothing anywhere;
 * - a severity the doctor does not know is read as `warn` (F112-FR-008);
 * - `--quick` skips the checks that touch a subprocess or the network.
 *
 * The runner reads and never writes; it calls no model and reads no secret.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { signalGroup } from "@specstride/kernel";
import { SEVERITY_WHEN_UNKNOWN, type Severity } from "@specstride/contracts/ep/doctor";
import type {
  Check,
  Finding,
  ProbeBag,
  SubprocessResult,
  SubprocessRunner,
  NetworkReader,
} from "../registry/types.ts";

/** The probe time limit, in ms (R16 F2). */
export const PROBE_TIME_LIMIT_MS = 5_000 as const;
/** The model-list request time (R16 F4); also the network reader's limit. */
export const NETWORK_TIME_LIMIT_MS = 3_000 as const;
/** The subprocess output cap, in bytes (R16 F2). */
export const SUBPROCESS_OUTPUT_CAP_BYTES: number = 64 * 1024;

/** The rank of a severity in the output order: fail, warn, info, ok. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  fail: 0,
  warn: 1,
  info: 2,
  ok: 3,
});

/** The exit code of the runner when a probe throws (F112-FR-008). */
export const EXIT_INTERNAL_ERROR = 1 as const;

/** Sort findings into the output order: severity, then id (CT-112-102). */
export function orderFindings(findings: readonly Finding[]): readonly Finding[] {
  return Object.freeze(
    [...findings].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id),
    ),
  );
}

/** A severity the doctor does not know is read as `warn` (F112-FR-008). */
export function normalizeSeverity(severity: unknown): Severity {
  return (
    SEVERITY_WHEN_UNKNOWN === "warn" &&
    (severity === "ok" || severity === "info" || severity === "warn" || severity === "fail")
      ? severity
      : SEVERITY_WHEN_UNKNOWN
  ) as Severity;
}

/**
 * Fill the message template of a check with what the probe observed: every
 * `{key}` becomes `String(observed[key])`, and the message is cut at 200 bytes
 * (R16 F3). Evidence never enters the message unchanged.
 */
export function renderMessage(template: string, observed: unknown): string {
  const source = (observed ?? {}) as Record<string, unknown>;
  const message = template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_m, key: string) =>
    key in source ? String(source[key]) : `{${key}}`,
  );
  const bytes = Buffer.from(message, "utf8");
  if (bytes.byteLength <= 200) return message;
  // The cut keeps the message inside the 200-byte cap (R16 F3) including the
  // ellipsis marker, which is 3 bytes in UTF-8.
  let cut = 197;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1;
  return `${bytes.subarray(0, cut).toString("utf8")}…`;
}

/**
 * Redact the evidence of a probe before it reaches a finding: the fields that
 * hold raw output or a note are dropped, and every value is stringified, so no
 * secret value and no account identifier reaches the finding (F112-FR-001).
 */
export function redactEvidence(observed: unknown): Readonly<Record<string, unknown>> {
  if (observed === null || observed === undefined || typeof observed !== "object") {
    return Object.freeze({ observed: typeof observed });
  }
  const DROP = new Set(["stdout", "stderr", "output", "note", "transcript", "body", "secret"]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(observed as Record<string, unknown>)) {
    if (DROP.has(key)) continue;
    out[key] = typeof value === "object" && value !== null ? "[object]" : value;
  }
  return Object.freeze(out);
}

/**
 * End the process group of one spawned child (F112-FR-007, "ended process
 * group"). The group id is checked by the kernel primitive: only an integer
 * above one is signalled, and a group that is already gone is not an error.
 */
export function endProcessGroup(pid: number | undefined): void {
  if (typeof pid === "number" && Number.isInteger(pid) && pid > 1) signalGroup(pid, "kill");
}

/**
 * The real subprocess runner of the probe bag (F112-FR-007): stdin closed
 * (`ignore`, so a child that reads its standard input reads end-of-file and
 * cannot wait on the doctor), output capped, a time limit, and a detached
 * child whose whole process group is ended at the limit.
 */
export function makeSubprocessRunner(bounds?: {
  timeLimitMs?: number;
  outputCapBytes?: number;
}): SubprocessRunner {
  const timeLimitMs = bounds?.timeLimitMs ?? PROBE_TIME_LIMIT_MS;
  const capBytes = bounds?.outputCapBytes ?? SUBPROCESS_OUTPUT_CAP_BYTES;
  return {
    run(command: string, args: readonly string[]): Promise<SubprocessResult> {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], {
          // stdin closed; stdout and stderr are read, never inherited.
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });
        let stdout: Buffer = Buffer.alloc(0);
        let stderr: Buffer = Buffer.alloc(0);
        let truncated = false;
        let timedOut = false;
        let settled = false;
        const collect = (into: Buffer, chunk: Buffer): Buffer => {
          if (into.byteLength >= capBytes) {
            truncated = true;
            return into;
          }
          if (into.byteLength + chunk.byteLength > capBytes) {
            truncated = true;
            return Buffer.concat([into, chunk.subarray(0, capBytes - into.byteLength)]);
          }
          return Buffer.concat([into, chunk]);
        };
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout = collect(stdout, chunk);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = collect(stderr, chunk);
        });
        const timer = setTimeout(() => {
          timedOut = true;
          endProcessGroup(child.pid);
        }, timeLimitMs);
        const finish = (code: number | null, signal: string | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            code,
            signal,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
            timedOut,
            truncated,
          });
        };
        child.on("error", () => finish(null, null));
        child.on("close", (code, signal) => finish(code, signal ?? null));
      });
    },
  };
}

/**
 * The real network reader of the probe bag: GET only, redirects refused, a
 * time limit of 3 s (research D-11, R16 F4). No header carries a credential.
 */
export function makeNetworkReader(): NetworkReader {
  return {
    async get(url: string): Promise<{ status: number; body: string }> {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(NETWORK_TIME_LIMIT_MS),
      });
      const body = await response.text();
      return { status: response.status, body: body.slice(0, SUBPROCESS_OUTPUT_CAP_BYTES) };
    },
  };
}

/** The subprocess result a skipped check sees under `--quick`. */
const QUICK_SKIPPED: SubprocessResult = Object.freeze({
  code: null,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  truncated: false,
  skipped: true,
});

/**
 * Build a probe bag. The defaults are the real machine (the clock of the
 * process, the real subprocess runner and network reader); every member can be
 * replaced by a fixture, so the same check runs on a fixture without the real
 * machine (F112-FR-001). With `quick: true`, a subprocess or network call is
 * not made at all: the check sees a skipped marker and gives no finding.
 */
export function makeProbeBag(overrides?: Partial<ProbeBag>): ProbeBag {
  const quick = overrides?.quick ?? false;
  const realSubprocess = makeSubprocessRunner({
    timeLimitMs: overrides?.timeLimitMs,
    outputCapBytes: overrides?.outputCapBytes,
  });
  const realNetwork = makeNetworkReader();
  const bag: ProbeBag = {
    clock: overrides?.clock ?? {
      now: () => Date.now(),
      wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    files: overrides?.files ?? {
      stat: (path: string) => {
        // A metadata read only: size and mode, never content.
        try {
          const st = statSync(path);
          return { size: st.size, mode: st.mode };
        } catch {
          return undefined;
        }
      },
    },
    subprocess: quick
      ? // Under `--quick` no subprocess is spawned at all, not even through an
        // override: the check sees a skipped marker and gives no finding.
        { run: () => Promise.resolve(QUICK_SKIPPED) }
      : (overrides?.subprocess ?? realSubprocess),
    network: quick
      ? { get: () => Promise.resolve({ status: 0, body: "" }) }
      : (overrides?.network ?? realNetwork),
    registry: overrides?.registry ?? { ids: Object.freeze([]) },
    config: overrides?.config ?? { values: new Map() },
    runs: overrides?.runs ?? Object.freeze([]),
    quick,
    timeLimitMs: overrides?.timeLimitMs ?? PROBE_TIME_LIMIT_MS,
    outputCapBytes: overrides?.outputCapBytes ?? SUBPROCESS_OUTPUT_CAP_BYTES,
  };
  return Object.freeze(bag);
}

/** What the runner holds when it is done (F112-FR-003). */
export interface DoctorRunResult {
  /** The findings, in the output order: severity, then id (CT-112-102). */
  readonly findings: readonly Finding[];
  /** The exit code so far: 1 when a probe threw, 0 otherwise (F112-FR-027 refines). */
  readonly exit: number;
  /** The id of the check that threw, if any (F112-FR-008). */
  readonly error?: { readonly id: string; readonly message: string };
}

/** One outcome of one probe, before the severity rule reads it. */
type ProbeOutcome =
  | { readonly kind: "observed"; readonly observed: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "threw"; readonly error: unknown };

/**
 * Run one probe inside its bounds: the probe races the time limit of the bag;
 * a probe that does not end in time is a timeout, a probe that throws is a
 * throw. The probe itself is never given the real machine, only the bag.
 */
async function runOneProbe(check: Check, bag: ProbeBag): Promise<ProbeOutcome> {
  let done = false;
  const probe = check
    .probe(bag as Readonly<Record<string, unknown>>)
    .then((observed: unknown) => {
      done = true;
      return { kind: "observed", observed } as ProbeOutcome;
    })
    .catch((error: unknown) => {
      done = true;
      return { kind: "threw", error } as ProbeOutcome;
    });
  const limit = await Promise.race([
    probe,
    bag.clock.wait(bag.timeLimitMs).then((): ProbeOutcome => ({ kind: "timeout" })),
  ]);
  if (limit.kind === "timeout") {
    // The probe may have settled between the race and here: read it again.
    return done ? probe : { kind: "timeout" };
  }
  return limit;
}

/**
 * F112-FR-003 — run checks: sort into the running order, probe in parallel,
 * read each severity by the rule of its check, and sort the findings into the
 * output order. A check whose probe throws stops the run with exit 1 and no
 * further finding is rendered from it; the runner itself writes nothing
 * (F112-FR-008).
 */
export async function runDoctorChecks(input: {
  checks: readonly Check[];
  bag: ProbeBag;
}): Promise<DoctorRunResult> {
  const { bag } = input;
  const checks = [...input.checks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const findings: Finding[] = [];
  let error: DoctorRunResult["error"];
  const outcomes = await Promise.all(
    checks.map(async (check): Promise<void> => {
      const outcome = await runOneProbe(check, bag);
      if (outcome.kind === "threw") {
        if (error === undefined) {
          error = {
            id: check.id,
            message: (outcome.error as Error)?.message ?? String(outcome.error),
          };
        }
        return;
      }
      if (outcome.kind === "timeout") {
        findings.push({
          id: check.id,
          severity: "warn",
          lb: check.lb,
          message: `probe timed out`,
          evidence: Object.freeze({ timeLimitMs: bag.timeLimitMs }),
          remedy: renderMessage(check.fixHint, {}),
        });
        return;
      }
      // A probe that observed nothing (e.g. a check skipped under `--quick`)
      // gives no finding, and its severity rule is not read.
      if (outcome.observed === undefined || outcome.observed === null) return;
      const raw = check.severityRule(outcome.observed);
      const severity = normalizeSeverity(raw);
      findings.push({
        id: check.id,
        severity,
        lb: check.lb,
        message: renderMessage(check.messageTemplate, outcome.observed),
        evidence: redactEvidence(outcome.observed),
        remedy: renderMessage(check.fixHint, outcome.observed),
      });
    }),
  );
  void outcomes;
  return {
    findings: orderFindings(findings),
    exit: error !== undefined ? EXIT_INTERNAL_ERROR : 0,
    ...(error !== undefined ? { error } : {}),
  };
}
