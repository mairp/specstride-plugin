/**
 * T049 — the completion client for the kind `openai-chat`, extracted from
 * Lisa's provider seam at `363e6a3` (F109-FR-017).
 *
 * What the extraction changed, and this module holds to: one prompt is
 * sent, one reply is read; the request carries NO tool of any kind; the
 * address, the model and the secret reference come from the descriptor —
 * no fixed variable name is read, and no name of a machine, a gateway or a
 * model is held. Usage comes from the endpoint's own accounting and is NULL
 * where the endpoint reports none. The identity of the provider comes from
 * the descriptor and the endpoint, never from the reply.
 */
import { guardAddress, guardCredentialHost, guardRedirect } from "../endpoint/guard.ts";
import type { RawDescriptor } from "../descriptor/loader.ts";

/** What the endpoint's own accounting reported, or null where it reported none. */
export type EndpointUsage = {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
} | null;

export type CompletionInput = {
  readonly prompt: string;
  /** The model of the call; the descriptor's default where not given. */
  readonly model?: string;
  /** The secret value, resolved from the descriptor's reference by the caller. */
  readonly credential?: string | null;
  /** The live base address; the descriptor's own where not given (a test on loopback). */
  readonly endpointUrl?: string;
  /**
   * The caller's output limit, sent as `max_tokens` ONLY where the caller
   * passes one (feature 131, F131-FR-031: under `parity` no output limit is
   * sent). Absent from the body otherwise, as before.
   */
  readonly maxOutputTokens?: number;
};

export type CompletionOutcome =
  | {
      readonly ok: true;
      readonly reply: string;
      readonly usage: EndpointUsage;
      /** The provider identity from the descriptor and the endpoint only. */
      readonly provider: string;
      readonly status: number;
    }
  | { readonly ok: false; readonly reason: string; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The endpoint record of the descriptor: base address and chat path. */
export function endpointOf(descriptor: RawDescriptor): {
  readonly baseUrl: string;
  readonly chatPath: string;
} | null {
  const endpoint = descriptor.endpoint;
  if (!isRecord(endpoint)) return null;
  if (typeof endpoint.baseUrl !== "string" || typeof endpoint.chatPath !== "string") {
    return null;
  }
  return { baseUrl: endpoint.baseUrl, chatPath: endpoint.chatPath };
}

/** The default model of the descriptor, or null where none is declared. */
export function defaultModelOf(descriptor: RawDescriptor): string | null {
  const models = descriptor.models;
  if (!isRecord(models) || typeof models.default !== "string") return null;
  return models.default;
}

/** The provider identity, from the descriptor and the endpoint — never the reply. */
export function providerOf(descriptor: RawDescriptor): string {
  const provider = descriptor.provider;
  if (isRecord(provider) && typeof provider.id === "string") return provider.id;
  return endpointOf(descriptor)?.baseUrl ?? "unknown";
}

/**
 * F109-FR-017 — send ONE prompt, read ONE reply, in the `openai-chat`
 * request shape. The body holds no `tools` key of any kind.
 */
export async function completeOpenaiChat(
  descriptor: RawDescriptor,
  input: CompletionInput,
): Promise<CompletionOutcome> {
  const endpoint = endpointOf(descriptor);
  if (endpoint === null) {
    return { ok: false, reason: "descriptor", message: "the descriptor declares no endpoint" };
  }
  const baseUrl = input.endpointUrl ?? endpoint.baseUrl;
  const address = guardAddress(baseUrl);
  if (!address.ok) return { ok: false, reason: address.reason, message: address.message };
  const bound = guardCredentialHost(endpoint.baseUrl, baseUrl);
  if (!bound.ok) return { ok: false, reason: bound.reason, message: bound.message };

  const model = input.model ?? defaultModelOf(descriptor);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.credential) {
    const scheme =
      isRecord(descriptor.auth) && descriptor.auth.scheme === "x-api-key" ? "x-api-key" : "bearer";
    if (scheme === "x-api-key") headers["x-api-key"] = input.credential;
    else headers.authorization = `Bearer ${input.credential}`;
  }
  // The request shape, as Lisa's client sent it: one message of the user,
  // no stream, NO tool of any kind.
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [{ role: "user", content: input.prompt }],
  };
  if (input.maxOutputTokens !== undefined) body.max_tokens = input.maxOutputTokens;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint.chatPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch (error) {
    return {
      ok: false,
      reason: "transport-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const redirect = guardRedirect(response.status);
  if (!redirect.ok) return { ok: false, reason: redirect.reason, message: redirect.message };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    return {
      ok: false,
      reason: "reply",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "endpoint-status",
      message: `the endpoint answered ${response.status}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "reply", message: "the reply is not a record" };
  }
  const choices = parsed.choices;
  const first = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : null;
  const message = first !== null && isRecord(first.message) ? first.message : null;
  const reply = message !== null && typeof message.content === "string" ? message.content : null;
  if (reply === null) {
    return { ok: false, reason: "reply", message: "the reply carries no message content" };
  }
  // Usage from the endpoint's own accounting, NULL where it reports none.
  let usage: EndpointUsage = null;
  if (isRecord(parsed.usage)) {
    const reported = parsed.usage;
    usage = {
      inputTokens: typeof reported.prompt_tokens === "number" ? reported.prompt_tokens : null,
      outputTokens:
        typeof reported.completion_tokens === "number" ? reported.completion_tokens : null,
    };
  }
  return { ok: true, reply, usage, provider: providerOf(descriptor), status: response.status };
}
