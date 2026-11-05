// @specstride/adapter-claude — src/sdk/harness.ts
//
// Extracted from Lisa at commit `363e6a3`
// (`packages/agents/src/claude-agent-sdk/harness.ts`) as source, then brought to
// the seam of F125-FR-041 BEFORE any characterization test was written. The four
// seam behaviours and the two kept options are:
//
//   BROUGHT TO THE SEAM (F125-FR-041):
//   1. Permission mode: `acceptEdits` (F125-FR-012). Lisa's default
//      `bypassPermissions` is NOT kept.
//   2. The pass request carries the session directive of F125-FR-013
//      (`mode: "fresh" | "continue"`, `sessionId`); Lisa's request had no
//      session field. A `continue` pass sets the SDK `resume` option; an empty
//      session id is refused.
//   3. The pass NEVER ends because this adapter polls for an evidence file.
//      Lisa's evidence-file gate (the `EVIDENCE_POLL_MS` poller and the
//      pre-pass `existsSync` fast-exit) is removed: the pass ends by the
//      terminal message of the SDK or by the stop of the port; the end of a
//      pass on phase evidence belongs to the pass loop.
//   4. The harness adapter NEVER retries a call by itself; a transient retry
//      belongs to the harness's own retry and to the classification of
//      F125-FR-031 (see `classify.ts` in phase 2).
//
//   KEPT (the two options of Lisa's harness):
//   - `claudeAgentEnvironment`: the harness's implicit idle cutoff
//     (`API_FORCE_IDLE_TIMEOUT`) is off unless the consumer sets it, so the
//     deadline of the caller is the only deadline.
//   - `claudeAgentDisallowedTools`: the consumer's switch
//     `harnesses.claude.disableSubagents` adds the sub-agent tool (`Agent`) to
//     the tools that are refused.
//
// Kept from Lisa unchanged in substance: the usage comes from the provider's
// own accounting, never scraped from the text of the stream (F125-FR-039); a
// figure the provider did not report is `null` here, where Lisa returned zero
// (the seam change of F125-FR-039/F125-FR-032); failure kinds come from
// structured codes first and from text second; prose that only mentions such a
// phrase stays a success.
//
// The Agent SDK is an optional peer dependency: no import of it survives here.
// `query` is injected as a narrow structural type (the real SDK in production
// through `load.ts`, a fake in the tests — the shape of Lisa's `queryImpl`).

import { createHash } from "node:crypto";

/** The typed failures of the port that the kept classification produces (F125-FR-039). */
export type HarnessFailureKind =
  | "context_window_exceeded"
  | "rate_limited"
  | "authentication_failed"
  | "agent_failure"
  | "transport_failed";

/** One usage figure; `null` where the provider did not report it (never zero for an unknown). */
export interface HarnessUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  costUsd: number | null;
}

/** The session directive of F125-FR-013, carried on every pass request. */
export interface SessionDirective {
  mode: "fresh" | "continue";
  sessionId: string;
}

export interface HarnessPassRequest {
  prompt: string;
  workdir: string;
  model?: string;
  maxTurns?: number;
  /** Wall-clock time limit of the CALLER; a pass ended by it is not a harness failure. */
  timeoutSec?: number;
  signal?: AbortSignal;
  iteration?: number;
  session: SessionDirective;
}

export type HarnessEvent =
  | {
      kind: "init";
      model: string | undefined;
      sessionId: string;
      tools: readonly string[];
      iteration: number | undefined;
    }
  | { kind: "text"; text: string; iteration: number | undefined }
  | { kind: "tool"; name: string; detail: string | undefined; iteration: number | undefined }
  | {
      kind: "result";
      subtype: "success" | "error";
      usage: HarnessUsage;
      sessionId?: string;
      numTurns?: number;
      isError: boolean;
      errorText?: string;
      failureKind?: HarnessFailureKind;
      convergenceFingerprint?: string;
      iteration: number | undefined;
    };

/** Narrow structural type for the one SDK call this adapter uses (no SDK types at build). */
export type QueryImpl = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** Refused unless the consumer sets it: the harness's own implicit idle cutoff. */
const FORCE_IDLE_TIMEOUT_ENV = "API_FORCE_IDLE_TIMEOUT";
/** The consumer's switch `harnesses.claude.disableSubagents`, read from the environment. */
const DISABLE_SUBAGENTS_ENV = "LISA_CLAUDE_DISABLE_SUBAGENTS";

/**
 * KEPT OPTION 1 (F125-FR-041): the implicit idle cutoff of the harness is off
 * unless the consumer sets it, so the deadline of the caller is the only
 * deadline.
 */
export function claudeAgentEnvironment(
  configured: Record<string, string | undefined> | undefined,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const base = configured ?? inherited;
  return {
    ...base,
    [FORCE_IDLE_TIMEOUT_ENV]: base[FORCE_IDLE_TIMEOUT_ENV] ?? "0",
  };
}

/**
 * KEPT OPTION 2 (F125-FR-041): the consumer's `harnesses.claude.disableSubagents`
 * adds the sub-agent tool to the tools that are refused on the request.
 */
export function claudeAgentDisallowedTools(
  configured: string[] | undefined,
  disableValue = process.env[DISABLE_SUBAGENTS_ENV],
): string[] | undefined {
  const tools = [...(configured ?? [])];
  const normalized = disableValue?.trim().toLowerCase();
  const disabled =
    normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  if (disabled && !tools.includes("Agent")) {
    tools.push("Agent");
  }
  return tools.length > 0 ? tools : undefined;
}

/**
 * Map one provider usage object to the typed figures (F125-FR-039). Reads the
 * provider's own accounting, never the text of the stream; a figure the
 * provider did not report is `null` (Lisa's harness returned zero — not kept).
 */
export function usageFromSdkResult(result: {
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}): HarnessUsage {
  const u = result.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    cacheReadTokens: u.cache_read_input_tokens ?? null,
    cacheCreationTokens: u.cache_creation_input_tokens ?? null,
    costUsd: result.total_cost_usd ?? null,
  };
}

/** Extract the text + tool-use blocks from an assistant message's content array. */
function* mapAssistantBlocks(
  content: unknown,
  iteration: number | undefined,
): Iterable<HarnessEvent> {
  if (!Array.isArray(content)) return;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block["type"] === "text" && typeof block["text"] === "string") {
      const text = block["text"].trim();
      if (text) yield { kind: "text", text, iteration };
    } else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
      const input = block["input"];
      const detail = summarizeToolInput(input);
      yield { kind: "tool", name: block["name"], detail, iteration };
    }
  }
}

/**
 * A compact one-line description of a tool call (F125-FR-040): the first
 * present of a file path, a path, a command, a pattern, an address or a
 * notebook path, else the first names of the input; the target is clamped to
 * 200 characters.
 */
export function summarizeToolInput(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "command", "pattern", "url", "notebook_path"]) {
    const v = obj[key];
    if (typeof v === "string" && v) return `${key}=${v.slice(0, 200)}`;
  }
  const keys = Object.keys(obj);
  return keys.length ? keys.slice(0, 5).join(",") : undefined;
}

export interface ClaudeAgentSdkOptions {
  defaultModel?: string;
  /** Operator overrides merged into every pass; the seam defaults stay in the adapter. */
  sdkOptions?: Record<string, unknown>;
  /** Injected `query` — the real SDK by default; the tests pass a fake. */
  queryImpl?: QueryImpl;
}

/**
 * The Claude Agent SDK harness adapter of the port. One fresh SDK session per
 * pass unless the session directive says `continue`; no evidence polling; no
 * retry of its own (F125-FR-041).
 */
export class ClaudeAgentSdkHarness {
  readonly id = "claude-agent-sdk";

  private readonly queryImpl: QueryImpl;
  private readonly opts: ClaudeAgentSdkOptions;

  constructor(opts: ClaudeAgentSdkOptions = {}) {
    this.opts = opts;
    this.queryImpl =
      opts.queryImpl ??
      (() => {
        // The SDK is loaded dynamically by src/sdk/load.ts when the transport is
        // chosen; a harness built without an injected `queryImpl` and without a
        // load is a configuration error, never a retry and never a fallback.
        throw new Error("no query implementation: inject one or load the optional peer dependency");
      });
  }

  async *runPass(req: HarnessPassRequest): AsyncIterable<HarnessEvent> {
    const iteration = req.iteration;

    // SEAM BEHAVIOUR 2: the session directive is carried on the request. An
    // empty id is refused; `continue` resumes by the minted id.
    const sessionId = req.session?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("session directive: an empty session id is refused");
    }
    const resume = req.session.mode === "continue" ? sessionId : undefined;

    // SEAM BEHAVIOUR 1: the permission mode is accept-edits (F125-FR-012).
    // Lisa's `bypassPermissions` default is NOT kept.
    const disallowedTools = claudeAgentDisallowedTools(
      this.opts.sdkOptions?.disallowedTools as string[] | undefined,
    );
    const options: Record<string, unknown> = {
      ...this.opts.sdkOptions,
      ...(disallowedTools ? { disallowedTools } : {}),
      env: claudeAgentEnvironment(
        this.opts.sdkOptions?.env as Record<string, string | undefined> | undefined,
      ),
      cwd: req.workdir,
      permissionMode: this.opts.sdkOptions?.permissionMode ?? "acceptEdits",
      ...(resume !== undefined ? { resume } : {}),
      ...(req.model ? { model: req.model } : {}),
      ...(req.maxTurns ? { maxTurns: req.maxTurns } : {}),
    };

    // SEAM BEHAVIOUR 3: no evidence polling. Lisa chained the caller's signal
    // and its own wall-clock timeout; both remain, because they are the STOP of
    // the port (F125-FR-021), not a poll of phase evidence.
    const controller = new AbortController();
    let externallyAborted = false;
    let timedOut = false;
    const onExternalAbort = (): void => {
      externallyAborted = true;
      controller.abort();
    };
    if (req.signal) {
      if (req.signal.aborted) controller.abort();
      else req.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (req.timeoutSec && req.timeoutSec > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, req.timeoutSec * 1000);
    }

    let emittedResult = false;
    let lastAssistantText = "";
    const behavior = createHash("sha256");
    try {
      // SEAM BEHAVIOUR 4: no retry of its own — the loop below consumes the
      // stream once and never re-enters `queryImpl`.
      for await (const message of this.queryImpl({ prompt: req.prompt, options })) {
        for (const mapped of this.mapMessage(message, iteration)) {
          let ev = mapped;
          if (ev.kind === "tool") {
            behavior.update(`tool:${ev.name}:${ev.detail ?? ""}\n`);
          } else if (ev.kind === "text") {
            lastAssistantText = ev.text;
            behavior.update(`text:${ev.text}\n`);
          } else if (ev.kind === "result") {
            const failureKind =
              failureKindFromSdkMessage(message, lastAssistantText) ??
              (ev.isError ? "transport_failed" : undefined);
            // A stop the caller requested and the caller's time limit are not
            // failures of the harness adapter (F125-FR-039).
            const callerEnded = (timedOut || externallyAborted) && failureKind === undefined;
            const failed = ev.isError && !callerEnded;
            behavior.update(`result:${failed ? "error" : ev.subtype}:${failureKind ?? ""}\n`);
            ev = {
              ...ev,
              ...(failed
                ? {
                    subtype: "error" as const,
                    isError: true,
                    errorText: failureKind,
                    failureKind,
                  }
                : {}),
              convergenceFingerprint: behavior.digest("hex"),
            };
          }
          if (ev.kind === "result") emittedResult = true;
          yield ev;
        }
      }
    } catch (err) {
      // The pass ends by the terminal message or by the stop of the port; a
      // thrown error is reported once and never retried here.
      if (!emittedResult) {
        const detail = errorText(err);
        // Caller stop / caller time limit: an error result with NO harness
        // failure kind (F125-FR-039).
        const failureKind =
          timedOut || externallyAborted
            ? undefined
            : (classifyHarnessFailureText(detail) ?? "transport_failed");
        behavior.update(`result:error:${failureKind ?? ""}\n`);
        yield {
          kind: "result",
          subtype: "error",
          usage: NULL_USAGE,
          isError: true,
          errorText: detail,
          ...(failureKind ? { failureKind } : {}),
          convergenceFingerprint: behavior.digest("hex"),
          iteration,
        };
        emittedResult = true;
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (req.signal) req.signal.removeEventListener("abort", onExternalAbort);
    }

    // If the stream closed without a terminal message, synthesize one so the
    // loop is never left waiting. Once. No retry.
    if (!emittedResult) {
      yield {
        kind: "result",
        subtype: "error",
        usage: NULL_USAGE,
        isError: true,
        errorText: "session ended without a result message",
        failureKind: "transport_failed",
        convergenceFingerprint: behavior.update("result:error\n").digest("hex"),
        iteration,
      };
    }
  }

  /** Map one SDK message to zero or more `HarnessEvent`s (kept of Lisa, F125-FR-040). */
  private *mapMessage(message: unknown, iteration: number | undefined): Iterable<HarnessEvent> {
    const record = message as Record<string, unknown>;
    switch (record["type"]) {
      case "system":
        if ((record as { subtype?: string }).subtype === "init") {
          yield {
            kind: "init",
            model: record["model"] as string | undefined,
            sessionId: record["session_id"] as string,
            tools: (record["tools"] ?? []) as string[],
            iteration,
          };
        }
        break;
      case "assistant":
        yield* mapAssistantBlocks(
          (record["message"] as { content?: unknown } | undefined)?.content,
          iteration,
        );
        break;
      case "result": {
        const isError = (record as { subtype?: string }).subtype !== "success";
        yield {
          kind: "result",
          subtype: isError ? "error" : "success",
          usage: usageFromSdkResult(record as Parameters<typeof usageFromSdkResult>[0]),
          sessionId: record["session_id"] as string | undefined,
          numTurns: record["num_turns"] as number | undefined,
          isError,
          errorText: isError
            ? `result subtype: ${String((record as { subtype?: string }).subtype)}`
            : undefined,
          iteration,
        };
        break;
      }
      default:
        // Every other message kind is not part of the four-event contract; ignore it.
        break;
    }
  }
}

/** The usage of a pass whose provider reported nothing: every figure unknown. */
export const NULL_USAGE: HarnessUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  costUsd: null,
};

/**
 * Text-second classification of the kept harness (F125-FR-039): only explicit
 * provider terminal conditions map to a typed failure; ordinary prose that
 * merely mentions such a phrase stays a success. A time limit of the caller
 * and a stop the caller requested are NOT failures of the harness adapter, so
 * their phrases are deliberately absent here.
 */
export function classifyHarnessFailureText(text: string): HarnessFailureKind | undefined {
  const value = text.toLowerCase();
  if (
    /prompt is too long|context window (?:is )?(?:full|exceeded)|maximum context length|input (?:is )?too long|too many (?:input )?tokens/.test(
      value,
    )
  ) {
    return "context_window_exceeded";
  }
  if (/rate.?limit|too many requests|quota exceeded|resource exhausted/.test(value)) {
    return "rate_limited";
  }
  if (
    /unauthori[sz]ed|authentication|invalid api key|permission denied|forbidden|not logged in|please run \/login|login required/.test(
      value,
    )
  ) {
    return "authentication_failed";
  }
  if (/tool .*(?:failed|error)|tool_use_error|tool execution failed/.test(value)) {
    return "agent_failure";
  }
  if (/econn|network|transport|socket|dns|connection (?:failed|reset|refused)/.test(value)) {
    return "transport_failed";
  }
  return undefined;
}

/**
 * Structured codes first, text second (F125-FR-039). Some SDK versions expose
 * only a generic terminal plus the last assistant text, so the second stage
 * recognizes the provider's explicit phrases there.
 */
function failureKindFromSdkMessage(
  message: unknown,
  lastAssistantText: string,
): HarnessFailureKind | undefined {
  const record = message as Record<string, unknown>;
  const error = record["error"];
  const errorRecord =
    error !== null && typeof error === "object" ? (error as Record<string, unknown>) : undefined;
  const native = [
    record["failure_kind"],
    record["error_code"],
    record["code"],
    errorRecord?.["type"],
    errorRecord?.["code"],
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const nativeKind = classifyHarnessFailureText(native);
  if (nativeKind) return nativeKind;

  const resultText = typeof record["result"] === "string" ? record["result"] : "";
  return classifyHarnessFailureText(`${resultText}\n${lastAssistantText}`);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ------------------------------------------------------------------ *
 * Phase 7 — the auth of the SDK transport (T062, F125-FR-035) and the
 * SDK critic call (T068, F125-FR-030, F125-FR-038).
 * ------------------------------------------------------------------ */

import {
  proveToolless,
  readInitialRecord,
  type CriticProof,
  type InitialRecord,
} from "../critic-cli.ts";

/**
 * The credential names that NEVER ride an SDK call (F125-FR-035, ruling 70):
 * the subscription credentials of auth tier 1 — the SDK transport is auth
 * tier 2, API keys only, and never carries a subscription login.
 */
export const SDK_SUBSCRIPTION_CREDENTIAL_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_SESSION_TOKEN",
] as const;

/**
 * The environment of an SDK call (F125-FR-035): the consumer's environment
 * with EVERY subscription credential removed. The only credential an SDK
 * call may carry is the API key of its secret reference, and it is carried
 * as the `apiKey` OPTION of the one call, never in the environment and
 * never in an argument list (there is no argv).
 */
export function sdkAuthEnvironment(
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  for (const name of SDK_SUBSCRIPTION_CREDENTIAL_VARS) delete env[name];
  return env;
}

/** A secret by REFERENCE: the adapter sees the key NAME, never a value. */
export type SecretReference = { readonly key: string };

/**
 * Resolves the one credential an SDK call carries (F125-FR-035): the API key
 * of its secret reference, through the host-supplied resolver. No reference
 * means NO credential on the call — the adapter never falls back to a
 * subscription credential and never reads one from the environment.
 */
export function sdkApiKey(
  reference: SecretReference | undefined,
  resolve: (key: string) => string | undefined,
): string | undefined {
  if (reference === undefined) return undefined;
  return resolve(reference.key);
}

/**
 * The options ONLY the call that STARTS a session carries (CT-125-28). A
 * continuation pass states `resume` and the call facts (cwd, env, model,
 * turns) and never re-states these: the session's terms-bearing shape is
 * fixed by its starting call.
 */
export const SESSION_START_ONLY_OPTIONS = [
  "settingSources",
  "allowedTools",
  "permissionMode",
  "maxBudgetUsd",
] as const;

/** The facts every SDK call states, whatever its session directive. */
export function baseSdkOptions(input: {
  readonly workdir: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Record<string, unknown> {
  const options: Record<string, unknown> = {
    cwd: input.workdir,
    env: { ...input.env },
  };
  if (input.model !== undefined) options["model"] = input.model;
  if (input.maxTurns !== undefined) options["maxTurns"] = input.maxTurns;
  return options;
}

/**
 * The option set of the call that STARTS a session (CT-125-28,
 * F125-FR-037): the terms-bearing shape — accept-edits (F125-FR-012), an
 * empty tool list, no settings source (no consumer settings file is read),
 * the budget — beside the call facts.
 */
export function sessionStartOptions(input: {
  readonly workdir: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly maxBudgetUsd?: number;
  readonly apiKey?: string;
}): Record<string, unknown> {
  const options = baseSdkOptions(input);
  options["permissionMode"] = "acceptEdits";
  options["allowedTools"] = [];
  options["settingSources"] = [];
  if (input.maxBudgetUsd !== undefined) options["maxBudgetUsd"] = input.maxBudgetUsd;
  if (input.apiKey !== undefined) options["apiKey"] = input.apiKey;
  return options;
}

/**
 * The option set of a CONTINUATION pass (CT-125-28): `resume` by the minted
 * id and the call facts only — none of the SESSION_START_ONLY_OPTIONS is
 * re-stated.
 */
export function continuationOptions(input: {
  readonly workdir: string;
  readonly sessionId: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Record<string, unknown> {
  if (input.sessionId.length === 0) {
    throw new Error("session directive: an empty session id is refused");
  }
  const options = baseSdkOptions(input);
  options["resume"] = input.sessionId;
  return options;
}

/** What one SDK critic call observed and proved. */
export type SdkCriticCall = {
  readonly mintedSessionId: string;
  readonly options: Record<string, unknown>;
  readonly initialRecord: InitialRecord | null;
  readonly proof: CriticProof;
  readonly events: readonly HarnessEvent[];
  readonly usage: HarnessUsage;
};

/**
 * THE SDK CRITIC CALL (T068, F125-FR-030 at auth tier 2, F125-FR-038): a
 * DIRECT in-process call with an API key on a minted FRESH session —
 *   - an EMPTY TOOL LIST (`allowedTools: []`),
 *   - NO SETTINGS SOURCE (`settingSources: []` — no consumer settings file),
 *   - no persistence (never `resume`, nothing written under the session),
 *   - a MINTED session id the call starts (a `continue` directive is
 *     refused: the critic's session is fresh by construction),
 *   - ONE TURN (`maxTurns: 1`),
 *   - a BUDGET (`maxBudgetUsd`),
 *   - an EMPTY DIRECTORY as the working directory (nothing of the
 *     consumer's project is reachable),
 * and the proof is read from the initial record of the stream, exactly as
 * at auth tier 1 (F125-FR-024) — a refusal is `critic_not_toolless`.
 */
export async function runSdkCriticCall(input: {
  readonly queryImpl: import("./load.ts").QueryImpl;
  /** Minted by the adapter for this call (never reused, never continued). */
  readonly mintedSessionId: string;
  readonly prompt: string;
  /** The per-call spend cap in USD. */
  readonly maxBudgetUsd: number;
  /** An EMPTY directory created and removed by the caller. */
  readonly emptyDir: string;
  readonly model?: string;
  /** The API key of the call's secret reference, or nothing. */
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<SdkCriticCall> {
  if (input.mintedSessionId.length === 0) {
    throw new Error("sdk critic: an empty session id is refused");
  }
  const options = sessionStartOptions({
    workdir: input.emptyDir,
    model: input.model,
    maxTurns: 1,
    env: sdkAuthEnvironment(input.env ?? {}),
    maxBudgetUsd: input.maxBudgetUsd,
    apiKey: input.apiKey,
  });
  // The critic never resumes and never continues: a `resume` key here would
  // be a session-carrying bug, so the call refuses to send one.
  if ("resume" in options) throw new Error("sdk critic: the critic session is never resumed");

  const events: HarnessEvent[] = [];
  let usage: HarnessUsage = NULL_USAGE;
  let streamText = "";
  for await (const message of input.queryImpl({ prompt: input.prompt, options })) {
    // Kept from Lisa: the raw stream text is kept for the initial record,
    // which is the source of every proof (F125-FR-024).
    streamText += `${JSON.stringify(message)}\n`;
    const record = message as Record<string, unknown>;
    if (record["type"] === "system" && record["subtype"] === "init") {
      events.push({
        kind: "init",
        model: record["model"] as string | undefined,
        sessionId: record["session_id"] as string,
        tools: (record["tools"] ?? []) as string[],
        iteration: undefined,
      });
    } else if (record["type"] === "assistant") {
      for (const mapped of mapAssistantBlocks(
        (record["message"] as { content?: unknown } | undefined)?.content,
        undefined,
      )) {
        events.push(mapped);
      }
    } else if (record["type"] === "result") {
      const isError = (record as { subtype?: string }).subtype !== "success";
      usage = usageFromSdkResult(record as Parameters<typeof usageFromSdkResult>[0]);
      events.push({
        kind: "result",
        subtype: isError ? "error" : "success",
        usage,
        sessionId: record["session_id"] as string | undefined,
        numTurns: record["num_turns"] as number | undefined,
        isError,
        iteration: undefined,
      });
    }
  }
  const initialRecord = readInitialRecord(streamText);
  const proof = proveToolless({
    initialRecord,
    mintedSessionId: input.mintedSessionId,
    proposerSessionIds: new Set<string>(),
  });
  return { mintedSessionId: input.mintedSessionId, options, initialRecord, proof, events, usage };
}
