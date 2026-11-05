/**
 * T064 — `state export`, `state import` and `state adopt`
 * (F122-FR-033 to F122-FR-036; research D-11, D-12, CQ-139).
 *
 * The lines, the arguments and the exit codes are those of
 * `specs/122-detached-runtime/contracts/cli-state-commands.md`:
 *
 *   | command | line on success | exit |
 *   |---|---|---|
 *   | `state export` | `[SPECSTRIDE-STATE] action=export feature=<slug> approvals=<n> out=<file>` | 0; 1 no state; 3 usage, or `--out` inside the working tree; 5 alive |
 *   | `state import` | `[SPECSTRIDE-STATE] action=import feature=<slug> approvals=<n>` | 0; 1 verification failed, or the target holds approval records; 3 usage, or `--from` inside the working tree; 5 alive |
 *   | `state adopt` | `[SPECSTRIDE-STATE] action=adopt feature=<slug> approvals=<n> from=<old path>` | 0; 1 no control plane for the old path, a record fails verification, or a working tree exists at the old path; 3 usage; 5 alive |
 *
 * and a refusal is one line `[SPECSTRIDE-REFUSE] action=<action> reason=<reason>
 * next=<command>` and nothing else, where `<action>` is `state-export`,
 * `state-import` or `state-adopt`. F122-FR-036: *a command that refuses MUST
 * never print a refusal under `[SPECSTRIDE-STATE]`*. That is kept by shape and
 * not by discipline: `refuse()` below is the only path to a non-zero exit and
 * it prints through `REFUSE_LABEL`, and `succeed()` is the only path that
 * prints through `STATE_LABEL` — it takes no reason and has nowhere to put one.
 *
 * NOTHING IS WRITTEN ON A REFUSED PATH. Every command gathers and verifies
 * first and writes afterwards, and each result carries `wroteNothing` so a
 * test can read the claim and then check the disk itself.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import { isInside } from "@specstride/contracts/ids/roots";
import { atomicWrite, atomicWriteJson } from "@specstride/kernel";
import { DIRECTORY_MODE, FILE_MODE, checkControlRoot } from "../root/control-root.ts";
import { countsAsHeld, probeLock, type ProbeDependencies } from "../lock/probe.ts";
import type { ProbeResult } from "@specstride/contracts/ep/lock";
import { realPathOf, workspaceIdentityOf } from "../lock/workspace-record.ts";
import {
  ARCHIVE_FILE_MODE,
  approvalSignatureIsValid,
  buildArchive,
  compressArchive,
  decompressArchive,
  verifyArchive,
  type ArchiveKeys,
  type ArchiveMembers,
  type StateArchive,
} from "./archive.ts";
import {
  approvalFilesOf,
  approvalPathOf,
  ledgerKeyPathOf,
  ledgerPathOf,
  runIdsOf,
  runLeasePathOf,
  statePathsOf,
  type StatePlace,
} from "./paths.ts";

/* ------------------------------------------------------------------ *
 * The grammar of the three commands (§G.3, §G.4).
 * ------------------------------------------------------------------ */

/** The label of these three commands; no other feature prints it. */
export const STATE_LABEL = "SPECSTRIDE-STATE" as const;

/** The label every refusal is printed under (§G.3). */
export const REFUSE_LABEL = "SPECSTRIDE-REFUSE" as const;

/** F122-FR-036 — a refusal is never printed under `[SPECSTRIDE-STATE]`. */
export const A_REFUSAL_IS_PRINTED_UNDER_THE_STATE_LABEL = false as const;

/** The three actions, as the key `action` of the line carries them. */
export const STATE_ACTIONS = ["export", "import", "adopt"] as const;
export type StateAction = (typeof STATE_ACTIONS)[number];

/** The `action` of a refusal of each command (`cli-state-commands.md`). */
export const REFUSAL_ACTION_OF: Readonly<Record<StateAction, string>> = Object.freeze({
  export: "state-export",
  import: "state-import",
  adopt: "state-adopt",
});

/** The exit codes of annex G §G.4 that these commands use (F122-FR-036). */
export const EXIT_OK = 0 as const;
export const EXIT_NO_STATE_OR_VERIFICATION = 1 as const;
export const EXIT_USAGE = 3 as const;
export const EXIT_ALIVE = 5 as const;

/** Every exit code a state command can answer with, for a test to pin. */
export const STATE_EXIT_CODES = [
  EXIT_OK,
  EXIT_NO_STATE_OR_VERIFICATION,
  EXIT_USAGE,
  EXIT_ALIVE,
] as const;

/** Under this profile no line is printed (§G.3; row 41 of annex X §X.7). */
export const PROFILE_THAT_PRINTS_NO_LINE = "parity" as const;

/** The reasons a state command refuses with. */
export const STATE_REFUSALS = [
  /** `export`: the feature has no state to write (exit 1). */
  "no-state",
  /** `export`: the feature has no approval key, so nothing could sign (exit 1). */
  "no-approval-key",
  /** `export`, `import`: the location lies inside the working tree (exit 3). */
  "location-in-the-working-tree",
  /** Any: a missing or empty argument (exit 3). */
  "usage",
  /** `import`: the archive failed verification (exit 1). */
  "verification-failed",
  /** `import`, `adopt`: the target already holds approval records (exit 1). */
  "target-holds-approvals",
  /** `import`: the archive could not be read at all (exit 1). */
  "unreadable-archive",
  /** `adopt`: no control plane exists for the old path (exit 1). */
  "no-control-plane-for-the-old-path",
  /** `adopt`: an approval record found at the old path fails verification (exit 1). */
  "record-failed-verification",
  /** `adopt`: a working tree still exists at the old path (exit 1). */
  "working-tree-at-the-old-path",
  /** Any: a run of the feature is alive (exit 5). */
  "run-alive",
  /** Any: the control root can be written by another user (exit 3, F122-FR-022). */
  "control-root-unsafe",
  /** Any: the control root cannot be written (exit 3). */
  "control-root-not-writable",
] as const;
export type StateRefusal = (typeof STATE_REFUSALS)[number];

/** The exit code of each refusal (`cli-state-commands.md`). */
export const EXIT_OF_REFUSAL: Readonly<Record<StateRefusal, number>> = Object.freeze({
  "no-state": EXIT_NO_STATE_OR_VERIFICATION,
  "no-approval-key": EXIT_NO_STATE_OR_VERIFICATION,
  "location-in-the-working-tree": EXIT_USAGE,
  usage: EXIT_USAGE,
  "verification-failed": EXIT_NO_STATE_OR_VERIFICATION,
  "target-holds-approvals": EXIT_NO_STATE_OR_VERIFICATION,
  "unreadable-archive": EXIT_NO_STATE_OR_VERIFICATION,
  "no-control-plane-for-the-old-path": EXIT_NO_STATE_OR_VERIFICATION,
  "record-failed-verification": EXIT_NO_STATE_OR_VERIFICATION,
  "working-tree-at-the-old-path": EXIT_NO_STATE_OR_VERIFICATION,
  "run-alive": EXIT_ALIVE,
  "control-root-unsafe": EXIT_USAGE,
  "control-root-not-writable": EXIT_USAGE,
});

/** The command a refusal names as the way out (§G.3, key `next`). */
export function nextForAStateRefusal(reason: StateRefusal, action: StateAction): string {
  switch (reason) {
    case "run-alive":
      return "specstride stop";
    case "location-in-the-working-tree":
      return `specstride state ${action} ${action === "export" ? "--out" : "--from"} <a path outside the working tree>`;
    case "usage":
      return `specstride state ${action} --help`;
    case "working-tree-at-the-old-path":
      // F122-FR-035 — *a cloned tree is served by `state export` and
      // `state import`, which copy*. The way out is named, not implied.
      return "specstride state export";
    case "target-holds-approvals":
      return "specstride state export";
    case "control-root-unsafe":
    case "control-root-not-writable":
    default:
      return "specstride doctor";
  }
}

/* ------------------------------------------------------------------ *
 * Is a run of the feature alive? (F122-FR-036)
 * ------------------------------------------------------------------ */

/** What a reading of liveness answers. */
export type AliveReading = {
  readonly alive: boolean;
  readonly probe: ProbeResult;
  readonly countsAsHeld: boolean;
  /** The run the lock names, where it could be read. */
  readonly runId: string | null;
  readonly because: string;
};

/**
 * F122-FR-036 — *`state export`, `state import` and `state adopt` MUST NOT run
 * while a run of the feature is alive in the workspace they read or write: when
 * a probe counts as held they MUST exit 5 and change nothing.*
 *
 * "A probe counts as held" is asked through `countsAsHeld` of the probe module,
 * which every reader of this product asks, so a state command and a launch can
 * never disagree about whether a run is alive (C-115).
 *
 * Whether the held lock is a run OF THIS FEATURE is then asked of the control
 * plane: the lock of a workspace names its run, and the run directory of that
 * run lies under the feature it belongs to. Where the run cannot be told, the
 * answer stays "alive" — the same direction in which `unknown` counts as held.
 */
export async function aRunOfTheFeatureIsAlive(
  place: StateCommandPlace,
  slug: string,
  dependencies: ProbeDependencies = {},
): Promise<AliveReading> {
  const outcome = await probeLock(
    { controlRoot: place.controlRoot, workspaceRealPath: place.workspaceRealPath },
    dependencies,
  );
  const held = countsAsHeld(outcome.result);
  const runId =
    typeof outcome.reading.owner?.runId === "string" ? outcome.reading.owner.runId : null;
  if (!held) {
    return Object.freeze({
      alive: false,
      probe: outcome.result,
      countsAsHeld: false,
      runId,
      because: `the probe says \`${outcome.result}\`, which does not count as held`,
    });
  }
  if (runId === null) {
    return Object.freeze({
      alive: true,
      probe: outcome.result,
      countsAsHeld: true,
      runId,
      because: `the probe says \`${outcome.result}\` and the lock does not name its run, so it is read as a run of this feature`,
    });
  }
  const ofThisFeature = existsSync(dirname(ledgerPathOf({ ...place }, slug, runId)));
  return Object.freeze({
    alive: ofThisFeature,
    probe: outcome.result,
    countsAsHeld: true,
    runId,
    because: ofThisFeature
      ? `the probe says \`${outcome.result}\` and the run \`${runId}\` it names belongs to \`${slug}\``
      : `the probe says \`${outcome.result}\` but the run \`${runId}\` it names is no run of \`${slug}\``,
  });
}

/**
 * A run of the feature whose LEASE is still valid, read from the control plane
 * alone. `aRunOfTheFeatureIsAlive` asks the lock; this asks the feature, so a
 * caller that holds no lock provider still has an answer, and `state adopt`
 * can ask it of a control plane whose workspace no longer exists.
 */
export function aLeaseOfTheFeatureIsValid(
  place: StateCommandPlace,
  slug: string,
  nowMs: number = Date.now(),
): { readonly valid: boolean; readonly runId: string | null } {
  for (const runId of runIdsOf(place, slug)) {
    let lease: Record<string, unknown>;
    try {
      lease = JSON.parse(readFileSync(runLeasePathOf(place, slug, runId), "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }
    const validUntil = lease["validUntil"];
    if (typeof validUntil !== "string") continue;
    const at = Date.parse(validUntil);
    if (Number.isFinite(at) && at > nowMs) {
      return Object.freeze({ valid: true, runId });
    }
  }
  return Object.freeze({ valid: false, runId: null });
}

/* ------------------------------------------------------------------ *
 * What a command answers.
 * ------------------------------------------------------------------ */

/** Which control plane, which working tree, and where sibling planes lie. */
export type StateCommandPlace = StatePlace & {
  /**
   * The parent of the per-workspace control roots —
   * `$XDG_STATE_HOME/specstride/workspaces` (annex B, roots table). `adopt`
   * finds the plane of the OLD workspace identity under it. Where it is not
   * given, it is the parent of this control root, which is the same directory
   * for every default control root.
   */
  readonly workspacesRoot?: string | undefined;
};

/** What every state command answers. */
export type StateCommandResult = {
  readonly action: StateAction;
  readonly ok: boolean;
  readonly exit: number;
  /** The one line, or `""` under the `parity` profile. */
  readonly line: string;
  readonly refusal?: StateRefusal | undefined;
  /** A line for a log or a test; never printed. */
  readonly detail?: string | undefined;
  readonly feature: string;
  readonly approvals: number;
  readonly out?: string | undefined;
  readonly from?: string | undefined;
  /** True where the command wrote, renamed or removed nothing at all. */
  readonly wroteNothing: boolean;
  /** For `--json`. */
  readonly json: Readonly<Record<string, unknown>>;
};

type Printer = (line: string) => void;

function emit(
  line: string,
  options: { print?: Printer | undefined; profile?: string | undefined },
): string {
  if (options.profile === PROFILE_THAT_PRINTS_NO_LINE) return "";
  (options.print ?? ((text: string): void => void process.stdout.write(text + "\n")))(line);
  return line;
}

function refuse(input: {
  readonly action: StateAction;
  readonly reason: StateRefusal;
  readonly feature: string;
  readonly detail: string;
  readonly print?: Printer | undefined;
  readonly profile?: string | undefined;
  readonly wroteNothing?: boolean | undefined;
}): StateCommandResult {
  const line = printLine(REFUSE_LABEL, {
    action: REFUSAL_ACTION_OF[input.action],
    reason: input.reason,
    next: nextForAStateRefusal(input.reason, input.action),
  });
  const printed = emit(line, { print: input.print, profile: input.profile });
  return Object.freeze({
    action: input.action,
    ok: false,
    exit: EXIT_OF_REFUSAL[input.reason],
    line: printed,
    refusal: input.reason,
    detail: input.detail,
    feature: input.feature,
    approvals: 0,
    wroteNothing: input.wroteNothing ?? true,
    json: Object.freeze({
      action: REFUSAL_ACTION_OF[input.action],
      reason: input.reason,
      next: nextForAStateRefusal(input.reason, input.action),
      feature: input.feature,
      detail: input.detail,
    }),
  });
}

function succeed(input: {
  readonly action: StateAction;
  readonly feature: string;
  readonly approvals: number;
  readonly out?: string | undefined;
  readonly from?: string | undefined;
  readonly detail?: string | undefined;
  readonly print?: Printer | undefined;
  readonly profile?: string | undefined;
}): StateCommandResult {
  const line = printLine(STATE_LABEL, {
    action: input.action,
    feature: input.feature,
    approvals: input.approvals,
    ...(input.out === undefined ? {} : { out: input.out }),
    ...(input.from === undefined ? {} : { from: input.from }),
  });
  const printed = emit(line, { print: input.print, profile: input.profile });
  return Object.freeze({
    action: input.action,
    ok: true,
    exit: EXIT_OK,
    line: printed,
    feature: input.feature,
    approvals: input.approvals,
    ...(input.out === undefined ? {} : { out: input.out }),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    wroteNothing: false,
    json: Object.freeze({
      action: input.action,
      feature: input.feature,
      approvals: input.approvals,
      ...(input.out === undefined ? {} : { out: input.out }),
      ...(input.from === undefined ? {} : { from: input.from }),
    }),
  });
}

/* ------------------------------------------------------------------ *
 * Reading the state of a feature.
 * ------------------------------------------------------------------ */

/** The state of one feature as the archive carries it. */
export type GatheredState = {
  readonly members: ArchiveMembers;
  readonly approvalKey: string | null;
  readonly approvals: number;
  /** Whether anything at all was found. */
  readonly empty: boolean;
};

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJsonLines(path: string): readonly Record<string, unknown>[] {
  const text = readTextOrNull(path);
  if (text === null) return Object.freeze([]);
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // A torn last line is tolerated (F100-FR-199); it carries no record.
    }
  }
  return Object.freeze(out);
}

/**
 * Gather the state of one feature: its approval records, its ledger records in
 * order, its learning log as text, and the keys of CQ-139.
 */
export function gatherState(place: StateCommandPlace, slug: string): GatheredState {
  const paths = statePathsOf(place, slug);
  const approvals: Record<string, unknown>[] = [];
  for (const one of approvalFilesOf(place, slug)) {
    const text = readTextOrNull(one.path);
    if (text === null) continue;
    try {
      approvals.push(JSON.parse(text) as Record<string, unknown>);
    } catch {
      // An unparseable approval record is no approval record; `import` and
      // `adopt` verify every one they install, so carrying a broken one
      // forward would only move the refusal.
    }
  }
  const ledger: Record<string, unknown>[] = [];
  const ledgerKeys: Record<string, string> = {};
  for (const runId of runIdsOf(place, slug)) {
    ledger.push(...readJsonLines(ledgerPathOf(place, slug, runId)));
    const key = readTextOrNull(ledgerKeyPathOf(place, slug, runId));
    if (key !== null) ledgerKeys[runId] = key;
  }
  const learning: Record<string, string> = {};
  const decisions = readTextOrNull(paths.learningDecisionsFile);
  if (decisions !== null) learning["decisions"] = decisions;
  const events = readTextOrNull(paths.learningEventsFile);
  if (events !== null) learning["events"] = events;
  const approvalKey = readTextOrNull(paths.approvalKeyFile);
  const keys: ArchiveKeys = Object.freeze({
    ...(approvalKey === null ? {} : { approval: approvalKey }),
    ...(Object.keys(ledgerKeys).length === 0 ? {} : { ledger: Object.freeze(ledgerKeys) }),
  });
  return Object.freeze({
    members: Object.freeze({
      approvals: Object.freeze(approvals),
      ledger: Object.freeze(ledger),
      learning: Object.freeze(learning),
      keys,
    }),
    approvalKey,
    approvals: approvals.length,
    empty: approvals.length === 0 && ledger.length === 0 && Object.keys(learning).length === 0,
  });
}

/* ------------------------------------------------------------------ *
 * `state export` (F122-FR-033).
 * ------------------------------------------------------------------ */

/** What `state export` is given (`cli-state-commands.md`). */
export type ExportInput = {
  readonly place: StateCommandPlace;
  readonly slug: string;
  /** `--out <file>`. */
  readonly out: string;
  readonly productVersion?: string | undefined;
  readonly profile?: string | undefined;
  readonly print?: Printer | undefined;
  readonly now?: (() => Date) | undefined;
  readonly probeDependencies?: ProbeDependencies | undefined;
  /** A test hands in its own liveness reading. */
  readonly alive?: (() => Promise<AliveReading>) | undefined;
};

/** True where the path lies inside the working tree (F122-FR-033, F122-FR-034). */
export function insideTheWorkingTree(path: string, workspaceRealPath: string): boolean {
  const absolute = isAbsolute(path) ? path : resolvePath(path);
  const tree = realPathOf(workspaceRealPath);
  // The file itself need not exist, so the nearest existing parent is resolved
  // instead: a path under a symbolic link into the tree is inside it too.
  let probe = absolute;
  for (;;) {
    if (existsSync(probe)) break;
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  const real =
    probe === absolute
      ? realPathOf(absolute)
      : join(realPathOf(probe), absolute.slice(probe.length));
  return isInside(real, tree) || isInside(absolute, tree);
}

/**
 * F122-FR-033 — write one archive of one feature, signed, owner-only, and
 * never inside the working tree.
 *
 * The order is the order of the refusals: usage, then the control root, then
 * liveness, then the location, then the state. Liveness is asked BEFORE
 * anything is read out of the plane, so a run that lives is not even observed
 * half-way.
 */
export async function stateExport(input: ExportInput): Promise<StateCommandResult> {
  const say = { print: input.print, profile: input.profile };
  const common = { action: "export" as const, feature: input.slug, ...say };
  if (input.slug.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--feature` is missing" });
  }
  if (input.out.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--out` is missing" });
  }
  const control = theControlRootIsUsable(input.place.controlRoot);
  if (!control.usable) {
    return refuse({ ...common, reason: control.refusal, detail: control.message });
  }
  const alive = await (
    input.alive ??
    ((): Promise<AliveReading> =>
      aRunOfTheFeatureIsAlive(input.place, input.slug, input.probeDependencies ?? {}))
  )();
  if (alive.alive) {
    return refuse({ ...common, reason: "run-alive", detail: alive.because });
  }
  if (insideTheWorkingTree(input.out, input.place.workspaceRealPath)) {
    return refuse({
      ...common,
      reason: "location-in-the-working-tree",
      detail: `\`--out\` ${input.out} lies inside the working tree ${input.place.workspaceRealPath}`,
    });
  }
  const gathered = gatherState(input.place, input.slug);
  if (gathered.empty) {
    return refuse({
      ...common,
      reason: "no-state",
      detail: `the control plane holds no approval record, no ledger record and no learning log for \`${input.slug}\``,
    });
  }
  if (gathered.approvalKey === null || gathered.approvalKey === "") {
    return refuse({
      ...common,
      reason: "no-approval-key",
      detail: "the feature has no approval key, and the archive is signed with it (CQ-139)",
    });
  }
  const archive = buildArchive({
    feature: input.slug,
    workspaceId: workspaceIdentityOf(input.place.workspaceRealPath),
    productVersion: input.productVersion ?? "0.0.0",
    createdAt: (input.now ?? ((): Date => new Date()))(),
    members: gathered.members,
    approvalKey: gathered.approvalKey,
  });
  writeArchiveFile(input.out, archive);
  return succeed({
    action: "export",
    feature: input.slug,
    approvals: gathered.approvals,
    out: input.out,
    detail: `${String(gathered.members.ledger.length)} ledger records`,
    ...say,
  });
}

/**
 * F122-FR-033 — *the archive MUST be readable and writable by its owner only*.
 *
 * The temporary file is created with `ARCHIVE_FILE_MODE` and renamed into
 * place, so the archive never exists under its final name half-written, and
 * never exists at all with wider bits. The mode is then SET, not only asked
 * for: a process whose umask clears the owner's write bit would otherwise
 * leave an archive its owner cannot write.
 */
export function writeArchiveFile(path: string, archive: StateArchive): string {
  const absolute = isAbsolute(path) ? path : resolvePath(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${randomBytes(6).toString("hex")}`;
  writeFileSync(temporary, compressArchive(archive), { mode: ARCHIVE_FILE_MODE });
  chmodSync(temporary, ARCHIVE_FILE_MODE);
  renameSync(temporary, absolute);
  chmodSync(absolute, ARCHIVE_FILE_MODE);
  return absolute;
}

/* ------------------------------------------------------------------ *
 * `state import` (F122-FR-034).
 * ------------------------------------------------------------------ */

/** What `state import` is given. */
export type ImportInput = {
  readonly place: StateCommandPlace;
  readonly slug: string;
  /** `--from <file>`. */
  readonly from: string;
  readonly profile?: string | undefined;
  readonly print?: Printer | undefined;
  readonly probeDependencies?: ProbeDependencies | undefined;
  readonly alive?: (() => Promise<AliveReading>) | undefined;
};

/**
 * F122-FR-034 — verify the signature of the archive, the hash of every member
 * and the signature of every approval record BEFORE anything is written;
 * refuse an archive that fails, an archive read from inside the working tree,
 * and a target that already holds approval records of the feature; a refusal
 * exits 1 and changes nothing.
 */
export async function stateImport(input: ImportInput): Promise<StateCommandResult> {
  const say = { print: input.print, profile: input.profile };
  const common = { action: "import" as const, feature: input.slug, ...say };
  if (input.slug.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--feature` is missing" });
  }
  if (input.from.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--from` is missing" });
  }
  const control = theControlRootIsUsable(input.place.controlRoot);
  if (!control.usable) {
    return refuse({ ...common, reason: control.refusal, detail: control.message });
  }
  const alive = await (
    input.alive ??
    ((): Promise<AliveReading> =>
      aRunOfTheFeatureIsAlive(input.place, input.slug, input.probeDependencies ?? {}))
  )();
  if (alive.alive) {
    return refuse({ ...common, reason: "run-alive", detail: alive.because });
  }
  if (insideTheWorkingTree(input.from, input.place.workspaceRealPath)) {
    return refuse({
      ...common,
      reason: "location-in-the-working-tree",
      detail: `\`--from\` ${input.from} lies inside the working tree ${input.place.workspaceRealPath}`,
    });
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(isAbsolute(input.from) ? input.from : resolvePath(input.from));
  } catch (error) {
    return refuse({
      ...common,
      reason: "unreadable-archive",
      detail: `the archive could not be read (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  const read = decompressArchive(bytes);
  if (!read.ok) {
    return refuse({
      ...common,
      reason: "verification-failed",
      detail: `${read.refusal}: ${read.detail}`,
    });
  }
  const verified = verifyArchive(read.archive);
  if (!verified.ok) {
    return refuse({
      ...common,
      reason: "verification-failed",
      detail: verified.failures.map((one) => `${one.failure}: ${one.detail}`).join("; "),
    });
  }
  // F122-FR-034 — *a target that already holds approval records of the
  // feature*. Asked of the DISK and not of this process's idea of the plane.
  const already = approvalFilesOf(input.place, input.slug);
  if (already.length > 0) {
    return refuse({
      ...common,
      reason: "target-holds-approvals",
      detail: `the target already holds ${String(already.length)} approval record(s) of \`${input.slug}\``,
    });
  }
  installMembers(input.place, input.slug, read.archive);
  return succeed({
    action: "import",
    feature: input.slug,
    approvals: verified.approvals,
    detail: `installed into ${input.place.controlRoot}`,
    ...say,
  });
}

/**
 * Install the members of a verified archive into the control plane of the
 * workspace in which `import` runs (F122-FR-034). Every record goes to the
 * path of its logical name, so an archive made in one layout lands in this
 * layout's places and not in the old ones.
 */
export function installMembers(
  place: StateCommandPlace,
  slug: string,
  archive: StateArchive,
): readonly string[] {
  const paths = statePathsOf(place, slug);
  const written: string[] = [];
  mkdirSync(paths.featureDirectory, { recursive: true, mode: DIRECTORY_MODE });
  for (const record of archive.members.approvals) {
    const phase = (record as Record<string, unknown>)["phase"];
    const path = approvalPathOf(place, slug, String(phase));
    atomicWriteJson(path, record, { mode: FILE_MODE, createDirectory: true });
    written.push(path);
  }
  // The ledger is one stream per run; the archive carries it flat and in
  // order, so it is grouped by the run each record names.
  const byRun = new Map<string, Record<string, unknown>[]>();
  for (const record of archive.members.ledger) {
    const runId = String((record as Record<string, unknown>)["runId"] ?? "");
    if (runId === "") continue;
    const list = byRun.get(runId) ?? [];
    list.push(record as Record<string, unknown>);
    byRun.set(runId, list);
  }
  for (const [runId, records] of byRun) {
    const path = ledgerPathOf(place, slug, runId);
    atomicWrite(path, records.map((one) => JSON.stringify(one)).join("\n") + "\n", {
      mode: FILE_MODE,
      createDirectory: true,
    });
    written.push(path);
  }
  const learning = archive.members.learning;
  if (typeof learning["decisions"] === "string") {
    atomicWrite(paths.learningDecisionsFile, learning["decisions"], {
      mode: FILE_MODE,
      createDirectory: true,
    });
    written.push(paths.learningDecisionsFile);
  }
  if (typeof learning["events"] === "string") {
    atomicWrite(paths.learningEventsFile, learning["events"], {
      mode: FILE_MODE,
      createDirectory: true,
    });
    written.push(paths.learningEventsFile);
  }
  const keys = archive.members.keys;
  if (keys?.approval !== undefined) {
    atomicWrite(paths.approvalKeyFile, keys.approval, { mode: FILE_MODE, createDirectory: true });
    written.push(paths.approvalKeyFile);
  }
  for (const [runId, key] of Object.entries(keys?.ledger ?? {})) {
    const path = ledgerKeyPathOf(place, slug, runId);
    atomicWrite(path, key, { mode: FILE_MODE, createDirectory: true });
    written.push(path);
  }
  return Object.freeze(written);
}

/* ------------------------------------------------------------------ *
 * `state adopt` (F122-FR-035; research D-12).
 * ------------------------------------------------------------------ */

/** What `state adopt` is given. */
export type AdoptInput = {
  readonly place: StateCommandPlace;
  readonly slug: string;
  /** `--from <old path>`: the path the working tree had before it moved. */
  readonly from: string;
  readonly profile?: string | undefined;
  readonly print?: Printer | undefined;
  readonly probeDependencies?: ProbeDependencies | undefined;
  readonly alive?: (() => Promise<AliveReading>) | undefined;
};

/**
 * D-12 — the control plane of an OLD path of the same tree.
 *
 * The old workspace identity is derived from the path TEXT, without needing
 * the path to exist, which is the whole point: the tree has moved, so the old
 * path is gone. Every default control root is a sibling under
 * `$XDG_STATE_HOME/specstride/workspaces`, so the plane of the old identity is
 * found next to this one.
 */
export function oldControlRootOf(
  place: StateCommandPlace,
  oldPath: string,
): {
  readonly controlRoot: string;
  readonly workspaceId: string;
} {
  const workspaceId = workspaceIdentityOf(oldPath);
  const siblings = place.workspacesRoot ?? dirname(place.controlRoot);
  return Object.freeze({ controlRoot: join(siblings, workspaceId), workspaceId });
}

/** F122-FR-035 — a working tree still exists at the old path. */
export function aWorkingTreeExistsAt(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What a verification of the approval records of a plane answers. */
export type ApprovalVerification = {
  readonly ok: boolean;
  readonly checked: number;
  readonly failures: readonly string[];
};

/**
 * F122-FR-035 — *MUST verify every approval record found there*. Every one,
 * and with the approval key of that plane: a record signed with another key is
 * not a record this product wrote (F100-FR-070).
 */
export function verifyApprovalsOf(place: StateCommandPlace, slug: string): ApprovalVerification {
  const paths = statePathsOf(place, slug);
  const key = readTextOrNull(paths.approvalKeyFile);
  const files = approvalFilesOf(place, slug);
  if (key === null || key === "") {
    return Object.freeze({
      ok: files.length === 0,
      checked: 0,
      failures:
        files.length === 0
          ? Object.freeze([])
          : Object.freeze([
              `${String(files.length)} approval record(s) and no approval key to verify them with`,
            ]),
    });
  }
  const failures: string[] = [];
  let checked = 0;
  for (const one of files) {
    const text = readTextOrNull(one.path);
    if (text === null) {
      failures.push(`phase ${String(one.phase)}: the record could not be read`);
      continue;
    }
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(text) as Record<string, unknown>;
    } catch {
      failures.push(`phase ${String(one.phase)}: the record is no JSON document`);
      continue;
    }
    checked += 1;
    if (!approvalSignatureIsValid(record, key)) {
      failures.push(`phase ${String(one.phase)}: the signature does not match the approval key`);
    }
  }
  return Object.freeze({
    ok: failures.length === 0,
    checked,
    failures: Object.freeze(failures),
  });
}

/**
 * F122-FR-035 — take over the control plane of an old path of the same tree,
 * by MOVING it, so that two workspaces never share a mutable file
 * (F100-FR-032). Across file systems the move copies, verifies and then
 * removes the source (D-12).
 */
export async function stateAdopt(input: AdoptInput): Promise<StateCommandResult> {
  const say = { print: input.print, profile: input.profile };
  const common = { action: "adopt" as const, feature: input.slug, ...say };
  if (input.slug.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--feature` is missing" });
  }
  if (input.from.trim() === "") {
    return refuse({ ...common, reason: "usage", detail: "`--from` is missing" });
  }
  const control = theControlRootIsUsable(input.place.controlRoot);
  if (!control.usable) {
    return refuse({ ...common, reason: control.refusal, detail: control.message });
  }
  const old = oldControlRootOf(input.place, input.from);
  const oldPlace: StateCommandPlace = Object.freeze({
    controlRoot: old.controlRoot,
    workspaceRealPath: input.from,
    ...(input.place.workspacesRoot === undefined
      ? {}
      : { workspacesRoot: input.place.workspacesRoot }),
  });
  // F122-FR-036 — alive in the workspace it READS or WRITES: both planes.
  const alive = await (
    input.alive ??
    ((): Promise<AliveReading> =>
      aRunOfTheFeatureIsAlive(input.place, input.slug, input.probeDependencies ?? {}))
  )();
  if (alive.alive) {
    return refuse({ ...common, reason: "run-alive", detail: alive.because });
  }
  const oldLease = aLeaseOfTheFeatureIsValid(oldPlace, input.slug);
  if (oldLease.valid) {
    return refuse({
      ...common,
      reason: "run-alive",
      detail: `the plane of the old path holds a valid lease of the run \`${String(oldLease.runId)}\``,
    });
  }
  const oldPaths = statePathsOf(oldPlace, input.slug);
  if (!existsSync(oldPaths.featureDirectory)) {
    return refuse({
      ...common,
      reason: "no-control-plane-for-the-old-path",
      detail: `no control plane for \`${input.from}\` (workspace ${old.workspaceId}) holds \`${input.slug}\``,
    });
  }
  // F122-FR-035 — *a cloned tree is served by `state export` and
  // `state import`, which copy*: a tree at the old path means this is a clone
  // and not a move, and `adopt` moves.
  if (aWorkingTreeExistsAt(input.from)) {
    return refuse({
      ...common,
      reason: "working-tree-at-the-old-path",
      detail: `a working tree still exists at \`${input.from}\`; a clone is served by \`state export\` and \`state import\``,
    });
  }
  const before = verifyApprovalsOf(oldPlace, input.slug);
  if (!before.ok) {
    return refuse({
      ...common,
      reason: "record-failed-verification",
      detail: before.failures.join("; "),
    });
  }
  const already = approvalFilesOf(input.place, input.slug);
  if (already.length > 0) {
    return refuse({
      ...common,
      reason: "target-holds-approvals",
      detail: `the target already holds ${String(already.length)} approval record(s) of \`${input.slug}\`; nothing is overwritten`,
    });
  }
  const here = statePathsOf(input.place, input.slug);
  moveDirectory(oldPaths.featureDirectory, here.featureDirectory);
  // Read the result back through the independent path: the records are
  // verified AGAIN where they now lie, so the claim that every approval
  // verifies is about the new plane and not about the old one.
  const after = verifyApprovalsOf(input.place, input.slug);
  if (!after.ok) {
    return refuse({
      ...common,
      reason: "record-failed-verification",
      detail: `after the move: ${after.failures.join("; ")}`,
      wroteNothing: false,
    });
  }
  return succeed({
    action: "adopt",
    feature: input.slug,
    approvals: after.checked,
    from: input.from,
    detail: `moved ${oldPaths.featureDirectory} to ${here.featureDirectory}`,
    ...say,
  });
}

/**
 * Move a directory. `rename` where the two lie on one file system — one atomic
 * step, and the source is gone by construction. Across file systems (`EXDEV`)
 * it copies, then removes the source, so that no mutable file is left shared
 * (F100-FR-032, D-12).
 */
export function moveDirectory(source: string, target: string): "renamed" | "copied" {
  mkdirSync(dirname(target), { recursive: true, mode: DIRECTORY_MODE });
  if (!existsSync(target)) {
    try {
      renameSync(source, target);
      return "renamed";
    } catch (error) {
      if ((error as { code?: string }).code !== "EXDEV") throw error;
    }
    cpSync(source, target, { recursive: true, preserveTimestamps: true });
    rmSync(source, { recursive: true, force: true });
    return "copied";
  }
  // The target directory exists but holds no approval record of the feature
  // (that was refused above). Its entries are moved one by one.
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(target, name);
    if (existsSync(to) && statSync(from).isDirectory() && statSync(to).isDirectory()) {
      moveDirectory(from, to);
      continue;
    }
    try {
      renameSync(from, to);
    } catch (error) {
      if ((error as { code?: string }).code !== "EXDEV") throw error;
      cpSync(from, to, { recursive: true, preserveTimestamps: true });
      rmSync(from, { recursive: true, force: true });
    }
  }
  rmSync(source, { recursive: true, force: true });
  return "renamed";
}

/** The three commands, by the action they print. */
export const STATE_COMMANDS = Object.freeze({
  export: stateExport,
  import: stateImport,
  adopt: stateAdopt,
});

/* ------------------------------------------------------------------ *
 * The control root, for a state command (F122-FR-022, F122-FR-039).
 * ------------------------------------------------------------------ */

/** What the control-root guard of a state command answers. */
export type ControlRootGuard =
  | { readonly usable: true }
  | { readonly usable: false; readonly refusal: StateRefusal; readonly message: string };

/**
 * F122-FR-022 — *a control root that can be written by another user refuses a
 * state command with `control-root-unsafe` and exit 3*. The check of T015 is
 * asked, with one difference: a control root that does NOT EXIST is not
 * created here. `checkControlRoot` creates one, because a launch is about to
 * write into it; a state command that would then refuse with `no-state` must
 * leave the disk as it found it, which is what `wroteNothing` claims.
 */
export function theControlRootIsUsable(controlRoot: string): ControlRootGuard {
  if (!existsSync(controlRoot)) {
    // Nothing to be unsafe about, and nothing is created. `export` answers
    // `no-state` below; `import` and `adopt` create the plane as they write.
    return Object.freeze({ usable: true as const });
  }
  const check = checkControlRoot(controlRoot, "cli");
  if (check.usable) return Object.freeze({ usable: true as const });
  return Object.freeze({
    usable: false as const,
    refusal: (check.refusal ?? "control-root-not-writable") as StateRefusal,
    message: check.message,
  });
}
