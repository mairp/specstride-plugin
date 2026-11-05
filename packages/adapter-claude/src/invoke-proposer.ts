/**
 * T013 + T015 — the builders of the calls of the Claude harness adapter.
 *
 * T013 (F125-FR-009, F125-FR-012 to F125-FR-013, F125-FR-023): the argument
 * table lives as DATA in `data/argument-table.json`; this module only reads
 * it and assembles the list for the profile `parity` and for the default
 * profile, per role and per auth tier. An argument list is a list of
 * strings, never shell text (F125-FR-002).
 *
 * T015 (F125-FR-020, F125-FR-021): the environment of EVERY call is an
 * allow-list, and every call starts in a process group of its own, with the
 * three stops of the port. Every function that signals a group refuses an
 * id that is not an integer above one (owner ruling 2026-10-02).
 */
import { rmSync, writeFileSync } from "node:fs";
import argumentTable from "../data/argument-table.json" with { type: "json" };
import modelsTable from "../data/models.json" with { type: "json" };
import { HIDDEN_FLAGS, flagAvailability } from "./detect.ts";

/* The stops of the port live in their own module since T033; this module
 * re-exports them so the seam of the package stays where it was. */
export {
  KILL_SIGNAL,
  POLITE_GRACE_MS,
  POLITE_STOP_SIGNAL,
  PROCESS_GROUP_SPAWN_OPTIONS,
  STOP_KINDS,
  TERMINATED_EXIT_CODE,
  TERMINATE_SIGNAL,
  ProcessGroupRefusedError,
  exitIsProviderFailure,
  pgidIsValid,
  stopCall,
} from "./stop.ts";
export type { GroupSignaller, StopKind } from "./stop.ts";

export { argumentTable };

/** The pin the argument table carries. */
export const ARGUMENT_TABLE_PIN = argumentTable.pin;

/** The roles of the harness adapter. */
export const CALL_ROLES = ["proposer", "critic"] as const;
export type CallRole = (typeof CALL_ROLES)[number];

/** The condition keys the table's `when` cells use. */
export type EntryWhen =
  | "always"
  | "skillsOff"
  | "streamOn"
  | "modelSet"
  | "effortSet"
  | "sessionFresh"
  | "sessionContinue"
  | "containmentC2"
  | "consumerBypassWithPrecondition"
  | "budgetSet"
  | "versionFloorMet"
  | "criticSystemPrompt";

type Entry = {
  readonly argv: readonly string[];
  readonly when: EntryWhen;
  readonly value?: string;
};

/** Why a call was not built. */
export type InvokeRefusalReason =
  "empty-session-id" | "bypass-precondition" | "forbidden-argument" | "unknown-placeholder";

/** The error a refused call carries. */
export class InvokeRefusedError extends Error {
  readonly reason: InvokeRefusalReason;

  constructor(reason: InvokeRefusalReason, message: string) {
    super(message);
    this.name = "InvokeRefusedError";
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ *
 * T013 — the builders.
 * ------------------------------------------------------------------ */

/** The inputs every builder reads. */
export type BuildInput = {
  readonly role: CallRole;
  /** `parity` or `default`. */
  readonly profile: "parity" | "default";
  readonly authTier: 1 | 2;
  /** The slash-command skills of the harness are on (F125-FR-010 opt-in). */
  readonly proposerSkills?: boolean;
  /** The stream tap or the JSON output is on. */
  readonly streamOn?: boolean;
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly sessionId?: string | null;
  /** `fresh` or `continue`; default follows the auth tier (F125-FR-014). */
  readonly sessionMode?: "fresh" | "continue";
  /** The allow list of the tools (F125-FR-012). */
  readonly allowedTools?: readonly string[];
  /** The effort budget cap of a critic call (F125-FR-023). */
  readonly budgetUsd?: number | null;
  /** The critic's system prompt file, where feature 117 supplies one. */
  readonly criticSystemPromptFile?: string | null;
  /** True where the platform offers the harness's command sandbox (C2). */
  readonly containmentC2?: boolean;
  /** The consumer's choice of the bypass mode in USER configuration only. */
  readonly consumerBypass?: boolean;
  /** The preconditions of the bypass mode, detected by the doctor. */
  readonly bypassPrecondition?: { sandbox: boolean; userIsRoot: boolean };
  /** The version of the executable the pass recorded (F125-FR-003). */
  readonly version?: string | null;
  /** The capability list of the initial record, where it has one (F125-FR-003). */
  readonly capabilityList?: readonly string[] | null;
};

/** The conditions one entry may carry, resolved from the input. */
function conditionHolds(when: EntryWhen, input: BuildInput): boolean {
  switch (when) {
    case "always":
      return true;
    case "skillsOff":
      return input.proposerSkills !== true;
    case "streamOn":
      return input.streamOn === true;
    case "modelSet":
      return typeof input.model === "string" && input.model !== "";
    case "effortSet":
      return typeof input.effort === "string" && input.effort !== "";
    case "sessionFresh":
      return (input.sessionMode ?? "fresh") === "fresh";
    case "sessionContinue":
      return input.sessionMode === "continue";
    case "containmentC2":
      return input.containmentC2 === true;
    case "consumerBypassWithPrecondition":
      return (
        input.consumerBypass === true &&
        input.bypassPrecondition?.sandbox === true &&
        input.bypassPrecondition?.userIsRoot === false
      );
    case "budgetSet":
      return typeof input.budgetUsd === "number" && Number.isFinite(input.budgetUsd);
    case "versionFloorMet":
      // The floor gates the hidden flags (F125-FR-003); `assemble` applies
      // that gate to the entry itself, and every other use of this
      // condition names no hidden flag.
      return true;
    case "criticSystemPrompt":
      return (
        typeof input.criticSystemPromptFile === "string" && input.criticSystemPromptFile !== ""
      );
  }
}

/** The values the placeholders of the table resolve to. */
function placeholderValue(name: string, input: BuildInput, settingsJson: string): string {
  switch (name) {
    case "model":
      return input.model ?? "";
    case "effort":
      return input.effort ?? "";
    case "sessionId":
      return input.sessionId ?? "";
    case "allowedTools":
      return (input.allowedTools ?? []).join(",");
    case "budget":
      return input.budgetUsd === undefined || input.budgetUsd === null
        ? ""
        : String(input.budgetUsd);
    case "systemPromptFile":
      return input.criticSystemPromptFile ?? "";
    case "settings":
      return settingsJson;
    default:
      throw new InvokeRefusedError(
        "unknown-placeholder",
        `the placeholder {${name}} is not in the closed set`,
      );
  }
}

/** Assembles one table section into an argument list. */
function assemble(entries: readonly Entry[], input: BuildInput, settingsJson: string): string[] {
  const argv: string[] = [];
  for (const entry of entries) {
    if (!conditionHolds(entry.when, input)) continue;
    // F125-FR-003: a flag the help does not list is gated by the version
    // floor, and the capability list of the initial record decides over any
    // comparison of versions — whatever `when` the entry carries.
    const flag = entry.argv[0] ?? "";
    if (
      (HIDDEN_FLAGS as readonly string[]).includes(flag) &&
      !flagAvailability({
        flag,
        version: input.version ?? null,
        capabilityList: input.capabilityList ?? null,
      }).available
    ) {
      continue;
    }
    argv.push(
      ...entry.argv.map((argument) =>
        argument.replace(/\{([^{}]+)\}/g, (_match, name: string) =>
          placeholderValue(name, input, settingsJson),
        ),
      ),
    );
  }
  return argv;
}

/** The section of the table the input names. */
function tableSection(input: BuildInput): readonly Entry[] {
  if (input.profile === "parity") {
    return argumentTable.profiles.parity.entries as readonly Entry[];
  }
  if (input.role === "proposer") {
    const tier = input.authTier === 1 ? "tier1" : "tier2";
    return argumentTable.profiles.default.proposer[tier] as readonly Entry[];
  }
  return argumentTable.profiles.default.critic.tier1 as readonly Entry[];
}

/** The sandbox settings the table carries for containment C2. */
const SANDBOX_SETTINGS =
  (argumentTable.profiles.default.proposer.tier1 as readonly Entry[]).find(
    (entry) => entry.when === "containmentC2",
  )?.value ?? "{}";

const FORBIDDEN = argumentTable.never as readonly string[];

/** Refuses an argument list that carries a forbidden argument (D-7, F125-FR-025). */
function assertNoForbiddenArgument(argv: readonly string[]): void {
  for (const argument of argv) {
    if (FORBIDDEN.includes(argument)) {
      throw new InvokeRefusedError(
        "forbidden-argument",
        `refused the call: the argument "${argument}" is on the never list of the argument table`,
      );
    }
  }
}

/**
 * Builds the argument list of a proposer call (F125-FR-009 under `parity`;
 * F125-FR-012 to F125-FR-014 under the default profile).
 *
 * Refusals:
 *  - a `continue` directive with an empty session id (F125-FR-004);
 *  - the bypass mode where the consumer chose it but the precondition does
 *    not hold (F125-FR-012) — no silent fallback to another mode;
 *  - at auth tier 1, a `continue` directive: continuation is off there
 *    (F125-FR-014) and the call carries `--no-session-persistence`.
 */
export function buildProposerArgv(input: BuildInput): readonly string[] {
  if (input.profile !== "parity") {
    // Under `parity` the as-is list carries no session behaviour at all.
    if (input.sessionMode === "continue") {
      if (input.authTier === 1) {
        throw new InvokeRefusedError(
          "empty-session-id",
          "refused the call: continuation is not in force at auth tier 1 (F125-FR-014)",
        );
      }
      if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") {
        throw new InvokeRefusedError(
          "empty-session-id",
          "refused the call: a continuation with an empty session id would open the " +
            "interactive picker of the CLI (F125-FR-004)",
        );
      }
    }
    if (
      input.consumerBypass === true &&
      !(
        input.bypassPrecondition?.sandbox === true && input.bypassPrecondition?.userIsRoot === false
      )
    ) {
      const missing = input.bypassPrecondition?.sandbox
        ? "the user is root"
        : "no sandbox detected";
      throw new InvokeRefusedError(
        "bypass-precondition",
        `refused the launch: the consumer chose the bypass mode but ${missing} (F125-FR-012)`,
      );
    }
  }
  const argv = assemble(tableSection(input), input, SANDBOX_SETTINGS);
  assertNoForbiddenArgument(argv);
  return Object.freeze(argv);
}

/**
 * Builds the argument list of a critic-class call at auth tier 1
 * (F125-FR-023): a minted session id, no tool, one turn, a mode that denies
 * and never asks, and NEVER a resume, continue, fork or bypass argument.
 */
export function buildCriticArgv(input: BuildInput): readonly string[] {
  if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") {
    throw new InvokeRefusedError(
      "empty-session-id",
      "refused the critic call: its fresh session id is empty (F125-FR-023)",
    );
  }
  const argv = assemble(
    tableSection({ ...input, role: "critic", profile: input.profile }),
    input,
    SANDBOX_SETTINGS,
  );
  assertNoForbiddenArgument(argv);
  return Object.freeze(argv);
}

/* ------------------------------------------------------------------ *
 * T080 — the consumer's choice of the bypass mode (F125-FR-012, CQ-183).
 * ------------------------------------------------------------------ */

/** The value of `sandbox.permissionMode` that names the bypass mode. */
export const BYPASS_PERMISSION_MODE = "bypassPermissions";

/**
 * The sources a pass may carry for the bypass choice. The key is
 * `sandbox.permissionMode`, read from USER configuration ONLY (CQ-183: the
 * same value in the environment, on the command line or in project
 * configuration is NOT a choice of the consumer for this opt-out of
 * containment). The harness adapter never selects the mode by itself: with
 * no such value in user configuration the choice is `none` and the mode
 * stays `acceptEdits`.
 */
export type BypassModeSources = {
  /** User configuration (`~/.specstride/config.json` or equivalent). */
  readonly userConfiguration?: {
    readonly sandbox?: { readonly permissionMode?: string | null };
  } | null;
  /** The environment. Read ONLY to be ignored (CQ-183). */
  readonly environment?: Readonly<Record<string, string | undefined>> | null;
  /** A flag of the command line. Read ONLY to be ignored (CQ-183). */
  readonly flag?: string | null;
  /** Project configuration (the workspace's own). Read ONLY to be ignored. */
  readonly projectConfiguration?: {
    readonly sandbox?: { readonly permissionMode?: string | null };
  } | null;
};

/** What the resolution of the bypass choice concluded. */
export type BypassModeChoice =
  | { readonly bypass: false; readonly source: "none"; readonly mode: "acceptEdits" }
  | {
      readonly bypass: true;
      readonly source: "user-configuration";
      readonly mode: typeof BYPASS_PERMISSION_MODE;
    };

/**
 * Resolves the bypass mode from the sources a pass may carry (F125-FR-012,
 * CQ-183): ONLY a `sandbox.permissionMode` of user configuration that names
 * the bypass mode turns it on. The same value in the environment, on the
 * command line or in project configuration is not taken; the harness
 * adapter never selects the mode by itself. The precondition (a sandbox
 * detected, a user other than root) is checked later, at
 * `buildProposerArgv`, which refuses the launch where it fails.
 */
export function resolveBypassModeChoice(sources: BypassModeSources): BypassModeChoice {
  const value = sources.userConfiguration?.sandbox?.permissionMode;
  if (typeof value === "string" && value === BYPASS_PERMISSION_MODE) {
    return Object.freeze({
      bypass: true,
      source: "user-configuration",
      mode: BYPASS_PERMISSION_MODE,
    });
  }
  return Object.freeze({ bypass: false, source: "none", mode: "acceptEdits" });
}

/** True when the list carries no argument that resumes, continues or forks. */
export function carriesNoSessionContinuation(argv: readonly string[]): boolean {
  return !argv.some(
    (argument) =>
      argument === "--resume" || argument === "--continue" || argument === "--fork-session",
  );
}

/* ------------------------------------------------------------------ *
 * T015 — the environment allow-list of every call (F125-FR-020).
 * ------------------------------------------------------------------ */
/** The base allow-list: search path, locale, home (F125-FR-020). */
export const BASE_ALLOW_LIST = ["PATH", "LANG", "LC_ALL", "HOME"] as const;

/** The names `isolation.envAllow` of the descriptor adds. */
export const DESCRIPTOR_ENV_ALLOW = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
  "TRACEPARENT",
] as const;

/** The proposer's auth variables and the critic's, which never cross. */
export const CREDENTIAL_VARS: Readonly<Record<CallRole, readonly string[]>> = Object.freeze({
  proposer: ["CLAUDE_CODE_OAUTH_TOKEN"],
  critic: ["SPECSTRIDE_CLAUDE_CRITIC_API_KEY", "ANTHROPIC_API_KEY"],
});

/** The exact allow-list of the `parity` profile (F125-FR-007, F125-FR-020). */
export const PARITY_ENV_ALLOW = [...BASE_ALLOW_LIST, "SPECSTRIDE_STDIN_FILE"] as const;

/** What the environment builder reads. */
export type EnvironmentInput = {
  readonly role: CallRole;
  readonly profile: "parity" | "default";
  readonly authTier: 1 | 2;
  /** The consumer's real environment; read only through the list. */
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  /** The throwaway home of an auth tier 2 call (F125-FR-017). */
  readonly throwawayHome?: string | null;
  /** Native memory off (F125-FR-018): on for the critic, opt-in for the proposer. */
  readonly memoryOff?: boolean;
  /** Credentials scrubbed from tool commands (F125-FR-020, opt-in). */
  readonly subprocessEnvScrub?: boolean;
  /** The trace parent of the pass (never under `parity`). */
  readonly traceparent?: string | null;
  /** Extra names the descriptor names (F125-FR-020). */
  readonly extraAllowed?: readonly string[];
};

/**
 * The names the call may read, as data. The credentials of the OTHER role
 * are never on the list (F125-FR-020); at auth tier 2 `CLAUDE_CONFIG_DIR`
 * is the throwaway home and no subscription token is carried (F125-FR-017).
 */
export function environmentAllowList(input: {
  readonly role: CallRole;
  readonly profile: "parity" | "default";
  readonly authTier: 1 | 2;
  readonly extraAllowed?: readonly string[];
}): readonly string[] {
  if (input.profile === "parity") {
    return PARITY_ENV_ALLOW;
  }
  const own = CREDENTIAL_VARS[input.role];
  const others = CALL_ROLES.filter((role) => role !== input.role).flatMap(
    (role) => CREDENTIAL_VARS[role],
  );
  const names = new Set<string>(BASE_ALLOW_LIST);
  // The subscription login exists at auth tier 1 only; an auth tier 2 call
  // carries no subscription token (F125-FR-017).
  for (const name of own) {
    if (name === "CLAUDE_CODE_OAUTH_TOKEN" && input.authTier === 2) continue;
    names.add(name);
  }
  for (const name of DESCRIPTOR_ENV_ALLOW) {
    // The throwaway home exists at auth tier 2 only; NEVER at tier 1.
    if (name === "CLAUDE_CONFIG_DIR" && input.authTier !== 2) continue;
    if (others.includes(name)) continue;
    names.add(name);
  }
  for (const name of input.extraAllowed ?? []) {
    if (!others.includes(name)) names.add(name);
  }
  return Object.freeze([...names]);
}

/**
 * Builds the environment of one call: the allow-list and nothing else.
 * Under `parity` the names are exactly `PARITY_ENV_ALLOW`. Each addition of
 * the table is behind its switch (contracts/argument-table.md).
 */
export function buildCallEnvironment(input: EnvironmentInput): Readonly<Record<string, string>> {
  const names = environmentAllowList(input);
  const environment: Record<string, string> = {};
  for (const name of names) {
    const value = input.processEnv[name];
    if (value !== undefined) environment[name] = value;
  }
  if (input.profile === "parity") {
    // Nothing about memory, session, sandbox, overlay or trace parent.
    return Object.freeze(environment);
  }
  const add = (name: string, value: string): void => {
    if (names.includes(name) && value !== "") environment[name] = value;
  };
  if (input.memoryOff === true) {
    add("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1");
  }
  if (input.subprocessEnvScrub === true) {
    add("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB", "1");
  }
  if (input.traceparent != null && input.traceparent !== "") {
    add("TRACEPARENT", input.traceparent);
  }
  // The throwaway home only at auth tier 2; NEVER at auth tier 1 (F125-FR-017).
  if (input.authTier === 2 && input.throwawayHome != null && input.throwawayHome !== "") {
    add("CLAUDE_CONFIG_DIR", input.throwawayHome);
  }
  return Object.freeze(environment);
}

/* ------------------------------------------------------------------ *
 * T028 — the prompt file and its removal on every ending
 * (F125-FR-007, F125-FR-008).
 *
 * The prompt of a proposer pass reaches the CLI on standard input from a
 * file the harness adapter wrote, never as an argument: a prompt above
 * 128 KiB would hit the limit of one argument. Under the `parity` profile
 * the variable `SPECSTRIDE_STDIN_FILE` names that file to the process the
 * adapter starts, exactly as the baseline names it (as-is, annex X §X.8).
 * The file is removed when the pass ends — normally, with an error or by a
 * kill — through one exit path, so no prompt is ever left behind.
 * ------------------------------------------------------------------ */

/** The variable that names the prompt file under `parity` (F125-FR-007). */
export const STDIN_FILE_VARIABLE = "SPECSTRIDE_STDIN_FILE";

/** The as-is file-name pattern of the prompt file under `parity`. */
export const PROMPT_FILE_PATTERN = "specstride-prompt.XXXXXX";

/** The logical name of the prompt transfer in the layout (F125-FR-008). */
export function promptTransferLogicalName(passId: string): string {
  return `pass:${passId}:prompt-transfer`;
}

/** The temporary directory the prompt file goes to (F125-FR-008). */
export function promptFileDirectory(tempDir?: string | null): string {
  return tempDir ?? process.env.TMPDIR ?? "/tmp";
}

/** How a pass ended: the closed set the removal covers (F125-FR-008). */
export type PassEnding = "normal" | "error" | "kill";

/** A prompt file the adapter wrote, with its logical name. */
export type PromptFile = {
  /** The path the variable `SPECSTRIDE_STDIN_FILE` names. */
  readonly path: string;
  readonly logicalName: string;
  readonly variable: typeof STDIN_FILE_VARIABLE;
  readonly profile: "parity" | "default";
  /** True while the file still exists (proof it was removed at the end). */
  removed: boolean;
};

/** Why a prompt file was refused. */
export type PromptFileRefusalReason = "empty-prompt" | "removed";

/** The error a refused prompt-file operation carries. */
export class PromptFileRefusedError extends Error {
  readonly reason: PromptFileRefusalReason;

  constructor(reason: PromptFileRefusalReason, message: string) {
    super(message);
    this.name = "PromptFileRefusedError";
    this.reason = reason;
  }
}

/**
 * Writes the prompt file: mode 0o600 (readable by its owner only), the
 * as-is name pattern `specstride-prompt.XXXXXX` under `parity`, in the
 * directory `TMPDIR` names, else `/tmp`. The writer is injectable so tests
 * need no filesystem; the production writer uses `mkdtemp`-free `openSync`
 * with exact 0o600, never a readable-by-others mode.
 */
export function writePromptFile(
  input: {
    readonly passId: string;
    readonly prompt: string;
    readonly profile: "parity" | "default";
    readonly tempDir?: string | null;
  },
  options?: {
    readonly write?: (path: string, content: string) => void;
    /** Produces the six characters of the as-is pattern; injectable. */
    readonly suffix?: () => string;
  },
): PromptFile {
  if (typeof input.prompt !== "string" || input.prompt === "") {
    throw new PromptFileRefusedError("empty-prompt", "refused to write an empty prompt file");
  }
  const dir = promptFileDirectory(input.tempDir);
  const suffix = options?.suffix ?? (() => "a1b2c3");
  const name = PROMPT_FILE_PATTERN.replace("XXXXXX", suffix());
  const path = `${dir}/${name}`;
  (
    options?.write ??
    ((p: string, content: string) => {
      writeFileSync(p, content, { mode: 0o600 });
    })
  )(path, input.prompt);
  return {
    path,
    logicalName: promptTransferLogicalName(input.passId),
    variable: STDIN_FILE_VARIABLE,
    profile: input.profile,
    removed: false,
  };
}

/**
 * Removes the prompt file on EVERY ending of the pass — normal, error or
 * kill: one exit path, idempotent, and the name of the file is the only
 * thing it touches. The remover is injectable for tests.
 */
export function removePromptFile(
  file: PromptFile,
  ending: PassEnding,
  options?: { readonly rm?: (path: string) => void },
): { removed: string | null; ending: PassEnding } {
  if (file.removed) return { removed: null, ending };
  (
    options?.rm ??
    ((p: string) => {
      rmSync(p, { force: true });
    })
  )(file.path);
  file.removed = true;
  return { removed: file.path, ending };
}

/* ------------------------------------------------------------------ *
 * T031 — the label of the reader and the invocation directory without a
 * metadata record (F125-FR-011).
 * ------------------------------------------------------------------ */

/** The default harness label the reader and the projection get. */
export const DEFAULT_BACKEND_LABEL = "claude";

/** The as-is variable whose value overrides the label (F125-FR-011). */
export const BACKEND_LABEL_VARIABLE = "SPECSTRIDE_BACKEND_LABEL";

/**
 * The label the stream reader and the compatibility projection are given:
 * the value of `SPECSTRIDE_BACKEND_LABEL` where set, else `claude`
 * (F125-FR-011).
 */
export function backendLabel(env: Readonly<Record<string, string | undefined>>): string {
  const value = env[BACKEND_LABEL_VARIABLE];
  return typeof value === "string" && value !== "" ? value : DEFAULT_BACKEND_LABEL;
}

/**
 * A Claude pass gets an invocation directory for its raw stream and MUST
 * NOT get an invocation metadata record, so the finalizer's reconciliation
 * path is never taken for Claude (F125-FR-011). The constant is null: the
 * adapter never builds one.
 */
export const INVOCATION_METADATA_RECORD: null = null;

/** The invocation context of a pass: a directory, and no metadata record. */
export type InvocationDirectory = {
  readonly cwd: string;
  readonly metadataRecord: typeof INVOCATION_METADATA_RECORD;
};

/** Builds the invocation context of a pass (F125-FR-011). */
export function invocationDirectory(cwd: string): InvocationDirectory {
  return Object.freeze({ cwd, metadataRecord: INVOCATION_METADATA_RECORD });
}

/**
 * The switch `harnesses.claude.gitInstructions` stays UNSET for every call
 * (row 121 of annex X §X.7; DV-094): no argument of any list of the table
 * removes the harness's git snapshot from context.
 */
export const GIT_INSTRUCTIONS_SWITCH: null = null;

/* ------------------------------------------------------------------ *
 * T034 — the model and effort arguments of the model-tier ladder and the
 * refusal of a fallback model (F125-FR-033).
 * ------------------------------------------------------------------ */

/** One rung of the pinned ladder, as `data/models.json` holds it. */
export type LadderRung = {
  readonly model: string;
  readonly effort: string;
  readonly order: number;
};

/** The pinned ladder, lowest first (F125-FR-033). */
export const MODEL_LADDER: readonly LadderRung[] = (
  modelsTable.ladder as readonly LadderRung[]
).map((rung) => Object.freeze({ model: rung.model, effort: rung.effort, order: rung.order }));

/** The effort levels the harness accepts at the pin. */
export const EFFORT_LEVELS: readonly string[] = modelsTable.effortLevels;

/** Why a model or an effort was refused. */
export type ModelRefusalReason = "unknown-model" | "unknown-effort" | "fallback-model";

/** The error a refused model-tier choice carries. */
export class ModelRefusedError extends Error {
  readonly reason: ModelRefusalReason;

  constructor(reason: ModelRefusalReason, message: string) {
    super(message);
    this.name = "ModelRefusedError";
    this.reason = reason;
  }
}

/** True when the model names a rung of the pinned ladder. */
export function modelIsOnLadder(model: string): boolean {
  return MODEL_LADDER.some((rung) => rung.model === model);
}

/** The rung of a model of the ladder; null when the model is not on it. */
export function ladderRungFor(model: string): LadderRung | null {
  return MODEL_LADDER.find((rung) => rung.model === model) ?? null;
}

/**
 * The model and effort arguments of a call (F125-FR-033): `--model <M>`
 * for a model on the pinned ladder and `--effort <level>` for one of the
 * harness's effort levels. A model off the ladder and an effort the
 * harness does not name are refused; the role plan names both, the adapter
 * never chooses one (F125-FR-026).
 */
export function modelTierArguments(input: {
  readonly model?: string | null;
  readonly effort?: string | null;
}): readonly string[] {
  const argv: string[] = [];
  if (typeof input.model === "string" && input.model !== "") {
    if (!modelIsOnLadder(input.model)) {
      throw new ModelRefusedError(
        "unknown-model",
        `refused the call: the model "${input.model}" is not on the pinned ladder (F125-FR-033)`,
      );
    }
    argv.push("--model", input.model);
  }
  if (typeof input.effort === "string" && input.effort !== "") {
    if (!EFFORT_LEVELS.includes(input.effort)) {
      throw new ModelRefusedError(
        "unknown-effort",
        `refused the call: the effort "${input.effort}" is not one of the harness's effort levels`,
      );
    }
    argv.push("--effort", input.effort);
  }
  return Object.freeze(argv);
}

/**
 * Refuses a fallback model (F125-FR-033): `--fallback-model` is on the
 * never list of the argument table and is never passed, whatever the
 * consumer configured — the ladder is pinned at launch, not swapped
 * mid-call.
 */
export function assertNoFallbackModel(argv: readonly string[]): void {
  const index = argv.indexOf("--fallback-model");
  if (index !== -1) {
    throw new ModelRefusedError(
      "fallback-model",
      "refused the call: a fallback model is never passed (F125-FR-033)",
    );
  }
}
