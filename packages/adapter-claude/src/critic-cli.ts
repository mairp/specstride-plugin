/**
 * T043 + T044 — the auth tier 1 critic call and its proof (F125-FR-023,
 * F125-FR-024, F125-FR-025, F125-FR-026, F125-FR-030).
 *
 * - The critic at auth tier 1 is the installed CLI as a subprocess: prompt
 *   on standard input, an EMPTY temporary working directory, a minted fresh
 *   session id, no session persistence, no tool, no tool server, a
 *   permission mode that denies and never asks, ONE turn and the budget cap
 *   where the harness accepts one (F125-FR-023). At auth tier 2 the CLI is
 *   NEVER a form of the critic: that is `critic-direct.ts`.
 * - The proof is read from the INITIAL RECORD of the stream (F125-FR-024):
 *   an empty tool list, an empty list of tool servers, no plugin, and a
 *   session id equal to the minted one and NOT in the per-run set of
 *   proposer session ids. A stream with no initial record is refused. The
 *   result is recorded on every critic-class call.
 * - A refusal is a critic configuration error: engine exit 3, stop reason
 *   `critic_config` (F125-FR-024). A transport failure returns a typed
 *   failure and NO verdict (F125-FR-030).
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCallEnvironment, buildCriticArgv } from "./invoke-proposer.ts";

/* The auth tier 2 direct call is the critic's other transport; this module
 * re-exports it so the package's seam stays in one place. */
export {
  ANTHROPIC_VERSION,
  CONTEXT_WINDOW_TABLE,
  CONTEXT_WINDOW_VARIABLE_PLACEHOLDER,
  CRITIC_BASE_URL_VARIABLES,
  CRITIC_CONTEXT_TOKENS_VARIABLE,
  CRITIC_KEY_VARIABLES,
  CRITIC_MAX_TOKENS,
  CRITIC_ONE_TURN,
  DEFAULT_CRITIC_BASE_URL,
  DEFAULT_CRITIC_MODEL,
  PARITY_FALLBACK_CONTEXT_TOKENS,
  CriticDirectRefusedError,
  CriticDirectTransportError,
  assertAddressAllowed,
  bodyNamesNoTool,
  budgetCaps,
  budgetCapMissing,
  buildMessagesRequest,
  callCriticDirect,
  contextWindowFor,
  replyTextOfDirect,
  resolveCriticAliases,
} from "./critic-direct.ts";
export type { BudgetCaps, CriticAliases, CriticDirectCallRecord } from "./critic-direct.ts";

/* ------------------------------------------------------------------ *
 * Refusals and failures.
 * ------------------------------------------------------------------ */

/** The refusal code of F125-FR-024, as the spec names it. */
export const CRITIC_NOT_TOOLLESS = "critic_not_toolless";

/** The stop reason of a critic configuration error (F125-FR-024). */
export const CRITIC_STOP_REASON = "critic_config";

/** The engine exit of a critic configuration error (F125-FR-024). */
export const CRITIC_ENGINE_EXIT = 3;

/** Why a critic call was refused. */
export type CriticRefusalReason =
  "critic_not_toolless" | "terms-refused" | "cli-at-auth-tier-2" | "empty-session-id";

/** The error a refused critic call carries: a critic configuration error. */
export class CriticConfigError extends Error {
  readonly reason: CriticRefusalReason;
  readonly engineExit: number;
  readonly stopReason: string;

  constructor(reason: CriticRefusalReason, message: string) {
    super(message);
    this.name = "CriticConfigError";
    this.reason = reason;
    this.engineExit = CRITIC_ENGINE_EXIT;
    this.stopReason = CRITIC_STOP_REASON;
  }
}

/** The kinds of a transport failure of a critic call (F125-FR-030). */
export type CriticTransportFailureKind = "error-status" | "hang" | "non-zero-exit" | "empty-reply";

/**
 * A transport failure of a critic call: a typed failure of the port, NO
 * verdict, scored by the critic strategy as the baseline scores a transport
 * error of the critic (F125-FR-030).
 */
export class CriticTransportError extends Error {
  readonly kind: CriticTransportFailureKind;

  constructor(kind: CriticTransportFailureKind, message: string) {
    super(message);
    this.name = "CriticTransportError";
    this.kind = kind;
  }
}

/** A terms gate that does not allow the call at this moment (F125-FR-030). */
export class TermsGateRefusedError extends CriticConfigError {
  constructor(message: string) {
    super("terms-refused", message);
    this.name = "TermsGateRefusedError";
  }
}

/* ------------------------------------------------------------------ *
 * T044 — the proof from the initial record.
 * ------------------------------------------------------------------ */

/** The initial record of a stream (F125-FR-016, capture D). */
export type InitialRecord = {
  readonly sessionId: string | null;
  readonly tools: readonly string[];
  readonly servers: readonly string[];
  readonly plugins: readonly string[];
  readonly model: string | null;
  readonly capabilities: readonly string[];
};

/**
 * The closed set of the outcomes of the proof (data model, `Proof`): the
 * proof holds, or it refuses for exactly one stated reason.
 */
export const PROOF_OUTCOMES = [
  "proven",
  "refused-tool",
  "refused-server",
  "refused-plugin",
  "refused-session-foreign",
  "refused-session-proposer",
  "refused-no-record",
] as const;
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number];

/** The proof recorded on every critic-class call (data model, `Proof`). */
export type CriticProof = {
  readonly outcome: ProofOutcome;
  readonly toolsEmpty: boolean;
  readonly serversEmpty: boolean;
  readonly sessionMatches: boolean;
  readonly sessionNotProposer: boolean;
};

/**
 * Reads the initial record off a stream: the first NDJSON line whose shape
 * is `{type: "system", subtype: "init"}`. A stream without one yields null
 * — and a call whose stream has no initial record MUST be refused
 * (F125-FR-024).
 */
export function readInitialRecord(streamText: string): InitialRecord | null {
  for (const line of streamText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // prose lines are not the record; the reader of 126 reads them
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (record["type"] !== "system" || record["subtype"] !== "init") continue;
    const list = (value: unknown): readonly unknown[] =>
      Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
    return Object.freeze({
      sessionId: typeof record["session_id"] === "string" ? record["session_id"] : null,
      tools: Object.freeze(list(record["tools"])) as readonly string[],
      servers: Object.freeze(list(record["mcp_servers"])) as readonly string[],
      plugins: Object.freeze(list(record["plugins"])) as readonly string[],
      model: typeof record["model"] === "string" ? record["model"] : null,
      capabilities: Object.freeze(list(record["capabilities"])) as readonly string[],
    });
  }
  return null;
}

/**
 * The proof of F125-FR-024, PURE: it reads the initial record and the
 * per-run set of proposer session ids and states an outcome. Every bad
 * initial record is refused:
 *  - a tool on the record, or a tool server, or a plugin;
 *  - a session id that is not the minted one, or one a proposer pass used;
 *  - no record at all.
 */
export function proveToolless(input: {
  readonly initialRecord: InitialRecord | null;
  readonly mintedSessionId: string;
  readonly proposerSessionIds: ReadonlySet<string>;
}): CriticProof {
  const record = input.initialRecord;
  if (record === null) {
    return Object.freeze({
      outcome: "refused-no-record",
      toolsEmpty: false,
      serversEmpty: false,
      sessionMatches: false,
      sessionNotProposer: false,
    });
  }
  const toolsEmpty = record.tools.length === 0;
  const serversEmpty = record.servers.length === 0;
  const pluginsEmpty = record.plugins.length === 0;
  const sessionMatches = record.sessionId === input.mintedSessionId;
  const sessionNotProposer =
    record.sessionId === null || !input.proposerSessionIds.has(record.sessionId);
  let outcome: ProofOutcome = "proven";
  if (!toolsEmpty) outcome = "refused-tool";
  else if (!serversEmpty) outcome = "refused-server";
  else if (!pluginsEmpty) outcome = "refused-plugin";
  else if (!sessionMatches) outcome = "refused-session-foreign";
  else if (!sessionNotProposer) outcome = "refused-session-proposer";
  return Object.freeze({
    outcome,
    toolsEmpty,
    serversEmpty,
    sessionMatches,
    sessionNotProposer,
  });
}

/**
 * Refuses a proof that does not hold with `critic_not_toolless`: a critic
 * configuration error that halts the run — engine exit 3, stop reason
 * `critic_config` (F125-FR-024).
 */
export function assertProofHolds(proof: CriticProof): void {
  if (proof.outcome === "proven") return;
  throw new CriticConfigError(
    "critic_not_toolless",
    `refused the critic call (${CRITIC_NOT_TOOLLESS}): the initial record gives the ` +
      `proof outcome "${proof.outcome}" (F125-FR-024)`,
  );
}

/* ------------------------------------------------------------------ *
 * T041 — the critic-diversity warning (F125-FR-026; F100-FR-024).
 * ------------------------------------------------------------------ */

/** What the diversity rule states, recorded in `criticPick`. */
export type CriticDiversity = {
  /** The model of the critic, as the plan names it; null when unknown. */
  readonly criticModel: string | null;
  /** The model of the proposer; null when unknown. */
  readonly proposerModel: string | null;
  /** `different-model`, `same-model` or `unverified`. */
  readonly diversity: "different-model" | "same-model" | "unverified";
  /** True where the warning of F100-FR-024 is raised; never launch-blocking. */
  readonly warning: boolean;
  readonly launchBlocking: false;
};

/**
 * The critic-diversity rule of F100-FR-024 (F125-FR-026, ruling 49): the
 * same model raises the warning; a higher effort on the same model does NOT
 * count as a different model and raises the warning too; where the model of
 * either role is unknown it is reported null, the test gives `unverified`
 * and the warning is raised. The warning NEVER blocks a launch.
 */
export function criticDiversity(input: {
  readonly proposerModel?: string | null;
  readonly criticModel?: string | null;
  readonly proposerEffort?: string | null;
  readonly criticEffort?: string | null;
}): CriticDiversity {
  const proposer = input.proposerModel ?? null;
  const critic = input.criticModel ?? null;
  if (proposer === null || critic === null) {
    return Object.freeze({
      criticModel: critic,
      proposerModel: proposer,
      diversity: "unverified",
      warning: true,
      launchBlocking: false,
    });
  }
  const sameModel = proposer === critic;
  return Object.freeze({
    criticModel: critic,
    proposerModel: proposer,
    diversity: sameModel ? "same-model" : "different-model",
    warning: sameModel,
    launchBlocking: false,
  });
}

/* ------------------------------------------------------------------ *
 * T043 — the auth tier 1 critic call.
 * ------------------------------------------------------------------ */

/**
 * Refuses the CLI as a form of the critic at auth tier 2 (F125-FR-023):
 * there the critic is the direct call of `critic-direct.ts`, or the SDK
 * transport — never the CLI.
 */
export function assertCriticTransportAllowed(input: {
  readonly transport: "subprocess" | "direct-call" | "sdk-in-process";
  readonly authTier: 1 | 2;
}): void {
  if (input.transport === "subprocess" && input.authTier === 2) {
    throw new CriticConfigError(
      "cli-at-auth-tier-2",
      "refused the critic call: the CLI is not a form of the critic at auth tier 2 (F125-FR-023)",
    );
  }
}

/* The budget caps are data of `data/models.json`, consumed in
 * `critic-direct.ts` (`budgetCaps`). */

/** The record one critic-class call leaves behind (F125-FR-024, F125-FR-030). */
export type CriticCallRecord = {
  readonly role: "critic";
  readonly transport: "subprocess";
  readonly authTier: 1;
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissionMode: "dontAsk";
  readonly sessionId: string;
  readonly argv: readonly string[];
  readonly envNames: readonly string[];
  readonly workingDirectoryEmpty: boolean;
  readonly budgetUsd: number | null;
  readonly proof: CriticProof;
  readonly verdict: string | null;
  readonly failure: { readonly kind: CriticTransportFailureKind } | null;
};

/** What the caller of the critic CLI supplies. */
export type CriticCliCallInput = {
  readonly prompt: string;
  readonly model?: string | null;
  readonly effort?: string | null;
  /** The per-call spending cap (F125-FR-023); null where the harness has none. */
  readonly budgetUsd?: number | null;
  readonly executable: string;
  /** The per-run set of proposer session ids, for the proof (F125-FR-025). */
  readonly proposerSessionIds: ReadonlySet<string>;
  /** The minted fresh session id of this call (F125-FR-013, F125-FR-023). */
  readonly sessionId: string;
  /** Whether the terms gate allows the call at this moment (F125-FR-030). */
  readonly termsAllowed: boolean;
  /** The consumer's declared context window, which always wins (F125-FR-027). */
  readonly declaredContextTokens?: number | null;
  /** The environment of the run; read only through the allow-list. */
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  /** The runner of the process, injectable for the tests. */
  readonly spawnCritic?: SpawnCritic;
};

/**
 * The minimal runner the call uses. The real runner starts the installed
 * CLI in its own process group and resolves the WHOLE stream once the child
 * has ended; the tests inject a runner that resolves a recorded stream.
 */
export type SpawnCritic = (
  executable: string,
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    detached: boolean;
  },
) => { readonly pid: number; readonly stream: Promise<string> };

/** The prompt-size budget of the critic (F125-FR-027). */
export const CRITIC_PROMPT_SIZE_BUDGET_TOKENS = 200_000;

/** Roughly the tokens of a prompt: four characters to a token, never fewer. */
function promptTokenEstimate(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * The auth tier 1 critic call (F125-FR-023, F125-FR-024, F125-FR-030):
 * builds the argument list and the environment, starts the CLI in an empty
 * temporary working directory with the prompt on standard input, reads the
 * initial record off the stream, runs the proof, and records the result on
 * the call record. A transport failure gives NO verdict and a typed
 * failure; a refused terms gate refuses the call outright.
 */
export async function callCriticCli(input: CriticCliCallInput): Promise<CriticCallRecord> {
  // F125-FR-023: at auth tier 2 the CLI is never a form of the critic.
  // This entry point IS auth tier 1; the type carries it.
  if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") {
    throw new CriticConfigError(
      "empty-session-id",
      "refused the critic call: its fresh session id is empty (F125-FR-023)",
    );
  }
  // F125-FR-030: a terms gate that does not allow the call refuses it.
  if (input.termsAllowed !== true) {
    throw new TermsGateRefusedError(
      "refused the critic call: the terms gate does not allow it at this moment (F125-FR-030)",
    );
  }
  // F125-FR-027: the prompt-size budget bounds the call.
  if (promptTokenEstimate(input.prompt) > CRITIC_PROMPT_SIZE_BUDGET_TOKENS) {
    throw new CriticConfigError(
      "critic_not_toolless",
      "refused the critic call: the prompt is over the prompt-size budget of the critic (F125-FR-027)",
    );
  }

  // The credential of the critic is never in the proposer's environment
  // (F125-FR-030): the allow-list names the critic's own variables only.
  const env = buildCallEnvironment({
    role: "critic",
    profile: "default",
    authTier: 1,
    processEnv: input.processEnv,
    memoryOff: true, // native memory is off for the critic (F125-FR-018, F125-FR-026)
  });

  // An EMPTY temporary working directory, removed after the call, so that
  // project settings, tool-server files and instruction files are out of
  // reach even if a flag regresses (F125-FR-025).
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "specstride-critic-"));
  const workingDirectoryEmptyAtStart = rmWorkingDirectoryProbe(workingDirectory);

  const argv = [
    ...buildCriticArgv({
      role: "critic",
      profile: "default",
      authTier: 1,
      model: input.model ?? null,
      effort: input.effort ?? null,
      sessionId: input.sessionId,
      sessionMode: "fresh",
      budgetUsd: input.budgetUsd ?? null,
    }),
  ];

  let failure: CriticTransportFailureKind | null = null;
  let streamText = "";
  let verdict: string | null = null;
  let proof: CriticProof;
  try {
    const spawnCritic = input.spawnCritic ?? defaultSpawnCritic;
    const child = spawnCritic(input.executable, argv, {
      cwd: workingDirectory,
      env,
      detached: true, // its own process group (F125-FR-021)
    });
    streamText = await child.stream;
    proof = proveToolless({
      initialRecord: readInitialRecord(streamText),
      mintedSessionId: input.sessionId,
      proposerSessionIds: input.proposerSessionIds,
    });
    try {
      assertProofHolds(proof);
      verdict = replyTextOf(streamText);
      if (verdict === null || verdict.trim() === "") {
        throw new CriticTransportError(
          "empty-reply",
          "the critic reply holds no text (F125-FR-030)",
        );
      }
    } catch (error) {
      verdict = null;
      if (error instanceof CriticTransportError) failure = error.kind;
    }
  } catch (error) {
    failure = error instanceof CriticTransportError ? error.kind : "error-status";
    proof = proveToolless({
      initialRecord: readInitialRecord(streamText),
      mintedSessionId: input.sessionId,
      proposerSessionIds: input.proposerSessionIds,
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }

  // The refusal of the proof is a critic configuration error that halts the
  // run, and it is STILL recorded on the call record first (F125-FR-024).
  const record: CriticCallRecord = Object.freeze({
    role: "critic",
    transport: "subprocess",
    authTier: 1,
    model: input.model ?? null,
    effort: input.effort ?? null,
    permissionMode: "dontAsk",
    sessionId: input.sessionId,
    argv: Object.freeze(argv),
    envNames: Object.freeze(Object.keys(env).sort()),
    workingDirectoryEmpty: workingDirectoryEmptyAtStart,
    budgetUsd: input.budgetUsd ?? null,
    proof,
    verdict,
    failure: failure === null ? null : { kind: failure },
  });
  lastCriticCallRecord = record;
  if (failure !== null) {
    throw new CriticTransportError(
      failure,
      `the critic call failed in transport (${failure}); no verdict is produced (F125-FR-030)`,
    );
  }
  assertProofHolds(proof);
  return record;
}

/**
 * The call record of the MOST RECENT critic call, thrown errors included.
 * F125-FR-024: the result of the proof is recorded on every critic-class
 * call, refused ones included, so a caller that catches the refusal still
 * reads the record.
 */
let lastCriticCallRecord: CriticCallRecord | null = null;
export function lastCriticCallRecordOf(): CriticCallRecord | null {
  return lastCriticCallRecord;
}

/** Confirms the fresh directory is empty, without leaving anything in it. */
function rmWorkingDirectoryProbe(directory: string): boolean {
  return readdirSync(directory).length === 0;
}

/** The real runner: the installed CLI, in its own process group. */
function defaultSpawnCritic(
  executable: string,
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    detached: boolean;
  },
): { readonly pid: number; readonly stream: Promise<string> } {
  const child = spawn(executable, [...argv], {
    cwd: options.cwd,
    env: { ...options.env },
    detached: options.detached,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => void chunks.push(chunk));
  const stream = new Promise<string>((resolve, reject) => {
    child.on("error", (error: Error) => reject(error));
    child.on("close", (code: number | null) => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (code !== 0) {
        reject(new CriticTransportError("non-zero-exit", `the critic CLI ended with exit ${code}`));
        return;
      }
      resolve(text);
    });
  });
  return { pid: child.pid ?? -1, stream };
}

/** The verdict text of a stream: the last assistant text block. */
export function replyTextOf(streamText: string): string | null {
  let text: string | null = null;
  for (const line of streamText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed["type"] !== "assistant") continue;
      const message = parsed["message"] as { readonly content?: unknown } | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      const joined = content
        .map((block) =>
          typeof block === "object" && block !== null
            ? String((block as { text?: unknown }).text ?? "")
            : "",
        )
        .join("");
      if (joined !== "") text = joined;
    } catch {
      continue;
    }
  }
  return text;
}
