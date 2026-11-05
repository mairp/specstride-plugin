/**
 * T045 — steps 1, 2 and 4 of the handshake (F122-FR-004 to F122-FR-009,
 * F122-SC-007; annex F §F.3; `specs/122-detached-runtime/contracts/cli-state-commands.md`).
 *
 * The CLI's three steps. Step 3 belongs to the runtime root and is in
 * `@specstride/runtime` (`src/root/start.ts`); this module never does step 3's
 * work, and that separation is the whole shape of the handshake: the CLI writes
 * a record and waits for a FILE; the root takes the lock and writes that file.
 * Nothing connects the two (F122-FR-008).
 *
 *   **Step 1** — write the launch record with a fresh launch nonce, BEFORE the
 *   detach strategy is called (F122-FR-004). Written to a temporary name and
 *   renamed, through the atomic write of the kernel. Before it, the abandoned
 *   record of a previous launch is closed (F122-FR-007).
 *
 *   **Step 2** — call the detach strategy (F122-FR-002). A strategy that is
 *   `unavailable`, or that throws, refuses the launch, and the message names
 *   `foreground` (F122-FR-005, §F.6).
 *
 *   **Step 4** — wait for a lease that carries THIS launch's nonce, for a
 *   bounded time and no longer; record exactly one outcome in the launch
 *   record; print one line; exit with the code of §F.3.
 *
 * WHY `attached` IS NOT A REFUSAL. F122-FR-006: a launch that finds a lease of
 * a LIVE run with ANOTHER nonce ends `attached`, prints the run that lives and
 * exits 4. The wait therefore watches for two things at once, and the order it
 * checks them in is the requirement: this launch's nonce first. Two launches
 * that race must end with one `started` and one `attached`, and a loser that
 * checked "is there a lease?" before "is it mine?" could report `attached`
 * about its own run.
 *
 * WHY THE OUTCOME IS WRITTEN EXACTLY ONCE. F122-SC-007: *100 per cent of
 * launches end with exactly one of the three outcomes within the handshake
 * limit plus the time of the launch checks, and no launch record stays without
 * an outcome after the next launch.* `writeTheOutcome` refuses a second write
 * into a record that already carries one, so a code path that both refused and
 * then reported `attached` fails loudly rather than rewriting history.
 *
 * `run --detach` IS THIS PATH. F122-FR-009: a run request of kind `engine` uses
 * the same detach strategy, launch record, handshake, lock and lease as one of
 * kind `pipeline`. There is no second function here for it: `requestKind` is a
 * field of the input, both kinds run the same code, and a kind that is neither
 * refuses the launch before anything is written.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWriteJson } from "@specstride/kernel";
import { resolve, rootPathsOf } from "@specstride/contracts/ids/logical-names";
import {
  LOGICAL_NAME as LAUNCH_RECORD_LOGICAL_NAME,
  SCHEMA_ID as LAUNCH_SCHEMA_ID,
  isLaunchRecord,
  tryReadLaunchRecord,
  type LaunchRecord,
} from "@specstride/contracts/records/launch-record";
import {
  LOGICAL_NAME as LEASE_LOGICAL_NAME,
  tryReadLease,
  type Lease,
} from "@specstride/contracts/records/lease";
import {
  HANDSHAKE_OUTCOMES,
  HANDSHAKE_STEPS,
  LAUNCH_ABANDONED,
  deriveLaunchAbandoned,
  exitOfLaunch,
  type HandshakeOutcome,
} from "@specstride/contracts/state/handshake";
import {
  RUN_REQUEST_KINDS,
  acceptRunRequestKind,
  isRunRequestKind,
  type RunRequestKind,
} from "@specstride/contracts/state/run-requests";
import { STRATEGY_WITHOUT_DETACHING, type DetachStrategy } from "@specstride/contracts/ep/detach";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import { tryReadApprovalRecord } from "@specstride/contracts/records/approval-record";
import type {
  CanonicalSpecModel,
  SpecPhase,
} from "@specstride/contracts/records/canonical-spec-model";
import { catalogueEntry } from "@specstride/config";

/* ------------------------------------------------------------------ *
 * BETWEEN THE CLI AND THE RUNTIME ROOT THERE ARE ONLY FILES.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-003, F122-FR-008 — this module imports NOTHING of
 * `@specstride/runtime`, and the import-boundary check enforces it (rule LR-1).
 * That is not a packaging detail: it is the shape of the handshake. The CLI and
 * the runtime root share a lease FILE and a launch record FILE, resolved from
 * the layout table of feature 100, validated against the schemas of feature 100,
 * and nothing else — no channel, no shared object, no module the root also
 * loads. So the three things this module would otherwise have borrowed from the
 * runtime package are here instead, each read from the one place both sides
 * read it from:
 *
 *   - the PATH of the lease: `leasePathOf`, from the layout table;
 *   - the READ of the lease: `readLeaseAt`, through the validator of §B.8;
 *   - the HANDSHAKE LIMIT: the `default` cell of `runtime.handshake.timeoutSec`
 *     in the configuration catalogue of feature 110, which the runtime root
 *     reads from the same place. A literal here would be a second definition of
 *     one number across a boundary neither side can see over.
 */
export const IMPORTS_THE_RUNTIME_PACKAGE = false as const;
export const WHAT_IS_BETWEEN_THE_CLI_AND_THE_ROOT = "only files" as const;

/** The key of the handshake limit (row 114 of annex X §X.7). */
export const HANDSHAKE_LIMIT_KEY = "runtime.handshake.timeoutSec" as const;

/** The default of the handshake limit, read from the catalogue and never fixed here. */
export const HANDSHAKE_LIMIT_SECONDS: number = ((): number => {
  const entry = catalogueEntry(HANDSHAKE_LIMIT_KEY);
  const given = entry?.default;
  if (given === undefined || given.kind !== "value" || typeof given.value !== "number") {
    throw new Error(
      `the configuration catalogue holds no numeric default for \`${HANDSHAKE_LIMIT_KEY}\`; the ` +
        `handshake limit is ordinary configuration (F122-FR-005)`,
    );
  }
  return given.value;
})();

/** The logical name of the lease (annex B, §B.5), which the root writes. */
export { LEASE_LOGICAL_NAME };

/** The path of `run:<runId>:lease`, resolved from the layout table. */
export function leasePathOf(where: {
  readonly place: HandshakePlace;
  readonly slug: string;
  readonly runId: string;
}): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: where.place.workspaceRealPath,
    workspaceId: "",
    controlRoot: where.place.controlRoot,
    workerRoot: "",
  });
  return resolve(LEASE_LOGICAL_NAME, { "<slug>": where.slug, "<runId>": where.runId }, roots);
}

/**
 * The lease at a path, validated against `specstride.lease/1`, or `null`. A
 * record that does not validate reads as NO lease: the CLI would otherwise
 * confirm readiness on a file the root never finished writing.
 */
export function readLeaseAt(path: string): Lease | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const read = tryReadLease(parsed);
  return read.ok ? read.record : null;
}

/** F100-FR-160 — true when a lease carries the nonce of a launch. */
export function leaseCarriesTheNonce(lease: Lease | null, launchNonce: string): boolean {
  return lease !== null && String(lease.launchNonce) === String(launchNonce);
}

/** The requirements this module carries. */
export const HANDSHAKE_REQUIREMENTS = [
  "F122-FR-004",
  "F122-FR-005",
  "F122-FR-006",
  "F122-FR-007",
  "F122-FR-008",
  "F122-FR-009",
  "F122-SC-007",
] as const;

/** The steps of §F.3 this module performs; step 3 is the runtime root's. */
export const STEPS_OF_THE_CLI = [1, 2, 4] as const;
export const STEP_OF_THE_RUNTIME_ROOT = 3 as const;
export { HANDSHAKE_STEPS, HANDSHAKE_OUTCOMES, RUN_REQUEST_KINDS };
export type { HandshakeOutcome, RunRequestKind, LaunchRecord, Lease };

/** The two lines of §G.3 this command prints, and no third. */
export const LAUNCH_LABEL = "SPECSTRIDE-LAUNCH" as const;
export const REFUSE_LABEL = "SPECSTRIDE-REFUSE" as const;

/** The action of a refusal of this command (§G.3). */
export const ACTION = "launch" as const;

/** F122-FR-005 — under the `parity` profile neither line is printed. */
export const PROFILE_THAT_PRINTS_NO_LINE = PROFILE_NAME;

/** F122-FR-004 — the launch nonce comes from a secure random source. */
export const LAUNCH_NONCE_BYTES = 32 as const;
export function mintALaunchNonce(): string {
  return randomBytes(LAUNCH_NONCE_BYTES).toString("hex");
}

/** F122-FR-004 — the record is written to a temporary name and renamed. */
export const THE_RECORD_IS_WRITTEN_ATOMICALLY = true as const;

/* ------------------------------------------------------------------ *
 * F122-FR-037 — ticked phases without approval records.
 * ------------------------------------------------------------------ */

/**
 * T065 — the refusal `unadopted-approvals` (F122-FR-037, F122-SC-003; closed
 * set 212 of `contracts/closed-sets.json`).
 *
 * F122-FR-037: *A launch in a workspace whose spec shows ticked phases for
 * which the control plane holds no approval record MUST be refused before the
 * detach strategy is called, and the refusal MUST name the commands
 * `state export`, `state import` and `state adopt`. The run MUST NOT start at
 * the first phase over ticked phases.*
 *
 * This is what a MOVED working tree looks like from the inside: the tasks of
 * the spec are ticked, because the work was done, and the control plane of the
 * new path is empty, because the control plane lies outside the working tree
 * and did not travel with it. Without this refusal the run would start at
 * phase 1 and redo every approved phase.
 */
export const UNADOPTED_APPROVALS = "unadopted-approvals" as const;

/**
 * F122-FR-037 — the three commands the refusal names. They are the way out:
 * `state adopt` for a tree that MOVED, `state export` and `state import` for a
 * tree that was CLONED or carried to another machine (F122-FR-035).
 */
export const THE_THREE_COMMANDS = ["state export", "state import", "state adopt"] as const;

/** F122-FR-037 — the refusal comes BEFORE the detach strategy is called. */
export const UNADOPTED_APPROVALS_IS_REFUSED_BEFORE_STEP = 2 as const;

/** F122-FR-037 — and the run never starts at the first phase over ticked ones. */
export const THE_RUN_STARTS_AT_THE_FIRST_PHASE_OVER_TICKED_PHASES = false as const;

/** The logical name of an approval record (annex B, §B.5). */
export const APPROVAL_LOGICAL_NAME = "gate:<N>:approved" as const;

/** The path of `gate:<N>:approved` for one phase, from the layout table. */
export function approvalRecordPathOf(
  place: HandshakePlace,
  slug: string,
  phase: number | string,
): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  return resolve(APPROVAL_LOGICAL_NAME, { "<slug>": slug, "<N>": String(phase) }, roots);
}

/**
 * F122-FR-037 — a phase is TICKED when it has tasks and every one of them is
 * ticked.
 *
 * The reading goes through the CANONICAL SPEC MODEL and through nothing else:
 * `phase.tasks[].ticked` is the field the model of annex C §C.7 carries, which
 * is the output of `parse` of EP-03. This module does not open `tasks.md`, does
 * not count `- [x]` and holds no parser — *the model is the one thing every
 * component that reads a specification reads; a second parser does not exist*
 * (`records/canonical-spec-model.ts`). A phase with no task at all is not
 * ticked: there is nothing in it that could have been done.
 */
export function phaseIsTicked(phase: SpecPhase): boolean {
  return phase.tasks.length > 0 && phase.tasks.every((task) => task.ticked);
}

/** The numbers of the ticked phases of a model, in order. */
export function tickedPhasesOf(model: CanonicalSpecModel): readonly number[] {
  return Object.freeze(model.phases.filter(phaseIsTicked).map((phase) => phase.number));
}

/**
 * The phases for which the control plane holds an approval record, in order.
 *
 * A FILE is not an approval: the record is validated against
 * `specstride.approval/1` before it counts, because *a bare marker without a
 * record counts as not approved* (F100-FR-070). An unreadable file, a file that
 * is not JSON and a record of another feature or another phase all count as no
 * record.
 */
export function approvedPhasesOf(place: HandshakePlace, slug: string): readonly number[] {
  const one = approvalRecordPathOf(place, slug, 0);
  const directory = one.replace(/\/[^/]+$/, "");
  if (!existsSync(directory)) return Object.freeze([]);
  const out: number[] = [];
  for (const name of readdirSync(directory)) {
    const match = /^phase-(\d+)\.json$/.exec(name);
    if (match === null) continue;
    const phase = Number(match[1]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
    } catch {
      continue;
    }
    const read = tryReadApprovalRecord(parsed);
    if (!read.ok) continue;
    if (String(read.record.feature) !== slug) continue;
    if (Number(read.record.phase) !== phase) continue;
    out.push(phase);
  }
  return Object.freeze(out.sort((a, b) => a - b));
}

/** What the check of F122-FR-037 answers. */
export type UnadoptedApprovals = {
  /** True where the launch must be refused. */
  readonly refuse: boolean;
  /** The ticked phases of the spec, in order. */
  readonly ticked: readonly number[];
  /** The phases the control plane holds a record for, in order. */
  readonly approved: readonly number[];
  /** The ticked phases with no record: what `state adopt` would bring back. */
  readonly unadopted: readonly number[];
  /**
   * F122-SC-003 — *after `state adopt` the run continues at the first phase
   * without an approval record*. The number is answered here, by the same
   * reading, so that the refusal and the phase the run resumes at cannot
   * disagree.
   */
  readonly firstPhaseWithoutARecord: number | null;
  /** The three commands, so a caller need not know them. */
  readonly commands: readonly string[];
  readonly detail: string;
};

/**
 * F122-FR-037 — the ticked phases for which the control plane holds no
 * approval record.
 */
export function unadoptedApprovalsOf(
  place: HandshakePlace,
  slug: string,
  model: CanonicalSpecModel,
): UnadoptedApprovals {
  const ticked = tickedPhasesOf(model);
  const approved = approvedPhasesOf(place, slug);
  const unadopted = Object.freeze(ticked.filter((phase) => !approved.includes(phase)));
  return Object.freeze({
    refuse: unadopted.length > 0,
    ticked,
    approved,
    unadopted,
    firstPhaseWithoutARecord: firstPhaseWithoutAnApprovalRecord(model, approved),
    commands: Object.freeze([...THE_THREE_COMMANDS]),
    detail:
      unadopted.length === 0
        ? `every ticked phase of \`${slug}\` has an approval record`
        : `the spec of \`${slug}\` shows phase(s) ${unadopted.join(", ")} as ticked and the ` +
          `control plane holds no approval record for them; ` +
          `${THE_THREE_COMMANDS.join(", ")} bring the records of the old path over`,
  });
}

/**
 * F122-SC-003 — the first phase of the model for which there is no approval
 * record. After `state adopt` has brought the records over, that is the phase
 * the run continues at; before it, it is phase 1, which is why a launch over
 * ticked phases is refused rather than started.
 */
export function firstPhaseWithoutAnApprovalRecord(
  model: CanonicalSpecModel,
  approved: readonly number[],
): number | null {
  for (const phase of [...model.phases].sort((a, b) => a.number - b.number)) {
    if (!approved.includes(phase.number)) return phase.number;
  }
  return null;
}

/** The refusals of a launch this module writes (closed set 212). */
export const LAUNCH_REFUSALS = [
  "detach-unavailable",
  "detach-not-ready",
  "unknown-mode",
  "launch-abandoned",
  UNADOPTED_APPROVALS,
] as const;
export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number] | string;

/**
 * F122-FR-009 — the refusal of a run request of a kind that is neither
 * `pipeline` nor `engine`. Row 18 of annex X §X.6 says the unknown value of the
 * set of run request kinds is *the launch is refused*; row 212 gives the
 * member a refusal is written under, and `unknown-mode` is the one that names a
 * request the product cannot read.
 */
export const REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND = "unknown-mode" as const;

/** The command a refusal names as the way out (§G.3, key `next`). */
export function nextForARefusal(refusal: LaunchRefusal): string {
  if (refusal === "detach-unavailable" || refusal === "detach-not-ready") {
    // F122-FR-005 — *the message MUST name the strategy `foreground` as the
    // way to run without detaching.*
    return `specstride launch --detach-strategy ${STRATEGY_WITHOUT_DETACHING}`;
  }
  if (refusal === REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND) {
    return `specstride launch --kind ${RUN_REQUEST_KINDS.join("|")}`;
  }
  if (refusal === UNADOPTED_APPROVALS) {
    // F122-FR-037 — *the refusal MUST name the commands `state export`,
    // `state import` and `state adopt`*. All three, in the key the grammar
    // gives a refusal for the way out (§G.3, key `next`).
    return THE_THREE_COMMANDS.map((one) => `specstride ${one}`).join(" | ");
  }
  return "specstride doctor";
}

/* ------------------------------------------------------------------ *
 * Where a launch record lives.
 * ------------------------------------------------------------------ */

/** Where the control plane of this workspace is. */
export type HandshakePlace = {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
};

/** The path of `launch:<launchId>:record` (annex B, §B.5). */
export function launchRecordPathOf(place: HandshakePlace, launchId: string): string {
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: place.workspaceRealPath,
    workspaceId: "",
    controlRoot: place.controlRoot,
    workerRoot: "",
  });
  return resolve(LAUNCH_RECORD_LOGICAL_NAME, { "<launchId>": launchId }, roots);
}

/** The directory the launch records of a workspace lie in. */
export function launchesDirectoryOf(place: HandshakePlace): string {
  const one = launchRecordPathOf(place, "x");
  // `<control>/launches/<launchId>/launch.json` — two segments up.
  return one.replace(/\/[^/]+\/[^/]+$/, "");
}

/** Every launch record of this workspace, with its path. */
export function launchRecordsOf(
  place: HandshakePlace,
): readonly { readonly launchId: string; readonly path: string; readonly record: LaunchRecord }[] {
  const directory = launchesDirectoryOf(place);
  if (!existsSync(directory)) return Object.freeze([]);
  const out: { launchId: string; path: string; record: LaunchRecord }[] = [];
  for (const launchId of readdirSync(directory)) {
    const path = launchRecordPathOf(place, launchId);
    const record = readTheLaunchRecord(path);
    if (record !== null) out.push({ launchId, path, record });
  }
  return Object.freeze(out.sort((a, b) => a.launchId.localeCompare(b.launchId)));
}

/** A launch record off the disk, or `null` where there is none to read. */
export function readTheLaunchRecord(path: string): LaunchRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const read = tryReadLaunchRecord(parsed);
  return read.ok ? read.record : null;
}

/* ------------------------------------------------------------------ *
 * Step 1 — the launch record, written before the strategy is called.
 * ------------------------------------------------------------------ */

/** What a launch brings to its record (§B.7). */
export type LaunchRecordInput = {
  readonly place: HandshakePlace;
  readonly launchId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly requestKind: string;
  readonly request: Record<string, unknown>;
  readonly reason?: "first" | "resume" | "relaunch" | "manual" | undefined;
  readonly host?: string | undefined;
  readonly commentHash?: string | null | undefined;
  readonly detachStrategy: string;
  readonly launchNonce?: string | undefined;
  readonly engineExecutable: Record<string, unknown>;
  readonly productVersion?: string | undefined;
  readonly protocol?: number | undefined;
  readonly now?: (() => Date) | undefined;
};

/** The CLI protocol integer this command speaks (annex G §G.1). */
export const CLI_PROTOCOL = 1 as const;

/** A record that does not validate against `specstride.launch/1`. */
export class LaunchRecordRefusedError extends Error {
  readonly logicalName = LAUNCH_RECORD_LOGICAL_NAME;
  constructor(detail: string) {
    super(`the launch record of \`${LAUNCH_RECORD_LOGICAL_NAME}\` was refused: ${detail}`);
    this.name = "LaunchRecordRefusedError";
  }
}

/**
 * Step 1 — write the launch record with a fresh launch nonce (F122-FR-004).
 *
 * Validated against the schema of feature 100 before it reaches the disk: a
 * record that does not validate is a launch that no reader can derive anything
 * about, including `launch-abandoned`, and the launch would then be invisible
 * rather than refused.
 */
export function writeTheLaunchRecord(input: LaunchRecordInput): {
  readonly record: LaunchRecord;
  readonly path: string;
} {
  const at = (input.now ?? ((): Date => new Date()))();
  const record = Object.freeze({
    schema: LAUNCH_SCHEMA_ID,
    launchId: input.launchId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    requestKind: input.requestKind as RunRequestKind,
    request: input.request,
    mode: "run" as const,
    reason: input.reason ?? "first",
    host: input.host ?? "cli",
    commentHash: input.commentHash ?? null,
    detachStrategy: input.detachStrategy,
    launchNonce: input.launchNonce ?? mintALaunchNonce(),
    engineExecutable: input.engineExecutable,
    createdAt: at.toISOString(),
    productVersion: input.productVersion ?? "0.0.0",
    protocol: input.protocol ?? CLI_PROTOCOL,
  }) as LaunchRecord;
  if (!isLaunchRecord(record)) {
    const read = tryReadLaunchRecord(record);
    throw new LaunchRecordRefusedError(read.ok ? "it does not validate" : read.error.message);
  }
  const path = launchRecordPathOf(input.place, input.launchId);
  atomicWriteJson(path, record, { createDirectory: true });
  return Object.freeze({ record, path });
}

/** An outcome written into a record that already carries one (F122-SC-007). */
export class OutcomeAlreadyWrittenError extends Error {
  constructor(launchId: string, had: string, asked: string) {
    super(
      `the launch record of \`${launchId}\` already carries the outcome \`${had}\`; a launch ` +
        `records exactly one of ${HANDSHAKE_OUTCOMES.join(", ")} (F122-SC-007) and \`${asked}\` ` +
        `would be the second`,
    );
    this.name = "OutcomeAlreadyWrittenError";
  }
}

/**
 * F122-FR-005, F122-SC-007 — record the outcome in the launch record, exactly
 * once. The record is re-read from the disk first, so that a second process
 * (the next launch, closing this one as abandoned) cannot be overwritten by a
 * stale copy this process has been holding.
 */
export function writeTheOutcome(input: {
  readonly place: HandshakePlace;
  readonly launchId: string;
  readonly outcome: HandshakeOutcome;
  readonly refusal?: LaunchRefusal | undefined;
  readonly refusalFile?: string | undefined;
}): LaunchRecord {
  const path = launchRecordPathOf(input.place, input.launchId);
  const current = readTheLaunchRecord(path);
  if (current === null) {
    throw new LaunchRecordRefusedError(
      `there is no readable launch record at \`${path}\` to record an outcome in`,
    );
  }
  if (current.outcome !== undefined && current.outcome !== null) {
    throw new OutcomeAlreadyWrittenError(input.launchId, String(current.outcome), input.outcome);
  }
  const next = Object.freeze({
    ...current,
    outcome: input.outcome,
    ...(input.refusal === undefined ? {} : { refusal: input.refusal }),
    ...(input.refusalFile === undefined ? {} : { refusalFile: input.refusalFile }),
  }) as LaunchRecord;
  atomicWriteJson(path, next, { createDirectory: true });
  return next;
}

/* ------------------------------------------------------------------ *
 * F122-FR-007 — `launch-abandoned`, derived by readers and closed by the
 * next launch.
 * ------------------------------------------------------------------ */

/** F122-FR-007 — no process writes `launch-abandoned` as a STATE. */
export const LAUNCH_ABANDONED_IS_WRITTEN_AS_A_STATE = false as const;
export { LAUNCH_ABANDONED };

/** One abandoned record, as a reader derives it. */
export type AbandonedLaunch = {
  readonly launchId: string;
  readonly path: string;
  readonly record: LaunchRecord;
};

/**
 * F122-FR-007 — every launch record of this workspace that a reader derives as
 * `launch-abandoned`: older than the handshake limit, no outcome, and no lease
 * carrying its nonce. The derivation itself is feature 100's
 * (`deriveLaunchAbandoned`), so the CLI and every other reader cannot disagree.
 */
export function abandonedLaunchesOf(input: {
  readonly place: HandshakePlace;
  readonly slug: string;
  readonly now?: Date | undefined;
  readonly handshakeLimitSeconds?: number | undefined;
  /** The launch doing the closing, which is never itself abandoned. */
  readonly except?: string | undefined;
}): readonly AbandonedLaunch[] {
  const now = input.now ?? new Date();
  const limit = input.handshakeLimitSeconds ?? HANDSHAKE_LIMIT_SECONDS;
  const out: AbandonedLaunch[] = [];
  for (const one of launchRecordsOf(input.place)) {
    if (one.launchId === input.except) continue;
    const lease = readLeaseAt(
      leasePathOf({
        place: input.place,
        slug: input.slug,
        runId: String(one.record.runId),
      }),
    );
    const derived = deriveLaunchAbandoned({
      record: one.record,
      ...(lease === null ? {} : { lease }),
      now,
      handshakeLimitSeconds: limit,
    });
    if (derived === LAUNCH_ABANDONED) {
      out.push({ launchId: one.launchId, path: one.path, record: one.record });
    }
  }
  return Object.freeze(out);
}

/**
 * F122-FR-007 — *the next `launch` or `resume` in the workspace MUST close the
 * record by writing the outcome `refused` with the refusal `launch-abandoned`
 * into it.* This is that close, and it is done by THIS launch for the previous
 * ones, never for itself.
 */
export function closeAbandonedLaunches(input: {
  readonly place: HandshakePlace;
  readonly slug: string;
  readonly now?: Date | undefined;
  readonly handshakeLimitSeconds?: number | undefined;
  readonly except?: string | undefined;
}): readonly AbandonedLaunch[] {
  const closed: AbandonedLaunch[] = [];
  for (const one of abandonedLaunchesOf(input)) {
    try {
      writeTheOutcome({
        place: input.place,
        launchId: one.launchId,
        outcome: "refused",
        refusal: LAUNCH_ABANDONED,
      });
      closed.push(one);
    } catch (error) {
      // Another launch closed it first. That is the right outcome already, and
      // a second write would be the second outcome F122-SC-007 forbids.
      if (!(error instanceof OutcomeAlreadyWrittenError)) throw error;
    }
  }
  return Object.freeze(closed);
}

/* ------------------------------------------------------------------ *
 * Step 4 — the bounded wait.
 * ------------------------------------------------------------------ */

/** What the wait found. */
export type WaitResult =
  | { readonly found: "mine"; readonly lease: Lease }
  | { readonly found: "another"; readonly lease: Lease }
  | { readonly found: "none" };

/** How often the wait looks at the lease; it opens no channel (F122-FR-008). */
export const WAIT_POLL_MS = 25 as const;

/** F122-FR-008 — the wait is a READ of a file and nothing else. */
export const THE_WAIT_OPENS_A_CHANNEL = false as const;

/**
 * F122-FR-006, annex B §B.8 — whether a lease is of a run that LIVES, read from
 * `validUntil`, which is the time of the last heartbeat plus the grace. The CLI
 * cannot probe the lock — between it and the runtime root there are only files —
 * so this is the reading F122-FR-008 gives it: *the owner record, the time of
 * the last heartbeat, and `validUntil`*.
 */
export function theLeaseIsOfALiveRun(lease: Lease, nowMs: number): boolean {
  const until = Date.parse(String(lease.validUntil));
  return Number.isNaN(until) ? false : until > nowMs;
}

/** What the wait is driven by, so that a test waits for nothing real. */
export type WaitDeps = {
  /** The lease of the run as it lies on disk now, or `null`. */
  readonly readLease: () => Lease | null;
  /** Milliseconds since the epoch; a test pins it. */
  readonly nowMs: () => number;
  /** Pause between two looks; a test makes it immediate. */
  readonly pause: (ms: number) => Promise<void>;
};

/**
 * The deps over a real workspace.
 *
 * THE PAUSE HOLDS THE EVENT LOOP OPEN, on purpose, and that is not a detail. A
 * `launch` whose only pending work is this wait has nothing else keeping its
 * loop alive; with an unreferenced timer the platform would see an empty loop,
 * resolve it, and the promise of the wait would never settle at all — a launch
 * that printed no line, wrote no outcome and exited 0. That is exactly the
 * failure F122-SC-007 forbids (*a launch always ends*), and it is silent, which
 * is worse. The wait is bounded by the handshake limit, so a referenced timer
 * cannot hold the process open for longer than the limit either.
 */
export function waitDepsFor(place: HandshakePlace, slug: string, runId: string): WaitDeps {
  const path = leasePathOf({ place, slug, runId });
  return Object.freeze({
    readLease: (): Lease | null => readLeaseAt(path),
    nowMs: (): number => Date.now(),
    pause: (ms: number): Promise<void> =>
      new Promise<void>((done) => {
        setTimeout(done, ms);
      }),
  });
}

/** F122-SC-007 — the wait keeps the loop of the launch alive while it lasts. */
export const THE_WAIT_HOLDS_THE_EVENT_LOOP_OPEN = true as const;

/**
 * F122-FR-005, F122-FR-006 — wait for a lease that carries this launch's
 * nonce, *for a bounded time and no longer*.
 *
 * The order of the two questions is the requirement (see the header): mine
 * first, another second.
 */
export async function waitForTheLease(input: {
  readonly launchNonce: string;
  readonly handshakeLimitSeconds?: number | undefined;
  readonly deps: WaitDeps;
}): Promise<WaitResult> {
  const limit = (input.handshakeLimitSeconds ?? HANDSHAKE_LIMIT_SECONDS) * 1_000;
  const started = input.deps.nowMs();
  for (;;) {
    const lease = input.deps.readLease();
    if (lease !== null) {
      if (leaseCarriesTheNonce(lease, input.launchNonce)) {
        return Object.freeze({ found: "mine" as const, lease });
      }
      // F122-FR-006 — a lease of another launch of a LIVE run: `attached`, not
      // `refused`. "Live" is the word the requirement uses, and it is read from
      // `validUntil`: a lease whose grace has passed is the trace of a run that
      // is no longer reporting, and attaching to it would tell the consumer a
      // dead run lives. Such a lease is passed over, and the wait goes on until
      // the bound — which ends as `detach-not-ready`, the honest answer.
      if (!theLeaseIsOfALiveRun(lease, input.deps.nowMs())) {
        if (input.deps.nowMs() - started >= limit) {
          return Object.freeze({ found: "none" as const });
        }
        await input.deps.pause(WAIT_POLL_MS);
        continue;
      }
      return Object.freeze({ found: "another" as const, lease });
    }
    // The bound is measured from the recorded start of the wait and is checked
    // AFTER a look, so a limit of zero still takes one look: a lease that was
    // already there must not be missed because the clock said so.
    if (input.deps.nowMs() - started >= limit) {
      return Object.freeze({ found: "none" as const });
    }
    await input.deps.pause(WAIT_POLL_MS);
  }
}

/* ------------------------------------------------------------------ *
 * The handshake.
 * ------------------------------------------------------------------ */

/** What the CLI brings to the handshake. */
export type LaunchHandshakeInput = {
  readonly place: HandshakePlace;
  readonly slug: string;
  readonly launchId: string;
  readonly runId: string;
  readonly workspaceId: string;
  /** F122-FR-009 — `pipeline` or `engine`; anything else refuses the launch. */
  readonly requestKind: string;
  readonly request: Record<string, unknown>;
  readonly engineExecutable: Record<string, unknown>;
  /** The strategy of EP-17, already resolved from the registry. */
  readonly strategy: DetachStrategy;
  /** Step 2's inputs (§F.6). */
  readonly runtimeEntry: readonly string[];
  readonly environmentAllowList: readonly string[];
  readonly runtimeLogLogicalName: string;
  readonly launchNonce?: string | undefined;
  readonly handshakeLimitSeconds?: number | undefined;
  readonly reason?: "first" | "resume" | "relaunch" | "manual" | undefined;
  readonly host?: string | undefined;
  readonly productVersion?: string | undefined;
  /** The profile in force; under `parity` no line is printed. */
  readonly profile?: string | undefined;
  /** The state of the run, for the key `state` of the line. */
  readonly runState?: string | undefined;
  readonly now?: (() => Date) | undefined;
  /** The wait; a test hands in its own. */
  readonly deps?: WaitDeps | undefined;
  /** Where the one line goes. */
  readonly print?: ((line: string) => void) | undefined;
  /**
   * F122-FR-037 — the canonical spec model of the feature, through which the
   * ticked phases are read. Where it is given, a launch over ticked phases
   * without approval records is refused with `unadopted-approvals` before the
   * detach strategy is called.
   */
  readonly specModel?: CanonicalSpecModel | undefined;
};

/** What the handshake answers. */
export type LaunchHandshakeOutcome = {
  readonly outcome: HandshakeOutcome;
  readonly exit: number;
  /** The one line, or `""` under the `parity` profile. */
  readonly line: string;
  readonly refusal?: LaunchRefusal | undefined;
  /** The record as it lies on disk at the end, with its outcome. */
  readonly record: LaunchRecord | null;
  readonly launchNonce: string;
  readonly lease?: Lease | undefined;
  /** F122-FR-007 — the records this launch closed as abandoned. */
  readonly closedAsAbandoned: readonly string[];
  /** Which of the four steps ran, in order; a test reads it. */
  readonly steps: readonly number[];
  /** F122-FR-008 — this launch opened no channel to a runtime root. */
  readonly openedAChannel: false;
  /** F122-FR-037 — the reading of the ticked phases, where one was taken. */
  readonly unadoptedApprovals?: UnadoptedApprovals | undefined;
};

/**
 * Steps 1, 2 and 4 of §F.3, in order, for a run request of kind `pipeline` and
 * of kind `engine` alike.
 */
export async function runLaunchHandshake(
  input: LaunchHandshakeInput,
): Promise<LaunchHandshakeOutcome> {
  const steps: number[] = [];
  const print = input.print ?? ((line: string): void => void process.stdout.write(line + "\n"));
  const now = input.now ?? ((): Date => new Date());
  const nonce = input.launchNonce ?? mintALaunchNonce();
  const limit = input.handshakeLimitSeconds ?? HANDSHAKE_LIMIT_SECONDS;
  const quiet = input.profile === PROFILE_THAT_PRINTS_NO_LINE;

  const report = (
    outcome: HandshakeOutcome,
    extra: {
      readonly refusal?: LaunchRefusal | undefined;
      readonly lease?: Lease | undefined;
      readonly detail?: string | undefined;
      readonly recordTheOutcome?: boolean | undefined;
    },
    closed: readonly string[],
  ): LaunchHandshakeOutcome => {
    let record: LaunchRecord | null = null;
    if (extra.recordTheOutcome !== false) {
      record = writeTheOutcome({
        place: input.place,
        launchId: input.launchId,
        outcome,
        ...(extra.refusal === undefined ? {} : { refusal: extra.refusal }),
      });
    }
    const line =
      outcome === "refused"
        ? printLine(REFUSE_LABEL, {
            action: ACTION,
            reason: String(extra.refusal ?? "refused"),
            next: nextForARefusal(extra.refusal ?? "refused"),
          })
        : printLine(LAUNCH_LABEL, {
            // F122-FR-006 — `attached` prints the run THAT LIVES, which is the
            // one the lease names and not the one this launch asked for.
            run:
              outcome === "attached" && extra.lease !== undefined
                ? String(extra.lease.runId)
                : input.runId,
            state: input.runState ?? (outcome === "started" ? "running" : "running"),
          });
    if (!quiet) print(line);
    return Object.freeze({
      outcome,
      exit: exitOfLaunch(
        outcome,
        extra.refusal === undefined ? {} : { refusal: String(extra.refusal) },
      ),
      line: quiet ? "" : line,
      ...(extra.refusal === undefined ? {} : { refusal: extra.refusal }),
      record,
      launchNonce: nonce,
      ...(extra.lease === undefined ? {} : { lease: extra.lease }),
      closedAsAbandoned: Object.freeze([...closed]),
      steps: Object.freeze([...steps]),
      openedAChannel: false as const,
    });
  };

  // F122-FR-009 — a run request of another kind refuses the launch. It is
  // refused BEFORE step 1: a record of a request the product cannot read would
  // be a launch no reader could resolve.
  if (!isRunRequestKind(input.requestKind)) {
    const accepted = acceptRunRequestKind(input.requestKind);
    const line = printLine(REFUSE_LABEL, {
      action: ACTION,
      reason: REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND,
      next: nextForARefusal(REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND),
    });
    if (!quiet) print(line);
    return Object.freeze({
      outcome: "refused" as const,
      exit: exitOfLaunch("refused", { refusal: REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND }),
      line: quiet ? "" : line,
      refusal: REFUSAL_OF_AN_UNKNOWN_REQUEST_KIND,
      record: null,
      launchNonce: nonce,
      closedAsAbandoned: Object.freeze([]),
      steps: Object.freeze([]),
      openedAChannel: false as const,
      // The message of feature 100's own acceptance, so the two agree.
      detail: accepted.message,
    } as LaunchHandshakeOutcome);
  }

  // F122-FR-007 — close what the last launch left open, before writing this
  // launch's record: the record this launch writes must never be a candidate
  // for its own close.
  const closed = closeAbandonedLaunches({
    place: input.place,
    slug: input.slug,
    now: now(),
    handshakeLimitSeconds: limit,
    except: input.launchId,
  }).map((one) => one.launchId);

  // Step 1 — the launch record, BEFORE the strategy is called (F122-FR-004).
  steps.push(1);
  writeTheLaunchRecord({
    place: input.place,
    launchId: input.launchId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    requestKind: input.requestKind,
    request: input.request,
    detachStrategy: input.strategy.describe().id,
    launchNonce: nonce,
    engineExecutable: input.engineExecutable,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.host === undefined ? {} : { host: input.host }),
    ...(input.productVersion === undefined ? {} : { productVersion: input.productVersion }),
    now,
  });

  // F122-FR-037 — ticked phases without approval records. The refusal is
  // BEFORE the detach strategy is called and AFTER the launch record is
  // written, which is the only order that satisfies both requirements at once:
  // F122-FR-004 says the record exists before the strategy, and the refusal of
  // this launch is written INTO that record (`cli-state-commands.md`), so there
  // has to be a record to write it into.
  let unadopted: UnadoptedApprovals | undefined;
  if (input.specModel !== undefined) {
    unadopted = unadoptedApprovalsOf(input.place, input.slug, input.specModel);
    if (unadopted.refuse) {
      const refused = report(
        "refused",
        { refusal: UNADOPTED_APPROVALS, detail: unadopted.detail },
        closed,
      );
      return Object.freeze({ ...refused, unadoptedApprovals: unadopted });
    }
  }

  // Step 2 — the detach strategy (F122-FR-005, §F.6).
  steps.push(2);
  const available = input.strategy.available();
  if (!available.available) {
    return report("refused", { refusal: "detach-unavailable", detail: available.reason }, closed);
  }
  try {
    await input.strategy.start({
      runtimeEntry: input.runtimeEntry,
      environmentAllowList: input.environmentAllowList,
      runtimeLogLogicalName: input.runtimeLogLogicalName,
      launchNonce: nonce,
    });
  } catch (error) {
    // §F.6 names two errors; a strategy that threw `not-ready` waited for the
    // handshake itself and did not get it, which is the SAME refusal the wait
    // below would reach. Either way the message names `foreground`.
    const refusal = refusalOfAStrategyError(error);
    return report("refused", { refusal, detail: messageOf(error) }, closed);
  }

  // Step 4 — the bounded wait, the outcome, one line, the exit code.
  steps.push(4);
  const deps = input.deps ?? waitDepsFor(input.place, input.slug, input.runId);
  const waited = await waitForTheLease({
    launchNonce: nonce,
    handshakeLimitSeconds: limit,
    deps,
  });
  if (waited.found === "mine") {
    return report("started", { lease: waited.lease }, closed);
  }
  if (waited.found === "another") {
    return report("attached", { lease: waited.lease }, closed);
  }
  // F122-FR-005 — *a lease that does not appear inside the handshake limit
  // MUST give the outcome `refused`*, and the message names `foreground`.
  return report("refused", { refusal: "detach-not-ready" }, closed);
}

/** Which refusal a thrown strategy error is (§F.6, closed set 210). */
export function refusalOfAStrategyError(error: unknown): LaunchRefusal {
  const named = (error as { error?: unknown } | null)?.error;
  if (named === "not-ready") return "detach-not-ready";
  const refusal = (error as { refusal?: unknown } | null)?.refusal;
  if (refusal === "detach-not-ready") return "detach-not-ready";
  return "detach-unavailable";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The path of a launch record inside a workspace, for a caller that reads one. */
export function recordPathOf(place: HandshakePlace, launchId: string): string {
  return join(launchRecordPathOf(place, launchId));
}
