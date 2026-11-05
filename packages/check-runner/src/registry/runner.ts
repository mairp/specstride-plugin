/**
 * T019 and T066 — the operations of EP-05 and the pin (F148-FR-001), and the
 * operation `environment` (F148-FR-019; proposal P1 of `analyze-report.md`).
 *
 * The runner is HANDLE-BASED with the operations of feature 100, annex C §C.8:
 *
 * | Operation | What it does here |
 * |---|---|
 * | `pin` | Runs at launch for every entry of a check manifest and returns an identity record; for the kind `command` it resolves the executable to an absolute REAL path and records its size and its hash |
 * | `start` | Starts a pinned entry and returns an opaque handle; the command gets a process group of its own |
 * | `poll` | `running` or `ended`, without waiting |
 * | `result` | The result of the command, with the conditions beside the exit result |
 * | `cancel` | Ends the WHOLE process group of the command |
 * | `environment` | The environment a command of the kind `command` gets, without starting a process and without a handle |
 *
 * The kinds of identity are an OPEN registry (`spec.md`, "Closed sets"): Wave
 * 1 registers `command`, and `steps` is an option of a later phase. An entry
 * of a kind that no runner registered is REFUSED at `pin` — that is the
 * unknown-kind rule of F148-FR-001, and it is the reason `pin` runs at launch
 * rather than at the first check.
 *
 * `environment` needs no handle and starts no process, so the detached command
 * that the owner of the verification gate stages and starts with the process
 * primitive of the kernel gets the same environment a command of the check
 * runner gets (F148-FR-019, N-105-1). The check runner never starts such a
 * command itself, because it ends every command at its time limit
 * (F148-FR-004); `DETACHED_IS_NOT_STARTED_HERE` says so as data and
 * `startCommand` of this registry refuses an entry a caller marks detached.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import type {
  CheckHandle,
  CheckRunner,
  ContainmentLevel,
  IdentityKind,
  ManifestEntry,
  PinnedIdentity,
  PollResult,
  StartInput,
} from "@specstride/contracts/ep/check-runner";
import { OPERATIONS, POINT_ID } from "@specstride/contracts/ep/check-runner";
import {
  KIND,
  runCommand,
  startCommand as startTheKindCommand,
  type RunningCommand,
} from "../command/kind-command.ts";
import { commandEnvironment, type EnvironmentOptions } from "../command/environment.ts";
import { cannotStartResult, errorOfAThrow } from "../result/errors.ts";
import { effectiveContainment } from "../command/containment.ts";
import { emptyResult, type RunnerResult } from "../result/result.ts";
import { PARITY_PROFILE } from "../command/environment.ts";

/** The id and the operations this registry implements. */
export const EXTENSION_POINT = POINT_ID;
export const EP05_OPERATIONS = OPERATIONS;

/** The hash the pin records (F148-FR-001). */
export const PIN_HASH = "sha256" as const;

/**
 * F148-FR-019 — the check runner never starts a detached command staged
 * before, because it ends every command at its time limit (F148-FR-004). It
 * gives the ENVIRONMENT of such a command and nothing else.
 */
export const DETACHED_IS_NOT_STARTED_HERE = Object.freeze({
  started: false as const,
  startedBy: "the process primitive of the kernel, called by the owner of the verification gate",
  requirements: Object.freeze(["F148-FR-019", "F105-FR-035", "F100-FR-234"]),
  reason:
    "the check runner ends every command at its time limit (F148-FR-004), so a command that " +
    "outlives the check is not its to start; what this feature supplies is the environment " +
    "(F148-FR-019, N-105-1)",
});

/** One kind of identity a runner registered, with what it can do. */
export type RegisteredKind = {
  readonly kind: string;
  /** `pin` for the kind: the identity record of one entry. */
  readonly pin: (entry: ManifestEntry) => PinnedIdentity;
  /** `start` for the kind. */
  readonly start: (input: ResolvedStart) => RunningCommand;
  /** `environment` for the kind. */
  readonly environment: (
    entry: ManifestEntry,
    profile: string,
    options?: EnvironmentOptions,
  ) => Readonly<Record<string, string>>;
};

/** Everything one start needs, after the registry resolved the pinned entry. */
export type ResolvedStart = {
  readonly entry: ManifestEntry;
  readonly identity: PinnedIdentity;
  readonly workingDirectory: string;
  readonly timeLimitMs: number;
  readonly profile: string;
  readonly maxOutputChars?: number;
  readonly environmentOptions?: EnvironmentOptions;
  /**
   * T028, F148-FR-006 — the containment level `start` received
   * (`StartInput.containment` of EP-05, annex C §C.8) and the level of the
   * proposer, which a command of the verification gate may not go below (row
   * 25). The registry FORWARDS both to the kind and reads neither.
   */
  readonly containment?: ContainmentLevel;
  readonly proposerContainment?: ContainmentLevel;
};

/** Raised where an entry names a kind of identity that no runner registered. */
export class UnknownIdentityKindError extends Error {
  readonly kind: string;
  readonly registered: readonly string[];
  constructor(kind: string, registered: readonly string[]) {
    super(
      `the entry names the kind of identity \`${kind}\`, which no runner registered; the ` +
        `entry is refused at \`pin\` (F148-FR-001). Registered: ` +
        `${registered.map((k) => `\`${k}\``).join(", ")}`,
    );
    this.name = "UnknownIdentityKindError";
    this.kind = kind;
    this.registered = Object.freeze([...registered]);
  }
}

/** Raised where the executable of an entry of the kind `command` cannot be pinned. */
export class PinRefusedError extends Error {
  readonly entryId: string;
  readonly refusal: string;
  constructor(entryId: string, refusal: string) {
    super(`the entry \`${entryId}\` cannot be pinned: ${refusal} (F148-FR-001)`);
    this.name = "PinRefusedError";
    this.entryId = entryId;
    this.refusal = refusal;
  }
}

/** Raised where `start`, `poll`, `result` or `cancel` is given a handle nobody issued. */
export class UnknownHandleError extends Error {
  readonly handleId: string;
  constructor(handleId: string) {
    super(`no check of this runner carries the handle \`${handleId}\` (F148-FR-001)`);
    this.name = "UnknownHandleError";
    this.handleId = handleId;
  }
}

/** Raised where `start` is given an identity that `pin` never returned. */
export class IdentityWasNotPinnedError extends Error {
  readonly executable: string;
  constructor(executable: string) {
    super(
      `\`start\` takes an identity that \`pin\` returned at launch; \`${executable}\` was not ` +
        `pinned by this runner (F148-FR-001)`,
    );
    this.name = "IdentityWasNotPinnedError";
    this.executable = executable;
  }
}

/** The identity record of one entry of the kind `command` (F148-FR-001). */
export function pinACommand(entry: ManifestEntry): PinnedIdentity {
  const argv = [...(entry.argv ?? [])];
  const named = argv[0];
  if (named === undefined || named === "") {
    throw new PinRefusedError(entry.id, "the entry of the kind `command` names no executable");
  }
  let real: string;
  let size: number;
  let hash: string;
  try {
    real = realpathSync(named);
    const stat = statSync(real);
    if (!stat.isFile()) throw new Error(`\`${real}\` is not a file`);
    size = stat.size;
    hash = createHash(PIN_HASH).update(readFileSync(real)).digest("hex");
  } catch (thrown) {
    throw new PinRefusedError(entry.id, thrown instanceof Error ? thrown.message : String(thrown));
  }
  return Object.freeze({
    kind: KIND satisfies IdentityKind,
    executable: real,
    size,
    hash,
    argv: Object.freeze(argv.slice(1)),
  });
}

/** The kind `command`, as the registry holds it. */
export const COMMAND_KIND: RegisteredKind = Object.freeze({
  kind: KIND,
  pin: pinACommand,
  start: (input: ResolvedStart) => startTheKindCommand(input),
  environment: (entry, profile, options) => commandEnvironment(entry, profile, options ?? {}),
});

/** One check this runner started: the handle, the pinned entry and the process. */
type LiveCheck = {
  readonly handle: CheckHandle;
  readonly entry: ManifestEntry;
  readonly running: RunningCommand;
  settledResult: RunnerResult | null;
};

/** The index of a pinned entry, so `start` can find what `pin` recorded. */
function indexOf(identity: PinnedIdentity): string {
  return `${identity.kind}\u0000${identity.executable ?? ""}\u0000${(identity.argv ?? []).join("\u0000")}`;
}

/**
 * The check runner of EP-05. One instance serves every check (F148-FR-005);
 * `theCheckRunner` below is that instance.
 */
export class CheckRunnerRegistry {
  private readonly kinds = new Map<string, RegisteredKind>();
  private readonly pinned = new Map<PinnedIdentity, ManifestEntry>();
  private readonly byIndex = new Map<string, { entry: ManifestEntry; identity: PinnedIdentity }>();
  private readonly live = new Map<string, LiveCheck>();
  private issued = 0;

  constructor(kinds: readonly RegisteredKind[] = [COMMAND_KIND]) {
    for (const kind of kinds) this.kinds.set(kind.kind, kind);
  }

  /** The kinds of identity a runner registered. The set is OPEN. */
  registeredKinds(): readonly string[] {
    return Object.freeze([...this.kinds.keys()].sort());
  }

  /** Register a kind of identity. The registry is open to a new one. */
  register(kind: RegisteredKind): void {
    this.kinds.set(kind.kind, kind);
  }

  /** The kind, or the refusal of F148-FR-001 where no runner registered it. */
  private kindOf(name: string): RegisteredKind {
    const kind = this.kinds.get(name);
    if (kind === undefined) throw new UnknownIdentityKindError(name, this.registeredKinds());
    return kind;
  }

  /**
   * F148-FR-001 — `pin` runs at launch for every entry of a check manifest and
   * returns an identity record. An unknown kind refuses the entry.
   */
  async pin(entry: ManifestEntry): Promise<PinnedIdentity> {
    const identity = this.kindOf(String(entry.kind)).pin(entry);
    this.pinned.set(identity, entry);
    this.byIndex.set(indexOf(identity), { entry, identity });
    return identity;
  }

  /** `pin` over every entry of a manifest, in the order of the manifest. */
  async pinAll(entries: readonly ManifestEntry[]): Promise<readonly PinnedIdentity[]> {
    const out: PinnedIdentity[] = [];
    for (const entry of entries) out.push(await this.pin(entry));
    return Object.freeze(out);
  }

  /** The entry `pin` recorded for an identity, or the refusal. */
  entryOf(identity: PinnedIdentity): ManifestEntry {
    const direct = this.pinned.get(identity);
    if (direct !== undefined) return direct;
    const indexed = this.byIndex.get(indexOf(identity));
    if (indexed !== undefined) return indexed.entry;
    throw new IdentityWasNotPinnedError(String(identity.executable ?? ""));
  }

  /**
   * F148-FR-001 — `start` takes a pinned identity and returns an opaque
   * handle. A runner that throws is treated as `cannot-start`
   * (F148-FR-004): the handle is issued either way and `result` carries the
   * failure, so a caller never has to tell an exception from a result.
   */
  async start(
    input: Omit<StartInput, "containment"> & {
      readonly containment?: ContainmentLevel;
      readonly proposerContainment?: ContainmentLevel;
      readonly profile?: string;
      readonly maxOutputChars?: number;
      readonly environmentOptions?: EnvironmentOptions;
    },
  ): Promise<CheckHandle> {
    const handle: CheckHandle = Object.freeze({ id: `check-${++this.issued}` });
    let entry: ManifestEntry;
    try {
      entry = this.entryOf(input.identity);
    } catch (thrown) {
      this.live.set(handle.id, {
        handle,
        entry: { id: handle.id, kind: "command", argv: [], phase: 0, timeLimitMs: 0 },
        running: settledFailure(handle.id, thrown),
        settledResult: null,
      });
      return handle;
    }
    const resolved: ResolvedStart = {
      entry,
      identity: input.identity,
      workingDirectory: input.workingDirectory,
      timeLimitMs: input.timeLimitMs,
      profile: input.profile ?? "",
      ...(input.maxOutputChars === undefined ? {} : { maxOutputChars: input.maxOutputChars }),
      ...(input.environmentOptions === undefined
        ? {}
        : { environmentOptions: input.environmentOptions }),
      // F148-FR-006 — `start` receives the containment level; the registry
      // hands it to the kind unchanged.
      ...(input.containment === undefined ? {} : { containment: input.containment }),
      ...(input.proposerContainment === undefined
        ? {}
        : { proposerContainment: input.proposerContainment }),
    };
    let running: RunningCommand;
    try {
      running = this.kindOf(String(entry.kind)).start(resolved);
    } catch (thrown) {
      // F148-FR-004 — a runner that throws is treated as `cannot-start`.
      running = settledFailure(entry.id, thrown);
    }
    this.live.set(handle.id, { handle, entry, running, settledResult: null });
    return handle;
  }

  /** The live check of a handle, or the refusal. */
  private checkOf(handle: CheckHandle): LiveCheck {
    const live = this.live.get(handle.id);
    if (live === undefined) throw new UnknownHandleError(handle.id);
    return live;
  }

  /** F148-FR-001 — `poll` says whether the command still runs. It does not wait. */
  async poll(handle: CheckHandle): Promise<PollResult> {
    const live = this.checkOf(handle);
    return live.running.running() ? { state: "running" } : { state: "ended" };
  }

  /** F148-FR-001 — `result` gives the result of the command, once it has ended. */
  async result(handle: CheckHandle): Promise<RunnerResult> {
    const live = this.checkOf(handle);
    if (live.settledResult !== null) return live.settledResult;
    const settled = await live.running.settled;
    live.settledResult = settled;
    return settled;
  }

  /** F148-FR-001 — `cancel` ends the WHOLE process group of the command. */
  async cancel(handle: CheckHandle): Promise<void> {
    this.checkOf(handle).running.cancel("cancel");
  }

  /** The process group of a started check, for a test and for the doctor. */
  processGroupOf(handle: CheckHandle): number | null {
    return this.checkOf(handle).running.processGroup;
  }

  /**
   * T066, F148-FR-019 — the environment a command of the kind `command` gets.
   * No process is started and no handle is needed.
   */
  environment(
    entry: ManifestEntry,
    profile: string,
    options?: EnvironmentOptions,
  ): Readonly<Record<string, string>> {
    return this.kindOf(String(entry.kind)).environment(entry, profile, options);
  }

  /** The handles this runner issued, for a test of its own bookkeeping. */
  handles(): readonly string[] {
    return Object.freeze([...this.live.keys()]);
  }

  /** Run one pinned entry to its end, which is `start` then `result`. */
  async run(
    input: Omit<StartInput, "containment"> & {
      readonly containment?: ContainmentLevel;
      readonly proposerContainment?: ContainmentLevel;
      readonly profile?: string;
      readonly maxOutputChars?: number;
      readonly environmentOptions?: EnvironmentOptions;
    },
  ): Promise<RunnerResult> {
    const handle = await this.start(input);
    return await this.result(handle);
  }
}

/** The level a start that never happened ran at: C0 (row 26, unknown value). */
const LEVEL_WHEN_NO_START = effectiveContainment({});

/** A running command that has already failed: what a throw of a runner becomes. */
function settledFailure(commandId: string, thrown: unknown): RunningCommand {
  const result = cannotStartResult(
    { commandId, executable: "", args: Object.freeze([]), cwd: "", durationMs: 0 },
    thrown,
  );
  const withError = Object.freeze({ ...result, error: errorOfAThrow(thrown) });
  return Object.freeze({
    commandId,
    executable: "",
    args: Object.freeze([]),
    cwd: "",
    processGroup: null,
    pid: null,
    startedAt: Date.now(),
    // A start that never happened ran at no containment at all: C0 by the
    // unknown-value rule of row 26 of annex X §X.6 (F148-FR-006).
    containment: LEVEL_WHEN_NO_START,
    running: () => false,
    endCause: () => "exit" as const,
    settled: Promise.resolve(withError),
    cancel: () => undefined,
  });
}

/**
 * F148-FR-005, `research.md` D-2 — ONE runner for every check. Every caller
 * reads this instance, so a result means the same wherever it was obtained.
 */
export const theCheckRunner = new CheckRunnerRegistry();

/**
 * The registry read as the EP-05 interface. `result` is a SUPERSET of the
 * contract's `CheckResult`: F148-FR-004 requires a result with NO exit code
 * (a time limit, a start error), which the contract's `exitCode: number`
 * cannot carry, so the richer type stands and the narrowing is reported
 * upstream rather than forced here.
 */
export type CheckRunnerOfThisFeature = Omit<CheckRunner, "result"> & {
  result(handle: CheckHandle): Promise<RunnerResult>;
};

/** The one runner, typed as the EP-05 interface it implements. */
export function checkRunner(): CheckRunnerOfThisFeature {
  return theCheckRunner;
}

/** The profile name under which the environment is the baseline's (row 125). */
export { PARITY_PROFILE };

/** An empty result for a command that was never executed, re-exported for a caller. */
export { emptyResult, runCommand };
