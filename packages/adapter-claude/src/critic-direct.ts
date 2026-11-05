/**
 * T045 + T046 — the critic at auth tier 2: the direct call (F125-FR-027 to
 * F125-FR-030).
 *
 * - The call is an HTTP POST to `<base>/v1/messages` with the headers
 *   `x-api-key` and `anthropic-version: 2023-06-01`, a `max_tokens` of
 *   2048, ONE user message and NO field that names tools; the reply is the
 *   concatenation of the `text` content blocks (F125-FR-028). It has no
 *   session and no configuration home by construction (D-5).
 * - The key, the base address and the model are resolved through the
 *   aliases of the baseline (F125-FR-029): `SPECSTRIDE_CLAUDE_CRITIC_API_KEY`
 *   else `ANTHROPIC_API_KEY`; `SPECSTRIDE_CLAUDE_CRITIC_BASE_URL` else
 *   `ANTHROPIC_BASE_URL` else `https://api.anthropic.com`, trailing slash
 *   removed; `SPECSTRIDE_CLAUDE_CRITIC_MODEL` else the default critic model
 *   of the as-is critic data. Each as-is name stays an alias of a key read
 *   from the environment at the moment of use; an inline value in
 *   configuration is a configuration error. A plain address is refused
 *   unless it is the loopback address; redirects are refused.
 * - The context-window table, its parity-only fallback, the consumer's
 *   override and the budget caps are data of `data/models.json`, consumed
 *   here (F125-FR-027).
 */
import modelsTable from "../data/models.json" with { type: "json" };

/** The API version header of the Messages call (F125-FR-028). */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The `max_tokens` of the direct call (F125-FR-028). */
export const CRITIC_MAX_TOKENS = 2048;

/** The direct call is ONE turn (F125-FR-023, F125-FR-027). */
export const CRITIC_ONE_TURN = 1;

/** The default base address (F125-FR-029). */
export const DEFAULT_CRITIC_BASE_URL = "https://api.anthropic.com";

/** The default critic model of the as-is critic data (F125-FR-029, B-0830). */
export const DEFAULT_CRITIC_MODEL = "claude-opus-4-8";

/** The variable of the as-is context-window override (F125-FR-027). */
export const CRITIC_CONTEXT_TOKENS_VARIABLE = "SPECSTRIDE_CRITIC_CONTEXT_TOKENS";

/** The parity-only fallback window (F125-FR-027, B-0911). */
export const PARITY_FALLBACK_CONTEXT_TOKENS = 200_000;

/** The critic's credential variables, which never enter the proposer's env. */
export const CRITIC_KEY_VARIABLES = [
  "SPECSTRIDE_CLAUDE_CRITIC_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

/** The alias variables of the base address (F125-FR-029). */
export const CRITIC_BASE_URL_VARIABLES = [
  "SPECSTRIDE_CLAUDE_CRITIC_BASE_URL",
  "ANTHROPIC_BASE_URL",
] as const;

/** Why a direct call was refused or failed. */
export type CriticDirectRefusalReason =
  | "missing-key"
  | "inline-value"
  | "plain-address"
  | "redirect"
  | "context-window-unknown"
  | "budget-exceeded"
  | "terms-refused";

/** The error a refused direct call carries (a critic configuration error). */
export class CriticDirectRefusedError extends Error {
  readonly reason: CriticDirectRefusalReason;

  constructor(reason: CriticDirectRefusalReason, message: string) {
    super(message);
    this.name = "CriticDirectRefusedError";
    this.reason = reason;
  }
}

/** A transport failure of the direct call: a typed failure, NO verdict. */
export class CriticDirectTransportError extends Error {
  readonly kind: "error-status" | "hang" | "empty-reply";

  constructor(kind: "error-status" | "hang" | "empty-reply", message: string) {
    super(message);
    this.name = "CriticDirectTransportError";
    this.kind = kind;
  }
}

/** A terms gate that does not allow the call at this moment (F125-FR-030). */
export class TermsGateRefusedError extends CriticDirectRefusedError {
  constructor(message: string) {
    super("terms-refused", message);
    this.name = "TermsGateRefusedError";
  }
}

/* ------------------------------------------------------------------ *
 * T045 — the aliases.
 * ------------------------------------------------------------------ */

/** The aliases resolved, with the variable each value came from. */
export type CriticAliases = {
  readonly key: string;
  readonly keySource: string;
  readonly baseUrl: string;
  readonly baseUrlSource: string;
  readonly model: string;
  readonly modelSource: string;
};

/**
 * The alias resolution of the baseline (F125-FR-029, B-0811 to B-0814,
 * B-0830). The key is read from the variable AT THE MOMENT OF USE; with
 * neither key variable the call fails without a reply, so the verdict is
 * scored MALFORMED by the critic strategy.
 */
export function resolveCriticAliases(
  env: Readonly<Record<string, string | undefined>>,
): CriticAliases {
  const keyVariable = CRITIC_KEY_VARIABLES.find((name) => {
    const value = env[name];
    return typeof value === "string" && value !== "";
  });
  if (keyVariable === undefined) {
    throw new CriticDirectRefusedError(
      "missing-key",
      "the critic direct call has no key: neither SPECSTRIDE_CLAUDE_CRITIC_API_KEY nor " +
        "ANTHROPIC_API_KEY is set; the call fails without a reply (F125-FR-029)",
    );
  }
  const baseUrlVariable =
    CRITIC_BASE_URL_VARIABLES.find((name) => typeof env[name] === "string" && env[name] !== "") ??
    null;
  const rawBaseUrl =
    baseUrlVariable !== null ? (env[baseUrlVariable] as string) : DEFAULT_CRITIC_BASE_URL;
  return Object.freeze({
    key: env[keyVariable] as string,
    keySource: keyVariable,
    baseUrl: rawBaseUrl.replace(/\/+$/, ""),
    baseUrlSource: baseUrlVariable ?? "default",
    model:
      typeof env["SPECSTRIDE_CLAUDE_CRITIC_MODEL"] === "string" &&
      env["SPECSTRIDE_CLAUDE_CRITIC_MODEL"] !== ""
        ? (env["SPECSTRIDE_CLAUDE_CRITIC_MODEL"] as string)
        : DEFAULT_CRITIC_MODEL,
    modelSource:
      typeof env["SPECSTRIDE_CLAUDE_CRITIC_MODEL"] === "string" &&
      env["SPECSTRIDE_CLAUDE_CRITIC_MODEL"] !== ""
        ? "SPECSTRIDE_CLAUDE_CRITIC_MODEL"
        : "default",
  });
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Refuses a PLAIN address (one whose scheme is not `https`) unless it is
 * the loopback address, and every address whose host is not the host the
 * key was declared for (F125-FR-029): the key is sent only to that host.
 */
export function assertAddressAllowed(input: {
  readonly baseUrl: string;
  readonly declaredHost?: string | null;
}): void {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new CriticDirectRefusedError(
      "plain-address",
      `the address "${input.baseUrl}" is not a URL`,
    );
  }
  if (url.protocol !== "https:") {
    const loopback = LOOPBACK_HOSTS.has(url.hostname) || url.hostname === "localhost";
    if (!loopback) {
      throw new CriticDirectRefusedError(
        "plain-address",
        `refused the plain address "${input.baseUrl}": a non-loopback plain address is refused (F125-FR-029)`,
      );
    }
  }
  if (input.declaredHost != null && input.declaredHost !== "" && url.host !== input.declaredHost) {
    throw new CriticDirectRefusedError(
      "plain-address",
      `refused the address "${input.baseUrl}": the key is declared for the host ` +
        `"${input.declaredHost}" and is sent only to it (F125-FR-029)`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * T045 — the request and the reply.
 * ------------------------------------------------------------------ */

/** The direct call request, as F125-FR-028 states it. */
export type CriticDirectRequest = {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
};

/** Builds the request. The body names NO tool field, ever. */
export function buildMessagesRequest(input: {
  readonly prompt: string;
  readonly baseUrl: string;
  readonly key: string;
  readonly model: string;
  /** The consumer's per-call cap; the default is the table's 2048. */
  readonly maxTokens?: number | null;
}): CriticDirectRequest {
  const url = `${input.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  return Object.freeze({
    url,
    method: "POST",
    headers: Object.freeze({
      "content-type": "application/json",
      "x-api-key": input.key,
      "anthropic-version": ANTHROPIC_VERSION,
    }),
    body: Object.freeze({
      model: input.model,
      max_tokens: input.maxTokens ?? CRITIC_MAX_TOKENS,
      messages: [{ role: "user", content: input.prompt }],
      // No `tools`, no `tool_choice`, no `mcp_servers`: the call has no
      // tool by construction (F125-FR-028).
    }),
  });
}

/** True when the request body names no field that carries a tool. */
export function bodyNamesNoTool(body: Readonly<Record<string, unknown>>): boolean {
  return !("tools" in body) && !("tool_choice" in body) && !("mcp_servers" in body);
}

/** The reply text: the concatenation of the `text` content blocks. */
export function replyTextOfDirect(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const content = (body as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((block) =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
  return text;
}

/* ------------------------------------------------------------------ *
 * T046 — the context-window table, the override, the fallback, the caps.
 * ------------------------------------------------------------------ */

/** The window table, as `data/models.json` holds it. */
export type ContextWindowTable = {
  readonly windows: Readonly<Record<string, number>>;
  readonly parityFallbackTokens: number;
  readonly overrideVariable: string;
};

/** The table of the as-is critic (F125-FR-027): data, never a rule. */
export const CONTEXT_WINDOW_TABLE: ContextWindowTable = Object.freeze({
  windows: Object.freeze(
    (modelsTable.contextWindows as { readonly windows?: Record<string, number> }).windows ?? {},
  ),
  parityFallbackTokens:
    (modelsTable.contextWindows as { readonly parityFallbackTokens?: number })
      .parityFallbackTokens ?? PARITY_FALLBACK_CONTEXT_TOKENS,
  overrideVariable:
    (modelsTable.contextWindows as { readonly overrideVariable?: string }).overrideVariable ??
    CRITIC_CONTEXT_TOKENS_VARIABLE,
});

/** The budget caps, as `data/models.json` holds them (F125-FR-023, F125-FR-027). */
export type BudgetCaps = {
  /** The per-call spending cap in USD; null where none is set. */
  readonly perCallUsd: number | null;
  readonly maxTokens: number;
  readonly oneTurn: number;
  readonly promptSizeTokens: number;
};

/** The caps of the critic, read from the data file. */
export function budgetCaps(): BudgetCaps {
  const caps = modelsTable.budgetCaps as
    | {
        readonly perCallUsd: number | null;
        readonly maxTokens: number;
        readonly oneTurn: number;
        readonly promptSizeTokens: number;
      }
    | undefined;
  return Object.freeze({
    perCallUsd: caps?.perCallUsd ?? null,
    maxTokens: caps?.maxTokens ?? CRITIC_MAX_TOKENS,
    oneTurn: caps?.oneTurn ?? CRITIC_ONE_TURN,
    promptSizeTokens: caps?.promptSizeTokens ?? 200_000,
  });
}

/** True where the doctor must warn: no per-call cap is set (F125-FR-027). */
export function budgetCapMissing(): boolean {
  return budgetCaps().perCallUsd === null;
}

/**
 * The context window of a critic model (F125-FR-027): the consumer's
 * explicit window ALWAYS wins; then the table; then, under the `parity`
 * profile only, the 200,000 fallback the baseline uses; anywhere else an
 * unlisted model without a declared window MUST NOT qualify as critic and
 * the call is refused, naming the model and the key to set.
 */
export function contextWindowFor(input: {
  readonly model: string;
  readonly profile: "parity" | "default";
  /** `roles.critic.contextTokens` or SPECSTRIDE_CRITIC_CONTEXT_TOKENS. */
  readonly declared?: number | null;
}): number {
  if (typeof input.declared === "number" && Number.isFinite(input.declared) && input.declared > 0) {
    return input.declared;
  }
  const listed = CONTEXT_WINDOW_TABLE.windows[input.model];
  if (typeof listed === "number") return listed;
  if (input.profile === "parity") return CONTEXT_WINDOW_TABLE.parityFallbackTokens;
  throw new CriticDirectRefusedError(
    "context-window-unknown",
    `refused the critic call: the context window of the model "${input.model}" is not known ` +
      `up front; declare it through roles.critic.contextTokens or the variable ` +
      `${CONTEXT_WINDOW_VARIABLE_PLACEHOLDER} (F125-FR-027)`,
  );
}

/** The variable the refusal names (kept as its own constant for the tests). */
export const CONTEXT_WINDOW_VARIABLE_PLACEHOLDER = CRITIC_CONTEXT_TOKENS_VARIABLE;

/* ------------------------------------------------------------------ *
 * T045 — the call itself.
 * ------------------------------------------------------------------ */

/** The record one direct call leaves behind (F125-FR-024, F125-FR-028). */
export type CriticDirectCallRecord = {
  readonly role: "critic";
  readonly transport: "direct-call";
  readonly authTier: 2;
  readonly model: string;
  readonly baseUrlHost: string;
  readonly contextTokens: number;
  readonly maxTokens: number;
  readonly turns: number;
  readonly budgetUsd: number | null;
  readonly verdict: string | null;
  readonly failure: { readonly kind: "error-status" | "hang" | "empty-reply" } | null;
};

/** What the caller of the direct call supplies. */
export type CriticDirectCallInput = {
  readonly prompt: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The fetch used; injectable for the tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** The host the key was declared for; the key is sent only to it. */
  readonly declaredHost?: string | null;
  readonly profile: "parity" | "default";
  /** The consumer's window, which always wins (F125-FR-027). */
  readonly declaredContextTokens?: number | null;
  /** The per-call spending cap of this call. */
  readonly budgetUsd?: number | null;
  /** Whether the terms gate allows the call at this moment (F125-FR-030). */
  readonly termsAllowed?: boolean;
};

/**
 * The direct call of the critic at auth tier 2 (F125-FR-028, F125-FR-029,
 * F125-FR-030): one POST, no session, no configuration home, no tool; a
 * typed failure and NO verdict on a transport failure; a refused terms gate
 * refuses the call before it is made.
 */
export async function callCriticDirect(
  input: CriticDirectCallInput,
): Promise<CriticDirectCallRecord> {
  // F125-FR-030: a terms gate that does not allow the call refuses it.
  if (input.termsAllowed === false) {
    throw new TermsGateRefusedError(
      "refused the critic call: the terms gate does not allow it at this moment (F125-FR-030)",
    );
  }
  const aliases = resolveCriticAliases(input.env);
  assertAddressAllowed({ baseUrl: aliases.baseUrl, declaredHost: input.declaredHost ?? null });
  const url = new URL(aliases.baseUrl);
  const contextTokens = contextWindowFor({
    model: aliases.model,
    profile: input.profile,
    declared: input.declaredContextTokens ?? null,
  });
  const caps = budgetCaps();
  if (
    typeof input.budgetUsd === "number" &&
    caps.perCallUsd !== null &&
    input.budgetUsd > caps.perCallUsd
  ) {
    throw new CriticDirectRefusedError(
      "budget-exceeded",
      `refused the critic call: its budget ${input.budgetUsd} exceeds the per-call cap ` +
        `${caps.perCallUsd} (F125-FR-023)`,
    );
  }
  const request = buildMessagesRequest({
    prompt: input.prompt,
    baseUrl: aliases.baseUrl,
    key: aliases.key,
    model: aliases.model,
    maxTokens: caps.maxTokens,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    // redirect: "error" — redirects are REFUSED, not followed (F125-FR-029).
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: JSON.stringify(request.body),
      redirect: "error",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/redirect/i.test(message)) {
      throw new CriticDirectRefusedError(
        "redirect",
        `refused the direct call: the endpoint redirected, and a redirect is refused (F125-FR-029): ${message}`,
      );
    }
    throw new CriticDirectTransportError("hang", `the direct call did not answer: ${message}`);
  }
  const record: CriticDirectCallRecord = Object.freeze({
    role: "critic",
    transport: "direct-call",
    authTier: 2,
    model: aliases.model,
    baseUrlHost: url.host,
    contextTokens,
    maxTokens: caps.maxTokens,
    turns: CRITIC_ONE_TURN,
    budgetUsd: input.budgetUsd ?? caps.perCallUsd,
    verdict: null,
    failure: null,
  });
  if (!response.ok) {
    throw new CriticDirectTransportError(
      "error-status",
      `the direct call answered the status ${String(response.status)}; no verdict is produced (F125-FR-030)`,
    );
  }
  const text = replyTextOfDirect(await response.json());
  if (text === null || text.trim() === "") {
    throw new CriticDirectTransportError(
      "empty-reply",
      "the direct call answered no text block; no verdict is produced (F125-FR-030)",
    );
  }
  return Object.freeze({ ...record, verdict: text });
}
