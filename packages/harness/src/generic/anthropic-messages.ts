/**
 * T049 — the completion client for the kind `anthropic-messages`, extracted
 * from Lisa's provider seam at `363e6a3` (F109-FR-017).
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
import {
  defaultModelOf,
  endpointOf,
  providerOf,
  type CompletionInput,
  type CompletionOutcome,
  type EndpointUsage,
} from "./openai-chat.ts";

export { defaultModelOf, endpointOf, providerOf };
export type { CompletionInput, CompletionOutcome, EndpointUsage };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * F109-FR-017 — send ONE prompt, read ONE reply, in the
 * `anthropic-messages` request shape. The body holds no `tools` key of any
 * kind. The header the scheme `x-api-key` names is the one this shape uses.
 */
export async function completeAnthropicMessages(
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (input.credential) {
    const scheme =
      isRecord(descriptor.auth) && descriptor.auth.scheme === "bearer" ? "bearer" : "x-api-key";
    if (scheme === "bearer") headers.authorization = `Bearer ${input.credential}`;
    else headers["x-api-key"] = input.credential;
  }
  // The request shape, as Lisa's client sent it: one message of the user,
  // NO tool of any kind.
  const body = {
    model,
    max_tokens: 4096,
    stream: false,
    messages: [{ role: "user", content: input.prompt }],
  };
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
  const content = parsed.content;
  const text = Array.isArray(content)
    ? content
        .filter(
          (block): block is { type: "text"; text: string } =>
            isRecord(block) && block.type === "text" && typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("")
    : null;
  if (text === null) {
    return { ok: false, reason: "reply", message: "the reply carries no text block" };
  }
  // Usage from the endpoint's own accounting, NULL where it reports none.
  let usage: EndpointUsage = null;
  if (isRecord(parsed.usage)) {
    const reported = parsed.usage;
    usage = {
      inputTokens: typeof reported.input_tokens === "number" ? reported.input_tokens : null,
      outputTokens: typeof reported.output_tokens === "number" ? reported.output_tokens : null,
    };
  }
  return {
    ok: true,
    reply: text,
    usage,
    provider: providerOf(descriptor),
    status: response.status,
  };
}
